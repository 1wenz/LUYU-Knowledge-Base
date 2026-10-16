import assert from "node:assert/strict";
import test from "node:test";
import { large3TokenCounter } from "../../electron/services/knowledge/providers/tokenizer";
import { chunkMarkdown } from "../../src/lib/domain/chunking";

test("large3 使用真实 cl100k_base 中英文 token，special 文本作为普通数据处理", () => {
  const counter = large3TokenCounter();
  assert.equal(counter.count("hello world"), 2);
  assert.equal(counter.count("你好，世界"), 6);
  assert.ok(counter.count("<|endoftext|>") > 1);
  const source = "# 合成知识\n\n" + "中文知识与 English notes 的合成材料。\n".repeat(100);
  const chunks = chunkMarkdown(source, { maxTokens: 200, overlapTokens: 30 }, counter);
  assert.ok(chunks.length > 3);
  assert.ok(
    chunks.every(
      (chunk) => chunk.tokenCount === counter.count(chunk.content) && chunk.tokenCount <= 200,
    ),
  );
  assert.equal(chunks[0].startOffset, 0);
  assert.equal(chunks.at(-1)!.endOffset, source.length);
  for (let i = 1; i < chunks.length; i++) {
    const overlap = source.slice(chunks[i].startOffset, chunks[i - 1].endOffset);
    assert.ok(overlap.length > 0 && counter.count(overlap) <= 30);
  }
});
