import type { SourceType } from "./types";

export type SeedDocument = {
  slug: string;
  title: string;
  sourceType: SourceType;
  body: string;
};

export const SEED_DOCUMENTS: SeedDocument[] = [
  {
    slug: "k8s-incident",
    title: "Kubernetes Pod Scheduling Failures",
    sourceType: "seed",
    body: `# Kubernetes Pod Scheduling Failures

## Problem Description
We observed intermittent pod scheduling failures in the production cluster.
Pods were getting stuck in Pending state for 10-15 minutes during peak hours.

## Root Cause Analysis
The issue was traced to resource fragmentation on the cluster nodes.
While total cluster capacity was sufficient, individual nodes had
fragmented CPU and memory allocations that prevented scheduling.

### Key Findings
1. Node A had 2 CPUs free but only 512Mi memory
2. Node B had 4Gi memory free but only 0.5 CPU
3. Pod requests: 1 CPU + 2Gi memory, no single node could satisfy this

## Resolution
We implemented resource quotas, pod priority classes, and node affinity rules.
Repeated analysis confirmed resource fragmentation as the root cause.
`,
  },
  {
    slug: "python-async",
    title: "Python Asyncio Best Practices",
    sourceType: "seed",
    body: `# Python Asyncio Best Practices

## Event Loop Management
Always use asyncio.run() for top-level entry points in Python 3.7+.
Avoid creating multiple event loops in the same thread.

## Connection Pooling
Use aiohttp ClientSession as a context manager to reuse TCP connections.
Set appropriate timeouts to prevent hung coroutines.

## Error Handling
Wrap coroutines in try/except and use asyncio.gather with return_exceptions=True
for concurrent tasks that should not fail together.
`,
  },
  {
    slug: "kubernetes-scheduling",
    title: "Kubernetes Pod Scheduling Guide",
    sourceType: "seed",
    body: `# Kubernetes Pod Scheduling

Kubernetes uses a scheduler to place pods on nodes in the cluster.
The scheduler considers multiple factors when making placement decisions.

## Resource Requests and Limits

Pods can specify resource requests and limits for CPU and memory.

### CPU Resources

CPU is specified in cores. You can use decimal values like 0.5 for half a core,
or use millicore notation like 500m.

\`\`\`yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1000m"
\`\`\`

### Memory Resources

Memory is specified in bytes. You can use suffixes like Ki, Mi, Gi.
Memory limits are strictly enforced - pods exceeding limits are OOM killed.

\`\`\`yaml
resources:
  requests:
    memory: "128Mi"
  limits:
    memory: "256Mi"
\`\`\`

## Node Selectors

Node selectors let you constrain pods to specific nodes based on labels.
This is useful for placing workloads on specific hardware.

## Affinity and Anti-Affinity

### Pod Anti-Affinity
Pod anti-affinity spreads pods across nodes or zones.
This improves fault tolerance by avoiding single points of failure.

## Taints and Tolerations

### NoSchedule Taint
Prevents new pods from being scheduled unless they tolerate the taint.

### NoExecute Taint
Evicts existing pods that don't tolerate the taint.

## Priority and Preemption
Pods can have priority classes. Higher priority pods can preempt
lower priority pods when resources are scarce.
This ensures critical workloads always have resources available.
`,
  },
  {
    slug: "db-pool-runbook",
    title: "Database Connection Pool Exhaustion Runbook",
    sourceType: "seed",
    body: `# Database Connection Pool Exhaustion Runbook

## Overview
This runbook covers diagnosing and resolving database connection pool
exhaustion issues in our microservices architecture.

## Symptoms
1. Services returning HTTP 503 errors
2. Database connection timeout errors in logs
3. High latency on database-dependent endpoints
4. Connection pool metrics showing near-100% utilization

## Diagnostic Steps

### Step 1: Check Connection Pool Metrics
Query Prometheus for connection pool status:
db_connection_pool_active{service="api-gateway"}
db_connection_pool_available{service="api-gateway"}

### Step 2: Identify Slow Queries
SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '5 minutes';

### Step 3: Check for Connection Leaks
kubectl logs deployment/api-gateway | grep "connection leak"

## Resolution Procedures

### Immediate Mitigation
1. Scale up affected services to increase total pool capacity
2. Restart pods with suspected connection leaks
3. Kill long-running queries if they are not critical

### Long-term Fixes
1. Add connection pool timeouts to prevent leaks
2. Implement query timeouts at the application level
3. Add circuit breakers for database calls
4. Review and optimize slow queries

## Escalation
If connection pool issues persist after following this runbook:
1. Page the database team (PagerDuty: db-oncall)
2. Consider read replica failover if primary is overloaded
3. Prepare for emergency database scaling
`,
  },
  {
    slug: "docker-runtime",
    title: "Docker and Compose Runtime Guide",
    sourceType: "seed",
    body: `# Docker and Compose Runtime Guide

## Images vs containers
An image is an immutable filesystem snapshot. A container is a running instance of an image plus writable layers, env, and networking.

## Healthchecks
Always declare a HEALTHCHECK or Compose healthcheck. Orchestrators should restart on consecutive failures, not on a single blip.

## Resource limits
Set memory and CPU limits in Compose or Kubernetes. Without a memory limit, a leak takes the host. Java and Node need heap limits below the container limit.

## Networking
Containers on the same Compose network resolve each other by service name. Do not hard-code localhost for sibling services.

## Logs
Prefer JSON logging and ship stdout. Do not write only to a file inside the container — it disappears with the writable layer.
`,
  },
  {
    slug: "git-ops",
    title: "Git Branching and Incident Hotfixes",
    sourceType: "seed",
    body: `# Git Branching and Incident Hotfixes

## Trunk
Keep main always releasable. Feature work lands via pull request with CI green.

## Hotfix
1. Branch from the production tag, not from an in-flight feature branch.
2. Smallest possible diff. No drive-by refactors.
3. Cherry-pick back to main so the next release includes the fix.

## Bisect
git bisect start, mark bad/good commits, rebuild. Use it when a regression has no obvious author.

## Secrets
Never commit API keys. Rotate anything that touched git history. Prefer server env, never VITE_ prefixes for secrets.
`,
  },
  {
    slug: "postgres-indexes",
    title: "Postgres Indexing and Slow Query Playbook",
    sourceType: "seed",
    body: `# Postgres Indexing and Slow Query Playbook

## EXPLAIN ANALYZE
Always run EXPLAIN ANALYZE on the production-shaped data. Seq Scan on a large table is the usual smoking gun.

## B-tree
Default index type. Use it for equality and range on high-cardinality columns (ids, timestamps).

## Composite indexes
Order columns by equality filters first, then range. An index on (user_id, created_at) serves WHERE user_id = $1 ORDER BY created_at DESC.

## Connection pooling
PgBouncer in transaction mode. Do not hold a session connection per HTTP request in serverless.

## Vacuum
Autovacuum prevents bloat. Sudden table bloat after bulk deletes needs VACUUM (VERBOSE) and maybe pg_repack.
`,
  },
  {
    slug: "linux-perf",
    title: "Linux CPU and Memory Incident Cheatsheet",
    sourceType: "seed",
    body: `# Linux CPU and Memory Incident Cheatsheet

## CPU
top or htop: look for a process stuck at 100%. perf top for hot functions. If load average >> nproc, the box is queued.

## Memory
free -h. If available is near zero and si/so in vmstat is nonzero, you are paging. OOM killer leaves "Out of memory" in dmesg.

## Disk
iostat -xz 1. %util near 100 and high await means the disk is the bottleneck. df -h for full volumes — logs filling /var is a classic outage.

## Network
ss -tlnp for listeners. packet loss: ping and mtr. DNS: dig +trace, check /etc/resolv.conf.
`,
  },
  {
    slug: "http-caching",
    title: "HTTP Caching and CDN Notes",
    sourceType: "seed",
    body: `# HTTP Caching and CDN Notes

## Cache-Control
- no-store: never cache (auth pages, secrets)
- private, max-age=…: browser only
- public, s-maxage=…: CDN shared cache

## Validators
ETag and Last-Modified enable 304 Not Modified. Prefer strong ETags for immutable hashed assets.

## Immutable assets
Fingerprint filenames (/assets/app.abc123.js) and set max-age=31536000, immutable.

## HTML
HTML should be short-cached or revalidated so deploys are visible. Do not immutable-cache index.html.

## Auth
Never cache authenticated API JSON at a shared CDN. Vary on Authorization or use private.
`,
  },
  {
    slug: "redis-cache",
    title: "Redis Cache Stampede and TTL Guide",
    sourceType: "seed",
    body: `# Redis Cache Stampede and TTL Guide

## Stampede
When a hot key expires, many workers recompute it at once. Use:
1. Probabilistic early refresh
2. Single-flight lock (SET key:lock NX EX 10)
3. Serve stale while one worker rebuilds

## TTL
Jitter TTLs (base ± 10%) so keys do not expire together.

## Eviction
allkeys-lru for a pure cache. volatile-lru if some keys must never drop.

## Persistence
A cache is not a source of truth. If Redis dies, the app must rebuild from Postgres.

## Keys
Namespace keys: env:service:entity:id. Avoid unbounded key growth from user input.
`,
  },
  {
    slug: "sre-error-budget",
    title: "SRE Error Budgets and SLOs",
    sourceType: "seed",
    body: `# SRE Error Budgets and SLOs

## SLO
A service level objective is a target like 99.9% availability over 30 days. SLIs are the measurements (success rate, latency p99).

## Error budget
Budget = 100% − SLO. At 99.9% monthly you may burn ~43 minutes. When the budget is gone, freeze features and fix reliability.

## Burn rate
A 2-hour fast-burn alert catches a total outage. A 24-hour slow-burn alert catches a leak that would exhaust the month.

## Blameless postmortems
Write timeline, impact, root cause, and action items. The goal is a better system, not a guilty person.
`,
  },
  {
    slug: "node-event-loop",
    title: "Node.js Event Loop and Backpressure",
    sourceType: "seed",
    body: `# Node.js Event Loop and Backpressure

## Do not block
JSON.parse on megabyte payloads, sync fs, and tight CPU loops stall every request on that process. Move heavy CPU to a worker thread or a separate service.

## Backpressure
When writing to a slow socket, respect stream.write returning false and wait for drain. Unbounded buffers cause memory growth and then OOM.

## Clustering
One process uses one core. Use Node cluster or a process manager. Serverless already isolates by invocation.

## Timeouts
AbortController on fetch. A hung downstream without a timeout fills the event loop with sockets.
`,
  },
  {
    slug: "rag-lab-guide",
    title: "IntelliRAG Lab Retrieval Notes",
    sourceType: "seed",
    body: `# IntelliRAG Lab Retrieval Notes

## Two different jobs
Index and query embeddings use gemini-embedding-2 (768-d) so they share one vector space.
Answers are written by Gemini 3.7 Flash. Flash never writes vectors.

## Pipeline
1. Heading-aware chunking ~512 tokens (code files split on function/class boundaries)
2. Hybrid retrieve: dense cosine + BM25 fused with RRF
3. Calibrated rerank: cosine + BM25 + IDF-weighted overlap + title match (not a cross-encoder, not MMR)
4. Dynamic context packing: absolute calibrated floor + relative drop vs rank-1. Not an absolute 0.55 cosine threshold. MMR is not in the execution path.
5. Evidence gate: if nothing passes, answer “Not in the indexed corpus.” with no citations

## Production
Vercel requires DATABASE_URL (Neon) so embeddings survive cold starts. Without it, dense retrieval is disabled and only BM25 on seed text runs. Locally, PGLite stores vectors under .data/pglite. OPENROUTER_API_KEY stays server-only, never VITE_.
`,
  },
  {
    slug: "tls-certificates",
    title: "TLS Certificates and HTTPS Runbook",
    sourceType: "seed",
    body: `# TLS Certificates and HTTPS Runbook

## What TLS does
TLS encrypts the bytes on the wire and proves the server's identity with a certificate chain. HTTPS is HTTP over TLS. Without it, cookies and tokens travel in the clear.

## Certificates
A cert binds a public key to a name (SAN). Browsers trust it if a public CA signed it and it is not expired or revoked. Let's Encrypt is the usual automated CA.

## Expiry
Most outages are expired certs. Alert at 21 days. Automate renewal (cert-manager, acme.sh). Do not copy private keys into git or container images.

## Handshake failures
Mismatch of SNI, missing intermediate, or the client still using TLS 1.0. Check with openssl s_client -servername host -connect host:443 and look at the presented chain.

## Mutual TLS
Service mesh mTLS authenticates both sides. Rotate mesh root CAs slowly; a bad root roll breaks every sidecar at once.
`,
  },
  {
    slug: "rest-http-apis",
    title: "REST and HTTP API Design Notes",
    sourceType: "seed",
    body: `# REST and HTTP API Design Notes

## Methods and status
GET is safe and cacheable. POST creates or triggers. PUT replaces. PATCH is partial. DELETE removes. 2xx success, 4xx caller error, 5xx our fault. 429 means slow down.

## Idempotency
PUT and DELETE should be retry-safe. POST that charges a card needs an Idempotency-Key header so a double-submit does not double-charge.

## Pagination
Cursor pagination beats offset on large tables. Return a next cursor, never "page 9000".

## Errors
Return a machine-readable code plus a human message. Do not leak stack traces. Validate input at the edge.

## Versioning
Prefer additive changes. If you must break, /v2 on a new path. Deprecate in headers, do not surprise mobile clients.
`,
  },
  {
    slug: "observability",
    title: "Logs Metrics Traces Playbook",
    sourceType: "seed",
    body: `# Logs Metrics Traces Playbook

## Three pillars
Metrics tell you something is wrong. Logs tell you what happened. Traces tell you where in the call graph it happened. You need all three in production.

## RED / USE
For request services: Rate, Errors, Duration. For resources: Utilization, Saturation, Errors.

## Structured logs
JSON with request_id, user_id (hashed), and error code. Never log secrets, tokens, or full card numbers.

## Tracing
Propagate traceparent. Sample 1–10% of success, 100% of errors. A missing child span usually means a fire-and-forget call.

## Alerting
Alert on user pain (SLO burn), not on every CPU blip. Pages should be rare and actionable.
`,
  },
  {
    slug: "terraform-iac",
    title: "Terraform and Infrastructure as Code",
    sourceType: "seed",
    body: `# Terraform and Infrastructure as Code

## State
Terraform state is the mapping from code to real resources. Store it remotely (S3 + lock, Terraform Cloud). Never commit terraform.tfstate. Two people applying without a lock will race.

## Plan then apply
Always review terraform plan. An unexpected destroy is a production incident waiting to happen.

## Modules
Reuse modules for repeated stacks. Pin module and provider versions. Latest on every run is how surprise diffs appear.

## Secrets
Do not put API keys in .tf files. Use the secret store and data sources. terraform.tfvars with secrets belongs in .gitignore.

## Drift
Someone clicking in the cloud console creates drift. Re-apply from CI or import the resource. The console is not the source of truth.
`,
  },
];

export const EXAMPLE_QUESTIONS = [
  "What caused the Kubernetes pod scheduling failures?",
  "How should you manage the Python asyncio event loop?",
  "How do you stop a Redis cache stampede?",
  "What is an SRE error budget?",
  "Why shouldn't you cache index.html as immutable?",
  "What is mTLS used for in a service mesh?",
];

export const PLATFORM_AUDIT = [
  {
    id: "chroma-ephemeral",
    severity: "critical" as const,
    title: "Chroma on local disk",
    original:
      "The live Python stack persisted vectors in Chroma/SQLite under RAG_CHROMA_DIR. Serverless and Vercel have no durable filesystem, so the index vanished on every cold start.",
    liveFix:
      "Chunks and embeddings live in Postgres (Neon when DATABASE_URL is set). Local preview uses file-backed PGLite under .data/pglite. On Vercel without DATABASE_URL, dense retrieval is disabled — the UI must not claim stored vectors exist.",
  },
  {
    id: "ollama-mock",
    severity: "critical" as const,
    title: "Ollama fallback to mock LLM",
    original:
      "Generation defaulted to llama3.2 on localhost:11434. When Ollama was unreachable the console silently answered with a MockLLM — answers looked live but were not grounded.",
    liveFix:
      "Queries run on Gemini 3.7 Flash (via Gemini API or OpenRouter). No key → no fake answers; the console asks for a server-side key instead of hallucinating.",
  },
  {
    id: "embed-mismatch",
    severity: "critical" as const,
    title: "Embedding model mismatch",
    original:
      "Query service defaulted RAG_USE_OLLAMA_EMBED=false (TF-IDF) while docs recommended nomic-embed-text. README even warned: do not flip the flag unless you re-index. Index and query lived in different vector spaces.",
    liveFix:
      "gemini-embedding-2 writes every chunk and every query. 3.7 Flash never embeds — it only writes the answer. Chunks store embedding_model; a mismatch is flagged as stale and re-embedded. Silent fallback to gemini-embedding-001 is gone.",
  },
  {
    id: "celery-gap",
    severity: "high" as const,
    title: "Celery workers never ran in the live UI",
    original:
      "Ingestion required Redis + Celery. The query console indexed a hard-coded two-doc sample in-process; GitHub webhooks and versioning never reached a deployed host.",
    liveFix:
      "Ingest is a short serverless function: hash → chunk → batched embed. Unchanged content hashes skip re-embed.",
  },
  {
    id: "hanging-generate",
    severity: "high" as const,
    title: "Blocking generation",
    original:
      "GenerationConfig.stream=false with 90–120s timeouts. Cross-encoder cold starts added seconds. The UI spinner froze until the full answer returned.",
    liveFix:
      "SSE streams stage events then tokens. Rerank is a calibrated in-process mix (not a learned cross-encoder). Gemini thinking is set to low. First sources paint before the model speaks.",
  },
  {
    id: "no-freshness",
    severity: "high" as const,
    title: "No freshness or supersede in retrieval",
    original:
      "Versioning existed in Postgres but retrieval ranked old and new chunks equally. Scheduler app was a stub. Dual-store (Postgres vs Chroma) drifted.",
    liveFix:
      "Re-ingest supersedes old chunks. Ranking does not apply a freshness/recency boost (that previously drowned relevance). Corpus health lists stale reasons: missing embeddings, model mismatch, never indexed, ephemeral storage.",
  },
  {
    id: "bm25-memory",
    severity: "medium" as const,
    title: "BM25 rebuilt empty on cold start",
    original:
      "Keyword retrieval was an in-memory BM25 rebuilt from Postgres at process start. Serverless workers started with an empty keyword index.",
    liveFix:
      "BM25 is rebuilt per query from the current chunk table — cheap at lab scale, always consistent with dense search.",
  },
  {
    id: "eval-mock",
    severity: "medium" as const,
    title: "Benchmarks on mock embeddings",
    original:
      "CI quality gates used mock embeddings and a mock LLM. Precision looked low (0.20) and faithfulness sat at 0.50 — not a measure of real RAG.",
    liveFix:
      "Live answers use gemini-embedding-2 for both index and query, then Gemini 3.7 Flash over the retrieved text. Layer latencies and citation coverage are recorded on every query.",
  },
];
