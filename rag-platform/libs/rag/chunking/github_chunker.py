"""GitHub issue and comment chunker.

Specialized chunker for GitHub issues that:
- Always keeps title with first chunk (the "problem statement")
- Handles issue body with structure awareness
- Merges small consecutive comments by same author
- Preserves code blocks and error messages

Best for: GitHub issues, bug reports, feature requests, and their comments.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
from uuid import UUID

from libs.shared.models.chunk import Chunk, ChunkMetadata, ChunkingResult

from .base import BaseChunker, ChunkerConfig
from .structure_aware import StructureAwareChunker
from .utils import (
    TextSpan,
    chars_for_tokens,
    create_overlap_text,
    estimate_token_count,
    merge_small_spans,
    normalize_whitespace,
)


@dataclass
class GitHubComment:
    """Represents a GitHub issue comment for chunking."""
    author: str
    body: str
    comment_id: str
    created_at: Optional[str] = None


class GitHubIssueChunker(BaseChunker):
    """Chunker specialized for GitHub issues.
    
    Chunking strategy for issues:
    1. First chunk always includes title + first paragraph (problem statement)
    2. Remaining body is chunked using structure-aware splitting
    3. Code blocks and error traces are kept atomic
    
    For comments:
    - Each comment is typically one chunk
    - Small consecutive comments by same author are merged
    - Very long comments are split at paragraph boundaries
    """
    
    def __init__(self, config: Optional[ChunkerConfig] = None) -> None:
        super().__init__(config)
        self._structure_chunker = StructureAwareChunker(config)
    
    @property
    def strategy_name(self) -> str:
        return "github_issue"
    
    def chunk(
        self,
        text: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Chunk a GitHub issue body.
        
        Args:
            text: Issue body text.
            document_id: Document UUID.
            version_id: Version UUID.
            base_metadata: Metadata for chunks.
        
        Returns:
            ChunkingResult with issue chunks.
        """
        self._validate_input(text)
        return self._structure_chunker.chunk(text, document_id, version_id, base_metadata)
    
    def chunk_issue_with_title(
        self,
        title: str,
        body: str,
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
    ) -> ChunkingResult:
        """Chunk a GitHub issue with title, ensuring title stays with problem statement.
        
        This is the preferred method for GitHub issues as it ensures the
        title (which often contains the key error/topic) is never separated
        from the problem description.
        
        Args:
            title: Issue title.
            body: Issue body.
            document_id: Document UUID.
            version_id: Version UUID.
            base_metadata: Metadata for chunks.
        
        Returns:
            ChunkingResult with title-aware chunks.
        """
        if not title and not body:
            raise ValueError("Both title and body cannot be empty")
        
        if not body or not body.strip():
            summary_text = f"# {title}" if title else ""
            if not summary_text.strip():
                raise ValueError("Cannot create chunk from empty content")
            
            chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=0,
                chunk_text=summary_text.strip(),
                token_count=estimate_token_count(summary_text),
                metadata=self._create_summary_metadata(base_metadata),
                start_char_offset=0,
                end_char_offset=len(summary_text),
            )
            return self._create_result(document_id, version_id, [chunk])
        
        normalized_body = normalize_whitespace(body)
        
        first_para, remaining = self._split_first_paragraph(normalized_body)
        
        summary_text = f"# {title}\n\n{first_para}" if title else first_para
        target_chars = chars_for_tokens(self.config.chunk_size)
        
        chunks = []
        
        if len(summary_text) <= target_chars:
            summary_chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=0,
                chunk_text=summary_text.strip(),
                token_count=estimate_token_count(summary_text),
                metadata=self._create_summary_metadata(base_metadata),
                start_char_offset=0,
                end_char_offset=len(summary_text),
            )
            chunks.append(summary_chunk)
        else:
            title_chunk = Chunk.create(
                document_id=document_id,
                version_id=version_id,
                chunk_index=0,
                chunk_text=f"# {title}".strip() if title else first_para[:target_chars],
                token_count=estimate_token_count(f"# {title}" if title else first_para[:target_chars]),
                metadata=self._create_summary_metadata(base_metadata),
                start_char_offset=0,
                end_char_offset=len(title) if title else target_chars,
            )
            chunks.append(title_chunk)
            remaining = first_para + "\n\n" + remaining if remaining else first_para
        
        if remaining and remaining.strip():
            remaining_result = self._structure_chunker.chunk(
                text=remaining,
                document_id=document_id,
                version_id=version_id,
                base_metadata=base_metadata,
            )
            
            for orig_chunk in remaining_result.chunks:
                reindexed = Chunk.create(
                    document_id=document_id,
                    version_id=version_id,
                    chunk_index=len(chunks),
                    chunk_text=orig_chunk.chunk_text,
                    token_count=orig_chunk.token_count,
                    metadata=orig_chunk.metadata,
                    start_char_offset=orig_chunk.start_char_offset,
                    end_char_offset=orig_chunk.end_char_offset,
                )
                chunks.append(reindexed)
        
        return self._create_result(document_id, version_id, chunks)
    
    def chunk_comments(
        self,
        comments: List[GitHubComment],
        document_id: UUID,
        version_id: UUID,
        base_metadata: ChunkMetadata,
        merge_same_author: bool = True,
        merge_window_minutes: int = 30,
    ) -> ChunkingResult:
        """Chunk a list of GitHub comments.
        
        Args:
            comments: List of GitHubComment objects.
            document_id: Parent document UUID.
            version_id: Version UUID.
            base_metadata: Base metadata for chunks.
            merge_same_author: If True, merge consecutive comments by same author.
            merge_window_minutes: Time window for merging (not yet implemented).
        
        Returns:
            ChunkingResult with comment chunks.
        """
        if not comments:
            return self._create_result(document_id, version_id, [])
        
        target_chars = chars_for_tokens(self.config.chunk_size)
        max_chars = chars_for_tokens(self.config.max_chunk_size)
        
        if merge_same_author:
            comments = self._merge_consecutive_comments(comments, max_chars)
        
        chunks = []
        
        for comment in comments:
            comment_text = self._format_comment(comment)
            
            if len(comment_text) <= target_chars:
                chunk = Chunk.create(
                    document_id=document_id,
                    version_id=version_id,
                    chunk_index=len(chunks),
                    chunk_text=comment_text.strip(),
                    token_count=estimate_token_count(comment_text),
                    metadata=self._create_comment_metadata(base_metadata, comment),
                    start_char_offset=None,
                    end_char_offset=None,
                )
                chunks.append(chunk)
            else:
                sub_result = self._structure_chunker.chunk(
                    text=comment.body,
                    document_id=document_id,
                    version_id=version_id,
                    base_metadata=base_metadata,
                )
                
                for sub_chunk in sub_result.chunks:
                    header = f"**Comment by @{comment.author}:**\n\n"
                    chunk_text = header + sub_chunk.chunk_text
                    
                    chunk = Chunk.create(
                        document_id=document_id,
                        version_id=version_id,
                        chunk_index=len(chunks),
                        chunk_text=chunk_text.strip(),
                        token_count=estimate_token_count(chunk_text),
                        metadata=self._create_comment_metadata(base_metadata, comment),
                    )
                    chunks.append(chunk)
        
        return self._create_result(document_id, version_id, chunks)
    
    def _split_first_paragraph(self, text: str) -> tuple[str, str]:
        """Split text into first paragraph and remainder.
        
        Args:
            text: Full text.
        
        Returns:
            Tuple of (first_paragraph, remaining_text).
        """
        parts = text.split("\n\n", 1)
        first = parts[0]
        remaining = parts[1] if len(parts) > 1 else ""
        return first, remaining
    
    def _merge_consecutive_comments(
        self,
        comments: List[GitHubComment],
        max_chars: int,
    ) -> List[GitHubComment]:
        """Merge consecutive comments by the same author.
        
        Args:
            comments: List of comments to potentially merge.
            max_chars: Maximum size of merged comment.
        
        Returns:
            List with consecutive same-author comments merged.
        """
        if not comments:
            return []
        
        result = []
        current = comments[0]
        
        for next_comment in comments[1:]:
            if (current.author == next_comment.author and
                len(current.body) + len(next_comment.body) + 10 <= max_chars):
                current = GitHubComment(
                    author=current.author,
                    body=current.body + "\n\n---\n\n" + next_comment.body,
                    comment_id=current.comment_id,
                    created_at=current.created_at,
                )
            else:
                result.append(current)
                current = next_comment
        
        result.append(current)
        return result
    
    def _format_comment(self, comment: GitHubComment) -> str:
        """Format a comment with author attribution.
        
        Args:
            comment: Comment to format.
        
        Returns:
            Formatted comment text.
        """
        return f"**Comment by @{comment.author}:**\n\n{comment.body}"
    
    def _create_summary_metadata(self, base: ChunkMetadata) -> ChunkMetadata:
        """Create metadata for summary chunk."""
        return ChunkMetadata(
            source_type=base.source_type,
            source_uri=base.source_uri,
            tenant_id=base.tenant_id,
            section_header=None,
            has_code_block="```" in (base.extra.get("body", "") or ""),
            is_summary_chunk=True,
            tags=base.tags,
            labels=base.labels,
            service=base.service,
            component=base.component,
            extra=base.extra,
        )
    
    def _create_comment_metadata(
        self,
        base: ChunkMetadata,
        comment: GitHubComment,
    ) -> ChunkMetadata:
        """Create metadata for a comment chunk."""
        extra = dict(base.extra)
        extra["comment_author"] = comment.author
        extra["comment_id"] = comment.comment_id
        
        return ChunkMetadata(
            source_type=base.source_type,
            source_uri=base.source_uri,
            tenant_id=base.tenant_id,
            section_header=f"Comment by @{comment.author}",
            has_code_block="```" in comment.body,
            is_summary_chunk=False,
            tags=base.tags,
            labels=base.labels,
            service=base.service,
            component=base.component,
            extra=extra,
        )
