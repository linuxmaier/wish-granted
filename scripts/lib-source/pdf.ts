/**
 * Zero-dependency PDF text + table extraction for the agentic extractor (#77).
 *
 * WHY NOT reuse scripts/refresh-income-tables/lib/pdf.ts: that helper shells out
 * to the `pdftotext` (Poppler) binary with `-layout`. Two blockers, both
 * recorded in this repo already, not guessed:
 *
 *   1. Its own docstring, docs/data-authoring.md, and scripts/.../sources/dane-ami.ts
 *      all state that `-layout` BLEEDS COLUMNS on wide multi-column income grids --
 *      "genuinely wrong numbers that look plausible". #77 is explicit that a
 *      PDF-to-flat-text conversion that loses column structure recreates the
 *      BadgerCare failure class (#63/#64) in a new format. Poppler's flat output
 *      is exactly what this issue exists to avoid.
 *   2. `pdftotext` is a system binary. It is on nobody's CI runner (ci.yml runs
 *      ubuntu-latest with no apt step) and scripts/refresh-income-tables/ treats
 *      it as build-time-only tooling for one script a human runs by hand. Wiring
 *      it into the agentic path means every contributor and the CI image must
 *      carry Poppler -- a heavier dependency than an npm package, and this repo
 *      has kept zero-new-dependency discipline throughout (see
 *      scripts/extract-income-tables.mjs §3: a plain regex tokeniser sufficed
 *      where cheerio was assumed necessary).
 *
 * So this is a fresh, dependency-free reader, in the same spirit as
 * html-structure.ts (a hand-rolled tokeniser, not a parser library). It works
 * from GLYPH COORDINATES: it decompresses each page content stream (Node's
 * built-in zlib), runs the text-showing operators through a text-matrix state
 * machine to get an (x, y) for every glyph, and then:
 *
 *   - reconstructs reading-order lines, splitting multi-column page layouts;
 *   - detects tables from the vector RULING LINES the document author drew
 *     (`m`/`l`/`re` stroke ops), using the vertical rules as column boundaries
 *     and partial horizontal rules as spanning-header groups, so each data value
 *     stays bound to the column meaning above it -- a table extracted AS a table.
 *
 * It emits `StructureNode[]` (html-structure.ts's type) so `renderNodes` and the
 * provenance matcher see PDF content in the identical shape they see HTML.
 *
 * Scope, stated rather than pretended (house style): it handles the PDF shapes
 * government income notices actually use -- FlateDecode content streams, plain
 * and object-stream (`/ObjStm`) object storage, simple Type1/TrueType fonts with
 * WinAnsi-ish encoding and a `/Widths` array, and Type0 fonts that carry a
 * `/ToUnicode` map. It does NOT implement: encrypted PDFs, Type3 fonts, CID
 * fonts with no `/ToUnicode`, or inline images. When it cannot read a PDF it
 * returns `{ ok: false, reason }` so the caller abstains cleanly -- it never
 * emits a half-decoded page.
 */
import type { StructureNode } from './html-structure.ts';
import { renderNodes } from './html-structure.ts';
import { inflateSync, inflateRawSync } from 'node:zlib';

export interface PdfExtractOk {
  readonly ok: true;
  readonly nodes: readonly StructureNode[];
  /** `renderNodes(nodes)` -- the structure-preserving text fed to the model. */
  readonly structured: string;
  /** Reading-order plain text -- only for provenance span matching. */
  readonly flat: string;
  readonly pageCount: number;
  readonly tableCount: number;
}
export interface PdfExtractFail {
  readonly ok: false;
  readonly reason: string;
}
export type PdfExtractResult = PdfExtractOk | PdfExtractFail;

/** Cheap sniff: does this byte buffer look like a PDF? */
export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" possibly after a few bytes of BOM/whitespace.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  return head.includes('%PDF-');
}

// ---------------------------------------------------------------------------
// Low-level object model
// ---------------------------------------------------------------------------

interface RawObject {
  readonly num: number;
  readonly body: string;
}

const numRe = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;

function inflate(buf: Buffer): Buffer | null {
  try {
    return inflateSync(buf);
  } catch {
    try {
      return inflateRawSync(buf);
    } catch {
      return null;
    }
  }
}

/** The balanced `<< ... >>` dictionary starting at or after `from` in `body`. */
function balancedDict(body: string, from = 0): string {
  const i = body.indexOf('<<', from);
  if (i < 0) return '';
  let depth = 0;
  for (let j = i; j < body.length - 1; j += 1) {
    if (body[j] === '<' && body[j + 1] === '<') {
      depth += 1;
      j += 1;
    } else if (body[j] === '>' && body[j + 1] === '>') {
      depth -= 1;
      j += 1;
      if (depth === 0) return body.slice(i, j + 1);
    }
  }
  return body.slice(i);
}

/** The `<< ... >>` dictionary text at the front of an object body (balanced). */
function dictText(body: string): string {
  return balancedDict(body, 0);
}

class Pdf {
  private readonly objects = new Map<number, RawObject>();
  private readonly raw: string;

  constructor(raw: string) {
    this.raw = raw;
    this.scanPlainObjects();
    this.scanObjectStreams();
  }

  private scanPlainObjects(): void {
    const re = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.raw)) !== null) {
      const num = Number(m[1]);
      if (!this.objects.has(num)) this.objects.set(num, { num, body: m[2]! });
    }
  }

  /** Pull objects out of every `/Type /ObjStm` compressed object stream. */
  private scanObjectStreams(): void {
    for (const obj of [...this.objects.values()]) {
      const d = dictText(obj.body);
      if (!/\/Type\s*\/ObjStm\b/.test(d)) continue;
      const bytes = this.streamBytes(obj);
      if (!bytes) continue;
      const n = Number((/\/N\s+(\d+)/.exec(d) ?? [])[1] ?? 0);
      const first = Number((/\/First\s+(\d+)/.exec(d) ?? [])[1] ?? 0);
      if (!n || !first) continue;
      const text = bytes.toString('latin1');
      const header = text.slice(0, first).trim().split(/\s+/).map(Number);
      for (let i = 0; i < n; i += 1) {
        const objNum = header[i * 2];
        const off = header[i * 2 + 1];
        if (objNum === undefined || off === undefined) continue;
        const start = first + off;
        const end = i + 1 < n ? first + (header[i * 2 + 3] ?? text.length - first) : text.length;
        if (!this.objects.has(objNum)) {
          this.objects.set(objNum, { num: objNum, body: text.slice(start, end) });
        }
      }
    }
  }

  get(num: number): RawObject | undefined {
    return this.objects.get(num);
  }

  /** Resolve `12 0 R` (or an inline dict/array) to text. */
  deref(token: string): string {
    const m = /^(\d+)\s+\d+\s+R$/.exec(token.trim());
    if (m) return this.objects.get(Number(m[1]))?.body ?? '';
    return token;
  }

  streamBytes(obj: RawObject): Buffer | null {
    const body = obj.body;
    const mm = /stream\r?\n/.exec(body);
    if (!mm) return null;
    const start = mm.index + mm[0].length;
    let end = body.indexOf('endstream', start);
    if (end < 0) return null;
    if (body[end - 1] === '\n') end -= 1;
    if (body[end - 1] === '\r') end -= 1;
    let bytes = Buffer.from(body.slice(start, end), 'latin1');
    const d = body.slice(0, mm.index);
    if (/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode)/.test(d)) {
      const out = inflate(bytes);
      if (!out) return null;
      bytes = out;
    }
    return bytes;
  }

  /** Every `/Type /Page` object, in page-tree order (falls back to doc order). */
  pages(): RawObject[] {
    const catalog = [...this.objects.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.body));
    const ordered: RawObject[] = [];
    const seen = new Set<number>();
    const walk = (num: number, depth: number): void => {
      if (depth > 50 || seen.has(num)) return;
      seen.add(num);
      const obj = this.objects.get(num);
      if (!obj) return;
      const d = dictText(obj.body);
      if (/\/Type\s*\/Page\b(?!s)/.test(d)) {
        ordered.push(obj);
        return;
      }
      const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(d);
      if (kids) {
        for (const k of kids[1]!.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1);
      }
    };
    if (catalog) {
      const pagesRef = /\/Pages\s+(\d+)\s+\d+\s+R/.exec(catalog.body);
      if (pagesRef) walk(Number(pagesRef[1]), 0);
    }
    if (ordered.length > 0) return ordered;
    // Fallback: every Page object in the order they appear in the file.
    return [...this.objects.values()].filter((o) => /\/Type\s*\/Page\b(?!s)/.test(dictText(o.body)));
  }

  /** A page's `/Resources` dict text, walking `/Parent` for inheritance. */
  resourcesFor(page: RawObject): string {
    let cur: RawObject | undefined = page;
    for (let i = 0; i < 20 && cur; i += 1) {
      const d = dictText(cur.body);
      const idx = d.search(/\/Resources\b/);
      if (idx >= 0) {
        const after = d.slice(idx + '/Resources'.length).trimStart();
        if (after.startsWith('<<')) return balancedDict(after, 0);
        const ref = /^(\d+)\s+\d+\s+R/.exec(after);
        if (ref) return balancedDict(this.objects.get(Number(ref[1]))?.body ?? '', 0);
      }
      const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(d);
      cur = parent ? this.objects.get(Number(parent[1])) : undefined;
    }
    return '';
  }

  contentFor(page: RawObject): string {
    const d = dictText(page.body);
    const m = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(d);
    if (!m) return '';
    const nums = [...m[1]!.matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]));
    let out = '';
    for (const n of nums) {
      const obj = this.objects.get(n);
      if (!obj) continue;
      const bytes = this.streamBytes(obj);
      if (bytes) out += `${bytes.toString('latin1')}\n`;
    }
    return out;
  }

  mediaBox(page: RawObject): [number, number, number, number] {
    let cur: RawObject | undefined = page;
    for (let i = 0; i < 20 && cur; i += 1) {
      const d = dictText(cur.body);
      const m = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(d);
      if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(d);
      cur = parent ? this.objects.get(Number(parent[1])) : undefined;
    }
    return [0, 0, 612, 792];
  }
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

interface Font {
  /** code (byte or 2-byte for Type0) -> glyph width in 1/1000 em. */
  readonly widthOf: (code: number) => number;
  /** code -> unicode string. */
  readonly toUnicode: (code: number) => string;
  /** 1 for simple fonts, 2 for Type0/CID (2-byte codes). */
  readonly bytesPerCode: number;
  /** True when we have no real glyph->char mapping and are guessing. */
  readonly lossy: boolean;
}

const WIN_ANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ', 0xa0: ' ', 0xad: '-',
};

function winAnsiChar(code: number): string {
  if (code >= 0x20 && code < 0x7f) return String.fromCharCode(code);
  if (code in WIN_ANSI_HIGH) return WIN_ANSI_HIGH[code]!;
  if (code >= 0xa1 && code <= 0xff) return String.fromCharCode(code);
  return '';
}

/** Parse a `/ToUnicode` CMap's bfchar / bfrange sections into a code->string map. */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (h: string): string => {
    const clean = h.replace(/[^0-9A-Fa-f]/g, '');
    let s = '';
    for (let i = 0; i + 3 < clean.length + 1 && i + 4 <= clean.length; i += 4) {
      s += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    }
    return s;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1]!, 16), hexToStr(m[2]!));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1]!, 16);
      const hi = parseInt(m[2]!, 16);
      const base = parseInt(m[3]!, 16);
      for (let c = lo; c <= hi && c - lo < 65536; c += 1) {
        map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
  }
  return map;
}

function parseFont(pdf: Pdf, fontBody: string): Font {
  const d = dictText(fontBody);
  const subtype = (/\/Subtype\s*\/(\w+)/.exec(d) ?? [])[1] ?? 'Type1';
  const isType0 = subtype === 'Type0';

  // ToUnicode (works for both simple and Type0 fonts).
  let toU: Map<number, string> | null = null;
  const tuRef = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(d);
  if (tuRef) {
    const obj = pdf.get(Number(tuRef[1]));
    const bytes = obj ? pdf.streamBytes(obj) : null;
    if (bytes) toU = parseToUnicode(bytes.toString('latin1'));
  }

  // Widths.
  const first = Number((/\/FirstChar\s+(\d+)/.exec(d) ?? [])[1] ?? 0);
  let widths: number[] = [];
  const wm = /\/Widths\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(d);
  if (wm) {
    const arrText = wm[1]!.includes(' R') ? pdf.deref(wm[1]!) : wm[1]!;
    const lb = arrText.indexOf('[');
    const rb = arrText.indexOf(']', lb);
    if (lb >= 0 && rb > lb) widths = (arrText.slice(lb, rb).match(/-?\d+\.?\d*/g) ?? []).map(Number);
  }

  if (isType0) {
    // Descendant font `/W` array: [ c [w w w] c1 c2 w ... ]
    const dw = Number((/\/DW\s+(\d+)/.exec(d) ?? [])[1] ?? 1000);
    const cidWidths = new Map<number, number>();
    const descRef = /\/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R/.exec(d);
    if (descRef) {
      const desc = pdf.get(Number(descRef[1]))?.body ?? '';
      const wArr = /\/W\s*\[([\s\S]*?)\]/.exec(desc);
      if (wArr) {
        const toks = wArr[1]!.match(/\[[^\]]*\]|-?\d+\.?\d*/g) ?? [];
        for (let i = 0; i < toks.length; ) {
          const c = Number(toks[i]);
          if (toks[i + 1]?.startsWith('[')) {
            const ws = (toks[i + 1]!.match(/-?\d+\.?\d*/g) ?? []).map(Number);
            ws.forEach((w, k) => cidWidths.set(c + k, w));
            i += 2;
          } else {
            const c2 = Number(toks[i + 1]);
            const w = Number(toks[i + 2]);
            for (let cc = c; cc <= c2; cc += 1) cidWidths.set(cc, w);
            i += 3;
          }
        }
      }
    }
    return {
      bytesPerCode: 2,
      lossy: !toU,
      widthOf: (code) => cidWidths.get(code) ?? dw,
      toUnicode: (code) => toU?.get(code) ?? (toU ? '' : '�'),
    };
  }

  return {
    bytesPerCode: 1,
    lossy: false,
    widthOf: (code) => {
      const w = widths[code - first];
      if (typeof w === 'number' && w > 0) return w;
      return code === 32 ? 278 : 500;
    },
    toUnicode: (code) => toU?.get(code) ?? winAnsiChar(code),
  };
}

function pageFonts(pdf: Pdf, resourcesText: string): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const idx = resourcesText.search(/\/Font\b/);
  if (idx < 0) return fonts;
  const after = resourcesText.slice(idx + '/Font'.length).trimStart();
  let dictBody: string;
  if (after.startsWith('<<')) {
    dictBody = balancedDict(after, 0);
  } else {
    const ref = /^(\d+)\s+\d+\s+R/.exec(after);
    dictBody = ref ? balancedDict(pdf.get(Number(ref[1]))?.body ?? '', 0) : '';
  }
  for (const m of dictBody.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
    const obj = pdf.get(Number(m[2]));
    if (obj) fonts.set(m[1]!, parseFont(pdf, obj.body));
  }
  return fonts;
}

// ---------------------------------------------------------------------------
// Content stream: glyphs and ruling lines
// ---------------------------------------------------------------------------

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

interface Glyph {
  x: number;
  y: number;
  w: number;
  size: number;
  ch: string;
}

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Split a content stream into PDF tokens (operands + operators). */
function tokenizeContent(content: string): string[] {
  const re =
    /\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S])*\))*\)|<[0-9A-Fa-f\s]*>|\[(?:[^\]\\]|\\[\s\S])*\]|\/[^\s()<>\[\]{}/%]+|[-+]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*'"]+|[{}]/g;
  return content.match(re) ?? [];
}

function decodeLiteralBytes(literal: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < literal.length; i += 1) {
    const c = literal.charCodeAt(i);
    if (c === 92) {
      const n = literal[i + 1]!;
      if (n === 'n') { out.push(10); i += 1; }
      else if (n === 'r') { out.push(13); i += 1; }
      else if (n === 't') { out.push(9); i += 1; }
      else if (n === 'b') { out.push(8); i += 1; }
      else if (n === 'f') { out.push(12); i += 1; }
      else if (n === '(' || n === ')' || n === '\\') { out.push(n.charCodeAt(0)); i += 1; }
      else if (n >= '0' && n <= '7') {
        let oct = n;
        i += 1;
        for (let k = 0; k < 2 && literal[i + 1]! >= '0' && literal[i + 1]! <= '7'; k += 1) {
          oct += literal[i + 1];
          i += 1;
        }
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n === '\n') { i += 1; }
      else if (n === '\r') { i += 1; if (literal[i + 1] === '\n') i += 1; }
      else { out.push(n.charCodeAt(0)); i += 1; }
    } else {
      out.push(c & 0xff);
    }
  }
  return out;
}

function hexStringBytes(token: string): number[] {
  const clean = token.replace(/[^0-9A-Fa-f]/g, '');
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const out: number[] = [];
  for (let i = 0; i < padded.length; i += 2) out.push(parseInt(padded.slice(i, i + 2), 16));
  return out;
}

interface PageContent {
  glyphs: Glyph[];
  vlines: Array<{ x: number; y0: number; y1: number }>;
  hlines: Array<{ y: number; x0: number; x1: number }>;
  lossyGlyphs: number;
}

function readPageContent(content: string, fonts: Map<string, Font>): PageContent {
  const glyphs: Glyph[] = [];
  const segs: Segment[] = [];
  let lossyGlyphs = 0;

  // Graphics state (only CTM needed, for line ops).
  let ctm: Matrix = IDENTITY;
  const gsStack: Matrix[] = [];

  // Text state.
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let fontSize = 0;
  let font: Font | null = null;
  let charSpace = 0;
  let wordSpace = 0;
  let hscale = 1;
  let rise = 0;

  // Path state.
  let cur: [number, number] | null = null;
  const pathSegs: Segment[] = [];

  const apply = (m: Matrix, x: number, y: number): [number, number] => [
    x * m[0] + y * m[2] + m[4],
    x * m[1] + y * m[3] + m[5],
  ];

  const showBytes = (bytes: number[]): void => {
    const step = font?.bytesPerCode ?? 1;
    for (let i = 0; i < bytes.length; i += step) {
      const code = step === 2 ? ((bytes[i]! << 8) | (bytes[i + 1] ?? 0)) : bytes[i]!;
      const ch = font ? font.toUnicode(code) : winAnsiChar(code);
      if (font?.lossy) lossyGlyphs += 1;
      const w0 = (font ? font.widthOf(code) : 500) / 1000;
      const trm = mul(mul([fontSize * hscale, 0, 0, fontSize, 0, rise], tm), ctm);
      const scale = Math.hypot(trm[0], trm[1]) || fontSize || 1;
      const advance = (w0 * fontSize + charSpace + (code === 32 && step === 1 ? wordSpace : 0)) * hscale;
      // Skip strongly rotated glyphs -- in government notices these are margin
      // watermarks ("khammond on DSK9W7S144PROD with NOTICES"), never content.
      const rotated = Math.abs(trm[1]) > Math.abs(trm[0]) + Math.abs(trm[3]) * 0.01 && Math.abs(trm[0]) < scale * 0.5;
      if (ch !== '' && !rotated) glyphs.push({ x: trm[4], y: trm[5], w: w0 * scale, size: scale, ch });
      tm = mul([1, 0, 0, 1, advance, 0], tm);
    }
  };

  const toks = tokenizeContent(content);
  let args: string[] = [];
  const nums = (n: number): number[] => args.slice(-n).map(Number);

  for (const tok of toks) {
    if (numRe.test(tok) || tok[0] === '(' || tok[0] === '<' || tok[0] === '[' || tok[0] === '/') {
      args.push(tok);
      continue;
    }
    switch (tok) {
      // --- graphics state ---
      case 'q': gsStack.push(ctm); break;
      case 'Q': ctm = gsStack.pop() ?? IDENTITY; break;
      case 'cm': { const [a, b, c, d, e, f] = nums(6); ctm = mul([a!, b!, c!, d!, e!, f!], ctm); break; }
      // --- path construction / painting (for ruling lines) ---
      case 'm': { const [x, y] = nums(2); cur = apply(ctm, x!, y!); break; }
      case 'l': {
        const [x, y] = nums(2);
        const p = apply(ctm, x!, y!);
        if (cur) pathSegs.push({ x0: cur[0], y0: cur[1], x1: p[0], y1: p[1] });
        cur = p;
        break;
      }
      case 're': {
        const [x, y, w, h] = nums(4);
        const a = apply(ctm, x!, y!);
        const b = apply(ctm, x! + w!, y!);
        const c = apply(ctm, x! + w!, y! + h!);
        const e = apply(ctm, x!, y! + h!);
        pathSegs.push(
          { x0: a[0], y0: a[1], x1: b[0], y1: b[1] },
          { x0: b[0], y0: b[1], x1: c[0], y1: c[1] },
          { x0: c[0], y0: c[1], x1: e[0], y1: e[1] },
          { x0: e[0], y0: e[1], x1: a[0], y1: a[1] },
        );
        cur = null;
        break;
      }
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': {
        segs.push(...pathSegs.splice(0));
        cur = null;
        break;
      }
      case 'n': pathSegs.splice(0); cur = null; break;
      // --- text ---
      case 'BT': tm = IDENTITY; tlm = IDENTITY; break;
      case 'ET': break;
      case 'Tc': charSpace = Number(args[args.length - 1]); break;
      case 'Tw': wordSpace = Number(args[args.length - 1]); break;
      case 'Tz': hscale = Number(args[args.length - 1]) / 100; break;
      case 'TL': leading = Number(args[args.length - 1]); break;
      case 'Ts': rise = Number(args[args.length - 1]); break;
      case 'Tf': {
        fontSize = Number(args[args.length - 1]);
        const name = args[args.length - 2];
        if (name && name[0] === '/') font = fonts.get(name.slice(1)) ?? null;
        break;
      }
      case 'Td': { const [tx, ty] = nums(2); tlm = mul([1, 0, 0, 1, tx!, ty!], tlm); tm = [...tlm]; break; }
      case 'TD': {
        const [tx, ty] = nums(2);
        leading = -ty!;
        tlm = mul([1, 0, 0, 1, tx!, ty!], tlm);
        tm = [...tlm];
        break;
      }
      case 'Tm': { const [a, b, c, d, e, f] = nums(6); tlm = [a!, b!, c!, d!, e!, f!]; tm = [...tlm]; break; }
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = [...tlm]; break;
      case 'Tj': {
        const s = args[args.length - 1];
        if (s?.[0] === '(') showBytes(decodeLiteralBytes(s.slice(1, -1)));
        else if (s?.[0] === '<') showBytes(hexStringBytes(s));
        break;
      }
      case "'": {
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = [...tlm];
        const s = args[args.length - 1];
        if (s?.[0] === '(') showBytes(decodeLiteralBytes(s.slice(1, -1)));
        else if (s?.[0] === '<') showBytes(hexStringBytes(s));
        break;
      }
      case '"': {
        const aw = Number(args[args.length - 3]);
        const ac = Number(args[args.length - 2]);
        if (!Number.isNaN(aw)) wordSpace = aw;
        if (!Number.isNaN(ac)) charSpace = ac;
        tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
        tm = [...tlm];
        const s = args[args.length - 1];
        if (s?.[0] === '(') showBytes(decodeLiteralBytes(s.slice(1, -1)));
        break;
      }
      case 'TJ': {
        const arr = args[args.length - 1];
        if (arr?.[0] === '[') {
          const parts = arr.slice(1, -1).match(/\((?:[^()\\]|\\[\s\S])*\)|<[0-9A-Fa-f\s]*>|[-+]?(?:\d+\.?\d*|\.\d+)/g) ?? [];
          for (const p of parts) {
            if (p[0] === '(') showBytes(decodeLiteralBytes(p.slice(1, -1)));
            else if (p[0] === '<') showBytes(hexStringBytes(p));
            else {
              const adj = (-Number(p) / 1000) * fontSize * hscale;
              tm = mul([1, 0, 0, 1, adj, 0], tm);
            }
          }
        }
        break;
      }
      default: break;
    }
    args = [];
  }

  const vlines: Array<{ x: number; y0: number; y1: number }> = [];
  const hlines: Array<{ y: number; x0: number; x1: number }> = [];
  for (const s of segs) {
    const dx = Math.abs(s.x1 - s.x0);
    const dy = Math.abs(s.y1 - s.y0);
    if (dx <= 1.2 && dy > 3) vlines.push({ x: (s.x0 + s.x1) / 2, y0: Math.min(s.y0, s.y1), y1: Math.max(s.y0, s.y1) });
    else if (dy <= 1.2 && dx > 3) hlines.push({ y: (s.y0 + s.y1) / 2, x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) });
  }

  return { glyphs, vlines, hlines, lossyGlyphs };
}

// ---------------------------------------------------------------------------
// Layout: lines, columns, tables
// ---------------------------------------------------------------------------

interface TextLine {
  y: number;
  glyphs: Glyph[];
}

function groupLines(glyphs: Glyph[]): TextLine[] {
  const sorted = [...glyphs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const g of sorted) {
    const tol = Math.max(2, g.size * 0.4);
    let line = lines.find((l) => Math.abs(l.y - g.y) <= tol);
    if (!line) {
      line = { y: g.y, glyphs: [] };
      lines.push(line);
    }
    line.glyphs.push(g);
  }
  for (const l of lines) l.glyphs.sort((a, b) => a.x - b.x);
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

/** Join a line's glyphs into text, inserting spaces where there is an x-gap. */
function lineToText(glyphs: Glyph[]): string {
  let out = '';
  let prevEnd: number | null = null;
  let prevSize = 10;
  for (const g of glyphs) {
    if (prevEnd !== null) {
      const gap = g.x - prevEnd;
      const space = Math.max(prevSize, g.size) * 0.22;
      if (gap > space) {
        const n = Math.min(6, Math.max(1, Math.round(gap / (Math.max(prevSize, g.size) * 0.42))));
        out += ' '.repeat(n);
      }
    }
    out += g.ch;
    prevEnd = g.x + g.w;
    prevSize = g.size;
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Detect a 2- or 3-column page body by finding vertical GUTTERS: x-bands that
 * are (nearly) empty of glyphs down the whole page. Returns each column as
 * `[left, right]`. Line-start clustering cannot see columns here because rows
 * from every column share a baseline and merge into one line; empty gutters are
 * a property of the glyph cloud itself.
 */
function detectColumns(glyphs: Glyph[], pageWidth: number): Array<[number, number]> {
  const single: Array<[number, number]> = [[0, pageWidth + 50]];
  if (glyphs.length < 400) return single;
  const lines = groupLines(glyphs).filter((l) => l.glyphs.length > 3);
  if (lines.length < 15) return single;

  // Within each baseline, split into runs wherever there is a wide horizontal
  // gap. A multi-column page produces runs that start at 2-3 recurring x's (the
  // per-column left margin); single-column prose produces one run per line.
  const starts: number[] = [];
  for (const l of lines) {
    let runStart = l.glyphs[0]!.x;
    let prevEnd = l.glyphs[0]!.x + l.glyphs[0]!.w;
    let count = 1;
    for (let i = 1; i < l.glyphs.length; i += 1) {
      const g = l.glyphs[i]!;
      if (g.x - prevEnd > Math.max(14, g.size * 1.6)) {
        if (count > 2) starts.push(runStart);
        runStart = g.x;
        count = 0;
      }
      prevEnd = g.x + g.w;
      count += 1;
    }
    if (count > 2) starts.push(runStart);
  }
  starts.sort((a, b) => a - b);
  if (starts.length < lines.length * 1.4) return single; // barely any split lines

  // Cluster the run-start x's.
  const clusters: number[][] = [];
  for (const x of starts) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1]! <= 10) last.push(x);
    else clusters.push([x]);
  }
  const strong = clusters
    .filter((c) => c.length >= lines.length * 0.35)
    .map((c) => c.reduce((s, v) => s + v, 0) / c.length)
    .sort((a, b) => a - b);
  if (strong.length < 2 || strong.length > 3) return single;

  const xMax = Math.max(...glyphs.map((g) => g.x + g.w));
  // Column left edges are the cluster centres. A glyph belongs to the LAST
  // column whose edge it is at or past (+2pt slack) -- so a justified last word
  // that drifts a few points into the gutter stays with its own column.
  const edges = [...strong];
  const cols: Array<[number, number]> = [];
  for (let i = 0; i < edges.length; i += 1) {
    cols.push([edges[i]! - 2, i + 1 < edges.length ? edges[i + 1]! - 2 : xMax + 6]);
  }
  const widths = cols.map(([a, b]) => b - a);
  if (Math.min(...widths) < 110 || Math.max(...widths) > Math.min(...widths) * 2.6) return single;
  return cols;
}

interface TableRegion {
  top: number;
  bottom: number;
  colX: number[];
}

/** Find a ruled table: a tall stack of vertical rules (>= 3 distinct x's). */
function detectTables(content: PageContent, pageWidth: number): TableRegion[] {
  const { vlines, hlines } = content;
  if (vlines.length < 3) return [];
  const tall = vlines.filter((v) => v.y1 - v.y0 > 6);
  if (tall.length < 3) return [];
  const xs = [...tall.map((v) => v.x)].sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) {
    if (cols.length === 0 || x - cols[cols.length - 1]! > pageWidth * 0.012) cols.push(x);
  }
  if (cols.length < 3) return [];
  const top = Math.max(...tall.map((v) => v.y1));
  const bottom = Math.min(...tall.map((v) => v.y0));
  // Extend the outer boundaries to the widest horizontal rule spanning the band.
  const spanningH = hlines.filter((h) => h.y >= bottom - 6 && h.y <= top + 6 && h.x1 - h.x0 > (cols[cols.length - 1]! - cols[0]!) * 0.8);
  if (spanningH.length > 0) {
    const left = Math.min(...spanningH.map((h) => h.x0));
    const right = Math.max(...spanningH.map((h) => h.x1));
    if (left < cols[0]! - 2) cols.unshift(left);
    if (right > cols[cols.length - 1]! + 2) cols.push(right);
  } else {
    cols.unshift(cols[0]! - (cols[1]! - cols[0]!));
    cols.push(cols[cols.length - 1]! + (cols[cols.length - 1]! - cols[cols.length - 2]!));
  }
  return [{ top: top + 4, bottom: bottom - 6, colX: cols }];
}

const DOTS_ONLY = /^[.․‥…\-—–\s]+$/;
const HAS_DIGIT = /\d/;

/** Assign a line's glyphs to columns by x-position (works for positioned text). */
function assignByX(glyphs: Glyph[], colX: number[]): string[] {
  const byCol: Glyph[][] = new Array(colX.length - 1).fill(null).map(() => []);
  for (const g of glyphs) {
    let ci = colX.findIndex((_, i) => i < colX.length - 1 && g.x >= colX[i]! - 2 && g.x < colX[i + 1]!);
    if (ci < 0) ci = g.x < colX[0]! ? 0 : colX.length - 2;
    byCol[ci]!.push(g);
  }
  return byCol.map((gs) => lineToText(gs));
}

/**
 * Split one text line into `colCount` cells. Rows in these notices are drawn as
 * a single dot-leadered string flowing from the left margin, not as positioned
 * cells, so whitespace tokenisation (dropping the leader) is the reliable path;
 * x-assignment is the fallback when the token count is nowhere near the columns.
 */
function rowToCells(text: string, glyphs: Glyph[], colX: number[]): string[] | null {
  const colCount = colX.length - 1;
  const raw = text.split(/\s+/).filter((t) => t && !DOTS_ONLY.test(t));
  // Fold a leading run of non-numeric label words ("For each add'l family
  // member, add") into the first cell so the numbers line up with their columns.
  const tokens: string[] = [];
  let label = '';
  for (const t of raw) {
    if (tokens.length === 0 && !HAS_DIGIT.test(t)) label = label ? `${label} ${t}` : t;
    else tokens.push(t);
  }
  if (label) tokens.unshift(label);
  if (tokens.length >= colCount - 1 && tokens.length <= colCount + 2) {
    const cells = tokens.slice(0, colCount);
    while (cells.length < colCount) cells.push('');
    if (tokens.length > colCount) cells[colCount - 1] = `${cells[colCount - 1]} ${tokens.slice(colCount).join(' ')}`.trim();
    return cells;
  }
  const byX = assignByX(glyphs, colX);
  if (byX.filter((c) => c.trim()).length >= 2) return byX;
  return null;
}

/** True when a line reads as continuous prose spanning much of the table -- a
 *  sub-caption ("48 Contiguous States, ...") rather than per-column headers. */
function isSubCaptionLine(glyphs: Glyph[], tableWidth: number): boolean {
  if (glyphs.length < 4) return false;
  let maxGap = 0;
  for (let i = 1; i < glyphs.length; i += 1) {
    maxGap = Math.max(maxGap, glyphs[i]!.x - (glyphs[i - 1]!.x + glyphs[i - 1]!.w));
  }
  const span = glyphs[glyphs.length - 1]!.x - glyphs[0]!.x;
  const fs = glyphs[0]!.size || 8;
  return maxGap < fs * 3 && span > tableWidth * 0.4;
}

function buildTableNodes(
  content: PageContent,
  region: TableRegion,
  path: readonly string[],
  captionAbove: string,
): { nodes: StructureNode[]; consumedRange: [number, number] } | null {
  const colX = region.colX;
  const colCount = colX.length - 1;
  const lines = groupLines(content.glyphs).filter((l) => l.y <= region.top && l.y >= region.bottom - 30);
  if (lines.length < 2) return null;

  const lineText = lines.map((l) => lineToText(l.glyphs));
  const numericCount = (t: string): number => t.split(/\s+/).filter((x) => HAS_DIGIT.test(x) && !/^\(/.test(x)).length;
  const isDataRow = (t: string): boolean => {
    const toks = t.split(/\s+/).filter((x) => x && !DOTS_ONLY.test(x));
    return toks.length > 0 && (/^\d{1,2}\b/.test(toks[0]!) || /^(for each|for every|ber,|each add)/i.test(t)) && numericCount(t) >= 3;
  };
  const firstDataIdx = lineText.findIndex(isDataRow);
  if (firstDataIdx < 0) return null;

  // Spanning group labels from partial horizontal rules in the header band.
  const spanH = content.hlines
    .filter((h) => h.y >= region.bottom && h.y <= region.top + 2 && h.x1 - h.x0 < (colX[colCount]! - colX[0]!) * 0.9 && h.x1 - h.x0 > 20)
    .sort((a, b) => b.y - a.y);
  const groupLabels: Array<{ x0: number; x1: number; text: string }> = [];
  const spanGlyphs = new Set<Glyph>();
  for (const h of spanH) {
    const gl = lines
      .filter((l) => l.y > h.y - 1 && l.y < h.y + 14)
      .flatMap((l) => l.glyphs)
      .filter((g) => g.x >= h.x0 - 3 && g.x <= h.x1 + 3)
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const text = lineToText(gl);
    if (text && !DOTS_ONLY.test(text)) {
      groupLabels.push({ x0: h.x0, x1: h.x1, text });
      gl.forEach((g) => spanGlyphs.add(g));
    }
  }

  // Column headers: x-assign the header-band lines (positioned text), one label
  // per column = its unique fragment tokens, prefixed by any spanning label.
  // Continuous wide lines are sub-captions, not per-column headers.
  const tableWidth = colX[colCount]! - colX[0]!;
  const bandLines = lines.slice(0, firstDataIdx).filter((_, i) => lineText[i] && !DOTS_ONLY.test(lineText[i]!));
  const headerLines = bandLines.filter((l) => !isSubCaptionLine(l.glyphs, tableWidth));
  const subCaptions = bandLines.filter((l) => isSubCaptionLine(l.glyphs, tableWidth)).map((l) => lineToText(l.glyphs));
  const rawHeader = [...headerLines.map((l) => lineToText(l.glyphs)), ...subCaptions].join(' / ');
  const perCol: string[][] = new Array(colCount).fill(null).map(() => []);
  for (const l of headerLines) {
    const kept = l.glyphs.filter((g) => !spanGlyphs.has(g));
    const cells = assignByX(kept, colX);
    cells.forEach((c, i) => {
      for (const w of c.split(/\s+/)) {
        if (w && !perCol[i]!.some((e) => e.toLowerCase() === w.toLowerCase())) perCol[i]!.push(w);
      }
    });
  }
  const dedupeWords = (s: string): string => {
    const seen = new Set<string>();
    return s
      .split(/\s+/)
      .filter((w) => {
        const k = w.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .join(' ');
  };
  const headers: string[] = [];
  for (let c = 0; c < colCount; c += 1) {
    const center = (colX[c]! + colX[c + 1]!) / 2;
    const span = groupLabels.filter((g) => center >= g.x0 && center <= g.x1).map((g) => g.text);
    const label = dedupeWords([...span, perCol[c]!.join(' ')].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
    headers.push(label || `column ${c + 1}`);
  }

  // Rows (and interleaved sub-captions like "Alaska" / "Hawaii").
  const rows: Array<Array<{ header: string; cell: string }>> = [];
  const nodes: StructureNode[] = [];
  const caption = [captionAbove, rawHeader].filter(Boolean).join(' :: ');
  const flushTable = (): void => {
    if (rows.length === 0) return;
    nodes.push({
      type: 'table',
      path: [...path],
      ...(caption ? { caption } : {}),
      columnHeaders: headers,
      rows: rows.splice(0),
    });
  };

  for (let i = firstDataIdx; i < lines.length; i += 1) {
    const t = lineText[i]!;
    if (!t || DOTS_ONLY.test(t)) continue;
    if (!isDataRow(t)) {
      // A sub-caption band (e.g. "Alaska"): close the current table, emit it,
      // then continue rows under a note so the region stays one logical unit.
      if (/^[A-Za-z][A-Za-z ,.'()-]{1,60}$/.test(t) && numericCount(t) === 0) {
        flushTable();
        nodes.push({ type: 'paragraph', text: `(table section: ${t})`, path: [...path] });
      }
      continue;
    }
    const cells = rowToCells(t, lines[i]!.glyphs, colX);
    if (!cells) continue;
    rows.push(cells.map((cell, c) => ({ header: headers[c] ?? `column ${c + 1}`, cell: cell.trim() })));
  }
  flushTable();
  if (nodes.length === 0) return null;

  return { nodes, consumedRange: [region.bottom - 30, region.top + 40] };
}

// ---------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------

export function extractPdf(bytes: Uint8Array): PdfExtractResult {
  const buf = Buffer.from(bytes);
  if (!looksLikePdf(buf)) return { ok: false, reason: 'not a PDF (no %PDF- header)' };
  const raw = buf.toString('latin1');
  if (/\/Encrypt\b/.test(raw.slice(-4000)) || /trailer[\s\S]{0,400}\/Encrypt/.test(raw)) {
    return { ok: false, reason: 'the PDF is encrypted; text cannot be extracted' };
  }

  let pdf: Pdf;
  try {
    pdf = new Pdf(raw);
  } catch (err) {
    return { ok: false, reason: `could not parse the PDF structure: ${err instanceof Error ? err.message : String(err)}` };
  }

  const allPages = pdf.pages();
  if (allPages.length === 0) return { ok: false, reason: 'no page objects found (the PDF may use an object storage this reader does not implement)' };
  // Cap the work: eligibility notices are 1-4 pages; a 100-page manual is out of
  // scope and should not lock the agent loop tokenising megabytes of content.
  const PAGE_CAP = 40;
  const pages = allPages.slice(0, PAGE_CAP);

  const nodes: StructureNode[] = [];
  let totalGlyphs = 0;
  let lossyGlyphs = 0;
  let tableCount = 0;

  for (let p = 0; p < pages.length; p += 1) {
    const page = pages[p]!;
    const mb = pdf.mediaBox(page);
    const pageWidth = Math.abs(mb[2] - mb[0]) || 612;
    const fonts = pageFonts(pdf, pdf.resourcesFor(page));
    const content = readPageContent(pdf.contentFor(page), fonts);
    totalGlyphs += content.glyphs.length;
    lossyGlyphs += content.lossyGlyphs;
    if (content.glyphs.length === 0) continue;

    const pagePath = pages.length > 1 ? [`page ${p + 1}`] : [];

    // 1. Tables (from ruling lines) come out first, in document order, and mark
    //    the y-range they consumed so their rows are not also emitted as prose.
    const tableRegions = detectTables(content, pageWidth);
    const consumedRanges: Array<[number, number]> = [];
    const allLines = groupLines(content.glyphs);
    for (const region of tableRegions) {
      // Caption = the 1-2 text lines immediately above the ruled grid.
      const captionLines = allLines
        .filter((l) => l.y > region.top && l.y < region.top + 30)
        .map((l) => lineToText(l.glyphs))
        .filter((t) => t && !DOTS_ONLY.test(t));
      const built = buildTableNodes(content, region, pagePath, captionLines.reverse().join(' '));
      if (built) {
        nodes.push(...built.nodes);
        consumedRanges.push(built.consumedRange);
        tableCount += built.nodes.filter((n) => n.type === 'table').length;
      }
    }
    const inTable = (y: number): boolean => consumedRanges.some(([lo, hi]) => y >= lo && y <= hi);

    // 2. Prose: split the page into columns, then read each column top-to-bottom.
    const columns = detectColumns(content.glyphs.filter((g) => !inTable(g.y)), pageWidth);
    for (let ci = 0; ci < columns.length; ci += 1) {
      const [lo, hi] = columns[ci]!;
      // Assign by the glyph's left edge: a glyph that starts inside this column
      // belongs to it even if justified spacing carries it toward the gutter.
      const colGlyphs = content.glyphs.filter((g) => g.x >= lo && g.x < hi && !inTable(g.y));
      for (const line of groupLines(colGlyphs)) {
        const text = lineToText(line.glyphs);
        if (text) nodes.push({ type: 'paragraph', text, path: [...pagePath] });
      }
    }
  }

  if (totalGlyphs === 0) {
    return { ok: false, reason: 'the PDF has no extractable text layer (it may be a scanned image)' };
  }
  if (lossyGlyphs > totalGlyphs * 0.15) {
    return {
      ok: false,
      reason:
        `${Math.round((lossyGlyphs / totalGlyphs) * 100)}% of glyphs use a font with no ToUnicode map ` +
        `and could not be decoded reliably; refusing to hand a garbled page to the model`,
    };
  }

  const merged = mergeParagraphs(nodes);
  const structured = renderNodes(merged);
  const flat = flattenNodes(merged);
  if (flat.replace(/\s+/g, '').length < 40) {
    return { ok: false, reason: 'extracted text was too short to be usable' };
  }

  return { ok: true, nodes: merged, structured, flat, pageCount: pages.length, tableCount };
}

/** Glue consecutive same-path paragraph fragments into readable paragraphs. */
function mergeParagraphs(nodes: readonly StructureNode[]): StructureNode[] {
  const out: StructureNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      node.type === 'paragraph' &&
      prev &&
      prev.type === 'paragraph' &&
      prev.path.join(' ') === node.path.join(' ')
    ) {
      const joiner = /[-–—]$/.test(prev.text) ? '' : ' ';
      out[out.length - 1] = { ...prev, text: `${prev.text.replace(/[-–—]$/, '')}${joiner}${node.text}`.trim() };
    } else {
      out.push(node);
    }
  }
  return out;
}

function flattenNodes(nodes: readonly StructureNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === 'heading' || node.type === 'paragraph' || node.type === 'list-item') {
      parts.push(node.text);
    } else if (node.type === 'table') {
      if (node.caption) parts.push(node.caption);
      parts.push(node.columnHeaders.join(' '));
      for (const row of node.rows) parts.push(row.map((c) => c.cell).join(' '));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
