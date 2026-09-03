-- Chunk/document provenance for GitHub repository ingestion and code-aware chunks.
alter table documents add column if not exists origin_repo text;
alter table documents add column if not exists origin_ref text;

alter table chunks add column if not exists filepath text;
alter table chunks add column if not exists language text;
alter table chunks add column if not exists symbol text;
alter table chunks add column if not exists chunk_kind text not null default 'prose';
