---
title: "Admin SDK Directory user-management via a service account needs to impersonate an admin (JWT `subject`) OR have a directly-assigned admin role — a JWT with the right scope but NO subject authenticates the SA as itself and 403s on users.insert"
date: 2026-08-01
category: integration-issues
module: provisioning
problem_type: integration_issue
component: google-workspace
symptoms:
  - "google.auth.JWT built with client_email + private_key + admin.directory.user scope, but users.insert/update/delete returns 403 Not Authorized"
  - "Domain-wide delegation is configured in the Admin console but Directory calls still 403"
  - "The provisioning code has never been exercised because the SA key was absent in prod, so the gap only surfaces at the first live run"
root_cause: integration_issue
resolution_type: code_fix
severity: high
tags:
  - google-workspace
  - admin-sdk
  - directory-api
  - domain-wide-delegation
  - service-account
  - jwt
  - impersonation
related_components:
  - provisioning
  - google-workspace
---

# Admin SDK Directory needs an admin `subject` (or a direct role) — scopes alone 403

## Problem

First Profit's Workspace provisioning builds a Directory client to create student
mailboxes:

```ts
const auth = new google.auth.JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
  // ← no `subject`
});
google.admin({ version: "directory_v1", auth }).users.insert(...)
```

That JWT authenticates the service account **as itself**. The Admin SDK Directory
API manages Workspace *users*, which is an admin operation — a bare service account
has no admin privileges, so `users.insert` returns **403 Not Authorized**, even with
the correct scope and even if domain-wide delegation (DWD) is set up in the Admin
console. DWD only takes effect when the JWT **impersonates a real admin** via
`subject`. Without `subject`, the DWD grant is never exercised.

It stayed invisible because the SA key was unset in production (`workspaceConfigured`
false → provisioning parked "pending, not configured"), so the client was never
built. The 403 would only appear at the first live provisioning run — exactly when
you least want a surprise. (A sibling gmail client in the same file *did* pass
`subject: studentEmail` — because per-user Gmail settings must impersonate that user
— which is what made the Directory client's missing admin subject easy to overlook.)

## Two valid setups (pick one; the code must match)

1. **DWD + admin impersonation (standard, best-documented).** Authorize the SA's
   client ID for the scope in the Admin console (Security → API controls → Domain-wide
   delegation), then pass `subject: <a Workspace admin email>` in the JWT. The SA acts
   *as that admin*.
2. **Direct admin role on the service account.** In the Admin console assign an admin
   role (with the User-management privilege) directly to the SA. Then the SA-as-itself
   (no `subject`) has the privilege. Less commonly documented; some editions/roles are
   fiddly.

The original code chose neither cleanly — it used the no-`subject` form (which only
works with #2) while the setup people reach for is #1.

## Solution

Make the Directory client support impersonating an admin via an optional env, so the
standard DWD path works, while staying backward-compatible with a direct role:

```ts
// pure, testable, no `server-only` / googleapis import
export function buildWorkspaceJwtConfig(saKeyJson, scopes, subjectRaw) {
  const creds = JSON.parse(saKeyJson);            // throws if missing client_email/private_key
  const subject = (subjectRaw ?? "").trim();
  return { email: creds.client_email, key: creds.private_key, scopes: [...scopes],
           ...(subject ? { subject } : {}) };     // OMIT the key when empty — see below
}
// Directory: buildWorkspaceJwtConfig(saKey, [admin.directory.user], GOOGLE_WORKSPACE_ADMIN_SUBJECT)
// Gmail:     buildWorkspaceJwtConfig(saKey, [gmail.settings.sharing], studentEmail)
```

Set `GOOGLE_WORKSPACE_ADMIN_SUBJECT` to a super-admin email → Directory impersonates
that admin (DWD). Leave it unset → SA-as-itself (direct-role path). One helper serves
both the admin-Directory and student-Gmail clients.

## Why This Works

DWD is "act on behalf of a user"; the API authorizes the *impersonated* principal, not
the SA. For user-management that principal must be an admin, so the JWT must carry an
admin `subject`. Supplying it turns the pre-authorized DWD grant into an actually-used
admin session.

## Prevention

- **A service-account JWT for an admin API needs a subject to impersonate (DWD) or a
  directly-granted role.** Scope + key alone is not authorization for admin operations
  — it just authenticates the SA as a non-privileged identity.
- **OMIT `subject` when there is none — do not pass `subject: ""`.** An empty-string
  subject can be treated differently from an omitted one by the auth library; the
  backward-compatible "no impersonation" behavior requires the key be absent. Pin it
  with a test asserting `"subject" in cfg === false` for empty/whitespace/undefined.
- **Credential-gated integrations that park when the key is absent hide their auth
  bugs until the first real run.** Treat "never executed against the real provider" as
  untested; validate the auth path in the live acceptance run (or a one-off script)
  before depending on it — and keep the acceptance run bounded (it creates real
  accounts).
- Sibling: the "script that reuses app deps imports server-only and dies at load" doc —
  same theme (a path only exercised when actually run reveals what tsc + unit tests
  don't).
