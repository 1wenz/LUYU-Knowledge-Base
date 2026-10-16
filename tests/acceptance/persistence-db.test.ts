import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { applyMigrations } from "../../electron/services/knowledge/database/migrations";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import type { SqlParameter, SqlPool } from "../../electron/services/knowledge/database/ports";
import type { DocumentDraft, ServiceContext } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { withOwnedTestSchema } from "../integration/test-schema";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("真实仓储验收需要显式的专用 TEST_DATABASE_URL。");

function adapter(pool: Pool): SqlPool {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends object>(sql: string, values: readonly SqlParameter[] = []) {
          const result = await client.query<Row>(sql, [...values]);
          return { rows: result.rows, rowCount: result.rowCount };
        },
        release: (discard?: boolean) => client.release(discard),
      };
    },
  };
}

const draft = (title: string, contentMarkdown = "中文正文\n第二行"): DocumentDraft => ({
  title,
  contentMarkdown,
  collectionId: null,
  tags: ["检索"],
});
const context: ServiceContext = {
  ownerId: "database-acceptance",
  signal: new AbortController().signal,
};
const hasCode = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.code === code;

test("真实 PostgreSQL 仓储的并发、回收站、去重导入与事务回滚", { timeout: 30_000 }, async (t) => {
  const admin = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000 });
  try {
    await withOwnedTestSchema(adapter(admin), async (schema) => {
      const configuration = {
        connectionString,
        max: 4,
        connectionTimeoutMillis: 3000,
        options: `-c search_path=${schema},pg_catalog,public`,
      };
      const pool = new Pool(configuration);
      let failTitle: string | null = null;
      try {
        const migrations = await Promise.all(
          ["001_knowledge.sql", "002_search_indexes.sql"].map(async (name, index) => ({
            version: index + 1,
            sql: await readFile(`db/migrations/${name}`, "utf8"),
          })),
        );
        assert.deepEqual(await applyMigrations(adapter(pool), migrations, { schema }), {
          applied: [1, 2],
        });
        assert.deepEqual(await applyMigrations(adapter(pool), migrations, { schema }), {
          applied: [],
        });
        await pool.query(
          "CREATE TABLE revision_audit (document_id uuid, revision integer, PRIMARY KEY (document_id, revision))",
        );
        const repository = createPersistence({
          pool: adapter(pool),
          now: () => new Date(),
          createId: randomUUID,
          async onRevision(connection, document) {
            await connection.query("INSERT INTO revision_audit VALUES ($1, $2)", [
              document.id,
              document.revision,
            ]);
            if (document.title === failTitle) throw new Error("synthetic derived-index failure");
          },
        });
        const list = (view: "all" | "favorites" | "trash" = "all") =>
          repository.documents.list({ view, offset: 0, limit: 100 }, context);

        await t.test("不种示例文档；正文参数化；同 revision 的并发保存只有一个成功", async () => {
          assert.equal((await list()).total, 0);
          assert.equal((await repository.collections.list(context)).length, 3);
          const body = "'); DROP TABLE documents; --\n混合检索 🔍";
          const saved = await repository.documents.save(
            { draft: draft(" 初始标题 ", body) },
            context,
          );
          assert.equal(saved.title, "初始标题");
          assert.equal((await repository.documents.get(saved.id, context)).contentMarkdown, body);
          const results = await Promise.allSettled(
            ["并发甲", "并发乙"].map((title) =>
              repository.documents.save(
                {
                  draft: draft(title),
                  existing: { id: saved.id, expectedRevision: 1 },
                },
                context,
              ),
            ),
          );
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          const rejection = results.find((result) => result.status === "rejected");
          assert.ok(rejection?.status === "rejected" && hasCode("CONFLICT")(rejection.reason));
          assert.equal((await repository.documents.get(saved.id, context)).revision, 2);
          const audit = await pool.query(
            "SELECT revision FROM revision_audit WHERE document_id = $1 ORDER BY revision",
            [saved.id],
          );
          assert.deepEqual(
            audit.rows.map((row: { revision: number }) => row.revision),
            [1, 2],
          );
        });

        await t.test("收藏、软删除、恢复和分类删除保持数据库语义", async () => {
          const collection = await repository.collections.save(
            { name: "新分类", sortOrder: 3 },
            context,
          );
          const saved = await repository.documents.save(
            { draft: { ...draft("回收站测试"), collectionId: collection.id } },
            context,
          );
          const favorite = await repository.documents.setFavorite(
            { id: saved.id, expectedRevision: 1, favorite: true },
            context,
          );
          assert.equal((await list("favorites")).items[0].id, saved.id);
          const removed = await repository.documents.remove(
            { id: saved.id, expectedRevision: favorite.revision },
            context,
          );
          assert.ok(removed.deletedAt);
          assert.ok((await list()).items.every((document) => document.id !== saved.id));
          assert.equal((await list("trash")).items[0].id, saved.id);
          await assert.rejects(
            repository.documents.restore({ id: saved.id, expectedRevision: 1 }, context),
            hasCode("CONFLICT"),
          );
          const restored = await repository.documents.restore(
            { id: saved.id, expectedRevision: removed.revision },
            context,
          );
          assert.equal(restored.deletedAt, null);
          assert.equal(restored.favorite, true);
          await repository.collections.remove(collection.id, context);
          assert.equal((await repository.documents.get(saved.id, context)).collectionId, null);
          await assert.rejects(
            repository.documents.save(
              { draft: { ...draft("无效分类"), collectionId: collection.id } },
              context,
            ),
            hasCode("INVALID_INPUT"),
          );
        });

        await t.test("两个并发的相同导入只创建一批资料，并持久化来源映射", async () => {
          const input = {
            sourceFingerprint: "acceptance-import-v1",
            items: [
              { sourceId: "b", draft: draft("导入甲") },
              { sourceId: "a", draft: draft("导入乙") },
            ],
          };
          const reports = await Promise.all([
            repository.documents.import(input, context),
            repository.documents.import(input, context),
          ]);
          assert.equal(
            reports.reduce((count, report) => count + report.imported, 0),
            2,
          );
          assert.equal(
            reports.reduce((count, report) => count + report.skipped, 0),
            2,
          );
          assert.deepEqual([...reports[0].documentIds].sort(), [...reports[1].documentIds].sort());
          assert.equal(
            (await pool.query("SELECT count(*)::int AS count FROM legacy_imports")).rows[0].count,
            1,
          );
          assert.equal(
            (await pool.query("SELECT count(*)::int AS count FROM legacy_import_items")).rows[0]
              .count,
            2,
          );
        });

        await t.test("派生索引失败时，正文、审计和导入标记全部回滚", async () => {
          const before = (await list()).total;
          const auditBefore = (
            await pool.query("SELECT count(*)::int AS count FROM revision_audit")
          ).rows[0].count;
          failTitle = "触发回滚";
          await assert.rejects(
            repository.documents.save({ draft: draft(failTitle) }, context),
            hasCode("DATABASE_UNAVAILABLE"),
          );
          await assert.rejects(
            repository.documents.import(
              {
                sourceFingerprint: "must-rollback",
                items: [
                  { sourceId: "1", draft: draft("同事务先写入") },
                  { sourceId: "2", draft: draft(failTitle) },
                ],
              },
              context,
            ),
            hasCode("DATABASE_UNAVAILABLE"),
          );
          assert.equal((await list()).total, before);
          assert.equal(
            (await pool.query("SELECT count(*)::int AS count FROM revision_audit")).rows[0].count,
            auditBefore,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS count FROM legacy_imports WHERE source_fingerprint = $1",
                ["must-rollback"],
              )
            ).rows[0].count,
            0,
          );
        });

        // A second pool cannot see uncommitted in-memory state: verify persistence through a fresh connection.
        const reopened = new Pool(configuration);
        try {
          assert.equal(
            (await reopened.query("SELECT count(*)::int AS count FROM documents")).rows[0].count,
            4,
          );
        } finally {
          await reopened.end();
        }
      } finally {
        await pool.end();
      }
    });
  } finally {
    await admin.end();
  }
});
