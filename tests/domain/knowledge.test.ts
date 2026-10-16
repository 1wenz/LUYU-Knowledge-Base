import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserRepository,
  storageKey,
  type StorageEnvironment,
} from "../../src/features/knowledge/repository";
import { filterNotes, type NoteDraft } from "../../src/features/knowledge/model";

function memoryEnvironment(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(storageKey, initial);
  let reload: (() => void) | undefined;
  let shouldFailWrite = false;
  const environment: StorageEnvironment = {
    getStorage: () => ({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (shouldFailWrite) throw new Error("Storage full");
        data.set(key, value);
      },
    }),
    onStorageChange(callback) {
      reload = callback;
      return () => {
        reload = undefined;
      };
    },
  };
  const repository = createBrowserRepository(environment);
  repository.subscribe(() => undefined);
  return {
    repository,
    data,
    environment,
    reload: () => reload?.(),
    failWrites: () => {
      shouldFailWrite = true;
    },
  };
}

const draft: NoteDraft = {
  title: "  我的研究  ",
  content: "完整保留正文与换行\nmountain-lake",
  collectionId: "engineering",
  tags: ["阅读", " 阅读 ", "", "笔记"],
};

test("创建、编辑、收藏后重新读取仍保留数据", () => {
  const { repository, environment } = memoryEnvironment();
  const id = repository.save(draft);
  let note = repository.getSnapshot().notes.find((item) => item.id === id)!;
  assert.equal(note.title, "我的研究");
  assert.deepEqual(note.tags, ["阅读", "笔记"]);
  repository.save({ ...draft, title: "更新的研究" }, id);
  repository.toggleFavorite(id);
  const reopened = createBrowserRepository(environment);
  reopened.subscribe(() => undefined);
  note = reopened.getSnapshot().notes.find((item) => item.id === id)!;
  assert.equal(note.title, "更新的研究");
  assert.equal(note.content, draft.content);
  assert.equal(note.favorite, true);
});

test("搜索标题、内容、标签并与分类和收藏组合", () => {
  const { repository } = memoryEnvironment(JSON.stringify({ version: 1, notes: [] }));
  const id = repository.save(draft);
  repository.toggleFavorite(id);
  const notes = repository.getSnapshot().notes;
  assert.equal(filterNotes(notes, { view: "all", query: "MOUNTAIN-LAKE" }).length, 1);
  assert.equal(filterNotes(notes, { view: "all", query: "阅读" }).length, 1);
  assert.equal(
    filterNotes(notes, { view: "favorites", query: "研究", collectionId: "engineering" }).length,
    1,
  );
  assert.equal(filterNotes(notes, { view: "all", query: "", collectionId: "product" }).length, 0);
});

test("删除最后一条笔记后，空库不会被示例数据重新填充", () => {
  const { repository, environment } = memoryEnvironment(JSON.stringify({ version: 1, notes: [] }));
  const id = repository.save(draft);
  repository.remove(id);
  const reopened = createBrowserRepository(environment);
  reopened.subscribe(() => undefined);
  assert.deepEqual(reopened.getSnapshot().notes, []);
});

test("损坏或不支持的数据不会被写入覆盖", () => {
  for (const initial of [
    "{broken",
    JSON.stringify({ version: 2, notes: [] }),
    JSON.stringify({ version: 1, notes: [{ id: "incomplete" }] }),
  ]) {
    const { repository, data } = memoryEnvironment(initial);
    assert.equal(repository.getSnapshot().blocked, true);
    assert.throws(() => repository.save(draft), /无法保存/);
    assert.equal(data.get(storageKey), initial);
  }
});

test("存储写入失败时，原笔记和持久化数据不变", () => {
  const { repository, data, failWrites } = memoryEnvironment();
  const before = repository.getSnapshot();
  const persisted = data.get(storageKey);
  failWrites();
  assert.throws(() => repository.save(draft), /保存失败/);
  assert.equal(repository.getSnapshot(), before);
  assert.equal(data.get(storageKey), persisted);
});

test("空标题与已经被删除的笔记不能保存", () => {
  const { repository } = memoryEnvironment();
  assert.throws(() => repository.save({ ...draft, title: "  " }), /标题/);
  assert.throws(() => repository.save(draft, "does-not-exist"), /已不存在/);
});

test("收到其他窗口的存储变更后更新视图", () => {
  const { repository, data, reload } = memoryEnvironment();
  data.set(storageKey, JSON.stringify({ version: 1, notes: [] }));
  reload();
  assert.deepEqual(repository.getSnapshot().notes, []);
});
