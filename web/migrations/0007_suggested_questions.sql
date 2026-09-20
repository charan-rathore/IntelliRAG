-- Community and predicted questions per corpus / document.
-- ask_count rises when a user submits that question; predicted rows are seeded on ingest.
create table if not exists suggested_questions (
  id text primary key,
  corpus_id text not null,
  document_slug text,
  question text not null,
  question_hash text not null,
  source text not null check (source in ('predicted', 'asked')),
  ask_count integer not null default 0,
  last_asked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (corpus_id, question_hash)
);

create index if not exists suggested_questions_corpus_ask_idx
  on suggested_questions (corpus_id, ask_count desc, updated_at desc);
