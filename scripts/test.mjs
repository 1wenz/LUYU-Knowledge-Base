import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const kind = process.argv[2] ?? "unit";
const directories = {
  unit: ["domain", "search", "contracts", "platform", "portability", "regressions"],
  db: ["integration", "acceptance"],
  live: ["evals"],
};
if (!(kind in directories)) throw new Error("未知测试组。");
if (kind === "db" && !process.env.TEST_DATABASE_URL) {
  console.error("未执行数据库测试：需要独立的 TEST_DATABASE_URL，禁止使用业务库。");
  process.exit(2);
}
if (kind === "live") {
  const missing = ["OPENROUTER_API_KEY", "COHERE_API_KEY", "EVAL_DATABASE_URL"].filter(
    (key) => !process.env[key],
  );
  if (process.env.RUN_LIVE_EVAL !== "1" || missing.length) {
    console.error("未执行 live eval：需要 RUN_LIVE_EVAL=1 和配置 " + missing.join("、"));
    process.exit(2);
  }
}

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = directory + "/" + entry.name;
      return entry.isDirectory() ? discover(path) : path.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return files.flat();
}
const sources = (
  await Promise.all(directories[kind].map((directory) => discover("tests/" + directory)))
)
  .flat()
  .sort();
if (!sources.length) {
  console.error("未执行：" + kind + " 尚无测试用例，不能将空测试组视为通过。");
  process.exit(2);
}
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run([require.resolve("typescript/bin/tsc"), "--project", "tsconfig.tests.json"]);
run([
  "--test",
  "--test-concurrency=1",
  ...sources.map((source) => resolve(".cache/test-dist", source.replace(/\.ts$/, ".js"))),
]);
