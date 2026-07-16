/**
 * GPF-5 — double opt-in confirmation email (brief §5: "Your kid wants on the
 * leaderboard"). CASL: plain language on what they'll receive, a confirm
 * button, unsubscribe is implicit (they haven't confirmed yet — no further mail
 * unless they click). Mirrors the welcome email's serif house style.
 */
export function entryConfirmEmail({ handle, confirmUrl }: { handle: string; confirmUrl: string }) {
  const subject = "Your kid wants on the leaderboard";
  const text = [
    "Your child just entered The Gauntlet's Summer Tournament and needs your OK to appear on the leaderboard.",
    "",
    `Their handle: ${handle}`,
    "",
    "The Gauntlet is The 120's free FastMath trainer — a math workout disguised as a boss battle. If you confirm, you'll get their tournament standings each week and occasional news from The 120. Unsubscribe anytime.",
    "",
    `Confirm and put ${handle} on the board: ${confirmUrl}`,
    "",
    "Didn't expect this? Ignore this email — nothing happens without your confirmation.",
    "",
    "— The 120 · admissions@the120.school · https://the120.school",
  ].join("\n");

  const html = `
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 32px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120 · The Gauntlet</p>
  <p style="margin: 0 0 16px;">Your child just entered <strong>The Gauntlet&rsquo;s Summer Tournament</strong> and needs your OK to appear on the leaderboard.</p>
  <p style="margin: 0 0 16px;">Their handle: <strong>${handle}</strong></p>
  <p style="margin: 0 0 16px;">The Gauntlet is The 120&rsquo;s free FastMath trainer &mdash; a math workout disguised as a boss battle. If you confirm, you&rsquo;ll get their tournament standings each week and occasional news from The 120. Unsubscribe anytime.</p>
  <p style="margin: 24px 0;">
    <a href="${confirmUrl}" style="background: #c8102e; color: #ffffff; text-decoration: none; padding: 12px 22px; font-size: 15px;">Confirm &mdash; put ${handle} on the board</a>
  </p>
  <p style="margin: 0 0 16px; font-size: 13px; color: #5a6b8a;">Didn&rsquo;t expect this? Ignore this email &mdash; nothing happens without your confirmation.</p>
  <hr style="border: none; border-top: 1px solid #d9dee8; margin: 28px 0 16px;"/>
  <p style="font-size: 12px; color: #5a6b8a; margin: 0;">
    <a href="mailto:admissions@the120.school" style="color: #5a6b8a;">admissions@the120.school</a> · <a href="https://the120.school" style="color: #5a6b8a;">the120.school</a><br/>
    The 120 — a selective network for Toronto&rsquo;s brightest kids.
  </p>
</div>`;

  return { subject, text, html };
}
