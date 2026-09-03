-- IntelliRAG corpus, chunks, and query traces (unowned shared lab data)
create table if not exists documents (
  id text primary key,
  slug text unique not null,
  title text not null,
  source_type text not null,
  source_uri text,
  body text not null,
  content_hash text not null,
  version integer not null default 1,
  embedding_model text,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chunks (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  ordinal integer not null,
  text text not null,
  token_count integer not null,
  heading text,
  embedding text,
  embedding_model text,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists chunks_document_id_idx on chunks (document_id);
create index if not exists chunks_embedding_model_idx on chunks (embedding_model);

create table if not exists query_traces (
  id text primary key,
  question text not null,
  retrieval_mode text not null,
  answer_preview text,
  refused boolean not null default false,
  model text,
  embedding_model text,
  layer_latencies text,
  citation_count integer not null default 0,
  total_latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);
