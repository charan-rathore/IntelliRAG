"""Citation-aware prompt templates for generation-time attribution (G-Cite)."""

from __future__ import annotations

from libs.rag.context.models import AssembledContext

from .config import GenerationConfig

CITATION_AWARE_SYSTEM = """You are a precise knowledge assistant that answers questions using ONLY the provided sources.

Rules:
1. Answer ONLY using information explicitly stated in the provided sources.
2. After each factual claim, cite the source using [{prefix} N] format where N is the source number.
3. If the sources do not contain enough information to answer, respond with exactly: "I cannot answer based on the provided sources."
4. Do NOT use prior knowledge. Do NOT invent facts, numbers, or names not in the sources.
5. Every sentence containing a factual claim MUST include at least one citation.
6. Do not cite a source unless that source directly supports the claim."""

CONCISE_SYSTEM = """Answer the question using only the provided sources. Cite each claim with [{prefix} N]. If sources are insufficient, say "I cannot answer based on the provided sources." """

DETAILED_SYSTEM = """You are a thorough technical knowledge assistant. Answer using ONLY the provided sources.

Write a complete, readable answer:
1. Start with a clear direct answer in 1-2 sentences.
2. Add supporting detail (symptoms, causes, steps, or caveats) grounded in the sources.
3. After each factual claim, cite exactly as [{prefix} N] — never [N], never footnotes.
4. If sources are insufficient, respond with exactly: "I cannot answer based on the provided sources."
5. Do NOT invent facts. Do NOT paste markdown headings (# Title) from the sources into the answer.
6. Prefer 3-6 clear sentences. End after the last cited sentence — no bibliography block."""


def build_system_prompt(config: GenerationConfig) -> str:
    """Build the system prompt for the configured style."""
    templates = {
        "citation_aware": CITATION_AWARE_SYSTEM,
        "concise": CONCISE_SYSTEM,
        "detailed": DETAILED_SYSTEM,
    }
    template = templates.get(config.prompt_style, CITATION_AWARE_SYSTEM)
    return template.format(prefix=config.citation_prefix)


def build_user_prompt(
    context: AssembledContext,
    config: GenerationConfig,
) -> str:
    """Build the user prompt with assembled context and query."""
    parts = [
        "Sources:",
        context.context_text,
        "",
        f"Question: {context.query}",
        "",
        "Answer with a complete, readable response and inline citations:",
    ]
    return "\n".join(parts)


def build_messages(
    context: AssembledContext,
    config: GenerationConfig,
) -> list[dict[str, str]]:
    """Build chat messages for Ollama /api/chat."""
    return [
        {"role": "system", "content": build_system_prompt(config)},
        {"role": "user", "content": build_user_prompt(context, config)},
    ]
