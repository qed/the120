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
 * Staff ops (FW Unit 5) — the same affordances as /path/fw/ops:
 *
 *   npm run fw -- cohorts       [--json]
 *   npm run fw -- cohort-create --slug boston-2026-08 \
 *                               --start 2026-08-21 --start-time 09:00 \
 *                               --end   2026-08-23 --end-time   17:00 \
 *                               --tz    America/New_York [--json]
 *   npm run fw -- token-mint    --cohort <uuid> [--force] [--json]
 *   npm run fw -- token-revoke  --cohort <uuid> [--json]
 *   npm run fw -- board         --cohort <uuid> [--json]
 *   npm run fw -- guides        --cohort <uuid> [--json]
 *   npm run fw -- guide-add     --cohort <uuid> --email guide@example.com [--json]
 *   npm run fw -- guide-reissue --guide <uuid> [--json]
 *   npm run fw -- guide-revoke  --cohort <uuid> --guide <uuid> [--json]
 *
 * Staff ops COMPLETENESS (FW Unit 5b) — the two deferred surfaces + PROPOSED-1:
 *
 *   npm run fw -- students       --cohort <uuid> [--json]
 *   npm run fw -- rejects        --cohort <uuid> [--all] [--json]
 *   npm run fw -- reject-resolve --cohort <uuid> --reject <uuid> [--json]
 *   npm run fw -- anonymize      --cohort <uuid> --student <uuid> \
 *                                --confirm-name "Maya Chen" [--json]
 *   npm run fw -- match          --cohort <uuid> --first Maya --last Chen [--json]
 *   npm run fw -- link           --cohort <uuid> --student <uuid> [--json]
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
import { sendEmail } from "../app/lib/email";
import { SITE_URL } from "../app/lib/site";
import { narrowFwBand } from "../app/path/lib/fw-provision-rules";
import { runFwCheckIn } from "../app/path/lib/fw-checkin-core";
import { issueFwGuideInvite, provisionFwGuide } from "../app/path/lib/fw-guide-core";
import { buildFwGuideInviteEmail } from "../app/path/lib/fw-guide-invite-email";
import { assertNoAuthMailToFwStudent } from "../app/path/lib/fw-provision-rules";
import { loadFwBoard } from "../app/path/lib/fw-board-loader";
import { loadFwCohortRoster, loadFwStudentDrilldown } from "../app/path/lib/fw-loader";
import {
  anonymizeFwStudent,
  createFwCohort,
  linkFwStudentToCohort,
  listFwCohortGuides,
  listFwOpsCohorts,
  listFwOpsStudents,
  listFwReplayRejects,
  loadFwMatchResolution,
  loadFwOpsBoardToken,
  mintFwBoardToken,
  resolveFwReplayReject,
  revokeFwBoardToken,
  revokeFwGuideGrant,
} from "../app/path/lib/fw-ops-core";
import {
  fwCohortWindowFromLocal,
  fwReplayRejectReasonCopy,
  normalizeFwCohortSlug,
} from "../app/path/lib/fw-ops-rules";
import { isFwAction } from "../app/path/lib/fw-rules";
import { runFwQuickCreate } from "../app/path/lib/fw-student-core";

const COMMANDS = [
  "roster",
  "student",
  "checkin",
  "create",
  "cohorts",
  "cohort-create",
  "token-mint",
  "token-revoke",
  "board",
  "guides",
  "guide-add",
  "guide-reissue",
  "guide-revoke",
  "students",
  "rejects",
  "reject-resolve",
  "anonymize",
  "match",
  "link",
] as const;
type Command = (typeof COMMANDS)[number];

/**
 * Flags scoped PER COMMAND, not one global list (cli-readiness review).
 *
 * A single flat allowlist made `roster --cohort X --email foo@bar` legal: it
 * passed validation, nothing read `--email`, and the command quietly did less
 * than the operator asked. With seventeen flags across eleven commands and no
 * per-command help, mis-targeting one is the likely mistake, and a silent no-op
 * is the worst possible response to it.
 *
 * `--actor` and `--json` are genuinely global: every write attributes itself,
 * and every command can emit JSON.
 */
const GLOBAL_FLAGS = ["--actor", "--json"];

const COMMAND_FLAGS: Record<Command, string[]> = {
  roster: ["--cohort"],
  student: ["--cohort", "--student"],
  checkin: ["--cohort", "--student", "--task", "--action"],
  create: ["--cohort", "--first", "--last", "--band"],
  cohorts: [],
  "cohort-create": ["--slug", "--start", "--start-time", "--end", "--end-time", "--tz"],
  "token-mint": ["--cohort", "--force"],
  "token-revoke": ["--cohort"],
  board: ["--cohort"],
  guides: ["--cohort"],
  "guide-add": ["--cohort", "--email"],
  "guide-reissue": ["--guide"],
  "guide-revoke": ["--cohort", "--guide"],
  students: ["--cohort"],
  rejects: ["--cohort", "--all"],
  "reject-resolve": ["--cohort", "--reject"],
  anonymize: ["--cohort", "--student", "--confirm-name", "--force"],
  match: ["--cohort", "--first", "--last"],
  link: ["--cohort", "--student"],
};

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

function assertKnownFlags(command: Command): void {
  const allowed = [...GLOBAL_FLAGS, ...COMMAND_FLAGS[command]];
  const unknown = process.argv.slice(3).filter((a) => a.startsWith("--") && !allowed.includes(a));
  if (unknown.length > 0) {
    throw new Error(
      `unrecognized flag(s) for "${command}": ${unknown.join(", ")}. ` +
        `${command} accepts: ${allowed.join(", ")}`
    );
  }
}

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    // Names each command WITH its flags: the header comment is this script's
    // only prose documentation, and an operator (or an agent) who got the
    // command wrong should not have to open the source to learn the shape.
    const usage = COMMANDS.map(
      (c) => `  ${c}${COMMAND_FLAGS[c].length > 0 ? " " + COMMAND_FLAGS[c].join(" ") : ""}`
    ).join("\n");
    throw new Error(
      `usage: npm run fw -- <command> [flags]\n\n${usage}\n\n` +
        `every command also accepts ${GLOBAL_FLAGS.join(" ")}`
    );
  }
  assertKnownFlags(command);
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

  /* ───────────────────────────────────────────── staff ops (FW Unit 5) ── */
  //
  // These drive the SAME cores the ops surface calls — createFwCohort,
  // mintFwBoardToken, provisionFwGuide, revokeFwGuideGrant — so an audit row
  // written here is indistinguishable from one written in a browser, and the
  // compensation on a failed mint is the same compensation. A second front door
  // to one implementation, never a parallel one.
  //
  // Authorization is possession of the service-role key, exactly as above; the
  // HTTP surface's `isFwStaffActor` gate has no session to resolve here.
  // `--actor` still attributes every write to a real staff row.

  if (command === "cohorts") {
    const res = await listFwOpsCohorts(db, { now: Date.now() });
    if (!res.ok) throw new Error("cohort list read failed");
    emit(res.cohorts, () => {
      console.log(`\n${res.cohorts.length} Founders Weekend cohort(s)\n`);
      for (const c of res.cohorts) {
        console.log(
          `  ${c.id}  ${c.slug}\n` +
            `      ${c.startsAt ?? "no start"} → ${c.endsAt ?? "no end"} (${c.timeZone ?? "no zone"})\n` +
            `      ${c.studentCount} students · ${c.guideCount} guides · board ${c.boardTokenStatus}`
        );
      }
    });
    return;
  }

  if (command === "cohort-create") {
    const slug = normalizeFwCohortSlug(required("slug"));
    if (slug === null) throw new Error("--slug must normalize to 3–60 characters");
    const window = fwCohortWindowFromLocal({
      startDate: required("start"),
      startTime: required("start-time"),
      endDate: required("end"),
      endTime: required("end-time"),
      timeZone: required("tz"),
    });
    if (!window.ok) throw new Error(`window: ${window.reason}`);

    const res = await createFwCohort(db, {
      slug,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      timeZone: required("tz"),
      createdBy: await resolveActor(),
    });
    if (!res.ok) throw new Error(`cohort-create failed: ${res.reason}`);
    emit({ ...res, startsAt: window.startsAt, endsAt: window.endsAt }, () =>
      console.log(
        `\ncreated ${res.slug} (${res.cohortId})\n  ${window.startsAt} → ${window.endsAt}`
      )
    );
    return;
  }

  if (command === "token-mint") {
    const cohortId = required("cohort");
    // The ops surface makes staff confirm before replacing a LIVE link, because
    // the projector goes blank until the new URL is entered. The CLI had no
    // equivalent: one command, and a room's board was dark. `--force` is that
    // confirm. It also gives an agent a safe retry story — a re-run after an
    // ambiguous failure refuses instead of silently killing a token nobody
    // captured (the raw value is shown once and never again).
    const current = await loadFwOpsBoardToken(db, { cohortId, now: Date.now() });
    if (current.ok && current.token.status === "live" && !process.argv.includes("--force")) {
      throw new Error(
        `${cohortId} already has a LIVE board link (expires ${current.token.expiresAt}). ` +
          `Minting a new one kills it and blanks any projector showing it. ` +
          `Re-run with --force if that is what you want.`
      );
    }
    const res = await mintFwBoardToken(db, {
      cohortId,
      actorUserId: await resolveActor(),
      now: Date.now(),
    });
    if (!res.ok) throw new Error(`token-mint failed: ${res.reason}`);
    // The raw token is printed ONCE and never stored. `--json` carries the
    // ASSEMBLED URL as well as the bare token, so an agent does not have to know
    // the route shape to hand somebody something they can paste.
    const boardUrl = `${SITE_URL}/path/fw/board/${res.token}`;
    emit({ ...res, url: boardUrl }, () => {
      if (res.revokedPrior) {
        console.log("\n⚠  The previous board link is now DEAD. Any projector showing it is blank.");
      }
      console.log(`\n${boardUrl}\n  expires ${res.expiresAt}`);
      console.log("  Only a hash is stored — this cannot be shown again.");
    });
    return;
  }

  if (command === "token-revoke") {
    const cohortId = required("cohort");
    const res = await revokeFwBoardToken(db, {
      cohortId,
      actorUserId: await resolveActor(),
      now: Date.now(),
    });
    if (!res.ok) throw new Error(`token-revoke: ${res.reason}`);
    emit(res, () => console.log(`\nboard link revoked for ${cohortId}`));
    return;
  }

  if (command === "board") {
    // The board's READ MODEL to a terminal — the SAME `loadFwBoard` the projector
    // feed serves, driven directly against the db (no token, no HTTP, works
    // offline against `.env.local`). This is the read path the agent-native review
    // found missing: every other FW read surface has a CLI, and re-inspecting board
    // state otherwise meant `token-mint --force`, which KILLS the live projector.
    const cohortId = required("cohort");
    const res = await loadFwBoard(db, { cohortId });
    if (!res.ok) throw new Error(`board read failed for ${cohortId}`);
    const m = res.data.model;
    emit(res.data, () => {
      console.log(`\n${res.data.cohortSlug} — weekend board`);
      console.log(`  weekend XP: ${m.weekendXp}    🔔 first dollars: ${m.firstDollarCount}`);
      console.log(
        `  students: ${m.rollups.students}   checkmarks: ${m.rollups.checkmarks}   not-yets: ${m.rollups.notYets}`
      );
      console.log(`  celebrations standing: ${m.celebrations.length}`);
      console.log(`\n  ticker (${m.ticker.length}):`);
      for (const line of m.ticker) {
        const mark = line.firstDollar ? "🔔" : line.kind === "verified" ? "✓" : "…";
        console.log(`    ${mark} ${line.displayName}  ${line.label}`);
      }
    });
    return;
  }

  if (command === "guides") {
    const cohortId = required("cohort");
    const [guides, token] = await Promise.all([
      listFwCohortGuides(db, { cohortId, now: Date.now() }),
      loadFwOpsBoardToken(db, { cohortId, now: Date.now() }),
    ]);
    if (!guides.ok) throw new Error(`guide list read failed for ${cohortId}`);
    emit({ guides: guides.guides, board: token.ok ? token.token : null }, () => {
      console.log(`\n${guides.guides.length} guide(s) on ${cohortId}`);
      console.log(`board: ${token.ok ? token.token.status : "unreadable"}\n`);
      for (const g of guides.guides) {
        console.log(`  ${g.userId}  ${g.email ?? "(unnamed)"} — ${g.credential}`);
      }
    });
    // The pre-event checklist's "all guides claimed" line, as an exit code —
    // and a stderr line saying so, because a bare exit 1 is indistinguishable
    // from a genuine failure to anything scripting this.
    const unclaimed = guides.guides.filter((g) => g.credential !== "claimed");
    if (unclaimed.length > 0) {
      console.error(
        `[fw] ${unclaimed.length} of ${guides.guides.length} guide(s) have not claimed their link (exit 1)`
      );
      process.exitCode = 1;
    }
    return;
  }

  if (command === "guide-add") {
    const res = await provisionFwGuide(db, {
      email: required("email"),
      cohortId: required("cohort"),
      createdBy: await resolveActor(),
    });
    if (!res.ok) throw new Error(`guide-add failed: ${res.reason}`);
    // `inviteEmailed` is in the JSON, not only in the human line: an agent
    // reading structured output would otherwise report a guide as onboarded
    // when they still cannot sign in.
    emit({ ...res, inviteEmailed: false }, () => {
      console.log(`\n${res.email} (${res.userId})`);
      console.log(`  account ${res.created ? "created" : "adopted"}, grant ${res.grantAdded ? "added" : "already present"}`);
      if (!res.audited) console.log("  ⚠  the audit record did NOT save");
      // Deliberately does NOT mail the invite: the invite email is the ACTION
      // layer's step (provisionGuideAction), and a script that silently mailed a
      // password-setting link would be a second, untested mail path. Use the ops
      // surface, or `issueFwGuideInvite` directly, when a link is wanted.
      console.log("  no invite emailed — use the ops surface to send their link");
    });
    return;
  }

  if (command === "guide-reissue") {
    // Decision 12's Friday-morning recovery, and the ONE ops affordance the CLI
    // was missing (agent-native review): an operator or agent driving this tool
    // could create weekends, mint boards and revoke access, but could not get a
    // working credential into a guide's hands — the exact thing a dead link on
    // an event morning needs. `guide-add` deliberately does not mail (a first
    // provision should not silently send a password-setting link); THIS is the
    // deliberate, explicit send, mirroring reissueGuideInviteAction.
    const userId = required("guide");
    const issued = await issueFwGuideInvite(db, {
      userId,
      createdBy: await resolveActor(),
      now: Date.now(),
      // Rotates unconditionally and re-opens the claim — that IS the recovery.
      mode: "reissue",
    });
    if (!issued.ok) throw new Error(`guide-reissue failed: ${issued.reason}`);
    if (!issued.issued) throw new Error("guide-reissue did not mint a token");

    // The same no-auth-mail choke-point the action passes through. A guide
    // address is one typo from the dormant minors' namespace.
    assertNoAuthMailToFwStudent(issued.email, "fw guide invite (cli)");
    const built = buildFwGuideInviteEmail({ token: issued.token });
    const sent = await sendEmail({
      to: issued.email,
      subject: built.subject,
      html: built.html,
      text: built.text,
    });
    // A send failure IS a failure here, unlike provisioning: the whole point of
    // the command is putting a working link in the guide's inbox, and their old
    // link is already dead by now.
    if (!sent.ok) {
      throw new Error(
        `the link was minted but the email did NOT send to ${issued.email}: ${sent.error ?? "unknown"} — their previous link is already dead, so re-run this`
      );
    }
    emit(
      { ok: true, userId, email: issued.email, expiresAt: issued.expiresAt, emailed: true },
      () => {
        console.log(`
fresh link emailed to ${issued.email}`);
        console.log(`  expires ${issued.expiresAt}`);
        console.log("  their previous link is now dead");
      }
    );
    return;
  }

  if (command === "guide-revoke") {
    const res = await revokeFwGuideGrant(db, {
      cohortId: required("cohort"),
      userId: required("guide"),
      actorUserId: await resolveActor(),
    });
    if (!res.ok) throw new Error(`guide-revoke failed: ${res.reason}`);
    emit(res, () => {
      console.log(`\naccess removed for ${required("guide")} on ${required("cohort")}`);
      if (!res.audited) console.log("  ⚠  the audit record did NOT save");
    });
    return;
  }

  /* ─────────────────────────────────────── staff ops COMPLETENESS (Unit 5b) ── */
  // Same second-front-door-to-one-core posture: `anonymize` drives the SAME
  // anonymizeFwStudent the ops surface calls, with the SAME typed-confirm
  // verification and the SAME audit row. A student anonymized here is
  // indistinguishable from one anonymized in a browser. The anonymize CORE is
  // verifiable this way against the rehearsal-unit4 students; only the SURFACE
  // render needs a bridge session.

  if (command === "students") {
    const cohortId = required("cohort");
    const res = await listFwOpsStudents(db, { cohortId });
    if (!res.ok) throw new Error(`student roster read failed for ${cohortId}`);
    emit(res.students, () => {
      console.log(`\n${res.students.length} student(s) in ${cohortId}\n`);
      for (const s of res.students) {
        const flags = [
          s.anonymized ? "ANONYMIZED" : null,
          s.openRejects > 0 ? `${s.openRejects} open reject(s)` : null,
        ].filter(Boolean);
        console.log(
          `  ${s.studentId}  ${s.firstName} ${s.lastName} (${s.band})${flags.length ? " — " + flags.join(", ") : ""}`
        );
      }
    });
    return;
  }

  if (command === "rejects") {
    const cohortId = required("cohort");
    const includeResolved = process.argv.includes("--all");
    const res = await listFwReplayRejects(db, { cohortId, includeResolved });
    if (!res.ok) throw new Error(`reject list read failed for ${cohortId}`);
    emit(res.rejects, () => {
      console.log(
        `\n${res.rejects.length} ${includeResolved ? "" : "open "}replay reject(s) on ${cohortId}\n`
      );
      for (const r of res.rejects) {
        const status = r.resolvedAt ? `resolved ${r.resolvedAt}` : "OPEN";
        console.log(
          `  ${r.id}  ${r.studentName ?? "(unnamed)"} · ${r.taskId} · ${r.action} — ${status}\n` +
            `      ${fwReplayRejectReasonCopy(r.reason)}`
        );
      }
    });
    return;
  }

  if (command === "reject-resolve") {
    const cohortId = required("cohort");
    const res = await resolveFwReplayReject(db, {
      rejectId: required("reject"),
      cohortId,
      actorUserId: await resolveActor(),
      now: Date.now(),
    });
    if (!res.ok) throw new Error(`reject-resolve: ${res.reason}`);
    emit(res, () => console.log(`\nreject ${required("reject")} resolved`));
    return;
  }

  if (command === "anonymize") {
    const cohortId = required("cohort");
    const studentId = required("student");
    // TWO gates, because anonymize is IRREVERSIBLE (cli-readiness review):
    //   --confirm-name is the informational check (verified server-side against
    //     the stored name — a wrong id typed with a wrong name refuses), but an
    //     agent can read that name straight out of `students --json`, so it is
    //     not friction on its own;
    //   --force is the deliberate "I intend to run a destructive, irreversible
    //     action" acknowledgment that is NOT reproducible from a prior read —
    //     the same posture `token-mint --force` already uses in this file.
    if (!process.argv.includes("--force")) {
      throw new Error(
        `anonymize is IRREVERSIBLE — it erases a student's name and retires their address ` +
          `permanently. Re-run with --force once you are sure of the student id.`
      );
    }
    // The typed confirm — the child's own name, verified server-side against the
    // stored record.
    const res = await anonymizeFwStudent(db, {
      studentId,
      cohortId,
      actorUserId: await resolveActor(),
      confirmName: required("confirm-name"),
    });
    if (!res.ok) throw new Error(`anonymize failed: ${res.reason}`);
    emit(res, () => {
      console.log(
        res.alreadyAnonymized
          ? `\n${studentId} was already anonymized`
          : `\n${studentId} anonymized — name tombstoned, address released, audit written`
      );
      if (!res.audited) console.log("  ⚠  the audit record did NOT save");
      if (res.openRejects > 0) {
        console.log(
          `  ⚠  ${res.openRejects} unresolved replay reject(s) still point at this student — resolve them`
        );
      }
    });
    return;
  }

  if (command === "match") {
    const cohortId = required("cohort");
    const res = await loadFwMatchResolution(db, {
      cohortId,
      firstName: required("first"),
      lastName: required("last"),
    });
    if (!res.ok) throw new Error(`match lookup failed for ${cohortId}`);
    if (res.kind === "invalid_name") {
      emit({ kind: "invalid_name" }, () => console.log("\nthat name cannot be looked up — retype it"));
      return;
    }
    emit({ kind: "matches", entries: res.entries }, () => {
      console.log(`\n${res.entries.length} existing student(s) named "${required("first")} ${required("last")}"\n`);
      for (const e of res.entries) {
        const where = e.memberships.map((m) => m.slug).join(", ") || "no cohorts";
        console.log(
          `  ${e.profileId}  ${e.firstName} ${e.lastName} (${e.band}) — ${where}` +
            (e.inActiveCohort ? " · already in this weekend" : "")
        );
      }
      if (res.entries.length === 0) console.log("  none — this is a new student");
    });
    return;
  }

  if (command === "link") {
    const cohortId = required("cohort");
    const studentId = required("student");
    const res = await linkFwStudentToCohort(db, { studentId, cohortId });
    if (!res.ok) throw new Error(`link failed: ${res.reason}`);
    emit(res, () =>
      console.log(
        res.alreadyMember
          ? `\n${studentId} is already in ${cohortId}`
          : `\n${studentId} linked into ${cohortId}`
      )
    );
    return;
  }

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
