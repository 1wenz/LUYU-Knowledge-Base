CREATE INDEX documents_current_updated ON documents (updated_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX documents_collection_updated ON documents (collection_id, updated_at DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX documents_tags ON documents USING gin (tags) WHERE deleted_at IS NULL;
CREATE INDEX document_chunks_current ON document_chunks (generation_id, document_id, document_revision, ordinal);
CREATE INDEX document_chunks_fts ON document_chunks USING gin (search_tsv);
CREATE INDEX document_chunks_phrase ON document_chunks USING gin (search_text public.gin_trgm_ops);
CREATE INDEX chunk_embeddings_generation ON chunk_embeddings (generation_id, dimensions);

-- Preserve float32 storage; pgvector's plain vector HNSW limit is 2000 dimensions.
CREATE INDEX chunk_embeddings_hnsw_3072 ON chunk_embeddings
    USING hnsw ((embedding::public.halfvec(3072)) public.halfvec_cosine_ops)
    WHERE dimensions = 3072;
CREATE INDEX chunk_embeddings_hnsw_1536 ON chunk_embeddings
    USING hnsw ((embedding::public.vector(1536)) public.vector_cosine_ops)
    WHERE dimensions = 1536;

CREATE INDEX index_jobs_ready ON index_jobs (next_retry_at, created_at, id) WHERE state IN ('pending', 'failed');
CREATE INDEX index_jobs_leases ON index_jobs (lease_expires_at) WHERE state = 'running';
