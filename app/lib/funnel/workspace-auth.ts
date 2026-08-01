/**
 * Pure builder for the Google service-account JWT auth config used by the
 * Workspace Directory + Gmail clients. Lives in its own module (NO `server-only`,
 * no `googleapis` import) so it is unit-testable and safe to import from scripts.
 *
 * Domain-wide delegation (DWD) requires a `subject` to impersonate:
 *   - Directory user management (create/update/delete users) impersonates a
 *     Workspace ADMIN — supply `GOOGLE_WORKSPACE_ADMIN_SUBJECT`.
 *   - Per-user Gmail settings impersonate the STUDENT — supply the student email.
 * When no subject is given, the service account authenticates as ITSELF, which
 * only works if it has been granted a Workspace admin role directly. Passing the
 * admin subject is the standard, better-documented path for Directory calls.
 */
export type WorkspaceJwtConfig = {
  email: string;
  key: string;
  scopes: string[];
  /** Omitted entirely when there is no subject to impersonate. */
  subject?: string;
};

/**
 * Parse a service-account key JSON and produce the JWT config for `scopes`,
 * impersonating `subjectRaw` via DWD when it is a non-empty string.
 * Throws if the key JSON is missing `client_email`/`private_key` (fail loud —
 * a malformed credential must not silently produce an unauthenticated client).
 */
export function buildWorkspaceJwtConfig(
  saKeyJson: string,
  scopes: readonly string[],
  subjectRaw?: string | null
): WorkspaceJwtConfig {
  const creds = JSON.parse(saKeyJson) as { client_email?: unknown; private_key?: unknown };
  if (typeof creds.client_email !== "string" || creds.client_email.length === 0) {
    throw new Error("workspace SA key: missing client_email");
  }
  if (typeof creds.private_key !== "string" || creds.private_key.length === 0) {
    throw new Error("workspace SA key: missing private_key");
  }
  const subject = typeof subjectRaw === "string" ? subjectRaw.trim() : "";
  return {
    email: creds.client_email,
    key: creds.private_key,
    scopes: [...scopes],
    ...(subject ? { subject } : {}),
  };
}
