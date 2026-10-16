import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type ServiceContext } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import { inTransaction } from "../../electron/services/knowledge/database/transactions";
import type { SqlPool } from "../../electron/services/knowledge/database/ports";
import { createRevisionIndexer } from "../../electron/services/knowledge/indexing/writer";
import {
  createEmbeddingWorker,
  type EmbedBatch,
} from "../../electron/services/knowledge/indexing/worker";
import {
  large3TokenCounter,
  TOKENIZER_VERSION,
} from "../../electron/services/knowledge/providers/tokenizer";
import { withTestDatabase } from "./database-fixture";

const context: ServiceContext = { ownerId: "worker-test", signal: new AbortController().signal };
const logger = { info() {}, warn() {}, error() {} };
const settings = {
  ...structuredClone(DEFAULT_SETTINGS),
  indexing: { chunkTokens: 200, overlapTokens: 20 },
};
const vector = (dimensions: number) =>
  Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0));
const draft = {
  title: "合成 worker",
  contentMarkdown: "合成知识资料。",
  tags: [],
  collectionId: null,
};
function fixture(pool: SqlPool, embed: EmbedBatch) {
  const writer = createRevisionIndexer({
    getSettings: () => settings,
    createId: randomUUID,
    counter: large3TokenCounter(),
    tokenizerVersion: TOKENIZER_VERSION,
  });
  return {
    documents: createPersistence({
      pool,
      createId: randomUUID,
      now: () => new Date(),
      onRevision: writer.onRevision,
    }).documents,
    worker: createEmbeddingWorker({
      pool,
      createId: randomUUID,
      readSecret: async () => "synthetic-key",
      embed,
      logger,
      maxBatch: 1,
    }),
  };
}

test("真实 worker 完成向量，收藏 revision 复用配置内容缓存", async () =>
  withTestDatabase(async (pool) => {
    let requests = 0;
    const { documents, worker } = fixture(pool, async (texts, profile) => {
      requests++;
      return texts.map(() => vector(profile.dimensions));
    });
    const doc = await documents.save({ draft }, context);
    assert.equal(await worker.runOnce(context), true);
    assert.equal(await worker.runOnce(context), false);
    await documents.setFavorite(
      { id: doc.id, expectedRevision: doc.revision, favorite: true },
      context,
    );
    assert.equal(await worker.runOnce(context), true);
    assert.equal(requests, 1);
    await inTransaction(pool, context, async (connection) => {
      assert.equal(
        (
          await connection.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM chunk_embeddings",
          )
        ).rows[0].count,
        "2",
      );
      assert.equal(
        (
          await connection.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM index_jobs WHERE state = 'completed'",
          )
        ).rows[0].count,
        "2",
      );
    });
  }));

test("网络响应期间修改或删除不能写回旧 revision", async () =>
  withTestDatabase(async (pool) => {
    for (const deleted of [false, true]) {
      const { documents, worker } = fixture(pool, async (texts, profile) => {
        await mutate();
        return texts.map(() => vector(profile.dimensions));
      });
      const doc = await documents.save({ draft }, context);
      const mutate = () =>
        deleted
          ? documents.remove({ id: doc.id, expectedRevision: doc.revision }, context)
          : documents.save(
              {
                draft: { ...draft, contentMarkdown: "更新后的合成材料" },
                existing: { id: doc.id, expectedRevision: doc.revision },
              },
              context,
            );
      assert.equal(await worker.runOnce(context), true);
      await inTransaction(pool, context, async (connection) => {
        assert.equal(
          (
            await connection.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM chunk_embeddings e JOIN document_chunks c ON c.id = e.chunk_id WHERE c.document_id = $1 AND c.document_revision = 1`,
              [doc.id],
            )
          ).rows[0].count,
          "0",
        );
        // Keep this test's updated document out of the next iteration's queue.
        await connection.query(
          "UPDATE index_jobs SET state = 'obsolete', lease_token = NULL, lease_expires_at = NULL WHERE document_id = $1",
          [doc.id],
        );
      });
    }
  }));

test("部分批次成功后失败，重启只补缺失 embedding；过期租约可重新领取", async () =>
  withTestDatabase(async (pool) => {
    let calls = 0;
    const first = fixture(pool, async (texts, profile) => {
      if (++calls === 2) throw new DomainError("PROVIDER_LIMIT", "合成限流");
      return texts.map(() => vector(profile.dimensions));
    });
    const document = await first.documents.save(
      { draft: { ...draft, contentMarkdown: "中文知识资料和 English paragraph。\n\n".repeat(60) } },
      context,
    );
    await first.worker.runOnce(context);
    let remaining = 0;
    await inTransaction(pool, context, async (connection) => {
      const state = (
        await connection.query<{ state: string; error_code: string }>(
          "SELECT state, error_code FROM index_jobs WHERE document_id = $1",
          [document.id],
        )
      ).rows[0];
      assert.equal(state.state, "failed");
      assert.equal(state.error_code, "PROVIDER_LIMIT");
      remaining = Number(
        (
          await connection.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM document_chunks c WHERE document_id = $1 AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id)",
            [document.id],
          )
        ).rows[0].count,
      );
      assert.ok(remaining > 0);
      await connection.query(
        "UPDATE index_jobs SET state = 'running', lease_token = $2, lease_expires_at = now() - interval '1 second' WHERE document_id = $1",
        [document.id, randomUUID()],
      );
    });
    let recovered = 0;
    const restarted = fixture(pool, async (texts, profile) => {
      recovered += texts.length;
      return texts.map(() => vector(profile.dimensions));
    });
    await restarted.worker.runOnce(context);
    assert.equal(recovered, remaining);
    await inTransaction(pool, context, async (connection) => {
      assert.equal(
        (
          await connection.query<{ state: string }>(
            "SELECT state FROM index_jobs WHERE document_id = $1",
            [document.id],
          )
        ).rows[0].state,
        "completed",
      );
    });
  }));

test("取消释放租约为 pending，维度错误不能部分写入", async () =>
  withTestDatabase(async (pool) => {
    const abort = new AbortController();
    const cancelled = fixture(pool, async () => {
      abort.abort();
      throw new Error("provider cancellation detail");
    });
    const doc = await cancelled.documents.save({ draft }, context);
    await assert.rejects(
      cancelled.worker.runOnce({ ...context, signal: abort.signal }),
      (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
    );
    await inTransaction(pool, context, async (connection) => {
      assert.equal(
        (
          await connection.query<{ state: string }>(
            "SELECT state FROM index_jobs WHERE document_id = $1",
            [doc.id],
          )
        ).rows[0].state,
        "pending",
      );
    });
    const invalid = fixture(pool, async () => [[1, 0]]);
    await invalid.worker.runOnce(context);
    await inTransaction(pool, context, async (connection) => {
      assert.equal(
        (
          await connection.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM chunk_embeddings",
          )
        ).rows[0].count,
        "0",
      );
      assert.equal(
        (
          await connection.query<{ error_code: string }>(
            "SELECT error_code FROM index_jobs WHERE document_id = $1",
            [doc.id],
          )
        ).rows[0].error_code,
        "SCHEMA_MISMATCH",
      );
    });
  }));
