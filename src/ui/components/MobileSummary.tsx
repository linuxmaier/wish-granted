import { matchSummaryText } from './matchSummary';

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
 * moment. The match count is plain, visible text with no live region of its
 * own (issue #13): because this whole element is `display: none` above
 * 900px, an `aria-live` region here would be invisible to assistive tech on
 * desktop and can't be the one source of truth for "results changed."
 * `Results.tsx` carries the single shared status announcement instead, using
 * the same wording, so mobile does not get the count announced twice.
 */

export function MobileSummary({
  eligibleCount,
  maybeCount,
}: {
  readonly eligibleCount: number;
  readonly maybeCount: number;
}) {
  return (
    <div className="mobile-summary">
      <a href="#results-title" className="mobile-summary__link" aria-label="View your results">
        <span className="mobile-summary__count">{matchSummaryText(eligibleCount, maybeCount)}</span>
        <span className="mobile-summary__cta" aria-hidden="true">
          View results
        </span>
      </a>
    </div>
  );
}
