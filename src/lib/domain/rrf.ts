import { DomainError } from "./validation";

export type RankedCandidate<T> = { id: string; item: T; rank: number };
export type FusedCandidate<T> = {
  id: string;
  item: T;
  rrfScore: number;
  keywordRank?: number;
  vectorRank?: number;
};

export function fuseRankedCandidates<T>(
  lists: { keyword: RankedCandidate<T>[]; vector: RankedCandidate<T>[] },
  options: { keywordWeight: number; vectorWeight?: number; limit: number; k?: number },
): FusedCandidate<T>[] {
  const vectorWeight = options.vectorWeight ?? 1 - options.keywordWeight;
  const k = options.k ?? 60;
  if (
    !Number.isFinite(options.keywordWeight) ||
    !Number.isFinite(vectorWeight) ||
    options.keywordWeight < 0 ||
    vectorWeight < 0 ||
    options.keywordWeight + vectorWeight > 1.0000001 ||
    !Number.isInteger(options.limit) ||
    options.limit < 0 ||
    !Number.isInteger(k) ||
    k < 1
  ) {
    throw new DomainError("INVALID_INPUT", "RRF 参数无效");
  }
  const byId = new Map<string, FusedCandidate<T>>();
  const add = (candidate: RankedCandidate<T>, branch: "keyword" | "vector", weight: number) => {
    if (!Number.isInteger(candidate.rank) || candidate.rank < 1) {
      throw new DomainError("INVALID_INPUT", "召回名次必须从 1 开始");
    }
    const current = byId.get(candidate.id) ?? {
      id: candidate.id,
      item: candidate.item,
      rrfScore: 0,
    };
    const rankKey = branch === "keyword" ? "keywordRank" : "vectorRank";
    if (current[rankKey] === undefined) {
      current[rankKey] = candidate.rank;
      current.rrfScore += weight / (k + candidate.rank);
    }
    byId.set(candidate.id, current);
  };
  for (const candidate of lists.keyword) add(candidate, "keyword", options.keywordWeight);
  for (const candidate of lists.vector) add(candidate, "vector", vectorWeight);
  return [...byId.values()]
    .sort(
      (left, right) =>
        right.rrfScore - left.rrfScore || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, options.limit);
}
