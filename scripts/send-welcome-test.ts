/**
 * One-off Welcome-email test send to an arbitrary address (eyeball check).
 *   npx tsx scripts/send-welcome-test.ts --to=you@example.com [--name=Peter]
 *
 * Renders the EXACT production welcome and sends it via peter@ with the RFC 8058
 * one-click headers. Uses a no-op placeholder unsubscribe id (all-zero UUID) so
 * clicking Unsubscribe in the test can't revoke a real family's consent. Reads
 * RESEND_API_KEY (+ SUPABASE_SERVICE_ROLE_KEY for the unsubscribe HMAC) from the
 * environment, falling back to .env.local.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sendEmail } from "@/app/lib/email";
import { renderWelcome } from "@/app/lib/welcome/welcome-rules";
import { unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url";
import { WELCOME_FROM, WELCOME_REPLY_TO } from "@/app/lib/welcome/template";

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "";
}

async function main() {
  loadEnv();
  const to = arg("to");
  if (!to) {
    console.error("Usage: npx tsx scripts/send-welcome-test.ts --to=you@example.com [--name=Peter]");
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not set (add it to .env.local or the environment).");
    process.exit(1);
  }
  const name = arg("name") ?? "Peter";
  const unsub = unsubscribeUrl("00000000-0000-0000-0000-000000000000"); // no-op test id
  const c = renderWelcome({ parentFirst: name, unsubscribeUrl: unsub });

  const res = await sendEmail({
    to,
    subject: c.subject,
    html: c.html,
    text: c.text,
    from: WELCOME_FROM,
    replyTo: WELCOME_REPLY_TO,
    emailHeaders: {
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  console.log(res.ok ? `Test welcome sent to ${to} (from ${WELCOME_FROM}).` : `FAILED: ${res.error}`);
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[send-welcome-test] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
