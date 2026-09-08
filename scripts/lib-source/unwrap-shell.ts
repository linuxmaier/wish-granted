/**
 * Neutralise a content-bearing `<form>` wrapper so the downstream text/structure
 * reducers can see the page.
 *
 * ## Why this exists (the #76 finding, stated plainly)
 *
 * #76 was filed as "energyandhousing.wi.gov is a SharePoint/JS-rendered SPA; a
 * plain fetch returns a shell, so we need a headless browser." That premise is
 * wrong, and this module is the evidence.
 *
 * A plain `fetch()` of
 * `https://energyandhousing.wi.gov/Pages/AgencyResources/energy-assistance.aspx`
 * returns ~104 KB of fully server-rendered HTML that already contains the WHEAP
 * "Income Guidelines" table, the 60%-SMI note, and the crisis-assistance prose.
 * Nothing is injected by JavaScript. A headless render of the same URL returns
 * the same bytes.
 *
 * The reason both pipelines saw "zero readable text" is one line in each
 * reducer: `./normalize.ts` and
 * `./html-structure.ts` both strip `<form> ... </form>`
 * wholesale, to drop CSRF / nonce / session `<input>`s. But ASP.NET WebForms --
 * which SharePoint is built on -- wraps the **entire** page body in a single
 * `<form id="aspnetForm" method="post">`. Stripping that form deletes the whole
 * document. The table is right there in the bytes; the reducer throws it away.
 *
 * ## What this does
 *
 * Given raw HTML whose reduced text came back (near-)empty, find a `<form>` whose
 * inner markup makes up most of the document -- the WebForms/SPA "everything"
 * wrapper, not a real search or login form -- and replace just its `<form ...>`
 * and matching `</form>` tags with a neutral `<div>`. The CSRF/session `<input>`s
 * it was hiding are still discarded downstream: both reducers already drop every
 * remaining tag (and with it every `value="..."`) via a blanket `<[^>]+>` strip,
 * and `normalize.ts` additionally scrubs opaque tokens. So the form-strip was a
 * blunt instrument for a job the fine-grained strip already does.
 *
 * This is deliberately conservative and only runs as a fallback (see
 * `recover.ts`): if the page already reduced to usable text, it is never called,
 * so a page where form-stripping correctly removed only junk is untouched.
 *
 * Zero dependencies; a tag scanner with an explicit depth counter, same family
 * as `html-structure.ts`. Not a DOM.
 */

/** A `<form>` is treated as the content wrapper if its inner HTML is at least
 *  this fraction of the whole document... */
const WRAPPER_FRACTION = 0.5;
/** ...or at least this many characters outright (covers a short page whose
 *  wrapper is still the whole body). */
const WRAPPER_MIN_CHARS = 1500;

export interface UnwrapResult {
  /** The HTML to hand downstream. Identical to the input when nothing matched. */
  readonly html: string;
  /** True when a wrapper form was neutralised. */
  readonly unwrapped: boolean;
  /** How many `<form>` open tags were rewritten. */
  readonly count: number;
  /** Human-readable one-liner for the recovery note / trace. */
  readonly note: string;
}

interface FormSpan {
  readonly openStart: number;
  readonly openEnd: number;
  readonly closeStart: number;
  readonly closeEnd: number;
  readonly innerLength: number;
}

/** All top-level `<form>...</form>` spans, matched by depth on the real tag. */
function findFormSpans(html: string): FormSpan[] {
  const token = /<(\/?)form\b[^>]*>/gi;
  const spans: FormSpan[] = [];
  let depth = 0;
  let openStart = -1;
  let openEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    const isClose = m[1] === '/';
    if (!isClose) {
      if (depth === 0) {
        openStart = m.index;
        openEnd = token.lastIndex;
      }
      depth += 1;
    } else {
      if (depth === 1 && openStart >= 0) {
        spans.push({
          openStart,
          openEnd,
          closeStart: m.index,
          closeEnd: token.lastIndex,
          innerLength: m.index - openEnd,
        });
      }
      depth = Math.max(0, depth - 1);
    }
  }
  return spans;
}

/**
 * Neutralise any `<form>` that wraps the bulk of the document. Returns the input
 * unchanged when there is no such form (so it is safe to call unconditionally --
 * though `recover.ts` only calls it on the empty-text signal).
 */
export function unwrapContentShell(html: string): UnwrapResult {
  if (typeof html !== 'string' || html.length === 0) {
    return { html: html ?? '', unwrapped: false, count: 0, note: 'empty input' };
  }

  const spans = findFormSpans(html);
  const total = html.length;
  const wrappers = spans.filter(
    (s) => s.innerLength >= WRAPPER_MIN_CHARS || s.innerLength / total >= WRAPPER_FRACTION,
  );

  if (wrappers.length === 0) {
    return {
      html,
      unwrapped: false,
      count: 0,
      note: spans.length > 0 ? `${spans.length} <form>(s), none wraps the page body` : 'no <form> element',
    };
  }

  // Rewrite from the end so earlier offsets stay valid.
  let out = html;
  for (const s of [...wrappers].sort((a, b) => b.openStart - a.openStart)) {
    out =
      out.slice(0, s.closeStart) + '</div>' + out.slice(s.closeEnd);
    out = out.slice(0, s.openStart) + '<div data-unwrapped-shell="form">' + out.slice(s.openEnd);
  }

  const biggest = Math.max(...wrappers.map((s) => Math.round((s.innerLength / total) * 100)));
  return {
    html: out,
    unwrapped: true,
    count: wrappers.length,
    note: `neutralised ${wrappers.length} wrapper <form>(s) (largest ~${biggest}% of the document -- ASP.NET WebForms/SharePoint shell)`,
  };
}
