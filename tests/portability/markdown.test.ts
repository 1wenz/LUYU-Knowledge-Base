import assert from "node:assert/strict";
import test from "node:test";
import { BackupError, type BackupSnapshot } from "../../src/lib/portability/backup";
import { createMarkdownExport, type MarkdownExport } from "../../src/lib/portability/markdown";

const timestamp = "2026-10-16T08:00:00.000Z";
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function snapshot(titles = ["中文笔记"]): BackupSnapshot {
  return {
    collections: [{ id: uuid(1), name: "技术笔记", sortOrder: 0 }],
    documents: titles.map((title, index) => ({
      id: uuid(index + 10),
      collectionId: uuid(1),
      title,
      contentMarkdown:
        "---\r\nexisting: header\r\n---\r\n\r\n# 原文 🌊\r\n\r\n```ts\r\nconst x = 1;\r\n```\r\n",
      tags: ["中文", "研究"],
      favorite: true,
      revision: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    })),
  };
}
const markdown = (result: MarkdownExport) =>
  result.files.filter((file) => file.name.endsWith(".md"));
const manifest = (result: MarkdownExport) =>
  JSON.parse(result.files.find((file) => file.name === "manifest.json")!.content);

test("Markdown 保留正文、已有 frontmatter 和换行原样", () => {
  const input = snapshot();
  const result = createMarkdownExport(input);
  assert.equal(result.documentCount, 1);
  assert.equal(markdown(result)[0].content, input.documents[0].contentMarkdown);
  assert.equal(markdown(result)[0].name, `中文笔记--${uuid(10)}.md`);
});

test("清单保留元数据并关联正确文件，正文不重复放入清单", () => {
  const input = snapshot();
  const result = createMarkdownExport(input);
  const { contentMarkdown: _body, ...metadata } = input.documents[0];
  void _body;
  assert.deepEqual(manifest(result), {
    format: "zhiyu-markdown-export",
    version: 1,
    collections: input.collections,
    documents: [{ ...metadata, file: markdown(result)[0].name }],
  });
});

test("默认跳过回收站并给出数量，显式选择时保留删除状态", () => {
  const input = snapshot(["保留", "已删除"]);
  input.documents[1].deletedAt = timestamp;
  const usual = createMarkdownExport(input);
  assert.equal(usual.documentCount, 1);
  assert.equal(usual.excludedTrashCount, 1);
  assert.deepEqual(
    markdown(usual).map((file) => file.name),
    [`保留--${uuid(10)}.md`],
  );
  const all = createMarkdownExport(input, { includeTrash: true });
  assert.equal(all.documentCount, 2);
  assert.equal(all.excludedTrashCount, 0);
  assert.equal(manifest(all).documents[1].deletedAt, timestamp);
});

test("标题中的路径、Windows 非法字符与控制字符不成为导出路径", () => {
  const result = createMarkdownExport(snapshot(['../../目录\\文件:<>"|?*.\u0001x']));
  const name = markdown(result)[0].name;
  assert.doesNotMatch(name, /[<>:"/\\|?*]/);
  assert.ok(Array.from(name).every((character) => character.codePointAt(0)! >= 32));
  assert.doesNotMatch(name, /^\./);
  assert.match(name, /目录/);
  assert.match(name, new RegExp(`--${uuid(10)}\\.md$`));
});

test("Windows 设备名和带扩展名的保留名称有安全前缀", () => {
  const names = ["CON", "prn.txt", "AUX", "NUL", "COM1", "LPT9", "COM¹", "lpt³.log"];
  const files = markdown(createMarkdownExport(snapshot(names)));
  assert.equal(files.length, names.length);
  for (const file of files) assert.ok(file.name.startsWith("_"), file.name);
});

test("点号标题有可读后备名称，尾点不会保留在标题部分", () => {
  const files = markdown(createMarkdownExport(snapshot(["..", "...", "标题..."])));
  assert.ok(files[0].name.startsWith("未命名笔记--"));
  assert.ok(files[1].name.startsWith("未命名笔记--"));
  assert.ok(files[2].name.startsWith("标题--"));
});

test("同名、大小写相同和 Unicode 等价标题都不会覆盖彼此", () => {
  const result = createMarkdownExport(snapshot(["同名", "同名", "Note", "note", "é", "e\u0301"]));
  const names = markdown(result).map((file) => file.name.toLowerCase().normalize("NFC"));
  assert.equal(new Set(names).size, 6);
});

test("长 emoji 标题的文件名有长度上限且不切断代理对", () => {
  const name = markdown(createMarkdownExport(snapshot(["🌊".repeat(120)])))[0].name;
  assert.ok(name.length <= 160);
  const title = name.slice(0, -`--${uuid(10)}.md`.length);
  assert.ok(title.length > 0);
  assert.doesNotMatch(title, /[\uD800-\uDBFF]$/);
  assert.equal(title, "🌊".repeat(title.length / 2));
});

test("输入顺序不影响输出，原始对象保持不变", () => {
  const input = snapshot(["甲", "乙"]);
  const untouched = structuredClone(input);
  const reversed = structuredClone(input);
  reversed.documents.reverse();
  assert.deepEqual(createMarkdownExport(input), createMarkdownExport(reversed));
  assert.deepEqual(input, untouched);
});

test("清单和值不包含调用方附带的内部凭据或向量", () => {
  const input = snapshot();
  Object.assign(input, { apiKey: "synthetic-secret" });
  Object.assign(input.documents[0], { embedding: [1, 2], authorization: "synthetic-secret" });
  const text = JSON.stringify(createMarkdownExport(input));
  assert.equal(text.includes("synthetic-secret"), false);
  assert.equal(text.includes("embedding"), false);
});

test("空库与空正文可以导出，清单不产生虚构文档", () => {
  const empty = createMarkdownExport({ collections: [], documents: [] });
  assert.equal(empty.documentCount, 0);
  assert.equal(empty.files.length, 1);
  assert.deepEqual(manifest(empty).documents, []);
  const input = snapshot();
  input.documents[0].contentMarkdown = "";
  assert.equal(markdown(createMarkdownExport(input))[0].content, "");
});

test("非法输入与非布尔回收站选项不能悄悄导出", () => {
  const input = snapshot();
  input.documents[0].id = "../outside";
  const invalid = (error: unknown) =>
    error instanceof BackupError && error.code === "INVALID_FORMAT";
  assert.throws(() => createMarkdownExport(input), invalid);
  assert.throws(
    () =>
      createMarkdownExport(snapshot(), { includeTrash: "false" } as unknown as {
        includeTrash: boolean;
      }),
    invalid,
  );
});
