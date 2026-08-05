import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bandForChildRow,
  deriveProgressRateLimitKeys,
  isAllowedProgressStaffRole,
  PROGRESS_ALLOWED_STAFF_ROLES,
  PROGRESS_BUSINESSES_CAP,
  PROGRESS_DOC_VERSION,
  PROGRESS_IDEAS_CAP,
  PROGRESS_IP_RATE_LIMIT,
  PROGRESS_LABEL_MAX_CHARS,
  PROGRESS_MAP_ENTRIES_CAP,
  PROGRESS_MAX_TIMESTAMP_MS,
  PROGRESS_RATE_LIMIT,
  PROGRESS_REFUSAL_STATUS,
  shapeProgress,
  shapeProgressRefusal,
  walkSaveDoc,
  type ProgressRefusalReason,
} from "../progress-rules";
import { shapeSuggestionsRefusal } from "@/app/api/fp/suggestions/suggestions-rules";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";
import { readStaffRoleCheckRoles } from "@/app/api/fp/__tests__/helpers/staff-role-check";

/* ------------------------------------------------------------- role vocabulary */

describe("progress rules — staff role vocabulary", () => {
  it("is exactly the production vocabulary: ['admin']", () => {
    expect(PROGRESS_ALLOWED_STAFF_ROLES).toEqual(["admin"]);
  });

  it("parity: the allowed set equals the staff table's role CHECK (crm_core migration)", () => {
    // Deliberately re-derived per R2 — this endpoint owns its OWN assertion
    // against the DB vocabulary (only the SQL parse is shared with the
    // suggestions test), so the two allowed sets may diverge from each other
    // but neither may diverge from the database in silence.
    expect([...PROGRESS_ALLOWED_STAFF_ROLES]).toEqual(readStaffRoleCheckRoles());
  });

  it("isAllowedProgressStaffRole: exact string membership only", () => {
    expect(isAllowedProgressStaffRole("admin")).toBe(true);
    for (const v of ["", "Admin", "ADMIN", "admin ", "super_admin", "staff", null, undefined, 1, {}]) {
      expect(isAllowedProgressStaffRole(v), JSON.stringify(v)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------- refusal */

describe("progress rules — refusal shaping", () => {
  const reasons: ProgressRefusalReason[] = [
    "missing_token",
    "invalid_token",
    "not_staff",
    "rate_limited",
    "outage",
  ];

  it("every reason produces the SAME byte-identical 401 (no oracle)", () => {
    const shaped = reasons.map((r) => shapeProgressRefusal(r));
    for (const s of shaped) expect(s.status).toBe(401);
    for (const s of shaped) expect(s.body).toBe(shaped[0]!.body);
    expect(PROGRESS_REFUSAL_STATUS).toBe(401);
  });

  it("the body is the login surface's copy, and never names staff/roles/this endpoint", () => {
    const body = shapeProgressRefusal("not_staff").body;
    expect(body).not.toMatch(/staff|role|progress|admin/i);
    const parsed = JSON.parse(body) as { success: boolean; error: string };
    expect(parsed.success).toBe(false);
    // Pinned to the constant, not merely "a string" — an empty error would
    // otherwise satisfy a typeof assertion while changing the surface's voice.
    expect(parsed.error).toBe(SIGN_IN_FAILED_MESSAGE);
    expect(SIGN_IN_FAILED_MESSAGE.length).toBeGreaterThan(0);
  });

  it("is byte-identical to the suggestions refusal — one voice across staff surfaces", () => {
    expect(shapeProgressRefusal("outage").body).toBe(shapeSuggestionsRefusal("outage").body);
  });
});

/* -------------------------------------------------------------- rate limiting */

describe("progress rules — rate limiting", () => {
  it("pins the budgets so a future tightening is a deliberate edit", () => {
    expect(PROGRESS_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 60 });
    expect(PROGRESS_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 120 });
    expect(PROGRESS_IP_RATE_LIMIT.limit).toBeGreaterThanOrEqual(PROGRESS_RATE_LIMIT.limit);
  });

  it("pins the EXACT key format (both segments present, own namespace)", () => {
    expect(deriveProgressRateLimitKeys("1.2.3.4", "sub-1")).toEqual({
      userKey: "fp-progress:1.2.3.4:sub-1",
      ipKey: "fp-progress-ip:1.2.3.4",
    });
  });

  it("pins the EXACT escaped output for a hostile (ip,user) pair", () => {
    expect(deriveProgressRateLimitKeys("2001:db8::1", "user:x")).toEqual({
      userKey: "fp-progress:2001%3Adb8%3A%3A1:user%3Ax",
      ipKey: "fp-progress-ip:2001%3Adb8%3A%3A1",
    });
  });

  it("escapes both segments — no ':' aliasing across (ip,user) pairs", () => {
    const a = deriveProgressRateLimitKeys("2001:db8::1", "user:x");
    const b = deriveProgressRateLimitKeys("2001:db8:", ":1:user:x");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.ipKey).not.toBe(b.ipKey);
  });

  it("is TOTAL: a lone-surrogate sub does not throw before the strikes are recorded", () => {
    // encodeURIComponent("\ud800") throws URIError, and unverifiedJwtSub hands
    // the claim through unvalidated — the throw would land BEFORE either bucket
    // is written, bypassing throttling entirely.
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    expect(() => deriveProgressRateLimitKeys("1.2.3.4", loneSurrogate)).not.toThrow();
    expect(() => deriveProgressRateLimitKeys(loneSurrogate, "sub-1")).not.toThrow();
    const keys = deriveProgressRateLimitKeys("1.2.3.4", loneSurrogate);
    expect(keys.userKey.startsWith("fp-progress:1.2.3.4:")).toBe(true);
  });
});

/* ------------------------------------------------------------------- fixtures */

// Sep 2026 → school year 2026-27 starts in 2026: grade = 2026 - birthYear - 5.
const NOW = new Date("2026-09-15T00:00:00Z");

const child = (over: Record<string, unknown> = {}) => ({
  id: "c-1",
  fp_username: "alex.fp",
  birth_year: "",
  grade: null,
  ...over,
});

/** Every fixture doc must carry the version the walk understands. */
const doc = (over: Record<string, unknown>) => ({ docVersion: PROGRESS_DOC_VERSION, ...over });

const EMPTY_WALK = { ideas: [], businesses: [], truncated: false, docUnreadable: false };

const wellFormedDoc = doc({
  ideas: [
    {
      id: "idea-1",
      fields: { productName: "  Dog Walking  ", oneLiner: "I walk dogs" },
      done: {},
      doneAt: {},
      doneByTask: { "1.1.1": true, "1.1.2": true },
      doneAtByTask: { "1.1.1": 1_754_000_000_000, "1.1.2": 1_754_100_000_000 },
    },
  ],
  businesses: [
    {
      id: "biz-1",
      ideaId: "idea-1",
      promotedAt: 1_754_200_000_000,
      doneByTask: { "4.1.1": true },
      doneAtByTask: { "4.1.1": 1_754_300_000_000 },
    },
  ],
});

/* ------------------------------------------------------------------ band */

describe("progress rules — band derivation", () => {
  it("birth year WINS over the stored grade", () => {
    // birth_year 2015 → grade 6 → g6_8, even though grade says 4 (g3_5).
    expect(bandForChildRow(child({ birth_year: "2015", grade: 4 }), NOW)).toBe("g6_8");
  });

  it("threads `now` through: the SAME child bands differently across the Sep-1 boundary", () => {
    // Pinned explicitly rather than relying on the fixture date happening to
    // sit after the boundary — otherwise this assertion goes blind the moment
    // the calendar moves.
    const kid = child({ birth_year: "2015", grade: null });
    expect(bandForChildRow(kid, new Date("2026-08-31T23:59:59Z"))).toBe("g3_5"); // grade 5
    expect(bandForChildRow(kid, new Date("2026-09-01T00:00:00Z"))).toBe("g6_8"); // grade 6
  });

  it("falls back to the stored grade when birth_year is the '' sentinel", () => {
    expect(bandForChildRow(child({ birth_year: "", grade: 4 }), NOW)).toBe("g3_5");
  });

  it("null grade AND no birth year → null band (never guessed)", () => {
    expect(bandForChildRow(child({ birth_year: null, grade: null }), NOW)).toBeNull();
    expect(bandForChildRow(child({ birth_year: "", grade: null }), NOW)).toBeNull();
  });

  it("a grade outside the three bands → null, not a nearest guess", () => {
    expect(bandForChildRow(child({ birth_year: "", grade: 1 }), NOW)).toBeNull();
    expect(bandForChildRow(child({ birth_year: "", grade: 13 }), NOW)).toBeNull();
  });

  it("garbage typed columns degrade to null rather than throwing", () => {
    expect(bandForChildRow(child({ birth_year: 2015, grade: "6" }), NOW)).toBeNull();
    expect(bandForChildRow(child({ birth_year: "nope", grade: {} }), NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------- shapeProgress */

describe("progress rules — shapeProgress happy path", () => {
  it("joins children → profiles → saves into the wire shape", () => {
    const children = [
      child({ id: "c-1", fp_username: "alex.fp", birth_year: "2015", grade: 4 }),
      child({ id: "c-2", fp_username: "sam.fp", birth_year: "", grade: 10 }),
    ];
    const profiles = [
      { id: "p-1", child_id: "c-1" },
      { id: "p-2", child_id: "c-2" },
    ];
    const saves = [
      { profile_id: "p-1", doc: wellFormedDoc },
      { profile_id: "p-2", doc: doc({ ideas: [{ id: "idea-2", fields: { oneLiner: "Slime shop" } }] }) },
    ];

    expect(shapeProgress(children, profiles, saves, NOW)).toEqual([
      {
        username: "alex.fp",
        band: "g6_8", // birth year wins over the stored grade 4
        truncated: false,
        docUnreadable: false,
        ideas: [
          {
            index: 0,
            id: "idea-1",
            label: "Dog Walking", // productName, trimmed
            done: {},
            doneAt: {},
            doneByTask: { "1.1.1": true, "1.1.2": true },
            doneAtByTask: { "1.1.1": 1_754_000_000_000, "1.1.2": 1_754_100_000_000 },
          },
        ],
        businesses: [
          {
            id: "biz-1",
            ideaId: "idea-1",
            archived: false,
            doneByTask: { "4.1.1": true },
            doneAtByTask: { "4.1.1": 1_754_300_000_000 },
          },
        ],
      },
      {
        username: "sam.fp",
        band: "g9_12",
        truncated: false,
        docUnreadable: false,
        ideas: [
          {
            index: 0,
            id: "idea-2",
            label: "Slime shop", // oneLiner fallback
            done: {},
            doneAt: {},
            doneByTask: {},
            doneAtByTask: {},
          },
        ],
        businesses: [],
      },
    ]);
  });

  it("threads `now` through to the band (not just bandForChildRow)", () => {
    const kid = [child({ birth_year: "2015", grade: null })];
    expect(shapeProgress(kid, [], [], new Date("2026-08-31T23:59:59Z"))[0]!.band).toBe("g3_5");
    expect(shapeProgress(kid, [], [], new Date("2026-09-01T00:00:00Z"))[0]!.band).toBe("g6_8");
  });

  it("empty children input → empty array", () => {
    expect(shapeProgress([], [], [], NOW)).toEqual([]);
  });

  it("skips a child with no fp_username (the fail-closed half of the query filter)", () => {
    const rows = shapeProgress(
      [child({ id: "c-1", fp_username: null }), child({ id: "c-2", fp_username: "" }), child({ id: "c-3" })],
      [],
      [],
      NOW
    );
    expect(rows.map((r) => r.username)).toEqual(["alex.fp"]);
  });

  it("passes the username through untrimmed — it is an identity value", () => {
    expect(shapeProgress([child({ fp_username: "Alex.FP" })], [], [], NOW)[0]!.username).toBe("Alex.FP");
  });

  it("first row wins on a duplicate profile or save (unreachable per schema; intent pinned)", () => {
    const profiles = [
      { id: "p-first", child_id: "c-1" },
      { id: "p-second", child_id: "c-1" },
    ];
    const saves = [
      { profile_id: "p-first", doc: wellFormedDoc },
      { profile_id: "p-first", doc: doc({ ideas: [] }) },
      { profile_id: "p-second", doc: doc({ ideas: [] }) },
    ];
    const rows = shapeProgress([child()], profiles, saves, NOW);
    expect(rows[0]!.ideas.map((i) => i.id)).toEqual(["idea-1"]);
  });
});

describe("progress rules — shapeProgress missing and unreadable rows", () => {
  it("a child with a profile but NO save row is present as 'never started', not unreadable", () => {
    const rows = shapeProgress([child()], [{ id: "p-1", child_id: "c-1" }], [], NOW);
    expect(rows).toEqual([
      { username: "alex.fp", band: null, truncated: false, docUnreadable: false, ideas: [], businesses: [] },
    ]);
  });

  it("a child with NO profile row at all is still present (never-signed-in kid)", () => {
    const rows = shapeProgress([child()], [], [{ profile_id: "p-1", doc: wellFormedDoc }], NOW);
    expect(rows[0]).toEqual({
      username: "alex.fp",
      band: null,
      truncated: false,
      docUnreadable: false,
      ideas: [],
      businesses: [],
    });
  });

  it("a save row whose doc is unreadable is flagged docUnreadable — NOT confused with never-started", () => {
    const profiles = [{ id: "p-1", child_id: "c-1" }];
    for (const bad of [null, undefined, "a string", 7, [], { ideas: [] } /* no docVersion */]) {
      const rows = shapeProgress([child()], profiles, [{ profile_id: "p-1", doc: bad }], NOW);
      expect(rows[0]!.docUnreadable, JSON.stringify(bad ?? null)).toBe(true);
      expect(rows[0]!.ideas).toEqual([]);
      expect(rows[0]!.businesses).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------- the doc walk */

describe("progress rules — walkSaveDoc: docVersion gate", () => {
  it("mirrors the client: a version this build does not know yields NOTHING, flagged", () => {
    // The FP client's fromSaveDoc refuses any other docVersion and boots the
    // kid into an EMPTY game. Reading it anyway would show staff full progress
    // for a child staring at a blank factory floor.
    for (const v of [2, 0, "1", null, undefined]) {
      const walked = walkSaveDoc({ docVersion: v, ideas: [{ id: "x", doneByTask: { "1.1.1": true } }] });
      expect(walked, JSON.stringify(v ?? null)).toEqual({
        ideas: [],
        businesses: [],
        truncated: false,
        docUnreadable: true,
      });
    }
  });

  it("the supported version reads normally and is NOT flagged", () => {
    expect(PROGRESS_DOC_VERSION).toBe(1);
    const walked = walkSaveDoc(doc({ ideas: [{ id: "x" }] }));
    expect(walked.docUnreadable).toBe(false);
    expect(walked.ideas).toHaveLength(1);
  });

  it("a doc that is not an object at all is unreadable, never a throw", () => {
    for (const bad of [null, undefined, 0, "", "a string", [], true, Number.NaN]) {
      expect(walkSaveDoc(bad), JSON.stringify(bad ?? null)).toEqual({
        ideas: [],
        businesses: [],
        truncated: false,
        docUnreadable: true,
      });
    }
  });
});

describe("progress rules — walkSaveDoc: legacy maps", () => {
  it("an idea with ONLY legacy done/doneAt passes the maps through RAW, keys untouched", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "idea-1",
            fields: { productName: "Lemonade" },
            done: { "1.1#0": true, "1.1#1": true, "1.2#4": false },
            doneAt: { "1.1#0": 1_700_000_000_000, "1.1#1": 1_700_000_001_000 },
          },
        ],
      })
    );
    expect(walked.ideas).toEqual([
      {
        index: 0,
        id: "idea-1",
        label: "Lemonade",
        done: { "1.1#0": true, "1.1#1": true, "1.2#4": false },
        doneAt: { "1.1#0": 1_700_000_000_000, "1.1#1": 1_700_000_001_000 },
        doneByTask: {},
        doneAtByTask: {},
      },
    ]);
  });
});

describe("progress rules — walkSaveDoc: labels", () => {
  const labelOf = (idea: unknown) => walkSaveDoc(doc({ ideas: [idea] })).ideas[0]!.label;

  it("productName wins over oneLiner", () => {
    expect(labelOf({ fields: { productName: "A", oneLiner: "B" } })).toBe("A");
  });

  it("falls back to oneLiner, then to null", () => {
    expect(labelOf({ fields: { oneLiner: "B" } })).toBe("B");
    expect(labelOf({ fields: {} })).toBeNull();
  });

  it("an idea with NO fields object → label null", () => {
    expect(labelOf({ id: "i" })).toBeNull();
    expect(labelOf({ fields: "not an object" })).toBeNull();
    expect(labelOf({ fields: ["array"] })).toBeNull();
  });

  it("whitespace-only trims to null and falls through to the next source", () => {
    expect(labelOf({ fields: { productName: "   ", oneLiner: "B" } })).toBe("B");
    expect(labelOf({ fields: { productName: "   ", oneLiner: "\t\n " } })).toBeNull();
  });

  it("non-string field values are not coerced", () => {
    expect(labelOf({ fields: { productName: 42, oneLiner: null } })).toBeNull();
  });

  it("an oversized label is TRUNCATED (never dropped) and flags the child", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ fields: { productName: "x".repeat(PROGRESS_LABEL_MAX_CHARS + 500) } }] })
    );
    expect(walked.ideas[0]!.label).toHaveLength(PROGRESS_LABEL_MAX_CHARS);
    expect(walked.truncated).toBe(true);
  });

  it("a label exactly at the cap is untouched and does not flag", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ fields: { productName: "x".repeat(PROGRESS_LABEL_MAX_CHARS) } }] })
    );
    expect(walked.ideas[0]!.label).toHaveLength(PROGRESS_LABEL_MAX_CHARS);
    expect(walked.truncated).toBe(false);
  });
});

describe("progress rules — walkSaveDoc: fail-closed narrowing", () => {
  it("doc.ideas that is not an array is skipped entirely", () => {
    expect(walkSaveDoc(doc({ ideas: "nope" })).ideas).toEqual([]);
    expect(walkSaveDoc(doc({ ideas: { "0": {} } })).ideas).toEqual([]);
    expect(walkSaveDoc(doc({ ideas: 5 })).ideas).toEqual([]);
  });

  it("wrong-typed map values are filtered out, never coerced and never thrown", () => {
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "idea-1",
            done: { good: true, alsoGood: false, str: "true", num: 1, nil: null, obj: {} },
            doneAt: {
              good: 1_700_000_000_000,
              zero: 0,
              str: "1700000000000",
              neg: -1,
              nan: Number.NaN,
              inf: Number.POSITIVE_INFINITY,
              nil: null,
              arr: [1],
            },
            doneByTask: { "1.1.1": true, bad: "yes" },
            doneAtByTask: { "1.1.1": 1_700_000_000_000, bad: {} },
          },
        ],
      })
    );
    expect(walked.ideas[0]!.done).toEqual({ good: true, alsoGood: false });
    expect(walked.ideas[0]!.doneAt).toEqual({ good: 1_700_000_000_000, zero: 0 });
    expect(walked.ideas[0]!.doneByTask).toEqual({ "1.1.1": true });
    expect(walked.ideas[0]!.doneAtByTask).toEqual({ "1.1.1": 1_700_000_000_000 });
  });

  it("timestamps outside the representable Date range are DROPPED", () => {
    // new Date(1e308).toISOString() throws RangeError, and a max-of-stamps
    // recency would make the child look permanently fresh — quietly removing
    // them from the stuck list.
    const walked = walkSaveDoc(
      doc({
        ideas: [
          {
            id: "i",
            doneAtByTask: {
              ok: 1_700_000_000_000,
              zero: 0,
              atCap: PROGRESS_MAX_TIMESTAMP_MS,
              past: PROGRESS_MAX_TIMESTAMP_MS + 1,
              huge: 1e16,
              absurd: 1e308,
            },
          },
        ],
      })
    );
    expect(walked.ideas[0]!.doneAtByTask).toEqual({
      ok: 1_700_000_000_000,
      zero: 0,
      atCap: PROGRESS_MAX_TIMESTAMP_MS,
    });
    // Every surviving stamp is renderable.
    for (const v of Object.values(walked.ideas[0]!.doneAtByTask)) {
      expect(() => new Date(v).toISOString()).not.toThrow();
    }
  });

  it("maps that are not objects degrade to {}", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "i", done: "x", doneAt: [1, 2], doneByTask: null, doneAtByTask: 7 }] })
    );
    expect(walked.ideas[0]).toEqual({
      index: 0,
      id: "i",
      label: null,
      done: {},
      doneAt: {},
      doneByTask: {},
      doneAtByTask: {},
    });
  });

  it("a non-string / empty idea id reads as null, never a coerced value", () => {
    const walked = walkSaveDoc(doc({ ideas: [{ id: 7 }, { id: "" }, {}] }));
    expect(walked.ideas.map((i) => i.id)).toEqual([null, null, null]);
  });

  it("adversarial input degrades to an EXACT known shape (no throw, no surprises)", () => {
    // JSON.parse rather than a literal: a literal `__proto__` key in an object
    // literal sets the prototype instead of creating an own property, so only
    // the parsed form reproduces what a hostile jsonb doc actually looks like.
    const hostile = JSON.parse(
      `{"docVersion":1,
        "ideas":[{"id":"i","fields":{"productName":{"deep":{"deeper":[1,2,3]}}},
                  "done":{"__proto__":true,"hasOwnProperty":true,"toString":true,
                          "constructor":true,"valueOf":true,"real":true},
                  "doneAtByTask":{"__proto__":1,"isPrototypeOf":2,"real":3}}],
        "businesses":[{"id":"b","doneByTask":{"__proto__":true,"real":true}}]}`
    ) as unknown;
    const walked = walkSaveDoc(hostile);
    expect(walked).toEqual({
      truncated: false,
      docUnreadable: false,
      ideas: [
        {
          index: 0,
          id: "i",
          label: null, // a non-string productName is never coerced
          done: { real: true },
          doneAt: {},
          doneByTask: {},
          doneAtByTask: { real: 3 },
        },
      ],
      businesses: [{ id: "b", ideaId: null, archived: false, doneByTask: { real: true }, doneAtByTask: {} }],
    });
  });
});

describe("progress rules — walkSaveDoc: prototype-shadowing keys", () => {
  const hostileMap = (mapKey: "done" | "doneAt" | "doneByTask" | "doneAtByTask") => {
    const v = mapKey === "doneAt" || mapKey === "doneAtByTask" ? "5" : "true";
    return JSON.parse(
      `{"docVersion":1,"ideas":[{"id":"i","${mapKey}":{"__proto__":${v},"hasOwnProperty":${v},"toString":${v},"valueOf":${v},"constructor":${v},"1.1.1":${v}}}]}`
    ) as unknown;
  };

  for (const mapKey of ["done", "doneAt", "doneByTask", "doneAtByTask"] as const) {
    it(`${mapKey}: shadowing keys are dropped, the real key survives`, () => {
      const walked = walkSaveDoc(hostileMap(mapKey));
      const map = walked.ideas[0]![mapKey] as Record<string, unknown>;
      expect(Object.keys(map)).toEqual(["1.1.1"]);
    });
  }

  it("the resulting map is safe under BOTH hasOwnProperty and Object.hasOwn", () => {
    // The whole point: a consumer calling map.hasOwnProperty(taskId) must not
    // get a TypeError, which in React blanks the entire cohort table.
    const map = walkSaveDoc(hostileMap("doneByTask")).ideas[0]!.doneByTask;
    // The naive consumer call, verbatim — this is the one that TypeErrors when
    // a shadowing key survives.
    expect(() => map.hasOwnProperty("1.1.1")).not.toThrow();
    expect(map.hasOwnProperty("1.1.1")).toBe(true);
    expect(typeof map.hasOwnProperty).toBe("function");
    expect(Object.hasOwn(map, "1.1.1")).toBe(true);
    expect(Object.hasOwn(map, "hasOwnProperty")).toBe(false);
  });

  it("Object.prototype is never polluted, and the map keeps a normal prototype", () => {
    walkSaveDoc(hostileMap("doneByTask"));
    walkSaveDoc(hostileMap("doneAtByTask"));
    expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
    expect(Object.getPrototypeOf(walkSaveDoc(hostileMap("done")).ideas[0]!.done)).toBe(Object.prototype);
  });

  it("business maps get the same hygiene", () => {
    const walked = walkSaveDoc(
      JSON.parse(
        '{"docVersion":1,"businesses":[{"id":"b","doneByTask":{"hasOwnProperty":true,"4.1.1":true},"doneAtByTask":{"toString":1,"4.1.1":9}}]}'
      ) as unknown
    );
    expect(walked.businesses[0]!.doneByTask).toEqual({ "4.1.1": true });
    expect(walked.businesses[0]!.doneAtByTask).toEqual({ "4.1.1": 9 });
  });
});

describe("progress rules — walkSaveDoc: ORIGINAL idea indices", () => {
  it("a malformed idea in the MIDDLE becomes a PLACEHOLDER at its ORIGINAL index", () => {
    // The highest-value invariant in this module: the client mints
    // `legacy-idea-{index}` for id-less ideas and must reproduce the ids the
    // kid's own client persisted. The client COERCES a malformed entry into a
    // real empty idea (.map(coerceIdea)), so the server emits a placeholder
    // rather than a hole — a compacted index space would mint different ids and
    // break Business.ideaId links.
    const walked = walkSaveDoc(
      doc({ ideas: [{ fields: { productName: "First" } }, "MALFORMED", { fields: { productName: "Third" } }] })
    );
    expect(walked.ideas.map((i) => i.index)).toEqual([0, 1, 2]);
    expect(walked.ideas.map((i) => i.label)).toEqual(["First", null, "Third"]);
    expect(walked.ideas[1]).toEqual({
      index: 1,
      id: null,
      label: null,
      done: {},
      doneAt: {},
      doneByTask: {},
      doneAtByTask: {},
    });
  });

  it("a business linking to a PLACEHOLDER's minted legacy id still resolves", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "real" }, 42], businesses: [{ id: "b", ideaId: "legacy-idea-1" }] })
    );
    // The client mints `legacy-idea-{index}` for every id-less idea; the
    // placeholder at index 1 is exactly the row that id belongs to.
    const placeholder = walked.ideas.find((i) => i.id === null);
    expect(placeholder!.index).toBe(1);
    expect(`legacy-idea-${placeholder!.index}`).toBe(walked.businesses[0]!.ideaId);
  });

  it("multiple malformed entries keep every entry's absolute position", () => {
    const walked = walkSaveDoc(doc({ ideas: [1, { id: "a" }, "x", null, { id: "b" }, [], { id: "c" }] }));
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      [null, 0],
      ["a", 1],
      [null, 2],
      [null, 3],
      ["b", 4],
      [null, 5],
      ["c", 6],
    ]);
  });

  it("SPARSE array holes are skipped (matching the client's .map), indices preserved", () => {
    // jsonb arrays have no holes; this pins the JS-side semantics so a future
    // refactor cannot silently start emitting placeholders for them.
    const sparse: unknown[] = [];
    sparse[2] = { id: "a" };
    sparse[5] = { id: "b" };
    const walked = walkSaveDoc(doc({ ideas: sparse }));
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      ["a", 2],
      ["b", 5],
    ]);
  });

  it("duplicate ids are BOTH kept, distinguished by index (never merged or dropped)", () => {
    const walked = walkSaveDoc(doc({ ideas: [{ id: "dup" }, { id: "dup" }] }));
    expect(walked.ideas.map((i) => i.index)).toEqual([0, 1]);
  });
});

describe("progress rules — walkSaveDoc: businesses", () => {
  it("a business without ideaId is INCLUDED with ideaId null", () => {
    const walked = walkSaveDoc(doc({ businesses: [{ id: "biz-1", doneByTask: { "4.1.1": true } }] }));
    expect(walked.businesses).toEqual([
      { id: "biz-1", ideaId: null, archived: false, doneByTask: { "4.1.1": true }, doneAtByTask: {} },
    ]);
  });

  it("a DANGLING ideaId is preserved UNRESOLVED — the client handles the lookup miss", () => {
    const walked = walkSaveDoc(
      doc({ ideas: [{ id: "idea-1" }], businesses: [{ id: "biz-1", ideaId: "idea-gone" }] })
    );
    expect(walked.businesses[0]!.ideaId).toBe("idea-gone");
  });

  it("non-string / empty ideaId reads as null", () => {
    const walked = walkSaveDoc(
      doc({ businesses: [{ id: "b1", ideaId: 7 }, { id: "b2", ideaId: "" }, { id: "b3", ideaId: null }] })
    );
    expect(walked.businesses.map((b) => b.ideaId)).toEqual([null, null, null]);
  });

  it("archived is narrowed to an EXPLICIT true — nothing else is truthy enough", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          { id: "a", archived: true },
          { id: "b", archived: false },
          { id: "c" },
          { id: "d", archived: "true" },
          { id: "e", archived: 1 },
        ],
      })
    );
    expect(walked.businesses.map((b) => b.archived)).toEqual([true, false, false, false, false]);
  });

  it("a DUPLICATE business id keeps the FIRST occurrence — a later empty twin cannot zero progress", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          { id: "b1", ideaId: "i-1", doneByTask: { "4.1.1": true }, doneAtByTask: { "4.1.1": 5 } },
          { id: "b1" },
        ],
      })
    );
    expect(walked.businesses).toEqual([
      { id: "b1", ideaId: "i-1", archived: false, doneByTask: { "4.1.1": true }, doneAtByTask: { "4.1.1": 5 } },
    ]);
  });

  it("businesses that is not an array, or an entry that is not an object, is skipped", () => {
    expect(walkSaveDoc(doc({ businesses: "nope" })).businesses).toEqual([]);
    expect(walkSaveDoc(doc({ businesses: [null, 1, "x", []] })).businesses).toEqual([]);
  });

  it("an entry with no usable id is dropped (the client keys rows by id)", () => {
    const walked = walkSaveDoc(doc({ businesses: [{ ideaId: "idea-1" }, { id: "" }, { id: "keep" }] }));
    expect(walked.businesses.map((b) => b.id)).toEqual(["keep"]);
  });

  it("business map values are narrowed exactly like the idea maps", () => {
    const walked = walkSaveDoc(
      doc({
        businesses: [
          {
            id: "b",
            doneByTask: { ok: true, bad: "true" },
            doneAtByTask: { ok: 5, bad: -5, worse: "5", huge: 1e16 },
          },
        ],
      })
    );
    expect(walked.businesses[0]!.doneByTask).toEqual({ ok: true });
    expect(walked.businesses[0]!.doneAtByTask).toEqual({ ok: 5 });
  });
});

/* ------------------------------------------------------------------- caps */

describe("progress rules — output caps (the amplification fuse)", () => {
  it("pins every cap constant", () => {
    expect(PROGRESS_IDEAS_CAP).toBe(50);
    expect(PROGRESS_BUSINESSES_CAP).toBe(50);
    expect(PROGRESS_MAP_ENTRIES_CAP).toBe(500);
    expect(PROGRESS_LABEL_MAX_CHARS).toBe(200);
    expect(PROGRESS_MAX_TIMESTAMP_MS).toBe(8.64e15);
  });

  it("caps ideas and FLAGS the child — the first N entries, original indices intact", () => {
    const ideas = Array.from({ length: PROGRESS_IDEAS_CAP + 25 }, (_, i) => ({ id: `i-${i}` }));
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(true);
    expect(walked.ideas.map((i) => i.index)).toEqual(
      Array.from({ length: PROGRESS_IDEAS_CAP }, (_, i) => i)
    );
    expect(walked.ideas.at(-1)!.id).toBe(`i-${PROGRESS_IDEAS_CAP - 1}`);
  });

  it("truncation does NOT renumber: malformed entries before the cap keep the index space honest", () => {
    // Leading malformed entries become placeholders, so slot N still reports
    // index N — the client's legacy-id minting stays aligned.
    const ideas: unknown[] = ["bad", "bad", ...Array.from({ length: 100 }, (_, i) => ({ id: `i-${i}` }))];
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.ideas[0]!.index).toBe(0);
    expect(walked.ideas[2]!.index).toBe(2);
    expect(walked.ideas[2]!.id).toBe("i-0");
    expect(walked.ideas.at(-1)!.index).toBe(PROGRESS_IDEAS_CAP - 1);
  });

  it("exactly at the ideas cap does not flag", () => {
    const ideas = Array.from({ length: PROGRESS_IDEAS_CAP }, (_, i) => ({ id: `i-${i}` }));
    const walked = walkSaveDoc(doc({ ideas }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(false);
  });

  it("caps businesses and flags", () => {
    const businesses = Array.from({ length: PROGRESS_BUSINESSES_CAP + 10 }, (_, i) => ({ id: `b-${i}` }));
    const walked = walkSaveDoc(doc({ businesses }));
    expect(walked.businesses).toHaveLength(PROGRESS_BUSINESSES_CAP);
    expect(walked.truncated).toBe(true);
  });

  it("caps map entries per map and flags", () => {
    const big: Record<string, boolean> = {};
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) big[`k-${i}`] = true;
    const walked = walkSaveDoc(doc({ ideas: [{ id: "i", doneByTask: big }] }));
    expect(Object.keys(walked.ideas[0]!.doneByTask)).toHaveLength(PROGRESS_MAP_ENTRIES_CAP);
    expect(walked.truncated).toBe(true);
  });

  it("the 31x amplification case is bounded: a huge all-{} ideas array yields a small payload", () => {
    const walked = walkSaveDoc(doc({ ideas: Array.from({ length: 20_000 }, () => ({})) }));
    expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
    expect(walked.truncated).toBe(true);
    expect(JSON.stringify(walked).length).toBeLessThan(20_000);
  });

  it("shapeProgress surfaces truncation on the affected child only", () => {
    const children = [child({ id: "c-1", fp_username: "big" }), child({ id: "c-2", fp_username: "small" })];
    const profiles = [
      { id: "p-1", child_id: "c-1" },
      { id: "p-2", child_id: "c-2" },
    ];
    const saves = [
      { profile_id: "p-1", doc: doc({ ideas: Array.from({ length: 200 }, () => ({})) }) },
      { profile_id: "p-2", doc: wellFormedDoc },
    ];
    const rows = shapeProgress(children, profiles, saves, NOW);
    expect(rows.map((r) => [r.username, r.truncated])).toEqual([
      ["big", true],
      ["small", false],
    ]);
  });

  it("a walk that hits no cap reports truncated false (the EMPTY_WALK baseline)", () => {
    expect(walkSaveDoc(doc({}))).toEqual(EMPTY_WALK);
  });
});

/* -------------------------------------------------------------- module purity */

describe("progress rules — module purity", () => {
  it("imports nothing from next or @supabase, and no server-only side-effect import", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "app/api/fp/progress/progress-rules.ts"),
      "utf8"
    );
    // BOTH forms: `from "x"` misses a bare side-effect `import "x"` — including
    // `import "server-only"`, the very specifier this test asserts against.
    const imports = [...src.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec.startsWith("next"), spec).toBe(false);
      expect(spec.startsWith("@supabase"), spec).toBe(false);
      expect(spec === "server-only", spec).toBe(false);
    }
    expect(imports.length).toBeGreaterThan(0);
  });
});
