/**
 * Who may call this API from a browser, and what happens to everyone else.
 *
 * ## Why a refused origin is not an error
 *
 * The first version of this answered a disallowed origin with
 * `callback(new Error('Origin not allowed by CORS'))`. That is how the `cors`
 * README spells it, and it is wrong in a way that only shows up in
 * production: `cors` hands the error to `next()`, Express's default handler
 * turns it into a **500 with a stack trace**, and the stack goes to the log.
 *
 * Three things are wrong with that at once:
 *
 *  - **It is the wrong status.** A cross-origin request from an origin that is
 *    not on the list is not a server fault. The correct answer is a normal
 *    response with no `Access-Control-Allow-Origin` header on it — the browser
 *    then refuses to show it to the calling page, which is the entire
 *    enforcement mechanism. A 500 refuses just as hard and claims the server
 *    broke doing it.
 *  - **It floods the log.** Every scanner, every stale bookmark and every
 *    preview deployment pointed at the wrong API produces a ten-line stack
 *    trace, repeated per request. Real faults then live in a log that is
 *    mostly this.
 *  - **It never says which origin was refused.** The stack names `cors`'s own
 *    internals and this file. The one fact needed to fix a misconfigured
 *    deployment — the `Origin` header that was sent — is the one fact it left
 *    out.
 *
 * So: `callback(null, false)`, and one line naming the origin, rate limited so
 * that a scanner in a loop cannot use the log as an amplifier.
 *
 * ## Matching is forgiving about spelling, strict about identity
 *
 * `ALLOWED_ORIGINS` is typed by a person into a deployment dashboard, and the
 * two ways it gets typed wrong are a trailing slash (`https://app.example.com/`,
 * which is what a browser's address bar shows) and capitals. Neither changes
 * which site is being named, and both used to mean "no match, every request
 * refused" — a deployment that looks correctly configured and rejects all of
 * its own traffic.
 *
 * So both ends are normalised to the browser's own serialisation of an origin
 * before comparing: scheme and host lower-cased, a default port dropped, path
 * and trailing slash removed. What is *not* forgiven is anything that changes
 * identity — a different scheme, host or non-default port is a different
 * origin and does not match.
 *
 * ## One wildcard, at the front, for preview deployments
 *
 * `https://*.vercel.app` matches one label in place of the `*`, so
 * `https://vega-canva-git-main.vercel.app` matches and
 * `https://evil.com/?#.vercel.app` cannot. It matches sub-sub-domains too
 * (`a.b.vercel.app`) — that is deliberate, since preview hosts nest — but it
 * never matches the bare apex, so `https://vercel.app` is not admitted by a
 * pattern written for its subdomains.
 *
 * A pattern is only ever a *host* wildcard. `*` alone, or a pattern with no
 * scheme, is refused at config time rather than quietly matching everything:
 * the whole point of the list is that it is a list.
 */

export interface OriginRule {
  /** Normalised `scheme://host[:port]`, for an exact rule. */
  origin?: string;
  /** `{ scheme, suffix }` for a `scheme://*.suffix` rule. */
  wildcard?: { scheme: string; suffix: string };
}

/**
 * A browser's own spelling of an origin, or `null` if the string is not one.
 *
 * This is the serialisation in the HTML standard: scheme and host lower-cased,
 * the port present only when it is not the scheme's default, and nothing after
 * the host. `new URL` does the lower-casing, the punycoding and the
 * default-port elision for us; the rest is dropping what an origin does not
 * include.
 */
export function normalizeOrigin(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw === 'null') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // `url.origin` is exactly this, and already omits a default port.
  return url.origin.toLowerCase();
}

/**
 * One entry of `ALLOWED_ORIGINS` as a rule, or `null` if it is not usable.
 *
 * Returning `null` rather than throwing lets `readConfig` collect every bad
 * entry and report them together, which is the difference between fixing a
 * deployment in one restart and in four.
 */
export function parseOriginRule(value: string): OriginRule | null {
  const raw = value.trim();
  if (!raw) return null;

  const wildcard = /^(https?):\/\/\*\.([^/:*\s]+)\/?$/i.exec(raw);
  if (wildcard) {
    const suffix = wildcard[2].toLowerCase();
    // A wildcard over a bare TLD ("*.com") is indistinguishable from no list
    // at all, so it is not accepted as one.
    if (!suffix.includes('.')) return null;
    return { wildcard: { scheme: wildcard[1].toLowerCase(), suffix } };
  }

  // Anything else must be a plain origin. A bare `*`, a host with no scheme,
  // or a `*` anywhere but the leading label all land here and fail.
  if (raw.includes('*')) return null;
  const origin = normalizeOrigin(raw);
  return origin ? { origin } : null;
}

/** Does this rule admit this already-normalised origin? */
function ruleAdmits(rule: OriginRule, origin: string): boolean {
  if (rule.origin) return rule.origin === origin;
  if (!rule.wildcard) return false;

  const { scheme, suffix } = rule.wildcard;
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== `${scheme}:`) return false;
    // A wildcard rule names a host, so it admits only the scheme's default
    // port — `https://*.example.com` is not a licence to talk to :8443.
    if (url.port) return false;
    host = url.hostname;
  } catch {
    return false;
  }
  // `.` before the suffix is what keeps `evilexample.com` out of a rule
  // written for `example.com`, and what keeps the bare apex out too.
  return host.endsWith(`.${suffix}`) && host.length > suffix.length + 1;
}

/**
 * The predicate the middleware asks, built once at startup.
 *
 * `'*'` stays a distinct case rather than becoming a rule that matches
 * everything: `readConfig` refuses to produce it in production, and keeping it
 * as its own branch means that guarantee is visible here instead of being an
 * emergent property of pattern matching.
 */
export function createOriginCheck(allowed: '*' | readonly string[]): (origin: string) => boolean {
  if (allowed === '*') return () => true;

  const rules = allowed.map(parseOriginRule).filter((r): r is OriginRule => r !== null);
  const exact = new Set(rules.map((r) => r.origin).filter((o): o is string => Boolean(o)));
  const wildcards = rules.filter((r) => r.wildcard);

  return (origin: string) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    if (exact.has(normalized)) return true;
    return wildcards.some((rule) => ruleAdmits(rule, normalized));
  };
}
