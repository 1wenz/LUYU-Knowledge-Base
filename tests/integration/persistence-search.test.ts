import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type ServiceContext } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import { applyMigrations } from "../../electron/services/knowledge/database/migrations";
import { inTransaction } from "../../electron/services/knowledge/database/transactions";
import { createRevisionIndexer } from "../../electron/services/knowledge/indexing/writer";
import { createPostgresRetrieval } from "../../electron/services/knowledge/retrieval/postgres";
import {
  large3TokenCounter,
  TOKENIZER_VERSION,
} from "../../electron/services/knowledge/providers/tokenizer";
import { testMigrations, withTestDatabase } from "./database-fixture";
import type { SqlPool, SqlParameter } from "../../electron/services/knowledge/database/ports";
import { createPostgresPool } from "../../electron/services/knowledge/database/postgres";

const context: ServiceContext = { ownerId: "integration", signal: new AbortController().signal };
const draft = {
  title: "中文知识库架构",
  contentMarkdown: "# 语义检索\n\n中文知识库使用 PostgreSQL 保存合成笔记。\n字面 100%_ 匹配。",
  tags: ["技术"],
  collectionId: null,
};
const setup = (pool: Parameters<typeof createPostgresRetrieval>[0]) => {
  const indexer = createRevisionIndexer({
    getSettings: () => DEFAULT_SETTINGS,
    createId: randomUUID,
    counter: large3TokenCounter(),
    tokenizerVersion: TOKENIZER_VERSION,
  });
  return {
    indexer,
    persistence: createPersistence({
      pool,
      createId: randomUUID,
      now: () => new Date(),
      onRevision: indexer.onRevision,
    }),
    recall: createPostgresRetrieval(pool),
  };
};

test("生产 pg adapter 在指定 schema 建池，使用注入密码并可重复关闭", async () =>
  withTestDatabase(async (_pool, schema) => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    const pool = createPostgresPool(
      {
        host: url.hostname,
        port: Number(url.port || 5432),
        user: decodeURIComponent(url.username),
        database: url.pathname.slice(1),
        sslMode: "disable",
      },
      decodeURIComponent(url.password),
      { info() {}, warn() {}, error() {} },
      schema,
    );
    try {
      const connection = await pool.connect();
      try {
        assert.equal(
          (await connection.query<{ schema: string }>("SELECT current_schema() AS schema")).rows[0]
            .schema,
          schema,
        );
      } finally {
        connection.release();
      }
    } finally {
      await pool.close();
      await pool.close();
    }
    await assert.rejects(pool.connect(), DomainError);
  }));

test("真实迁移/事务仓储：保存即 FTS 可搜，revision/收藏/分类/软删除/导入一致", async () =>
  withTestDatabase(async (pool, schema) => {
    await applyMigrations(pool, await testMigrations(), { schema });
    const { persistence, recall } = setup(pool);
    assert.equal((await persistence.collections.list(context)).length, 3);
    assert.equal(
      (await persistence.documents.list({ view: "all", offset: 0, limit: 20 }, context)).total,
      0,
    );
    let document = await persistence.documents.save({ draft }, context);
    const profile = (await recall.activeProfile(context))!;
    assert.equal(profile.vectorReady, false);
    const keyword = (query: string, filters = {}) =>
      recall.keyword({ query, profile, filters, limit: 40 }, context);
    assert.equal((await keyword("中文知识库"))[0].documentId, document.id);
    assert.equal((await keyword("知"))[0].documentId, document.id);
    assert.equal((await keyword("100%_"))[0].documentId, document.id);
    assert.deepEqual(await keyword("中文知识库", { favoriteOnly: true }), []);
    assert.deepEqual(await keyword("中文知识库", { tags: ["不存在"] }), []);
    const prior = await keyword("中文知识库");
    document = await persistence.documents.setFavorite(
      { id: document.id, expectedRevision: document.revision, favorite: true },
      context,
    );
    assert.equal((await keyword("中文知识库", { favoriteOnly: true })).length, 1);
    assert.deepEqual(await recall.currentChunkIds(prior, {}, context), []);
    await assert.rejects(
      persistence.documents.save(
        { draft, existing: { id: document.id, expectedRevision: 1 } },
        context,
      ),
      (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
    );
    document = await persistence.documents.remove(
      { id: document.id, expectedRevision: document.revision },
      context,
    );
    assert.deepEqual(await keyword("中文知识库"), []);
    document = await persistence.documents.restore(
      { id: document.id, expectedRevision: document.revision },
      context,
    );
    assert.equal((await keyword("中文知识库")).length, 1);
    const request = {
      sourceFingerprint: "synthetic-integration-v1",
      items: [{ sourceId: "one", draft: { ...draft, title: "导入来源" } }],
    };
    const imported = await persistence.documents.import(request, context);
    const repeated = await persistence.documents.import(request, context);
    assert.equal(imported.imported, 1);
    assert.equal(repeated.imported, 0);
    assert.deepEqual(imported.documentIds, repeated.documentIds);
    const failing = createPersistence({
      pool,
      createId: randomUUID,
      now: () => new Date(),
      onRevision: async () => {
        throw new Error("synthetic private detail");
      },
    });
    await assert.rejects(
      failing.documents.save({ draft: { ...draft, title: "应回滚" } }, context),
      DomainError,
    );
    assert.equal(
      (await persistence.documents.list({ view: "all", offset: 0, limit: 20 }, context)).total,
      2,
    );
  }));

test("真实 3072 halfvec 召回后用 float32 排序，过滤与 revision 不泄漏", async () =>
  withTestDatabase(async (pool) => {
    const { persistence } = setup(pool);
    let executed: { sql: string; values: readonly SqlParameter[] } | undefined;
    const traced: SqlPool = {
      connect: async () => {
        const connection = await pool.connect();
        return {
          release: (destroy) => connection.release(destroy),
          query: async <Row extends object>(sql: string, values: readonly SqlParameter[] = []) => {
            if (sql.includes("WITH ann AS MATERIALIZED")) executed = { sql, values };
            return connection.query<Row>(sql, values);
          },
        };
      },
    };
    const recall = createPostgresRetrieval(traced);
    const first = await persistence.documents.save({ draft }, context);
    const second = await persistence.documents.save(
      { draft: { ...draft, title: "另一合成笔记", tags: ["其他"] } },
      context,
    );
    const profile = (await recall.activeProfile(context))!;
    const embedding = (coordinate: number) =>
      Array.from({ length: 3072 }, (_, i) => (i === coordinate ? 1 : 0));
    await inTransaction(pool, context, async (connection) => {
      for (const [document, coordinate] of [
        [first, 0],
        [second, 1],
      ] as const) {
        await connection.query(
          `INSERT INTO chunk_embeddings (chunk_id, generation_id, model, dimensions, embedding, cache_key)
        SELECT id, generation_id, $2, 3072, $3::public.vector, $4 FROM document_chunks WHERE document_id = $1 AND document_revision = 1`,
          [document.id, profile.model, JSON.stringify(embedding(coordinate)), "synthetic-cache"],
        );
      }
    });
    const query = {
      query: "合成问题",
      profile,
      embedding: embedding(0),
      limit: 40,
      oversample: 80,
    };
    const result = await recall.vector(query, context);
    assert.equal(result[0].documentId, first.id);
    assert.equal(result[0].vectorCosine, 1);
    await inTransaction(pool, context, async (connection) => {
      // A tiny fixture normally favors an exact scan; this proves the actual production query can use HNSW.
      await connection.query("SET LOCAL enable_seqscan = off");
      await connection.query("SET LOCAL enable_sort = off");
      const plan = await connection.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${executed!.sql}`,
        executed!.values,
      );
      assert.match(JSON.stringify(plan.rows), /chunk_embeddings_hnsw_3072/);
    });
    assert.equal(
      (await recall.vector({ ...query, filters: { tags: ["其他"] } }, context))[0].documentId,
      second.id,
    );
    await persistence.documents.remove({ id: first.id, expectedRevision: first.revision }, context);
    assert.ok((await recall.vector(query, context)).every((item) => item.documentId !== first.id));
  }));
