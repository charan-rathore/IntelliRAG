"""Small test harness for single GitHub issue ingestion (V1)."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

from apps.workers.app.tasks.ingestion.github.pipeline import ingest_github_issues_to_postgres
from libs.connectors.sinks.filesystem.raw_payload_store import RawPayloadStore
from libs.connectors.sinks.postgres.document_repository import PostgresDocumentRepository
from libs.connectors.sinks.postgres.ingestion_run_repository import IngestionRunRepository
from libs.connectors.sinks.postgres.raw_payload_repository import RawPayloadRepository
from libs.connectors.sources.github.fetcher import GitHubFetcher
from libs.connectors.sources.github.transformer import GitHubTransformer
from libs.shared.models.document import make_document_id
from libs.shared.models.lifecycle import IngestionSource


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest a single GitHub issue")
    parser.add_argument("--owner", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--issue-number", type=int, required=True)
    parser.add_argument("--tenant-id")
    parser.add_argument(
        "--update-mode",
        choices=["none", "raw", "fetched"],
        default="none",
        help="Simulate update using raw payload or fetched payload mutation.",
    )
    args = parser.parse_args()

    dsn = os.environ["POSTGRES_DSN"]
    token = os.environ["GITHUB_TOKEN"]
    base_url = os.getenv("GITHUB_API_BASE_URL", "https://api.github.com")
    raw_payload_dir = os.getenv("RAW_PAYLOAD_DIR", "/tmp/rag_platform/raw")

    fetcher = GitHubFetcher(base_url=base_url, token=token)
    transformer = GitHubTransformer(tenant_id=args.tenant_id)
    repository = PostgresDocumentRepository(dsn=dsn)
    raw_payload_repo = RawPayloadRepository(dsn=dsn)
    ingestion_run_repo = IngestionRunRepository(dsn=dsn)
    payload_store = RawPayloadStore(base_dir=raw_payload_dir)

    params = {
        "owner": args.owner,
        "repo": args.repo,
        "state": "all",
        "per_page": 100,
    }

    original_fetch = fetcher.fetch_issues

    if args.update_mode == "raw":
        source_uri = f"https://github.com/{args.owner}/{args.repo}/issues/{args.issue_number}"
        document_id = repository.get_document_id_by_source_uri(source_uri)
        if not document_id:
            print("No document found for source URI to simulate update.")
            return 1
        storage_uri = raw_payload_repo.get_latest_payload_uri(document_id)
        if not storage_uri:
            print("No existing raw payload found to simulate update.")
            return 1
        with open(storage_uri, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        payload["body"] = (payload.get("body") or "") + "\n\n[update-test: raw]"
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()

        def one_issue_only():
            yield payload

        fetcher.fetch_issues = lambda _: one_issue_only()

    elif args.update_mode == "fetched":

        def one_issue_only():
            for payload in original_fetch(params):
                if payload.get("number") == args.issue_number:
                    payload["body"] = (payload.get("body") or "") + "\n\n[update-test: fetched]"
                    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
                    yield payload
                    return

        fetcher.fetch_issues = lambda _: one_issue_only()

    else:

        def one_issue_only():
            for payload in original_fetch(params):
                if payload.get("number") == args.issue_number:
                    yield payload
                    return

        fetcher.fetch_issues = lambda _: one_issue_only()

    processed = ingest_github_issues_to_postgres(
        fetcher,
        transformer,
        repository,
        raw_payload_repo,
        payload_store,
        ingestion_run_repo,
        params,
    )

    fetcher.fetch_issues = original_fetch
    if processed == 0:
        print("No changes detected. Skipping ingestion.")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
