-- Extensions are installed separately; startup checks versions before migrations.
CREATE TABLE collections (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION zhiyu_valid_tags(input_tags text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT cardinality(input_tags) <= 12
       AND array_position(input_tags, NULL) IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM unnest(input_tags) AS item(value)
            WHERE value <> btrim(value) OR char_length(value) NOT BETWEEN 1 AND 32
       )
       AND cardinality(input_tags) = (SELECT count(DISTINCT value) FROM unnest(input_tags) AS item(value));
$$;

CREATE TABLE documents (
    id uuid PRIMARY KEY,
    collection_id uuid REFERENCES collections(id) ON DELETE SET NULL,
    title text NOT NULL CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120),
    content_markdown text NOT NULL CHECK (octet_length(content_markdown) <= 2097152),
    tags text[] NOT NULL DEFAULT '{}' CHECK (zhiyu_valid_tags(tags)),
    favorite boolean NOT NULL DEFAULT false,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CHECK (updated_at >= created_at)
);

CREATE TABLE index_generations (
    id uuid PRIMARY KEY,
    fingerprint text NOT NULL CHECK (char_length(fingerprint) = 64),
    model text NOT NULL CHECK (model = 'openai/text-embedding-3-large'),
    dimensions integer NOT NULL CHECK (dimensions IN (1536, 3072)),
    chunk_config jsonb NOT NULL CHECK (
        jsonb_typeof(chunk_config) = 'object'
        AND chunk_config ?& ARRAY['chunkTokens', 'overlapTokens']
        AND chunk_config - 'chunkTokens' - 'overlapTokens' = '{}'::jsonb
        AND jsonb_typeof(chunk_config->'chunkTokens') = 'number'
        AND jsonb_typeof(chunk_config->'overlapTokens') = 'number'
        AND (chunk_config->>'chunkTokens')::integer BETWEEN 200 AND 2000
        AND (chunk_config->>'overlapTokens')::integer BETWEEN 0 AND 400
        AND (chunk_config->>'overlapTokens')::integer * 2 < (chunk_config->>'chunkTokens')::integer
    ),
    normalizer_version text NOT NULL,
    splitter_version text NOT NULL,
    tokenizer_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('building', 'active', 'failed', 'retired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz,
    error_code text,
    UNIQUE (id, model, dimensions)
);
CREATE UNIQUE INDEX index_generations_one_active ON index_generations ((true)) WHERE state = 'active';
CREATE UNIQUE INDEX index_generations_one_building ON index_generations ((true)) WHERE state = 'building';

CREATE TABLE document_chunks (
    id uuid PRIMARY KEY,
    generation_id uuid NOT NULL REFERENCES index_generations(id),
    document_id uuid NOT NULL REFERENCES documents(id),
    document_revision integer NOT NULL CHECK (document_revision > 0),
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    content text NOT NULL CHECK (content <> ''),
    content_hash text NOT NULL CHECK (char_length(content_hash) = 64),
    token_count integer NOT NULL CHECK (token_count > 0),
    start_line integer NOT NULL CHECK (start_line >= 1),
    end_line integer NOT NULL CHECK (end_line >= start_line),
    search_tsv tsvector NOT NULL,
    search_text text NOT NULL,
    UNIQUE (generation_id, document_id, document_revision, ordinal),
    UNIQUE (id, generation_id)
);

CREATE TABLE chunk_embeddings (
    chunk_id uuid PRIMARY KEY,
    generation_id uuid NOT NULL,
    model text NOT NULL,
    dimensions integer NOT NULL CHECK (dimensions IN (1536, 3072)),
    embedding public.vector NOT NULL,
    cache_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (chunk_id, generation_id) REFERENCES document_chunks(id, generation_id) ON DELETE CASCADE,
    FOREIGN KEY (generation_id, model, dimensions) REFERENCES index_generations(id, model, dimensions),
    CHECK (public.vector_dims(embedding) = dimensions),
    CHECK (public.vector_norm(embedding) > 0)
);

CREATE TABLE index_jobs (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id),
    revision integer NOT NULL CHECK (revision > 0),
    generation_id uuid NOT NULL REFERENCES index_generations(id),
    state text NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed', 'obsolete')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_retry_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (document_id, revision, generation_id),
    CHECK (
        (state = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
    )
);

CREATE TABLE legacy_imports (
    source_fingerprint text PRIMARY KEY CHECK (char_length(source_fingerprint) BETWEEN 1 AND 512),
    document_count integer NOT NULL CHECK (document_count >= 0),
    completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legacy_import_items (
    source_fingerprint text NOT NULL REFERENCES legacy_imports(source_fingerprint),
    source_id text NOT NULL,
    document_id uuid NOT NULL REFERENCES documents(id),
    PRIMARY KEY (source_fingerprint, source_id)
);

-- Only the prototype's three collections are seeded. Never seed demo documents.
INSERT INTO collections (id, name, sort_order) VALUES
    ('00000000-0000-4000-8000-000000000001', '产品设计', 0),
    ('00000000-0000-4000-8000-000000000002', '技术笔记', 1),
    ('00000000-0000-4000-8000-000000000003', '灵感碎片', 2);
