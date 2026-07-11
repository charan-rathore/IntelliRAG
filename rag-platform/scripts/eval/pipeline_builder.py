"""Shared pipeline builder for evaluation scripts."""

from __future__ import annotations

from libs.rag.evaluation.platform import PipelineHandles
from libs.rag.pipeline.factory import PipelineBuildConfig, PipelineFactory


def build_eval_pipeline(
    persist_dir: str | None = None,
    use_ollama_embeddings: bool = False,
    config: PipelineBuildConfig | None = None,
) -> PipelineHandles:
    """Build a complete RAG pipeline for evaluation."""
    cfg = config or PipelineBuildConfig(
        persist_dir=persist_dir,
        use_ollama_embeddings=use_ollama_embeddings,
    )
    if persist_dir and config is None:
        cfg.persist_dir = persist_dir
    built = PipelineFactory.build(cfg)
    return built.handles
