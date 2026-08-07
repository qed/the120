import { describe, expect, it, vi } from "vitest";

import {
  readViewOrNull,
  runArrivalPoll,
  type ArrivalPhase,
} from "@/app/lib/funnel/arrival-poll";
import {
  ARRIVAL_POLL_INTERVAL_MS,
  ARRIVAL_POLL_MAX_ATTEMPTS,
  type ArrivalView,
} from "@/app/lib/funnel/arrival-rules";

/**
 * THE WEBHOOK-RACE BRIDGE (v3 plan Unit 9 review).
 *
 * `/start/arrival` is Stripe's success_url and the family beats the webhook
 * there by seconds. What is under test is the LOOP: that a missing/failed read
 * keeps the family on a pending screen instead of an error, that a terminal
 * answer needs two consecutive confirmations, and that the wait is bounded and
 * ends in "still pending", never in failure. In v2 this loop lived inside a
 * client component under `app/start/**`, which the vitest allowlist cannot
 * reach — so none of it was testable, which is how it came to be deleted in the
 * first place.
 */

const ready: ArrivalView = { kind: "ready", email: "kid@the120.school", forwarding: "active" };
const provisioning: ArrivalView = { kind: "provisioning" };
const settingUp: ArrivalView = { kind: "setting_up" };

/** Run the loop over a scripted sequence of reads. The sequence's last entry
 *  repeats forever, so a "never resolves" case is one entry long. */
async function run(reads: readonly (ArrivalView | null)[]) {
  const phases: ArrivalPhase[] = [];
  const slept: number[] = [];
  let i = 0;
  const final = await runArrivalPoll({
    readView: async () => reads[Math.min(i++, reads.length - 1)] ?? null,
    sleep: async (ms) => {
      slept.push(ms);
    },
    onPhase: (p) => phases.push(p),
  });
  return { final, phases, slept, reads: i };
}

describe("runArrivalPoll — the pending state", () => {
  it("a MISSING claim keeps the family waiting: the webhook is racing us, not failing", async () => {
    const { final, phases } = await run([provisioning, provisioning, ready, ready]);
    // Every tick before the confirmation is a visible pending state...
    expect(phases.slice(0, 3).map((p) => p.kind)).toEqual(["polling", "polling", "polling"]);
    // ...and none of them is an error phase. There is no error phase at all.
    expect(phases.every((p) => p.kind !== "timeout")).toBe(true);
    expect(final).toEqual({ kind: "confirmed", view: ready });
  });

  it("a FAILED read is a tick that learned nothing — same pending copy, no error", async () => {
    // null = fetch threw, or a 5xx. Indistinguishable to the family from "not
    // committed yet", and treated identically.
    const { final, phases } = await run([null, null, ready, ready]);
    expect(phases[0]).toEqual({ kind: "polling", view: provisioning });
    expect(final).toEqual({ kind: "confirmed", view: ready });
  });

  it("waits the rules module's interval between ticks — the page never busy-loops the API", async () => {
    const { slept } = await run([provisioning, ready, ready]);
    expect(new Set(slept)).toEqual(new Set([ARRIVAL_POLL_INTERVAL_MS]));
  });
});

describe("runArrivalPoll — confirm twice in a row", () => {
  it("ONE terminal read commits nothing: it is still polling after it", async () => {
    const { phases } = await run([ready, ready]);
    expect(phases[0]).toEqual({ kind: "polling", view: ready });
    expect(phases[1]).toEqual({ kind: "confirmed", view: ready });
  });

  it("a terminal answer that flips back to provisioning RESETS the streak", async () => {
    // ready, provisioning, ready, ready → only the last pair is consecutive.
    const { final, reads } = await run([ready, provisioning, ready, ready]);
    expect(final).toEqual({ kind: "confirmed", view: ready });
    expect(reads).toBe(4);
  });

  it("`setting_up` is terminal too, and needs the same two reads", async () => {
    const { final, reads } = await run([settingUp, settingUp]);
    expect(final).toEqual({ kind: "confirmed", view: settingUp });
    expect(reads).toBe(2);
  });
});

describe("runArrivalPoll — the bounded wait", () => {
  it("gives up after the bound and calls it STILL PENDING, never failure", async () => {
    const { final, phases, reads } = await run([provisioning]);
    expect(final).toEqual({ kind: "timeout" });
    expect(reads).toBe(ARRIVAL_POLL_MAX_ATTEMPTS);
    // Everything before the bound was a pending state, so the family watched a
    // spinner, not an error — and `timeout` is the LAST phase, so the screen
    // that follows is the honest "still setting things up" one.
    expect(phases.at(-1)).toEqual({ kind: "timeout" });
    expect(phases.slice(0, -1).every((p) => p.kind === "polling")).toBe(true);
  });

  it("an UNCONFIRMED terminal answer at the bound times out rather than flashing a guess", async () => {
    // Alternating never lets a streak reach two.
    const alternating = Array.from({ length: ARRIVAL_POLL_MAX_ATTEMPTS }, (_, i) =>
      i % 2 === 0 ? ready : provisioning
    );
    const { final } = await run(alternating);
    expect(final).toEqual({ kind: "timeout" });
  });
});

describe("runArrivalPoll — leaving", () => {
  it("no live deposit → `leave`, immediately and without a confirmation round", async () => {
    // Refunded, cancelled, or someone else's link: the honest destination is
    // the dashboard, and this is the one answer the loop trusts on first read
    // because it is not a race — the payment fact is already settled.
    const { final, reads } = await run([{ kind: "redirect_dashboard" }]);
    expect(final).toEqual({ kind: "leave" });
    expect(reads).toBe(1);
  });

  it("cancellation stops the loop and emits nothing further (unmount safety)", async () => {
    const phases: ArrivalPhase[] = [];
    let done = false;
    await runArrivalPoll({
      readView: async () => {
        done = true; // the component unmounted while this read was in flight
        return ready;
      },
      sleep: async () => {},
      cancelled: () => done,
      onPhase: (p) => phases.push(p),
    });
    expect(phases).toEqual([]);
  });
});

describe("readViewOrNull — every failure is the same answer", () => {
  const res = (body: unknown, ok = true) =>
    ({ ok, json: async () => body }) as unknown as Response;

  it("returns the view on a 200 and encodes the child id", async () => {
    const fetchImpl = vi.fn(async () => res({ view: ready }));
    const view = await readViewOrNull(fetchImpl as unknown as typeof fetch, "a b/c")();
    expect(view).toEqual(ready);
    expect(fetchImpl).toHaveBeenCalledWith("/api/funnel/arrival?child=a%20b%2Fc", {
      cache: "no-store",
    });
  });

  it("null on a non-OK response, on a thrown fetch, and on a bodiless 200", async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => res({}, false),
      async () => {
        throw new Error("offline");
      },
      async () => res({}),
    ];
    for (const impl of cases) {
      expect(await readViewOrNull(impl as unknown as typeof fetch, "kid-1")()).toBeNull();
    }
  });
});
