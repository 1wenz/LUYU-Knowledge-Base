import assert from "node:assert/strict";
import test from "node:test";
import { withTestDatabase } from "./database-fixture";
import { createEvaluationStore } from "../evals/postgres";
import { corpus } from "../evals/fixtures";
import { readEvaluationConfig, runEvaluation } from "../evals/runner";

test("真实 PostgreSQL eval 以合成 HTTP 运行全部 30 题，34 次请求并保留统计", async () =>
  withTestDatabase(async (pool) => {
    let calls = 0;
    const config = readEvaluationConfig({
      RUN_LIVE_EVAL: "1",
      OPENROUTER_API_KEY: "synthetic",
      COHERE_API_KEY: "synthetic",
      EVAL_DATABASE_URL: "postgresql://synthetic@localhost/test",
      EVAL_QUESTION_COUNT: "30",
      EVAL_REQUEST_BUDGET: "34",
    });
    const report = await runEvaluation(config, {
      store: createEvaluationStore(pool, 3072),
      fetch: async (url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        if (String(url).endsWith("/embeddings"))
          return Response.json({
            data: body.input.map((text: string, index: number) => {
              const match = corpus.findIndex((doc) => doc.content === text);
              return {
                index,
                embedding: Array.from({ length: body.dimensions }, (_, axis) =>
                  axis === Math.max(match, 0) ? 1 : 0,
                ),
              };
            }),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          });
        return Response.json({
          results: body.documents
            .slice(0, body.top_n)
            .map((content: string, index: number) => ({
              index,
              relevance_score: Math.max(0.01, 1 - index / 100),
              length: content.length,
            })),
          meta: { billed_units: { search_units: 1 } },
        });
      },
    });
    assert.equal(calls, 34);
    assert.equal(report.evaluatedQuestions, 30);
    assert.equal(report.corpusChunks, 24);
    assert.equal(report.questions.length, 30);
    assert.ok(report.questions.every((row) => row.rankings.vector.length >= 20));
    for (const metrics of Object.values(report.metrics))
      for (const value of Object.values(metrics))
        assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    // Synthetic vectors prove the harness and SQL execute; these metrics are not real provider quality evidence.
  }));
