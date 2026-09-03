-- Workspace isolation: every document/chunk belongs to one corpus.
-- Default is seed-lab so existing seed rows stay queryable without a backfill race.
alter table documents add column if not exists corpus_id text not null default 'seed-lab';
alter table chunks add column if not exists corpus_id text not null default 'seed-lab';

update documents set corpus_id = case
  when source_type = 'seed' then 'seed-lab'
  when origin_repo is not null and origin_ref is not null then
    'github:' || origin_repo || '@' || regexp_replace(origin_ref, '^.*@', '')
  when origin_repo is not null then 'github:' || origin_repo
  when source_uri is not null then 'url:' || left(source_uri, 160)
  else 'imported:' || slug
end;

update chunks c
set corpus_id = d.corpus_id
from documents d
where c.document_id = d.id;

create index if not exists documents_corpus_id_idx on documents (corpus_id);
create index if not exists chunks_corpus_id_idx on chunks (corpus_id);
