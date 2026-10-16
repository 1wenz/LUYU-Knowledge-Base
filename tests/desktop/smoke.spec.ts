import { _electron as electron, expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("静态导出在沙盒桌面窗口中加载，preload IPC 可用", async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const application = await electron.launch({
    args: [resolve(".")],
    env,
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
    await expect(page.getByText("本地存储已就绪")).toBeVisible();
    expect(await page.evaluate(() => location.protocol)).toBe("knowledge:");
    const info = await page.evaluate(() =>
      (
        window as Window & { desktop: { getInfo(): Promise<{ version: string }> } }
      ).desktop.getInfo(),
    );
    expect(info.version).toBe("0.1.0");
    expect(await page.evaluate(() => "require" in window)).toBe(false);
    const preferences = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    await page.screenshot({ path: ".cache/desktop-preview.png" });
  } finally {
    await application.close();
  }
});
