"""Transforms Markdown documents into canonical documents."""

from typing import Any, Dict

from libs.shared.models.document import CanonicalDocument, DocumentVersion


class MarkdownTransformer:
    def markdown_to_document(self, payload: Dict[str, Any]) -> tuple[CanonicalDocument, DocumentVersion]:
        """Transform a Markdown payload into canonical document + version."""
        raise NotImplementedError
