import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  FUNNEL_EVENT_NAMES,
  FUNNEL_STAGES,
  STAGE_EVENT_NAMES,
  STAGE_FOR_EVENT,
  sanitizeEventProperties,
  stageFromEvents,
} from "@/app/lib/funnel/event-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

/** U16 (R56–R59): the event vocabulary, the no-PII rule, and the stage
 *  ladder — plus wiring scans pinning that every emit point exists and the
 *  loader filter shares the SAME constant as the pure function. */

describe("the vocabulary (R56)", () => {
  it("carries all 18 names and matches the migration's CHECK, set-equal", () => {
    expect(FUNNEL_EVENT_NAMES).toHaveLength(18);
    const sql = read("supabase/migrations/20260813120000_funnel_events.sql");
    for (const name of FUNNEL_EVENT_NAMES) {
      expect(sql, name).toContain(`'${name}'`);
    }
    // Set-equality BOTH ways, on the CHECK body itself — the earlier
    // version filtered through isFunnelEventName first, so a stray 19th
    // name in the SQL was invisible (reviewer).
    const body = sql.slice(sql.indexOf("check (name in ("), sql.indexOf("));"));
    const inCheck = [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect([...new Set(inCheck)].sort()).toEqual([...FUNNEL_EVENT_NAMES].sort());
  });
});

describe("the no-PII rule (R56), executable", () => {
  it("keeps ids, uuids, enums, booleans, and numbers", () => {
    expect(
      sanitizeEventProperties({
        group: "athletes",
        preselected: true,
        left: 2,
        session: "cs_a1B2c3",
        child: "3f2a1c9e-0b7d-4e5f-9a88-1234567890ab",
      })
    ).toEqual({
      group: "athletes",
      preselected: true,
      left: 2,
      session: "cs_a1B2c3",
      child: "3f2a1c9e-0b7d-4e5f-9a88-1234567890ab",
    });
  });

  it("drops names, emails, and free text — asserted over an adversarial set", () => {
    const clean = sanitizeEventProperties({
      name: "Maya Chen",
      email: "kid@gmail.com",
      pitch: "I want to teach little kids to skate",
      note: "call me at 416-555-0192",
      nested: { anything: "x" },
      nan: NaN,
    });
    expect(clean).toEqual({});
  });

  it("every emitted property in the codebase survives the sanitizer's vocabulary (whole-set sweep)", () => {
    // The emit call sites pass only ids/enums/booleans/numbers; a free-text
    // property would be DROPPED (never stored), but the sweep keeps authors
    // honest: emitFunnelEvent calls must not attempt PII.
    const sources = [
      "app/lib/funnel/actions/capture.ts",
      "app/lib/funnel/actions/children.ts",
      "app/lib/funnel/actions/miniapp.ts",
      "app/lib/funnel/actions/compose.ts",
      "app/lib/funnel/actions/events.ts",
      "app/api/notify-submission/route.ts",
      "app/api/stripe/webhook/route.ts",
      // v3 Unit 9: this is the V3 front door now (the v2 page it replaced is in
      // `archive/new-user-v2/page.tsx`). Same path, different file — the
      // retarget the funnel-analytics-parity decision called for.
      "app/start/page.tsx",
    ].map(read);
    for (const src of sources) {
      expect(src).not.toMatch(/emitFunnelEvent\([^)]*first_?[nN]ame/);
      expect(src).not.toMatch(/emitFunnelEvent\([^)]*email/);
    }
  });
});

describe("the stage ladder (R59)", () => {
  it("stage vocabulary and event mapping agree; the loader filter shares the SAME exported constant", () => {
    for (const stage of Object.values(STAGE_FOR_EVENT)) {
      expect(FUNNEL_STAGES).toContain(stage);
    }
    // Identity, not value: STAGE_EVENT_NAMES derives from STAGE_FOR_EVENT
    // in the module, and the CRM loader imports THAT name.
    expect(STAGE_EVENT_NAMES).toEqual(Object.keys(STAGE_FOR_EVENT));
    const queries = read("app/crm/lib/queries.ts");
    expect(queries).toContain("STAGE_EVENT_NAMES");
    expect(queries).toContain('.in("name", STAGE_EVENT_NAMES)');
  });

  it("stageFromEvents returns the FURTHEST stage with its earliest stamp — out-of-order safe", () => {
    expect(
      stageFromEvents([
        { name: "quiz_start", created_at: "2026-07-28T10:00:00Z" },
        { name: "c1_captured", created_at: "2026-07-28T09:00:00Z" },
        { name: "quiz_start", created_at: "2026-07-28T09:30:00Z" },
        { name: "faq_opened", created_at: "2026-07-28T11:00:00Z" }, // texture, not a stage
      ])
    ).toEqual({ stage: "quiz_started", since: "2026-07-28T09:30:00Z" });
    expect(stageFromEvents([])).toBeNull();
    expect(stageFromEvents([{ name: "garbage", created_at: "x" }])).toBeNull();
  });

  it("c3 outranks everything before it; enrolled outranks c3", () => {
    const history = [
      { name: "c1_captured", created_at: "2026-07-01T00:00:00Z" },
      { name: "c3_deposit", created_at: "2026-07-20T00:00:00Z" },
      { name: "c2_applied", created_at: "2026-07-10T00:00:00Z" },
    ];
    expect(stageFromEvents(history)!.stage).toBe("deposit_paid");
    expect(
      stageFromEvents([...history, { name: "c4_tuition", created_at: "2026-08-01T00:00:00Z" }])!
        .stage
    ).toBe("enrolled");
  });
});

describe("the emit points exist (wiring scans — server-side only, R56)", () => {
  const POINTS: [file: string, marker: string][] = [
    ["app/lib/funnel/actions/capture.ts", '"c1_captured"'],
    ["app/lib/funnel/actions/children.ts", '"child_added"'],
    ["app/lib/funnel/actions/miniapp.ts", '"door_confirmed"'],
    ["app/lib/funnel/actions/compose.ts", '"project_created"'],
    ["app/lib/funnel/actions/compose.ts", '"project_regenerated"'],
    ["app/lib/funnel/actions/events.ts", '"faq_opened"'],
    ["app/lib/funnel/actions/events.ts", '"share_card_created"'],
    ["app/api/notify-submission/route.ts", '"c2_applied"'],
    ["app/api/stripe/webhook/route.ts", '"c3_deposit"'],
    // RETARGETED, not retired (v3 Unit 9 + the plan's funnel-analytics-parity
    // decision): `start_view` still emits from `app/start/page.tsx`, which is
    // now the v3 flow's page. Unit 3 shipped the emission there deliberately so
    // conversion measurement is continuous across the swap — the pin did not
    // have to move at all, only its subject did.
    ["app/start/page.tsx", '"start_view"'],
    // RETIRED with the v2 mini-app: `quiz_start` and `reveal_viewed` were
    // per-render emissions of `/start/child/[childId]`, now in
    // `archive/new-user-v2/`. The event NAMES stay in the vocabulary (the
    // migration's CHECK and every row already written still carry them); what
    // is gone is the surface that emitted them. v3 has no quiz and no reveal.
  ];
  for (const [file, marker] of POINTS) {
    it(`${marker} emits from ${file}`, () => {
      expect(read(file)).toContain(marker);
    });
  }

  it("door_confirmed carries the R57 tuple (preselected / switched_from)", () => {
    const src = read("app/lib/funnel/actions/miniapp.ts");
    expect(src).toContain("preselected");
    expect(src).toContain("switched_from");
    // The shell half of this pin (MiniAppShell supplying the outcome from the
    // doors model) retired with the v2 flow — the action is what survives, and
    // it is the side that writes the event.
  });

  it("c3_deposit emits only for a WRITTEN fulfilment — replays never double-count the conversion", () => {
    const route = read("app/api/stripe/webhook/route.ts");
    expect(route).toContain("outcome.fulfilled");
    const core = read("app/lib/funnel/deposit-core.ts");
    expect(core).toContain('plan.kind === "fulfil"');
  });

  it("no client-side emit exists: emitFunnelEvent is imported only by server files", () => {
    // The emitter is server-only. Asserted over the LIVE client tree rather
    // than over the one v2 shell that used to be its only risk — after the
    // archive, `app/start` is a client flow again and this is the sweep that
    // keeps it honest.
    for (const f of [
      "app/start/V3Flow.tsx",
      "app/start/StepParent.tsx",
      "app/start/StepAddKid.tsx",
      "app/start/StepCover.tsx",
      "app/start/StepStory.tsx",
      "app/start/StepAccountReady.tsx",
      "app/dashboard/ParentDashboard.tsx",
      "app/dashboard/kids/[id]/KidPortal.tsx",
      "app/dashboard/kids/[id]/account/KidAccount.tsx",
      "app/dashboard/FirstProfitCard.tsx",
    ]) {
      expect(read(f), f).not.toContain('from "@/app/lib/funnel/events"');
    }
    // And the emitter still runs from the SERVER page of the same route.
    expect(read("app/start/page.tsx")).toContain('from "@/app/lib/funnel/events"');
  });
});

/* RETIRED (v3 Unit 9): "locked walks emit NOTHING". It pinned the dual-lock
 * guard around the v2 mini-app page's two per-render emissions (`quiz_start`,
 * `reveal_viewed`). Page, guard and emissions all moved to
 * `archive/new-user-v2/child/[childId]/page.tsx` together — there is no live
 * per-render emission left to guard. The rule it encoded (telemetry inherits
 * every gate the surface has) survives as the reason the v3 page's ONE
 * emission is discussed in its own docblock. */

describe("the v3 front door's single emission (v3 Unit 9)", () => {
  const page = read("app/start/page.tsx");

  it("emits start_view exactly once, and emits nothing else", () => {
    expect((page.match(/emitFunnelEvent\("start_view"/g) ?? []).length).toBe(1);
    expect((page.match(/emitFunnelEvent\(/g) ?? []).length).toBe(1);
  });

  it("emits BEFORE the session read — every landing is in the denominator", () => {
    // Deliberate, and stated in the page. The go-live gate this pin
    // originally guarded was removed by owner decision, but the property it
    // protected outlived it: the emit must sit above EVERYTHING conditional in
    // the render, so an auth outage or a signed-out visitor cannot quietly drop
    // visits out of the conversion denominator.
    expect(page.indexOf('emitFunnelEvent("start_view"')).toBeLessThan(
      page.indexOf("supabaseServer()")
    );
  });
});

describe("the ads question (R58) — the verification, as a documented query", () => {
  it("C1→C2→C3 by entry_source needs only the events table (the tuple is denormalized)", () => {
    const sql = read("supabase/migrations/20260813120000_funnel_events.sql");
    expect(sql).toContain("entry_source text");
    expect(sql).toContain("band text");
    expect(sql).toContain("group_slug text");
    // The one query: count(*) filter (where name='c1_captured') etc.,
    // grouped by entry_source — no joins. Pinned here as the contract.
    for (const conversion of ["c1_captured", "c2_applied", "c3_deposit"]) {
      expect(FUNNEL_EVENT_NAMES).toContain(conversion);
    }
  });
});

describe("the review-driven pins (U16)", () => {
  it("c2_applied emits AFTER the atomic claim — behind auth, ownership, status, and the dedupe boundary", () => {
    const src = read("app/api/notify-submission/route.ts");
    const emitAt = src.indexOf('emitFunnelEvent("c2_applied"');
    const claimAt = src.indexOf("claimed.length === 0");
    const authAt = src.indexOf("auth.getUser()");
    expect(emitAt).toBeGreaterThan(claimAt);
    expect(emitAt).toBeGreaterThan(authAt);
    // Awaited: a serverless freeze must not eat the conversion.
    expect(src).toContain('await emitFunnelEvent("c2_applied"');
  });

  it("door_confirmed derives from SERVER truth and a re-confirm emits nothing", () => {
    const src = read("app/lib/funnel/actions/miniapp.ts");
    expect(src).toContain("result.previousSlug !== result.slug");
    expect(src).toContain("switched_from: result.previousSlug");
    // The client half of this pin (the v2 shell no longer supplying
    // switched_from) retired with that shell; the server derivation asserted
    // above is what actually carries the guarantee.
  });

  it("entry_source reaches the tuple only through readCtaSource — start_view and c1_captured both", () => {
    expect(read("app/start/page.tsx")).toContain("readCtaSource(params)");
    expect(read("app/lib/funnel/actions/capture.ts")).toContain("readCtaSource({ src:");
  });

  it("the stage read pages in server-max windows, filtered to the queue's children, with a refusing ceiling", () => {
    const q = read("app/crm/lib/queries.ts");
    expect(q).toContain("SERVER_MAX_ROWS = 1000");
    expect(q).toContain("MAX_EVENT_PAGES");
    expect(q).toContain('.in("child_id", queueChildIds)');
    expect(q).toContain("exceed the page ceiling");
  });

  it("a real-length Stripe session id (66 chars) survives the property sanitizer", () => {
    const real = "cs_test_a11YYufWQzNY63zpQ6QSNRQhkUpVph4WRmzW0zWJO2znZKdVujZ0N0S22u";
    expect(real).toHaveLength(66);
    expect(sanitizeEventProperties({ session: real })).toEqual({ session: real });
  });

  it("resume never emits and never re-stamps entry_source (the plan's attribution scenario)", () => {
    for (const f of ["app/lib/funnel/resume-core.ts", "app/lib/funnel/actions/resume.ts"]) {
      const src = read(f);
      expect(src, f).not.toContain("emitFunnelEvent");
      expect(src, f).not.toContain("entry_source");
    }
  });

  it("faq/share actions attribute a childId only through the CALLER's RLS read", () => {
    const src = read("app/lib/funnel/actions/events.ts");
    expect(src).toContain("ownedChildId(supabase");
  });
});
