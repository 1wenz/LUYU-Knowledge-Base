import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  resolveStaticPath,
  validateExternalUrl,
  trustedOrigin,
} from "../../electron/platform/security";
import { SenderGate, type RegisteredContents } from "../../electron/ipc/sender";
import { toPublicError } from "../../electron/platform/errors";
import { OperationRegistry } from "../../electron/platform/operations";
import type { OperationEvent } from "../../src/lib/contracts";

test("生产协议拒绝编码穿越、Windows ADS、反斜杠、错误 host 和请求方法", () => {
  const root = resolve("out");
  assert.deepEqual(resolveStaticPath(root, "knowledge://app/", "GET"), {
    status: 200,
    path: resolve(root, "index.html"),
  });
  for (const address of [
    "knowledge://evil/",
    "knowledge://user@app/",
    "knowledge://app:123/",
    "knowledge://app/../private",
    "knowledge://app/%2e%2e/private",
    "knowledge://app/%252e%252e/private",
    "knowledge://app/%5c..%5cprivate",
    "knowledge://app/test.txt:stream",
    "knowledge://app/a%00.txt",
    "knowledge://app/con",
    "knowledge://app/a./",
  ]) {
    assert.notEqual(resolveStaticPath(root, address, "GET").status, 200, address);
  }
  assert.equal(resolveStaticPath(root, "knowledge://app/", "POST").status, 403);
  assert.equal(resolveStaticPath(root, "knowledge://app/%ZZ", "GET").status, 400);
});

test("外链拒绝任意协议、凭据、控制字符，开发源精确匹配", () => {
  assert.equal(validateExternalUrl("https://example.org/help"), "https://example.org/help");
  for (const value of [
    "file:///C:/private",
    "javascript:alert(1)",
    "https://user:secret@example.org/",
    "https://example.org/\nrun",
    "data:text/plain,test",
  ]) {
    assert.throws(() => validateExternalUrl(value));
  }
  assert.equal(trustedOrigin("knowledge://app/", "knowledge://app"), true);
  assert.equal(trustedOrigin("knowledge://app.evil/", "knowledge://app"), false);
  assert.equal(trustedOrigin("http://127.0.0.1:3001/", "http://127.0.0.1:3000"), false);
});

test("IPC 必须来自已注册 WebContents 的顶层 mainFrame，不能伪造同 id", () => {
  const gate = new SenderGate("knowledge://app");
  const contents: RegisteredContents = {
    id: 1,
    mainFrame: { url: "knowledge://app/" },
    isDestroyed: () => false,
  };
  const owner = gate.register(contents);
  assert.equal(gate.authorize({ sender: contents, senderFrame: contents.mainFrame }), owner);
  for (const source of [
    { sender: { ...contents }, senderFrame: contents.mainFrame },
    { sender: contents, senderFrame: { url: "knowledge://app/" } },
    { sender: contents, senderFrame: null },
  ])
    assert.throws(
      () => gate.authorize(source),
      (error: unknown) => toPublicError(error).code === "UNAUTHORIZED",
    );
  contents.mainFrame.url = "https://example.org/";
  assert.throws(() => gate.authorize({ sender: contents, senderFrame: contents.mainFrame }));
  gate.unregister(contents);
  contents.mainFrame.url = "knowledge://app/";
  assert.throws(() => gate.authorize({ sender: contents, senderFrame: contents.mainFrame }));
});

const id1 = "2813961d-ce82-4c3d-bb05-c64dbb85c182";
const id2 = "c041ec82-a3a1-428d-b73c-5106915ae692";

test("任务先用请求 UUID 登记，owner 隔离、幂等取消和唯一终态", async () => {
  const events: Array<{ owner: string; event: OperationEvent }> = [];
  const registry = new OperationRegistry((owner, event) => events.push({ owner, event }));
  let finish!: () => void;
  const accepted = registry.start("window-a", id1, "assistant", async (context) => {
    context.emit({ type: "retrieving" });
    await new Promise<void>((done) => {
      finish = done;
    });
    context.emit({ type: "completed", text: "late" });
  });
  assert.equal(accepted.operationId, id1);
  assert.equal(events[0].event.payload.type, "started");
  await new Promise((done) => setImmediate(done));
  assert.throws(
    () => registry.cancel("window-b", id1),
    (error: unknown) => toPublicError(error).code === "UNAUTHORIZED",
  );
  assert.equal(registry.cancel("window-a", id1), true);
  assert.equal(registry.cancel("window-a", id1), false);
  finish();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(
    events.map(({ owner }) => owner),
    ["window-a", "window-a", "window-a"],
  );
  assert.deepEqual(
    events.map(({ event }) => event.seq),
    [1, 2, 3],
  );
  assert.equal(events.at(-1)?.event.payload.type, "cancelled");
  assert.throws(() => registry.start("window-a", id1, "assistant", async () => {}));
  registry.dispose();
});

test("每窗口一个助手、全应用一个重建；关窗清理全部 signal", async () => {
  const registry = new OperationRegistry(() => {});
  let signal!: AbortSignal;
  registry.start("a", id1, "reindex", async (context) => {
    signal = context.signal;
    await new Promise(() => {});
  });
  await new Promise((done) => setImmediate(done));
  assert.throws(() => registry.start("b", id2, "reindex", async () => {}));
  registry.cancelOwner("a");
  assert.equal(signal.aborted, true);
  registry.start("b", id2, "reindex", async () => {});
  await new Promise((done) => setImmediate(done));
  registry.dispose();
});

test("替换搜索或连接会取消旧请求，忽略不服从 AbortSignal 的旧响应", async () => {
  const registry = new OperationRegistry(() => {});
  let oldSignal!: AbortSignal;
  let finish!: (value: string) => void;
  const old = registry.run("a", id1, "search", async (context) => {
    oldSignal = context.signal;
    return new Promise<string>((done) => {
      finish = done;
    });
  });
  const rejected = assert.rejects(
    old,
    (error: unknown) => toPublicError(error).code === "CANCELLED",
  );
  assert.equal(await registry.run("a", id2, "search", async () => "new"), "new");
  finish("late");
  await rejected;
  assert.equal(oldSignal.aborted, true);
  registry.dispose();
});

test("delta 节流且按 UTF-8 切块；完成事件排在全部 delta 之后", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events: OperationEvent[] = [];
  const registry = new OperationRegistry((_owner, event) => events.push(event));
  registry.start("a", id1, "assistant", async (context) => {
    for (let i = 0; i < 30; i++) context.emit({ type: "delta", text: "中文".repeat(100) });
    context.emit({ type: "completed", text: "完成" });
  });
  await new Promise((done) => setImmediate(done));
  t.mock.timers.tick(49);
  assert.equal(events.filter((event) => event.payload.type === "delta").length, 0);
  t.mock.timers.tick(1);
  assert.equal(events.filter((event) => event.payload.type === "delta").length, 1);
  t.mock.timers.tick(50);
  const deltas = events.filter((event) => event.payload.type === "delta");
  assert.equal(deltas.length, 2);
  assert.equal(
    deltas.map((event) => (event.payload.type === "delta" ? event.payload.text : "")).join(""),
    "中文".repeat(3000),
  );
  assert.equal(events.at(-1)?.payload.type, "completed");
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_event, index) => index + 1),
  );
  registry.dispose();
});
