import { DomainError } from "./validation";

export type EmbeddingResponse = { data: Array<{ index: number; embedding: number[] }> };

export function validateEmbeddingBatch(
  response: EmbeddingResponse,
  expectedCount: number,
  dimensions: number,
): number[][] {
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1 ||
    !Number.isInteger(dimensions) ||
    dimensions < 1
  ) {
    throw new DomainError("INVALID_INPUT", "embedding 批次参数无效");
  }
  if (!response || !Array.isArray(response.data) || response.data.length !== expectedCount) {
    throw new DomainError("SCHEMA_MISMATCH", "embedding 响应数量不匹配");
  }
  const output: Array<number[] | undefined> = Array.from({ length: expectedCount });
  for (const entry of response.data) {
    if (
      !Number.isInteger(entry.index) ||
      entry.index < 0 ||
      entry.index >= expectedCount ||
      output[entry.index]
    ) {
      throw new DomainError("SCHEMA_MISMATCH", "embedding 响应 index 无效");
    }
    if (
      !Array.isArray(entry.embedding) ||
      entry.embedding.length !== dimensions ||
      !entry.embedding.every((value) => Number.isFinite(value))
    ) {
      throw new DomainError("SCHEMA_MISMATCH", "embedding 维度或数值无效");
    }
    const magnitude = Math.sqrt(entry.embedding.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) throw new DomainError("SCHEMA_MISMATCH", "embedding 不能是零向量");
    output[entry.index] = entry.embedding;
  }
  if (output.some((entry) => entry === undefined))
    throw new DomainError("SCHEMA_MISMATCH", "embedding index 不完整");
  return output as number[][];
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0)
    throw new DomainError("INVALID_INPUT", "向量维度不一致");
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index]))
      throw new DomainError("INVALID_INPUT", "向量包含非法数值");
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0)
    throw new DomainError("INVALID_INPUT", "向量不能是零向量");
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export type RerankResponse = { results: Array<{ index: number; relevance_score: number }> };

export function validateRerankResults(
  response: RerankResponse,
  candidateCount: number,
  topN: number,
) {
  if (
    !response ||
    !Array.isArray(response.results) ||
    !Number.isInteger(topN) ||
    topN < 0 ||
    response.results.length > topN
  ) {
    throw new DomainError("SCHEMA_MISMATCH", "Rerank 响应数量无效");
  }
  const seen = new Set<number>();
  return response.results.map((entry) => {
    if (
      !Number.isInteger(entry.index) ||
      entry.index < 0 ||
      entry.index >= candidateCount ||
      seen.has(entry.index) ||
      !Number.isFinite(entry.relevance_score)
    ) {
      throw new DomainError("SCHEMA_MISMATCH", "Rerank 响应 index 或分数无效");
    }
    seen.add(entry.index);
    return { index: entry.index, score: entry.relevance_score };
  });
}
