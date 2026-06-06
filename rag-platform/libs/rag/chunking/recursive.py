"""Recursive text chunker implementation.

This is the baseline chunker that recursively splits text using a hierarchy
of separators, trying the largest semantic boundaries first before falling
back to smaller ones.

Based on best practices from:
- LangChain's RecursiveCharacterTextSplitter
- 2026 RAG benchmarks showing 512 tokens + 10-20% overlap as optimal default
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult

from .base import BaseChunker, ChunkerConfig
from .utils import (
    TextSpan,
    chars_for_tokens,
    create_overlap_text,
    estimate_token_count,
    merge_small_spans,
    normalize_whitespace,
)


class RecursiveChunker(BaseChunker):
    """Recursive text chunker that preserves semantic structure.
    
    Splitting strategy:
    1. Try to split on the first (largest) separator in the list
    2. If resulting segments are still too large, recursively split
       using the next separator
    3. Continue until segments fit within chunk_size, or fall back
       to character splitting
    
    This approach preserves document structure by preferring splits at
    natural boundaries (headers > paragraphs > sentences > words).
    """
    
    @property
    def strategy_name(self) -> str:
        return "recursive"
    
    def chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Split text into chunks using recursive separator strategy.
        
        Args:
            text: Full document text.
            document_id: Parent document UUID.
            version_id: Document version UUID.
            base_metadata: Metadata to attach to all chunks.
        
        Returns:
            ChunkingResult with all chunks.
        """
        self._validate_input(text)
        
        normalized = normalize_whitespace(text)
        
        target_chars = chars_for_tokens(self.config.chunk_size)
        
        raw_spans = self._recursive_split(
            text=normalized,
            separators=list(self.config.separators),
            target_size=target_chars,
            start_offset=0,
        )
        
        merged_spans = merge_small_spans(
            spans=raw_spans,
            min_tokens=self.config.min_chunk_size,
            max_tokens=self.config.max_chunk_size,
        )
        
        chunks = self._create_chunks_with_overlap(
            spans=merged_spans,
            document_id=document_id,
            version_id=version_id,
            base_metadata=base_metadata,
        )
        
        return self._create_result(document_id, version_id, chunks)
    
    def _recursive_split(
        self,
        text: str,
        separators: List[str],
        target_size: int,
        start_offset: int,
    ) -> List[TextSpan]:
        """Recursively split text using separator hierarchy.
        
        Args:
            text: Text to split.
            separators: Remaining separators to try (in order).
            target_size: Target chunk size in characters.
            start_offset: Character offset in original document.
        
        Returns:
            List of TextSpan objects.
        """
        if not text.strip():
            return []
        
        if len(text) <= target_size:
            return [TextSpan(text=text, start=start_offset, end=start_offset + len(text))]
        
        if not separators:
            return self._force_split(text, target_size, start_offset)
        
        separator = separators[0]
        remaining_separators = separators[1:]
        
        if separator not in text:
            return self._recursive_split(text, remaining_separators, target_size, start_offset)
        
        segments = self._split_on_separator(text, separator)
        
        result = []
        current_offset = start_offset
        
        for segment in segments:
            if not segment.strip():
                current_offset += len(segment)
                continue
            
            segment_size = len(segment)
            
            if segment_size <= target_size:
                result.append(TextSpan(
                    text=segment,
                    start=current_offset,
                    end=current_offset + segment_size,
                ))
            else:
                sub_spans = self._recursive_split(
                    text=segment,
                    separators=remaining_separators,
                    target_size=target_size,
                    start_offset=current_offset,
                )
                result.extend(sub_spans)
            
            current_offset += segment_size
        
        return result
    
    def _split_on_separator(self, text: str, separator: str) -> List[str]:
        """Split text on separator, keeping separator with following text.
        
        Args:
            text: Text to split.
            separator: Separator string.
        
        Returns:
            List of text segments.
        """
        if not separator or separator not in text:
            return [text] if text else []
        
        parts = text.split(separator)
        
        if not parts:
            return []
        
        result = [parts[0]] if parts[0] else []
        
        for part in parts[1:]:
            result.append(separator + part if part else separator)
        
        return [p for p in result if p.strip()]
    
    def _force_split(
        self,
        text: str,
        target_size: int,
        start_offset: int,
    ) -> List[TextSpan]:
        """Force split text at character boundaries when no separators work.
        
        Tries to split at word boundaries to avoid breaking words.
        
        Args:
            text: Text to split.
            target_size: Target size in characters.
            start_offset: Offset in original document.
        
        Returns:
            List of TextSpan objects.
        """
        result = []
        remaining = text
        current_offset = start_offset
        
        max_iterations = (len(text) // max(1, target_size // 2)) + 10
        iteration = 0
        
        while remaining and iteration < max_iterations:
            iteration += 1
            
            if len(remaining) <= target_size:
                result.append(TextSpan(
                    text=remaining,
                    start=current_offset,
                    end=current_offset + len(remaining),
                ))
                break
            
            split_point = target_size
            
            search_start = max(0, target_size - 50)
            space_pos = remaining.rfind(" ", search_start, target_size)
            if space_pos > search_start:
                split_point = space_pos + 1
            
            chunk_text = remaining[:split_point]
            result.append(TextSpan(
                text=chunk_text,
                start=current_offset,
                end=current_offset + len(chunk_text),
            ))
            
            remaining = remaining[split_point:].lstrip()
            current_offset += split_point + (len(remaining) - len(remaining.lstrip()) if remaining else 0)
            
            current_offset = result[-1].end
            remaining = text[current_offset - start_offset:] if current_offset - start_offset < len(text) else ""
        
        return result
    
    def _create_chunks_with_overlap(
        self,
        spans: List[TextSpan],
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> List[Chunk]:
        """Create Chunk objects from spans, adding overlap between chunks.
        
        Args:
            spans: List of text spans.
            document_id: Parent document ID.
            version_id: Document version ID.
            base_metadata: Base metadata for all chunks.
        
        Returns:
            List of Chunk objects with overlap applied.
        """
        if not spans:
            return []
        
        chunks = []
        previous_text = ""
        
        for idx, span in enumerate(spans):
            chunk_text = span.text
            
            if idx > 0 and self.config.chunk_overlap > 0 and previous_text:
                overlap = create_overlap_text(previous_text, self.config.chunk_overlap)
                if overlap:
                    chunk_text = overlap + "\n\n" + chunk_text
            
            chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=idx,
                chunk_text=chunk_text.strip(),
                token_count=estimate_token_count(chunk_text),
                metadata=base_metadata,
                start_char_offset=span.start,
                end_char_offset=span.end,
            )
            chunks.append(chunk)
            previous_text = span.text
        
        return chunks
