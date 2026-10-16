import assert from "node:assert/strict";
import test from "node:test";
import { createProviderCatalog } from "../../electron/services/knowledge/providers/catalog";
import { DomainError } from "../../src/lib/domain/validation";

const context = () => ({ ownerId: "synthetic", signal: new AbortController().signal });
const code = (expected: string) => (error: unknown) =>
  error instanceof DomainError && error.code === expected;

test("模型目录保留未知能力、复制缓存并在返回缓存前检查取消", async () => {
  let calls = 0;
  const catalog = createProviderCatalog({
    readSecret: async () => null,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://openrouter.ai/api/v1/models");
      assert.equal(init?.headers, undefined);
      return Response.json({
        data: [
          { id: "synthetic/unknown", name: "未知" },
          {
            id: "synthetic/known",
            name: "已知",
            context_length: 32000,
            top_provider: { max_completion_tokens: 2048 },
            supported_parameters: ["temperature"],
          },
        ],
      });
    },
  });
  const models = await catalog.list(context());
  assert.deepEqual(models[0], {
    id: "synthetic/unknown",
    name: "未知",
    contextLength: null,
    maxOutputTokens: null,
    supportsTemperature: null,
  });
  models[0].name = "修改副本";
  assert.equal((await catalog.list(context()))[0].name, "未知");
  assert.equal((await catalog.model("synthetic/known", context())).supportsTemperature, true);
  assert.equal(calls, 1);
  await assert.rejects(catalog.model("synthetic/missing", context()), code("MODEL_UNSUPPORTED"));
  const cancelled = AbortSignal.abort();
  await assert.rejects(catalog.list({ ...context(), signal: cancelled }), code("CANCELLED"));
  catalog.clear();
  await catalog.list(context());
  assert.equal(calls, 2);
});

test("连接测试使用免费鉴权端点，缺 key 不请求，不返回 provider 原文", async () => {
  const urls: string[] = [];
  const catalog = createProviderCatalog({
    readSecret: async () => "synthetic-key",
    fetch: async (url, init) => {
      urls.push(String(url));
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-key");
      if (String(url).includes("cohere")) {
        assert.equal(init?.method, "POST");
        assert.equal(init?.body, "{}");
        return Response.json({ valid: true, private: "synthetic-key" });
      }
      return Response.json({ data: { private: "synthetic-key" } });
    },
  });
  for (const target of ["openrouter", "cohere"] as const) {
    const report = await catalog.test(target, context());
    assert.equal(report.ok, true);
    assert.equal(JSON.stringify(report).includes("synthetic-key"), false);
  }
  assert.deepEqual(urls, [
    "https://openrouter.ai/api/v1/key",
    "https://api.cohere.com/v1/check-api-key",
  ]);
  const missing = createProviderCatalog({
    readSecret: async () => null,
    fetch: async () => assert.fail("no key"),
  });
  await assert.rejects(missing.test("openrouter", context()), code("CONFIG_REQUIRED"));
});

test("目录与鉴权响应严格验证，网络错误与认证失败脱敏且不重试", async () => {
  let calls = 0;
  const catalog = createProviderCatalog({
    readSecret: async () => "synthetic-key",
    fetch: async () => {
      calls++;
      return new Response("synthetic-key", { status: 401 });
    },
  });
  await assert.rejects(catalog.test("cohere", context()), code("PROVIDER_AUTH"));
  assert.equal(calls, 1);
  const invalid = createProviderCatalog({
    readSecret: async () => "synthetic-key",
    fetch: async () => Response.json({ data: [{ id: "bad" }] }),
  });
  await assert.rejects(invalid.list(context()), code("SCHEMA_MISMATCH"));
  const rejected = createProviderCatalog({
    readSecret: async () => "synthetic-key",
    fetch: async () => Response.json({ valid: false }),
  });
  await assert.rejects(rejected.test("cohere", context()), code("PROVIDER_AUTH"));
  const network = createProviderCatalog({
    readSecret: async () => "synthetic-key",
    fetch: async () => {
      throw new Error("synthetic-key");
    },
  });
  await assert.rejects(
    network.list(context()),
    (error: unknown) => error instanceof DomainError && !error.message.includes("synthetic"),
  );
});
