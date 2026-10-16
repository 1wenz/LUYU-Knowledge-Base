import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEFAULT_SETTINGS,
  type PublicSettings,
  type OperationPayload,
  type KnowledgeServiceDependencies,
} from "../../src/lib/contracts";
import { createKnowledgeService } from "../../electron/services/knowledge";
import { withTestDatabase, testMigrations } from "./database-fixture";
import { DomainError } from "../../src/lib/domain/validation";

const context = () => ({ ownerId: "service-test", signal: new AbortController().signal });
const logger = { info() {}, warn() {}, error() {} };
async function until(action: () => Promise<boolean>) {
  const end = Date.now() + 10_000;
  while (!(await action())) {
    assert.ok(Date.now() < end, "background indexing deadline");
    await delay(25);
  }
}

test("真实服务从即时 FTS 到后台向量、Cohere、完整上下文引用和 1536 重建", async () =>
  withTestDatabase(async (pool, schema) => {
    let settings: PublicSettings = structuredClone(DEFAULT_SETTINGS);
    settings.models.chatModel = "synthetic/chat";
    let key: string | null = null;
    const dimensions: number[] = [];
    let chatCalls = 0;
    const deps: KnowledgeServiceDependencies = {
      getSettings: () => settings,
      readSecret: async (kind) => (kind === "openrouter-api-key" ? key : "synthetic"),
      createId: randomUUID,
      now: () => new Date(),
      logger,
      emit: () => assert.fail("B owns envelopes"),
    };
    const service = createKnowledgeService(deps, {
      schema,
      migrations: await testMigrations(),
      createPool: () => ({ ...pool, close: async () => {} }),
      fetch: async (url, init) => {
        const address = String(url);
        if (address.endsWith("/models"))
          return Response.json({
            data: [
              {
                id: "synthetic/chat",
                name: "合成",
                context_length: 16000,
                top_provider: { max_completion_tokens: 2048 },
                supported_parameters: ["temperature"],
              },
            ],
          });
        const body = JSON.parse(String(init?.body));
        if (address.endsWith("/embeddings")) {
          dimensions.push(body.dimensions);
          return Response.json({
            data: body.input.map((text: string, index: number) => ({
              index,
              embedding: Array.from({ length: body.dimensions }, (_, axis) =>
                axis === (text.includes("同步") ? 1 : 0) ? 1 : 0,
              ),
            })),
          });
        }
        if (address.endsWith("/rerank")) {
          assert.equal(body.model, "rerank-v3.5");
          const ranked = body.documents
            .map((text: string, index: number) => ({
              index,
              relevance_score: text.includes("采购") ? 0.95 : 0.1,
            }))
            .sort(
              (a: { relevance_score: number }, b: { relevance_score: number }) =>
                b.relevance_score - a.relevance_score,
            )
            .slice(0, body.top_n);
          return Response.json({ results: ranked });
        }
        assert.equal(address, "https://openrouter.ai/api/v1/chat/completions");
        chatCalls++;
        assert.ok(
          body.messages[1].content.includes("FULL_CONTEXT_END"),
          "full chunk rather than UI snippet",
        );
        return new Response(
          `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic/chat", choices: [{ index: 0, delta: { role: "assistant", content: "采购流程 [1] [999]" }, finish_reason: null }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      },
    });
    try {
      let doc = await service.documents.save(
        {
          draft: {
            title: "采购凭证",
            contentMarkdown: `采购需保留发票。\n${"note ".repeat(400)}FULL_CONTEXT_END`,
            tags: ["采购"],
            collectionId: null,
          },
        },
        context(),
      );
      await service.documents.save(
        {
          draft: {
            title: "离线同步",
            contentMarkdown: "同步日志用于故障恢复。",
            tags: ["同步"],
            collectionId: null,
          },
        },
        context(),
      );
      const immediate = await service.search.query(
        { requestId: randomUUID(), query: "采购" },
        context(),
      );
      assert.equal(immediate.mode, "keyword");
      assert.equal(immediate.hits[0].documentId, doc.id);
      assert.equal(dimensions.length, 0);
      key = "synthetic-openrouter";
      await service.applySettings(settings, settings);
      await until(async () => (await service.index.status(context())).pendingCount === 0);
      const semantic = await service.search.query(
        { requestId: randomUUID(), query: "buying receipt flow" },
        context(),
      );
      assert.equal(semantic.mode, "hybrid-rerank");
      assert.equal(semantic.hits[0].documentId, doc.id);
      assert.equal(semantic.hits[0].scores.rerank, 0.95);
      assert.equal(semantic.hits[0].snippet.includes("FULL_CONTEXT_END"), false);
      const excluded = await service.search.query(
        { requestId: randomUUID(), query: "采购", filters: { tags: ["不存在"] } },
        context(),
      );
      assert.deepEqual(excluded.hits, []);
      const events: OperationPayload[] = [];
      const operation = {
        ...context(),
        operationId: randomUUID(),
        emit: (payload: OperationPayload) => events.push(payload),
      };
      await service.assistant.start(
        { question: "采购怎样处理？", filters: { tags: ["采购"] } },
        operation,
      );
      assert.equal(chatCalls, 1);
      assert.ok(
        events.some(
          (event) => event.type === "context" && event.citations[0].documentRevision === 1,
        ),
      );
      assert.equal(
        events
          .filter((event) => event.type === "delta")
          .map((event) => (event.type === "delta" ? event.text : ""))
          .join(""),
        "采购流程 [1] ",
      );
      assert.ok(events.every((event) => ["retrieving", "context", "delta"].includes(event.type)));
      doc = await service.documents.save(
        {
          existing: { id: doc.id, expectedRevision: doc.revision },
          draft: {
            title: doc.title,
            contentMarkdown: `${doc.contentMarkdown}\n更新流程。`,
            tags: doc.tags,
            collectionId: null,
          },
        },
        context(),
      );
      const revised = await service.search.query(
        { requestId: randomUUID(), query: "采购", filters: { tags: ["采购"] } },
        context(),
      );
      assert.ok(revised.hits.every((hit) => hit.documentRevision === 2));
      const oldGeneration = (await service.index.status(context())).activeGenerationId;
      const previous = settings;
      settings = { ...settings, models: { ...settings.models, embeddingDimensions: 1536 } };
      const callsBeforeSettings = dimensions.length;
      await service.applySettings(previous, settings);
      assert.equal(dimensions.length, callsBeforeSettings);
      assert.equal((await service.index.status(context())).requiresReindex, true);
      await service.index.rebuild({ ...operation, operationId: randomUUID() });
      assert.notEqual((await service.index.status(context())).activeGenerationId, oldGeneration);
      const rebuilt = await service.search.query(
        { requestId: randomUUID(), query: "buying receipt flow", filters: { tags: ["采购"] } },
        context(),
      );
      assert.equal(rebuilt.hits[0].documentRevision, 2);
      assert.equal(dimensions.at(-1), 1536);
      await service.documents.remove({ id: doc.id, expectedRevision: doc.revision }, context());
      events.length = 0;
      await service.assistant.start(
        { question: "采购怎样处理？", filters: { tags: ["采购"] } },
        operation,
      );
      assert.equal(chatCalls, 1);
      assert.ok(events.some((event) => event.type === "delta" && event.text.includes("资料不足")));
    } finally {
      await service.dispose();
    }
  }));

test("只读连接探测不执行迁移；连接/密码变更释放旧池且下次请求再初始化", async () =>
  withTestDatabase(async (pool, schema) => {
    let settings: PublicSettings = structuredClone(DEFAULT_SETTINGS);
    let password = "synthetic-first";
    let opened = 0;
    let closed = 0;
    const sql: string[] = [];
    const service = createKnowledgeService(
      {
        getSettings: () => settings,
        readSecret: async (kind) => (kind === "database-password" ? password : null),
        createId: randomUUID,
        now: () => new Date(),
        logger,
        emit() {},
      },
      {
        schema,
        migrations: await testMigrations(),
        background: false,
        createPool: () => {
          opened++;
          return {
            connect: async () => {
              const connection = await pool.connect();
              return {
                ...connection,
                query: async (text, values) => {
                  sql.push(text);
                  return connection.query(text, values);
                },
              };
            },
            close: async () => {
              closed++;
            },
          };
        },
      },
    );
    try {
      assert.equal((await service.connections.test("database", context())).ok, true);
      assert.ok(sql.every((text) => !/CREATE|INSERT|UPDATE|DELETE/.test(text)));
      assert.equal(closed, 1);
      await service.collections.list(context());
      assert.equal(opened, 2);
      password = "synthetic-next";
      await service.applySettings(settings, settings);
      assert.equal(closed, 2);
      assert.equal(opened, 2);
      await service.collections.list(context());
      const previous = settings;
      settings = { ...settings, database: { ...settings.database, database: "synthetic_next" } };
      await service.applySettings(previous, settings);
      assert.equal(closed, 3);
      assert.equal(opened, 3);
      await service.collections.list(context());
    } finally {
      await service.dispose();
    }
    assert.equal(closed, 4);
    await assert.rejects(
      service.index.status(context()),
      (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
    );
  }));
