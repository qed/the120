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
