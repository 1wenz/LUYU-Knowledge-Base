import assert from "node:assert/strict";
import test from "node:test";
import { createOpenRouterEmbeddings } from "../../electron/services/knowledge/providers/openrouter";
import { DomainError } from "../../src/lib/domain/validation";

const vector = (value: number) =>
  Array.from({ length: 3_072 }, (_, index) => (index === value ? 1 : 0));
const sleep = async () => {};

test("OpenRouter 固定模型、维度和 endpoint，乱序 data 按 index 复原", async () => {
  let calls = 0;
  const adapter = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    sleep,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://openrouter.ai/api/v1/embeddings");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-key");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "openai/text-embedding-3-large",
        input: ["a", "b"],
        dimensions: 3072,
        encoding_format: "float",
      });
      return Response.json({
        data: [
          { index: 1, embedding: vector(1) },
          { index: 0, embedding: vector(0) },
        ],
      });
    },
  });
  const result = await adapter.embedDocuments(["a", "b"]);
  assert.deepEqual(result, [vector(0), vector(1)]);
  assert.equal(calls, 1);
});

test("批次最多 16 段并发最多 2 个，429 重试计入请求预算", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  let budget = 0;
  const adapter = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    sleep,
    beforeRequest: () => {
      budget++;
    },
    fetch: async (_url, init) => {
      const requestNumber = ++calls;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (requestNumber === 1) return new Response(null, { status: 429 });
      const input = JSON.parse(String(init?.body)).input as string[];
      return Response.json({
        data: input.map((_, index) => ({ index, embedding: vector(index % 2) })),
      });
    },
    counter: { count: () => 1 },
    maxBatchTokens: 16,
  });
  const result = await adapter.embedDocuments(
    Array.from({ length: 33 }, (_, index) => String(index)),
  );
  assert.equal(result.length, 33);
  assert.ok(peak <= 2);
  assert.equal(budget, calls);
  assert.equal(calls, 4);
});

test("批次中途失败会停止其余批次，1536 维与取消不静默成功", async () => {
  let requests = 0;
  const failing = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    counter: { count: () => 1 },
    fetch: async () => {
      requests++;
      return new Response(null, { status: 401 });
    },
  });
  await assert.rejects(
    failing.embedDocuments(Array.from({ length: 80 }, () => "合成材料")),
    (error: unknown) => error instanceof DomainError && error.code === "PROVIDER_AUTH",
  );
  assert.ok(requests <= 2);
  const reduced = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 1536,
    fetch: async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).dimensions, 1536);
      return Response.json({ data: [{ index: 0, embedding: vector(0).slice(0, 1536) }] });
    },
  });
  assert.equal((await reduced.embedQuery("合成问题")).length, 1536);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    reduced.embedQuery("合成问题", abort.signal),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
});

test("认证、畸形响应和 provider 忽略 signal 的超时均返回受控错误", async () => {
  const auth = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    fetch: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(
    auth.embedQuery("q"),
    (error: unknown) => error instanceof DomainError && error.code === "PROVIDER_AUTH",
  );
  const malformed = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    fetch: async () => Response.json({ data: [{ index: 0, embedding: [1] }] }),
  });
  await assert.rejects(
    malformed.embedQuery("q"),
    (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_MISMATCH",
  );
  const hanging = createOpenRouterEmbeddings({
    apiKey: "synthetic-key",
    dimensions: 3072,
    timeoutMs: 5,
    maxRetries: 0,
    fetch: async () => new Promise(() => {}),
  });
  await assert.rejects(
    hanging.embedQuery("q"),
    (error: unknown) => error instanceof DomainError && error.code === "TIMEOUT",
  );
});
