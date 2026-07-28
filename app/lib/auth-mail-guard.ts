/**
 * The no-auth-mail guard, inverted to DEFAULT-DENY (funnel U15 / W12).
 *
 * Why the inversion. FW students carry a shape the guard could recognize
 * (`maya.chen.fw@`), so a suffix check was enough. Funnel students get bare
 * `first.last@the120.school` (W11, Peter 2026-07-28) — indistinguishable by
 * shape from a staff address. A shape check cannot tell a child from a
 * colleague, so the polarity flips: every `@the120.school` recipient is
 * refused unless it is on the staff allowlist below.
 *
 * Fail direction is deliberate. A forgotten allowlist entry blocks a staff
 * member's password reset — annoying, visible, fixable. The opposite error
 * puts a password-reset link in a child's inbox, which is neither visible
 * nor recoverable. W12b makes the first case loud so it cannot be silent.
 *
 * Addresses OUTSIDE the domain (parents, guides on personal mail) are not
 * this guard's business and pass through untouched.
 */

export const STUDENT_MAIL_DOMAIN = "the120.school";

/**
 * Staff and role addresses that may receive platform auth mail.
 *
 * ENUMERATED, not remembered (W12a). On 2026-07-28 the Supabase auth user
 * list held 252 `@the120.school` accounts; exactly two were not `.fw@`
 * student accounts — `peter@` and `ethan@`. The plan's assumed set
 * (`admissions@`, `hello@`, `staff@`) held no auth users at all, and
 * `ethan@` was absent from it: seeding this list from memory would have
 * locked a real person out on deploy day.
 *
 * The role addresses are listed anyway, ahead of need. They are
 * staff-controlled by construction and can never belong to a child, so
 * including them costs nothing and removes an obvious future lockout.
 *
 * ⚠️ Adding an address here is a security decision. Ask one question: could
 * this address ever belong to a student? If yes, it does not go on the list.
 */
export const STAFF_AUTH_MAIL_ALLOWLIST: readonly string[] = [
  "peter@the120.school",
  "ethan@the120.school",
  "admissions@the120.school",
  "hello@the120.school",
  "staff@the120.school",
];

export type AuthMailVerdict = { allowed: true } | { allowed: false; reason: string };

/** Case-folded and trimmed — the only normalization the allowlist match
 *  applies. Deliberately NOT subaddress-stripping: `admissions+x@` is not
 *  on the list, so it is refused. Someone can add the exact address if a
 *  real need appears; silently accepting `<anything>+<anything>@` would
 *  hand the namespace back to whoever can craft a local part. */
export function normalizeRecipient(email: string): string {
  return email.trim().toLowerCase();
}

export function isStudentDomainAddress(email: string): boolean {
  return normalizeRecipient(email).endsWith(`@${STUDENT_MAIL_DOMAIN}`);
}

/**
 * The decision, as a VALUE. Server Actions map a refusal onto their own
 * non-enumerating response (the action canon never throws to the client);
 * the throwing wrapper below serves the provisioning paths that want a
 * loud stop. Same verdict either way — one place to reason about.
 */
export function authMailVerdict(email: string | null | undefined): AuthMailVerdict {
  if (email === null || email === undefined || normalizeRecipient(email).length === 0) {
    // "No address" must never read as "safe to send".
    return { allowed: false, reason: "blank recipient" };
  }
  const normalized = normalizeRecipient(email);
  if (!isStudentDomainAddress(normalized)) return { allowed: true };
  if (STAFF_AUTH_MAIL_ALLOWLIST.some((a) => normalizeRecipient(a) === normalized)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `${normalized} is inside the student mail domain and is not on the staff allowlist`,
  };
}

/**
 * The throwing choke-point for server-side paths where a refusal is a bug,
 * not a branch to render (provisioning, ops tooling). Throws loudly so the
 * omission surfaces in a test rather than in a child's inbox.
 */
/**
 * W12b, done where it is actually answerable: which auth accounts on the
 * student domain would have their auth mail refused, EXCLUDING the
 * student namespaces that are supposed to be refused.
 *
 * This is the allowlist-completeness signal. It belongs on a schedule,
 * not on the public reset path: a request-time check would have to ask
 * "does this account exist", which is true for every enrolled child
 * (their accounts are real, just password-less) — so it would page ops
 * with a child's address on every guess, leak enrolment, and drown the
 * channel. Run against the full auth user list, this asks the precise
 * question instead, and no visitor can trigger it.
 *
 * `isStudentNamespace` is injected so the FW `.fw@` shape and any future
 * student convention stay owned by their own modules.
 */
export function unallowlistedStaffAddresses(
  authEmails: readonly string[],
  isStudentNamespace: (email: string) => boolean
): string[] {
  const allowed = new Set(STAFF_AUTH_MAIL_ALLOWLIST.map(normalizeRecipient));
  const out = new Set<string>();
  for (const raw of authEmails) {
    const email = normalizeRecipient(raw ?? "");
    if (email.length === 0) continue;
    if (!isStudentDomainAddress(email)) continue;
    if (allowed.has(email)) continue;
    if (isStudentNamespace(email)) continue; // refused on purpose
    out.add(email);
  }
  return [...out].sort();
}

export function assertAuthMailAllowed(email: string, context: string): void {
  const verdict = authMailVerdict(email);
  if (!verdict.allowed) {
    throw new Error(
      `${context}: refusing to send auth mail — ${verdict.reason}. ` +
        `Student accounts are password-less and dormant; no auth mail may ever reach them.`
    );
  }
}
