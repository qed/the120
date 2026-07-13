import "server-only";
import { sendEmail } from "@/app/lib/email";
import { unsubscribeUrl } from "./token";
import type { NurtureEmail } from "./copy";

/**
 * GTM-1: nurture delivery — wraps the transactional sender with the CASL CEM
 * block every automated commercial email must carry (identification + a
 * working unsubscribe mechanism, same posture as app/crm/lib/crm-email.ts,
 * plus a one-click unsubscribe link that revokes consent for this family).
 * No call site can forget the footer because it's appended here.
 */

export async function sendNurtureEmail(
  familyId: string,
  to: string,
  email: NurtureEmail
): Promise<{ ok: boolean; error?: string }> {
  const unsub = unsubscribeUrl(familyId);

  const footerText =
    "—\n" +
    "The 120 · the120.school · admissions@the120.school · Toronto\n" +
    "You're receiving this because an account was created at the120.school with consent to hear from us.\n" +
    `Unsubscribe: ${unsub}`;

  const footerHtml =
    '<div style="font-family: Georgia, \'Times New Roman\', serif; max-width: 560px; margin: 0 auto; padding: 0 24px 32px;">' +
    '<hr style="border: none; border-top: 1px solid #d9dee8; margin: 4px 0 16px;"/>' +
    '<p style="font-size: 12px; line-height: 1.6; color: #5a6b8a; margin: 0;">' +
    'The 120 · <a href="https://the120.school" style="color: #5a6b8a;">the120.school</a> · ' +
    '<a href="mailto:admissions@the120.school" style="color: #5a6b8a;">admissions@the120.school</a> · Toronto<br/>' +
    "You're receiving this because an account was created at the120.school with consent to hear from us. " +
    `<a href="${unsub}" style="color: #5a6b8a;">Unsubscribe</a>` +
    "</p></div>";

  return sendEmail({
    to,
    subject: email.subject,
    html: `${email.html}${footerHtml}`,
    text: `${email.text}\n\n${footerText}`,
  });
}
