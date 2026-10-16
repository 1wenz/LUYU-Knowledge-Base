import assert from "node:assert/strict";
import test from "node:test";
import { createCohereReranker } from "../../electron/services/knowledge/providers/cohere";
import { DomainError } from "../../src/lib/domain/validation";

const signal = new AbortController().signal;
const input = {
  query: "合成问题",
  documents: ["标题一\n标签\n合成内容一", "标题二\n标签\n合成内容二"],
  topN: 1,
  key: "synthetic-key",
  signal,
};
const good = { results: [{ index: 1, relevance_score: 0.8 }] };

test("Cohere 请求固定使用 v2/rerank、rerank-v3.5 和真实 top_n", async () => {
  let requests = 0;
  const adapter = createCohereReranker({
    fetch: async (url, init) => {
      requests++;
      assert.equal(url, "https://api.cohere.com/v2/rerank");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-key");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "rerank-v3.5",
        query: input.query,
        documents: input.documents,
        top_n: 1,
      });
      return Response.json(good);
    },
  });
  assert.deepEqual(await adapter.rerank(input), good);
  assert.equal(requests, 1);
  assert.deepEqual(await adapter.rerank({ ...input, documents: [], topN: 0 }), { results: [] });
  assert.equal(requests, 1);
});

test("401 不重试且错误不携带 API key 或 provider body", async () => {
  let requests = 0;
  const adapter = createCohereReranker({
    fetch: async () => {
      requests++;
      return new Response("synthetic-private-error synthetic-key", { status: 401 });
    },
  });
  await assert.rejects(
    adapter.rerank(input),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "PROVIDER_AUTH" &&
      !error.message.includes("synthetic"),
  );
  assert.equal(requests, 1);
});

test("429/短暂 5xx 最多重试两次，每次真实请求计入预算", async () => {
  let requests = 0;
  let budget = 0;
  const adapter = createCohereReranker({
    beforeRequest: () => {
      budget++;
    },
    sleep: async () => {},
    random: () => 0,
    fetch: async () => {
      requests++;
      return requests === 1
        ? new Response(null, { status: 429 })
        : requests === 2
          ? new Response(null, { status: 503 })
          : Response.json(good);
    },
  });
  assert.deepEqual(await adapter.rerank(input), good);
  assert.equal(requests, 3);
  assert.equal(budget, 3);
  let failures = 0;
  const limited = createCohereReranker({
    sleep: async () => {},
    fetch: async () => {
      failures++;
      return new Response(null, { status: 429 });
    },
  });
  await assert.rejects(
    limited.rerank(input),
    (error: unknown) => error instanceof DomainError && error.code === "PROVIDER_LIMIT",
  );
  assert.equal(failures, 3);
});

test("取消、超时和畸形 index 分别返回受控错误", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  let requests = 0;
  const noRequest = createCohereReranker({
    fetch: async () => {
      requests++;
      return Response.json(good);
    },
  });
  await assert.rejects(
    noRequest.rerank({ ...input, signal: cancelled.signal }),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
  assert.equal(requests, 0);
  const hanging = createCohereReranker({
    timeoutMs: 5,
    maxRetries: 0,
    fetch: async () => new Promise(() => {}),
  });
  await assert.rejects(
    hanging.rerank(input),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
  const invalid = createCohereReranker({
    fetch: async () => Response.json({ results: [{ index: 100, relevance_score: 0.5 }] }),
  });
  await assert.rejects(
    invalid.rerank(input),
    (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_MISMATCH",
  );
});

test("总预算覆盖响应体与退避等待，正在等待时也能取消", async () => {
  const body = createCohereReranker({
    timeoutMs: 5,
    fetch: async () => ({ ok: true, json: async () => new Promise(() => {}) }) as Response,
  });
  await assert.rejects(
    body.rerank(input),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
  let requests = 0;
  const backoff = createCohereReranker({
    timeoutMs: 5,
    fetch: async () => {
      requests++;
      return new Response(null, { status: 429 });
    },
    sleep: async () => new Promise(() => {}),
  });
  await assert.rejects(
    backoff.rerank(input),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
  assert.equal(requests, 1);
  const cancelled = new AbortController();
  const waiting = createCohereReranker({
    fetch: async () => {
      cancelled.abort();
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    waiting.rerank({ ...input, signal: cancelled.signal }),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
});
