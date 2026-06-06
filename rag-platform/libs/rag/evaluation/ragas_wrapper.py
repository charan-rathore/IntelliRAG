"""RAGAS integration wrapper for chunking evaluation.

This module wraps the RAGAS library to provide a clean interface for
evaluating retrieval quality metrics on chunked documents.

Supports multiple LLM providers:
- Ollama (local, no API key required)
- OpenAI
- HuggingFace
- Azure OpenAI

The key metrics for chunking evaluation:
- context_precision: How relevant are the retrieved chunks to the query?
- context_recall: Do the chunks contain all info needed for the answer?

Higher precision = less noise from irrelevant chunks
Higher recall = chunks preserve necessary information
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


class LLMProvider(Enum):
    """Supported LLM providers for RAGAS evaluation."""
    OLLAMA = "ollama"
    OPENAI = "openai"
    HUGGINGFACE = "huggingface"
    AZURE_OPENAI = "azure_openai"


@dataclass
class OllamaConfig:
    """Configuration for Ollama local models.
    
    Attributes:
        model: Ollama model name (e.g., "llama3", "mistral", "mixtral").
        embedding_model: Embedding model (e.g., "nomic-embed-text", "mxbai-embed-large").
        base_url: Ollama server URL (default: http://localhost:11434).
        temperature: Sampling temperature for generation.
        num_ctx: Context window size.
    """
    model: str = "llama3"
    embedding_model: str = "nomic-embed-text"
    base_url: str = "http://localhost:11434"
    temperature: float = 0.0
    num_ctx: int = 4096


@dataclass
class OpenAIConfig:
    """Configuration for OpenAI models.
    
    Attributes:
        model: OpenAI model name (e.g., "gpt-4o-mini", "gpt-4o").
        embedding_model: Embedding model (e.g., "text-embedding-3-small").
        api_key: OpenAI API key (or use OPENAI_API_KEY env var).
        timeout: Request timeout in seconds.
    """
    model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    api_key: Optional[str] = None
    timeout: int = 60


@dataclass
class HuggingFaceConfig:
    """Configuration for HuggingFace models.
    
    Attributes:
        model: HuggingFace model repo ID (e.g., "mistralai/Mistral-7B-Instruct-v0.2").
        embedding_model: Sentence transformer model (e.g., "BAAI/bge-small-en-v1.5").
        api_token: HuggingFace API token (optional for public models).
    """
    model: str = "mistralai/Mistral-7B-Instruct-v0.2"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    api_token: Optional[str] = None


@dataclass
class RagasConfig:
    """Configuration for RAGAS evaluator.
    
    Attributes:
        provider: LLM provider to use (ollama, openai, huggingface).
        ollama: Ollama-specific configuration.
        openai: OpenAI-specific configuration.
        huggingface: HuggingFace-specific configuration.
        batch_size: Number of samples to evaluate in parallel.
    """
    provider: LLMProvider = LLMProvider.OLLAMA
    ollama: OllamaConfig = field(default_factory=OllamaConfig)
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    huggingface: HuggingFaceConfig = field(default_factory=HuggingFaceConfig)
    batch_size: int = 10
    
    @classmethod
    def for_ollama(
        cls,
        model: str = "llama3",
        embedding_model: str = "nomic-embed-text",
        base_url: str = "http://localhost:11434",
    ) -> "RagasConfig":
        """Create config for Ollama (local models, no API key needed)."""
        return cls(
            provider=LLMProvider.OLLAMA,
            ollama=OllamaConfig(
                model=model,
                embedding_model=embedding_model,
                base_url=base_url,
            ),
        )
    
    @classmethod
    def for_openai(
        cls,
        model: str = "gpt-4o-mini",
        api_key: Optional[str] = None,
    ) -> "RagasConfig":
        """Create config for OpenAI."""
        return cls(
            provider=LLMProvider.OPENAI,
            openai=OpenAIConfig(model=model, api_key=api_key),
        )
    
    @classmethod
    def for_huggingface(
        cls,
        model: str = "mistralai/Mistral-7B-Instruct-v0.2",
        embedding_model: str = "BAAI/bge-small-en-v1.5",
    ) -> "RagasConfig":
        """Create config for HuggingFace."""
        return cls(
            provider=LLMProvider.HUGGINGFACE,
            huggingface=HuggingFaceConfig(
                model=model,
                embedding_model=embedding_model,
            ),
        )


class RagasEvaluator:
    """Wrapper for RAGAS evaluation library.
    
    Supports multiple LLM providers including local Ollama models
    for evaluation without API keys.
    
    Example with Ollama (no API key needed):
        config = RagasConfig.for_ollama(model="llama3")
        evaluator = RagasEvaluator(config)
        
        scores = evaluator.evaluate_retrieval(
            questions=["What is X?"],
            contexts=[["chunk1", "chunk2"]],
            ground_truths=["X is..."],
        )
    
    Example with OpenAI:
        config = RagasConfig.for_openai(model="gpt-4o-mini")
        evaluator = RagasEvaluator(config)
    """
    
    def __init__(self, config: Optional[RagasConfig] = None) -> None:
        """Initialize RAGAS evaluator.
        
        Args:
            config: RAGAS configuration. Defaults to Ollama with llama3.
        """
        self.config = config or RagasConfig()
        self._ragas_available = self._check_ragas_available()
        self._initialized = False
        self._llm = None
        self._embeddings = None
    
    def _check_ragas_available(self) -> bool:
        """Check if RAGAS library is installed."""
        try:
            import ragas
            return True
        except ImportError:
            logger.warning(
                "RAGAS library not installed. Install with: pip install ragas"
            )
            return False
    
    def _initialize_ollama(self) -> None:
        """Initialize Ollama LLM and embeddings."""
        cfg = self.config.ollama
        
        try:
            from langchain_ollama import ChatOllama, OllamaEmbeddings
            
            self._llm = ChatOllama(
                model=cfg.model,
                base_url=cfg.base_url,
                temperature=cfg.temperature,
                num_ctx=cfg.num_ctx,
            )
            self._embeddings = OllamaEmbeddings(
                model=cfg.embedding_model,
                base_url=cfg.base_url,
            )
            logger.info(f"Initialized Ollama with model={cfg.model}")
            
        except ImportError:
            try:
                from langchain_community.chat_models import ChatOllama
                from langchain_community.embeddings import OllamaEmbeddings
                
                self._llm = ChatOllama(
                    model=cfg.model,
                    base_url=cfg.base_url,
                    temperature=cfg.temperature,
                )
                self._embeddings = OllamaEmbeddings(
                    model=cfg.embedding_model,
                    base_url=cfg.base_url,
                )
                logger.info(f"Initialized Ollama (community) with model={cfg.model}")
                
            except ImportError:
                raise RuntimeError(
                    "Ollama integration requires langchain-ollama or langchain-community. "
                    "Install with: pip install langchain-ollama"
                )
    
    def _initialize_openai(self) -> None:
        """Initialize OpenAI LLM and embeddings."""
        import os
        
        cfg = self.config.openai
        api_key = cfg.api_key or os.environ.get("OPENAI_API_KEY")
        
        if not api_key:
            raise ValueError(
                "OpenAI API key required. Set OPENAI_API_KEY environment "
                "variable or pass via OpenAIConfig."
            )
        
        try:
            from langchain_openai import ChatOpenAI, OpenAIEmbeddings
            
            self._llm = ChatOpenAI(
                model=cfg.model,
                api_key=api_key,
                timeout=cfg.timeout,
            )
            self._embeddings = OpenAIEmbeddings(
                model=cfg.embedding_model,
                api_key=api_key,
            )
            logger.info(f"Initialized OpenAI with model={cfg.model}")
            
        except ImportError:
            raise RuntimeError(
                "OpenAI integration requires langchain-openai. "
                "Install with: pip install langchain-openai"
            )
    
    def _initialize_huggingface(self) -> None:
        """Initialize HuggingFace LLM and embeddings."""
        import os
        
        cfg = self.config.huggingface
        api_token = cfg.api_token or os.environ.get("HUGGINGFACEHUB_API_TOKEN")
        
        try:
            from langchain_huggingface import (
                HuggingFaceEndpoint,
                HuggingFaceEmbeddings,
            )
            
            self._llm = HuggingFaceEndpoint(
                repo_id=cfg.model,
                huggingfacehub_api_token=api_token,
            )
            self._embeddings = HuggingFaceEmbeddings(
                model_name=cfg.embedding_model,
            )
            logger.info(f"Initialized HuggingFace with model={cfg.model}")
            
        except ImportError:
            raise RuntimeError(
                "HuggingFace integration requires langchain-huggingface. "
                "Install with: pip install langchain-huggingface"
            )
    
    def _initialize_llm(self) -> None:
        """Initialize LLM and embeddings based on configured provider."""
        if self._initialized:
            return
        
        if not self._ragas_available:
            raise RuntimeError("RAGAS library is not installed")
        
        provider = self.config.provider
        
        if provider == LLMProvider.OLLAMA:
            self._initialize_ollama()
        elif provider == LLMProvider.OPENAI:
            self._initialize_openai()
        elif provider == LLMProvider.HUGGINGFACE:
            self._initialize_huggingface()
        else:
            raise ValueError(f"Unsupported provider: {provider}")
        
        self._initialized = True
    
    def evaluate_retrieval(
        self,
        questions: List[str],
        contexts: List[List[str]],
        ground_truths: List[str],
        answers: Optional[List[str]] = None,
    ) -> Dict[str, float]:
        """Evaluate retrieval quality using RAGAS metrics.
        
        This is the core evaluation method. It measures how well the
        retrieved contexts (chunks) support answering the questions.
        
        Args:
            questions: List of evaluation questions.
            contexts: List of retrieved context lists (chunks per question).
            ground_truths: Expected correct answers.
            answers: Optional LLM-generated answers (uses ground_truths if None).
        
        Returns:
            Dictionary with metric scores (0-1 scale).
            
        Raises:
            RuntimeError: If RAGAS is not installed.
            ValueError: If input lengths don't match.
        """
        if len(questions) != len(contexts) or len(contexts) != len(ground_truths):
            raise ValueError(
                f"Input lengths must match: questions={len(questions)}, "
                f"contexts={len(contexts)}, ground_truths={len(ground_truths)}"
            )
        
        if not self._ragas_available:
            return self._fallback_evaluation(questions, contexts, ground_truths)
        
        try:
            self._initialize_llm()
        except Exception as e:
            logger.warning(f"Failed to initialize LLM: {e}. Using fallback.")
            return self._fallback_evaluation(questions, contexts, ground_truths)
        
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import (
            context_precision,
            context_recall,
        )
        
        eval_data = {
            "question": questions,
            "contexts": contexts,
            "ground_truth": ground_truths,
            "answer": answers if answers else ground_truths,
        }
        
        dataset = Dataset.from_dict(eval_data)
        
        try:
            result = evaluate(
                dataset,
                metrics=[context_precision, context_recall],
                llm=self._llm,
                embeddings=self._embeddings,
            )
            
            return {
                "context_precision": result["context_precision"],
                "context_recall": result["context_recall"],
                "provider": self.config.provider.value,
            }
            
        except Exception as e:
            logger.error(f"RAGAS evaluation failed: {e}")
            return self._fallback_evaluation(questions, contexts, ground_truths)
    
    def evaluate_full(
        self,
        questions: List[str],
        contexts: List[List[str]],
        ground_truths: List[str],
        answers: List[str],
    ) -> Dict[str, float]:
        """Run full RAGAS evaluation including generation metrics.
        
        In addition to retrieval metrics, this evaluates the quality
        of LLM-generated answers.
        
        Args:
            questions: Evaluation questions.
            contexts: Retrieved contexts per question.
            ground_truths: Expected answers.
            answers: LLM-generated answers to evaluate.
        
        Returns:
            Dictionary with all RAGAS metrics.
        """
        if not self._ragas_available:
            return self._fallback_evaluation(questions, contexts, ground_truths)
        
        self._initialize_llm()
        
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )
        
        eval_data = {
            "question": questions,
            "contexts": contexts,
            "ground_truth": ground_truths,
            "answer": answers,
        }
        
        dataset = Dataset.from_dict(eval_data)
        
        try:
            result = evaluate(
                dataset,
                metrics=[
                    context_precision,
                    context_recall,
                    faithfulness,
                    answer_relevancy,
                ],
                llm=self._llm,
                embeddings=self._embeddings,
            )
            
            return {
                "context_precision": result["context_precision"],
                "context_recall": result["context_recall"],
                "faithfulness": result["faithfulness"],
                "answer_relevancy": result["answer_relevancy"],
                "provider": self.config.provider.value,
            }
            
        except Exception as e:
            logger.error(f"Full RAGAS evaluation failed: {e}")
            raise
    
    def evaluate_per_sample(
        self,
        questions: List[str],
        contexts: List[List[str]],
        ground_truths: List[str],
    ) -> List[Dict[str, float]]:
        """Evaluate and return per-sample scores.
        
        Useful for identifying which samples have poor chunk coverage.
        
        Args:
            questions: Evaluation questions.
            contexts: Retrieved contexts per question.
            ground_truths: Expected answers.
        
        Returns:
            List of score dictionaries, one per sample.
        """
        if not self._ragas_available:
            return [
                self._fallback_sample_score(q, ctx, gt)
                for q, ctx, gt in zip(questions, contexts, ground_truths)
            ]
        
        self._initialize_llm()
        
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import context_precision, context_recall
        
        per_sample_scores = []
        
        for i, (q, ctx, gt) in enumerate(zip(questions, contexts, ground_truths)):
            eval_data = {
                "question": [q],
                "contexts": [ctx],
                "ground_truth": [gt],
                "answer": [gt],
            }
            
            dataset = Dataset.from_dict(eval_data)
            
            try:
                result = evaluate(
                    dataset,
                    metrics=[context_precision, context_recall],
                    llm=self._llm,
                    embeddings=self._embeddings,
                )
                
                per_sample_scores.append({
                    "sample_index": i,
                    "context_precision": result["context_precision"],
                    "context_recall": result["context_recall"],
                })
                
            except Exception as e:
                logger.warning(f"Failed to evaluate sample {i}: {e}")
                per_sample_scores.append({
                    "sample_index": i,
                    "context_precision": 0.0,
                    "context_recall": 0.0,
                    "error": str(e),
                })
        
        return per_sample_scores
    
    def _fallback_evaluation(
        self,
        questions: List[str],
        contexts: List[List[str]],
        ground_truths: List[str],
    ) -> Dict[str, float]:
        """Fallback evaluation using simple heuristics when LLM unavailable.
        
        Uses lexical overlap as a proxy for semantic similarity.
        This is NOT a replacement for proper RAGAS evaluation.
        """
        logger.warning(
            "Using fallback evaluation (lexical overlap). "
            "Configure an LLM provider for accurate metrics."
        )
        
        precision_scores = []
        recall_scores = []
        
        for question, ctx_list, ground_truth in zip(questions, contexts, ground_truths):
            if not ctx_list:
                precision_scores.append(0.0)
                recall_scores.append(0.0)
                continue
            
            gt_words = set(ground_truth.lower().split())
            
            relevant_chunks = 0
            for ctx in ctx_list:
                ctx_words = set(ctx.lower().split())
                overlap = len(gt_words & ctx_words) / max(len(gt_words), 1)
                if overlap > 0.1:
                    relevant_chunks += 1
            
            precision = relevant_chunks / len(ctx_list) if ctx_list else 0.0
            precision_scores.append(precision)
            
            all_ctx_words = set()
            for ctx in ctx_list:
                all_ctx_words.update(ctx.lower().split())
            
            recall = len(gt_words & all_ctx_words) / max(len(gt_words), 1)
            recall_scores.append(recall)
        
        return {
            "context_precision": sum(precision_scores) / max(len(precision_scores), 1),
            "context_recall": sum(recall_scores) / max(len(recall_scores), 1),
            "_is_fallback": True,
        }
    
    def _fallback_sample_score(
        self,
        question: str,
        contexts: List[str],
        ground_truth: str,
    ) -> Dict[str, float]:
        """Compute fallback score for a single sample."""
        gt_words = set(ground_truth.lower().split())
        
        if not contexts:
            return {"context_precision": 0.0, "context_recall": 0.0}
        
        relevant = sum(
            1 for ctx in contexts
            if len(gt_words & set(ctx.lower().split())) / max(len(gt_words), 1) > 0.1
        )
        precision = relevant / len(contexts)
        
        all_ctx_words = set()
        for ctx in contexts:
            all_ctx_words.update(ctx.lower().split())
        
        recall = len(gt_words & all_ctx_words) / max(len(gt_words), 1)
        
        return {"context_precision": precision, "context_recall": recall}


def create_ollama_evaluator(
    model: str = "llama3",
    embedding_model: str = "nomic-embed-text",
    base_url: str = "http://localhost:11434",
) -> RagasEvaluator:
    """Create evaluator using Ollama (no API key needed).
    
    Prerequisites:
        1. Install Ollama: https://ollama.ai
        2. Pull models: ollama pull llama3 && ollama pull nomic-embed-text
        3. Ollama server runs automatically on localhost:11434
    
    Args:
        model: Ollama chat model (llama3, mistral, mixtral, etc.).
        embedding_model: Ollama embedding model.
        base_url: Ollama server URL.
    
    Returns:
        Configured RagasEvaluator for local evaluation.
    
    Example:
        evaluator = create_ollama_evaluator(model="mistral")
        scores = evaluator.evaluate_retrieval(questions, contexts, ground_truths)
    """
    config = RagasConfig.for_ollama(
        model=model,
        embedding_model=embedding_model,
        base_url=base_url,
    )
    return RagasEvaluator(config)


def create_openai_evaluator(
    model: str = "gpt-4o-mini",
    api_key: Optional[str] = None,
) -> RagasEvaluator:
    """Create evaluator using OpenAI.
    
    Args:
        model: OpenAI model name.
        api_key: API key (or use OPENAI_API_KEY env var).
    
    Returns:
        Configured RagasEvaluator for OpenAI.
    """
    config = RagasConfig.for_openai(model=model, api_key=api_key)
    return RagasEvaluator(config)


def create_evaluator(
    provider: str = "ollama",
    model: Optional[str] = None,
    **kwargs,
) -> RagasEvaluator:
    """Factory function to create a configured evaluator.
    
    Args:
        provider: LLM provider ("ollama", "openai", "huggingface").
        model: Model name (uses provider default if not specified).
        **kwargs: Additional provider-specific configuration.
    
    Returns:
        Configured RagasEvaluator instance.
    
    Examples:
        # Local evaluation with Ollama (no API key)
        evaluator = create_evaluator("ollama", model="llama3")
        
        # OpenAI evaluation
        evaluator = create_evaluator("openai", model="gpt-4o-mini")
    """
    provider = provider.lower()
    
    if provider == "ollama":
        return create_ollama_evaluator(
            model=model or "llama3",
            **kwargs,
        )
    elif provider == "openai":
        return create_openai_evaluator(
            model=model or "gpt-4o-mini",
            api_key=kwargs.get("api_key"),
        )
    elif provider == "huggingface":
        config = RagasConfig.for_huggingface(
            model=model or "mistralai/Mistral-7B-Instruct-v0.2",
        )
        return RagasEvaluator(config)
    else:
        raise ValueError(
            f"Unknown provider: {provider}. "
            f"Supported: ollama, openai, huggingface"
        )
