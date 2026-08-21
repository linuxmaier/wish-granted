/**
 * Small inline glyphs for the three match states (eligible / maybe / ruled
 * out).
 *
 * Issue #10 flagged that the states were coded three times in the same hue —
 * heading color, card border, badge fill — which is one signal, not three,
 * and does not survive grayscale or red-green color deficiency. Each icon
 * here is a distinct *shape*, not just a distinct color, so the state still
 * reads with color removed entirely:
 *
 *   - eligible: a solid ring with a checkmark
 *   - maybe: a dashed ring with a center dot (pending, not yet decided)
 *   - ruled out: a ring with a single dash (set aside, not an error)
 *
 * They inherit `currentColor`, so each one automatically matches the text
 * color of whatever badge or heading it sits in and carries the exact same
 * contrast ratio already verified for that text. They are purely decorative:
 * the state is always also written out in real text next to them, so they
 * are `aria-hidden` and `focusable="false"` rather than announced by
 * themselves.
 */

interface IconProps {
  readonly className?: string;
}

const BOX = { width: 14, height: 14, viewBox: '0 0 20 20' } as const;

export function EligibleIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className} aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M6 10.3l2.6 2.6L14.2 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MaybeIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className} aria-hidden="true" focusable="false">
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="2.6 2.6"
      />
      <circle cx="10" cy="10" r="1.8" fill="currentColor" />
    </svg>
  );
}

export function RuledOutIcon({ className }: IconProps) {
  return (
    <svg {...BOX} className={className} aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6.5 10h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export type Bucket = 'eligible' | 'maybe' | 'ruledOut';

export function StateIcon({ bucket, className }: { readonly bucket: Bucket } & IconProps) {
  if (bucket === 'eligible') return <EligibleIcon className={className} />;
  if (bucket === 'maybe') return <MaybeIcon className={className} />;
  return <RuledOutIcon className={className} />;
}
