/**
 * Seed a Founders Weekend REHEARSAL cohort (FW Unit 4 verification; the plan's
 * Unit 9 seeds a bigger one the same way).
 *
 *   npm run seed:fw-cohort -- --dry-run          # print the plan, write nothing
 *   npm run seed:fw-cohort -- --slug rehearsal-unit4 --count 30
 *
 * Machine-bound like `scripts/seed-staff.ts` and `provision-path-family.ts`:
 * `.env.local` carries the service-role key, so env-less machines and worktree
 * agents cannot run it.
 *
 * ── Why the names look like that
 *
 * Every seeded surname carries a `-Rehearsal` suffix, and that is a data-safety
 * decision rather than a label. FW addresses are NAME-DERIVED on a real,
 * deliverable domain and FW-D2 makes them a lasting contact channel for the
 * family (`maya.chen.fw@the120.school`). A rehearsal student called plainly
 * "Maya Chen" would take that address permanently — and the real Maya Chen who
 * walks into Boston would silently be given `maya.chen2.fw@`, with no record of
 * why. Worse, cleaning up afterwards means the Unit 5b anonymize path, which
 * writes the freed local part into `path_fw_released_aliases` FOREVER, so the
 * clean address would be burned rather than returned.
 *
 * The roster still exercises everything the surface has to survive: accents,
 * apostrophes, hyphens, a deliberate duplicate pair (the band-chip
 * disambiguator, G22), and near-miss prefixes (the search ranking).
 *
 * ── Idempotent
 *
 * Re-running adopts: each row is matched by normalized name through the SAME
 * PROPOSED-1 module the guide surface uses (`fw-match-rules`), so a second run
 * mints nothing and simply reports what is already there. Without that, a
 * re-run would mint `maya.chen-rehearsal2@…` and every name after it.
 */

import { createClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import type { Band } from "../app/path/content/types";
import { loadFwMatchCandidates } from "../app/path/lib/fw-loader";
import { fwMatchKey, matchFwStudent } from "../app/path/lib/fw-match-rules";
import { runFwQuickCreate } from "../app/path/lib/fw-student-core";

type SeedStudent = { firstName: string; lastName: string; band: Band };

/** 30 rehearsal students. Shapes chosen against the surface's own edge cases. */
const ROSTER: SeedStudent[] = [
  // The duplicate pair — two different children, same display name (G22).
  { firstName: "Maya", lastName: "Chen-Rehearsal", band: "g6_8" },
  { firstName: "Maya", lastName: "Chen-Rehearsal", band: "g9_12" },
  // Near-miss prefixes — "may" must offer Maya before Mayabelle.
  { firstName: "Mayabelle", lastName: "Ortiz-Rehearsal", band: "g3_5" },
  // Accents and elision marks: typed plain, must still be found.
  { firstName: "José", lastName: "Álvarez-Rehearsal", band: "g6_8" },
  { firstName: "Siobhán", lastName: "O'Brien-Rehearsal", band: "g9_12" },
  { firstName: "Jean-Luc", lastName: "Dubois-Rehearsal", band: "g6_8" },
  { firstName: "Björn", lastName: "Weiß-Rehearsal", band: "g9_12" },
  // The rest: ordinary names, spread across bands.
  { firstName: "Aaron", lastName: "Zeta-Rehearsal", band: "g3_5" },
  { firstName: "Priya", lastName: "Nair-Rehearsal", band: "g6_8" },
  { firstName: "Malik", lastName: "Johnson-Rehearsal", band: "g9_12" },
  { firstName: "Wren", lastName: "Kowalski-Rehearsal", band: "g3_5" },
  { firstName: "Theo", lastName: "Nakamura-Rehearsal", band: "g6_8" },
  { firstName: "Amara", lastName: "Okafor-Rehearsal", band: "g9_12" },
  { firstName: "Felix", lastName: "Moreau-Rehearsal", band: "g3_5" },
  { firstName: "Nadia", lastName: "Haddad-Rehearsal", band: "g6_8" },
  { firstName: "Owen", lastName: "Fitzgerald-Rehearsal", band: "g9_12" },
  { firstName: "Sana", lastName: "Iqbal-Rehearsal", band: "g3_5" },
  { firstName: "Diego", lastName: "Ramirez-Rehearsal", band: "g6_8" },
  { firstName: "Ingrid", lastName: "Larsen-Rehearsal", band: "g9_12" },
  { firstName: "Kofi", lastName: "Mensah-Rehearsal", band: "g3_5" },
  { firstName: "Lena", lastName: "Petrova-Rehearsal", band: "g6_8" },
  { firstName: "Hugo", lastName: "Silva-Rehearsal", band: "g9_12" },
  { firstName: "Aisha", lastName: "Rahman-Rehearsal", band: "g3_5" },
  { firstName: "Noah", lastName: "Bergstrom-Rehearsal", band: "g6_8" },
  { firstName: "Zara", lastName: "Ahmed-Rehearsal", band: "g9_12" },
  { firstName: "Emil", lastName: "Novak-Rehearsal", band: "g3_5" },
  { firstName: "Tessa", lastName: "Lindqvist-Rehearsal", band: "g6_8" },
  { firstName: "Caleb", lastName: "Wright-Rehearsal", band: "g9_12" },
  { firstName: "Yuki", lastName: "Tanaka-Rehearsal", band: "g3_5" },
  { firstName: "Rosa", lastName: "Delgado-Rehearsal", band: "g6_8" },
];

const FLAGS = ["--slug", "--count", "--dry-run"];

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Refuse an unrecognized flag rather than silently using a default. A typo like
 *  `--slugg` would otherwise seed the DEFAULT cohort — a silent wrong-target
 *  write, which is the worst possible failure for a script that mints permanent
 *  accounts (agent-native review). */
function assertKnownFlags(): void {
  const unknown = process.argv
    .slice(2)
    .filter((a) => a.startsWith("--") && !FLAGS.includes(a));
  if (unknown.length > 0) {
    throw new Error(`unrecognized flag(s): ${unknown.join(", ")}. Known: ${FLAGS.join(", ")}`);
  }
}

async function main() {
  assertKnownFlags();
  const dryRun = process.argv.includes("--dry-run");
  const slug = arg("slug", "rehearsal-unit4");
  // Parsed so that `--count 0` means zero (an empty cohort, useful for exercising
  // the multi-cohort switcher) rather than falling through to "all of them".
  const rawCount = arg("count", "");
  if (rawCount !== "" && !/^\d+$/.test(rawCount)) {
    // A malformed --count used to coerce to 0 and report a successful empty run.
    throw new Error(`--count must be a non-negative integer, got "${rawCount}"`);
  }
  const count = rawCount === "" ? ROSTER.length : Math.min(Number(rawCount), ROSTER.length);
  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  console.log(`\n[seed-fw] ${dryRun ? "DRY RUN — " : ""}cohort "${slug}", ${count} students`);

  // ── the cohort ───────────────────────────────────────────────────────────
  const existing = await db
    .from("path_cohorts")
    .select("id, slug, kind, starts_at, ends_at")
    .eq("slug", slug)
    .maybeSingle();
  if (existing.error) throw new Error(`cohort lookup failed: ${existing.error.message}`);

  let cohortId: string;
  if (existing.data) {
    if (existing.data.kind !== "fw") {
      throw new Error(
        `cohort "${slug}" exists with kind='${existing.data.kind}' — refusing to convert a Path cohort`
      );
    }
    // Fail-closed narrowing even here: the same rule the request path follows,
    // and this value decides which cohort 30 permanent accounts land in.
    if (typeof existing.data.id !== "string") throw new Error("cohort row has a malformed id");
    cohortId = existing.data.id;
    console.log(`[seed-fw] adopting existing fw cohort ${cohortId}`);
  } else if (dryRun) {
    console.log(`[seed-fw] would CREATE cohort "${slug}" (kind=fw)`);
    cohortId = "00000000-0000-0000-0000-000000000000";
  } else {
    // A rehearsal window that is unambiguously not a real event weekend.
    const created = await db
      .from("path_cohorts")
      .insert({
        slug,
        kind: "fw",
        starts_at: "2026-08-14T13:00:00Z",
        ends_at: "2026-08-16T23:00:00Z",
      })
      .select("id")
      .single();
    if (created.error || typeof created.data?.id !== "string") {
      throw new Error(`cohort insert failed: ${created.error?.message ?? "no id"}`);
    }
    cohortId = created.data.id;
    console.log(`[seed-fw] created cohort ${cohortId}`);
  }

  // ── the students ─────────────────────────────────────────────────────────
  // `notice_attested_by` needs a real auth user (FK to auth.users). The seeding
  // operator is the honest answer: they are the adult asserting these rehearsal
  // rows are legitimate, exactly as a guide asserts it at a table.
  const staff = await db.from("staff").select("id").eq("is_active", true).limit(1).maybeSingle();
  const attester = typeof staff.data?.id === "string" ? staff.data.id : null;
  if (attester === null && !dryRun) {
    throw new Error("no active staff row to attribute the notice attestation to");
  }

  let minted = 0;
  let adopted = 0;
  const failures: string[] = [];

  for (const student of ROSTER.slice(0, count)) {
    const label = `${student.firstName} ${student.lastName} (${student.band})`;

    // Dedupe through the SAME module the guide surface uses, so a re-run cannot
    // mint a suffixed twin — and so this script dogfoods PROPOSED-1.
    const key = fwMatchKey(student.firstName, student.lastName);
    if (key === null) {
      failures.push(`${label}: name is not keyable`);
      continue;
    }
    const candidates = await loadFwMatchCandidates(db, key);
    if (!candidates.ok) {
      failures.push(`${label}: match lookup failed`);
      continue;
    }
    const verdict = matchFwStudent({
      firstName: student.firstName,
      lastName: student.lastName,
      cohortId,
      candidates: candidates.candidates,
    });
    // Keyed by (name, BAND), not by a bare count. The duplicate pair in this
    // roster shares a name and differs only by band, so a count comparison could
    // report a label as "already here" while that label's specific band variant
    // had never been created — or mint the wrong variant — across re-runs with a
    // different --count (correctness review). Since this script mints permanent
    // name-derived addresses, a mis-mint needs the Unit 5b anonymize path to undo.
    const wantedOfBand = ROSTER.slice(0, count).filter(
      (r) => fwMatchKey(r.firstName, r.lastName) === key && r.band === student.band
    ).length;
    const hereOfBand =
      verdict.kind === "same_cohort"
        ? verdict.matches.filter((m) => m.band === student.band).length
        : 0;
    if (hereOfBand >= wantedOfBand) {
      adopted += 1;
      console.log(`[seed-fw] · ${label} — already on this cohort`);
      continue;
    }

    if (dryRun) {
      console.log(`[seed-fw] would MINT ${label}`);
      minted += 1;
      continue;
    }

    const res = await runFwQuickCreate(db, {
      firstName: student.firstName,
      lastName: student.lastName,
      band: student.band,
      cohortId,
      // Narrowed by the guard above, not cast past it.
      actorUserId: attester ?? "",
      noticeAttested: true,
    });
    if (res.ok) {
      minted += 1;
      console.log(`[seed-fw] ✓ ${label} → ${res.studentId}`);
    } else {
      failures.push(`${label}: ${res.reason}${res.leg ? ` (leg ${res.leg})` : ""}`);
      console.error(`[seed-fw] ✗ ${label}: ${res.reason}`);
    }
  }

  console.log(
    `\n[seed-fw] done — ${minted} ${dryRun ? "would be minted" : "minted"}, ${adopted} already present, ${failures.length} failed`
  );
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ! ${f}`);
    process.exitCode = 1;
  }
  if (!dryRun) {
    console.log(`\n[seed-fw] open: /path/fw/cohort/${cohortId}`);
  }
}

main().catch((e) => {
  console.error("[seed-fw] failed:", e);
  process.exit(1);
});
