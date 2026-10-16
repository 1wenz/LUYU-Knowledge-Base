import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { migrationChecksum } from "../../electron/services/knowledge/database/migrations";

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
    const executed = spawnSync(
      process.execPath,
      [resolve(".cache/provider-runtime/provider-runtime.js")],
      {
        encoding: "utf8",
        cwd: tmpdir(),
        windowsHide: true,
        timeout: 10_000,
      },
    );
    assert.ifError(executed.error);
    assert.equal(executed.status, 0, executed.stderr);
    const result = JSON.parse(executed.stdout) as Record<string, unknown>;
    assert.equal(result.pool, "function");
    assert.equal(result.embedding, "function");
    assert.equal(result.chat, "function");
    assert.equal(result.nativeUnavailable, true);
    assert.ok(typeof result.chineseTokens === "number" && result.chineseTokens > 0);
    const migrations = (await readdir("db/migrations"))
      .filter((name) => /^\d{3}_.*\.sql$/.test(name))
      .sort();
    const expected = await Promise.all(
      migrations.map(async (name) => ({
        version: Number(name.slice(0, 3)),
        checksum: migrationChecksum(await readFile(resolve("db/migrations", name), "utf8")),
      })),
    );
    assert.ok(expected.length > 0);
    assert.deepEqual(result.migrations, expected);
  },
);
