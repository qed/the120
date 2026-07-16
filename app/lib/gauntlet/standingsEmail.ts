/**
 * GPF-10 / D1 — weekly standings email copy. Reuses the Resend rails.
 * Per-fact "facts mastered this week" and precise band rank depend on the B1
 * score-logging work (Ethan); until that lands this sends the handle, band,
 * the current week's theme, and the climb CTA — a real weekly touch that gets
 * richer when score data is wired. Always carries a CASL footer + one-click
 * unsubscribe (parity with the nurture emails).
 */
export function standingsEmail(opts: {
  handle: string;
  bandLabel: string;
  themeLabel: string | null;
  endLabel: string;
  unsubUrl: string;
}) {
  const { handle, bandLabel, themeLabel, endLabel, unsubUrl } = opts;
  const subject = `${handle}'s Gauntlet standings this week`;
  const themeLine = themeLabel ? `This week: ${themeLabel}.` : "";

  const text = [
    `Here's where ${handle} stands in the Summer Tournament (${bandLabel}).`,
    themeLine,
    "",
    `The board is live until ${endLabel}. A few good runs this week can move a rank — every mastered fact counts.`,
    "",
    "Keep climbing: https://the120.school/gauntlet",
    "See the full board: https://the120.school/gauntlet/founding-leaderboard",
    "",
    "— The 120",
    "You're getting this because a parent confirmed tournament standings for this player.",
    `Unsubscribe: ${unsubUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 32px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120 · The Gauntlet</p>
  <p style="margin: 0 0 16px;">Here&rsquo;s where <strong>${handle}</strong> stands in the Summer Tournament (${bandLabel}).</p>
  ${themeLine ? `<p style="margin: 0 0 16px; color:#5a6b8a;">${themeLine}</p>` : ""}
  <p style="margin: 0 0 16px;">The board is live until ${endLabel}. A few good runs this week can move a rank &mdash; every mastered fact counts.</p>
  <p style="margin: 24px 0;">
    <a href="https://the120.school/gauntlet" style="background: #c8102e; color: #ffffff; text-decoration: none; padding: 12px 22px; font-size: 15px;">Keep climbing</a>
  </p>
  <p style="margin: 0 0 16px;"><a href="https://the120.school/gauntlet/founding-leaderboard" style="color:#16233b;">See the full board &rarr;</a></p>
  <hr style="border: none; border-top: 1px solid #d9dee8; margin: 28px 0 16px;"/>
  <p style="font-size: 12px; color: #5a6b8a; margin: 0;">
    You&rsquo;re getting this because a parent confirmed tournament standings for this player.<br/>
    <a href="${unsubUrl}" style="color: #5a6b8a;">Unsubscribe</a> · <a href="https://the120.school" style="color:#5a6b8a;">the120.school</a>
  </p>
</div>`;

  return { subject, text, html };
}
