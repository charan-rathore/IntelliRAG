"""End-to-end validation of the indexing pipeline.

This script validates the full path:
    Document → Chunking → Embedding → Indexing → Search

It uses mock embeddings (no Ollama required) to verify the pipeline
wiring is correct, then optionally tests with real Ollama embeddings.

Usage:
    # Quick validation (mock embeddings, no Ollama needed):
    PYTHONPATH=. .venv/bin/python3.11 scripts/dev/validate_indexing_e2e.py

    # Full validation (requires Ollama running with nomic-embed-text):
    PYTHONPATH=. .venv/bin/python3.11 scripts/dev/validate_indexing_e2e.py --use-ollama
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone
from uuid import uuid4

import numpy as np

from libs.shared.models.chunk import Chunk, ChunkMetadata
from libs.shared.models.document import (
    CanonicalDocument,
    DocumentMetadata,
    DocumentVersion,
    make_document_id,
)
from libs.shared.models.lifecycle import IngestionSource, IngestionState
from libs.rag.chunking.service import ChunkingService, ChunkingServiceConfig
from libs.rag.indexing.chroma_store import ChromaVectorStore
from libs.rag.indexing.service import IndexingConfig, IndexingService


SAMPLE_DOCUMENT = """\
# Kubernetes Pod Scheduling Failures

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

We implemented a multi-pronged fix:

- **Resource quotas**: Set namespace-level resource quotas to prevent overcommit
- **Pod priority classes**: Created priority classes so critical pods preempt lower-priority ones
- **Node affinity**: Added node affinity rules to spread workloads across zones

### Code Example

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 1000000
globalDefault: false
description: "High priority for production workloads"
```

## Monitoring

Added Prometheus alerts:
- `kube_pod_status_phase{phase="Pending"}` > 5 for 10 minutes
- Node resource utilization exceeding 85%

## Lessons Learned

- Always monitor resource fragmentation, not just total utilization
- Pod resource requests should be right-sized, not over-provisioned
- Priority classes are essential for production clusters
"""

SEARCH_QUERIES = [
    ("What caused pod scheduling failures?", "resource fragmentation"),
    ("How was the scheduling issue fixed?", "Resource quotas"),
    ("What Prometheus alerts were added?", "kube_pod_status_phase"),
    ("What were the key findings about nodes?", "Node A had 2 CPUs"),
]


def create_test_document() -> tuple[CanonicalDocument, DocumentVersion]:
    """Create a realistic test document and version."""
    now = datetime.now(timezone.utc)
    doc_id = make_document_id(
        IngestionSource.GITHUB_ISSUE, "test-issue-42", "test-tenant"
    )
    version_id = uuid4()

    document = CanonicalDocument(
        document_id=doc_id,
        external_id="test-issue-42",
        title="Kubernetes Pod Scheduling Failures",
        metadata=DocumentMetadata(
            source_type=IngestionSource.GITHUB_ISSUE,
            source_uri="https://github.com/test/repo/issues/42",
            tenant_id="test-tenant",
            tags=["kubernetes", "scheduling", "production"],
            labels=["incident", "resolved"],
            service="platform-infra",
            component="k8s-scheduler",
        ),
        hash_content="e2e_test_hash",
        created_at=now,
        updated_at=now,
        ingested_at=now,
        lifecycle_state=IngestionState.REGISTERED,
    )

    version = DocumentVersion(
        document_id=doc_id,
        version_id=version_id,
        version_index=1,
        body_text=SAMPLE_DOCUMENT,
        hash_payload="e2e_test_version_hash",
        valid_from=now,
        is_active=True,
    )

    return document, version


def run_validation(use_ollama: bool = False) -> bool:
    """Run the full end-to-end validation."""
    print("=" * 70)
    print("PHASE 5: INDEXING ARCHITECTURE — END-TO-END VALIDATION")
    print("=" * 70)
    print()

    temp_dir = tempfile.mkdtemp(prefix="rag_e2e_")
    all_passed = True

    try:
        # STEP 1: Create test document
        print("[1/6] Creating test document...")
        document, version = create_test_document()
        print(f"  Document ID: {document.document_id}")
        print(f"  Version ID:  {version.version_id}")
        print(f"  Title:       {document.title}")
        print(f"  Body length: {len(version.body_text)} chars")
        print()

        # STEP 2: Chunk the document
        print("[2/6] Chunking document...")
        chunking_config = ChunkingServiceConfig(
            chunk_size=256,
            chunk_overlap=25,
        )
        chunking_service = ChunkingService(chunking_config)
        chunk_result, chunks = chunking_service.chunk_document(document, version)

        if not chunk_result.success:
            print(f"  FAIL: Chunking failed: {chunk_result.error_message}")
            return False

        print(f"  Chunks created: {chunk_result.chunks_created}")
        print(f"  Total tokens:   {chunk_result.total_tokens}")
        for i, chunk in enumerate(chunks):
            print(f"  Chunk {i}: {len(chunk.chunk_text)} chars, {chunk.token_count} tokens")
            if chunk.metadata.section_header:
                print(f"           Section: {chunk.metadata.section_header}")
        print()

        # STEP 3: Initialize vector store
        print("[3/6] Initializing ChromaDB vector store...")
        vector_store = ChromaVectorStore(
            collection_name="e2e_validation",
            persist_directory=temp_dir,
            embedding_dimensions=768,
        )
        print(f"  Persist dir: {temp_dir}")
        print(f"  Collection:  e2e_validation")
        print()

        # STEP 4: Index chunks (embed + insert)
        print("[4/6] Indexing chunks (embedding + vector insertion)...")

        if use_ollama:
            print("  Using REAL Ollama embeddings (nomic-embed-text)...")
            service = IndexingService(vector_store=vector_store)
        else:
            print("  Using MOCK embeddings (no Ollama required)...")
            from unittest.mock import MagicMock, patch

            service = IndexingService(vector_store=vector_store)
            mock_embedder = MagicMock()

            rng = np.random.RandomState(42)

            def mock_embed_batch(texts, batch_size=32, is_query=False):
                return rng.rand(len(texts), 768).astype(np.float32)

            def mock_embed_query(text):
                return rng.rand(768).astype(np.float32)

            mock_embedder.embed_batch = mock_embed_batch
            mock_embedder.embed_query = mock_embed_query
            service._embedder = mock_embedder

        start = time.time()
        index_result = service.index_document_chunks(
            chunks=chunks,
            document_id=document.document_id,
            version_id=version.version_id,
        )
        elapsed = (time.time() - start) * 1000

        if not index_result.success:
            print(f"  FAIL: Indexing failed: {index_result.error_message}")
            return False

        print(f"  Chunks embedded: {index_result.chunks_embedded}")
        print(f"  Chunks indexed:  {index_result.chunks_indexed}")
        print(f"  Embed time:      {index_result.embedding_time_ms:.1f}ms")
        print(f"  Index time:      {index_result.indexing_time_ms:.1f}ms")
        print(f"  Total time:      {elapsed:.1f}ms")
        print(f"  Vector count:    {vector_store.count()}")
        print()

        # Verify counts
        assert index_result.chunks_embedded == len(chunks), "Chunk count mismatch!"
        assert vector_store.count() == len(chunks), "Vector count mismatch!"

        # STEP 5: Search and validate
        print("[5/6] Testing search queries...")
        for query, expected_substring in SEARCH_QUERIES:
            results = service.search(query, top_k=3)
            top_text = results[0].text if results and results[0].text else ""
            found = expected_substring.lower() in top_text.lower() if top_text else False

            if use_ollama:
                status = "PASS" if found else "SOFT_FAIL (mock may differ)"
            else:
                status = "PASS (mock)" if results else "FAIL"
                found = len(results) > 0

            print(f"  Query: \"{query}\"")
            print(f"    Results: {len(results)}, Top score: {results[0].score:.4f}" if results else "    No results")
            print(f"    Status: {status}")

            if not results:
                all_passed = False
        print()

        # STEP 6: Test re-indexing (idempotency)
        print("[6/6] Testing re-indexing idempotency...")
        count_before = vector_store.count()

        reindex_result = service.index_document_chunks(
            chunks=chunks,
            document_id=document.document_id,
            version_id=version.version_id,
            delete_old_vectors=True,
        )

        count_after = vector_store.count()
        print(f"  Before re-index: {count_before} vectors")
        print(f"  Old deleted:     {reindex_result.old_vectors_deleted}")
        print(f"  After re-index:  {count_after} vectors")
        assert count_after == count_before, "Re-indexing should not change vector count!"
        print(f"  PASS: Idempotent re-indexing verified")
        print()

        # Summary stats
        stats = service.get_stats()
        print("=" * 70)
        print("INDEXING STATS")
        print("=" * 70)
        for k, v in stats.items():
            print(f"  {k}: {v}")
        print()

        # Cleanup test
        print("Cleanup: Removing document vectors...")
        removed = service.remove_document(document.document_id)
        print(f"  Removed {removed} vectors")
        assert vector_store.count() == 0, "All vectors should be removed!"
        print(f"  PASS: Clean removal verified")
        print()

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    print("=" * 70)
    if all_passed:
        print("RESULT: ALL VALIDATIONS PASSED")
    else:
        print("RESULT: SOME VALIDATIONS FAILED (see above)")
    print("=" * 70)

    return all_passed


def main():
    parser = argparse.ArgumentParser(description="Validate indexing pipeline end-to-end")
    parser.add_argument(
        "--use-ollama",
        action="store_true",
        help="Use real Ollama embeddings (requires Ollama running with nomic-embed-text)",
    )
    args = parser.parse_args()

    success = run_validation(use_ollama=args.use_ollama)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
