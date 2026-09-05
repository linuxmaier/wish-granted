// No shebang here on purpose. Every script in this repo is invoked as
// `node <path>` via an npm script, and Vite does not strip a `#!` line when a
// test imports the module -- see the guard in tests/data/vocabulary.test.ts.
/**
 * Builds src/data/programs/snapshot.json from the hand-authored records
 * (src/data/programs/records.ts). Issue #8.
 *
 *   npm run build:snapshot                 # regenerate and write the file
 *   npm run build:snapshot -- --check      # verify it is up to date and valid; write nothing
 *   npm run build:snapshot -- --measure    # print the per-record size budget
 *
 * `npm run build` runs `--check` before tsc/vite, so a stale or malformed
 * snapshot fails the build rather than shipping.
 *
 * The records import `@/`-aliased modules, so they are loaded through Vite's SSR
 * module runner (which honours the alias in vite.config.ts) rather than Node's
 * bare TypeScript execution. That is the only reason this needs Vite -- there is
 * no dev server, no browser, no network.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createServer, type ViteDevServer } from 'vite';

import { formatBudget, measureSnapshot } from './measure.ts';

const SNAPSHOT_PATH = fileURLToPath(new URL('../../src/data/programs/snapshot.json', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Structural view of what this CLI needs from the two `@/`-aliased source
 * modules it loads through Vite. They are typed for `bundler` resolution and
 * cannot be typechecked under this script's NodeNext tsconfig; the root
 * `tsc -b` covers them, and the runtime shape is fixed by issue #8's schema.
 */
interface BuiltSnapshot {
  readonly snapshot: { readonly records: readonly Record<string, unknown>[] };
  readonly serialized: string;
}
interface BuilderModule {
  buildValidatedSnapshot(
    records: readonly unknown[],
    options: { now: Date; previous?: unknown; generator?: string | undefined },
  ): BuiltSnapshot;
}

async function loadSourceModules(vite: ViteDevServer): Promise<{
  records: readonly unknown[];
  builder: BuilderModule;
}> {
  const recordsModule = (await vite.ssrLoadModule('/src/data/programs/records.ts')) as {
    HAND_AUTHORED_PROGRAMS: readonly unknown[];
  };
  const builder = (await vite.ssrLoadModule(
    '/src/data/programs/build-snapshot.ts',
  )) as BuilderModule;
  return { records: recordsModule.HAND_AUTHORED_PROGRAMS, builder };
}

/** Compare ignoring line-ending style -- a Windows checkout may hold CRLF even
 *  though .gitattributes pins this file to LF and the generator writes LF. */
const sameContent = (a: string, b: string): boolean => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

async function readCommitted(): Promise<{ text: string | null; parsed: unknown }> {
  try {
    const text = await readFile(SNAPSHOT_PATH, 'utf8');
    return { text, parsed: JSON.parse(text) as unknown };
  } catch {
    return { text: null, parsed: undefined };
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      measure: { type: 'boolean', default: false },
      generator: { type: 'string' },
    },
  });

  const committed = await readCommitted();

  const vite = await createServer({
    configFile: `${REPO_ROOT}vite.config.ts`,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  let serialized: string;
  let snapshot: { records: readonly Record<string, unknown>[] };
  try {
    const { records, builder } = await loadSourceModules(vite);
    const built = builder.buildValidatedSnapshot(records, {
      now: new Date(),
      previous: committed.parsed,
      generator: values.generator,
    });
    serialized = built.serialized;
    snapshot = built.snapshot as unknown as { records: readonly Record<string, unknown>[] };
  } finally {
    await vite.close();
  }

  if (values.measure) {
    console.log(`\nProgram snapshot size budget (issue #8)\n`);
    console.log(formatBudget(measureSnapshot(serialized, snapshot)));
    console.log('');
    return 0;
  }

  if (values.check) {
    if (committed.text === null) {
      console.error('snapshot.json is missing. Run `npm run build:snapshot`.');
      return 1;
    }
    if (!sameContent(committed.text, serialized)) {
      console.error(
        'snapshot.json is out of date with src/data/programs/records.ts.\n' +
          'Run `npm run build:snapshot` and commit the result.',
      );
      return 1;
    }
    console.log('snapshot.json is up to date and valid.');
    return 0;
  }

  if (committed.text !== null && sameContent(committed.text, serialized)) {
    console.log('snapshot.json already up to date -- nothing to write.');
    return 0;
  }
  await writeFile(SNAPSHOT_PATH, serialized);
  console.log(
    `Wrote src/data/programs/snapshot.json (${snapshot.records.length} records).` +
      (committed.text === null ? '' : '\nReview the diff before committing.'),
  );
  return 0;
}

process.exitCode = await main();
