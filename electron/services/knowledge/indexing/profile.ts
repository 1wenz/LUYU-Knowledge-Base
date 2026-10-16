import { createHash } from "node:crypto";
import { publicSettingsSchema, type PublicSettings } from "../../../../src/lib/contracts";
import { NORMALIZER_VERSION } from "../../../../src/lib/domain/segmentation";
import { SPLITTER_VERSION } from "../../../../src/lib/domain/chunking";
import { DomainError } from "../../../../src/lib/domain/validation";

export type IndexProfile = {
  fingerprint: string;
  model: "openai/text-embedding-3-large";
  dimensions: 1536 | 3072;
  chunkConfig: PublicSettings["indexing"];
  normalizerVersion: string;
  splitterVersion: string;
  tokenizerVersion: string;
};
export type Generation = IndexProfile & { id: string; state: "active" | "building" };
export const hashText = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function indexProfile(settings: PublicSettings, tokenizerVersion: string): IndexProfile {
  const parsed = publicSettingsSchema.safeParse(settings);
  if (!parsed.success || !tokenizerVersion.trim())
    throw new DomainError("INVALID_INPUT", "索引配置或 tokenizer 版本无效", "indexing");
  const value = {
    model: parsed.data.models.embeddingModel,
    dimensions: parsed.data.models.embeddingDimensions,
    chunkConfig: parsed.data.indexing,
    normalizerVersion: NORMALIZER_VERSION,
    splitterVersion: SPLITTER_VERSION,
    tokenizerVersion,
  };
  return { ...value, fingerprint: hashText(JSON.stringify(value)) };
}

export function embeddingCacheKey(profile: IndexProfile, content: string): string {
  return hashText(
    JSON.stringify([
      profile.model,
      profile.dimensions,
      profile.fingerprint,
      profile.normalizerVersion,
      profile.splitterVersion,
      profile.tokenizerVersion,
      hashText(content),
    ]),
  );
}
