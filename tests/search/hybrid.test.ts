import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  searchResponseSchema,
  type ServiceContext,
} from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import {
  createHybridSearch,
  type RetrievalCandidate,
  type RetrievalPorts,
} from "../../electron/services/knowledge/retrieval/hybrid";

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const candidate = (value: number): RetrievalCandidate => ({
  chunkId: id(value),
  documentId: id(value + 100),
  documentRevision: 1,
  title: `合成来源${value}`,
  content: `这是合成片段${value}`,
  tags: ["测试"],
  startLine: 1,
  endLine: 2,
  updatedAt: "2026-10-16T00:00:00.000Z",
});
const vector = Array.from({ length: 3072 }, (_, index) => (index === 0 ? 1 : 0));
const context: ServiceContext = { ownerId: "test", signal: new AbortController().signal };
const request = {
  requestId: id(999),
  query: "合成问题",
  resultCount: 2,
  filters: { tags: ["测试"], favoriteOnly: true },
};

function fixture(overrides: Partial<RetrievalPorts> = {}) {
  const calls = { rerank: 0, vector: 0, embedding: 0 };
  const ports: RetrievalPorts = {
    getSettings: () => structuredClone(DEFAULT_SETTINGS),
    activeProfile: async () => ({
      id: id(500),
      model: "openai/text-embedding-3-large",
      dimensions: 3072,
      vectorReady: true,
    }),
    readSecret: async () => "synthetic-placeholder",
    keyword: async () => [candidate(1), candidate(2)],
    embedQuery: async () => {
      calls.embedding++;
      return vector;
    },
    vector: async () => {
      calls.vector++;
      return [candidate(2), candidate(1)];
    },
    rerank: async () => {
      calls.rerank++;
      return {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.3 },
        ],
      };
    },
    currentChunkIds: async (candidates) => candidates.map((item) => item.chunkId),
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
  };
  return { ports, calls, search: createHybridSearch(ports) };
}

test(
  "关键词与 query embedding 并行，查询使用 active 3072 profile，过滤一致",
  { timeout: 2000 },
  async () => {
    let resolveKeyword: ((items: RetrievalCandidate[]) => void) | undefined;
    let keywordStarted = false;
    const db = fixture({
      getSettings: () => ({
        ...structuredClone(DEFAULT_SETTINGS),
        models: { ...DEFAULT_SETTINGS.models, embeddingDimensions: 1536 },
      }),
      keyword: async (input) => {
        assert.deepEqual(input.filters, request.filters);
        keywordStarted = true;
        return new Promise((resolve) => {
          resolveKeyword = resolve;
        });
      },
      embedQuery: async (_query, profile) => {
        assert.equal(keywordStarted, true);
        assert.equal(profile.dimensions, 3072);
        resolveKeyword!([candidate(1), candidate(2)]);
        return vector;
      },
      vector: async (input) => {
        assert.equal(input.profile.dimensions, 3072);
        assert.deepEqual(input.filters, request.filters);
        return [candidate(2), candidate(1)];
      },
    });
    const result = await db.search.query(request, context);
    assert.equal(result.mode, "hybrid-rerank");
    assert.equal(result.hits[0].chunkId, id(2));
    assert.equal(result.hits[0].scores.rerank, 0.9);
    assert.equal(result.generationId, id(500));
    assert.ok(searchResponseSchema.safeParse(result).success);
  },
);

test("embedding 无 key 时保持最新关键词结果，跳过向量与 Rerank", async () => {
  const db = fixture({ readSecret: async () => null });
  const result = await db.search.query(request, context);
  assert.equal(result.mode, "keyword");
  assert.equal(result.hits.length, 2);
  assert.ok(
    result.warnings.some((item) => item.stage === "embedding" && item.reason === "not-configured"),
  );
  assert.equal(db.calls.embedding + db.calls.vector + db.calls.rerank, 0);
});

test("Cohere 越界或重复 index 返回 RRF，关键词失败可返回向量", async () => {
  const invalid = fixture({
    rerank: async () => ({
      results: [
        { index: 0, relevance_score: 0.8 },
        { index: 0, relevance_score: 0.6 },
      ],
    }),
  });
  const fallback = await invalid.search.query(request, context);
  assert.equal(fallback.mode, "hybrid");
  assert.deepEqual(
    fallback.hits.map((item) => item.chunkId),
    [id(1), id(2)],
  );
  assert.ok(fallback.warnings.some((item) => item.stage === "rerank" && item.reason === "failed"));
  const vectorOnly = fixture({
    keyword: async () => {
      throw new DomainError("TIMEOUT", "synthetic timeout");
    },
  });
  const result = await vectorOnly.search.query(request, context);
  assert.equal(result.mode, "vector");
  assert.ok(result.warnings.some((item) => item.stage === "keyword" && item.reason === "timeout"));
});

test("零候选不调用 Rerank，返回前剔除变更或删除的 revision", async () => {
  const empty = fixture({ keyword: async () => [], vector: async () => [] });
  assert.deepEqual((await empty.search.query(request, context)).hits, []);
  assert.equal(empty.calls.rerank, 0);
  let validationCount = 0;
  const stale = fixture({
    currentChunkIds: async (candidates) =>
      ++validationCount === 1 ? candidates.map((item) => item.chunkId) : [id(1)],
  });
  const response = await stale.search.query(request, context);
  assert.deepEqual(
    response.hits.map((item) => item.chunkId),
    [id(1)],
  );
});

test("取消与总时间预算不返回降级成功，即使 provider 忽略 signal", async () => {
  const cancelled = new AbortController();
  const db = fixture({
    keyword: async () => {
      cancelled.abort();
      return [];
    },
  });
  await assert.rejects(
    db.search.query(request, { ...context, signal: cancelled.signal }),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
  const hanging = fixture({ embedQuery: () => new Promise(() => {}) });
  await assert.rejects(
    createHybridSearch(hanging.ports, { budgetMs: 10 }).query(request, context),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
});

test("最终复核数据库失败时返回结构化错误，不能伪装空命中", async () => {
  const db = fixture({
    currentChunkIds: async () => {
      throw new DomainError("DATABASE_UNAVAILABLE", "数据库不可用");
    },
  });
  await assert.rejects(
    db.search.query(request, context),
    (error: unknown) => error instanceof DomainError && error.code === "DATABASE_UNAVAILABLE",
  );
});

test("每个阶段的 warning 不回显 provider 原文，融合后保留向量 cosine", async () => {
  const db = fixture({
    keyword: async () => {
      throw new DomainError("PROVIDER_AUTH", "synthetic-private-response");
    },
    vector: async () => [{ ...candidate(1), vectorCosine: 0.75 }],
  });
  const result = await db.search.query(request, context);
  assert.equal(result.hits[0].scores.vectorCosine, 0.75);
  assert.ok(!JSON.stringify(result.warnings).includes("synthetic-private-response"));
});

test("融合最多向 Cohere 发送 50 个候选，索引待完成不发起 embedding", async () => {
  let sent = 0;
  const capped = fixture({
    getSettings: () => ({
      ...structuredClone(DEFAULT_SETTINGS),
      retrieval: { ...DEFAULT_SETTINGS.retrieval, rerankCandidates: 100 },
    }),
    keyword: async () => Array.from({ length: 40 }, (_, index) => candidate(index + 1)),
    vector: async () => Array.from({ length: 40 }, (_, index) => candidate(index + 41)),
    rerank: async (input) => {
      sent = input.documents.length;
      return {
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.8 },
        ],
      };
    },
  });
  assert.equal((await capped.search.query(request, context)).hits.length, 2);
  assert.equal(sent, 50);
  const pending = fixture({
    activeProfile: async () => ({
      id: id(500),
      model: "openai/text-embedding-3-large",
      dimensions: 3072,
      vectorReady: false,
    }),
  });
  const result = await pending.search.query(request, context);
  assert.equal(result.mode, "keyword");
  assert.ok(result.warnings.some((item) => item.reason === "index-pending"));
  assert.equal(pending.calls.embedding + pending.calls.vector + pending.calls.rerank, 0);
});
