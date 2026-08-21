/**
 * A persistent bottom strip, mobile widths only, that jumps to the results
 * section without scrolling past however many cards are currently showing.
 *
 * It is plain markup with no conditional mounting: the element is always in
 * the DOM and CSS alone decides whether it is visible (`display: none` above
 * the two-column breakpoint) or fixed to the viewport bottom below it. If
 * the stylesheet fails to load for any reason, it degrades to an ordinary
 * link sitting in the document flow rather than disappearing or breaking
 * layout -- there is no JS-driven positioning to fail.
 *
 * The link itself carries a stable accessible name ("View your results") so
 * a screen reader announces something meaningful on focus regardless of the
 * moment. The match count is a separate `aria-live="polite"` span so it is
 * announced on its own, gently, as it changes -- results update on every
 * answer, and a screen reader user should not have that interrupt whatever
 * they are doing (hence "polite", never "assertive").
 */

export function MobileSummary({
  eligibleCount,
  maybeCount,
}: {
  readonly eligibleCount: number;
  readonly maybeCount: number;
}) {
  const summary =
    eligibleCount > 0
      ? `${eligibleCount} likely match${eligibleCount === 1 ? '' : 'es'}`
      : maybeCount > 0
        ? `${maybeCount} might qualify`
        : 'No matches yet';

  return (
    <div className="mobile-summary">
      <a href="#results-title" className="mobile-summary__link" aria-label="View your results">
        <span className="mobile-summary__count" aria-live="polite" aria-atomic="true">
          {summary}
        </span>
        <span className="mobile-summary__cta" aria-hidden="true">
          View results
        </span>
      </a>
    </div>
  );
}
