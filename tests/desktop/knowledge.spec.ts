import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDesktopTestDatabase } from "./database-fixture";
import { desktopFixture } from "./fixtures";

test("真实桌面 bridge → PostgreSQL 保存/来源检索/收藏/恢复/重启，无云端 key 可用", async () => {
  test.skip(!process.env.TEST_DATABASE_URL, "未执行：需要本机专用 TEST_DATABASE_URL。");
  test.setTimeout(90_000);
  const database = await createDesktopTestDatabase();
  let fixture: Awaited<ReturnType<typeof desktopFixture>> | undefined;
  try {
    fixture = await desktopFixture();
    const { page, userData } = fixture;
    await page.waitForFunction(() => !!window.desktop?.settings);
    const configured = await page.evaluate(
      async ({ settings, password }) => {
        const client = window.desktop!;
        const command = <T>(payload: T) => ({ requestId: crypto.randomUUID(), payload });
        const secret = await client.secrets.set(
          command({ kind: "database-password", value: password, persistence: "encrypted" }),
        );
        if (!secret.ok) return secret;
        const current = await client.settings.get(command({}));
        if (!current.ok) return current;
        return client.settings.update(
          command({
            expectedRevision: current.value.settings.revision,
            patch: { database: settings },
          }),
        );
      },
      { settings: database.settings, password: database.password },
    );
    expect(configured.ok).toBe(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
    await expect(page.getByText("0 篇笔记", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建笔记", exact: true }).first().click();
    await page.getByLabel("标题", { exact: true }).fill("桌面合成资料");
    await page
      .getByLabel("Markdown 正文", { exact: true })
      .fill("# 原文\n\n山湖用于核对真实的中文检索和来源行号。");
    await page.getByRole("button", { name: "保存笔记", exact: true }).click();
    await expect(page.getByRole("heading", { name: "桌面合成资料", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByLabel("检索知识库", { exact: true }).fill("山湖");
    await expect(page.getByText("1 个来源片段 · 关键词检索", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /打开来源：桌面合成资料/ }).click();
    await expect(page.getByRole("dialog", { name: "来源原文" })).toBeVisible();
    await expect(page.locator('[data-source-line="3"]')).toHaveAttribute(
      "data-highlighted",
      "true",
    );
    await page.getByRole("button", { name: "返回来源列表", exact: true }).click();
    await fixture.application.close();
    fixture = undefined;
    const encrypted = await readFile(join(userData, "credentials.json"), "utf8");
    expect(encrypted.includes(database.password)).toBe(false);
    fixture = await desktopFixture(userData);
    const restarted = fixture.page;
    await restarted.getByRole("button", { name: "打开笔记：桌面合成资料", exact: true }).click();
    await expect(restarted.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
    await restarted.getByRole("button", { name: "移到回收站", exact: true }).click();
    await restarted
      .getByRole("dialog", { name: "移到回收站" })
      .getByRole("button", { name: "确认移入", exact: true })
      .click();
    await restarted.getByRole("button", { name: "回收站", exact: true }).click();
    await restarted.getByRole("button", { name: "打开笔记：桌面合成资料", exact: true }).click();
    await restarted.getByRole("button", { name: "恢复笔记", exact: true }).click();
    await restarted.getByRole("button", { name: "全部笔记", exact: true }).click();
    await expect(restarted.getByText("1 篇笔记", { exact: true })).toBeVisible();
  } finally {
    try {
      if (fixture) {
        // Failed assertions may leave our synthetic draft open with beforeunload protection.
        await fixture.application.evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        });
        await fixture.application.close();
      }
    } finally {
      await database.dispose();
    }
  }
});
