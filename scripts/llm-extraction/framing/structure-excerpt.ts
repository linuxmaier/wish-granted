/**
 * Hypothesis 3 (issue #62): structure-preserving excerpts.
 *
 * The `badgercare-plus-population-columns` dangerous over-claim, and the
 * `wi-medicaid-fpl-chart-mapp-column` case here, share one property: the scope
 * of a number lives entirely in a table column header. The current ingestion
 * path flattens HTML to running prose before the model sees it, which destroys
 * the row/column alignment that carries the scope. This module renders a fetched
 * HTML fragment two ways so a run can A/B them:
 *
 *   renderProse(html)       -- strip every tag, collapse whitespace. This is
 *                              what the current pipeline feeds the model.
 *   renderStructured(html)  -- keep tables as GitHub-flavoured Markdown (header
 *                              row + separator + body rows), <caption> as a line
 *                              above, headings as `#`, list items as `- `.
 *
 * Zero dependencies: a regex tokenizer is enough for the well-formed markup
 * these government sources actually use (same call `scripts/extract-income-tables.mjs`
 * made). Not a general-purpose HTML-to-Markdown converter -- it handles the
 * shapes in `fixtures/` and errs toward dropping unknown structure rather than
 * emitting broken tables.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&rsquo;': "'",
  '&lsquo;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&ndash;': '-',
  '&mdash;': '-',
};

export function decodeEntities(s: string): string {
  let out = s.replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
  for (const [ent, ch] of Object.entries(ENTITIES)) out = out.split(ent).join(ch);
  return out;
}

/** Inner text of an HTML fragment: tags gone, entities decoded, whitespace collapsed. */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function renderProse(html: string): string {
  // Block boundaries first, so "…$1,419.99Program limits…" doesn't fuse.
  const spaced = html
    .replace(/<\/(p|div|h[1-6]|li|tr|caption|table|thead|tbody)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/t[dh]>/gi, ' ');
  return stripTags(spaced);
}

/** Split a `<tr>…</tr>` into decoded cell strings. Multiple block children join with " / ". */
function parseRow(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const inner = m[2] ?? '';
    const blocks = inner.match(/<(p|div|li)\b[^>]*>([\s\S]*?)<\/\1>/gi);
    const text = blocks
      ? blocks.map((b) => stripTags(b)).filter(Boolean).join(' / ')
      : stripTags(inner);
    cells.push(text);
  }
  return cells;
}

function renderTable(tableHtml: string): string {
  const lines: string[] = [];
  const caption = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(tableHtml);
  if (caption?.[1]) lines.push(stripTags(caption[1]));

  const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  if (rows.length === 0) return lines.join('\n');

  const parsed = rows.map(parseRow).filter((r) => r.length > 0);
  if (parsed.length === 0) return lines.join('\n');

  const width = Math.max(...parsed.map((r) => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array(width - r.length).fill('')];

  const firstIsHeader = /<th\b/i.test(rows[0] ?? '');
  const header = firstIsHeader ? pad(parsed[0] ?? []) : pad(Array.from({ length: width }, (_, i) => `col${i + 1}`));
  const bodyStart = firstIsHeader ? 1 : 0;

  lines.push(`| ${header.join(' | ')} |`);
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  for (let i = bodyStart; i < parsed.length; i += 1) {
    lines.push(`| ${pad(parsed[i] ?? []).join(' | ')} |`);
  }
  return lines.join('\n');
}

export function renderStructured(html: string): string {
  const parts: string[] = [];
  // Walk top-level-ish blocks in document order: tables, headings, list items, paragraphs.
  const blockRe =
    /<table\b[^>]*>[\s\S]*?<\/table>|<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<li\b[^>]*>([\s\S]*?)<\/li>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  let consumed = false;
  while ((m = blockRe.exec(html)) !== null) {
    consumed = true;
    // Loose text between recognised blocks (but not inside a table we already took).
    const between = stripTags(html.slice(lastIndex, m.index));
    if (between) parts.push(between);
    lastIndex = blockRe.lastIndex;

    const chunk = m[0];
    if (/^<table/i.test(chunk)) {
      parts.push(renderTable(chunk));
    } else if (m[1]) {
      parts.push(`${'#'.repeat(Number(m[1]))} ${stripTags(m[3] ?? '')}`);
    } else if (m[4] !== undefined) {
      const li = stripTags(m[4]);
      if (li) parts.push(`- ${li}`);
    } else if (m[5] !== undefined) {
      const p = stripTags(m[5]);
      if (p) parts.push(p);
    }
  }
  if (!consumed) return renderProse(html);
  const tail = stripTags(html.slice(lastIndex));
  if (tail) parts.push(tail);
  return parts.filter(Boolean).join('\n\n');
}

export type ExcerptMode = 'prose' | 'structured';

export function renderExcerpt(html: string, mode: ExcerptMode): string {
  return mode === 'structured' ? renderStructured(html) : renderProse(html);
}
