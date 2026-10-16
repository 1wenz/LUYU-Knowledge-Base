import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";
import {
  indexProfile,
  embeddingCacheKey,
} from "../../electron/services/knowledge/indexing/profile";

test("索引 fingerprint 只随模型空间、分块和实现版本改变", () => {
  const base = indexProfile(DEFAULT_SETTINGS, "cl100k_base-v1");
  const display = structuredClone(DEFAULT_SETTINGS);
  display.revision++;
  display.retrieval.resultCount = 10;
  display.generation.temperature = 0.8;
  display.models.chatModel = "synthetic/chat";
  assert.equal(indexProfile(display, "cl100k_base-v1").fingerprint, base.fingerprint);
  display.indexing.chunkTokens = 1000;
  assert.notEqual(indexProfile(display, "cl100k_base-v1").fingerprint, base.fingerprint);
  assert.notEqual(indexProfile(DEFAULT_SETTINGS, "cl100k_base-v2").fingerprint, base.fingerprint);
  const reduced = structuredClone(DEFAULT_SETTINGS);
  reduced.models.embeddingDimensions = 1536;
  assert.notEqual(indexProfile(reduced, "cl100k_base-v1").fingerprint, base.fingerprint);
});

test("embedding 缓存绑定配置、版本和内容，不能跨维度复用", () => {
  const profile = indexProfile(DEFAULT_SETTINGS, "cl100k_base-v1");
  const key = embeddingCacheKey(profile, "合成段落");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(embeddingCacheKey(profile, "合成段落"), key);
  assert.notEqual(embeddingCacheKey(profile, "另一段落"), key);
  assert.notEqual(embeddingCacheKey({ ...profile, dimensions: 1536 }, "合成段落"), key);
});
