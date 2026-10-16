import { getEncoding } from "js-tiktoken";
import type { TokenCounter } from "../../../../src/lib/domain/chunking";

// text-embedding-3-large uses cl100k_base; this is independent of Chinese FTS segmentation.
export const TOKENIZER_VERSION = "js-tiktoken-1.0.21-cl100k_base-v1";
let counter: TokenCounter | undefined;
export function large3TokenCounter(): TokenCounter {
  if (!counter) {
    const encoding = getEncoding("cl100k_base");
    counter = { count: (text) => encoding.encode(text, [], []).length };
  }
  return counter;
}
