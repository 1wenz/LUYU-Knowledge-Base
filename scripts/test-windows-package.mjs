import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compareBrandIcon } from "./compare-brand-icon.mjs";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Windows 目录包只在 Windows x64 验证。");
const executable = resolve("release/win-unpacked/Zhiyu.exe");
const file = await open(executable, "r");
try {
  const header = Buffer.alloc(64);
  await file.read(header, 0, 64, 0);
  const machine = Buffer.alloc(6);
  await file.read(machine, 0, 6, header.readUInt32LE(0x3c));
  if (machine.toString("ascii", 0, 4) !== "PE\0\0" || machine.readUInt16LE(4) !== 0x8664)
    throw new Error("打包 EXE 不是 Windows x64。");
} finally {
  await file.close();
}
const execute = promisify(execFile);
const image = resolve(".cache/package-exe-icon.png");
const { stdout } = await execute(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolve("scripts/windows-test-helper.ps1"),
    "-Action",
    "InspectExe",
    "-ExecutablePath",
    executable,
    "-OutputPath",
    image,
  ],
  { windowsHide: true },
);
const metadata = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const developer = JSON.parse(await readFile(".cache/public-metadata.json", "utf8"));
// electron-builder 26 writes productName to both ProductName and FileDescription.
if (
  metadata.productName !== pkg.build.productName ||
  metadata.description !== pkg.build.productName ||
  metadata.companyName !== (developer.name ?? "未配置") ||
  metadata.copyright !== (developer.copyright ?? "开发者未配置") ||
  metadata.version !== `${pkg.version}.0`
)
  throw new Error("Windows 文件属性与产品信息不一致。");
const icon = await compareBrandIcon(image);
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("@playwright/test/cli"), "test", "--config", "playwright.desktop.config.ts"],
  { stdio: "inherit", windowsHide: true, env: { ...process.env, ZHIYU_PACKAGE_EXE: executable } },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const windowIcon = await compareBrandIcon(".cache/window-native-icon.png");
await writeFile(
  ".cache/windows-package-report.json",
  JSON.stringify({ metadata, icon, windowIcon, arch: "x64", desktopTests: "passed" }, null, 2),
);
console.log(
  "Windows x64 目录包已实际运行，沙盒/凭据/拖动/原生图标检查通过；签名状态：" + metadata.signature,
);
