// Checking API keys before a run spends anything, and recognising an auth failure
// once one comes back.
//
// A scoring run against a bad key made 1,396 requests, printed 1,396 warnings, filled
// its progress bar to 100%, reported "1396 in 25s" and then "0 scored". The only
// honest line in that output was the zero. Every call carried the same key, so the
// first 401 already knew the answer for all of them.

const PLACEHOLDERS = [
  /^your[-_ ]?/i,               // YOUR_OPENAI_API_KEY, your-api-key-here
  /^<.*>$/,                     // <your key>
  /^(changeme|todo|tbd|none|null|undefined|xxx+)$/i,
  /^sk-x+$/i,                   // sk-xxxxxxxx
  /^\.{3,}$/,
];

/** Is this value obviously not a key someone meant to use? */
export function looksLikePlaceholder(value) {
  const v = String(value ?? '').trim().replace(/^["']|["']$/g, '');
  if (!v) return true;
  if (PLACEHOLDERS.some(re => re.test(v))) return true;
  // Real keys from both providers are long. Nothing this short is one, and the
  // check stays away from prefixes, which change.
  return v.length < 24;
}

/**
 * A 401/403, however the provider phrased it.
 *
 * Deliberately narrow on the string form. "401" on its own appears in job titles —
 * a "401k Administrator" posting must not look like an authentication failure — so a
 * bare number is not enough; it has to sit next to something about the key.
 */
export function isAuthError(err) {
  if (!err) return false;
  const status = err.status ?? err.statusCode;
  if (status === 401 || status === 403) return true;
  const msg = String(err.message ?? err);
  if (/authentication_error|invalid x-api-key|incorrect api key|invalid api key/i.test(msg)) return true;
  return /\b40[13]\b/.test(msg) && /api[ _-]?key|auth|unauthori[sz]ed|forbidden/i.test(msg);
}

/**
 * Preflight one key. Returns null when it looks usable, or a message saying what to
 * do — naming the variable and the file, because the answer is always the same and
 * the run should not start without it.
 */
export function checkKey(name, value) {
  const v = String(value ?? '').trim();
  if (!v) return `${name} is not set. Put it in .env — see .env.example.`;
  if (looksLikePlaceholder(v)) {
    return `${name} is still a placeholder ("${v.slice(0, 12)}${v.length > 12 ? '…' : ''}"). ` +
           `Put your real key in .env — see .env.example.`;
  }
  return null;
}

/**
 * The error a failed preflight throws.
 *
 * Carries status 401 so isAuthError() recognises it. Without that the pool treated it
 * as an ordinary per-item failure and printed the same message once per posting —
 * 1,396 times, in the run that found this.
 */
export function badKeyError(name, value) {
  const e = new Error(checkKey(name, value) ?? `${name} is not usable`);
  e.status = 401;
  return e;
}

/** Throw before a run spends anything. */
export function requireKey(name, value = process.env[name]) {
  if (checkKey(name, value)) throw badKeyError(name, value);
}
