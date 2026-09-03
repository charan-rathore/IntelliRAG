-- Graphify sidecar (graph.json + memory + learning overlay) as one JSON blob.
create table if not exists graphify_state (
  id text primary key,
  payload text not null,
  updated_at timestamptz not null default now()
);
