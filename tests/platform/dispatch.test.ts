import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  DEFAULT_SETTINGS,
  type AppInfo,
  type OperationEvent,
  type KnowledgeServiceFactory,
} from "../../src/lib/contracts";
import { createPlatform } from "../../electron/composition";
import { createUnavailableKnowledgeService } from "../../electron/platform/unavailable-service";
import { SenderGate } from "../../electron/ipc/sender";
import { IpcDispatcher } from "../../electron/ipc/dispatcher";
import { createPreloadClient } from "../../electron/ipc/bridge";
import { readPickedTextFiles } from "../../electron/platform/text-files";

const info: AppInfo = {
  apiVersion: 1,
  name: "knowledge-base-desktop",
  productName: "Zhiyu",
  version: "0.1.0",
  platform: "win32",
  arch: "x64",
  versions: { electron: "44.7.2", chrome: "test", node: "22.22.0" },
  developer: {
    name: null,
    homepage: null,
    repository: null,
    support: null,
    license: "MIT",
    copyright: null,
  },
  mode: "desktop",
};
async function fixture(t: TestContext, factory?: KnowledgeServiceFactory) {
  const root = resolve(".cache/dispatch-tests");
  await mkdir(root, { recursive: true });
  const userData = await mkdtemp(join(root, "case-"));
  const events: OperationEvent[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const platform = await createPlatform({
    userData,
    info,
    createKnowledgeService: factory,
    encryption: {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error();
      },
      decrypt: () => {
        throw new Error();
      },
    },
    send: (_owner, event) => {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    openExternal: async () => {},
    pickTextFiles: async () => ({ files: [] }),
  });
  const gate = new SenderGate("knowledge://app");
  const contents = { id: 1, mainFrame: { url: "knowledge://app/" }, isDestroyed: () => false };
  gate.register(contents);
  const source = { sender: contents, senderFrame: contents.mainFrame };
  const dispatcher = new IpcDispatcher(gate, platform.handlers, platform.logger);
  const client = createPreloadClient({
    invoke: (channel, request) => dispatcher.invoke(channel, source, request),
    subscribe: (_channel, listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  t.after(async () => {
    await platform.dispose();
    await rm(userData, { recursive: true, force: true });
  });
  return { client, dispatcher, source, userData, events, listeners };
}
const command = <T>(payload: T) => ({ requestId: randomUUID(), payload });

test("固定 client → 来源/schema → 平台/服务，未知 channel 与攻击输入不触发服务", async (t) => {
  const { client, dispatcher, source } = await fixture(t);
  const result = await client.system.getInfo(command({}));
  assert.equal(result.ok && result.value.mode, "desktop");
  const missing = await client.documents.list(command({ view: "all", offset: 0, limit: 50 }));
  assert.equal(!missing.ok && missing.error.code, "CONFIG_REQUIRED");
  const attacks = [
    dispatcher.invoke("arbitrary:sql", source, command({ sql: "SELECT secret" })),
    dispatcher.invoke("system:open-external", source, command({ url: "file:///C:/secret" })),
    dispatcher.invoke("connections:test", source, command({ target: "unknown" })),
    dispatcher.invoke("system:get-info", source, command({ value: "x".repeat(9 * 1024 * 1024) })),
    dispatcher.invoke(
      "system:get-info",
      { ...source, senderFrame: { url: "knowledge://app/" } },
      command({}),
    ),
  ];
  for (const failure of await Promise.all(attacks)) assert.equal(failure.ok, false);
});

test("预订阅能收到早于 start 响应的事件；错误和事件不包含合成秘密", async (t) => {
  const secret = "synthetic-provider-secret-for-test";
  const { client, events, listeners } = await fixture(t, () => ({
    ...createUnavailableKnowledgeService(),
    assistant: {
      start: async (_input, context) => {
        context.emit({ type: "retrieving" });
        throw Object.assign(new Error(secret), { code: "PROVIDER_AUTH" });
      },
    },
  }));
  const received: OperationEvent[] = [];
  const unsubscribe = client.operations.subscribe((event) => received.push(event));
  const request = command({ question: "合成问题" });
  const accepted = await client.assistant.start(request);
  assert.equal(accepted.ok && accepted.value.operationId, request.requestId);
  assert.equal(received[0]?.payload.type, "started");
  await new Promise((done) => setImmediate(done));
  assert.equal(received.at(-1)?.payload.type, "failed");
  assert.equal(JSON.stringify({ accepted, events }).includes(secret), false);
  for (const listener of listeners) listener({ ...events[0], leakedSecret: secret });
  assert.equal(received.length, 3);
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test("切换数据库取消旧搜索并调用 applySettings；温度保存不自动启动重建", async (t) => {
  let oldSignal!: AbortSignal;
  let applyCount = 0;
  let rebuildCount = 0;
  const { client } = await fixture(t, () => ({
    ...createUnavailableKnowledgeService(),
    search: {
      query: async (_request, context) => {
        oldSignal = context.signal;
        await new Promise(() => {});
        throw new Error();
      },
    },
    applySettings: async () => {
      applyCount++;
    },
    index: {
      status: async () => ({
        activeGenerationId: null,
        buildingGenerationId: null,
        documentCount: 0,
        chunkCount: 0,
        pendingCount: 0,
        failedCount: 0,
        requiresReindex: false,
        lastErrorCode: null,
      }),
      rebuild: async () => {
        rebuildCount++;
      },
    },
  }));
  const pending = client.search.query({ requestId: randomUUID(), query: "合成搜索" });
  await new Promise((done) => setImmediate(done));
  const updated = await client.settings.update(
    command({
      expectedRevision: 1,
      patch: { database: { ...DEFAULT_SETTINGS.database, database: "other_test_database" } },
    }),
  );
  const stale = await pending;
  assert.equal(updated.ok && updated.value.settings.revision, 2);
  assert.equal(!stale.ok && stale.error.code, "CANCELLED");
  assert.equal(oldSignal.aborted, true);
  const temperature = await client.settings.update(
    command({
      expectedRevision: 2,
      patch: { generation: { ...DEFAULT_SETTINGS.generation, temperature: 0.7 } },
    }),
  );
  assert.equal(temperature.ok && temperature.value.index.requiresReindex, false);
  assert.equal(applyCount, 2);
  assert.equal(rebuildCount, 0);
});

test("原生选择器文本读取限制扩展名、UTF-8、单文件/总量，仅返回文件名", async (t) => {
  const { userData } = await fixture(t);
  const good = join(userData, "资料.md");
  await writeFile(good, "中文资料\n第二行");
  assert.deepEqual(await readPickedTextFiles([good]), {
    files: [{ name: "资料.md", content: "中文资料\n第二行" }],
  });
  const bad = join(userData, "invalid.txt");
  await writeFile(bad, Buffer.from([0xff, 0xfe, 0x00]));
  await assert.rejects(readPickedTextFiles([bad]));
  await assert.rejects(readPickedTextFiles([good.replace(/\.md$/, ".exe")]));
  await assert.rejects(readPickedTextFiles(Array.from({ length: 101 }, () => good)));
  await writeFile(bad, "x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(readPickedTextFiles([bad]));
});

test("桥接不会透出传输异常中的路径/秘密，拒绝错误 requestId 与伪造响应字段", async () => {
  const client = createPreloadClient({
    invoke: async () => {
      throw new Error("C:/private/synthetic-secret");
    },
    subscribe: () => () => {},
  });
  const result = await client.settings.get(command({}));
  assert.equal(!result.ok && result.error.code, "INTERNAL");
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
  const wrong = createPreloadClient({
    invoke: async () => ({ ok: true, requestId: randomUUID(), value: info }),
    subscribe: () => () => {},
  });
  assert.equal((await wrong.system.getInfo(command({}))).ok, false);
});

test("服务返回含秘密的未知字段时拒绝整份响应并返回 INTERNAL", async (t) => {
  const secret = "synthetic-invalid-service-response-secret";
  const { client } = await fixture(t, () => ({
    ...createUnavailableKnowledgeService(),
    collections: {
      ...createUnavailableKnowledgeService().collections,
      list: async () => [
        Object.assign(
          { id: randomUUID(), name: "合成分类", sortOrder: 0 },
          { providerApiKey: secret },
        ),
      ],
    },
  }));
  const response = await client.collections.list(command({}));
  assert.equal(!response.ok && response.error.code, "INTERNAL");
  assert.equal(JSON.stringify(response).includes(secret), false);
});
