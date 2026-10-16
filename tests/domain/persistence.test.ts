import assert from "node:assert/strict";
import test from "node:test";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import type { SqlParameter, SqlPool } from "../../electron/services/knowledge/database/ports";
import { DomainError } from "../../src/lib/domain/validation";
import type { Document, ServiceContext } from "../../src/lib/contracts";

const id = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-16T00:00:00.000Z";
const document: Document = {
  id,
  collectionId: null,
  title: "标题",
  contentMarkdown: "正文",
  tags: [],
  favorite: false,
  revision: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: null,
};
const context: ServiceContext = { ownerId: "test", signal: new AbortController().signal };

function fixture(
  options: { current?: Document | null; collectionExists?: boolean; hookFails?: boolean } = {},
) {
  const calls: Array<{ sql: string; values: readonly SqlParameter[] }> = [];
  const indexed: Document[] = [];
  let released = false;
  const pool: SqlPool = {
    connect: async () => ({
      async query<Row extends object>(sql: string, values: readonly SqlParameter[] = []) {
        calls.push({ sql, values });
        let rows: object[] = [];
        if (sql.includes("FROM documents") && sql.includes("FOR UPDATE"))
          rows = options.current === null ? [] : [options.current ?? document];
        if (sql.startsWith("SELECT id FROM collections"))
          rows = options.collectionExists === false ? [] : [{ id }];
        if (sql.startsWith("INSERT INTO documents"))
          rows = [
            {
              ...document,
              id: values[0],
              collectionId: values[1],
              title: values[2],
              contentMarkdown: values[3],
              tags: values[4],
            },
          ];
        if (sql.startsWith("UPDATE documents")) rows = [{ ...document, revision: 2 }];
        return { rows: rows as Row[], rowCount: rows.length };
      },
      release() {
        released = true;
      },
    }),
  };
  const service = createPersistence({
    pool,
    createId: () => id,
    now: () => new Date(timestamp),
    async onRevision(_connection, value) {
      indexed.push(value);
      if (options.hookFails) throw new Error("index failure contains private body");
    },
  });
  return { service, calls, indexed, released: () => released };
}

test("保存先规范化输入，参数化正文，并在提交前写入当前 revision 的派生数据", async () => {
  const db = fixture();
  const body = "'); DROP TABLE documents; --\n私人正文";
  const saved = await db.service.documents.save(
    {
      draft: {
        title: " 标题 ",
        contentMarkdown: body,
        collectionId: null,
        tags: [" 标签 ", "标签"],
      },
    },
    context,
  );
  assert.equal(saved.title, "标题");
  assert.equal(saved.contentMarkdown, body);
  assert.deepEqual(saved.tags, ["标签"]);
  assert.equal(db.indexed[0], saved);
  assert.equal(db.calls.at(-1)!.sql, "COMMIT");
  assert.ok(db.calls.every((call) => !call.sql.includes(body)));
  assert.equal(db.released(), true);
});

test("并发 revision 冲突或已删除文档不能覆盖，且不写入索引", async () => {
  for (const current of [
    { ...document, revision: 2 },
    { ...document, deletedAt: timestamp },
  ]) {
    const db = fixture({ current });
    await assert.rejects(
      db.service.documents.save(
        {
          draft: { title: "新标题", contentMarkdown: "新正文", collectionId: null, tags: [] },
          existing: { id, expectedRevision: 1 },
        },
        context,
      ),
      DomainError,
    );
    assert.equal(db.indexed.length, 0);
    assert.ok(db.calls.every((call) => !call.sql.startsWith("UPDATE documents")));
    assert.equal(db.calls.at(-1)!.sql, "ROLLBACK");
  }
});

test("派生数据失败时整个保存回滚，错误不泄漏原文", async () => {
  const db = fixture({ hookFails: true });
  await assert.rejects(
    db.service.documents.save(
      { draft: { title: "标题", contentMarkdown: "正文", collectionId: null, tags: [] } },
      context,
    ),
    (error: unknown) => error instanceof DomainError && !error.message.includes("private body"),
  );
  assert.equal(db.calls.at(-1)!.sql, "ROLLBACK");
  assert.ok(db.calls.every((call) => call.sql !== "COMMIT"));
  assert.equal(db.released(), true);
});

test("不存在的分类和无效输入在写入前失败", async () => {
  const db = fixture({ collectionExists: false });
  await assert.rejects(
    db.service.documents.save(
      { draft: { title: "标题", contentMarkdown: "正文", collectionId: id, tags: [] } },
      context,
    ),
    (error: unknown) => error instanceof DomainError && error.field === "collectionId",
  );
  assert.ok(db.calls.every((call) => !call.sql.startsWith("INSERT INTO documents")));
  const invalid = fixture();
  await assert.rejects(
    invalid.service.documents.save(
      { draft: { title: " ", contentMarkdown: "正文", collectionId: null, tags: [] } },
      context,
    ),
    DomainError,
  );
  assert.equal(invalid.calls.length, 0);
});
