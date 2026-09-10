-- Immutable, addressable evaluation artifacts survive worker restarts.
create table if not exists evaluation_runs (
  id text primary key,
  created_at timestamptz not null default now(),
  dataset_hash text not null,
  index_hash text not null,
  verdict text not null,
  payload text not null
);
create index if not exists evaluation_runs_created_idx on evaluation_runs(created_at desc);
