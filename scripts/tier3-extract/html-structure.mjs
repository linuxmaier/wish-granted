/**
 * Structure-preserving HTML reader for the Tier-3 deterministic-parse spike
 * (issue #62, experiment 3).
 *
 * The existing Tier-1 extractor (scripts/extract-income-tables.mjs) throws away
 * everything except <table> grids. The whole hypothesis of this experiment is
 * that the Tier-3 LLM failures are *structural* -- a governing heading, a table
 * column header, an "if you..." list stem -- destroyed when the page is
 * flattened to prose. So this reader keeps that structure: it walks the page
 * body in document order and emits a flat stream of blocks, each carrying the
 * heading stack above it and (for list items and table cells) the stem / column
 * header that scopes it.
 *
 * Same engineering constraints as extract-income-tables.mjs: plain JS, zero
 * dependencies, a regex tokenizer rather than a real DOM. Section 3 of
 * docs/eligibility-extraction.md records that this was sufficient for the
 * real-world government markup in this corpus; it is again here (WI DHS runs a
 * single Drupal/USWDS template across every page measured).
 */

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&#38;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#34;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&rsquo;': "'",
  '&lsquo;': "'",
  '&#8217;': "'",
  '&#8216;': "'",
  '&ldquo;': '"',
  '&rdquo;': '"',
  '&#8220;': '"',
  '&#8221;': '"',
  '&ndash;': '-',
  '&#8211;': '-',
  '&mdash;': '-',
  '&#8212;': '-',
  '&#8201;': ' ',
  '&#160;': ' ',
  '&sect;': '§',
};

/** HTML -> plain text: strip tags, decode the entity subset above, collapse whitespace. */
export function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/[​­]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Narrow a full HTML document to its main content region. WI DHS, WI DCF, WI
 * DOR and the WI energy/housing site all wrap the real content in one of these;
 * without this the heading stack is polluted by nav menus ("Who is eligible?"
 * appears in a sidebar on pages that never use it).
 */
export function mainRegion(html) {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  ]) {
    const m = noScript.match(re);
    if (m) return m[1];
  }
  return noScript;
}

/**
 * @typedef {Object} Block
 * @property {'heading'|'paragraph'|'list-item'|'table'} type
 * @property {number} [level]        heading level 1-6
 * @property {string} text           plain text of the block
 * @property {string[]} headingPath  heading texts enclosing this block, outermost first
 * @property {string|null} [listStem] for list-item: the text introducing the list ("... if you:")
 * @property {number} [listDepth]     for list-item: nesting depth (1 = top-level <li>)
 * @property {TableModel} [table]     for table
 */

/**
 * @typedef {Object} TableModel
 * @property {string|null} caption
 * @property {string[]} columnHeaders
 * @property {string[][]} rows
 */

function parseTable(tableHtml) {
  const captionMatch = tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  const caption = captionMatch ? stripTags(captionMatch[1]) : null;

  const rows = [];
  for (const tr of tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<(t[hd])[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => stripTags(c[2]));
    if (cells.length > 0) rows.push(cells);
  }

  // Column headers: the first row that is all-<th>, else the first row.
  let columnHeaders = [];
  const firstThRow = tableHtml.match(/<tr[^>]*>((?:\s*<th[\s\S]*?<\/th>\s*)+)<\/tr>/i);
  if (firstThRow) {
    columnHeaders = [...firstThRow[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((c) =>
      stripTags(c[1]),
    );
  } else if (rows.length > 0) {
    columnHeaders = rows[0];
  }

  return { caption, columnHeaders, rows };
}

const BLOCK_RE =
  /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>|<table\b[^>]*>([\s\S]*?)<\/table>|<li\b[^>]*>([\s\S]*?)<\/li>|<(?:p|dt|dd)\b[^>]*>([\s\S]*?)<\/(?:p|dt|dd)>/gi;

// Leaf <div> containing real text but no nested block element -- some CMSs
// (WI DPI) wrap body paragraphs this way instead of <p>. Matched only when the
// regular block pass found little prose, to avoid flooding well-formed pages
// with div noise.
const LEAF_DIV_RE = /<div\b[^>]*>((?:(?!<(?:div|p|ul|ol|table|h[1-6]|li)\b)[\s\S])*?)<\/div>/gi;

/**
 * Walk the main region and return an ordered list of Blocks. Nested lists are
 * flattened but keep their depth and their nearest stem.
 */
export function readBlocks(html) {
  const region = mainRegion(html);
  const blocks = [];

  /** @type {{level:number,text:string}[]} */
  const headingStack = [];
  // For list items: remember the text of the block immediately before a list
  // opened. We approximate "the list stem" as the last paragraph/heading seen
  // before the <li>, which is what the stem visually is on every page here
  // ("You may be eligible for the QMB Program if you:" then a <ul>).
  let lastNonListText = null;

  let m;
  while ((m = BLOCK_RE.exec(region)) !== null) {
    const [, hTag, hInner, tableInner, liInner, pInner] = m;

    if (hTag) {
      const level = Number(hTag[1]);
      const text = stripTags(hInner);
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      if (text) headingStack.push({ level, text });
      blocks.push({ type: 'heading', level, text, headingPath: headingStack.slice(0, -1).map((h) => h.text) });
      lastNonListText = text;
      continue;
    }

    const headingPath = headingStack.map((h) => h.text);

    if (tableInner !== undefined) {
      blocks.push({ type: 'table', text: stripTags(tableInner), headingPath, table: parseTable(m[0]) });
      continue;
    }

    if (liInner !== undefined) {
      // Depth: count how many <ul>/<ol> opened before this point minus closed.
      const upto = region.slice(0, m.index);
      const opens = (upto.match(/<(?:ul|ol)\b/gi) ?? []).length;
      const closes = (upto.match(/<\/(?:ul|ol)>/gi) ?? []).length;
      const listDepth = Math.max(1, opens - closes);
      // Strip any nested list out of this item's own text.
      const ownText = stripTags(liInner.replace(/<(ul|ol)\b[\s\S]*?<\/\1>/gi, ' '));
      if (ownText) {
        blocks.push({
          type: 'list-item',
          text: ownText,
          headingPath,
          listStem: lastNonListText,
          listDepth,
        });
      }
      continue;
    }

    if (pInner !== undefined) {
      const text = stripTags(pInner);
      if (text) {
        blocks.push({ type: 'paragraph', text, headingPath });
        lastNonListText = text;
      }
      continue;
    }
  }

  // Leaf <div> content the block pass missed: keep divs whose body reads like a
  // real sentence and whose text is not already covered by another block.
  const seen = blocks.map((b) => b.text);
  const headingPath = headingStack.map((h) => h.text);
  for (const m of region.matchAll(LEAF_DIV_RE)) {
    const text = stripTags(m[1]);
    if (text.length < 60) continue;
    if (!/[a-z]{3,}[^.]*\.\s/i.test(text)) continue; // has at least one sentence
    const linkChars = [...m[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].reduce((n, a) => n + stripTags(a[1]).length, 0);
    if (linkChars > text.length * 0.5) continue; // mostly a link list / nav
    if (seen.some((t) => t.includes(text) || text.includes(t))) continue;
    blocks.push({ type: 'paragraph', text, headingPath, fromLeafDiv: true });
  }

  return blocks;
}
