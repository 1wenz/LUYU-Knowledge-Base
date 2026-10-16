import { expect, test, type Page } from "@playwright/test";
import { installClient } from "./client-fixture";

async function navigate(page: Page, name: string) {
  const navigation = page.getByRole("navigation", { name: "工作区视图", exact: true });
  if (await navigation.isVisible())
    await navigation.getByRole("button", { name, exact: true }).click();
  else {
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page
      .getByRole("dialog", { name: "工作区导航", exact: true })
      .getByRole("button", { name, exact: true })
      .click();
  }
}

for (const viewport of [
  { width: 1380, height: 900 },
  { width: 960, height: 640 },
  { width: 390, height: 844 },
]) {
  test(`${viewport.width}×${viewport.height} 工作区各视图和设置组不水平溢出`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?demo=1");
    await expect(page.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
    for (const name of ["来源检索", "知识助手", "全部笔记"]) {
      await navigate(page, name);
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "打开设置", exact: true }).click();
    for (const name of ["连接", "模型与 API", "向量索引", "检索", "生成", "外观", "关于"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    }
    await page.screenshot({ path: `.cache/ui-v1/settings-${viewport.width}.png`, fullPage: true });
  });
}

test("200% CSS 缩放仍可编辑和访问设置，快捷键及抽屉恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 900 });
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("缩放验收");
  await expect(page.getByLabel("标题", { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page
    .getByLabel("Markdown 正文", { exact: true })
    .fill("超长文本 " + "longword".repeat(100));
  await page.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(page.getByRole("heading", { name: "缩放验收", exact: true })).toBeVisible();
  await expect(page.getByText("向量待处理 1 个片段", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("heading", { name: "设置与关于", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });
  const trigger = page.getByRole("button", { name: "打开导航", exact: true });
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("未保存草稿关闭时可继续编辑，取消不会覆盖已有内容", async ({ page }) => {
  await page.goto("/?demo=1");
  const trigger = page.getByRole("button", { name: "新建笔记", exact: true });
  await trigger.click();
  await page.getByLabel("标题", { exact: true }).fill("尚未保存");
  await expect(page.getByText("有未保存的修改", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("尚未保存");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "放弃草稿", exact: true }).click();
  await expect(page.getByText("0 篇笔记", { exact: true })).toBeVisible();
  await expect(trigger).toBeFocused();
});

test("旧版导入保留原存储，重复导入跳过；索引未完成提示可用召回", async ({ page }) => {
  await installClient(page, { indexPending: true });
  await page.addInitScript(() =>
    localStorage.setItem(
      "zhiyu:notes:v1",
      JSON.stringify({
        version: 1,
        notes: [
          {
            id: "legacy-one",
            collectionId: "engineering",
            title: "旧版研究",
            content: "遗留知识关键词",
            tags: ["迁移"],
            favorite: true,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    ),
  );
  await page.goto("/");
  const original = await page.evaluate(() => localStorage.getItem("zhiyu:notes:v1"));
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole("button", { name: "导入资料", exact: true }).click();
    await page.getByRole("button", { name: "读取旧版笔记", exact: true }).click();
    await expect(page.getByText("待导入 1 篇笔记", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(
      page.getByText(
        attempt ? "导入 0 篇，跳过 1 篇重复笔记。" : "导入 1 篇，跳过 0 篇重复笔记。",
        { exact: true },
      ),
    ).toBeVisible();
  }
  expect(await page.evaluate(() => localStorage.getItem("zhiyu:notes:v1"))).toBe(original);
  await page.keyboard.press("Control+k");
  await page.getByLabel("检索知识库", { exact: true }).fill("遗留知识关键词");
  await expect(
    page.getByText("向量索引尚未完成，已使用当前可用的关键词结果。", { exact: true }),
  ).toBeVisible();
});

test("加密不可用时不落明文，手动选择会话后才能保存", async ({ page }) => {
  await installClient(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开设置", exact: true }).click();
  await page.getByRole("tab", { name: "模型与 API", exact: true }).click();
  const region = page.getByRole("region", { name: "OpenRouter API key", exact: true });
  await region
    .getByLabel("新 OpenRouter API key", { exact: true })
    .fill("encrypted-unavailable-value");
  await region.getByRole("button", { name: "保存 OpenRouter API key", exact: true }).click();
  await expect(region.getByRole("alert")).toContainText("只能使用会话标记");
  await expect(region.getByLabel("新 OpenRouter API key", { exact: true })).toHaveValue("");
  await region.getByRole("combobox", { name: "保存方式", exact: true }).selectOption("session");
  await region.getByLabel("新 OpenRouter API key", { exact: true }).fill("synthetic-session-value");
  await region.getByRole("button", { name: "保存 OpenRouter API key", exact: true }).click();
  await expect(
    region.getByText("OpenRouter API key：已配置（当前会话）", { exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain(
    "synthetic-session-value",
  );
});

test("流式长回答允许向上阅读，回到最新回答后恢复跟随", async ({ page }) => {
  await installClient(page, { assistantReady: true, longAnswer: true });
  await page.goto("/");
  await page.getByRole("button", { name: "知识助手", exact: true }).click();
  await page.getByLabel("问题", { exact: true }).fill("山湖");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  const viewport = page.getByLabel("问题、来源与回答", { exact: true });
  await expect(page.getByRole("article", { name: "助手回复", exact: true })).toContainText(
    "长回答",
  );
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "回到最新回答", exact: true })).toBeVisible();
  await expect(page.getByText("回答完成", { exact: true })).toBeVisible();
  expect(await viewport.evaluate((element) => element.scrollTop)).toBeLessThan(64);
  await page.getByRole("button", { name: "回到最新回答", exact: true }).click();
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThan(64);
});
