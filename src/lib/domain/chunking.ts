import { DomainError } from "./validation";

/** The production adapter must use the embedding model's tokenizer. */
export type TokenCounter = { count(text: string): number };
export type ChunkConfig = { maxTokens: number; overlapTokens: number };
export type MarkdownChunk = {
  ordinal: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
};
export const SPLITTER_VERSION = "markdown-token-budget-v1";

function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function structure(source: string) {
  const characters = [0];
  let offset = 0;
  for (const character of source) {
    offset += character.length;
    characters.push(offset);
  }
  const preferred: number[] = [];
  const lines = [0];
  let fence: { marker: string; size: number } | undefined;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/, "");
    const start = match.index!;
    const end = start + match[0].length;
    if (match[0].endsWith("\n")) lines.push(end);
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      const marker = delimiter[1][0];
      if (!fence) {
        preferred.push(start);
        fence = { marker, size: delimiter[1].length };
      } else if (
        marker === fence.marker &&
        delimiter[1].length >= fence.size &&
        !delimiter[2].trim()
      ) {
        fence = undefined;
        preferred.push(end);
      }
    } else if (!fence) {
      if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) preferred.push(start);
      if (!line.trim()) preferred.push(end);
    }
  }
  preferred.push(source.length);
  return { characters, preferred: [...new Set(preferred)].sort((a, b) => a - b), lines };
}

export function chunkMarkdown(
  source: string,
  config: ChunkConfig,
  counter: TokenCounter,
): MarkdownChunk[] {
  if (
    !Number.isSafeInteger(config.maxTokens) ||
    config.maxTokens < 1 ||
    !Number.isSafeInteger(config.overlapTokens) ||
    config.overlapTokens < 0 ||
    config.overlapTokens >= config.maxTokens / 2
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "分块上限必须为正整数，重叠必须小于上限的一半",
      "indexing",
    );
  }
  if (typeof source !== "string")
    throw new DomainError("INVALID_INPUT", "正文必须是文本", "contentMarkdown");
  if (!source.trim()) return [];
  const { characters, preferred, lines } = structure(source);
  const count = (start: number, end: number) => {
    const tokens = counter.count(source.slice(start, end));
    if (!Number.isSafeInteger(tokens) || tokens < 0)
      throw new DomainError("SCHEMA_MISMATCH", "token 计数器返回了无效值");
    return tokens;
  };
  const lineAt = (position: number) => lowerBound(lines, position + 1);
  const chunks: MarkdownChunk[] = [];
  let startIndex = 0;
  let previousEnd = 0;
  while (startIndex < characters.length - 1) {
    const start = characters[startIndex];
    // Exponential growth keeps tokenizer work proportional to chunk size.
    let fittingIndex = startIndex;
    let probe = startIndex + 1;
    let failingIndex = characters.length;
    while (probe < characters.length) {
      if (count(start, characters[probe]) > config.maxTokens) {
        failingIndex = probe;
        break;
      }
      fittingIndex = probe;
      if (probe === characters.length - 1) break;
      probe = Math.min(characters.length - 1, startIndex + (probe - startIndex) * 2);
    }
    let lo = fittingIndex + 1;
    let hi = Math.min(failingIndex - 1, characters.length - 1);
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (count(start, characters[mid]) <= config.maxTokens) {
        fittingIndex = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let end = characters[fittingIndex];
    if (end <= previousEnd)
      throw new DomainError("INVALID_INPUT", "单个字符超过剩余分块预算", "indexing");
    // Prefer paragraphs, headings and whole fences, while requiring new source text.
    const boundaryIndex = lowerBound(preferred, end + 1) - 1;
    if (
      boundaryIndex >= 0 &&
      preferred[boundaryIndex] > previousEnd &&
      count(start, preferred[boundaryIndex]) <= config.maxTokens
    )
      end = preferred[boundaryIndex];
    chunks.push({
      ordinal: chunks.length,
      content: source.slice(start, end),
      tokenCount: count(start, end),
      startOffset: start,
      endOffset: end,
      startLine: lineAt(start),
      endLine: lineAt(end - 1),
    });
    if (end === source.length) break;
    const endIndex = lowerBound(characters, end);
    let nextIndex = endIndex;
    // Search a suffix of this bounded chunk; validate each candidate with the tokenizer.
    if (config.overlapTokens > 0) {
      for (let candidate = endIndex - 1; candidate > startIndex; candidate--) {
        if (count(characters[candidate], end) <= config.overlapTokens) nextIndex = candidate;
      }
    }
    previousEnd = end;
    startIndex = nextIndex;
  }
  return chunks;
}
