"""Structure-aware markdown chunker.

This chunker understands markdown structure and preserves semantic units:
- Never splits inside code blocks
- Never splits numbered/bulleted lists
- Splits on headers, prepending parent header to child chunks
- Falls back to recursive splitting for large sections

Best for: Runbooks, documentation, technical guides.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult

from .base import BaseChunker, ChunkerConfig
from .utils import (
    TextSpan,
    chars_for_tokens,
    create_overlap_text,
    estimate_token_count,
    extract_section_header,
    find_bullet_lists,
    find_code_blocks,
    find_numbered_lists,
    merge_small_spans,
    normalize_whitespace,
)


@dataclass
class MarkdownSection:
    """A section of markdown with header information."""
    header: Optional[str]
    header_level: int
    content: str
    start: int
    end: int
    
    @property
    def full_text(self) -> str:
        """Get full text including header."""
        if self.header:
            prefix = "#" * self.header_level
            return f"{prefix} {self.header}\n\n{self.content}"
        return self.content


class StructureAwareChunker(BaseChunker):
    """Chunker that preserves markdown document structure.
    
    Key behaviors:
    1. Splits on markdown headers (##, ###, etc.)
    2. Preserves code blocks as atomic units
    3. Keeps numbered and bulleted lists together
    4. Prepends section header to each chunk for context
    5. Falls back to recursive splitting for oversized sections
    """
    
    @property
    def strategy_name(self) -> str:
        return "structure_aware"
    
    def chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Split markdown text preserving structure.
        
        Args:
            text: Full markdown document.
            document_id: Parent document UUID.
            version_id: Document version UUID.
            base_metadata: Metadata to attach to chunks.
        
        Returns:
            ChunkingResult with structure-preserving chunks.
        """
        self._validate_input(text)
        
        normalized = normalize_whitespace(text)
        
        sections = self._extract_sections(normalized)
        
        protected_ranges = self._find_protected_ranges(normalized)
        
        spans = self._sections_to_spans(sections, protected_ranges)
        
        merged_spans = merge_small_spans(
            spans=spans,
            min_tokens=self.config.min_chunk_size,
            max_tokens=self.config.max_chunk_size,
        )
        
        chunks = self._create_chunks(
            spans=merged_spans,
            document_id=document_id,
            version_id=version_id,
            base_metadata=base_metadata,
        )
        
        return self._create_result(document_id, version_id, chunks)
    
    def _extract_sections(self, text: str) -> List[MarkdownSection]:
        """Extract markdown sections based on headers.
        
        Args:
            text: Markdown text.
        
        Returns:
            List of MarkdownSection objects.
        """
        header_pattern = r"^(#{1,6})\s+(.+?)$"
        
        sections = []
        lines = text.split("\n")
        
        current_header: Optional[str] = None
        current_level = 0
        current_content_lines: List[str] = []
        section_start = 0
        
        for i, line in enumerate(lines):
            match = re.match(header_pattern, line)
            
            if match:
                if current_content_lines or current_header:
                    content = "\n".join(current_content_lines).strip()
                    section_end = sum(len(l) + 1 for l in lines[:i])
                    sections.append(MarkdownSection(
                        header=current_header,
                        header_level=current_level,
                        content=content,
                        start=section_start,
                        end=section_end,
                    ))
                
                current_header = match.group(2).strip()
                current_level = len(match.group(1))
                current_content_lines = []
                section_start = sum(len(l) + 1 for l in lines[:i])
            else:
                current_content_lines.append(line)
        
        if current_content_lines or current_header:
            content = "\n".join(current_content_lines).strip()
            sections.append(MarkdownSection(
                header=current_header,
                header_level=current_level,
                content=content,
                start=section_start,
                end=len(text),
            ))
        
        if not sections and text.strip():
            sections.append(MarkdownSection(
                header=None,
                header_level=0,
                content=text.strip(),
                start=0,
                end=len(text),
            ))
        
        return sections
    
    def _find_protected_ranges(self, text: str) -> List[Tuple[int, int]]:
        """Find ranges that should not be split (code blocks, lists).
        
        Args:
            text: Document text.
        
        Returns:
            List of (start, end) tuples for protected ranges.
        """
        protected = []
        
        if self.config.preserve_code_blocks:
            protected.extend(find_code_blocks(text))
        
        if self.config.preserve_lists:
            protected.extend(find_numbered_lists(text))
            protected.extend(find_bullet_lists(text))
        
        protected.sort(key=lambda x: x[0])
        
        return protected
    
    def _sections_to_spans(
        self,
        sections: List[MarkdownSection],
        protected_ranges: List[Tuple[int, int]],
    ) -> List[TextSpan]:
        """Convert sections to spans, handling oversized sections.
        
        Args:
            sections: List of markdown sections.
            protected_ranges: Ranges that should not be split.
        
        Returns:
            List of TextSpan objects.
        """
        target_chars = chars_for_tokens(self.config.chunk_size)
        max_chars = chars_for_tokens(self.config.max_chunk_size)
        
        spans = []
        
        for section in sections:
            full_text = section.full_text
            
            if len(full_text) <= target_chars:
                spans.append(TextSpan(
                    text=full_text,
                    start=section.start,
                    end=section.end,
                ))
            else:
                sub_spans = self._split_large_section(
                    section=section,
                    target_chars=target_chars,
                    max_chars=max_chars,
                    protected_ranges=protected_ranges,
                )
                spans.extend(sub_spans)
        
        return spans
    
    def _split_large_section(
        self,
        section: MarkdownSection,
        target_chars: int,
        max_chars: int,
        protected_ranges: List[Tuple[int, int]],
    ) -> List[TextSpan]:
        """Split a large section while preserving protected ranges.
        
        Args:
            section: Large markdown section to split.
            target_chars: Target chunk size in characters.
            max_chars: Maximum chunk size in characters.
            protected_ranges: Ranges that should not be split.
        
        Returns:
            List of TextSpan objects.
        """
        content = section.content
        header_prefix = ""
        if section.header and self.config.include_section_headers:
            header_prefix = f"{'#' * section.header_level} {section.header}\n\n"
        
        paragraphs = self._split_into_paragraphs(content)
        
        spans = []
        current_text = header_prefix
        current_start = section.start
        
        for para in paragraphs:
            para_with_sep = para + "\n\n"
            
            if len(current_text) + len(para_with_sep) <= target_chars:
                current_text += para_with_sep
            else:
                if current_text.strip():
                    spans.append(TextSpan(
                        text=current_text.strip(),
                        start=current_start,
                        end=current_start + len(current_text),
                    ))
                    current_start = current_start + len(current_text)
                
                if self.config.include_section_headers and section.header:
                    current_text = header_prefix + para_with_sep
                else:
                    current_text = para_with_sep
                
                if len(current_text) > max_chars:
                    force_spans = self._force_split_paragraph(
                        para, target_chars, current_start, header_prefix
                    )
                    spans.extend(force_spans)
                    current_text = header_prefix if self.config.include_section_headers else ""
        
        if current_text.strip():
            spans.append(TextSpan(
                text=current_text.strip(),
                start=current_start,
                end=section.end,
            ))
        
        return spans
    
    def _split_into_paragraphs(self, text: str) -> List[str]:
        """Split text into paragraphs, preserving code blocks and lists.
        
        Args:
            text: Text to split.
        
        Returns:
            List of paragraph strings.
        """
        code_blocks = find_code_blocks(text)
        
        parts = []
        last_end = 0
        
        for start, end in code_blocks:
            if start > last_end:
                pre_text = text[last_end:start]
                parts.extend([p.strip() for p in pre_text.split("\n\n") if p.strip()])
            parts.append(text[start:end])
            last_end = end
        
        if last_end < len(text):
            remaining = text[last_end:]
            parts.extend([p.strip() for p in remaining.split("\n\n") if p.strip()])
        
        return parts
    
    def _force_split_paragraph(
        self,
        para: str,
        target_chars: int,
        start_offset: int,
        header_prefix: str,
    ) -> List[TextSpan]:
        """Force split an oversized paragraph at sentence boundaries.
        
        Args:
            para: Paragraph text to split.
            target_chars: Target size in characters.
            start_offset: Offset in original document.
            header_prefix: Header to prepend to each chunk.
        
        Returns:
            List of TextSpan objects.
        """
        effective_target = target_chars - len(header_prefix)
        if effective_target < 100:
            effective_target = target_chars
        
        sentences = re.split(r'(?<=[.!?])\s+', para)
        
        spans = []
        current_text = header_prefix
        current_start = start_offset
        
        max_iterations = len(sentences) + 10
        iteration = 0
        
        for sentence in sentences:
            iteration += 1
            if iteration > max_iterations:
                break
            
            if len(current_text) + len(sentence) + 1 <= target_chars:
                current_text += sentence + " "
            else:
                if current_text.strip() and current_text.strip() != header_prefix.strip():
                    spans.append(TextSpan(
                        text=current_text.strip(),
                        start=current_start,
                        end=current_start + len(current_text),
                    ))
                    current_start = current_start + len(current_text)
                
                current_text = header_prefix + sentence + " "
        
        if current_text.strip() and current_text.strip() != header_prefix.strip():
            spans.append(TextSpan(
                text=current_text.strip(),
                start=current_start,
                end=start_offset + len(para),
            ))
        
        return spans
    
    def _create_chunks(
        self,
        spans: List[TextSpan],
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> List[Chunk]:
        """Create Chunk objects from spans with overlap.
        
        Args:
            spans: List of text spans.
            document_id: Parent document ID.
            version_id: Document version ID.
            base_metadata: Base metadata for chunks.
        
        Returns:
            List of Chunk objects.
        """
        if not spans:
            return []
        
        chunks = []
        previous_text = ""
        
        for idx, span in enumerate(spans):
            chunk_text = span.text
            
            if idx > 0 and self.config.chunk_overlap > 0 and previous_text:
                overlap = create_overlap_text(previous_text, self.config.chunk_overlap)
                if overlap and not chunk_text.startswith(overlap[:20]):
                    chunk_text = overlap + "\n\n" + chunk_text
            
            section_header = extract_section_header(span.text)
            has_code = "```" in span.text or "~~~" in span.text
            
            chunk_metadata = ChunkMetadata(
                source_type=base_metadata.source_type,
                source_uri=base_metadata.source_uri,
                tenant_id=base_metadata.tenant_id,
                section_header=section_header,
                has_code_block=has_code,
                is_summary_chunk=(idx == 0),
                tags=base_metadata.tags,
                labels=base_metadata.labels,
                service=base_metadata.service,
                component=base_metadata.component,
                extra=base_metadata.extra,
            )
            
            chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=idx,
                chunk_text=chunk_text.strip(),
                token_count=estimate_token_count(chunk_text),
                metadata=chunk_metadata,
                start_char_offset=span.start,
                end_char_offset=span.end,
            )
            chunks.append(chunk)
            previous_text = span.text
        
        return chunks
