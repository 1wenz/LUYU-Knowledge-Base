import assert from "node:assert/strict";
import test from "node:test";
import {
  DomainError,
  normalizeTitle,
  normalizeTags,
  assertBodySize,
  assertRevision,
  assertMutableRevision,
} from "../../src/lib/domain/validation";
import {
  getSearchTerms,
  prepareKeywordFields,
  planKeywordQuery,
} from "../../src/lib/domain/segmentation";
import { chunkMarkdown, type TokenCounter } from "../../src/lib/domain/chunking";
import { fuseRankedCandidates } from "../../src/lib/domain/rrf";
import { filterValidCitations, selectContext } from "../../src/lib/domain/citations";
import {
  validateEmbeddingBatch,
  cosineSimilarity,
  validateRerankResults,
} from "../../src/lib/domain/vectors";

test("标题按 Unicode 字符校验，标签 trim 去重，正文按 UTF-8 字节限制", () => {
  assert.equal(normalizeTitle("  研究笔记  "), "研究笔记");
  assert.equal(normalizeTitle("😀".repeat(120)).length, 240);
  assert.deepEqual(normalizeTags([" 检索 ", "检索", "中文"]), ["检索", "中文"]);
  assert.throws(() => normalizeTitle(" "), DomainError);
  assert.throws(() => normalizeTitle("😀".repeat(121)), DomainError);
  assert.throws(() => normalizeTags([""]), DomainError);
  assert.throws(() => normalizeTags(Array.from({ length: 13 }, (_, i) => String(i))), DomainError);
  assert.throws(() => normalizeTags(["词".repeat(33)]), DomainError);
  assert.doesNotThrow(() => assertBodySize("x".repeat(2 * 1024 * 1024)));
  assert.throws(
    () => assertBodySize("中".repeat(700_000)),
    (error: unknown) => error instanceof DomainError && error.field === "contentMarkdown",
  );
});

test("保存、收藏、删除与恢复使用同一 revision 冲突规则", () => {
  assert.throws(() => assertRevision(0), DomainError);
  assert.throws(() => assertRevision(1.5), DomainError);
  assert.doesNotThrow(() => assertMutableRevision({ revision: 3, deletedAt: null }, 3, false));
  assert.throws(
    () => assertMutableRevision({ revision: 3, deletedAt: null }, 2, false),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.throws(
    () => assertMutableRevision({ revision: 3, deletedAt: "deleted" }, 3, false),
    (error: unknown) => error instanceof DomainError && error.code === "NOT_FOUND",
  );
  assert.doesNotThrow(() => assertMutableRevision({ revision: 3, deletedAt: "deleted" }, 3, true));
  assert.throws(() => assertMutableRevision(null, 1, true), DomainError);
  assert.throws(
    () => assertMutableRevision({ revision: 3, deletedAt: null }, 3, true),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
});

test("中文词项在写入和查询一致，英文与全角字符统一规范", () => {
  const query = planKeywordQuery(" 中文知识库 ＯＰＥＮＲＯＵＴＥＲ embeddings ");
  const terms = getSearchTerms("中文知识库 OpenRouter embeddings");
  assert.deepEqual(query.terms, terms);
  assert.ok(terms.includes("中文"));
  assert.equal(terms.filter((term) => /^\p{Script=Han}+$/u.test(term)).join(""), "中文知识库");
  assert.ok(terms.includes("openrouter"));
  const fields = prepareKeywordFields({ title: "中文知识库", tags: ["搜索"], content: "正文内容" });
  assert.equal(fields.titleTerms, getSearchTerms("中文知识库").join(" "));
  assert.equal(fields.tagTerms, "搜索");
  assert.equal(fields.bodyTerms, getSearchTerms("正文内容").join(" "));
});

test("字面补召回转义通配符，单字和双字走受限短词分支", () => {
  assert.equal(planKeywordQuery("知").shortQuery, true);
  assert.equal(planKeywordQuery("知识").shortQuery, true);
  assert.equal(planKeywordQuery("知识库").shortQuery, false);
  assert.equal(planKeywordQuery("a_%\\b").literalPattern, "%a\\_\\%\\\\b%");
  assert.throws(() => planKeywordQuery(" "), DomainError);
  assert.throws(() => planKeywordQuery("😀".repeat(2001)), DomainError);
});

// Production supplies the model tokenizer; Intl.Segmenter is only used for FTS.
const counter: TokenCounter = {
  count: (text) =>
    Array.from(text).reduce((sum, ch) => sum + (/\p{Script=Han}/u.test(ch) ? 2 : 1), 0),
};

test("分块使用注入的 token 计数器，保留原文行号和可验证 overlap", () => {
  const source = "# 标题\n\n第一段文字\n\n第二段文字\n\n```ts\nconst value = true;\n```";
  const chunks = chunkMarkdown(source, { maxTokens: 16, overlapTokens: 3 }, counter);
  assert.ok(chunks.length > 2);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1)!.endOffset, source.length);
  for (const chunk of chunks) {
    assert.equal(chunk.content, source.slice(chunk.startOffset, chunk.endOffset));
    assert.equal(chunk.tokenCount, counter.count(chunk.content));
    assert.ok(chunk.tokenCount <= 16);
    assert.equal(chunk.startLine, source.slice(0, chunk.startOffset).split("\n").length);
    assert.equal(chunk.endLine, source.slice(0, chunk.endOffset - 1).split("\n").length);
  }
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].startOffset < chunks[i - 1].endOffset);
    assert.ok(chunks[i].endOffset > chunks[i - 1].endOffset);
    const overlap = source.slice(chunks[i].startOffset, chunks[i - 1].endOffset);
    assert.ok(counter.count(overlap) <= 3);
  }
});

test("超长代码块也切分，空文档不建块，Unicode 不切断代理对", () => {
  const source = "```txt\r\n" + "中😀hello ".repeat(100) + "\r\n```";
  const chunks = chunkMarkdown(source, { maxTokens: 40, overlapTokens: 4 }, counter);
  assert.ok(chunks.length > 20);
  assert.ok(
    chunks.every(
      (chunk) => chunk.tokenCount <= 40 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk.content),
    ),
  );
  assert.equal(chunks.at(-1)!.endLine, 3);
  assert.deepEqual(chunkMarkdown(" \r\n ", { maxTokens: 40, overlapTokens: 4 }, counter), []);
  assert.throws(
    () => chunkMarkdown("文本", { maxTokens: 10, overlapTokens: 5 }, counter),
    DomainError,
  );
});

test("加权 RRF 去重，重复条目不增加分数，同分按 chunkId 稳定排序", () => {
  const result = fuseRankedCandidates(
    {
      keyword: [
        { id: "b", item: "B", rank: 1 },
        { id: "a", item: "A", rank: 2 },
        { id: "b", item: "B", rank: 3 },
      ],
      vector: [
        { id: "a", item: "A", rank: 1 },
        { id: "b", item: "B", rank: 2 },
      ],
    },
    { keywordWeight: 0.5, limit: 50 },
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(result[0].rrfScore, 0.5 / 62 + 0.5 / 61);
  assert.equal(result[0].keywordRank, 2);
  assert.equal(result[0].vectorRank, 1);
  assert.deepEqual(
    fuseRankedCandidates({ keyword: [], vector: [] }, { keywordWeight: 0.5, limit: 50 }),
    [],
  );
  assert.equal(
    fuseRankedCandidates(
      { keyword: [{ id: "a", item: 1, rank: 1 }], vector: [] },
      { keywordWeight: 1, limit: 1 },
    )[0].rrfScore,
    1 / 61,
  );
  assert.throws(
    () => fuseRankedCandidates({ keyword: [], vector: [] }, { keywordWeight: NaN, limit: 1 }),
    DomainError,
  );
});

test("embedding 校验重排响应 index，拒绝数量、维度、有限值与零向量异常", () => {
  assert.deepEqual(
    validateEmbeddingBatch(
      {
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      },
      2,
      2,
    ),
    [
      [1, 0],
      [0, 1],
    ],
  );
  for (const data of [
    [],
    [{ index: 0, embedding: [1] }],
    [{ index: 0, embedding: [NaN, 1] }],
    [{ index: 0, embedding: [0, 0] }],
    [{ index: 1, embedding: [1, 0] }],
  ]) {
    assert.throws(() => validateEmbeddingBatch({ data }, 1, 2), DomainError);
  }
  assert.throws(
    () =>
      validateEmbeddingBatch(
        {
          data: [
            { index: 0, embedding: [1, 0] },
            { index: 0, embedding: [0, 1] },
          ],
        },
        2,
        2,
      ),
    DomainError,
  );
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("Cohere 结果拒绝越界、重复 index 和非法分数", () => {
  assert.deepEqual(
    validateRerankResults(
      {
        results: [
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.2 },
        ],
      },
      2,
      2,
    ),
    [
      { index: 1, score: 0.9 },
      { index: 0, score: 0.2 },
    ],
  );
  for (const results of [
    [{ index: 2, relevance_score: 0.5 }],
    [{ index: 0, relevance_score: Infinity }],
    [
      { index: 0, relevance_score: 0.5 },
      { index: 0, relevance_score: 0.4 },
    ],
  ]) {
    assert.throws(() => validateRerankResults({ results }, 2, results.length), DomainError);
  }
});

test("引用返回本次上下文的规范来源，拒绝旧 revision、伪造范围与重复来源", () => {
  const source = {
    chunkId: "a",
    documentId: "doc-a",
    documentRevision: 3,
    title: "有效来源",
    startLine: 2,
    endLine: 4,
  };
  const result = filterValidCitations(
    [
      source,
      source,
      { ...source, documentRevision: 2 },
      { ...source, chunkId: "missing" },
      { ...source, endLine: 400 },
    ],
    [source],
  );
  assert.deepEqual(result, [source]);
  assert.equal(result[0], source);
});

test("上下文同时受总 token、片段数与每文档上限约束", () => {
  const candidates = [
    { documentId: "a", content: "12345" },
    { documentId: "a", content: "67890" },
    { documentId: "b", content: "123456" },
    { documentId: "c", content: "12" },
  ];
  const result = selectContext(
    candidates,
    { tokenBudget: 10, maxChunks: 3, maxChunksPerDocument: 1 },
    counter,
  );
  assert.deepEqual(result.chunks, [candidates[0], candidates[3]]);
  assert.equal(result.tokens, 7);
});
