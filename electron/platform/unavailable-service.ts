import type { KnowledgeService } from "../../src/lib/contracts";
import { PlatformError } from "./errors";

// Explicitly unavailable until the CTO injects Agent A's factory. Never substitute demo notes or fake retrieval.
export function createUnavailableKnowledgeService(): KnowledgeService {
  const unavailable = async (): Promise<never> => {
    throw new PlatformError("CONFIG_REQUIRED");
  };
  return {
    collections: { list: unavailable, save: unavailable, remove: unavailable },
    documents: {
      list: unavailable,
      get: unavailable,
      save: unavailable,
      setFavorite: unavailable,
      remove: unavailable,
      restore: unavailable,
      import: unavailable,
    },
    search: { query: unavailable },
    models: { list: unavailable },
    connections: { test: unavailable },
    index: { status: unavailable, rebuild: unavailable },
    assistant: { start: unavailable },
    applySettings: async () => {},
    dispose: async () => {},
  };
}
