/**
 * Turn a fetched source page into the "meaningful text" #7 asks to hash.
 *
 * The whole point of this module is stability. docs/eligibility-extraction.md
 * Section 5 measured three byte-level change signals and threw all three out:
 * a government page's raw bytes churn constantly (render timestamps, CSRF
 * tokens, rotating banners, analytics params, session ids) while its actual
 * published figures change once a year. A hash over raw HTML would reproduce
 * exactly that failure -- every run would flag every record.
 *
 * So this strips a page down to the part a human would read for eligibility
 * facts, and nothing else:
 *
 *   1. Drop elements that never carry user-facing copy (script, style, svg,
 *      head, forms -- forms are where CSRF/nonce/session inputs live).
 *   2. Narrow to the page's main-content landmark when it marks one. Government
 *      CMS templates (Wisconsin DHS/DPI, City of Madison, federal sites) put the
 *      article body in <main> and everything volatile -- nav, the "alert"
 *      ribbon, the "page last reviewed" line, breadcrumbs, social buttons --
 *      outside it. This one step removes most incidental churn. The landmark is
 *      looked for as a chain -- <main>, then [role="main"], then a
 *      #content / #main container -- before the weak <body> fallback, because a
 *      site-wide nav change would otherwise flag every record on that domain at
 *      once (issue #49). `normalizeToResult` reports which link of the chain was
 *      used so the caller can surface a <body>-fallback record as a weaker
 *      signal rather than a silent one.
 *   3. Strip site chrome elements (nav/header/footer/aside) as a fallback for
 *      pages with no main-content landmark.
 *   4. Drop every tag and attribute, decode entities, fold typographic Unicode
 *      to ASCII, and scrub the volatile text patterns that survive inside the
 *      content region (dates, timestamps, copyright years, "N views", long
 *      opaque tokens).
 *   5. Collapse whitespace.
 *
 * It is deliberately aggressive: a false "unchanged" (we miss a real edit for
 * one weekly cycle, then catch it, or the time-based stalePrograms() check
 * catches it) is a far cheaper error here than a false "changed" that trains
 * the reviewer to ignore the job. See lib/__tests__/normalize.test.ts for the
 * run-to-run stability contract this has to hold.
 */

const STRIP_WHOLE = ['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'form'];
const STRIP_CHROME = ['nav', 'header', 'footer', 'aside'];

/** Remove `<tag ...>...</tag>` (and self-closing / unclosed `<tag>`) for each named tag. */
function stripElements(html: string, tags: readonly string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' ');
  }
  return out;
}

/**
 * Which link of the content-region chain a page resolved to. `body` and
 * `document` are the weak fallbacks -- they drag nav/header/footer into the
 * hashed text, so a caller should name those records in its report.
 */
export type ContentRegion = 'main' | 'role-main' | 'id-landmark' | 'body' | 'document' | 'non-html';

/**
 * True for the fallbacks that include site chrome the strip step can't fully
 * remove. `non-html` is excluded: a non-HTML source (JSON/text feed) has no nav
 * to worry about, it just isn't a page.
 */
export function isWeakRegion(region: ContentRegion): boolean {
  return region === 'body' || region === 'document';
}

/**
 * Return the inner content of the page's main-content landmark, matched by tag
 * depth so a nested block inside it can't truncate the slice. Tries, in order:
 * `<main>`, `[role="main"]`, a `#content` / `#main` container, then the weak
 * `<body>` fallback, then the whole string.
 */
export function isolateContentRegion(html: string): string {
  return isolateContentRegionWithSource(html).html;
}

export function isolateContentRegionWithSource(html: string): { html: string; region: ContentRegion } {
  const main = sliceElement(html, 'main');
  if (main !== null && main.trim().length > 200) return { html: main, region: 'main' };

  const roleMain = sliceByRoleMain(html);
  if (roleMain !== null && roleMain.trim().length > 200) return { html: roleMain, region: 'role-main' };

  const idLandmark = sliceByContentId(html);
  if (idLandmark !== null && idLandmark.trim().length > 200) return { html: idLandmark, region: 'id-landmark' };

  const body = sliceElement(html, 'body');
  if (body !== null) return { html: body, region: 'body' };

  return { html, region: 'document' };
}

/** Depth-aware inner-HTML extraction for a single named element. */
function sliceElement(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const first = open.exec(html);
  if (!first) return null;
  const contentStart = first.index + first[0].length;

  const token = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  token.lastIndex = contentStart;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = token.exec(html)) !== null) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(contentStart, m.index);
  }
  return html.slice(contentStart);
}

/** `<div role="main"> ... </div>` and friends, matched by depth on the real tag name. */
function sliceByRoleMain(html: string): string | null {
  const opener = /<([a-z0-9]+)\b[^>]*\brole=["']?main["']?[^>]*>/i.exec(html);
  if (!opener) return null;
  const tag = opener[1];
  if (!tag) return null;
  return sliceElement(html.slice(opener.index), tag);
}

/**
 * `<div id="content">` / `id="main"` / `id="main-content"` -- the pre-ARIA
 * convention many older CMS templates and page builders still use to mark the
 * article column (issue #49's chain: after <main> and [role="main"], before the
 * weak <body> fallback). Matched by depth on the real tag name, like
 * `role="main"`. The keyword must be the whole id value (the `(?=["'\s>])`
 * guard), so `id="main-header"` / `id="content-sidebar"` do not match.
 */
function sliceByContentId(html: string): string | null {
  const opener =
    /<([a-z0-9]+)\b[^>]*\bid=["']?(?:content|main|main-content|maincontent)(?=["'\s>])[^>]*>/i.exec(html);
  if (!opener) return null;
  const tag = opener[1];
  if (!tag) return null;
  return sliceElement(html.slice(opener.index), tag);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  copy: '(c)',
  reg: '(r)',
  trade: '(tm)',
  hellip: '...',
  mdash: '-',
  ndash: '-',
  minus: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  deg: ' ',
  times: 'x',
};

/**
 * Fold typographic Unicode to ASCII so a numeric `&#x2014;`, a named `&mdash;`,
 * and a raw em-dash byte all reduce to the same character.
 */
function foldPunctuation(text: string): string {
  // Escapes, not literal glyphs, so this stays legible in a plain editor.
  return text
    .replace(/[\u2010-\u2015\u2212]/g, '-') // hyphens, en/em dashes, minus sign
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2000-\u200a\u2007\u202f\u205f\u3000]/g, ' ') // no-break / fixed-width spaces
    .replace(/[\u200b-\u200d\ufeff]/g, ''); // zero-width spaces, joiners, BOM
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isNaN(code)) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    }
    return ENTITIES[body.toLowerCase()] ?? ' ';
  });
}

/**
 * Text-level scrub of things that legitimately change on an unchanged page.
 * Applied after entities are decoded so `&copy; 2026` is already `(c) 2026`.
 */
function scrubVolatile(text: string): string {
  return (
    text
      // ISO date-times (render/cache stamps embedded in JSON-LD, data blocks).
      .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?/gi, ' ')
      // "September 5, 2026" / "Sep. 5, 2026"
      .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{1,2},?\s+\d{4}\b/gi, ' ')
      // "5 September 2026"
      .replace(/\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z.]*\s+\d{4}\b/gi, ' ')
      // Numeric dates 9/5/2026, 09-05-26, 2026/09/05
      .replace(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g, ' ')
      // Clock times "3:42 PM", "15:42"
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/gi, ' ')
      // "Last updated / modified / reviewed / edited ..." to end of line
      .replace(
        /\b(page\s+)?(last\s+(updated|modified|reviewed|edited)|date\s+last\s+(reviewed|updated))\b.*/gi,
        ' ',
      )
      // Copyright year / year range
      .replace(/\(c\)\s*\d{4}(\s*-\s*\d{4})?/gi, ' ')
      .replace(/\bcopyright\s+\d{4}(\s*-\s*\d{4})?/gi, ' ')
      // "1,234 views" / "viewed 1,234 times"
      .replace(/\b\d[\d,]*\s+(views?|people\s+viewed)\b/gi, ' ')
      .replace(/\bviewed\s+\d[\d,]*\s+times?\b/gi, ' ')
      // Opaque tokens: a single 24+ char run of mixed letters/digits (CSRF,
      // nonce, session id, cache-buster) that slipped through as text.
      .replace(/\b(?=[a-z0-9_-]*[0-9])(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{24,}\b/gi, ' ')
  );
}

/** Best-effort "is this HTML" sniff -- some sources may serve plain text or JSON. */
export function looksLikeHtml(raw: string): boolean {
  const head = raw.slice(0, 2000).toLowerCase();
  return head.includes('<!doctype html') || head.includes('<html') || /<(body|div|main|p)\b/.test(head);
}

export interface NormalizeResult {
  /** The meaningful text to hash. */
  readonly text: string;
  /** Which link of the content-region chain produced it. */
  readonly region: ContentRegion;
}

/** Back-compatible: the normalized text only. */
export function normalize(raw: string): string {
  return normalizeToResult(raw).text;
}

/** Normalized text plus which content-region fallback was used to isolate it. */
export function normalizeToResult(raw: string): NormalizeResult {
  const stripped = foldPunctuation(raw).replace(/^﻿/, '');

  if (!looksLikeHtml(stripped)) {
    return { text: collapse(scrubVolatile(stripped)), region: 'non-html' };
  }

  let s = stripped.replace(/<!--[\s\S]*?-->/g, ' ');
  s = stripElements(s, STRIP_WHOLE);
  const isolated = isolateContentRegionWithSource(s);
  s = isolated.html;
  s = stripElements(s, STRIP_CHROME);

  // Block-level tags become newlines so adjacent lines don't fuse; everything
  // else becomes a space. Attributes go with the tag.
  s = s.replace(
    /<\/?(p|div|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|section|article|br|hr|dd|dt|dl|blockquote|figure|figcaption|main)\b[^>]*>/gi,
    '\n',
  );
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = foldPunctuation(s);
  s = scrubVolatile(s);
  return { text: collapse(s), region: isolated.region };
}

function collapse(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}
