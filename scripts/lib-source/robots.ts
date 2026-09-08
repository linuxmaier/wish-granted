/**
 * A small, dependency-free robots.txt parser and matcher.
 *
 * The spike (docs/archive/data-sources.md) is emphatic on two points this module exists
 * to honour:
 *
 *   1. "check robots.txt and ToS directly for any host you fetch; do not treat a
 *      403 alone as permission and do not treat it alone as prohibition."
 *   2. findhelp.org and 211 Wisconsin are hard nos -- findhelp's robots.txt
 *      `Disallow: /` for the catch-all agent, and 211 Wisconsin has no confirmed
 *      access path. Those are encoded as `HARD_DENY_HOSTS` below, independent of
 *      whatever their robots.txt says on any given day.
 *
 * Scope: this implements the parts of RFC 9309 that matter for a single-purpose
 * fetcher that is not any named bot -- group selection by `User-agent`, `Allow`
 * / `Disallow` path rules, longest-match-wins with `Allow` breaking a tie. It
 * does not implement `$` anchoring or `*` wildcards in paths (none of the
 * sources this pipeline touches use them on a content path), and says so rather
 * than pretending to.
 */

/** Hosts we never fetch, regardless of robots.txt. See the module docstring. */
export const HARD_DENY_HOSTS: readonly string[] = [
  'findhelp.org',
  'www.findhelp.org',
  'auntbertha.com',
  'www.auntbertha.com',
  '211wisconsin.communityos.org',
];

export interface RobotsRule {
  readonly allow: boolean;
  /** The raw path prefix from the file, e.g. `/admin/`. */
  readonly path: string;
}

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
}

export interface RobotsTxt {
  readonly groups: readonly RobotsGroup[];
}

/**
 * Parse robots.txt text. Unknown directives (`Crawl-delay`, `Sitemap`, `Host`)
 * are ignored -- they do not affect whether a path may be fetched.
 */
export function parseRobots(text: string): RobotsTxt {
  const groups: RobotsGroup[] = [];
  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let sawRuleSinceAgent = false;

  const flush = () => {
    if (agents.length > 0) groups.push({ agents: [...agents], rules: [...rules] });
    agents = [];
    rules = [];
    sawRuleSinceAgent = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // A new user-agent line after we have collected rules starts a new group.
      if (sawRuleSinceAgent) flush();
      agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (agents.length === 0) continue; // rule with no preceding agent: skip
      sawRuleSinceAgent = true;
      // An empty Disallow means "allow everything" -- represented as no rule.
      if (field === 'disallow' && value === '') continue;
      rules.push({ allow: field === 'allow', path: value });
    }
  }
  flush();
  return { groups };
}

/**
 * Is `pathname` fetchable by a generic (non-named) bot per these rules?
 *
 * `null` rules (robots.txt was a 404, unreachable, or not HTML/plain text) is
 * conventionally read as "no restriction stated" -> allowed. That matches the
 * spike's own reading of energyandhousing.wi.gov (SharePoint 404 on
 * /robots.txt) and 211's missing file.
 */
export function isAllowed(robots: RobotsTxt | null, pathname: string): boolean {
  if (robots === null) return true;

  // We are not any named crawler, so only the `*` group governs us.
  const group = robots.groups.find((g) => g.agents.includes('*'));
  if (!group || group.rules.length === 0) return true;

  let best: RobotsRule | undefined;
  for (const rule of group.rules) {
    if (rule.path === '' ) continue;
    if (!pathname.startsWith(rule.path)) continue;
    if (!best || rule.path.length > best.path.length) best = rule;
    else if (rule.path.length === best.path.length && rule.allow) best = rule; // Allow wins ties
  }
  return best ? best.allow : true;
}

export function isHardDenied(hostname: string): boolean {
  return HARD_DENY_HOSTS.includes(hostname.toLowerCase());
}
