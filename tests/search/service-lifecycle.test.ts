import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS, type KnowledgeServiceDependencies } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { createKnowledgeService } from "../../electron/services/knowledge";

const context = () => ({ ownerId: "synthetic-service", signal: new AbortController().signal });
const deps = (): KnowledgeServiceDependencies => ({
  getSettings: () => structuredClone(DEFAULT_SETTINGS),
  readSecret: async () => "synthetic-key",
  createId: randomUUID,
  now: () => new Date(),
  logger: { info() {}, warn() {}, error() {} },
  emit: () => assert.fail("B owns operation envelopes"),
});
const cancelled = (error: unknown) => error instanceof DomainError && error.code === "CANCELLED";

test("工厂延迟连接；数据库故障不阻止模型/鉴权，失败可重试，dispose 幂等", async () => {
  let opened = 0;
  let closed = 0;
  let requests = 0;
  const service = createKnowledgeService(deps(), {
    migrations: [],
    background: false,
    createPool: () => {
      opened++;
      return {
        connect: async () => {
          throw new Error("synthetic private database");
        },
        close: async () => {
          closed++;
        },
      };
    },
    fetch: async (url) => {
      requests++;
      return String(url).endsWith("/models")
        ? Response.json({ data: [] })
        : Response.json({ valid: true });
    },
  });
  assert.equal(opened, 0);
  assert.deepEqual(await service.models.list(context()), []);
  assert.equal((await service.connections.test("cohere", context())).ok, true);
  const previous = deps().getSettings();
  await service.applySettings(previous, {
    ...previous,
    generation: { ...previous.generation, temperature: 0.5 },
  });
  assert.equal(opened, 0);
  for (let index = 0; index < 2; index++)
    await assert.rejects(
      service.index.status(context()),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "DATABASE_UNAVAILABLE" &&
        !error.message.includes("private"),
    );
  assert.equal(opened, 2);
  assert.equal(closed, 2);
  await service.dispose();
  await service.dispose();
  await assert.rejects(service.models.list(context()), cancelled);
  await assert.rejects(service.index.status(context()), cancelled);
  assert.equal(requests, 2);
});

test("取消等待初始化的调用立即结束，dispose 释放随后到达的数据库连接", async () => {
  let ready!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let closed = 0;
  let returned = 0;
  const service = createKnowledgeService(deps(), {
    migrations: [],
    background: false,
    createPool: () => ({
      connect: async () => {
        ready();
        await gate;
        return {
          query: async () => ({ rows: [], rowCount: 0 }),
          release: () => {
            returned++;
          },
        };
      },
      close: async () => {
        closed++;
      },
    }),
  });
  const controller = new AbortController();
  const pending = service.index.status({ ...context(), signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, cancelled);
  const disposing = service.dispose();
  release();
  await disposing;
  assert.equal(returned, 1);
  assert.equal(closed, 1);
});
