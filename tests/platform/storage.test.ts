import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { test, type TestContext } from "node:test";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";
import { SettingsStore } from "../../electron/platform/settings";
import { SecretStore, type Encryption } from "../../electron/platform/secrets";
import { diskJsonFiles } from "../../electron/platform/files";
import { createSafeLogger, toPublicError } from "../../electron/platform/errors";

async function directory(t: TestContext) {
  const root = resolve(".cache/platform-tests");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "case-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const encryption: Encryption = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value).map((byte) => byte ^ 0x5a),
  decrypt: (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0x5a)).toString("utf8"),
};
const secret = "synthetic-secret-NOT-A-REAL-KEY";

test("设置更新原子落盘；同 revision 的并发只有一次成功，温度不要求重建", async (t) => {
  const path = join(await directory(t), "settings.json");
  const store = await SettingsStore.open(path);
  const patch = { generation: { ...DEFAULT_SETTINGS.generation, temperature: 0.6 } };
  const results = await Promise.allSettled([
    store.update({ expectedRevision: 1, patch }),
    store.update({ expectedRevision: 1, patch }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.status === "rejected" && toPublicError(rejected.reason).code, "CONFLICT");
  const restarted = await SettingsStore.open(path);
  assert.equal(restarted.get().revision, 2);
  assert.equal(restarted.get().generation.temperature, 0.6);
  assert.equal(store.requiresReindex(), false);
  await store.update({
    expectedRevision: 2,
    patch: { models: { ...DEFAULT_SETTINGS.models, embeddingDimensions: 1536 } },
  });
  assert.equal(store.requiresReindex(), true);
  const copy = store.get();
  copy.database.host = "tampered";
  assert.equal(store.get().database.host, "127.0.0.1");
});

test("损坏/未来版本文件保持原样；v0 显式迁移并备份", async (t) => {
  const path = join(await directory(t), "settings.json");
  for (const content of ["broken json", JSON.stringify({ schemaVersion: 99 })]) {
    await writeFile(path, content);
    await assert.rejects(
      SettingsStore.open(path),
      (error: unknown) => toPublicError(error).code === "SCHEMA_MISMATCH",
    );
    assert.equal(await readFile(path, "utf8"), content);
  }
  const { schemaVersion: _schemaVersion, revision: _revision, ...groups } = DEFAULT_SETTINGS;
  void _schemaVersion;
  void _revision;
  const old = JSON.stringify({
    schemaVersion: 0,
    settings: { ...groups, appearance: { theme: "dark", reduceMotion: true } },
  });
  await writeFile(path, old);
  const migrated = await SettingsStore.open(path);
  assert.equal(migrated.get().schemaVersion, 1);
  assert.equal(migrated.get().appearance.theme, "dark");
  assert.equal(await readFile(path + ".v0.bak", "utf8"), old);
});

test("保存失败不会假装成功，也不改变内存 revision", async (t) => {
  const path = join(await directory(t), "settings.json");
  const store = await SettingsStore.open(path, {
    ...diskJsonFiles,
    write: async () => {
      throw new Error("fake disk failure " + secret);
    },
  });
  await assert.rejects(
    store.update({
      expectedRevision: 1,
      patch: { appearance: { theme: "dark", reduceMotion: false } },
    }),
    (error: unknown) => toPublicError(error).code === "INTERNAL",
  );
  assert.equal(store.get().revision, 1);
  assert.equal(store.get().appearance.theme, "system");
});

test("秘密只以加密内容保存，删除后重启不可回读；session 不落盘", async (t) => {
  const path = join(await directory(t), "credentials.json");
  const store = await SecretStore.open(path, encryption);
  await store.set({ kind: "openrouter-api-key", value: secret, persistence: "encrypted" });
  assert.equal((await readFile(path, "utf8")).includes(secret), false);
  assert.equal(JSON.stringify(store.status()).includes(secret), false);
  const restarted = await SecretStore.open(path, encryption);
  assert.equal(await restarted.read("openrouter-api-key"), secret);
  await restarted.delete("openrouter-api-key");
  assert.equal(await (await SecretStore.open(path, encryption)).read("openrouter-api-key"), null);
  await restarted.set({ kind: "cohere-api-key", value: secret, persistence: "session" });
  assert.equal(restarted.status()["cohere-api-key"].persistence, "session");
  assert.equal(await (await SecretStore.open(path, encryption)).read("cohere-api-key"), null);
  assert.equal((await readFile(path, "utf8")).includes(secret), false);
});

test("加密不可用拒绝持久保存；写入失败和删除失败保持原状态", async (t) => {
  const path = join(await directory(t), "credentials.json");
  const unavailable = await SecretStore.open(path, { ...encryption, isAvailable: () => false });
  await assert.rejects(
    unavailable.set({ kind: "database-password", value: secret, persistence: "encrypted" }),
    (error: unknown) => toPublicError(error).code === "ENCRYPTION_UNAVAILABLE",
  );
  await unavailable.set({ kind: "database-password", value: secret, persistence: "session" });
  assert.equal(await unavailable.read("database-password"), secret);
  let failWrite = false;
  const files = {
    ...diskJsonFiles,
    write: async (file: string, value: unknown) => {
      if (failWrite) throw new Error(secret);
      await diskJsonFiles.write(file, value);
    },
  };
  const store = await SecretStore.open(path, encryption, files);
  await store.set({ kind: "openrouter-api-key", value: secret, persistence: "encrypted" });
  failWrite = true;
  await assert.rejects(store.delete("openrouter-api-key"));
  assert.equal(await store.read("openrouter-api-key"), secret);
  await assert.rejects(
    store.set({ kind: "cohere-api-key", value: secret, persistence: "encrypted" }),
  );
  assert.equal(store.status()["cohere-api-key"].configured, false);
});

test("错误与结构化诊断不泄漏合成秘密、路径或 provider 原始响应", () => {
  const lines: string[] = [];
  const logger = createSafeLogger((line) => lines.push(line));
  logger.error(secret, { requestId: secret, code: secret, count: 3 });
  logger.warn("provider.failure", { code: "PROVIDER_AUTH", durationMs: 10 });
  const error = toPublicError(
    Object.assign(new Error("C:/private/" + secret), { code: "PROVIDER_AUTH" }),
  );
  assert.equal(error.code, "PROVIDER_AUTH");
  assert.equal(JSON.stringify({ lines, error }).includes(secret), false);
  assert.equal(JSON.stringify({ lines, error }).includes("C:/private"), false);
});
