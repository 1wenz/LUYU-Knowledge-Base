import { expect, test } from "@playwright/test";

test("笔记的创建、搜索、编辑、收藏、刷新与删除", async ({ page }) => {
  await page.goto("/?legacy=1");
  await expect(page.getByText("本地存储已就绪")).toBeVisible();
  await expect(page.getByRole("heading", { name: "全部笔记", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("集成测试笔记");
  await page.getByLabel("分类", { exact: true }).selectOption("engineering");
  await page.getByLabel("标签", { exact: true }).fill("验证,记录");
  await page.getByLabel("内容", { exact: true }).fill("搜索能找到这段独特内容：mountain-lake");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("heading", { name: "集成测试笔记" })).toBeVisible();

  await page.getByRole("textbox", { name: "搜索笔记" }).fill("mountain-lake");
  await expect(page.getByText("1 条笔记", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑笔记", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("更新后的测试笔记");
  await page.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("heading", { name: "更新后的测试笔记" })).toBeVisible();
  await page.getByRole("button", { name: "收藏笔记", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("textbox", { name: "搜索笔记" }).fill("更新后的测试笔记");
  await expect(page.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除笔记", exact: true }).click();
  await expect(page.getByText("没有找到笔记", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("textbox", { name: "搜索笔记" }).fill("更新后的测试笔记");
  await expect(page.getByText("没有找到笔记", { exact: true })).toBeVisible();
});

test("分类筛选和快捷键", async ({ page }) => {
  await page.goto("/?legacy=1");
  await expect(page.getByText("本地存储已就绪")).toBeVisible();
  await page.getByRole("button", { name: /^技术笔记/ }).click();
  await expect(page.getByRole("heading", { name: "技术笔记", exact: true })).toBeVisible();
  await expect(page.getByText("2 条笔记", { exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("textbox", { name: "搜索笔记" })).toBeFocused();
});

test("损坏的数据不会被编辑覆盖", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zhiyu:notes:v1", "{broken"));
  await page.goto("/?legacy=1");
  await expect(page.getByRole("alert").filter({ hasText: "写入已暂停" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建笔记", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("zhiyu:notes:v1"))).toBe("{broken");
});

test("空知识库保持为空，并且页面没有运行时错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem("zhiyu:notes:v1", JSON.stringify({ version: 1, notes: [] })),
  );
  await page.goto("/?legacy=1");
  await expect(page.getByText("0 条笔记", { exact: true })).toBeVisible();
  await expect(page.getByText("新的知识，从一条笔记开始")).toBeVisible();
  expect(errors).toEqual([]);
});
