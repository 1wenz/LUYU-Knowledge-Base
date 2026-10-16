import { z } from "zod";
import type { ServiceContext } from "../../src/lib/contracts";
import { OpenRouterEmbeddings } from "../../electron/services/knowledge/providers/openrouter";
import { createCohereReranker } from "../../electron/services/knowledge/providers/cohere";
import { createProviderCatalog } from "../../electron/services/knowledge/providers/catalog";
import {
  createChatStream,
  type AssistantSource,
} from "../../electron/services/knowledge/providers/chat";
import { large3TokenCounter } from "../../electron/services/knowledge/providers/tokenizer";
import { citationFilter } from "../../electron/services/knowledge/assistant";
import { deadline } from "../../electron/services/knowledge/async";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";
import { selectContext } from "../../src/lib/domain/citations";
import { fuseRankedCandidates } from "../../src/lib/domain/rrf";
import { corpus, questions, type EvalQuestion } from "./fixtures";
import { meanQuality, qualityMetrics, type QualityMetrics } from "./metrics";

export class EvaluationFailure extends Error {
  constructor(
    public readonly code: "CONFIG" | "BUDGET_EXCEEDED" | "PROVIDER_FAILED" | "STORE_FAILED",
  ) {
    super(`live eval failed: ${code}`);
    this.name = "EvaluationFailure";
  }
}
export type EvaluationConfig = {
  openRouterKey: string;
  cohereKey: string;
  databaseUrl: string;
  dimensions: 1536 | 3072;
  requestBudget: number;
  questionCount: number;
  maxRetries: number;
  chatModel: string | null;
};
// Environment access is confined to this explicitly invoked evaluation entrypoint.
export function readEvaluationConfig(
  environment: Record<string, string | undefined> = process.env,
): EvaluationConfig {
  const openRouterKey = environment.OPENROUTER_API_KEY?.trim();
  const cohereKey = environment.COHERE_API_KEY?.trim();
  const databaseUrl = environment.EVAL_DATABASE_URL?.trim();
  if (environment.RUN_LIVE_EVAL !== "1" || !openRouterKey || !cohereKey || !databaseUrl)
    throw new EvaluationFailure("CONFIG");
  try {
    const url = new URL(databaseUrl);
    if (!["postgresql:", "postgres:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new EvaluationFailure("CONFIG");
  }
  const dimensions = environment.EVAL_EMBEDDING_DIMENSIONS
    ? Number(environment.EVAL_EMBEDDING_DIMENSIONS)
    : 3072;
  const requestBudget = environment.EVAL_REQUEST_BUDGET
    ? Number(environment.EVAL_REQUEST_BUDGET)
    : 6;
  const questionCount = environment.EVAL_QUESTION_COUNT
    ? Number(environment.EVAL_QUESTION_COUNT)
    : 2;
  const maxRetries = environment.EVAL_MAX_RETRIES ? Number(environment.EVAL_MAX_RETRIES) : 1;
  const chatModel = environment.EVAL_CHAT_MODEL?.trim() || null;
  if (
    ![1536, 3072].includes(dimensions) ||
    !Number.isSafeInteger(requestBudget) ||
    requestBudget < 1 ||
    requestBudget > 100 ||
    !Number.isSafeInteger(questionCount) ||
    questionCount < 1 ||
    questionCount > questions.length ||
    !Number.isInteger(maxRetries) ||
    maxRetries < 0 ||
    maxRetries > 2 ||
    (chatModel !== null && (chatModel.length > 200 || !/^[a-zA-Z0-9_.:/-]+$/.test(chatModel)))
  )
    throw new EvaluationFailure("CONFIG");
  return {
    openRouterKey,
    cohereKey,
    databaseUrl,
    dimensions: dimensions as 1536 | 3072,
    requestBudget,
    questionCount,
    maxRetries,
    chatModel,
  };
}
export type EvaluationCandidate = {
  id: string;
  documentKey: string;
  tags: string[];
  source: AssistantSource;
};
export type EvaluationStore = {
  prepare(context: ServiceContext): Promise<string[]>;
  index(vectors: number[][], context: ServiceContext): Promise<void>;
  recall(
    input: { question: EvalQuestion; embedding: number[] },
    context: ServiceContext,
  ): Promise<{
    keyword: EvaluationCandidate[];
    vector: EvaluationCandidate[];
    timingsMs: { keyword: number; vector: number };
  }>;
};
type Stage = "index-embedding" | "query-embedding" | "rerank" | "models" | "answer";
export type ProviderRequest = {
  provider: "openrouter" | "cohere";
  stage: Stage;
  status: number | null;
  latencyMs: number;
  usage: {
    promptTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    searchUnits: number | null;
    costUsd: number | null;
  } | null;
};
type Baseline = "keyword" | "vector" | "rrf" | "reranked";
type QuestionResult = {
  id: string;
  language: "zh" | "en";
  kind: EvalQuestion["kind"];
  expectedNoAnswer: boolean;
  rankings: Record<Baseline, string[]>;
  metrics: Record<Baseline, QualityMetrics | null>;
  timingsMs: { keyword: number; vector: number; fusion: number; rerank: number };
};
export type EvaluationReport = {
  generatedAt: string;
  dimensions: 1536 | 3072;
  availableQuestions: number;
  evaluatedQuestions: number;
  positiveQuestions: number;
  noAnswer: { questions: number; queriesWithCandidates: Record<Baseline, number> };
  corpusDocuments: number;
  corpusChunks: number;
  requestBudget: number;
  requestCount: number;
  elapsedMs: number;
  models: { embedding: string; rerank: string; chat: string | null };
  metrics: Record<Baseline, QualityMetrics>;
  timingsMs: {
    prepare: number;
    indexEmbedding: number;
    indexWrite: number;
    queryEmbedding: number;
  };
  questions: QuestionResult[];
  requests: ProviderRequest[];
  answer: {
    questionId: string;
    model: string;
    text: string;
    citationNumbers: number[];
    latencyMs: number;
  } | null;
};
const usageSchema = z.object({
  usage: z
    .object({
      prompt_tokens: z.number().finite().nonnegative().optional(),
      completion_tokens: z.number().finite().nonnegative().optional(),
      total_tokens: z.number().finite().nonnegative().optional(),
      cost: z.number().finite().nonnegative().optional(),
    })
    .optional(),
  meta: z
    .object({
      billed_units: z
        .object({ search_units: z.number().finite().nonnegative().optional() })
        .optional(),
    })
    .optional(),
});
function usageFrom(value: unknown): ProviderRequest["usage"] {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success || (!parsed.data.usage && !parsed.data.meta?.billed_units)) return null;
  const usage = parsed.data.usage;
  return {
    promptTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    totalTokens: usage?.total_tokens ?? null,
    searchUnits: parsed.data.meta?.billed_units?.search_units ?? null,
    costUsd: usage?.cost ?? null,
  };
}
class RequestBudget {
  count = 0;
  exceeded = false;
  constructor(readonly max: number) {}
  consume(): void {
    if (this.count >= this.max) {
      this.exceeded = true;
      throw new EvaluationFailure("BUDGET_EXCEEDED");
    }
    this.count++;
  }
}
function embeddingBatches(texts: string[]): number {
  const counter = large3TokenCounter();
  let batches = 0,
    size = 0,
    tokens = 0;
  for (const text of texts) {
    const count = counter.count(text);
    if (count > 8192) throw new EvaluationFailure("CONFIG");
    if (size && (size >= 16 || tokens + count > 8192)) {
      batches++;
      size = 0;
      tokens = 0;
    }
    size++;
    tokens += count;
  }
  return batches + (size ? 1 : 0);
}
const ranking = (candidates: EvaluationCandidate[]) => [
  ...new Set(candidates.map((candidate) => candidate.documentKey)),
];
function combine(
  keyword: EvaluationCandidate[],
  vector: EvaluationCandidate[],
): EvaluationCandidate[] {
  return fuseRankedCandidates(
    {
      keyword: keyword.map((item, index) => ({ id: item.id, item, rank: index + 1 })),
      vector: vector.map((item, index) => ({ id: item.id, item, rank: index + 1 })),
    },
    { keywordWeight: 0.5, limit: 50 },
  ).map((item) => item.item);
}

export async function runEvaluation(
  config: EvaluationConfig,
  deps: {
    store: EvaluationStore;
    fetch?: typeof fetch;
    now?: () => Date;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<EvaluationReport> {
  const started = performance.now();
  const scope = deadline(
    deps.signal ?? new AbortController().signal,
    deps.timeoutMs ?? 180_000,
    "合成评估",
  );
  const context = { ownerId: "synthetic-eval", signal: scope.signal };
  const budget = new RequestBudget(config.requestBudget);
  const requests: ProviderRequest[] = [];
  const fetcher = deps.fetch ?? fetch;
  const telemetry: Promise<void>[] = [];
  let stage: "STORE_FAILED" | "PROVIDER_FAILED" = "STORE_FAILED";
  const measured = async <T>(action: () => Promise<T>): Promise<{ value: T; ms: number }> => {
    const start = performance.now();
    const value = await scope.wait(action);
    return { value, ms: performance.now() - start };
  };
  const trackedFetch =
    (provider: ProviderRequest["provider"], requestStage: Stage, consume = false): typeof fetch =>
    async (input, init) => {
      if (consume) budget.consume();
      const record: ProviderRequest = {
        provider,
        stage: requestStage,
        status: null,
        latencyMs: 0,
        usage: null,
      };
      requests.push(record);
      const start = performance.now();
      try {
        const response = await scope.wait(() => fetcher(input, init));
        record.status = response.status;
        if (requestStage === "answer")
          telemetry.push(
            response
              .clone()
              .text()
              .then((body) => {
                for (const line of body.split(/\r?\n/)) {
                  if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
                  try {
                    record.usage = usageFrom(JSON.parse(line.slice(6))) ?? record.usage;
                  } catch {
                    /* Ignore non-JSON SSE control frames. */
                  }
                }
              })
              .catch(() => undefined),
          );
        else
          telemetry.push(
            response
              .clone()
              .json()
              .then((body: unknown) => {
                record.usage = usageFrom(body);
              })
              .catch(() => undefined),
          );
        return response;
      } finally {
        record.latencyMs = performance.now() - start;
      }
    };
  try {
    const selected = questions.slice(0, config.questionCount);
    if (!selected.length || selected.length !== config.questionCount)
      throw new EvaluationFailure("CONFIG");
    const prepared = await measured(() => deps.store.prepare(context));
    const texts = prepared.value;
    if (!texts.length || texts.some((text) => typeof text !== "string"))
      throw new EvaluationFailure("STORE_FAILED");
    const planned =
      embeddingBatches(texts) +
      embeddingBatches(selected.map((question) => question.query)) +
      selected.length +
      (config.chatModel ? 2 : 0);
    if (planned > config.requestBudget) throw new EvaluationFailure("BUDGET_EXCEEDED");
    stage = "PROVIDER_FAILED";
    const indexEmbedder = new OpenRouterEmbeddings({
      apiKey: config.openRouterKey,
      dimensions: config.dimensions,
      maxRetries: config.maxRetries,
      beforeRequest: () => budget.consume(),
      fetch: trackedFetch("openrouter", "index-embedding"),
    });
    const indexed = await measured(() => indexEmbedder.embedDocuments(texts, scope.signal));
    stage = "STORE_FAILED";
    const written = await measured(() => deps.store.index(indexed.value, context));
    stage = "PROVIDER_FAILED";
    const queryEmbedder = new OpenRouterEmbeddings({
      apiKey: config.openRouterKey,
      dimensions: config.dimensions,
      maxRetries: config.maxRetries,
      beforeRequest: () => budget.consume(),
      fetch: trackedFetch("openrouter", "query-embedding"),
    });
    const embedded = await measured(() =>
      queryEmbedder.embedDocuments(
        selected.map((question) => question.query),
        scope.signal,
      ),
    );
    const reranker = createCohereReranker({
      maxRetries: config.maxRetries,
      beforeRequest: () => budget.consume(),
      fetch: trackedFetch("cohere", "rerank"),
    });
    const rows: QuestionResult[] = [];
    let answerSources: AssistantSource[] = [];
    for (const [index, question] of selected.entries()) {
      stage = "STORE_FAILED";
      const recalled = await scope.wait(() =>
        deps.store.recall({ question, embedding: embedded.value[index] }, context),
      );
      const fusionStart = performance.now();
      const fused = combine(recalled.keyword, recalled.vector);
      const fusionMs = performance.now() - fusionStart;
      stage = "PROVIDER_FAILED";
      const reranked = await measured(() =>
        fused.length
          ? reranker.rerank({
              query: question.query,
              documents: fused.map(
                (item) => `${item.source.title}\n${item.tags.join(", ")}\n${item.source.content}`,
              ),
              topN: Math.min(20, fused.length),
              key: config.cohereKey,
              signal: scope.signal,
            })
          : Promise.resolve({ results: [] }),
      );
      const ranked = reranked.value.results.map((result) => fused[result.index]);
      if (!index) answerSources = ranked.map((item) => item.source);
      const rankings = {
        keyword: ranking(recalled.keyword),
        vector: ranking(recalled.vector),
        rrf: ranking(fused),
        reranked: ranking(ranked),
      };
      const expectedNoAnswer = !Object.values(question.relevant).some((grade) => grade > 0);
      const quality = (order: string[]) =>
        expectedNoAnswer ? null : qualityMetrics(order, question.relevant);
      rows.push({
        id: question.id,
        language: question.language,
        kind: question.kind,
        expectedNoAnswer,
        rankings,
        metrics: {
          keyword: quality(rankings.keyword),
          vector: quality(rankings.vector),
          rrf: quality(rankings.rrf),
          reranked: quality(rankings.reranked),
        },
        timingsMs: { ...recalled.timingsMs, fusion: fusionMs, rerank: reranked.ms },
      });
    }
    let answer: EvaluationReport["answer"] = null;
    if (config.chatModel && answerSources.length) {
      const start = performance.now();
      const catalog = createProviderCatalog({
        readSecret: async () => config.openRouterKey,
        fetch: trackedFetch("openrouter", "models", true),
      });
      const model = await scope.wait(() => catalog.model(config.chatModel!, context));
      const sourceBudget = Math.min(3000, (model.contextLength ?? 6000) - 1000);
      if (sourceBudget < 1) throw new EvaluationFailure("CONFIG");
      const sources = selectContext(
        answerSources,
        { tokenBudget: sourceBudget, maxChunks: 3, maxChunksPerDocument: 2 },
        large3TokenCounter(),
      ).chunks;
      if (!sources.length) throw new EvaluationFailure("CONFIG");
      const stream = createChatStream({
        fetch: trackedFetch("openrouter", "answer"),
        beforeRequest: () => budget.consume(),
      });
      const filter = citationFilter(sources.length);
      let text = "";
      for await (const delta of stream({
        question: selected[0].query,
        sources,
        model,
        generation: {
          ...DEFAULT_SETTINGS.generation,
          maxOutputTokens: Math.min(256, model.maxOutputTokens ?? 256),
        },
        key: config.openRouterKey,
        signal: scope.signal,
      })) {
        text += filter(delta);
        if (
          Buffer.byteLength(text, "utf8") > 2_097_152 ||
          large3TokenCounter().count(text) > Math.min(256, model.maxOutputTokens ?? 256)
        )
          throw new EvaluationFailure("PROVIDER_FAILED");
      }
      text += filter("", true);
      answer = {
        questionId: selected[0].id,
        model: model.id,
        text,
        citationNumbers: [
          ...new Set([...text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]))),
        ],
        latencyMs: performance.now() - start,
      };
    }
    await scope.wait(() => Promise.all(telemetry));
    const mean = (baseline: Baseline) =>
      meanQuality(
        rows
          .map((row) => row.metrics[baseline])
          .filter((value): value is QualityMetrics => value !== null),
      );
    const negatives = rows.filter((row) => row.expectedNoAnswer);
    const withCandidates = (baseline: Baseline) =>
      negatives.filter((row) => row.rankings[baseline].length > 0).length;
    return {
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      dimensions: config.dimensions,
      availableQuestions: questions.length,
      evaluatedQuestions: rows.length,
      positiveQuestions: rows.length - negatives.length,
      noAnswer: {
        questions: negatives.length,
        queriesWithCandidates: {
          keyword: withCandidates("keyword"),
          vector: withCandidates("vector"),
          rrf: withCandidates("rrf"),
          reranked: withCandidates("reranked"),
        },
      },
      corpusDocuments: corpus.length,
      corpusChunks: texts.length,
      requestBudget: config.requestBudget,
      requestCount: budget.count,
      elapsedMs: performance.now() - started,
      models: {
        embedding: "openai/text-embedding-3-large",
        rerank: "rerank-v3.5",
        chat: config.chatModel,
      },
      metrics: {
        keyword: mean("keyword"),
        vector: mean("vector"),
        rrf: mean("rrf"),
        reranked: mean("reranked"),
      },
      timingsMs: {
        prepare: prepared.ms,
        indexEmbedding: indexed.ms,
        indexWrite: written.ms,
        queryEmbedding: embedded.ms,
      },
      questions: rows,
      requests,
      answer,
    };
  } catch (error) {
    if (budget.exceeded) throw new EvaluationFailure("BUDGET_EXCEEDED");
    if (error instanceof EvaluationFailure) throw error;
    throw new EvaluationFailure(stage);
  } finally {
    scope.dispose();
  }
}
