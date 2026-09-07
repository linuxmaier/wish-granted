/**
 * Structure-preserving reader for eCFR "full text" XML
 * (https://www.ecfr.gov/api/versioner/v1/full/<date>/title-<n>.xml?part=<p>).
 *
 * The #62 experiment-3 hypothesis, applied to regulation: 7 CFR 273 and
 * 45 CFR 1302 are *more* machine-tractable than an HTML table, not less -- a
 * numbered paragraph hierarchy, a defined cross-reference syntax
 * (`§ 273.9(d)(1)`), rigidly consistent formatting, and a real API. The four
 * measured LLM CFR failures (elderly-separate-household 165%, standard
 * deduction 8.31%, shelter deduction $340, ABAWD exemption tree) were all the
 * model reading a number out of a paragraph whose *role* -- fixed by that
 * paragraph's position in the tree and its run-in heading -- it did not carry.
 *
 * This reader keeps the tree. eCFR XML is flat <P> elements whose leading
 * marker ("(a)", "(d)(1)", "(ii)") encodes depth; we reconstruct the path with
 * the standard CFR level cycle and attach each paragraph's nearest run-in
 * heading (the <I>italic.</I> label that opens a lettered paragraph).
 *
 * Plain JS, zero dependencies, regex tokenizer -- same rules as the rest of
 * scripts/.
 */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#8217;': "'",
  '&#x2019;': "'",
  '&#8212;': '-',
  '&#x2014;': '-',
  '&#8211;': '-',
  '&#x2013;': '-',
  '&#167;': '§',
  '&#xa7;': '§',
  '&#160;': ' ',
  '&#xa0;': ' ',
};

function decode(s) {
  return s
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[​­﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROMAN = new Set([
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv',
]);

const ROMAN_SEQ = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii'];

/** The level kind expected directly below a parent of the given kind. */
const CHILD_KIND = {
  root: 'lower-alpha',
  'lower-alpha': 'digit',
  digit: 'lower-roman',
  'lower-roman': 'upper-alpha',
  'upper-alpha': 'digit',
};

function romanIndex(t) {
  return ROMAN_SEQ.indexOf(t.toLowerCase());
}

/**
 * Is `b` the next sibling after `a` in one kind's sequence? CFR paragraph runs
 * are sequential and essentially never skip, so we require the immediate
 * successor (digits tolerate a small gap for reserved paragraphs).
 */
function isSuccessor(kind, a, b) {
  if (kind === 'digit') return Number(b) > Number(a) && Number(b) - Number(a) <= 3;
  if (kind === 'lower-alpha') return /^[a-z]$/.test(b) && b.charCodeAt(0) - a.charCodeAt(0) === 1;
  if (kind === 'upper-alpha') return /^[A-Z]$/.test(b) && b.charCodeAt(0) - a.charCodeAt(0) === 1;
  if (kind === 'lower-roman') return romanIndex(b) > -1 && romanIndex(b) - romanIndex(a) === 1;
  return false;
}

function couldBe(kind, token) {
  if (kind === 'digit') return /^\d+$/.test(token);
  if (kind === 'lower-alpha') return /^[a-z]$/.test(token);
  if (kind === 'upper-alpha') return /^[A-Z]$/.test(token);
  if (kind === 'lower-roman') return romanIndex(token) > -1;
  return false;
}

/**
 * Pull leading and heading-adjacent "(x)(y)(z)" markers off a paragraph.
 * eCFR routinely writes the first child inline with its parent:
 *   "(a) <I>Process overview.</I> (1) Program staff must:"
 * so after the leading "(a)" and the italic label we also take the "(1)".
 * @returns {{markers: string[], rest: string}}
 */
function leadingMarkers(text) {
  const markers = [];
  let rest = text;
  let m;
  for (let i = 0; i < 10; i++) {
    m = rest.match(/^\s*\(([A-Za-z]{1,4}|\d{1,3})\)\s*/);
    if (m) {
      markers.push(m[1]);
      rest = rest.slice(m[0].length);
      continue;
    }
    // Consume (but do not record) a run-in heading sitting between a parent
    // marker and its inline first child. eCFR writes this two ways:
    //   "(a) Process overview. (1) Program staff must:"
    //   "(b) Special household requirements-(1) Required household combinations."
    const h = rest.match(/^([A-Z][A-Za-z0-9 ,'()\/]{2,70}?)[.\-]\s*(?=\([A-Za-z0-9]{1,4}\))/);
    if (h && markers.length > 0) {
      rest = rest.slice(h[0].length);
      continue;
    }
    break;
  }
  return { markers, rest };
}

/**
 * Reconstruct the hierarchy path. `stack` is a running array of { token, kind }
 * carried across paragraphs. For each new marker we look for the deepest
 * existing level it could be a *sibling successor* of; failing that it opens a
 * new child level whose kind is fixed by the CFR cycle (parent digit -> child
 * lower-roman, etc.), which resolves the classic "(i) after (h)" ambiguity.
 */
function resolvePath(stack, markers) {
  for (const token of markers) {
    let placed = false;
    for (let d = stack.length - 1; d >= 0; d--) {
      const lvl = stack[d];
      if (couldBe(lvl.kind, token) && isSuccessor(lvl.kind, lvl.token, token)) {
        stack.length = d;
        stack.push({ token, kind: lvl.kind });
        placed = true;
        break;
      }
    }
    if (placed) continue;

    const parentKind = stack.length ? stack[stack.length - 1].kind : 'root';
    let childKind = CHILD_KIND[parentKind] ?? 'digit';
    // Guard: if the token cannot be the declared child kind (e.g. a digit where
    // a roman was expected), fall back to the kind it literally looks like.
    if (!couldBe(childKind, token)) {
      if (/^\d+$/.test(token)) childKind = 'digit';
      else if (/^[A-Z]$/.test(token)) childKind = 'upper-alpha';
      else if (romanIndex(token) > -1) childKind = 'lower-roman';
      else childKind = 'lower-alpha';
    }
    stack.push({ token, kind: childKind });
  }
  return stack.map((s) => s.token);
}

/**
 * @typedef {Object} CfrParagraph
 * @property {string} section
 * @property {string[]} path
 * @property {string} citation
 * @property {string} runInHeading
 * @property {string} letter
 * @property {string} text
 * @property {string} fullText
 */

function parseSection(divXml) {
  const nMatch = divXml.match(/<DIV8[^>]*\bN="([^"]+)"/i);
  const section = nMatch ? nMatch[1] : '?';
  const headMatch = divXml.match(/<HEAD>([\s\S]*?)<\/HEAD>/i);
  const sectionHeading = headMatch ? decode(headMatch[1].replace(/<[^>]+>/g, '')) : '';

  /** @type {CfrParagraph[]} */
  const paragraphs = [];
  const stack = [];
  let runInHeading = sectionHeading;

  for (const pMatch of divXml.matchAll(/<P\b[^>]*>([\s\S]*?)<\/P>/gi)) {
    const rawInner = pMatch[1];
    const withoutTags = rawInner.replace(/<[^>]+>/g, (t) => (/<\/?I>/i.test(t) ? '' : ' '));
    const plain = decode(withoutTags);
    const { markers, rest } = leadingMarkers(plain);

    const italicMatch = rawInner.match(/<I>([\s\S]*?)<\/I>/i);
    const startsWithItalic = /^\s*(\(\s*[A-Za-z0-9]+\s*\)\s*)*<I>/i.test(rawInner);

    const path = markers.length ? resolvePath(stack, markers) : stack.map((s) => s.token);
    const letter = path[0] ?? '';

    if (startsWithItalic && italicMatch && markers.length <= 2) {
      runInHeading = decode(italicMatch[1]);
    }

    const citation = `§ ${section}` + path.map((t) => `(${t})`).join('');
    paragraphs.push({
      section,
      path: [...path],
      citation,
      runInHeading,
      letter,
      text: rest,
      fullText: plain,
    });
  }

  return { section, sectionHeading, paragraphs };
}

/**
 * Read every section (<DIV8>) in an eCFR full-text XML document.
 * @returns {{section:string, sectionHeading:string, paragraphs:CfrParagraph[]}[]}
 */
export function readSections(xml) {
  const sections = [];
  for (const div of xml.matchAll(/<DIV8\b[^>]*TYPE="SECTION"[^>]*>([\s\S]*?)<\/DIV8>/gi)) {
    sections.push(parseSection(div[0]));
  }
  if (sections.length === 0) {
    const only = xml.match(/<DIV8\b[\s\S]*<\/DIV8>/i);
    if (only) sections.push(parseSection(only[0]));
  }
  return sections;
}

export { decode as _decode };
