/**
 * Terminal access to the Founders Weekend surface (FW Unit 4; agent-native
 * review). Machine-bound like the other FW scripts — `.env.local` carries the
 * service-role key.
 *
 *   npm run fw -- roster    --cohort <uuid> [--json]
 *   npm run fw -- student   --cohort <uuid> --student <uuid> [--json]
 *   npm run fw -- checkin   --cohort <uuid> --task 1.2.4 --action checkmark \
 *                           --student <uuid> [--student <uuid> …] [--json]
 *   npm run fw -- create    --cohort <uuid> --first Maya --last Chen --band g6_8 [--json]
 *
 * ── Why this exists
 *
 * The whole read and write path is deliberately built as plain, `db`-first
 * modules so a `tsx` script can drive it without going through React — every
 * one of those modules says so in its own header. Until this file, that claim
 * had exactly two consumers (the two seed scripts), and the three capabilities
 * an operator actually needs mid-event — record a check-in, add one walk-in,
 * see what a cohort or a student currently looks like — were reachable ONLY by
 * opening a browser and tapping. That is the gap the agent-native review found:
 * the architecture was right and the tooling was missing.
 *
 * ── The write paths here are the REAL ones
 *
 * `checkin` calls `runFwCheckIn` and `create` calls `runFwQuickCreate` — the
 * same functions the Server Actions call, with the same decision table, the same
 * leg verification, and the same per-tap client ids. This is a second front door
 * to one implementation, never a parallel one; a bug fixed in the surface is
 * fixed here, and a check-in recorded here is indistinguishable from a guide's.
 *
 * ── What it deliberately does NOT do
 *
 * There is no authorization here beyond holding the service-role key, because
 * there is no session to resolve — `resolveFwActorForCohort` gates the HTTP
 * surface, and possession of `.env.local` is the gate on this one. `--actor`
 * defaults to the first active staff row so every write is still attributed to
 * a real person rather than to nobody.
 */

import { createClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import { narrowFwBand } from "../app/path/lib/fw-provision-rules";
import { runFwCheckIn } from "../app/path/lib/fw-checkin-core";
import { loadFwCohortRoster, loadFwStudentDrilldown } from "../app/path/lib/fw-loader";
import { isFwAction } from "../app/path/lib/fw-rules";
import { runFwQuickCreate } from "../app/path/lib/fw-student-core";

const COMMANDS = ["roster", "student", "checkin", "create"] as const;
type Command = (typeof COMMANDS)[number];

const FLAGS = [
  "--cohort",
  "--student",
  "--task",
  "--action",
  "--first",
  "--last",
  "--band",
  "--actor",
  "--json",
];

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Every value for a repeatable flag — `--student` is passed once per student
 *  in a batch, mirroring the picker's up-to-three selection. */
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

function required(name: string): string {
  const v = arg(name);
  if (v === null) throw new Error(`--${name} is required`);
  return v;
}

function assertKnownFlags(): void {
  const unknown = process.argv.slice(3).filter((a) => a.startsWith("--") && !FLAGS.includes(a));
  if (unknown.length > 0) {
    throw new Error(`unrecognized flag(s): ${unknown.join(", ")}. Known: ${FLAGS.join(", ")}`);
  }
}

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    throw new Error(`usage: npm run fw -- <${COMMANDS.join("|")}> [flags]`);
  }
  assertKnownFlags();
  const asJson = process.argv.includes("--json");

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  /** The adult a write is attributed to. Explicit `--actor`, else the first
   *  active staff row — never nobody. */
  const resolveActor = async (): Promise<string> => {
    const explicit = arg("actor");
    if (explicit) return explicit;
    const staff = await db.from("staff").select("id").eq("is_active", true).limit(1).maybeSingle();
    if (typeof staff.data?.id !== "string") {
      throw new Error("no --actor given and no active staff row to attribute this to");
    }
    return staff.data.id;
  };

  const emit = (value: unknown, human: () => void) => {
    if (asJson) console.log(JSON.stringify(value, null, 2));
    else human();
  };

  if (command === "roster") {
    const cohortId = required("cohort");
    const res = await loadFwCohortRoster(db, cohortId);
    if (!res.ok) throw new Error(`roster read failed for ${cohortId}`);
    emit(res.students, () => {
      console.log(`\n${res.students.length} students in ${cohortId}\n`);
      for (const s of res.students) {
        const chip = s.resume.furthestTaskId
          ? `${s.resume.verified} checked, ${s.resume.notYet} not yet, up to ${s.resume.furthestTaskId}`
          : "no taps yet";
        console.log(`  ${s.studentId}  ${s.firstName} ${s.lastName} (${s.band}) — ${chip}`);
      }
    });
    return;
  }

  if (command === "student") {
    const res = await loadFwStudentDrilldown(db, {
      cohortId: required("cohort"),
      studentId: required("student"),
    });
    if (!res.ok) throw new Error(`student read: ${res.reason}`);
    const decided = Object.entries(res.value.states).filter(
      ([, state]) => state === "verified" || state === "not_yet"
    );
    emit({ ...res.value, decided: Object.fromEntries(decided) }, () => {
      const { student } = res.value;
      console.log(`\n${student.firstName} ${student.lastName} (${student.band})`);
      console.log(`version ${res.value.programVersionId}, ${decided.length} decided task(s)\n`);
      for (const [taskId, state] of decided.sort()) console.log(`  ${taskId}  ${state}`);
    });
    return;
  }

  if (command === "checkin") {
    const action = required("action");
    if (!isFwAction(action)) {
      throw new Error(`--action must be one of checkmark, not_yet, undo (got "${action}")`);
    }
    const studentIds = args("student");
    if (studentIds.length === 0) throw new Error("at least one --student is required");

    const res = await runFwCheckIn(db, {
      actorUserId: await resolveActor(),
      cohortId: required("cohort"),
      taskId: required("task"),
      action,
      studentIds,
      // A client id per student per invocation, for the same reason the surface
      // mints one: `not_yet` is not idempotent, so a re-run after an ambiguous
      // failure must not append a phantom re-attempt event. A fresh invocation
      // is a fresh tap and deliberately gets fresh keys.
      clientIds: Object.fromEntries(studentIds.map((id) => [id, crypto.randomUUID()])),
      now: Date.now(),
    });
    if (!res.ok) throw new Error(`check-in failed: ${res.reason}`);
    emit(res, () => {
      console.log(`\naction ${res.actionId}`);
      for (const o of res.outcomes) console.log(`  ${o.studentId}  ${o.kind}`);
      if (res.firstDollar.length > 0) {
        console.log(`\n  FIRST DOLLAR: ${res.firstDollar.join(", ")} — ring the bell.`);
      }
    });
    // A partial batch is a designed, reported state — but an operator scripting
    // this needs a non-zero exit when any student did not land.
    if (res.outcomes.some((o) => o.kind === "failed" || o.kind === "skipped")) process.exitCode = 1;
    return;
  }

  // command === "create"
  const band = narrowFwBand(required("band"));
  if (band === null) throw new Error("--band must be one of g3_5, g6_8, g9_12");
  const res = await runFwQuickCreate(db, {
    firstName: required("first"),
    lastName: required("last"),
    band,
    cohortId: required("cohort"),
    actorUserId: await resolveActor(),
    // The operator running this IS asserting the notice was seen, exactly as a
    // guide does at the table — the column records who said so.
    noticeAttested: true,
  });
  if (!res.ok) {
    throw new Error(
      `create failed: ${res.reason}${res.leg ? ` (leg ${res.leg})` : ""}` +
        (res.retryProfileId ? ` — retry with the same command to finish ${res.retryProfileId}` : "")
    );
  }
  emit(res, () => console.log(`\ncreated ${res.studentId} (adopted: ${res.adopted})`));
}

main().catch((e) => {
  console.error("[fw]", e instanceof Error ? e.message : e);
  process.exit(1);
});
