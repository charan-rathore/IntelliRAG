/** Conservative review signals, not semantic entailment or conflict resolution.
 * Every signal remains an exact original line. Document dates/order do not
 * establish authority; no 'latest wins' or automatic approval conversion.
 */
export function contextReview(
  bundle: any,
  validate: (c: any, b: any) => boolean,
) {
  const groups: {
    changes: any[];
    open: any[];
    conditions: any[];
    decisions: any[];
  } = { changes: [], open: [], conditions: [], decisions: [] };
  for (const source of bundle.sources) {
    let offset = 0;
    for (const line of source.text.split("\n")) {
      const start = offset;
      offset += line.length + 1;
      if (!line.trim() || line.startsWith("#")) continue;
      const c = {
        sourceId: source.id,
        title: source.title,
        hash: source.hash,
        start,
        end: start + line.length,
        firstLine: source.text.slice(0, start).split("\n").length,
        lastLine: source.text.slice(0, start).split("\n").length,
        quote: line,
      };
      validate(c, bundle);
      if (
        /\b(changed|moved|revised|superseded|replaces|unchanged)\b/i.test(line)
      )
        groups.changes.push(c);
      if (
        /\b(pending|blocked|unresolved|awaiting|not approved|not yet|open question)\b/i.test(
          line,
        )
      )
        groups.open.push(c);
      if (
        /\b(if|unless|subject to|after|provided that|conditional|only when)\b/i.test(
          line,
        )
      )
        groups.conditions.push(c);
      if (
        /\b(approved|agreed|decided|proposed|rejected|confirmed)\b/i.test(line)
      )
        groups.decisions.push(c);
    }
  }
  const sourceCount = new Set(
    [...groups.open, ...groups.decisions, ...groups.conditions].map(
      (c) => c.sourceId,
    ),
  ).size;
  return {
    groups,
    reviewNeeded: sourceCount > 1,
    notice:
      "Rule-based source review signals, not a resolved timeline. Dates, authority and decision status need review. Contradictions may be missed.",
  };
}
