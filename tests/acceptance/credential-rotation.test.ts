import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_SETTINGS, type KnowledgeServiceDependencies } from "../../src/lib/contracts";
import { createKnowledgeService } from "../../electron/services/knowledge";
import { testMigrations, withTestDatabase } from "../integration/database-fixture";

const context = () => ({ ownerId: "credential-acceptance", signal: new AbortController().signal });

for (const replacement of [null, "synthetic-replacement-key"]) {
  test(`真实后台索引在${replacement ? "替换" : "删除"} key 时取消旧请求并释放租约`, async () =>
    withTestDatabase(async (pool, schema) => {
      const settings = structuredClone(DEFAULT_SETTINGS);
      let key: string | null = "synthetic-retired-key";
      let changed = false;
      let firstSignal: AbortSignal | undefined;
      let started!: () => void;
      let release!: () => void;
      const firstStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const responseGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requests: Array<{ authorization: string | null; afterChange: boolean }> = [];
      const deps: KnowledgeServiceDependencies = {
        getSettings: () => settings,
        readSecret: async (kind) => (kind === "openrouter-api-key" ? key : null),
        createId: randomUUID,
        now: () => new Date(),
        emit: () => assert.fail("Platform owns operation envelopes"),
        logger: { info() {}, warn() {}, error() {} },
      };
      const service = createKnowledgeService(deps, {
        schema,
        migrations: await testMigrations(),
        createPool: () => ({ ...pool, close: async () => {} }),
        fetch: async (url, init) => {
          assert.equal(String(url), "https://openrouter.ai/api/v1/embeddings");
          requests.push({
            authorization: new Headers(init?.headers).get("Authorization"),
            afterChange: changed,
          });
          if (!firstSignal) {
            firstSignal = init?.signal ?? undefined;
            started();
            // Deliberately ignore signal: the service must still cancel promptly and reject late data.
            await responseGate;
          }
          const body = JSON.parse(String(init?.body)) as { input: string[]; dimensions: number };
          return Response.json({
            data: body.input.map((_, index) => ({
              index,
              embedding: Array.from({ length: body.dimensions }, (_, axis) => (axis === 0 ? 1 : 0)),
            })),
          });
        },
      });
      try {
        await service.documents.save(
          {
            draft: {
              title: "合成凭据轮换资料",
              contentMarkdown: "此文档只用于受控的凭据与任务生命周期测试。",
              collectionId: null,
              tags: [],
            },
          },
          context(),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            firstStarted,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("后台任务未开始")), 5_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        key = replacement;
        changed = true;
        await service.applySettings(settings, settings);
        assert.equal(firstSignal?.aborted, true, "旧 key 对应的在途请求必须取消");
        release();
        if (replacement) {
          const deadline = Date.now() + 5_000;
          while ((await service.index.status(context())).pendingCount) {
            assert.ok(Date.now() < deadline, "新 key 应恢复未完成的索引任务");
            await delay(25);
          }
          assert.ok(requests.some((request) => request.authorization === `Bearer ${replacement}`));
        } else {
          await delay(300);
          assert.equal((await service.index.status(context())).pendingCount, 1);
          const connection = await pool.connect();
          try {
            const count = await connection.query<{ count: number }>(
              "SELECT count(*)::integer AS count FROM chunk_embeddings",
            );
            assert.equal(count.rows[0].count, 0, "取消后的旧响应不得写回");
          } finally {
            connection.release();
          }
        }
        assert.ok(
          requests
            .filter((request) => request.afterChange)
            .every((request) => request.authorization === `Bearer ${replacement}`),
        );
      } finally {
        release();
        await service.dispose();
      }
    }));
}
