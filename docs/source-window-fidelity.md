# Provider-free source-window fidelity

Provider-free answers show each packed source window verbatim, including markup, paragraph boundaries, conditions and tail text. They no longer select two paragraphs or clip a selected window at700characters. This is a fidelity correction, not a retrieval, semantic-understanding or completeness improvement.

The existing context packer still limits the number and token budget of windows. It can omit sources or trim context upstream; these excerpts do not necessarily show whole documents or complete answers. Full windows can be longer than before.

Updated UI renders source text literally and escapes HTML. Source-embedded citation-looking strings remain literal text; the provider-free path builds actual citations from packed chunks, not those strings. Copy text preserves source text but has different formatting from the UI. Citation textSnippet is a short preview and may not include a tail condition.

Optional citation excerptRange uses UTF-16 start/end offsets into returned packed_chunk text, not original-document positions. Existing coverage enum is unchanged. Additive answerKind=source_excerpts and answerCompleteness=unassessed let updated clients display Source excerpts; older clients may keep their Grounded label. Cache policy8 invalidates previous provider-free formatting, while hosted generation keeps policy6 and its existing behavior.

Validation includes normal-ingestion tail-condition reproduction, literal markup/HTML/source-marker handling, fresh/bypass/cache-hit equivalence, UTF-16 range checks and stale policy invalidation. No claims, retrieval-selector experiment, migrations or dependency additions are part of this change.
