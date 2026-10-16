import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const children = new Set();
const rendererUrl = "http://127.0.0.1:3000";
let stopping = false;

function launch(executable, args, extraEnv = {}) {
  const child = spawn(executable, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    windowsHide: true,
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(error);
    void shutdown(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping) void shutdown(code ?? 1);
  });
  return child;
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    [...children].map((child) => {
      if (process.platform === "win32" && child.pid) {
        return new Promise((done) => {
          const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            windowsHide: true,
            stdio: "ignore",
          });
          taskkill.on("error", () => {
            child.kill();
            done();
          });
          taskkill.on("exit", done);
        });
      }
      child.kill("SIGTERM");
    }),
  );
  process.exit(code);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  try {
    await fetch(rendererUrl, { signal: AbortSignal.timeout(500) });
    throw new Error("端口 3000 已被占用，请先关闭占用该端口的服务。");
  } catch (error) {
    if (error.message?.includes("已被占用")) throw error;
  }

  const compiler = spawn(process.execPath, ["scripts/build-electron.mjs"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  const compilerExit = await new Promise((done, reject) => {
    compiler.on("error", reject);
    compiler.on("exit", done);
  });
  if (compilerExit !== 0) throw new Error("Electron 编译失败。");
  launch(process.execPath, [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3000",
  ]);
  launch(process.execPath, ["scripts/build-electron.mjs", "--watch"]);
  const deadline = Date.now() + 90_000;
  while (true) {
    try {
      const response = await fetch(rendererUrl, { signal: AbortSignal.timeout(3000) });
      if (response.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("等待 Next.js 启动超时。");
    await delay(500);
  }
  const electronEnv = { ELECTRON_RENDERER_URL: rendererUrl };
  delete process.env.ELECTRON_RUN_AS_NODE;
  launch(require("electron"), [root], electronEnv);
} catch (error) {
  console.error(error);
  await shutdown(1);
}
