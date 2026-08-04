/**
 * Assemble the 10 per-family beta emails from the committed template and the
 * LOCAL credentials file. Writes NOTHING to any external service — it emits a
 * JSON array of {to, parent, subject, body} to stdout (and optionally a file),
 * which the caller turns into Gmail drafts.
 *
 *   npx tsx scripts/fp-cohort-emails.ts            # JSON to stdout
 *   npx tsx scripts/fp-cohort-emails.ts --out      # also write the .local.json
 *
 * Sources of truth, neither duplicated here:
 *   - body copy   : artifacts/First Profit/beta-cohort-parent-email-2026-08-04.md
 *   - credentials : scripts/.fp-cohort-credentials.local.md  (gitignored)
 *
 * Parsing the credentials file rather than re-deriving passwords is deliberate:
 * the parent passwords were randomly generated at provisioning time and that
 * file is their ONLY copy. Re-running the provisioner would mint different ones
 * that no longer match the database.
 *
 * The output contains live credentials. `--out` writes to a gitignored
 * `.local.json` path; do not commit it and delete it after the drafts exist.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { loadRoster } from "./fp-cohort-roster";
import { fileURLToPath } from "node:url";

const TEMPLATE = "artifacts/First Profit/beta-cohort-parent-email-2026-08-04.md";
const CREDENTIALS = "scripts/.fp-cohort-credentials.local.md";
const OUT = "scripts/.fp-cohort-emails.local.json";

/**
 * Which variant each family gets, and the parent's first name for the greeting
 * — derived from the LOCAL roster (scripts/fp-cohort-roster.ts), which is real
 * family data and is deliberately not committed to this public repo.
 */
const FAMILIES: Array<{ email: string; first: string; variant: "A" | "B" }> = loadRoster().map(
  (f) => ({ email: f.email, first: f.firstName, variant: f.existingAccount ? "B" : "A" })
);

type Parsed = { children: Array<{ name: string; line: string }>; password: string | null };

/** Pull each family's child lines and parent password out of the credentials file. */
function parseCredentials(raw: string): Map<string, Parsed> {
  const out = new Map<string, Parsed>();
  // Sections look like:  ## Parent Name  <parent@example.com>
  const blocks = raw.split(/^## /m).slice(1);
  for (const block of blocks) {
    const emailMatch = block.match(/<([^>]+)>/);
    if (!emailMatch) continue;
    const email = emailMatch[1]!.toLowerCase();

    // "Parent login (the120.school): addr / pass"  |  "... — existing account, ..."
    const pwMatch = block.match(/^Parent login[^:\n]*:\s*\S+\s*\/\s*(\S+)\s*$/m);
    const password = pwMatch ? pwMatch[1]! : null;

    const children = [...block.matchAll(/^- ([^:]+): (.+)$/gm)].map((m) => ({
      name: m[1]!.trim(),
      line: `- ${m[1]!.trim()}: ${m[2]!.trim()}`,
    }));

    out.set(email, { children, password });
  }
  return out;
}

/** Split the template into its two variant bodies. */
function parseTemplate(raw: string): { A: string; B: string; subject: string } {
  const section = (name: string) => {
    const re = new RegExp(`## Variant ${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n---\\n|$)`);
    const m = raw.match(re);
    if (!m) throw new Error(`template: could not find "## Variant ${name}"`);
    return m[1]!.trim();
  };
  const a = section("A");
  const b = section("B");
  const subjMatch = a.match(/^\*\*Subject:\*\*\s*(.+)$/m);
  if (!subjMatch) throw new Error("template: no **Subject:** line in Variant A");
  const strip = (s: string) => s.replace(/^\*\*Subject:\*\*.*$/m, "").trim();
  return { A: strip(a), B: strip(b), subject: subjMatch[1]!.trim() };
}

/** "Brayden and Cooper" / "Quinn, Scarlett and Robin" / "Abe" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ------------------------------------------------------------- rendering */
// The template is markdown written for humans to read in the repo. Email
// clients render neither `**bold**` nor the source's hard line wraps sensibly,
// so both output forms are derived here: paragraphs are unwrapped, list blocks
// are kept as lists, and inline markup is either stripped (plain) or converted
// (HTML). Neither form is hand-maintained — editing the template updates both.

type Block = { type: "p" | "ul"; lines: string[] };

function toBlocks(body: string): Block[] {
  return body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines) =>
      lines.every((l) => l.startsWith("- "))
        ? { type: "ul" as const, lines: lines.map((l) => l.slice(2)) }
        : // A paragraph whose list items wrapped across source lines: re-join
          // continuation lines onto their bullet.
          lines[0]!.startsWith("- ")
          ? {
              type: "ul" as const,
              lines: lines.reduce<string[]>((acc, l) => {
                if (l.startsWith("- ")) acc.push(l.slice(2));
                else acc[acc.length - 1] += ` ${l}`;
                return acc;
              }, []),
            }
          : { type: "p" as const, lines: [lines.join(" ")] }
    );
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `**x**` and `` `x` `` -> stripped. Plain-text form. */
const inlinePlain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");

/** `**x**` -> <strong>, `` `x` `` -> <code>, bare https:// -> <a>. HTML form. */
function inlineHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code style="background:#f1f3f4;padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');
}

function renderPlain(body: string): string {
  return toBlocks(body)
    .map((b) =>
      b.type === "ul"
        ? b.lines.map((l) => `- ${inlinePlain(l)}`).join("\n")
        : inlinePlain(b.lines[0]!)
    )
    .join("\n\n");
}

function renderHtml(body: string): string {
  const inner = toBlocks(body)
    .map((b) =>
      b.type === "ul"
        ? `<ul>${b.lines.map((l) => `<li>${inlineHtml(l)}</li>`).join("")}</ul>`
        : `<p>${inlineHtml(b.lines[0]!)}</p>`
    )
    .join("\n");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#202124">\n${inner}\n</div>`;
}

function main() {
  const template = parseTemplate(readFileSync(TEMPLATE, "utf8"));
  const creds = parseCredentials(readFileSync(CREDENTIALS, "utf8"));

  const drafts = FAMILIES.map((fam) => {
    const c = creds.get(fam.email);
    if (!c) throw new Error(`no credentials block for ${fam.email}`);
    if (c.children.length === 0) throw new Error(`no child lines for ${fam.email}`);
    if (fam.variant === "A" && !c.password) {
      throw new Error(`${fam.email} is variant A but has no parent password`);
    }
    if (fam.variant === "B" && c.password) {
      throw new Error(`${fam.email} is variant B but a password was parsed — check the file`);
    }

    const kidNames = joinNames(c.children.map((k) => k.name));
    let body = fam.variant === "A" ? template.A : template.B;

    // Replace the paste-placeholder AND its example lines with the real ones.
    body = body.replace(
      /\{\{PASTE THE CHILD LINES[^}]*\}\}\n(?:>.*\n?)*/,
      `${c.children.map((k) => k.line).join("\n")}\n`
    );

    body = body
      .replace(/\{\{PARENT_FIRST_NAME\}\}/g, fam.first)
      .replace(/\{\{KID_NAMES\}\}/g, kidNames)
      .replace(/\{\{PARENT_EMAIL\}\}/g, fam.email)
      .replace(/\{\{PARENT_PASSWORD\}\}/g, c.password ?? "");

    const leftover = body.match(/\{\{[^}]+\}\}/g);
    if (leftover) throw new Error(`${fam.email}: unsubstituted placeholders ${leftover.join(", ")}`);

    return {
      to: fam.email,
      parent: fam.first,
      variant: fam.variant,
      subject: template.subject.replace(/\{\{KID_NAMES\}\}/g, kidNames),
      body: renderPlain(body),
      htmlBody: renderHtml(body),
    };
  });

  const json = JSON.stringify(drafts, null, 2);
  if (process.argv.includes("--out")) {
    writeFileSync(OUT, json, "utf8");
    console.error(`wrote ${OUT} (${drafts.length} drafts) — gitignored, delete after use`);
  }
  console.log(json);
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    main();
  } catch (err) {
    console.error("[fp-cohort-emails] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
