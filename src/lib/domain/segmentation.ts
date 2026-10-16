import { DomainError } from "./validation";
import { searchRequestSchema } from "../contracts";

export const NORMALIZER_VERSION = "intl-segmenter-zh-word-nfkc-v1";
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

function normalize(input: string): string {
  return input.normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsSearchCharacter(input: string): boolean {
  return /[\p{L}\p{N}\p{Script=Han}]/u.test(input);
}

export function getSearchTerms(input: string): string[] {
  const normalized = normalize(input);
  const raw = Array.from(segmenter.segment(normalized), ({ segment, isWordLike }) =>
    isWordLike ? segment : "",
  );
  const terms: string[] = [];
  for (const value of raw) {
    const term = value.trim();
    if (!term || !containsSearchCharacter(term)) continue;
    terms.push(term);
  }
  return terms;
}

export type KeywordFields = {
  titleTerms: string;
  tagTerms: string;
  bodyTerms: string;
  phrase: string;
  normalizerVersion: string;
};

export function prepareKeywordFields(input: {
  title: string;
  tags: string[];
  content: string;
}): KeywordFields {
  const titleTerms = getSearchTerms(input.title).join(" ");
  const tagTerms = getSearchTerms(input.tags.join(" ")).join(" ");
  const bodyTerms = getSearchTerms(input.content).join(" ");
  return {
    titleTerms,
    tagTerms,
    bodyTerms,
    phrase: normalize(
      [input.title.trim(), ...input.tags.map((tag) => tag.trim()), input.content.trim()]
        .filter(Boolean)
        .join(" "),
    ),
    normalizerVersion: NORMALIZER_VERSION,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export type KeywordQueryPlan = {
  normalized: string;
  terms: string[];
  shortQuery: boolean;
  literalPattern: string;
};

export function planKeywordQuery(input: string): KeywordQueryPlan {
  if (typeof input !== "string")
    throw new DomainError("INVALID_INPUT", "搜索词必须是文本", "query");
  const parsed = searchRequestSchema.shape.query.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("INVALID_INPUT", "搜索词长度必须为 1–2000 个 Unicode 字符", "query");
  }
  const trimmed = parsed.data;
  const length = Array.from(trimmed).length;
  const normalized = normalize(trimmed);
  return {
    normalized,
    terms: getSearchTerms(normalized),
    shortQuery: length <= 2,
    literalPattern: `%${escapeLike(normalized)}%`,
  };
}
