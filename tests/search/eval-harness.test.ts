import assert from "node:assert/strict";
import test from "node:test";
import { corpus, questions } from "../evals/fixtures";
import { qualityMetrics, meanQuality } from "../evals/metrics";
import {
  readEvaluationConfig,
  runEvaluation,
  EvaluationFailure,
  type EvaluationStore,
  type EvaluationCandidate,
} from "../evals/runner";

test("合成质量集有 30 个双语问题、24 份独立资料和显式正相关标注", () => {
  assert.equal(questions.length, 30);
  assert.equal(corpus.length, 24);
  assert.equal(new Set(corpus.map((doc) => doc.key)).size, corpus.length);
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  for (const language of ["zh", "en"])
    assert.equal(questions.filter((question) => question.language === language).length, 15);
  for (const question of questions)
    for (const [key, grade] of Object.entries(question.relevant)) {
      assert.ok(corpus.some((doc) => doc.key === key));
      assert.ok(grade > 0);
    }
});

test("质量指标按文档去重，Recall@20/nDCG@8/MRR 与手算结果一致", () => {
  const result = qualityMetrics(["none", "a", "a", "b"], { a: 3, b: 1 });
  assert.equal(result.recallAt20, 1);
  assert.equal(result.mrr, 0.5);
  assert.ok(
    Math.abs(result.ndcgAt8 - (7 / Math.log2(3) + 1 / Math.log2(4)) / (7 + 1 / Math.log2(3))) <
      1e-12,
  );
  assert.deepEqual(qualityMetrics([], { a: 3 }), { recallAt20: 0, ndcgAt8: 0, mrr: 0 });
  assert.deepEqual(meanQuality([result, result]), result);
  assert.throws(() => meanQuality([]));
});

const environment = {
  RUN_LIVE_EVAL: "1",
  OPENROUTER_API_KEY: "synthetic-openrouter-private",
  COHERE_API_KEY: "synthetic-cohere-private",
  EVAL_DATABASE_URL: "postgresql://synthetic:private@localhost/test",
};
test("live 配置显式开关、keys 与专用库；默认 6 次预算，配置错误不回显值", () => {
  assert.throws(
    () => readEvaluationConfig({ ...environment, RUN_LIVE_EVAL: "0" }),
    (error: unknown) => error instanceof EvaluationFailure && !String(error).includes("private"),
  );
  assert.throws(() => readEvaluationConfig({ ...environment, COHERE_API_KEY: " " }));
  assert.equal(readEvaluationConfig(environment).requestBudget, 6);
  assert.equal(readEvaluationConfig(environment).questionCount, 2);
  assert.throws(() => readEvaluationConfig({ ...environment, EVAL_EMBEDDING_DIMENSIONS: "8" }));
  assert.throws(() => readEvaluationConfig({ ...environment, EVAL_REQUEST_BUDGET: "0" }));
});

const candidate = (key: string, id: string): EvaluationCandidate => ({
  id,
  documentKey: key,
  tags: [],
  source: {
    chunkId: id,
    documentId: id,
    documentRevision: 1,
    title: key,
    content: corpus.find((doc) => doc.key === key)!.content,
    startLine: 1,
    endLine: 1,
  },
});
const store = (): EvaluationStore => ({
  prepare: async () => corpus.map((doc) => doc.content),
  index: async (vectors) => {
    assert.equal(vectors.length, 24);
    assert.equal(vectors[0].length, 3072);
  },
  recall: async () => ({
    keyword: [candidate("garden", "a"), candidate("receipt", "b")],
    vector: [candidate("receipt", "b"), candidate("garden", "a")],
    timingsMs: { keyword: 1, vector: 1 },
  }),
});
const fakeNetwork =
  (onRequest: () => void): typeof fetch =>
  async (url, init) => {
    onRequest();
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/embeddings"))
      return Response.json({
        data: body.input.map((text: string, index: number) => ({
          index,
          embedding: Array.from({ length: body.dimensions }, (_, axis) => (axis === 0 ? 1 : 0)),
          textLength: text.length,
        })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });
    assert.equal(String(url), "https://api.cohere.com/v2/rerank");
    const ranked = body.documents
      .map((text: string, index: number) => ({
        index,
        relevance_score: text.includes("发票") ? 0.9 : 0.1,
      }))
      .sort(
        (a: { relevance_score: number }, b: { relevance_score: number }) =>
          b.relevance_score - a.relevance_score,
      );
    return Response.json({
      results: ranked.slice(0, body.top_n),
      meta: { billed_units: { search_units: 1 } },
    });
  };

test("runner 默认只评两题，五次真实适配器请求，报告三个基线与重排、维度和用量", async () => {
  let requests = 0;
  const report = await runEvaluation(readEvaluationConfig(environment), {
    store: store(),
    fetch: fakeNetwork(() => {
      requests++;
    }),
  });
  assert.equal(requests, 5);
  assert.equal(report.requestCount, 5);
  assert.equal(report.availableQuestions, 30);
  assert.equal(report.evaluatedQuestions, 2);
  assert.equal(report.dimensions, 3072);
  assert.equal(report.metrics.keyword.mrr, 0.5);
  assert.equal(report.metrics.vector.mrr, 1);
  assert.ok(report.metrics.rrf.mrr > 0);
  assert.equal(report.metrics.reranked.mrr, 1);
  assert.ok(report.requests.some((item) => item.usage?.promptTokens === 10));
  assert.equal(JSON.stringify(report).includes("private"), false);
});

test("预算不足在付费前失败；重试也计入总预算，不能降级为成功评估", async () => {
  let requests = 0;
  const config = readEvaluationConfig({ ...environment, EVAL_REQUEST_BUDGET: "4" });
  await assert.rejects(
    runEvaluation(config, {
      store: store(),
      fetch: fakeNetwork(() => {
        requests++;
      }),
    }),
    (error: unknown) => error instanceof EvaluationFailure && error.code === "BUDGET_EXCEEDED",
  );
  assert.equal(requests, 0);
  const exact = readEvaluationConfig({ ...environment, EVAL_REQUEST_BUDGET: "5" });
  await assert.rejects(
    runEvaluation(exact, {
      store: store(),
      fetch: async () => {
        requests++;
        return new Response("synthetic-private", { status: 429 });
      },
    }),
    (error: unknown) => error instanceof EvaluationFailure && !String(error).includes("private"),
  );
  assert.ok(requests <= 5);
});

test("临时 429 的真实重试计数；预算耗尽不发第七次请求", async () => {
  const exact = readEvaluationConfig({ ...environment, EVAL_MAX_RETRIES: "2" });
  let requests = 0;
  let reranks = 0;
  const valid = fakeNetwork(() => {
    requests++;
  });
  await assert.rejects(
    runEvaluation(exact, {
      store: store(),
      fetch: async (url, init) => {
        if (String(url).endsWith("/rerank") && reranks++ < 2) {
          requests++;
          return new Response("synthetic-private", { status: 429 });
        }
        return valid(url, init);
      },
    }),
    (error: unknown) => error instanceof EvaluationFailure && error.code === "BUDGET_EXCEEDED",
  );
  assert.equal(requests, 6);
});

test("1536 可选回答使用独立预算，模型能力和真实 SSE usage 入报告", async () => {
  let requests = 0;
  const valid = fakeNetwork(() => {
    requests++;
  });
  const config = readEvaluationConfig({
    ...environment,
    EVAL_EMBEDDING_DIMENSIONS: "1536",
    EVAL_QUESTION_COUNT: "1",
    EVAL_CHAT_MODEL: "synthetic/chat",
  });
  const report = await runEvaluation(config, {
    store: {
      ...store(),
      index: async (vectors) => {
        assert.equal(vectors[0].length, 1536);
      },
    },
    fetch: async (url, init) => {
      if (String(url).endsWith("/models")) {
        requests++;
        return Response.json({
          data: [
            {
              id: "synthetic/chat",
              name: "合成",
              context_length: 8000,
              top_provider: { max_completion_tokens: 1024 },
              supported_parameters: [],
            },
          ],
        });
      }
      if (String(url).endsWith("/chat/completions")) {
        requests++;
        assert.equal(JSON.parse(String(init?.body)).temperature, undefined);
        return new Response(
          `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic/chat", choices: [{ index: 0, delta: { role: "assistant", content: "合成回答 [1] [999]" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic/chat", choices: [], usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return valid(url, init);
    },
  });
  assert.equal(requests, 6);
  assert.equal(report.requestCount, 6);
  assert.equal(report.dimensions, 1536);
  assert.equal(report.answer?.text, "合成回答 [1] ");
  assert.deepEqual(report.answer?.citationNumbers, [1]);
  assert.equal(report.requests.find((item) => item.stage === "answer")?.usage?.outputTokens, 8);
});
