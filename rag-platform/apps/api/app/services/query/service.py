"""Query service wrapping the instrumented RAG pipeline."""

from __future__ import annotations

import os
import threading
from typing import Any, Dict, Optional

from libs.observability import ObservedRAGPipeline
from libs.observability.pipeline import ObservedQueryResult
from libs.rag.evaluation.failure_feed import FailureFeed, FailureRecord
from libs.rag.generation.config import GenerationConfig
from libs.rag.generation.models import GenerationResult, GenerationStats
from libs.rag.generation.ollama import MockLLMClient, OllamaClient
from libs.rag.generation.service import GenerationService
from libs.rag.pipeline.factory import PipelineBuildConfig, PipelineFactory

from apps.api.app.services.query.intents import (
    QueryIntent,
    classify_intent,
    example_questions_for,
)
from apps.api.app.services.query.sources import DOC_TITLES, list_sources


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
        self._llm_backend: str = "uninitialized"
        self._embedding_backend: str = "uninitialized"
        self._llm_model: str = ""

    @classmethod
    def get(cls) -> "QueryService":
        with cls._lock:
            if cls._instance is None:
                cls._instance = QueryService()
            return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Drop singleton (used by tests / process reloads)."""
        with cls._lock:
            cls._instance = None

    @staticmethod
    def _env_flag(name: str, default: str = "false") -> str:
        return os.environ.get(name, default).strip().lower()

    def _resolve_use_ollama_llm(self) -> bool:
        """
        Prefer a real LLM for the live console.

        RAG_USE_OLLAMA:
          - true / 1 / yes  -> force Ollama (fallback to mock if unreachable)
          - false / 0 / no  -> force mock
          - auto (default)  -> Ollama when reachable, else mock
        """
        flag = self._env_flag("RAG_USE_OLLAMA", "auto")
        if flag in {"false", "0", "no", "mock"}:
            return False
        if flag in {"true", "1", "yes", "ollama"}:
            return True
        probe = OllamaClient(
            GenerationConfig.for_ollama(model=os.environ.get("RAG_LLM_MODEL", "llama3"))
        )
        return probe.is_available()

    def _interactive_gen_config(self, model: str) -> GenerationConfig:
        """Lower-latency interactive defaults while keeping complete answers."""
        cfg = GenerationConfig.for_ollama(model=model)
        # Detailed style asks for a direct answer + supporting detail.
        cfg.prompt_style = "detailed"
        # Smaller context window = faster prefills on local Mac CPUs/GPUs.
        cfg.num_ctx = int(os.environ.get("RAG_NUM_CTX", "2048"))
        cfg.max_tokens = int(os.environ.get("RAG_MAX_TOKENS", "512"))
        cfg.timeout_seconds = float(os.environ.get("RAG_LLM_TIMEOUT", "90"))
        cfg.temperature = 0.1
        return cfg

    def _ensure_pipeline(self) -> ObservedRAGPipeline:
        if self._pipeline is not None:
            return self._pipeline

        persist_dir = os.environ.get(
            "RAG_CHROMA_DIR",
            os.path.join("data", "index", "chroma"),
        )
        use_ollama_embed = self._env_flag("RAG_USE_OLLAMA_EMBED", "false") in {
            "true",
            "1",
            "yes",
        }
        use_ollama_llm = self._resolve_use_ollama_llm()
        model = os.environ.get("RAG_LLM_MODEL", "llama3")

        built = PipelineFactory.build(
            PipelineBuildConfig(
                persist_dir=persist_dir,
                use_ollama_embeddings=use_ollama_embed,
                # Lexical rerank is fast; cross-encoder adds multi-second cold starts.
                reranker_type=os.environ.get("RAG_RERANKER", "lexical"),
            )
        )
        self._persist_dir = built.persist_dir
        self._embedding_backend = "ollama" if use_ollama_embed else "tfidf"

        gen_config = self._interactive_gen_config(model)
        if use_ollama_llm:
            client = OllamaClient(gen_config)
            if client.is_available():
                self._llm_backend = "ollama"
                self._llm_model = model
                # Warm the model so the first user query is not a cold load.
                try:
                    client.warmup()
                except Exception:
                    pass
            else:
                client = MockLLMClient()
                self._llm_backend = "mock-llm (ollama unreachable)"
                self._llm_model = "mock-llm"
        else:
            client = MockLLMClient()
            self._llm_backend = "mock-llm"
            self._llm_model = "mock-llm"

        generation = GenerationService(config=gen_config, llm_client=client)
        built.observed.generation = generation
        self._pipeline = built.observed
        return self._pipeline

    def _guide_result(
        self,
        question: str,
        answer: str,
        *,
        route: str,
        model: str = "console-guide",
    ) -> ObservedQueryResult:
        generation = GenerationResult(
            query=question,
            answer=answer,
            citations=[],
            model=model,
            stats=GenerationStats(),
            refused=False,
            metadata={"route": route},
        )
        return ObservedQueryResult(
            query=question,
            answer=answer,
            trace_id=f"{route}-local",
            generation=generation,
            faithfulness=1.0,
            total_latency_ms=0.0,
            layer_latencies={route: 0.0},
            eval_scores={
                "faithfulness": 1.0,
                "citation_precision": 1.0,
                "hallucination_rate": 0.0,
                "answer_relevancy": 1.0,
                "answer_quality": 1.0,
            },
            refused=False,
        )

    def _greeting_answer(self, question: str) -> ObservedQueryResult:
        answer = (
            "Hey — I'm IntelliRAG, a grounded Q&A console over your indexed docs.\n\n"
            "Ask about the Kubernetes scheduling incident or Python asyncio practices "
            "below. I cite sources and link to the full document when I answer.\n\n"
            "Try: “What caused the Kubernetes pod scheduling failures?”"
        )
        return self._guide_result(question, answer, route="greeting")

    def _capability_answer(self, question: str) -> ObservedQueryResult:
        lines = [
            "I answer questions using only the documents indexed in this console — "
            "with citations and links back to the source text.",
            "",
            "Indexed sources:",
        ]
        for src in list_sources():
            lines.append(f"- [{src['title']}]({src['url']})")
            for example in example_questions_for(src["doc_id"])[:1]:
                lines.append(f"  Example: “{example}”")
        lines.extend(
            [
                "",
                "I will refuse off-topic or unsupported questions rather than guess.",
            ]
        )
        return self._guide_result(question, "\n".join(lines), route="capability")

    def _off_topic_answer(self, question: str) -> ObservedQueryResult:
        titles = ", ".join(DOC_TITLES.values())
        answer = (
            "That looks outside what I can ground in the indexed corpus.\n\n"
            f"I can help with: {titles}.\n\n"
            "Ask something like “How were the scheduling failures resolved?” "
            "or open a source from the list under Options / Sources."
        )
        result = self._guide_result(question, answer, route="off_topic")
        result.refused = True
        result.generation.refused = True
        result.eval_scores["answer_relevancy"] = 0.0
        result.eval_scores["answer_quality"] = 0.0
        return result

    def query(
        self,
        question: str,
        retrieval_mode: str = "hybrid",
        top_k: int = 5,
        include_eval_scores: bool = False,
    ):
        intent = classify_intent(question)
        if intent is QueryIntent.GREETING:
            return self._greeting_answer(question)
        if intent is QueryIntent.CAPABILITY:
            return self._capability_answer(question)
        if intent is QueryIntent.OFF_TOPIC:
            return self._off_topic_answer(question)

        pipeline = self._ensure_pipeline()
        # Interactive default: skip faithfulness eval (lexical is cheap, but
        # still adds work; more importantly we avoid blocking UX on scoring).
        result = pipeline.query(
            question=question,
            retrieval_mode=retrieval_mode,
            top_k=top_k,
            run_eval=include_eval_scores,
        )

        scores = dict(result.eval_scores or {})
        if include_eval_scores:
            faithfulness = float(scores.get("faithfulness", 0.0))
            relevancy = float(scores.get("answer_relevancy", 0.0))
            scores["answer_quality"] = round(min(faithfulness, relevancy), 4)
            result.eval_scores = scores

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
            elif relevancy < 0.4 and not result.refused:
                self._failure_feed.record(
                    FailureRecord(
                        question=question,
                        expected_answer="",
                        actual_answer=result.answer,
                        failure_type="low_answer_relevancy",
                        failure_metric="answer_relevancy",
                        failure_score=relevancy,
                        reference_context=[],
                    )
                )
        else:
            result.eval_scores = {}

        return result

    def stream_query(
        self,
        question: str,
        retrieval_mode: str = "hybrid",
        top_k: int = 5,
        include_eval_scores: bool = False,
    ):
        """Yield progressive events for the interactive console (SSE).

        Event shapes:
          {"type": "stage", "stage": "...", "label": "..."}
          {"type": "token", "text": "..."}
          {"type": "done", "response": {...QueryResponse fields...}}
          {"type": "error", "message": "..."}
        """
        import time
        import uuid

        from libs.rag.chunking.utils import estimate_token_count
        from libs.rag.generation.citations import normalize_answer_citations, parse_citations
        from libs.rag.generation.models import GenerationResult, GenerationStats, ParsedCitation
        from libs.rag.generation.prompts import build_messages
        from libs.rag.generation.service import REFUSAL_PHRASE

        from apps.api.app.services.query.sources import DOC_TITLES, resolve_doc_id

        def _cite_dict(c: ParsedCitation) -> Dict[str, Any]:
            doc_id = resolve_doc_id({}, c.chunk_id or "")
            if not doc_id and c.source_text:
                text = c.source_text.lower()
                if "kubernetes" in text or "pod scheduling" in text:
                    doc_id = "k8s-incident"
                elif "asyncio" in text or "aiohttp" in text:
                    doc_id = "python-async"
            return {
                "source_index": c.source_index,
                "chunk_id": c.chunk_id,
                "text_snippet": (c.source_text or "")[:280],
                "document_id": doc_id or None,
                "title": DOC_TITLES.get(doc_id) if doc_id else None,
                "url": f"/sources/{doc_id}" if doc_id else None,
            }

        def _pack(result: ObservedQueryResult) -> Dict[str, Any]:
            return {
                "query": result.query,
                "answer": result.answer,
                "trace_id": result.trace_id,
                "refused": result.refused,
                "model": result.generation.model,
                "citations": [_cite_dict(c) for c in result.generation.citations],
                "layer_latencies_ms": result.layer_latencies,
                "eval_scores": result.eval_scores or None,
                "total_latency_ms": result.total_latency_ms,
            }

        intent = classify_intent(question)
        if intent is QueryIntent.GREETING:
            yield {"type": "stage", "stage": "ready", "label": "Welcome"}
            result = self._greeting_answer(question)
            yield {"type": "done", "response": _pack(result)}
            return
        if intent is QueryIntent.CAPABILITY:
            yield {"type": "stage", "stage": "ready", "label": "Here’s what I can help with"}
            result = self._capability_answer(question)
            yield {"type": "done", "response": _pack(result)}
            return
        if intent is QueryIntent.OFF_TOPIC:
            yield {"type": "stage", "stage": "ready", "label": "Outside the indexed corpus"}
            result = self._off_topic_answer(question)
            yield {"type": "done", "response": _pack(result)}
            return

        start = time.monotonic()
        layer_latencies: Dict[str, float] = {}
        try:
            pipeline = self._ensure_pipeline()

            yield {
                "type": "stage",
                "stage": "retrieving",
                "label": "Searching your documents…",
            }
            t0 = time.monotonic()
            retrieval_result = pipeline.retrieval.retrieve(
                query=question, mode=retrieval_mode, top_k=top_k * 4
            )
            layer_latencies["retrieval"] = (time.monotonic() - t0) * 1000

            yield {
                "type": "stage",
                "stage": "reranking",
                "label": "Ranking the most useful passages…",
            }
            t0 = time.monotonic()
            rerank_result = pipeline.reranking.rerank_only(
                query=question, retrieval_result=retrieval_result, top_k=top_k
            )
            layer_latencies["reranking"] = (time.monotonic() - t0) * 1000

            yield {
                "type": "stage",
                "stage": "assembling",
                "label": "Assembling grounded context…",
            }
            t0 = time.monotonic()
            assembled = pipeline.context.assemble_from_rerank(rerank_result)
            layer_latencies["context"] = (time.monotonic() - t0) * 1000

            if not assembled.chunks:
                answer = REFUSAL_PHRASE
                generation = GenerationResult(
                    query=question,
                    answer=answer,
                    citations=[],
                    model=self._llm_model or "unknown",
                    stats=GenerationStats(),
                    refused=True,
                )
                total_ms = (time.monotonic() - start) * 1000
                yield {
                    "type": "done",
                    "response": {
                        "query": question,
                        "answer": answer,
                        "trace_id": str(uuid.uuid4()),
                        "refused": True,
                        "model": generation.model,
                        "citations": [],
                        "layer_latencies_ms": layer_latencies,
                        "eval_scores": None,
                        "total_latency_ms": total_ms,
                    },
                }
                return

            yield {
                "type": "stage",
                "stage": "generating",
                "label": "Writing your answer…",
            }
            cfg = pipeline.generation.config
            messages = build_messages(assembled, cfg)
            llm = pipeline.generation.llm_client

            t0 = time.monotonic()
            parts: list[str] = []
            stream_fn = getattr(llm, "stream", None)
            if callable(stream_fn):
                for piece in stream_fn(messages, cfg):
                    parts.append(piece)
                    yield {"type": "token", "text": piece}
            else:
                response = llm.generate(messages, cfg)
                content = response.get("content", "")
                # Fake-stream for non-streaming backends so UI still animates.
                for i in range(0, len(content), 12):
                    piece = content[i : i + 12]
                    parts.append(piece)
                    yield {"type": "token", "text": piece}
            layer_latencies["generation"] = (time.monotonic() - t0) * 1000

            raw = "".join(parts)
            answer = normalize_answer_citations(raw.strip())
            refused = REFUSAL_PHRASE.lower() in answer.lower()
            citations: list[ParsedCitation] = []
            if not refused:
                citations = parse_citations(answer, assembled, citation_prefix=cfg.citation_prefix)
                if not citations and assembled.chunks:
                    top = assembled.chunks[0]
                    citations = [
                        ParsedCitation(
                            label="[Source 1]",
                            source_index=1,
                            chunk_id=top.chunk_id,
                            source_text=top.text,
                            position=0,
                        )
                    ]
                    if "[Source " not in answer:
                        answer = f"{answer.rstrip()} [Source 1]"

            model_name = self._llm_model or getattr(llm, "config", cfg).model
            if self._llm_backend.startswith("mock"):
                model_name = "mock-llm"

            generation = GenerationResult(
                query=question,
                answer=answer,
                citations=citations,
                model=model_name,
                stats=GenerationStats(
                    prompt_tokens=estimate_token_count(" ".join(m["content"] for m in messages)),
                    completion_tokens=estimate_token_count(answer),
                    total_tokens=0,
                    context_chunks=len(assembled.chunks),
                    citations_found=len(citations),
                    unique_sources_cited=len({c.source_index for c in citations}),
                ),
                refused=refused,
            )

            eval_scores = {}
            if include_eval_scores:
                yield {
                    "type": "stage",
                    "stage": "scoring",
                    "label": "Checking grounding quality…",
                }
                t0 = time.monotonic()
                faith = pipeline.faithfulness.evaluate(generation, assembled)
                layer_latencies["eval"] = (time.monotonic() - t0) * 1000
                eval_scores = {
                    "faithfulness": faith.faithfulness,
                    "citation_precision": faith.citation_precision,
                    "hallucination_rate": faith.hallucination_rate,
                    "answer_relevancy": faith.answer_relevancy,
                    "answer_quality": round(
                        min(faith.faithfulness, faith.answer_relevancy), 4
                    ),
                }

            total_ms = (time.monotonic() - start) * 1000
            yield {
                "type": "done",
                "response": {
                    "query": question,
                    "answer": answer,
                    "trace_id": str(uuid.uuid4()),
                    "refused": refused,
                    "model": generation.model,
                    "citations": [_cite_dict(c) for c in citations],
                    "layer_latencies_ms": layer_latencies,
                    "eval_scores": eval_scores or None,
                    "total_latency_ms": total_ms,
                },
            }
        except Exception as exc:
            yield {"type": "error", "message": str(exc)}

    @property
    def persist_dir(self) -> Optional[str]:
        return self._persist_dir

    def health(self) -> Dict[str, Any]:
        """Pipeline readiness plus which backends are active."""
        try:
            self._ensure_pipeline()
            return {
                "status": "ready",
                "persist_dir": self._persist_dir,
                "llm_backend": self._llm_backend,
                "llm_model": self._llm_model,
                "embedding_backend": self._embedding_backend,
                "sources": list_sources(),
            }
        except Exception as exc:
            return {
                "status": "degraded",
                "error": str(exc),
                "llm_backend": self._llm_backend,
                "llm_model": self._llm_model,
                "embedding_backend": self._embedding_backend,
                "sources": list_sources(),
            }
