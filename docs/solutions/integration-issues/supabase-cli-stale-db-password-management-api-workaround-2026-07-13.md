---
title: "Supabase CLI db auth fails (stale password) — run production SQL via Management API using the CLI token from Windows Credential Manager"
date: 2026-07-13
category: integration-issues
module: infrastructure
problem_type: integration_issue
component: tooling
symptoms:
  - "supabase db push against project deolvqnyvhhnavsifgxz fails authentication; stored DB password in ~\\.the120-supabase-db-password.txt is stale"
  - 'Management API returns {"message":"JWT could not be decoded"} when the Credential Manager blob is decoded with Marshal.PtrToStringUni (UTF-16)'
  - "'Unable to find type [Win32.CredMan]' when the Add-Type P/Invoke and its use are split across separate PowerShell invocations"
  - "Management API rejects with 'query: Expected string, received object' — Get-Content output passed through an untyped function param serializes as an object in ConvertTo-Json"
  - "Server-side JSON parse errors ('Expected , or } after property value') when the SQL contains em-dashes — PS 5.1 sent the string body as ISO-8859-1"
root_cause: config_error
resolution_type: workflow_improvement
severity: high
last_updated: 2026-07-15
related_components:
  - database
  - development_workflow
tags:
  - supabase
  - management-api
  - windows-credential-manager
  - powershell
  - credread
  - utf8-decoding
  - migrations
  - access-token
---

# Supabase CLI db auth fails (stale password) — run production SQL via Management API using the CLI token from Windows Credential Manager

## Problem

On Windows 11 / PowerShell 5.1, `supabase db push` against production project `deolvqnyvhhnavsifgxz` fails auth because the stored DB password in `~\.the120-supabase-db-password.txt` is stale. Production SQL access was needed repeatedly — applying the three CRM migrations (`20260713110000_crm_core.sql`, `20260713143000_crm_gtm.sql`, `20260713170000_crm_library.sql`), running verification queries, and reading auth config (`mailer_autoconfirm`) — without resetting the password mid-flight.

## Symptoms

- `supabase db push` fails with a password authentication error (stale stored password)
- Management API rejects the extracted CLI token: `{"message":"JWT could not be decoded"}`
- Follow-up shell invocation: `Unable to find type [Win32.CredMan]`

## What Didn't Work

1. **`supabase db push`** — password auth failure. The stored password is stale; resetting it was deliberately avoided because sessions were mid-flight and a password-free path (Management API) exists.
2. **Decoding the Credential Manager blob with `[Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)`** — produced a corrupt token; the Management API responded `{"message":"JWT could not be decoded"}`. The Supabase CLI writes its access token into Windows Credential Manager as **UTF-8 bytes**; `PtrToStringUni` reinterprets those bytes as UTF-16 code units, mangling every character pair.
3. **Calling `[Win32.CredMan]::CredRead` in a later invocation without re-running `Add-Type`** — failed with `Unable to find type [Win32.CredMan]`. PowerShell tool-call/shell state does not persist between invocations; the P/Invoke type must be defined in the same command that uses it.
4. **Passing a plain string body to `Invoke-RestMethod`** — the SQL contained em-dashes in comments; PS 5.1 encodes string bodies as ISO-8859-1, the multi-byte characters arrived mangled, and the server answered with a JSON parse error (`Expected ',' or '}' after property value`). Bodies must be UTF-8 **bytes** with an explicit charset.
5. **Feeding `Get-Content -Raw` output through an untyped function parameter** — `Get-Content` attaches note properties (PSPath etc.) to its output string; through an untyped `$q` param, `ConvertTo-Json` serialized it as an object (`{"query": {"value": "..."}}`), and the API rejected with `query: Expected string, received object`. A typed `[string]$q` parameter (or `[string](Get-Content ...)` cast) strips the note properties.

## Solution

Read the Supabase CLI token from Windows Credential Manager (target `Supabase CLI:supabase`) via P/Invoke, decode it as UTF-8, and run SQL through the Management API — no DB password involved. Run as **one** PowerShell invocation:

```powershell
Add-Type -MemberDefinition @'
[DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credentialPtr);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment; public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist; public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
'@ -Name CredMan -Namespace Win32

$ptr = [IntPtr]::Zero
$ok = [Win32.CredMan]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$ptr)   # type 1 = CRED_TYPE_GENERIC
if (-not $ok) { throw 'CredRead failed' }
$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][Win32.CredMan+CREDENTIAL])
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
[Win32.CredMan]::CredFree($ptr)
$token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()   # UTF-8, NOT PtrToStringUni

# Run SQL (incl. DDL migrations) against production. Two hard-won rules
# (both bit in practice — see What Didn't Work #4 and #5):
#   1. the param MUST be typed [string] — Get-Content output carries note
#      properties that ConvertTo-Json otherwise serializes as an object;
#   2. send the body as UTF-8 BYTES with an explicit charset — PS 5.1
#      encodes string bodies ISO-8859-1 and mangles em-dashes in SQL.
function Invoke-SbQuery([string]$q) {
  $json = @{ query = $q } | ConvertTo-Json
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/deolvqnyvhhnavsifgxz/database/query" -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body $bytes
}
Invoke-SbQuery "select count(*) from public.gtm_weeks;"
Invoke-SbQuery ([string](Get-Content -Raw -Encoding UTF8 'supabase\migrations\<migration>.sql'))

# Read auth config:
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/deolvqnyvhhnavsifgxz/config/auth" -Headers @{ Authorization = "Bearer $token" }

# Query API edge logs (BigQuery-flavored SQL over edge_logs). GOTCHA:
# iso_timestamp_start / iso_timestamp_end are REQUIRED — without them the
# endpoint silently returns an empty result set, not an error. Playbook +
# write-shape-fingerprinting use case: docs/solutions/workflow-issues/
# stale-rereport-of-fixed-bug-prove-code-version-db-state-deploy-timeline-edge-log-fingerprint-2026-07-15.md
$sql = [uri]::EscapeDataString("select cast(timestamp as datetime) as ts, event_message from edge_logs where event_message like '%/rest/v1/children%' order by timestamp desc limit 40")
Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/deolvqnyvhhnavsifgxz/analytics/endpoints/logs.all?iso_timestamp_start=2026-07-15T05:00:00Z&iso_timestamp_end=2026-07-15T13:00:00Z&sql=$sql" -Headers @{ Authorization = "Bearer $token" }
```

**The decoding fix — before/after:**

```powershell
# BEFORE (broken — corrupt token, "JWT could not be decoded"):
$token = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, $cred.CredentialBlobSize / 2)

# AFTER (works — copy raw bytes, decode as UTF-8):
$bytes = New-Object byte[] $cred.CredentialBlobSize
[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
$token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
```

Verified working 2026-07-13: applied all three CRM migrations, ran verification SELECTs, and read auth config via this path.

**Operational steps when applying a migration file this way:**

1. POST the migration SQL to `/v1/projects/{ref}/database/query` (the endpoint accepts DDL).
2. **Also insert the migration version into `supabase_migrations.schema_migrations`** so future `supabase db push` diffs stay correct (done for all three CRM migrations).
3. Verify with follow-up SELECTs (row counts) — the query endpoint returns result rows as JSON.

> **Pick the right auth channel.** This project has three distinct Supabase auth mechanisms; don't conflate them:
>
> | Channel | Credential | Use for |
> |---|---|---|
> | Postgres wire auth | DB password (`~\.the120-supabase-db-password.txt` — **stale**) | `supabase db push` / direct psql (currently broken) |
> | Management API | CLI access token (Credential Manager `Supabase CLI:supabase`) | DDL/SQL/config when the DB password is unusable — this doc |
> | PostgREST service role | `SUPABASE_SERVICE_ROLE` env var | Data operations from app code and scripts (`scripts/seed-staff.ts`, `scripts/backfill-families.ts`) |

## Why This Works

- **Encoding root cause:** Windows Credential Manager stores the blob as raw bytes. The Supabase CLI (Go) writes its token as UTF-8. `PtrToStringUni` assumes UTF-16LE, so it fuses every two UTF-8 bytes into one bogus UTF-16 code unit — the JWT's base64 structure is destroyed, hence "JWT could not be decoded". `Marshal.Copy` + `Encoding.UTF8.GetString` reads the bytes as written.
- **Auth root cause bypassed:** the Management API authenticates with the CLI login token (from the user's `supabase login` session), not the database password — so the stale password never enters the picture. The token expires/rotates with CLI login and requires running as the same Windows user that ran `supabase login`.
- **Type-not-found:** `Add-Type` compiles into the current session only; each tool invocation is a fresh session, so definition and use must share one command.

## Prevention

- **Credential blobs from Go/Node CLIs: always `Marshal.Copy` to `byte[]` then decode UTF-8.** Never `PtrToStringUni` unless you know the writer used UTF-16 (e.g. `cmdkey`, some .NET apps).
- **Keep `Add-Type` in the same invocation as its use** — PowerShell tool-call state does not persist across invocations.
- **Type every PowerShell function parameter that will be JSON-serialized (`[string]$q`)** — cmdlet output strings carry note properties that turn into objects under `ConvertTo-Json`.
- **Always send REST bodies as UTF-8 bytes with `charset=utf-8`** — never a bare string on PS 5.1. This is the same family as the BOM-on-pipe trap: assume PowerShell mangles byte encodings at every process/marshaling boundary unless bytes are handled explicitly.
- **Test the token with a cheap GET first** (e.g. `/v1/projects/{ref}/config/auth`) before any mutating POST — a corrupt token fails fast and harmlessly.
- **Record manually applied migrations in `supabase_migrations.schema_migrations`** immediately, so `supabase db push` bookkeeping never drifts.
- **Verify every migration with row-count SELECTs** through the same query endpoint.
- This is the project's **second** PowerShell-encoding trap (the first: PS 5.1 prefixes a BOM when piping strings into native CLIs, which once corrupted Vercel env vars — prefer REST APIs or `--value` flags for secrets; see `artifacts/roadmap.md` env-hygiene note). A **third** was found 2026-07-14: data seeded through this channel earlier had em-dashes flattened to hyphens at rest, so later exact-match WHERE clauses copied from the seed file silently updated 0 rows — and `Invoke-RestMethod`'s response display mangles em-dashes, so diagnose stored bytes with `encode(convert_to(col,'UTF8'),'hex')`, never the console (see `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md`). Working rule: assume PowerShell will mangle byte encodings at every process/marshaling boundary unless you handle bytes explicitly. (auto memory [claude])
- ✅ Resolved 2026-07-13: the DB password was rotated into a password manager and `~\.the120-supabase-db-password.txt` deleted (§T6). No DB password exists on disk — the Management-API path in this doc is the standard for all agent-driven production SQL.

## Related Issues

- `artifacts/roadmap.md` §E5 (attribution columns) — the first migration applied via this Management-API route; the roadmap records the outcome, this doc records the failure mode and playbook.
- `artifacts/roadmap.md` §T6 — Supabase project ref and the stale-password file's rotation to-do.
- `docs/solutions/integration-issues/vercel-dns-zone-not-provisioned-for-external-domain-2026-07-12.md` — sibling doc; thematic kinship only (infrastructure tool silently misbehaves; fix is an out-of-band channel).
- GitHub issues: none related (searched `supabase OR migration OR password`, zero results).
