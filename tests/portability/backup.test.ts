import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  BackupError,
  backupLimits,
  createBackup,
  readBackup,
  type BackupSnapshot,
} from "../../src/lib/portability/backup.js";

const collectionId = "00000000-0000-4000-8000-000000000001";
const documentId = "00000000-0000-4000-8000-000000000002";
const laterId = "00000000-0000-4000-8000-000000000003";
const timestamp = "2026-10-16T08:00:00.000Z";
const options = { appVersion: "0.1.0", exportedAt: timestamp };

function snapshot(): BackupSnapshot {
  return {
    collections: [{ id: collectionId, name: "技术笔记", sortOrder: 0 }],
    documents: [
      {
        id: documentId,
        collectionId,
        title: "混合搜索 🖌️",
        contentMarkdown: '# 标题\n\n中文、引号"、反斜杠\\与 emoji 🌊\n\n```ts\nconst x = 1;\n```\n',
        tags: ["向量", "研究"],
        favorite: true,
        revision: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      },
    ],
  };
}

function hasCode(code: BackupError["code"]) {
  return (error: unknown) => error instanceof BackupError && error.code === code;
}

test("备份往返完整保留中文、Markdown、元数据与回收站", async () => {
  const input = snapshot();
  input.documents[0].deletedAt = timestamp;
  const text = await createBackup(input, options);
  const restored = await readBackup(text);
  assert.deepEqual(restored.payload, input);
  assert.equal(restored.version, 1);
  assert.equal(restored.appVersion, options.appVersion);
  assert.equal(restored.exportedAt, timestamp);
  assert.match(restored.integrity.digest, /^[a-f0-9]{64}$/);
});

test("相同数据不同条目顺序产生相同备份且不修改原输入", async () => {
  const first = snapshot();
  const secondDocument = { ...first.documents[0], id: laterId, title: "第二篇", tags: [] };
  first.documents.unshift(secondDocument);
  const untouched = structuredClone(first);
  const reverse = structuredClone(first);
  reverse.documents.reverse();
  assert.equal(await createBackup(first, options), await createBackup(reverse, options));
  assert.deepEqual(first, untouched);
});

test("空知识库保持为空", async () => {
  const empty = { collections: [], documents: [] };
  assert.deepEqual((await readBackup(await createBackup(empty, options))).payload, empty);
});

test("未分类笔记可以往返", async () => {
  const input = snapshot();
  input.documents[0].collectionId = null;
  input.collections = [];
  assert.deepEqual((await readBackup(await createBackup(input, options))).payload, input);
});

test("导出白名单忽略调用方附带的凭据与内部字段", async () => {
  const input = snapshot();
  const withExtra = Object.assign(input, { apiKey: "synthetic-secret" });
  Object.assign(withExtra.documents[0], { authorization: "synthetic-secret", embedding: [1, 2] });
  const text = await createBackup(withExtra, options);
  assert.equal(text.includes("synthetic-secret"), false);
  assert.equal(text.includes("embedding"), false);
});

test("内容被改写但摘要未变时拒绝恢复", async () => {
  const text = await createBackup(snapshot(), options);
  const object = JSON.parse(text);
  object.payload.documents[0].contentMarkdown = "被篡改";
  await assert.rejects(readBackup(JSON.stringify(object)), hasCode("INTEGRITY_MISMATCH"));
});

test("导出时间和应用版本也包含在完整性校验内", async () => {
  for (const changed of [{ appVersion: "0.2.0" }, { exportedAt: "2026-10-17T08:00:00.000Z" }]) {
    const object = JSON.parse(await createBackup(snapshot(), options));
    Object.assign(object, changed);
    await assert.rejects(readBackup(JSON.stringify(object)), hasCode("INTEGRITY_MISMATCH"));
  }
});

test("损坏 JSON 不泄漏输入原文", async () => {
  await assert.rejects(readBackup('{"synthetic-secret":'), (error: unknown) => {
    assert.ok(hasCode("INVALID_JSON")(error));
    assert.equal((error as Error).message.includes("synthetic-secret"), false);
    return true;
  });
});

test("不支持的未来版本不能按当前格式恢复", async () => {
  const object = JSON.parse(await createBackup(snapshot(), options));
  object.version = 2;
  await assert.rejects(readBackup(JSON.stringify(object)), hasCode("UNSUPPORTED_VERSION"));
});

test("外来格式、未知字段和不完整摘要被拒绝", async () => {
  const encoded = await createBackup(snapshot(), options);
  for (const change of [
    (value: Record<string, unknown>) => {
      value.format = "another-tool";
    },
    (value: Record<string, unknown>) => {
      value.apiKey = "synthetic-secret";
    },
    (value: Record<string, unknown>) => {
      value.integrity = { algorithm: "MD5", digest: "abc" };
    },
    (value: Record<string, unknown>) => {
      delete value.payload;
    },
  ]) {
    const object = JSON.parse(encoded);
    change(object);
    await assert.rejects(readBackup(JSON.stringify(object)), hasCode("INVALID_FORMAT"));
  }
});

test("备份对象拒绝隐式原型键", async () => {
  const object = JSON.parse(await createBackup(snapshot(), options));
  Object.defineProperty(object.payload.documents[0], "__proto__", {
    value: { polluted: true },
    enumerable: true,
  });
  await assert.rejects(readBackup(JSON.stringify(object)), hasCode("INVALID_FORMAT"));
  assert.equal(Object.prototype.hasOwnProperty.call({}, "polluted"), false);
});

test("重复文档或分类 id 不可导出", async () => {
  for (const key of ["documents", "collections"] as const) {
    const input = snapshot();
    if (key === "documents") input.documents.push({ ...input.documents[0] });
    else input.collections.push({ ...input.collections[0] });
    await assert.rejects(createBackup(input, options), hasCode("DUPLICATE_ID"));
  }
});

test("笔记引用不存在分类时拒绝导出", async () => {
  const input = snapshot();
  input.collections = [];
  await assert.rejects(createBackup(input, options), hasCode("INVALID_REFERENCE"));
});

test("无效标识、时间、revision 与布尔值被拒绝", async () => {
  const changes: Array<(input: BackupSnapshot) => void> = [
    (input) => {
      input.documents[0].id = "../outside";
    },
    (input) => {
      input.documents[0].createdAt = "2026-02-30T08:00:00.000Z";
    },
    (input) => {
      input.documents[0].revision = 0;
    },
    (input) => {
      input.documents[0].revision = 1.5;
    },
    (input) => {
      input.documents[0].title = "   ";
    },
    (input) => {
      input.documents[0].tags = ["重复", "重复"];
    },
    (input) => {
      Object.assign(input.documents[0], { favorite: "yes" });
    },
  ];
  for (const change of changes) {
    const input = snapshot();
    change(input);
    await assert.rejects(createBackup(input, options), hasCode("INVALID_FORMAT"));
  }
});

test("限制按 UTF-8 字节而非 JS 字符数执行", async () => {
  const input = snapshot();
  input.documents[0].contentMarkdown = "中".repeat(
    Math.floor(backupLimits.maxDocumentBytes / 3) + 1,
  );
  await assert.rejects(createBackup(input, options), hasCode("LIMIT_EXCEEDED"));
});

test("读取前限制备份总大小", async () => {
  await assert.rejects(
    readBackup(" ".repeat(backupLimits.maxFileBytes + 1)),
    hasCode("LIMIT_EXCEEDED"),
  );
});

test("导出时间无效时在创建阶段报错", async () => {
  await assert.rejects(
    createBackup(snapshot(), { ...options, exportedAt: "invalid" }),
    hasCode("INVALID_FORMAT"),
  );
});

test("空正文和 Unicode 上限可无损往返", async () => {
  const input = snapshot();
  input.documents[0].contentMarkdown = "";
  input.documents[0].title = "🌊".repeat(120);
  input.documents[0].tags = ["🌊".repeat(32)];
  assert.deepEqual((await readBackup(await createBackup(input, options))).payload, input);
});

test("读取时拒绝嵌套未知字段和缺失字段", async () => {
  const encoded = await createBackup(snapshot(), options);
  const changes = [
    (value: ReturnType<typeof snapshot>) => {
      Object.assign(value.documents[0], { apiKey: "synthetic-secret" });
    },
    (value: ReturnType<typeof snapshot>) => {
      Object.assign(value.collections[0], { color: "blue" });
    },
    (value: ReturnType<typeof snapshot>) => {
      Reflect.deleteProperty(value.documents[0], "collectionId");
    },
    (value: ReturnType<typeof snapshot>) => {
      Reflect.deleteProperty(value.collections[0], "sortOrder");
    },
  ];
  for (const change of changes) {
    const object = JSON.parse(encoded);
    change(object.payload);
    await assert.rejects(readBackup(JSON.stringify(object)), hasCode("INVALID_FORMAT"));
  }
});

test("备份与共享契约保持 UUID、分类和标签范围一致", async () => {
  const changes: Array<(input: BackupSnapshot) => void> = [
    (input) => {
      input.documents[0].id = "legacy-safe-id";
    },
    (input) => {
      input.collections[0].sortOrder = -1;
    },
    (input) => {
      input.collections[0].name = "类".repeat(81);
    },
    (input) => {
      input.documents[0].tags = Array.from({ length: 13 }, (_, index) => String(index));
    },
    (input) => {
      input.documents[0].tags = ["中".repeat(33)];
    },
    (input) => {
      input.documents[0].tags = [" 标签 "];
    },
  ];
  for (const change of changes) {
    const input = snapshot();
    change(input);
    await assert.rejects(createBackup(input, options), hasCode("INVALID_FORMAT"));
  }
});

test("条目数量有显式上限", async () => {
  await assert.rejects(
    createBackup(
      {
        ...snapshot(),
        documents: Array.from(
          { length: backupLimits.maxDocuments + 1 },
          () => snapshot().documents[0],
        ),
      },
      options,
    ),
    hasCode("LIMIT_EXCEEDED"),
  );
  await assert.rejects(
    createBackup(
      {
        ...snapshot(),
        collections: Array.from(
          { length: backupLimits.maxCollections + 1 },
          () => snapshot().collections[0],
        ),
      },
      options,
    ),
    hasCode("LIMIT_EXCEEDED"),
  );
});

test("导出总大小计入 JSON 转义开销且超限时拒绝", async () => {
  const input = snapshot();
  const contentMarkdown = "\u0001".repeat(backupLimits.maxDocumentBytes);
  input.documents = Array.from({ length: 3 }, (_, index) => ({
    ...input.documents[0],
    id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    contentMarkdown,
  }));
  await assert.rejects(createBackup(input, options), hasCode("LIMIT_EXCEEDED"));
});

test("刚好达到正文 UTF-8 上限时可以备份", async () => {
  const input = snapshot();
  input.documents[0].contentMarkdown = "a".repeat(backupLimits.maxDocumentBytes);
  assert.equal(
    (await readBackup(await createBackup(input, options))).payload.documents[0].contentMarkdown
      .length,
    backupLimits.maxDocumentBytes,
  );
});

test("重新排版 JSON 不改变完整性校验", async () => {
  const text = await createBackup(snapshot(), options);
  const pretty = JSON.stringify(JSON.parse(text), null, 2);
  assert.deepEqual(await readBackup(pretty), await readBackup(text));
});
