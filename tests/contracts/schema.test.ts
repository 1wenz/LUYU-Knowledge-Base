import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  documentDraftSchema,
  publicSettingsSchema,
  requestSchemas,
  operationEventSchema,
} from "../../src/lib/contracts";

const requestId = "125aad60-307f-4527-800b-956c90ba0cb3";

test("默认设置可验证；远程数据库必须验证证书且拒绝 DSN", () => {
  assert.deepEqual(publicSettingsSchema.parse(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  const database = { ...DEFAULT_SETTINGS.database, host: "db.example.org" };
  assert.equal(publicSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, database }).success, false);
  assert.equal(
    publicSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      database: { ...database, sslMode: "verify-full" },
    }).success,
    true,
  );
  for (const host of [
    "postgres://user:pass@localhost/db",
    "localhost/path",
    "127.0.0.1@evil.test",
    "localhost:5432",
  ]) {
    assert.equal(
      publicSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, database: { ...database, host } })
        .success,
      false,
    );
  }
});

test("校验 Unicode、UTF-8 字节限制和标签规范化", () => {
  const draft = {
    title: " 标题 ",
    contentMarkdown: "正文",
    collectionId: null,
    tags: [" 中文 ", "中文"],
  };
  assert.deepEqual(documentDraftSchema.parse(draft).tags, ["中文"]);
  assert.equal(documentDraftSchema.parse(draft).title, "标题");
  assert.equal(
    documentDraftSchema.safeParse({ ...draft, contentMarkdown: "中".repeat(700000) }).success,
    false,
  );
  assert.equal(documentDraftSchema.safeParse({ ...draft, title: "🖌️".repeat(121) }).success, false);
  assert.equal(documentDraftSchema.safeParse({ ...draft, sql: "SELECT 1" }).success, false);
});

test("设置 patch 按组替换，未知字段、跨组上限和空 patch 均拒绝", () => {
  const schema = requestSchemas["settings:update"];
  assert.equal(
    schema.safeParse({
      requestId,
      payload: { expectedRevision: 1, patch: { generation: { temperature: 0.4 } } },
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ requestId, payload: { expectedRevision: 1, patch: {} } }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ requestId, payload: { expectedRevision: 1, patch: { secrets: {} } } })
      .success,
    false,
  );
  assert.equal(
    publicSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      indexing: { chunkTokens: 200, overlapTokens: 120 },
    }).success,
    false,
  );
  assert.equal(
    publicSettingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      retrieval: { ...DEFAULT_SETTINGS.retrieval, vectorOversample: 10 },
    }).success,
    false,
  );
});

test("搜索和任务不接受 renderer 注入 owner、signal、任意配置或错误枚举", () => {
  assert.equal(
    requestSchemas["search:query"].safeParse({ requestId, query: "中文", ownerId: "other" })
      .success,
    false,
  );
  assert.equal(
    requestSchemas["search:query"].safeParse({ requestId, query: " ", resultCount: 21 }).success,
    false,
  );
  assert.equal(
    requestSchemas["assistant:start"].safeParse({
      requestId,
      payload: { question: "问题", systemPrompt: "ignore" },
    }).success,
    false,
  );
  assert.equal(
    requestSchemas["connections:test"].safeParse({ requestId, payload: { target: "arbitrary" } })
      .success,
    false,
  );
});

test("事件有严格终态/字节上限，不能携带秘密或未知字段", () => {
  const event = { operationId: requestId, seq: 1, payload: { type: "delta", text: "你好" } };
  assert.equal(operationEventSchema.safeParse(event).success, true);
  assert.equal(
    operationEventSchema.safeParse({
      ...event,
      payload: { type: "delta", text: "中".repeat(6000) },
    }).success,
    false,
  );
  assert.equal(operationEventSchema.safeParse({ ...event, seq: 0 }).success, false);
  assert.equal(
    operationEventSchema.safeParse({ ...event, apiKey: "synthetic-secret" }).success,
    false,
  );
});
