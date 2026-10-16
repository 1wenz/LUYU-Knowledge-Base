import type { TokenCounter } from "./chunking";
import type { Citation } from "../contracts";
import { DomainError } from "./validation";

export type CitationCandidate = Citation;

function key(value: CitationCandidate): string {
  return `${value.chunkId}:${value.documentId}:${value.documentRevision}`;
}

export function filterValidCitations(
  citations: CitationCandidate[],
  context: CitationCandidate[],
): CitationCandidate[] {
  const allowed = new Map(context.map((item) => [key(item), item]));
  const seen = new Set<string>();
  const result: CitationCandidate[] = [];
  for (const citation of citations) {
    if (
      !Number.isInteger(citation.startLine) ||
      citation.startLine < 1 ||
      !Number.isInteger(citation.endLine) ||
      citation.endLine < citation.startLine
    )
      continue;
    const canonical = allowed.get(key(citation));
    if (!canonical || seen.has(key(canonical))) continue;
    if (
      citation.title !== canonical.title ||
      citation.startLine !== canonical.startLine ||
      citation.endLine !== canonical.endLine
    )
      continue;
    seen.add(key(canonical));
    result.push(canonical);
  }
  return result;
}

export type ContextCandidate = { documentId: string; content: string };

export function selectContext<T extends ContextCandidate>(
  candidates: T[],
  options: { tokenBudget: number; maxChunks: number; maxChunksPerDocument: number },
  counter: TokenCounter,
): { chunks: T[]; tokens: number } {
  if (
    !Number.isInteger(options.tokenBudget) ||
    options.tokenBudget < 1 ||
    !Number.isInteger(options.maxChunks) ||
    options.maxChunks < 1 ||
    !Number.isInteger(options.maxChunksPerDocument) ||
    options.maxChunksPerDocument < 1
  ) {
    throw new DomainError("INVALID_INPUT", "上下文预算参数无效");
  }
  const counts = new Map<string, number>();
  const chunks: T[] = [];
  let tokens = 0;
  for (const candidate of candidates) {
    if (chunks.length >= options.maxChunks) break;
    const documentCount = counts.get(candidate.documentId) ?? 0;
    if (documentCount >= options.maxChunksPerDocument) continue;
    const candidateTokens = counter.count(candidate.content);
    if (!Number.isInteger(candidateTokens) || candidateTokens < 0)
      throw new DomainError("SCHEMA_MISMATCH", "上下文 token 计数无效");
    if (tokens + candidateTokens > options.tokenBudget) continue;
    chunks.push(candidate);
    counts.set(candidate.documentId, documentCount + 1);
    tokens += candidateTokens;
  }
  return { chunks, tokens };
}
