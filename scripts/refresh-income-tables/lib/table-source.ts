/**
 * Locates and edits the `export const NAME = { ... };` blocks in
 * src/data/reference/income-tables.ts as plain text -- never as an imported module.
 *
 * Why text, not `import`: this script runs under Node's native TypeScript type-stripping
 * (no tsconfig `paths` resolution, no bundler), and income-tables.ts is treated as the
 * hand-verified specification this refresher must not disturb any more than necessary.
 * Reading and patching it as text means an untouched table is byte-for-byte identical
 * after a run -- the git diff shows exactly, and only, what changed.
 */

export interface Block {
  /** Index of the `export const NAME` token. Also where a new provenance comment is inserted. */
  blockStart: number;
  /** Index of the block's opening `{`. */
  braceOpen: number;
  /** Index of the block's matching closing `}`. */
  braceClose: number;
  /** Index just past the trailing `;` (and `as const;` where present). */
  blockEnd: number;
  /** `{ ... }` inclusive. */
  body: string;
}

export function findBlock(fileText: string, exportName: string): Block {
  const exportRe = new RegExp(`export const ${exportName}\\s*(?::\\s*IncomeTable)?\\s*=\\s*\\{`);
  const match = exportRe.exec(fileText);
  if (!match || match.index === undefined) {
    throw new Error(
      `Could not find "export const ${exportName}" in income-tables.ts -- the file's shape may have changed.`,
    );
  }
  const blockStart = match.index;
  const braceOpen = match.index + match[0].length - 1;

  let depth = 0;
  let braceClose = -1;
  for (let i = braceOpen; i < fileText.length; i++) {
    const ch = fileText[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        braceClose = i;
        break;
      }
    }
  }
  if (braceClose === -1) {
    throw new Error(
      `Could not find the matching closing brace for "export const ${exportName}" -- the file's shape may have changed.`,
    );
  }

  let blockEnd = braceClose + 1;
  const tail = fileText.slice(blockEnd, blockEnd + 20);
  const asConstMatch = /^\s*as const/.exec(tail);
  if (asConstMatch) blockEnd += asConstMatch[0].length;
  const semiMatch = /^\s*;/.exec(fileText.slice(blockEnd, blockEnd + 5));
  if (semiMatch) blockEnd += semiMatch[0].length;

  return { blockStart, braceOpen, braceClose, blockEnd, body: fileText.slice(braceOpen, braceClose + 1) };
}

export function readScalarField(body: string, exportName: string, field: string): string {
  const m = body.match(new RegExp(`${field}:\\s*('[^']*'|null|true|false|[0-9_]+)`));
  if (!m) {
    throw new Error(
      `Could not find field "${field}" inside "export const ${exportName}" -- the file's shape may have changed.`,
    );
  }
  return m[1]!;
}

export function readArrayField(body: string, exportName: string, field: string): string {
  const m = body.match(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`));
  if (!m) {
    throw new Error(
      `Could not find array field "${field}" inside "export const ${exportName}" -- the file's shape may have changed.`,
    );
  }
  return m[1]!;
}

export function replaceScalarField(body: string, exportName: string, field: string, newLiteral: string): string {
  const re = new RegExp(`(${field}:\\s*)(?:'[^']*'|null|true|false|[0-9_]+)`);
  if (!re.test(body)) {
    throw new Error(
      `Could not find field "${field}" to update inside "export const ${exportName}" -- the file's shape may have changed.`,
    );
  }
  return body.replace(re, `$1${newLiteral}`);
}

export function replaceArrayField(body: string, exportName: string, field: string, newLiteral: string): string {
  const re = new RegExp(`(${field}:\\s*\\[)[^\\]]*(\\])`);
  if (!re.test(body)) {
    throw new Error(
      `Could not find array field "${field}" to update inside "export const ${exportName}" -- the file's shape may have changed.`,
    );
  }
  return body.replace(re, `$1${newLiteral}$2`);
}
