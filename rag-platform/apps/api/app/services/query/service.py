"""Query service wrapping the instrumented RAG pipeline."""

from __future__ import annotations

import os
import threading
from typing import Optional

from libs.observability import ObservedRAGPipeline
from libs.rag.evaluation.failure_feed import FailureFeed, FailureRecord
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.ollama import MockLLMClient, OllamaClient
from libs.rag.generation.service import GenerationService
from libs.rag.pipeline.factory import PipelineBuildConfig, PipelineFactory


class QueryService:
    """Lazy-initialized singleton RAG query pipeline."""

    _instance: Optional["QueryService"] = None
    _lock = threading.Lock()

    def __init__(self) -> None:
        self._pipeline: Optional[ObservedRAGPipeline] = None
        self._failure_feed = FailureFeed(
            feed_path=os.environ.get("RAG_FAILURE_FEED", "data/eval/failure_feed.jsonl")
        )
        self._persist_dir: Optional[str] = None

    @classmethod
    def get(cls) -> "QueryService":
        with cls._lock:
            if cls._instance is None:
                cls._instance = QueryService()
            return cls._instance

    def _ensure_pipeline(self) -> ObservedRAGPipeline:
        if self._pipeline is not None:
            return self._pipeline

        persist_dir = os.environ.get(
            "RAG_CHROMA_DIR",
            os.path.join("data", "index", "chroma"),
        )
        use_ollama = os.environ.get("RAG_USE_OLLAMA", "false").lower() == "true"
        model = os.environ.get("RAG_LLM_MODEL", "llama3")

        built = PipelineFactory.build(
            PipelineBuildConfig(
                persist_dir=persist_dir,
                use_ollama_embeddings=use_ollama,
            )
        )
        self._persist_dir = built.persist_dir

        gen_config = GenerationConfig.for_ollama(model=model)
        if use_ollama:
            client = OllamaClient(gen_config)
            if not client.is_available():
                client = MockLLMClient()
        else:
            client = MockLLMClient()

        generation = GenerationService(config=gen_config, llm_client=client)
        built.observed.generation = generation
        self._pipeline = built.observed
        return self._pipeline

    def query(
        self,
        question: str,
        retrieval_mode: str = "hybrid",
        top_k: int = 5,
        include_eval_scores: bool = True,
    ):
        pipeline = self._ensure_pipeline()
        result = pipeline.query(
            question=question,
            retrieval_mode=retrieval_mode,
            top_k=top_k,
        )

        faithfulness = result.eval_scores.get("faithfulness", 1.0)
        if faithfulness < 0.7:
            self._failure_feed.record(
                FailureRecord(
                    question=question,
                    expected_answer="",
                    actual_answer=result.answer,
                    failure_type="low_faithfulness",
                    failure_metric="faithfulness",
                    failure_score=faithfulness,
                    reference_context=[],
                )
            )

        return result

    @property
    def persist_dir(self) -> Optional[str]:
        return self._persist_dir
