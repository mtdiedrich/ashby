// Fetching a board without letting one stalled request hold a worker.
//
// Greenhouse's board API stalls at random. Measured 2026-09-28 over samples of 400
// and 500 boards: about 6% of requests sat 5-17s before sending a single header, and
// those few were ~80% of the crawl's Greenhouse time — a crawl caught in a stall
// period projected to 12 minutes. The same boards fetched again answered in under
// 300ms, so the fix is to give up on a silent request early and ask again.
// With it, 500 boards during a stall period took 13.1s instead of 29.4s; with no
// stalls about it made no measurable difference.
//
// Only the wait for response HEADERS is cut short. Once they arrive the body gets the
// whole timeout, because the largest boards are several megabytes of descriptions and
// cutting those off would turn a slow download into a dead board. An HTTP error status
// is an answer, not a stall, and is returned as-is for the caller to judge.

/**
 * fetch() that abandons and resends a request with no response headers after
 * `stallMs`. The last attempt waits the full `timeoutMs`, so a server that is merely
 * slow still gets its chance. Rejects if every attempt fails.
 */
export async function fetchPatient(url, { stallMs = 3000, tries = 3, timeoutMs = 30_000, ...init } = {}) {
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= tries;
    const stall = new AbortController();
    const timer = last ? null : setTimeout(() => stall.abort(), stallMs);
    try {
      // The overall timeout stays attached after the headers arrive, so it still
      // bounds reading the body; the stall timer is cleared once they have.
      const signal = AbortSignal.any([stall.signal, AbortSignal.timeout(timeoutMs)]);
      const res = await fetch(url, { ...init, signal });
      clearTimeout(timer);
      return res;
    } catch (e) {
      clearTimeout(timer);
      if (last) throw e;
    }
  }
}
