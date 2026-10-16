import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";

// An empty working directory prevents a broken gate from discovering live provider tests.
const fixtureRoot = mkdtempSync(join(tmpdir(), "zhiyu-test-gates-"));
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function invoke(kind: "db" | "live", overrides: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [resolve("scripts/test.mjs"), kind], {
    cwd: fixtureRoot,
    env: {
      ...process.env,
      TEST_DATABASE_URL: "",
      RUN_LIVE_EVAL: "",
      OPENROUTER_API_KEY: "",
      COHERE_API_KEY: "",
      EVAL_DATABASE_URL: "",
      EVAL_REQUEST_BUDGET: "",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  return result.stdout + result.stderr;
}

test("数据库检查缺独立连接时明确未执行", () => {
  for (const connection of ["", " "]) {
    const output = invoke("db", { TEST_DATABASE_URL: connection });
    assert.match(output, /未执行数据库测试/);
    assert.match(output, /TEST_DATABASE_URL/);
  }
});

test("live eval 列出开关、独立库和预算缺项，不输出合成密钥", () => {
  const output = invoke("live", {
    OPENROUTER_API_KEY: "synthetic-openrouter-gate-secret",
    COHERE_API_KEY: "synthetic-cohere-gate-secret",
  });
  assert.match(output, /未执行 live eval/);
  assert.match(output, /RUN_LIVE_EVAL=1/);
  assert.match(output, /EVAL_DATABASE_URL/);
  assert.match(output, /EVAL_REQUEST_BUDGET/);
  assert.doesNotMatch(output, /synthetic-.*-gate-secret/);
});

test("live eval 在预算为空、非整数或越过安全整数范围时拒绝执行", () => {
  for (const budget of ["", " ", "0", "-1", "1.5", "NaN", "9007199254740992"]) {
    const output = invoke("live", {
      RUN_LIVE_EVAL: "1",
      OPENROUTER_API_KEY: "synthetic-openrouter-gate-secret",
      COHERE_API_KEY: "synthetic-cohere-gate-secret",
      EVAL_DATABASE_URL: "postgresql://eval:synthetic@127.0.0.1:1/eval",
      EVAL_REQUEST_BUDGET: budget,
    });
    assert.match(output, /未执行 live eval/);
    assert.match(output, /EVAL_REQUEST_BUDGET/);
    assert.match(output, /正整数/);
    assert.doesNotMatch(output, /synthetic/);
  }
});

test("live eval 配置有效时仍不把空测试组视为通过", () => {
  const output = invoke("live", {
    RUN_LIVE_EVAL: "1",
    OPENROUTER_API_KEY: "synthetic-openrouter-gate-secret",
    COHERE_API_KEY: "synthetic-cohere-gate-secret",
    EVAL_DATABASE_URL: "postgresql://eval:synthetic@127.0.0.1:1/eval",
    EVAL_REQUEST_BUDGET: "6",
  });
  assert.match(output, /live 尚无测试用例/);
  assert.doesNotMatch(output, /未执行 live eval|synthetic/);
});
