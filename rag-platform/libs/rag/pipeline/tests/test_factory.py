"""Tests for pipeline factory."""

from __future__ import annotations

import tempfile

from libs.rag.pipeline.factory import PipelineBuildConfig, PipelineFactory


def test_pipeline_factory_builds_indexed_corpus():
    with tempfile.TemporaryDirectory() as tmpdir:
        built = PipelineFactory.build(PipelineBuildConfig(persist_dir=tmpdir))
        assert len(built.corpus) > 0
        assert built.handles.retrieval_service is not None
        assert built.chunk_doc_ids

        result = built.handles.retrieval_service.retrieve(
            query="Kubernetes pod scheduling failures",
            mode="hybrid",
            top_k=3,
        )
        assert len(result.chunks) > 0
