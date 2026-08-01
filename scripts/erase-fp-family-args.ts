/**
 * Pure argument parsing + guard logic for the R28 family-erasure script
 * (`scripts/erase-fp-family.ts`). Extracted so the fail-closed decision — dry-run
 * vs. a confirmed real erase — is unit-testable WITHOUT a DB, a service-role key,
 * or the real `eraseFamily` effects. NO side-effecting imports live here (only a
 * type-only import of `EraseFamilyInput`), so the test never pulls in
 * provision-deps / supabaseAdmin / googleapis.
 *
 * The one property that matters: a destructive erase is reachable ONLY when the
 * operator RE-STATES the exact target parent-user-id via `--confirm <id>` (or
 * `R28_CONFIRM=erase` alongside a matching `--confirm <id>`). Anything else —
 * no confirmation, a mismatched id, an explicit `--dry-run` — resolves to a
 * non-destructive dry-run or an outright refusal. Fail closed, never open.
 */

import type { EraseFamilyInput } from "@/app/lib/funnel/erase-family-core";

/** A loose UUID v4-ish shape check. The erase keys ONLY on the ids passed in and
 *  has no ownership check of its own, so an obviously-wrong shape (a name, a
 *  stray flag value) must never reach a real run. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeUuid = (v: string): boolean => UUID_RE.test(v.trim());

export type ParsedArgs = {
  parentUserId: string | null;
  parentEmail: string | null;
  /** null = flag absent (full-family erasure); [] = flag present but empty. */
  childIds: string[] | null;
  /** True when `--confirm` appeared at all (with or without a value). */
  confirmFlagPresent: boolean;
  /** The value passed to `--confirm` (the re-stated target); null if none. */
  confirmValue: string | null;
  /** True when `--dry-run` was passed explicitly. */
  dryRunFlag: boolean;
  /** The R28_CONFIRM env value (the alternate confirmation intent). */
  envConfirm: string | null;
};

/**
 * Parse argv (the tokens AFTER `node script.ts`) + env into a ParsedArgs. Accepts
 * both `--flag value` and `--flag=value`. Boolean flags (`--dry-run`) take no
 * value; `--confirm` MAY take a value (the re-stated target id) or stand alone.
 */
export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {}
): ParsedArgs {
  const parsed: ParsedArgs = {
    parentUserId: null,
    parentEmail: null,
    childIds: null,
    confirmFlagPresent: false,
    confirmValue: null,
    dryRunFlag: false,
    envConfirm: env.R28_CONFIRM ?? null,
  };

  const valueless = new Set(["--dry-run"]);

  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;

    let name = tok;
    let inlineValue: string | null = null;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      name = tok.slice(0, eq);
      inlineValue = tok.slice(eq + 1);
    }

    // Pull the next token as the value only for flags that take one AND when it
    // was not supplied inline and the next token is not itself a flag.
    const takesValue = name !== "--dry-run";
    let value = inlineValue;
    if (takesValue && value === null) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i += 1;
      }
    }

    switch (name) {
      case "--parent-user-id":
        parentSet(parsed, "parentUserId", value);
        break;
      case "--parent-email":
        parentSet(parsed, "parentEmail", value);
        break;
      case "--child-ids":
        parsed.childIds = splitChildIds(value);
        break;
      case "--confirm":
        parsed.confirmFlagPresent = true;
        parsed.confirmValue = value; // may be null (flag stood alone)
        break;
      case "--dry-run":
        parsed.dryRunFlag = true;
        break;
      default:
        // Unknown flags are ignored here; buildInput/main surface bad shapes.
        break;
    }
    if (valueless.has(name)) continue;
  }

  return parsed;
}

function parentSet(p: ParsedArgs, key: "parentUserId" | "parentEmail", value: string | null): void {
  const v = (value ?? "").trim();
  p[key] = v.length > 0 ? v : null;
}

/** Split `a,b , c` into trimmed, non-empty ids. Flag-present-but-empty → []. */
function splitChildIds(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type BuildResult =
  | { ok: true; input: EraseFamilyInput }
  | { ok: false; error: string };

/**
 * Validate a ParsedArgs into an EraseFamilyInput, or an error string. Guardrails:
 *   - refuse if BOTH parentUserId and parentEmail are empty (no target at all),
 *   - require parentUserId specifically (the family anchor the erase keys on),
 *   - refuse an obviously-wrong parentUserId / childId shape (must be a UUID),
 *   - parentEmail is optional at the CLI (defaults to "" — the core only uses it
 *     as a resumability fallback when the parent_id delete matched nothing).
 */
export function buildInput(parsed: ParsedArgs): BuildResult {
  const hasUserId = parsed.parentUserId !== null;
  const hasEmail = parsed.parentEmail !== null;

  if (!hasUserId && !hasEmail) {
    return {
      ok: false,
      error:
        "No target specified. Pass --parent-user-id <uuid> (and optionally --parent-email <email>).",
    };
  }
  if (!hasUserId) {
    return {
      ok: false,
      error:
        "Missing --parent-user-id. The erase anchors on the parent's auth user id; --parent-email alone is not enough.",
    };
  }
  if (!looksLikeUuid(parsed.parentUserId!)) {
    return {
      ok: false,
      error: `--parent-user-id is not a UUID: "${parsed.parentUserId}". Refusing an obviously-wrong target.`,
    };
  }
  if (parsed.parentEmail !== null && !parsed.parentEmail.includes("@")) {
    return {
      ok: false,
      error: `--parent-email is not an email address: "${parsed.parentEmail}".`,
    };
  }
  if (parsed.childIds !== null) {
    if (parsed.childIds.length === 0) {
      return {
        ok: false,
        error: "--child-ids was empty. Omit it for a full-family erase, or pass one or more UUIDs.",
      };
    }
    const bad = parsed.childIds.find((id) => !looksLikeUuid(id));
    if (bad) {
      return { ok: false, error: `--child-ids contains a non-UUID value: "${bad}".` };
    }
  }

  const input: EraseFamilyInput = {
    parentUserId: parsed.parentUserId!,
    parentEmail: parsed.parentEmail ?? "",
    ...(parsed.childIds !== null ? { childIds: parsed.childIds } : {}),
  };
  return { ok: true, input };
}

export type ModeDecision =
  | { mode: "dry-run"; reason: string }
  | { mode: "real" }
  | { mode: "refuse"; reason: string };

/**
 * Decide dry-run vs. real vs. refuse from a ParsedArgs and its validated input.
 * FAIL-CLOSED:
 *   - an explicit `--dry-run` always wins (safe default),
 *   - with NO confirmation intent (`--confirm` / `R28_CONFIRM=erase`) → dry-run,
 *   - with confirmation intent but `--confirm <id>` NOT re-stating the exact
 *     target parentUserId → REFUSE (a mismatch is an operator error, not a
 *     silent downgrade to dry-run),
 *   - only a `--confirm <id>` that equals the target → real.
 */
export function decideMode(parsed: ParsedArgs, input: EraseFamilyInput): ModeDecision {
  if (parsed.dryRunFlag) {
    return { mode: "dry-run", reason: "--dry-run passed explicitly" };
  }

  const intent = parsed.confirmFlagPresent || parsed.envConfirm === "erase";
  if (!intent) {
    return {
      mode: "dry-run",
      reason: "no --confirm / R28_CONFIRM=erase — previewing only",
    };
  }

  const restated = (parsed.confirmValue ?? "").trim();
  if (restated !== input.parentUserId) {
    return {
      mode: "refuse",
      reason:
        `Confirmation does not match the target. Re-run with --confirm ${input.parentUserId} ` +
        `to authorize the erase (got --confirm "${restated || "<empty>"}").`,
    };
  }

  return { mode: "real" };
}
