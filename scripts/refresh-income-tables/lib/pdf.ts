import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errMsg } from './errors.ts';

/**
 * Extract text from a PDF buffer via the `pdftotext` binary (Poppler), with `-layout` so
 * columns roughly line up.
 *
 * `-layout` is NOT reliable for the wide multi-column income-limit grids in the WHEDA and
 * FHLBank Chicago PDFs this refresher reads -- columns from adjacent counties bleed into
 * each other (confirmed by hand while building this script; see
 * docs/data-authoring.md). Only ask this function for isolated, single-line facts (like a
 * county's stated median family income), never for a whole table.
 *
 * Requires `pdftotext` (Poppler) on PATH. This is a build-time tool, not a shipped
 * dependency -- see scripts/refresh-income-tables/README.md.
 */
export function pdfBufferToLayoutText(buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'income-refresher-'));
  const pdfPath = join(dir, 'in.pdf');
  const txtPath = join(dir, 'out.txt');
  try {
    writeFileSync(pdfPath, buffer);
    try {
      execFileSync('pdftotext', ['-layout', pdfPath, txtPath], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(
        `Could not run 'pdftotext' (Poppler) on the downloaded PDF. This tool requires ` +
          `pdftotext to be installed and on PATH. Original error: ${errMsg(err)}`,
      );
    }
    return readFileSync(txtPath, 'utf-8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
