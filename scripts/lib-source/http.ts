/**
 * A normal-looking browser User-Agent. Several sources this refresher depends on (WI state
 * sites, and historically huduser.gov) block requests carrying an obviously-automated UA
 * even though their robots.txt permits crawling -- see docs/data-sources.md. Using the same
 * header for every fetch keeps that workaround in one place.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface FetchTextResult {
  status: number;
  ok: boolean;
  text: string;
  /**
   * The URL the response actually came from after any redirects (`Response.url`).
   * Equal to the requested URL when nothing redirected. scripts/ingest-descriptive
   * (#14) uses a host change here to tell "the source domain moved" apart from
   * both "changed" and "gone" -- the FNS->FNA case from docs/data-sources.md.
   */
  finalUrl: string;
}

/** Optional per-call knobs. Callers that pass nothing get the original behaviour. */
export interface FetchOptions {
  /** Abort signal, e.g. from `AbortSignal.timeout(ms)` -- used by scripts/check-sources (#7). */
  signal?: AbortSignal;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<FetchTextResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text, finalUrl: res.url || url };
}

export interface FetchBufferResult {
  status: number;
  ok: boolean;
  buffer: Buffer;
}

export async function fetchBuffer(url: string): Promise<FetchBufferResult> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  const arrayBuffer = await res.arrayBuffer();
  return { status: res.status, ok: res.ok, buffer: Buffer.from(arrayBuffer) };
}
