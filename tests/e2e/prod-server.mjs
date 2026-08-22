// Minimal static file server for tests/e2e/csp.spec.ts, standing in for
// Cloudflare Pages against a built `dist/`.
//
// No shebang: it's invoked as `node tests/e2e/prod-server.mjs` from
// playwright.prod.config.ts, never executed directly, and #26 established
// that a shebang here buys nothing while risking Vite's transform cache
// choking on the leading `#` if this file is ever imported.
//
// History: this originally shelled out to `wrangler pages dev`, Cloudflare's
// own local Pages emulator, on the theory that trusting their `_headers`
// parser beats hand-rolling one. In practice `workerd` (the runtime wrangler
// uses) crash-looped in at least one contributor's environment -- it bound
// the port and accepted connections but never responded, so the suite that
// proves our most important privacy claim couldn't be run by a reviewer.
// A security test only one machine can execute is not a test. Hence this:
// a ~100-line server plain enough to trust by reading it, that parses the
// REAL `dist/_headers` file rather than hardcoding header values, so the
// suite still fails if someone edits `_headers` without updating their
// expectations, and still fails if this parser and Cloudflare's ever
// disagree about what the file says.
//
// What this deliberately does NOT verify: that Cloudflare's own `_headers`
// parser agrees with this one, or Cloudflare Pages' clean-URL routing
// (`/privacy` -> `privacy.html`) -- this server only serves exact paths, plus
// `/` -> `/index.html`. See docs/design.md, "Hosting, headers, and log
// retention" for the one-time manual check this gap implies before launch.

import { createServer } from 'node:http';
import { readFile, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(here, '..', '..', 'dist');
const headersFile = join(distDir, '_headers');
const port = Number(process.env.PORT ?? 8788);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Parses Cloudflare Pages' `_headers` file format:
 *
 *   # comment
 *   /some/path/*
 *     Header-Name: value
 *     Other-Header: value
 *
 * A non-indented, non-comment, non-blank line starts a new rule (a path
 * pattern). Every indented line under it is `Name: value`. Deliberately
 * strict -- anything that isn't one of "blank", "comment", "pattern", or
 * "indented header line under a pattern" throws, rather than being silently
 * skipped, so a change to `_headers` this parser can't handle fails loudly
 * instead of quietly testing nothing.
 *
 * Only two pattern shapes are supported, because they're the only two this
 * project uses: an exact path, or a path ending in `/*` (prefix match). Any
 * other wildcard position throws -- extend this function deliberately if
 * `_headers` ever needs one.
 */
function parseHeadersFile(text) {
  /** @type {{ pattern: string, headers: [string, string][] }[]} */
  const rules = [];
  let current = null;

  text.split('\n').forEach((rawLine, i) => {
    const line = rawLine.replace(/\r$/, '');
    const lineNo = i + 1;
    if (line.trim() === '' || line.trim().startsWith('#')) return;

    if (/^\s/.test(line)) {
      if (!current) {
        throw new Error(`_headers:${lineNo}: header line before any path pattern: ${line}`);
      }
      const match = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (!match) {
        throw new Error(`_headers:${lineNo}: not a "Name: value" header line: ${line}`);
      }
      current.headers.push([match[1].trim(), match[2].trim()]);
      return;
    }

    const pattern = line.trim();
    if (pattern !== '/*' && pattern.includes('*') && !pattern.endsWith('/*')) {
      throw new Error(
        `_headers:${lineNo}: unsupported wildcard position in "${pattern}" -- ` +
          `this test server only understands an exact path or a trailing "/*"`,
      );
    }
    current = { pattern, headers: [] };
    rules.push(current);
  });

  return rules;
}

function headersForPath(rules, pathname) {
  /** @type {Map<string,string>} */
  const result = new Map();
  for (const rule of rules) {
    const matches =
      rule.pattern === '/*' ||
      rule.pattern === pathname ||
      (rule.pattern.endsWith('/*') && pathname.startsWith(rule.pattern.slice(0, -1)));
    if (!matches) continue;
    for (const [name, value] of rule.headers) result.set(name, value);
  }
  return result;
}

const rules = parseHeadersFile(readFileSync(headersFile, 'utf8'));

function resolveFile(pathname) {
  const safe = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const full = join(distDir, safe);
  if (!full.startsWith(distDir + sep) && full !== distDir) return null; // path traversal guard
  return full;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const filePath = resolveFile(decodeURIComponent(url.pathname));

  const extraHeaders = headersForPath(rules, url.pathname);
  for (const [name, value] of extraHeaders) res.setHeader(name, value);

  if (!filePath) {
    res.writeHead(400).end('Bad request');
    return;
  }

  readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const type = CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(data);
  });
});

server.listen(port, () => {
  // No host argument: binds the unspecified address, so both `127.0.0.1`
  // and `::1` (what "localhost" resolves to first on some Windows setups)
  // reach it -- wrangler bound 127.0.0.1 only, which was a real gap there.
  console.log(`Ready on http://localhost:${port}`);
});
