import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import test from "node:test";

test(
  "生产打包选项生成可独立运行的 pg/LangChain/tokenizer CJS，只有 Node 内建依赖",
  { timeout: 30_000 },
  async () => {
    const built = spawnSync(process.execPath, ["scripts/build-electron.mjs", "--verify-runtime"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    });
    assert.ifError(built.error);
    assert.equal(built.status, 0, built.stderr);
    const metafile = JSON.parse(
      await readFile(".cache/provider-runtime/metafile.json", "utf8"),
    ) as {
      outputs: Record<string, { imports: Array<{ path: string; external?: boolean }> }>;
    };
    for (const output of Object.values(metafile.outputs)) {
      for (const imported of output.imports.filter((item) => item.external)) {
        assert.ok(
          imported.path.startsWith("node:") || builtinModules.includes(imported.path),
          imported.path,
        );
      }
    }
    const executed = spawnSync(process.execPath, [".cache/provider-runtime/provider-runtime.js"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    assert.ifError(executed.error);
    assert.equal(executed.status, 0, executed.stderr);
    const result = JSON.parse(executed.stdout) as Record<string, unknown>;
    assert.equal(result.pool, "function");
    assert.equal(result.embedding, "function");
    assert.equal(result.chat, "function");
    assert.equal(result.nativeUnavailable, true);
    assert.ok(typeof result.chineseTokens === "number" && result.chineseTokens > 0);
  },
);
