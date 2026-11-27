/** A source number is local to one answer, not to the conversation page. */
export function citationAnchorId(sourceIndex: number | string, scope?: string): string {
  return scope ? `cite-${encodeURIComponent(scope)}-${sourceIndex}` : `cite-${sourceIndex}`;
}

/** Encode the full ID for a fragment; a scoped ID may itself contain percent signs. */
export function citationAnchorHref(sourceIndex: number | string, scope?: string): string {
  return `#${encodeURIComponent(citationAnchorId(sourceIndex, scope))}`;
}
