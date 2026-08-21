/**
 * Shared wording for the one live announcement of match-count changes.
 *
 * Kept in one place, and kept short and factual on purpose -- see the "Live
 * regions" note in docs/design.md. Issue #13 found that `Results.tsx` used
 * to wrap its entire panel (up to 15 program cards) in `aria-live="polite"`,
 * so every answer queued a huge re-announcement. The fix is this one line of
 * text, exposed to assistive tech from a single place: the visually-hidden
 * status region in `Results` (the only one that is actually in the
 * accessibility tree at every viewport width, since `MobileSummary` is
 * `display: none` above 900px and cannot be relied on there). `MobileSummary`
 * reuses the same text for sighted users, without its own live region, so
 * the two never double-announce on mobile.
 */
export function matchSummaryText(eligibleCount: number, maybeCount: number): string {
  if (eligibleCount > 0) {
    return `${eligibleCount} likely match${eligibleCount === 1 ? '' : 'es'}`;
  }
  if (maybeCount > 0) {
    return `${maybeCount} might qualify`;
  }
  return 'No matches yet';
}
