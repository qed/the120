import { describe, expect, it } from "vitest";

import {
  PARENT_ROSTER_CHILD_KEYS,
  deriveParentRosterRateLimitKeys,
  shapeParentRoster,
  shapeParentRosterRefusal,
  PARENT_ROSTER_IP_RATE_LIMIT,
  PARENT_ROSTER_MAX_CHILDREN,
  PARENT_ROSTER_RATE_LIMIT,
  PARENT_ROSTER_REFUSAL_BODY,
  type ParentRosterRefusalReason,
  type RosterWalkNote,
} from "../roster-rules";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../../parent-login/parent-login-rules";

/**
 * Pure coverage for the parent roster's decision rules. The route test proves
 * the wiring; this file proves the DECISIONS — the refusal that cannot vary,
 * the join that must not drop a child, and the raw-maps contract that is this
 * door's whole reason for not reusing the staff feed's task-id filter.
 */

const now = new Date("2026-08-13T12:00:00.000Z");

const child = (over: Record<string, unknown> = {}) => ({
  id: "c-1",
  first_name: "Alex",
  last_name: "Ng",
  fp_username: "alex",
  ...over,
});

describe("shapeParentRosterRefusal — one voice", () => {
  it("is byte-identical for EVERY reason", () => {
    const reasons: ParentRosterRefusalReason[] = [
      "missing_token",
      "invalid_token",
      "not_parent",
      "rate_limited",
      "too_many_rows",
      "outage",
    ];
    for (const reason of reasons) {
      expect(shapeParentRosterRefusal(reason)).toEqual({
        status: 401,
        body: PARENT_ROSTER_REFUSAL_BODY,
      });
    }
  });

  it("speaks the SAME bytes as the parent login door", () => {
    // Deliberate: the dashboard's fetch layer sees one refusal shape whether
    // the session expired, was never a parent's, or hit the limiter — and a
    // probe of this URL learns nothing a failed sign-in would not.
    expect(PARENT_ROSTER_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
  });

  it("carries no reason, no code and no field name in the body", () => {
    const body = JSON.parse(PARENT_ROSTER_REFUSAL_BODY) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "success"]);
    expect(body.success).toBe(false);
    for (const leak of ["parent", "roster", "token", "rate", "child"]) {
      expect(String(body.error).toLowerCase()).not.toContain(leak);
    }
  });
});

describe("budgets and caps are PINNED", () => {
  it("holds the sized numbers so a future tightening is a deliberate edit", () => {
    expect(PARENT_ROSTER_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 120 });
    // The per-IP aggregate is DOUBLE the per-user budget: a family on one NAT
    // with several tabs fits, a scripted reader is still capped.
    expect(PARENT_ROSTER_IP_RATE_LIMIT.limit).toBe(PARENT_ROSTER_RATE_LIMIT.limit * 2);
    expect(PARENT_ROSTER_MAX_CHILDREN).toBe(100);
  });

  it("uses its OWN namespaces — never the parent-login or staff buckets", () => {
    const { userKey, ipKey } = deriveParentRosterRateLimitKeys("1.2.3.4", "sub-1");
    expect(userKey.startsWith("fp-parent-roster:")).toBe(true);
    expect(ipKey).toBe("fp-parent-roster-ip:1.2.3.4");
  });

  it("escapes BOTH segments, so no two (ip,user) pairs can alias onto one bucket", () => {
    // An IPv6 ip and a `:` in a forged sub must not collide (see the
    // composite-rate-limit-key solution doc).
    const a = deriveParentRosterRateLimitKeys("2001:db8", ":x").userKey;
    const b = deriveParentRosterRateLimitKeys("2001:db8:", "x").userKey;
    expect(a).not.toBe(b);
  });

  it("is TOTAL against a lone surrogate — the input is an attacker-supplied JWT sub", () => {
    // encodeURIComponent THROWS on one of these, and this runs BEFORE either
    // strike is recorded: a throw here would bypass throttling entirely.
    expect(() => deriveParentRosterRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
  });
});

describe("shapeParentRoster — the join", () => {
  it("sends the completion maps RAW and UNFILTERED — the client owns every semantic", () => {
    const out = shapeParentRoster(
      [child()],
      [{ id: "p-1", child_id: "c-1" }],
      [
        {
          profile_id: "p-1",
          doc: {
            docVersion: 1,
            ideas: [
              {
                id: "idea-a",
                done: { "1.1#0": true },
                doneAt: { "1.1#0": 10 },
                doneByTask: { "1.2.1": true, "3.1.1": true },
                doneAtByTask: { "1.2.1": 20, "3.1.1": 30 },
              },
            ],
            businesses: [],
          },
        },
      ],
      now
    );
    expect(out).toHaveLength(1);
    // Every key the child ever completed, across BOTH the legacy and the stable
    // maps. No task-id filter exists on this door: the parent dashboard derives
    // n/total from the FP client's own curriculum data, so the server holds no
    // task-id vocabulary at all.
    expect(out[0]!.ideas[0]).toMatchObject({
      done: { "1.1#0": true },
      doneAt: { "1.1#0": 10 },
      doneByTask: { "1.2.1": true, "3.1.1": true },
      doneAtByTask: { "1.2.1": 20, "3.1.1": 30 },
    });
    // …and nothing resembling a total, a count or a percentage was invented.
    const keys = Object.keys(out[0]!.ideas[0]!);
    for (const derived of ["total", "count", "percent", "done_n", "criteria"]) {
      expect(keys).not.toContain(derived);
    }
  });

  it("carries the identity fields the dashboard renders, in a pinned order", () => {
    const out = shapeParentRoster([child()], [], [], now);
    expect(Object.keys(out[0]!)).toEqual([
      "id",
      "firstName",
      "lastName",
      "fpUsername",
      "truncated",
      "docUnreadable",
      "ideas",
      "businesses",
      "ageBand",
      "photoConsentOpen",
      "site",
    ]);
    expect(out[0]).toMatchObject({
      id: "c-1",
      firstName: "Alex",
      lastName: "Ng",
      fpUsername: "alex",
    });
  });

  // ── fpv04 U8b: the three fields that are not progress ──

  describe("the side facts — null is not a negative", () => {
    it("OMITTING the extras answers null for BOTH, which is the fail-closed default", () => {
      // A caller that forgets to pass them gets "render neither affordance",
      // never a confident wrong answer.
      const out = shapeParentRoster([child()], [], [], now);
      expect(out[0]!.photoConsentOpen).toBeNull();
      expect(out[0]!.site).toBeNull();
    });

    it("a null consent set is null PER CHILD — never demoted to false", () => {
      const out = shapeParentRoster([child()], [], [], now, undefined, {
        consentOpen: null,
        sitesByChildId: new Map(),
      });
      expect(out[0]!.photoConsentOpen).toBeNull();
      // The sites read SUCCEEDED and simply has no page for this child, which
      // is a real answer rather than a missing one.
      expect(out[0]!.site).toEqual({ handle: null, published: false, locked: false });
    });

    it("a present set answers membership: in = true, out = FALSE", () => {
      const open = shapeParentRoster([child()], [], [], now, undefined, {
        consentOpen: new Set(["c-1"]),
      });
      expect(open[0]!.photoConsentOpen).toBe(true);
      const closed = shapeParentRoster([child()], [], [], now, undefined, {
        consentOpen: new Set<string>(),
      });
      expect(closed[0]!.photoConsentOpen).toBe(false);
    });

    it("a null sites map is null PER CHILD — never demoted to 'no page'", () => {
      const out = shapeParentRoster([child()], [], [], now, undefined, {
        consentOpen: new Set(["c-1"]),
        sitesByChildId: null,
      });
      expect(out[0]!.site).toBeNull();
      // The OTHER field is unaffected: one failed read costs one field.
      expect(out[0]!.photoConsentOpen).toBe(true);
    });

    it("passes a child's own page through, handle and derived published", () => {
      const out = shapeParentRoster([child()], [], [], now, undefined, {
        sitesByChildId: new Map([["c-1", { handle: "alex-treats", published: true, locked: false }]]),
      });
      expect(out[0]!.site).toEqual({ handle: "alex-treats", published: true, locked: false });
    });
  });

  describe("ageBand — derived here, so nobody has to invent one", () => {
    it("⚠ derives from the STORED GRADE, and ignores birth_year entirely", () => {
      // fpv04 U8b review (SEC-3). This used to prefer birth_year, which the
      // CHILD can set through /api/fp/grade — so a nine-year-old could put
      // themselves in the least protected band, and the roster would offer
      // their parent a grant on that basis. It now reads the same column the
      // consent door writes from, so the offer and the record agree.
      const year = now.getUTCFullYear() - (now.getUTCMonth() >= 8 ? 0 : 1);
      const out = shapeParentRoster(
        [{ ...child(), birth_year: String(year - 8), grade: 11 }],
        [],
        [],
        now
      );
      expect(out[0]!.ageBand).toBe("16_plus");
    });

    it("answers null when there is no grade, so no client can offer a grant on a guess", () => {
      const out = shapeParentRoster(
        [{ ...child(), birth_year: String(now.getUTCFullYear() - 9), grade: null }],
        [],
        [],
        now
      );
      expect(out[0]!.ageBand).toBeNull();
    });

    it("falls back to the stored grade, and answers NULL when there is no age signal at all", () => {
      const banded = shapeParentRoster([{ ...child(), grade: 11 }], [], [], now);
      expect(banded[0]!.ageBand).toBe("16_plus");
      // No birth year, no grade → we genuinely do not know. The SPA must then
      // offer no GRANT rather than guess a band onto a legal evidence record.
      expect(shapeParentRoster([child()], [], [], now)[0]!.ageBand).toBeNull();
      expect(
        shapeParentRoster([{ ...child(), birth_year: "", grade: null }], [], [], now)[0]!.ageBand
      ).toBeNull();
    });

    it("NEVER puts a birth year or a grade on the wire", () => {
      const out = shapeParentRoster([{ ...child(), birth_year: "2015", grade: 6 }], [], [], now);
      const serialized = JSON.stringify(out[0]);
      expect(serialized).not.toContain("2015");
      expect(serialized).not.toContain("birth");
      expect(serialized).not.toContain("grade");
    });
  });

  it("keeps a child with NO profile and no save — 'never signed in' is a card, not an omission", () => {
    const out = shapeParentRoster([child()], [], [], now);
    expect(out[0]).toMatchObject({ docUnreadable: false, ideas: [], businesses: [] });
  });

  it("distinguishes an ABSENT save row from an UNREADABLE one", () => {
    const unreadable = shapeParentRoster(
      [child()],
      [{ id: "p-1", child_id: "c-1" }],
      [{ profile_id: "p-1", doc: { docVersion: 99 } }],
      now
    );
    expect(unreadable[0]!.docUnreadable).toBe(true);
    // Both render an empty game; only this flag tells the parent which is which.
    expect(shapeParentRoster([child()], [], [], now)[0]!.docUnreadable).toBe(false);
  });

  it("skips a child with no usable fp_username — the fail-closed second half", () => {
    // The route's query already excludes them; this is the half that holds if
    // someone ever edits that filter.
    for (const bad of [null, "", 42, undefined]) {
      expect(shapeParentRoster([child({ fp_username: bad })], [], [], now)).toEqual([]);
    }
  });

  it("degrades non-string names to '' rather than emitting a number or null", () => {
    const out = shapeParentRoster([child({ first_name: 7, last_name: null })], [], [], now);
    expect(out[0]).toMatchObject({ firstName: "", lastName: "" });
  });

  it("collects an operator note keyed by profile_id — never by name or username", () => {
    const notes: RosterWalkNote[] = [];
    shapeParentRoster(
      [child()],
      [{ id: "p-1", child_id: "c-1" }],
      [{ profile_id: "p-1", doc: { docVersion: 99 } }],
      now,
      notes
    );
    expect(notes).toEqual([{ profileId: "p-1", truncated: false, docUnreadable: true }]);
    // R3: the note is the only thing the route logs about a bad doc, so it must
    // carry nothing that identifies the child to a log reader.
    const asText = JSON.stringify(notes);
    expect(asText).not.toContain("Alex");
    expect(asText).not.toContain("alex");
  });

  it("does not authorize anything: it shapes exactly the children it is handed", () => {
    // Pinned deliberately. The parent scoping lives in the route's QUERY and
    // nowhere else — anyone tempted to add a parent id parameter here should
    // read the docstring first, because a caller that forgot the `.eq` would
    // then LOOK gated while reading the whole school.
    const foreign = child({ id: "c-b1", fp_username: "bo" });
    expect(shapeParentRoster([foreign], [], [], now).map((c) => c.id)).toEqual(["c-b1"]);
  });
});

describe("PARENT_ROSTER_CHILD_KEYS — the twin-pinned wire shape", () => {
  it("matches the keys shapeParentRoster actually emits, in order", () => {
    // The list is only worth anything if it is checked against real output;
    // a hand-maintained constant that nothing verifies is documentation.
    const shaped = shapeParentRoster(
      [{ id: "c1", first_name: "A", last_name: "B", fp_username: "a.b@firstprofit.school" }],
      [],
      [],
      new Date(1_700_000_000_000),
    );
    expect(shaped).toHaveLength(1);
    expect(Object.keys(shaped[0])).toEqual([...PARENT_ROSTER_CHILD_KEYS]);
  });
});
