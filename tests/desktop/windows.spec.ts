import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { desktopFixture } from "./fixtures";

const execute = promisify(execFile);
test("Windows 原生标题栏经 SendInput 拖动，最大化后按钮和输入仍可用", async () => {
  test.skip(process.platform !== "win32", "仅 Windows x64 验收。");
  const { application, page } = await desktopFixture();
  try {
    await page.waitForFunction(() => !!window.desktop?.system);
    if (process.env.ZHIYU_TEST_SCALE_FACTOR)
      expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
        Number(process.env.ZHIYU_TEST_SCALE_FACTOR),
      );
    const before = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    const handle = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString(),
    );
    const mainProcessId = await application.evaluate(() => process.pid);
    await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/windows-test-helper.ps1"),
        "-Action",
        "Drag",
        "-WindowHandle",
        handle,
        "-TargetProcessId",
        String(mainProcessId),
      ],
      { windowsHide: true },
    );
    const after = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds(),
    );
    await writeFile(
      resolve(".cache/desktop-drag.json"),
      JSON.stringify({ method: "SendInput", before, after }, null, 2),
    );
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(20);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
    expect(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMaximized(),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置与关于", exact: true })).toBeVisible();
    const input = page.getByLabel("主机", { exact: true });
    await input.fill("desktop-drag.test");
    await expect(input).toHaveValue("desktop-drag.test");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].unmaximize(),
    );
    const image = resolve(".cache/window-native-icon.png");
    await execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolve("scripts/windows-test-helper.ps1"),
        "-Action",
        "WindowIcon",
        "-WindowHandle",
        handle,
        "-TargetProcessId",
        String(mainProcessId),
        "-OutputPath",
        image,
      ],
      { windowsHide: true },
    );
  } finally {
    const processes = await application.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => metric.pid),
    );
    await application.close();
    await expect
      .poll(() =>
        processes.filter((pid) => {
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        }),
      )
      .toEqual([]);
  }
});
