-- Content/configuration hashes are the only lookup keys; no provider credentials are persisted.
CREATE INDEX chunk_embeddings_cache ON chunk_embeddings (cache_key, dimensions);
