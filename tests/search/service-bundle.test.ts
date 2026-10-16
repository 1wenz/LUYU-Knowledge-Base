import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { mkdir, mkdtemp, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

test(
  "完整服务 CJS bundle 仅依赖 Node 内建，默认迁移资源可加载，延迟连接和免费探测可运行",
  { timeout: 30_000 },
  async () => {
    await mkdir(".cache", { recursive: true });
    const output = await mkdtemp(resolve(".cache/service-bundle-"));
    const executable = join(output, "service-runtime.js");
    const result = await build({
      entryPoints: ["tests/search/service-runtime.ts"],
      outfile: executable,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node22",
      alias: { "pg-native": resolve("electron/platform/pg-native-disabled.ts") },
      minify: true,
      metafile: true,
      logLevel: "silent",
    });
    for (const file of Object.values(result.metafile.outputs))
      for (const imported of file.imports.filter((item) => item.external))
        assert.ok(
          imported.path.startsWith("node:") || builtinModules.includes(imported.path),
          imported.path,
        );
    await mkdir(join(output, "db/migrations"), { recursive: true });
    for (const file of ["001_knowledge.sql", "002_search_indexes.sql", "003_embedding_cache.sql"])
      await copyFile(resolve("db/migrations", file), join(output, "db/migrations", file));
    const executed = spawnSync(process.execPath, [executable], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    assert.ifError(executed.error);
    assert.equal(executed.status, 0, "standalone bundled knowledge service failed");
    assert.deepEqual(JSON.parse(executed.stdout), {
      service: true,
      migrations: true,
      providerProbe: true,
    });
  },
);
