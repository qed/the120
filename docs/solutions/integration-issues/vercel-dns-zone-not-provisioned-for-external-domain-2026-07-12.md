---
title: "Vercel refuses DNS queries for externally-registered domain until a DNS record is added (zone never provisioned)"
date: 2026-07-12
category: integration-issues
module: infrastructure
problem_type: integration_issue
component: tooling
symptoms:
  - "Vercel dashboard shows 'Invalid Configuration' for a domain added to the project, and Refresh does nothing"
  - "ns1.vercel-dns.com returns 'Query refused' when queried directly for the domain"
  - "Public resolvers return SERVFAIL after the old NS cache TTL expires; site unreachable"
  - "TLD registry already shows the correct Vercel nameservers, so registrar-side delegation looks complete"
root_cause: incomplete_setup
resolution_type: config_change
severity: high
related_components:
  - development_workflow
tags:
  - vercel
  - dns
  - nameserver-delegation
  - zone-provisioning
  - external-registrar
  - servfail
  - custom-domain
---

# Vercel refuses DNS queries for externally-registered domain until a DNS record is added

## Problem

After pointing the120.school's nameservers (registered at Namecheap) to `ns1/ns2.vercel-dns.com` and adding the domain to the Vercel project, the domain stayed at "Invalid Configuration" and the site was unreachable for ~3 hours — because Vercel's nameservers had accepted delegation but were not actually serving a DNS zone for the domain.

## Symptoms

- Vercel project domain status stuck at **"Invalid Configuration"**; the row's Refresh button changed nothing
- `https://the120.school` did not respond at all (`curl` exit code `000` — no connection, not an HTTP error)
- Registry delegation was correct: the `.school` TLD servers returned `ns1/ns2.vercel-dns.com` for the domain
- Public resolvers (8.8.8.8) still returned the old `registrar-servers.com` nameservers, with ~2h49m TTL remaining on cached records
- The decisive symptom: `nslookup the120.school ns1.vercel-dns.com` → **"Query refused"** — Vercel's authoritative nameserver was serving no zone for the domain, so once caches expired resolvers returned SERVFAIL instead of a working site

## What Didn't Work

- **Waiting 30+ minutes for "propagation"** (poll loop against the site) — timed out. Propagation was not the blocker; the authoritative server itself refused queries, so no amount of waiting could fix it.
- **Clicking "Refresh" on the project's domain row** — the refresh re-checks but does not provision the zone.
- **Expanding "Learn more" on the domain row** — rendered no actionable information about the missing zone.

## Solution

1. Diagnose in three layers to isolate the failure (Windows `nslookup` shown; `dig` equivalents work the same):

   Registry truth — is delegation saved at the registrar/registry?

   ```
   nslookup -type=NS school. 8.8.8.8
   nslookup -type=NS the120.school <tld-server>
   ```

   (Returned `ns1/ns2.vercel-dns.com` → registrar change was saved and correct.)

   Public resolver state — what are caches still serving?

   ```
   nslookup -type=NS the120.school 8.8.8.8
   nslookup -debug -type=NS the120.school 8.8.8.8   # shows remaining TTL
   ```

   Authoritative check — is the new provider actually serving the zone?

   ```
   nslookup the120.school ns1.vercel-dns.com
   ```

   **"Query refused" here is the smoking gun**: the zone does not exist on the provider's nameservers.

2. Open the **team-level** domain page — `vercel.com/<TEAM>/~/domains/<domain>`. This page has a "DNS Records" section; the project-level domains page does not.

3. Add any DNS record there (in this incident: a TXT record for Google site verification — name `@`, type `TXT`, TTL `60`). Adding a record provisions/activates the Vercel DNS zone.

4. Verify immediately — no waiting required against the authoritative server:

   ```
   nslookup the120.school ns1.vercel-dns.com
   ```

   It answered with Vercel edge IPs (`216.150.16.65`, `216.150.1.1`) right away; the TXT record resolved via 8.8.8.8 within seconds (TTL 60); SSL certificates were auto-issued (visible on the same team domain page); and the site returned HTTP 200.

> Note: once activated, the same zone cleanly hosted a dual-sender email stack — Google Workspace at the apex (MX `smtp.google.com`, SPF `v=spf1 include:_spf.google.com ~all`, DKIM at `google._domainkey`, DMARC at `_dmarc`) alongside Resend (DKIM at `resend._domainkey`, with its MX/SPF scoped to the `send` subdomain) — with no conflicts, because Resend confines its Return-Path records to a subdomain. See `artifacts/roadmap.md` §S6 for the full record inventory.

## Why This Works

The outage had two independent layers that looked like one problem:

1. **Cache lag (benign, self-healing):** public resolvers still held the old NS records with hours of TTL left. This is ordinary propagation delay.
2. **Missing authoritative zone (the real blocker):** delegation at the registry pointed to `ns1/ns2.vercel-dns.com`, but Vercel had never created a zone for the domain — adding a domain to a *project* does not provision the *team-level DNS zone*. An authoritative server that holds no zone answers REFUSED, which resolvers surface as SERVFAIL. Waiting for cache expiry would only have converted stale answers into hard resolution failure.

Adding the first DNS record via the team-level domains page forces Vercel to create and activate the zone on its nameservers. Once the zone exists, the delegation that was already correct at the registry immediately becomes functional, Vercel's domain verification passes, and SSL issuance proceeds automatically.

## Prevention

- **Always test the authoritative nameserver directly** when switching DNS providers — before and after cutover. "Query refused" from the new provider means the zone isn't provisioned, and no amount of propagation waiting will help.
- **Diagnose DNS in layers** (registry → public resolver → authoritative) rather than polling the website; the website only tells you *that* it's broken, not *where*.
- **Know where the DNS zone lives on Vercel:** the team-level domains page (`vercel.com/<TEAM>/~/domains/<domain>`) manages DNS records; the project-level domains page does not, and won't reveal a missing zone.
- **Beware the Vercel add-record form's silent failure:** if the TTL field is empty, submission silently fails — no error appears and the form retains its values, so it looks submitted. Pressing Enter does not reliably submit either. Fill every field and click the submit button.
- **Verify every record actually resolves before moving on**, authoritative first (instant), then public propagation:

  ```
  nslookup -type=TXT <name>.<domain> ns1.vercel-dns.com   # authoritative, instant
  nslookup -type=TXT <name>.<domain> 8.8.8.8              # public propagation
  ```

- **Use TTL 60 during setup** so verification (and any correction) is near-instant; raise TTLs once records are confirmed stable. (Live to-do in this zone: the apex MX record's TTL was fat-fingered to 6060s — set to 60/3600 next time the DNS panel is open; tracked in `artifacts/roadmap.md` §S6.)

## Related Issues

- `artifacts/roadmap.md` §S6 (Domain + mailbox + email) — the surrounding domain/email work and the full DNS record inventory for this zone; the roadmap records the successful outcome, this doc records the failure mode and fix.
- GitHub issues: none related (searched `dns OR domain OR vercel`, zero results).
