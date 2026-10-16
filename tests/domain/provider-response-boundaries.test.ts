import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../src/lib/domain/validation";
import {
  validateEmbeddingBatch,
  validateRerankResults,
  cosineSimilarity,
} from "../../src/lib/domain/vectors";

const schemaError = (error: unknown) =>
  error instanceof DomainError && error.code === "SCHEMA_MISMATCH";

test("未可信 provider JSON 的空元素和错误字段类型都返回领域错误", () => {
  for (const response of [
    null,
    {},
    { data: [null] },
    { data: [{ index: 0, embedding: "private body" }] },
  ]) {
    assert.throws(() => validateEmbeddingBatch(response, 1, 2), schemaError);
  }
  for (const response of [
    null,
    {},
    { results: [null] },
    { results: [{ index: "0", relevance_score: 0.5 }] },
  ]) {
    assert.throws(() => validateRerankResults(response, 1, 1), schemaError);
  }
});

test("embedding 必须可表示为非零 float32，并返回独立的已校验数组", () => {
  for (const vector of [
    [1e100, 1],
    [Number.MIN_VALUE, 0],
  ]) {
    assert.throws(
      () => validateEmbeddingBatch({ data: [{ index: 0, embedding: vector }] }, 1, 2),
      schemaError,
    );
  }
  const original = [1, 0];
  const result = validateEmbeddingBatch({ data: [{ index: 0, embedding: original }] }, 1, 2);
  original[0] = NaN;
  assert.deepEqual(result, [[1, 0]]);
});

test("Rerank 数量与 top_n 一致，cosine 有限且位于公开分数范围", () => {
  assert.throws(() => validateRerankResults({ results: [] }, 2, 1), schemaError);
  assert.throws(
    () => validateRerankResults({ results: [{ index: 0, relevance_score: 0.2 }] }, 1, 2),
    DomainError,
  );
  const score = cosineSimilarity([1e150, 2e150], [1e150, 2e150]);
  assert.ok(Number.isFinite(score));
  assert.ok(score <= 1 && score >= -1);
});
