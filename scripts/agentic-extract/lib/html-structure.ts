/**
 * Structure-preserving HTML (and light XML) tokenisation, zero dependencies.
 *
 * The epic's contributor brief points at `scripts/tier3-extract/html-structure.mjs`
 * (PR #69) to reuse here. That file is NOT in the tree at the base commit this
 * branch was cut from (451a438) -- so this is a fresh, minimal implementation of
 * the same idea rather than a third copy. If #69 lands, collapse the two.
 *
 * Why this exists at all: PR #63/#64 showed deterministically that
 * prose-flattening a source page -- dropping table headers, dropping the
 * heading a paragraph sits under -- was *causing* the BadgerCare failure class
 * (a flat "306% FPL" with no "Pregnant people and children" column header
 * attached reads as a blanket ceiling). scripts/check-sources/lib/normalize.ts
 * flattens on purpose (it wants a stable hash); this is the opposite tool.
 *
 * What it preserves:
 *   - headings (h1-h6) with their level, and every block carries the heading
 *     path it sits under, so "Level 3" three sections down is never severed
 *     from "Coverage levels are cost-sharing tiers" at the top.
 *   - tables: every body row is rendered with its column headers attached
 *     ("Adult monthly income limit (100% FPL) = $1,255 | ..."), which is the
 *     single transformation the BadgerCare wizard-of-oz case turned on.
 *   - list items, paragraphs, and definition lists as discrete blocks.
 *
 * It is a tag tokeniser with an explicit tag stack, not a full HTML5 parser.
 * It handles the tag soup government CMS pages actually emit (unclosed <p>,
 * <td> without </td>, uppercase tags, attributes with '>' inside quotes). It
 * does not build a DOM and does not try to.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Dropped whole -- never carry eligibility copy, and <form> hides CSRF noise. */
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'form',
  'nav', 'header', 'footer', 'aside', 'button',
]);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK_TAGS = new Set(['p', 'li', 'dt', 'dd', 'blockquote', 'figcaption', 'pre', 'caption', 'summary']);

export type StructureNode =
  | { readonly type: 'heading'; readonly level: number; readonly text: string; readonly path: readonly string[] }
  | { readonly type: 'paragraph'; readonly text: string; readonly path: readonly string[] }
  | { readonly type: 'list-item'; readonly text: string; readonly path: readonly string[] }
  | {
      readonly type: 'table';
      readonly path: readonly string[];
      readonly caption?: string;
      readonly columnHeaders: readonly string[];
      /** One entry per body row; each entry pairs a column header with its cell. */
      readonly rows: readonly (readonly { readonly header: string; readonly cell: string }[])[];
    };

interface Token {
  readonly kind: 'open' | 'close' | 'text';
  readonly name: string;
  readonly text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function collapse(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Split markup into a flat token stream. Comments and doctype are discarded. */
export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      const text = html.slice(last, m.index);
      if (text.trim() !== '') tokens.push({ kind: 'text', name: '', text });
    }
    last = re.lastIndex;
    const tag = m[0];
    if (tag.startsWith('<!--') || tag.startsWith('<!') || tag.startsWith('<?') || tag.startsWith('<![')) continue;
    const close = tag.startsWith('</');
    const nameMatch = /^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tag);
    if (!nameMatch) continue;
    const name = nameMatch[1]!.toLowerCase();
    tokens.push({ kind: close ? 'close' : 'open', name, text: tag });
  }
  if (last < html.length) {
    const text = html.slice(last);
    if (text.trim() !== '') tokens.push({ kind: 'text', name: '', text });
  }
  return tokens;
}

interface TableAcc {
  caption: string;
  headerRow: string[];
  bodyRows: string[][];
  current: string[] | null;
  currentIsHeader: boolean;
  sawExplicitHeaderRow: boolean;
}

function newTable(): TableAcc {
  return { caption: '', headerRow: [], bodyRows: [], current: null, currentIsHeader: false, sawExplicitHeaderRow: false };
}

/**
 * Walk the token stream, maintaining a heading path and (when inside <table>) a
 * row/cell accumulator. Returns a linear list of structure nodes.
 */
export function parseStructure(html: string): StructureNode[] {
  const tokens = tokenize(html);
  const nodes: StructureNode[] = [];
  const dropStack: string[] = [];
  const headingPath: string[] = [];
  const headingLevels: number[] = [];

  let buffer = '';
  let bufferKind: 'paragraph' | 'list-item' | 'heading' | null = null;
  let headingLevel = 0;
  const tableStack: TableAcc[] = [];

  const path = (): string[] => [...headingPath];

  const flushBuffer = () => {
    const text = collapse(buffer);
    buffer = '';
    const kind = bufferKind;
    bufferKind = null;
    if (!text || kind === null) return;
    if (kind === 'heading') {
      // Pop deeper/sibling headings, then push this one.
      while (headingLevels.length > 0 && headingLevels[headingLevels.length - 1]! >= headingLevel) {
        headingLevels.pop();
        headingPath.pop();
      }
      headingLevels.push(headingLevel);
      headingPath.push(text);
      nodes.push({ type: 'heading', level: headingLevel, text, path: headingPath.slice(0, -1) });
      return;
    }
    if (tableStack.length > 0) {
      // Text inside a table cell is handled by the cell logic, not here.
      return;
    }
    nodes.push({ type: kind, text, path: path() });
  };

  const flushTable = () => {
    const t = tableStack.pop();
    if (!t) return;
    // If no <th> row was seen, promote the first row to headers so every body
    // row still gets *something* attached rather than a bare value.
    let headers = t.headerRow;
    let body = t.bodyRows;
    if (headers.length === 0 && body.length > 0) {
      headers = body[0]!;
      body = body.slice(1);
    }
    const width = Math.max(headers.length, ...body.map((r) => r.length), 0);
    const cols: string[] = [];
    for (let i = 0; i < width; i += 1) cols.push(headers[i] ?? `column ${i + 1}`);
    const rows = body.map((r) => r.map((cell, i) => ({ header: cols[i] ?? `column ${i + 1}`, cell })));
    nodes.push({
      type: 'table',
      path: path(),
      ...(t.caption ? { caption: t.caption } : {}),
      columnHeaders: cols,
      rows,
    });
  };

  for (const tok of tokens) {
    if (dropStack.length > 0) {
      if (tok.kind === 'open' && tok.name === dropStack[dropStack.length - 1] && !VOID_TAGS.has(tok.name)) {
        dropStack.push(tok.name);
      } else if (tok.kind === 'close' && tok.name === dropStack[dropStack.length - 1]) {
        dropStack.pop();
      }
      continue;
    }

    if (tok.kind === 'open' && DROP_TAGS.has(tok.name)) {
      if (!VOID_TAGS.has(tok.name)) dropStack.push(tok.name);
      continue;
    }

    if (tok.kind === 'text') {
      const t = tableStack[tableStack.length - 1];
      if (t && t.current) {
        t.current[t.current.length - 1] = (t.current[t.current.length - 1] ?? '') + tok.text;
      } else if (bufferKind !== null) {
        buffer += tok.text;
      } else if (tableStack.length === 0) {
        // Loose text between blocks -- treat as its own paragraph.
        buffer += tok.text;
        bufferKind = 'paragraph';
      }
      continue;
    }

    const name = tok.name;

    if (tok.kind === 'open') {
      if (HEADING_TAGS.has(name)) {
        flushBuffer();
        bufferKind = 'heading';
        headingLevel = Number(name[1]);
        continue;
      }
      if (name === 'table') {
        flushBuffer();
        tableStack.push(newTable());
        continue;
      }
      if (tableStack.length > 0) {
        const t = tableStack[tableStack.length - 1]!;
        if (name === 'caption') {
          bufferKind = 'paragraph';
          buffer = '';
          continue;
        }
        if (name === 'tr') {
          t.current = [];
          t.currentIsHeader = false;
          continue;
        }
        if (name === 'th' || name === 'td') {
          if (!t.current) t.current = [];
          t.current.push('');
          if (name === 'th') t.currentIsHeader = true;
          continue;
        }
        continue;
      }
      if (BLOCK_TAGS.has(name)) {
        flushBuffer();
        bufferKind = name === 'li' ? 'list-item' : 'paragraph';
        continue;
      }
      if (name === 'br') {
        buffer += ' ';
        continue;
      }
      // Inline / unknown container: keep accumulating into the current buffer.
      continue;
    }

    // close tag
    if (HEADING_TAGS.has(name)) {
      flushBuffer();
      continue;
    }
    if (name === 'table') {
      flushTable();
      continue;
    }
    if (tableStack.length > 0) {
      const t = tableStack[tableStack.length - 1]!;
      if (name === 'caption') {
        t.caption = collapse(buffer);
        buffer = '';
        bufferKind = null;
        continue;
      }
      if (name === 'tr') {
        if (t.current) {
          const row = t.current.map(collapse);
          if (t.currentIsHeader && !t.sawExplicitHeaderRow) {
            t.headerRow = row;
            t.sawExplicitHeaderRow = true;
          } else {
            t.bodyRows.push(row);
          }
        }
        t.current = null;
        continue;
      }
      if (name === 'th' || name === 'td') {
        // cell text already appended live; nothing to do
        continue;
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      flushBuffer();
      continue;
    }
  }

  flushBuffer();
  while (tableStack.length > 0) flushTable();
  return nodes;
}

/** Render a structure node list back to text a model can read, structure intact. */
export function renderStructured(html: string): string {
  return renderNodes(parseStructure(html));
}

/**
 * Render an already-parsed structure node list. Split out from `renderStructured`
 * so the PDF path (lib/pdf.ts) can produce the exact same block/table format the
 * model and the provenance matcher are built around, from `StructureNode`s it
 * assembles from glyph coordinates rather than from HTML tags.
 */
export function renderNodes(nodes: readonly StructureNode[]): string {
  const out: string[] = [];
  for (const node of nodes) {
    const prefix = node.path.length > 0 ? `[${node.path.join(' > ')}] ` : '';
    if (node.type === 'heading') {
      out.push(`${'#'.repeat(Math.min(6, node.level))} ${node.text}`);
    } else if (node.type === 'paragraph') {
      out.push(`${prefix}${node.text}`);
    } else if (node.type === 'list-item') {
      out.push(`${prefix}- ${node.text}`);
    } else if (node.type === 'table') {
      const loc = node.path.length > 0 ? ` (under: ${node.path.join(' > ')})` : '';
      out.push(`TABLE${node.caption ? ` "${node.caption}"` : ''}${loc}`);
      out.push(`  columns: ${node.columnHeaders.join(' | ')}`);
      for (const row of node.rows) {
        out.push(`  row: ${row.map((c) => `${c.header} = ${c.cell}`).join(' | ')}`);
      }
    }
  }
  return out.join('\n');
}

/**
 * Plain readable text with NO structure (headings/tables flattened to prose).
 * Only for provenance span matching -- a model quote should verify against a
 * page whether or not our renderer kept the same whitespace. Never fed to the
 * model as the page content.
 */
export function flattenText(html: string): string {
  const withoutDrops = [...DROP_TAGS].reduce(
    (acc, tag) =>
      acc
        .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ')
        .replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), ' '),
    html,
  );
  return collapse(withoutDrops.replace(/<[^>]+>/g, ' '));
}
