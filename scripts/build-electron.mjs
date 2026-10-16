import { build, context } from "esbuild";
import { builtinModules } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { publicMetadata } from "./public-metadata.mjs";

const metadata = await publicMetadata();
await mkdir(".cache", { recursive: true });
await writeFile(".cache/public-metadata.json", JSON.stringify(metadata, null, 2) + "\n");

const options = {
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  minify: true,
  metafile: true,
  define: { ZHIYU_PUBLIC_METADATA: JSON.stringify(metadata) },
  logLevel: "info",
};
if (process.argv.includes("--watch")) {
  const compiler = await context(options);
  await compiler.watch();
} else {
  const result = await build(options);
  for (const [output, details] of Object.entries(result.metafile.outputs)) {
    for (const dependency of details.imports.filter((item) => item.external)) {
      const allowed =
        dependency.path === "electron" ||
        (!output.endsWith("preload.js") &&
          (dependency.path.startsWith("node:") || builtinModules.includes(dependency.path)));
      if (!allowed) throw new Error("bundle 包含未部署运行时依赖：" + dependency.path);
    }
  }
  await writeFile(".cache/electron-metafile.json", JSON.stringify(result.metafile, null, 2));
}
