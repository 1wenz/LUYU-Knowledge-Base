import { DomainError } from "./validation";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function malformed(message: string): DomainError {
  return new DomainError("SCHEMA_MISMATCH", message);
}

/** Accept raw JSON and validate before any provider index is dereferenced. */
export function validateEmbeddingBatch(
  response: unknown,
  expectedCount: number,
  dimensions: number,
): number[][] {
  if (
    !Number.isSafeInteger(expectedCount) ||
    expectedCount < 1 ||
    !Number.isSafeInteger(dimensions) ||
    dimensions < 1
  ) {
    throw new DomainError("INVALID_INPUT", "embedding 批次参数无效");
  }
  if (
    !isRecord(response) ||
    !Array.isArray(response.data) ||
    response.data.length !== expectedCount
  ) {
    throw malformed("embedding 响应数量不匹配");
  }
  const mapped = new Map<number, number[]>();
  for (const entry of response.data) {
    if (
      !isRecord(entry) ||
      typeof entry.index !== "number" ||
      !Number.isSafeInteger(entry.index) ||
      entry.index < 0 ||
      entry.index >= expectedCount ||
      mapped.has(entry.index)
    ) {
      throw malformed("embedding 响应 index 无效");
    }
    if (!Array.isArray(entry.embedding) || entry.embedding.length !== dimensions)
      throw malformed("embedding 维度无效");
    const vector: number[] = [];
    let normSquared = 0;
    for (const value of entry.embedding) {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        !Number.isFinite(Math.fround(value))
      ) {
        throw malformed("embedding 必须包含有限的 float32 数值");
      }
      const rounded = Math.fround(value);
      vector.push(rounded);
      normSquared += rounded * rounded;
    }
    if (normSquared === 0) throw malformed("embedding 不能是零向量");
    mapped.set(entry.index, vector);
  }
  return Array.from({ length: expectedCount }, (_, index) => {
    const vector = mapped.get(index);
    if (!vector) throw malformed("embedding index 不完整");
    return vector;
  });
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || !left.length)
    throw new DomainError("INVALID_INPUT", "向量维度不一致");
  let leftScale = 0;
  let rightScale = 0;
  for (let i = 0; i < left.length; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i]))
      throw new DomainError("INVALID_INPUT", "向量包含非法数值");
    leftScale = Math.max(leftScale, Math.abs(left[i]));
    rightScale = Math.max(rightScale, Math.abs(right[i]));
  }
  if (!leftScale || !rightScale) throw new DomainError("INVALID_INPUT", "向量不能是零向量");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i] / leftScale;
    const b = right[i] / rightScale;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

export function validateRerankResults(
  response: unknown,
  candidateCount: number,
  topN: number,
): Array<{ index: number; score: number }> {
  if (
    !Number.isSafeInteger(candidateCount) ||
    candidateCount < 0 ||
    !Number.isSafeInteger(topN) ||
    topN < 0 ||
    topN > candidateCount
  ) {
    throw new DomainError("INVALID_INPUT", "Rerank 候选数或 top_n 无效");
  }
  if (!isRecord(response) || !Array.isArray(response.results) || response.results.length !== topN) {
    throw malformed("Rerank 响应数量无效");
  }
  const seen = new Set<number>();
  return response.results.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.index !== "number" ||
      !Number.isSafeInteger(entry.index) ||
      entry.index < 0 ||
      entry.index >= candidateCount ||
      seen.has(entry.index) ||
      typeof entry.relevance_score !== "number" ||
      !Number.isFinite(entry.relevance_score)
    ) {
      throw malformed("Rerank 响应 index 或分数无效");
    }
    seen.add(entry.index);
    return { index: entry.index, score: entry.relevance_score };
  });
}
