import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SETTINGS,
  type OperationContext,
  type OperationPayload,
  type PublicSettings,
  type ServiceContext,
} from "../../src/lib/contracts";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import {
  createRevisionIndexer,
  insertGeneration,
} from "../../electron/services/knowledge/indexing/writer";
import { createIndexManager } from "../../electron/services/knowledge/indexing/manager";
import {
  createEmbeddingWorker,
  type EmbedBatch,
} from "../../electron/services/knowledge/indexing/worker";
import { indexProfile } from "../../electron/services/knowledge/indexing/profile";
import { createPostgresRetrieval } from "../../electron/services/knowledge/retrieval/postgres";
import {
  large3TokenCounter,
  TOKENIZER_VERSION,
} from "../../electron/services/knowledge/providers/tokenizer";
import { inTransaction } from "../../electron/services/knowledge/database/transactions";
import { lockGenerations } from "../../electron/services/knowledge/database/index-lock";
import { DomainError } from "../../src/lib/domain/validation";
import { withTestDatabase } from "./database-fixture";
import type { SqlPool } from "../../electron/services/knowledge/database/ports";

const context: ServiceContext = {
  ownerId: "generation-test",
  signal: new AbortController().signal,
};
const vector = (dimensions: number) =>
  Array.from({ length: dimensions }, (_, index) => (index === 0 ? 1 : 0));
const draft = {
  title: "合成重建材料",
  contentMarkdown: "中文知识库用于验证跨维度重建。",
  tags: ["合成"],
  collectionId: null,
};
function fixture(pool: SqlPool) {
  let settings: PublicSettings = structuredClone(DEFAULT_SETTINGS);
  let embed: EmbedBatch = async (texts, profile) => texts.map(() => vector(profile.dimensions));
  const writer = createRevisionIndexer({
    getSettings: () => settings,
    createId: randomUUID,
    counter: large3TokenCounter(),
    tokenizerVersion: TOKENIZER_VERSION,
  });
  const worker = createEmbeddingWorker({
    pool,
    createId: randomUUID,
    readSecret: async () => "synthetic-key",
    embed: (...args) => embed(...args),
    logger: { info() {}, warn() {}, error() {} },
  });
  const manager = createIndexManager({
    pool,
    getSettings: () => settings,
    createId: randomUUID,
    tokenizerVersion: TOKENIZER_VERSION,
    writer,
    runOnce: worker.runOnce,
    readEmbeddingKey: async () => "synthetic-key",
  });
  const events: OperationPayload[] = [];
  const operation: OperationContext = {
    ...context,
    operationId: randomUUID(),
    emit: (payload) => events.push(payload),
  };
  return {
    writer,
    worker,
    manager,
    events,
    operation,
    documents: createPersistence({
      pool,
      createId: randomUUID,
      now: () => new Date(),
      onRevision: writer.onRevision,
    }).documents,
    recall: createPostgresRetrieval(pool),
    settings: () => settings,
    setSettings(value: PublicSettings) {
      settings = value;
    },
    setEmbed(value: EmbedBatch) {
      embed = value;
    },
  };
}

test("重建保留旧 active 3072，期间编辑同时排两代，完成才原子切换 1536", async () =>
  withTestDatabase(async (pool) => {
    const db = fixture(pool);
    let doc = await db.documents.save({ draft }, context);
    await db.worker.runOnce(context);
    const original = (await db.recall.activeProfile(context))!;
    db.setSettings({
      ...db.settings(),
      models: { ...db.settings().models, embeddingDimensions: 1536 },
    });
    assert.equal((await db.manager.status(context)).requiresReindex, true);
    let changed = false;
    db.setEmbed(async (texts, profile) => {
      if (!changed && profile.dimensions === 1536) {
        changed = true;
        assert.equal((await db.recall.activeProfile(context))!.id, original.id);
        assert.equal((await db.recall.activeProfile(context))!.dimensions, 3072);
        doc = await db.documents.save(
          {
            draft: { ...draft, contentMarkdown: "中文知识库更新为当前 revision。" },
            existing: { id: doc.id, expectedRevision: doc.revision },
          },
          context,
        );
      }
      return texts.map(() => vector(profile.dimensions));
    });
    await db.manager.rebuild(db.operation);
    assert.equal(changed, true);
    const active = (await db.recall.activeProfile(context))!;
    assert.notEqual(active.id, original.id);
    assert.equal(active.dimensions, 1536);
    const hits = await db.recall.keyword({ query: "当前", profile: active, limit: 40 }, context);
    assert.equal(hits[0].documentRevision, doc.revision);
    assert.equal((await db.manager.status(context)).requiresReindex, false);
    assert.ok(
      db.events.some((event) => event.type === "progress" && event.completed === event.total),
    );
    await inTransaction(pool, context, async (connection) => {
      assert.equal(
        (
          await connection.query<{ state: string }>(
            "SELECT state FROM index_generations WHERE id = $1",
            [original.id],
          )
        ).rows[0].state,
        "retired",
      );
      assert.ok(
        (
          await connection.query("SELECT chunk_id FROM chunk_embeddings WHERE generation_id = $1", [
            original.id,
          ])
        ).rows.length > 0,
      );
    });
  }));

test("取消或认证失败的重建保留旧 active 和向量", async () =>
  withTestDatabase(async (pool) => {
    const db = fixture(pool);
    await db.documents.save({ draft }, context);
    await db.worker.runOnce(context);
    const original = (await db.recall.activeProfile(context))!;
    db.setSettings({
      ...db.settings(),
      models: { ...db.settings().models, embeddingDimensions: 1536 },
    });
    const abort = new AbortController();
    db.setEmbed(async () => {
      abort.abort();
      throw new DomainError("CANCELLED", "合成取消");
    });
    await assert.rejects(
      db.manager.rebuild({ ...db.operation, signal: abort.signal }),
      DomainError,
    );
    assert.equal((await db.recall.activeProfile(context))!.id, original.id);
    db.setEmbed(async () => {
      throw new DomainError("PROVIDER_AUTH", "合成认证失败");
    });
    await assert.rejects(
      db.manager.rebuild(db.operation),
      (error: unknown) => error instanceof DomainError && error.code === "PROVIDER_AUTH",
    );
    assert.equal((await db.recall.activeProfile(context))!.id, original.id);
    assert.equal((await db.manager.status(context)).buildingGenerationId, null);
  }));

test("重启补齐 building 缺失文档，任务完成后 reconciliation 才激活", async () =>
  withTestDatabase(async (pool) => {
    const db = fixture(pool);
    await db.documents.save({ draft }, context);
    await db.worker.runOnce(context);
    db.setSettings({
      ...db.settings(),
      models: { ...db.settings().models, embeddingDimensions: 1536 },
    });
    const id = randomUUID();
    await inTransaction(pool, context, async (connection) => {
      await lockGenerations(connection, true);
      await insertGeneration(
        connection,
        id,
        indexProfile(db.settings(), TOKENIZER_VERSION),
        "building",
      );
    });
    await db.manager.recover(context);
    assert.notEqual((await db.recall.activeProfile(context))!.id, id);
    await db.worker.runOnce(context);
    await db.manager.recover(context);
    assert.equal((await db.recall.activeProfile(context))!.id, id);
  }));
