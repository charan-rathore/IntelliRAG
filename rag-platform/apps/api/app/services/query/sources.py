"""Catalog of indexed sample documents for console source links."""

from __future__ import annotations

from typing import Dict, Optional

from libs.rag.pipeline.factory import SAMPLE_DOCS

DOC_TITLES: Dict[str, str] = {
    "k8s-incident": "Kubernetes Pod Scheduling Failures",
    "python-async": "Python Asyncio Best Practices",
}


def list_sources() -> list[dict]:
    return [
        {
            "doc_id": doc_id,
            "title": DOC_TITLES.get(doc_id, doc_id),
            "url": f"/sources/{doc_id}",
            "preview": text.strip().splitlines()[0][:120],
        }
        for doc_id, text in SAMPLE_DOCS.items()
    ]


def get_source(doc_id: str) -> Optional[dict]:
    text = SAMPLE_DOCS.get(doc_id)
    if text is None:
        return None
    return {
        "doc_id": doc_id,
        "title": DOC_TITLES.get(doc_id, doc_id),
        "url": f"/sources/{doc_id}",
        "content": text,
    }


def resolve_doc_id(metadata: Optional[dict], chunk_id: str = "") -> str:
    meta = metadata or {}
    for key in ("source_doc_id", "external_id", "document_key", "doc_id"):
        value = meta.get(key)
        if value and str(value) in SAMPLE_DOCS:
            return str(value)
    # Fallback: match known keys inside chunk id / metadata string
    blob = f"{chunk_id} {meta}".lower()
    for doc_id in SAMPLE_DOCS:
        if doc_id.lower() in blob:
            return doc_id
    return ""
