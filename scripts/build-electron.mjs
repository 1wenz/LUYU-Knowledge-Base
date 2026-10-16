import { build, context } from "esbuild";

const options = {
  entryPoints: ["electron/main.ts", "electron/preload.ts"],
  outdir: "dist-electron",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
};
if (process.argv.includes("--watch")) {
  const compiler = await context(options);
  await compiler.watch();
} else {
  await build(options);
}
