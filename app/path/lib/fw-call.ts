/**
 * The FW wall clock (extracted in FW Unit 4, from Unit 3's write path).
 *
 * PLAIN module — no next/supabase/react imports — so the read loaders, the
 * write path, the quick-create core, and Unit 8's drain engine can all share
 * ONE definition of "how long we are willing to wait" instead of three.
 *
 * ── Why this got extracted rather than copied
 *
 * Unit 3 built the timeout and the throw-guard for `fw_move_task` and documented
 * exactly why: nothing in the Supabase client sets a fetch timeout, no route
 * here configures `maxDuration`, and the calls are what a guide is standing at a
 * table waiting on over venue wifi that is expected to drop. Unit 4's reads run
 * for the same actor under the same conditions and had neither — the reliability
 * review's finding. Copying the helper would have created a second definition of
 * the budget, which is the drift this repo has already paid for once; so the
 * original moved here and its old home imports it.
 */

/**
 * The cap on any single Supabase round trip on an FW surface.
 *
 * Eight seconds sits well inside the plan's ~5 s tap-to-board budget plus a
 * retry, while being long enough that a merely slow link still lands.
 */
export const FW_CALL_TIMEOUT_MS = 8_000;

/**
 * Race a Supabase call against the clock.
 *
 * Returns a DISCRIMINATED result rather than a fabricated error object: the
 * Supabase response types are specific (`PostgrestError` carries `code`,
 * `details`, `hint`, …), and inventing one would mean asserting a shape we do
 * not have — the exact thing this repo's fail-closed narrowing rule exists to
 * stop. A timeout is not an error the database returned; it is the absence of an
 * answer, and the type says so.
 *
 * Giving up on WAITING is not the same as cancelling the request — it may still
 * land server-side. On the WRITE path that is safe under the stated recovery
 * model (checkmark and undo are idempotent by state; `not_yet` carries a client
 * id). On the READ path it costs nothing at all.
 */
export async function withFwTimeout<T>(
  promise: PromiseLike<T>,
  label: string
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise).then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => {
          console.error(`[fw] ${label} exceeded ${FW_CALL_TIMEOUT_MS}ms — giving up on the wait`);
          resolve({ timedOut: true });
        }, FW_CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    // Always clear: a pending timer keeps the serverless invocation alive.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Await a Supabase call bounded by the clock AND guarded against a throw,
 * flattened into the `{data, error}` shape callers already branch on.
 *
 * The throw guard is the half the reliability review found missing on the read
 * path. supabase-js reports most failures in-band, but a network abort or a
 * malformed response can THROW — and on a Server Component that exception does
 * not become a typed `{ok:false}`, it escapes past every carefully-written
 * "we couldn't load this just now" branch and out of the render.
 *
 * A timeout and a throw both surface as an `error`, because to the caller they
 * are the same fact: no answer arrived. The distinction that matters (an error
 * the database RETURNED versus the absence of one) is preserved in the log line,
 * where a human debugging at 9pm on a Saturday can see it.
 */
export async function fwRead<R extends { data: unknown; error: { message: string } | null }>(
  call: () => PromiseLike<R>,
  label: string
): Promise<R | { data: null; error: { message: string } }> {
  return fwCall(call, label);
}

/**
 * The WRITE-path twin of `fwRead` — same clock, same throw guard, different
 * contract for the caller.
 *
 * Added after Unit 5's reliability review found every ops mutation (the audit
 * insert, the cohort insert, the board-token revoke/insert/restore, the grant
 * delete) issued as a bare `await db.from(...)`. Unit 3's write path already
 * wrapped `fw_move_task` for exactly this reason and this file's header already
 * claimed to cover writes; the ops core simply did not follow it. On venue wifi
 * a stalled mint left staff watching "Minting…" forever, with none of the
 * carefully-written compensation branches ever reached — the failure mode the
 * timeout exists to convert into a typed refusal.
 *
 * ⚠️ THE CONTRACT A WRITE CALLER TAKES ON. Giving up on waiting is NOT
 * cancelling the request: a timed-out write MAY still land server-side. So
 * every caller must be safe under "reported failed, actually succeeded". In the
 * ops core that holds by construction, and each case is recoverable by the same
 * refresh staff would do anyway:
 *
 *   - audit insert   → reported `audited: false`; a row that lands anyway is a
 *                      truthful record we merely under-claimed.
 *   - cohort insert  → a retry meets `slug_taken`, which names the cohort that
 *                      now exists rather than silently minting a second one.
 *   - token insert   → the compensation's restore is refused by the partial
 *                      unique index if the insert did land, so two live tokens
 *                      cannot result.
 *   - revoke / delete → idempotent by predicate (`is null` / four `eq`s); the
 *                      second attempt reports `no_active_token` /
 *                      `grant_not_found`, which is the truth.
 */
export async function fwWrite<R extends { data: unknown; error: { message: string } | null }>(
  call: () => PromiseLike<R>,
  label: string
): Promise<R | { data: null; error: { message: string } }> {
  return fwCall(call, label);
}

/** The shared body. One definition of the budget and the guard, so a read and a
 *  write can never drift apart on either. */
async function fwCall<R extends { data: unknown; error: { message: string } | null }>(
  call: () => PromiseLike<R>,
  label: string
): Promise<R | { data: null; error: { message: string } }> {
  let raced;
  try {
    raced = await withFwTimeout(call(), label);
  } catch (e) {
    console.error(`[fw] ${label} threw:`, e);
    return { data: null, error: { message: `${label} threw: ${String(e)}` } };
  }
  if (raced.timedOut) {
    return { data: null, error: { message: `${label} timed out after ${FW_CALL_TIMEOUT_MS}ms` } };
  }
  return raced.value;
}

/* ═══════════════════════════════════════════════ the 1000-row cliff ══ */

/**
 * PostgREST's default `max-rows` on this project, measured against production
 * rather than assumed: a `select` with no `range` returns AT MOST this many rows
 * and says nothing about the ones it dropped.
 *
 * This is not a theoretical concern. Seeding the 30-student rehearsal cohort put
 * 3,750 progress rows in the table; an unranged read of them came back with
 * exactly 1,000 and no error, and the resume chips built from that read would
 * have been quietly wrong for two thirds of the roster — a bug that gets WORSE
 * as a weekend goes on and that no fixture-sized test can see. See
 * docs/solutions/integration-issues/postgrest-max-rows-1000-silently-truncates-
 * unranged-select-paginate-and-refuse-2026-07-24.md.
 */
const FW_PAGE_SIZE = 1000;

/**
 * Enough pages for 90 students × 125 tasks, plus headroom. Reaching it is a
 * loud error, never a truncated result — the plan's no-silent-caps posture, and
 * the reason this is a bound rather than a `while (true)`.
 */
const FW_MAX_PAGES = 16;

/**
 * Read every row a query matches, in pages.
 *
 * The caller supplies a closure that applies `.range(from, to)` to its own
 * builder, because PostgREST's builder is not reusable across calls. Returns
 * `{ok:false}` on a read error OR on hitting the page bound — a partial list
 * from a table this size is indistinguishable from a complete one downstream,
 * and every consumer renders a truthful "couldn't load" for `{ok:false}`.
 *
 * LIVES HERE, not in `fw-loader.ts` where Unit 4 first wrote it, for the reason
 * this file's header already records about `withFwTimeout`: Unit 5's ops reads
 * need the same paging, and copying it would create a second definition of the
 * bound — the drift this repo has already paid for once. The ops views are
 * exactly where "these lists are small" stops being true.
 */
export async function fetchAllRows<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ ok: true; rows: T[] } | { ok: false }> {
  const rows: T[] = [];
  for (let i = 0; i < FW_MAX_PAGES; i += 1) {
    const from = i * FW_PAGE_SIZE;
    // Through `fwRead`, so a stalled page cannot hang the loop and a thrown
    // network abort becomes a typed error instead of escaping the Server
    // Component past every "we couldn't load this" branch (reliability review).
    const res = await fwRead(() => page(from, from + FW_PAGE_SIZE - 1), `${label} page ${i}`);
    if (res.error) {
      console.error(`[fw/call] ${label} page ${i} failed: ${res.error.message}`);
      return { ok: false };
    }
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < FW_PAGE_SIZE) return { ok: true, rows };
  }
  console.error(
    `[fw/call] ${label} exceeded ${FW_MAX_PAGES} pages (${FW_MAX_PAGES * FW_PAGE_SIZE} rows) — refusing to report a truncated result`
  );
  return { ok: false };
}
