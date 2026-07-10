/**
 * Gauntlet share card: draws a 1080×1080 score card on a canvas from the
 * game's own assets, then shares it natively (mobile) or downloads it.
 * GTM: the "kids send their score to friends" viral loop.
 */

export type ShareData =
  | {
      kind: "raid";
      bossId: string;
      bossName: string;
      medal: number; // 0-3
      damage: number;
      accuracy: number;
      bestStreak: number;
    }
  | {
      kind: "trial";
      score: number;
      best: number;
    };

const SITE = "jointhe120.vercel.app/gauntlet";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function drawCard(data: ShareData): Promise<HTMLCanvasElement> {
  const W = 1080;
  const H = 1080;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const cx = cv.getContext("2d")!;

  // Make sure the display font is ready before drawing text.
  try {
    await document.fonts.load("700 96px 'Space Grotesk'");
  } catch {
    /* system fallback is fine */
  }

  // Background: key art, cover-fit, heavily darkened.
  const bg = await loadImage("/raiders/keyart.jpg");
  cx.fillStyle = "#0a0f1a";
  cx.fillRect(0, 0, W, H);
  if (bg) {
    const scale = Math.max(W / bg.width, H / bg.height);
    const bw = bg.width * scale;
    const bh = bg.height * scale;
    cx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
    cx.fillStyle = "rgba(6, 9, 16, 0.82)";
    cx.fillRect(0, 0, W, H);
  }

  // Frame
  cx.strokeStyle = "rgba(255,255,255,0.18)";
  cx.lineWidth = 6;
  cx.strokeRect(24, 24, W - 48, H - 48);

  // Title: THE (indigo→blue) GAUNTLET (red→orange)
  cx.textAlign = "center";
  cx.font = "700 92px 'Space Grotesk', sans-serif";
  const g1 = cx.createLinearGradient(W / 2 - 380, 0, W / 2 - 180, 0);
  g1.addColorStop(0, "#818cf8");
  g1.addColorStop(1, "#3b82f6");
  cx.fillStyle = g1;
  cx.fillText("THE", W / 2 - 268, 150);
  const g2 = cx.createLinearGradient(W / 2 - 160, 0, W / 2 + 400, 0);
  g2.addColorStop(0, "#ef4444");
  g2.addColorStop(1, "#f97316");
  cx.fillStyle = g2;
  cx.fillText("GAUNTLET", W / 2 + 118, 150);

  cx.font = "500 34px 'IBM Plex Mono', monospace";
  cx.fillStyle = "rgba(255,255,255,0.55)";
  cx.fillText("FASTMATH BOSS BATTLES · THE 120", W / 2, 208);

  if (data.kind === "raid") {
    // Boss sprite
    const boss = await loadImage(`/raiders/boss-${data.bossId}.png`);
    if (boss) {
      const size = 380;
      cx.drawImage(boss, (W - size) / 2, 250, size, size);
    }
    // Headline
    cx.font = "700 78px 'Space Grotesk', sans-serif";
    cx.fillStyle = "#34d399";
    cx.fillText(`${data.bossName.toUpperCase()} DEFEATED`, W / 2, 710);
    if (data.medal > 0) {
      cx.font = "64px serif";
      cx.fillText(["", "🥉", "🥈", "🥇"][data.medal], W / 2, 790);
    }
    // Stats row
    const stats: [string, string][] = [
      [String(data.damage), "DAMAGE"],
      [`${data.accuracy}%`, "ACCURACY"],
      [`×${data.bestStreak}`, "BEST STREAK"],
    ];
    stats.forEach(([v, l], i) => {
      const x = W / 2 + (i - 1) * 300;
      cx.font = "700 64px 'Space Grotesk', sans-serif";
      cx.fillStyle = "#ffffff";
      cx.fillText(v, x, 895);
      cx.font = "500 24px 'IBM Plex Mono', monospace";
      cx.fillStyle = "rgba(255,255,255,0.5)";
      cx.fillText(l, x, 935);
    });
  } else {
    // Trial: giant score
    cx.font = "96px serif";
    cx.fillText("🏆", W / 2, 380);
    cx.font = "700 220px 'Space Grotesk', sans-serif";
    cx.fillStyle = "#fbbf24";
    cx.fillText(String(data.score), W / 2, 640);
    cx.font = "500 40px 'IBM Plex Mono', monospace";
    cx.fillStyle = "rgba(255,255,255,0.8)";
    cx.fillText("MASTERY TRIAL SCORE", W / 2, 710);
    if (data.score >= data.best && data.score > 0) {
      cx.fillStyle = "#34d399";
      cx.font = "700 44px 'Space Grotesk', sans-serif";
      cx.fillText("NEW PERSONAL BEST", W / 2, 790);
    }
  }

  // Challenge footer
  cx.font = "700 52px 'Space Grotesk', sans-serif";
  cx.fillStyle = "#ffffff";
  cx.fillText("Can you beat me?", W / 2, 990);
  cx.font = "500 32px 'IBM Plex Mono', monospace";
  cx.fillStyle = "#7dd3fc";
  cx.fillText(SITE, W / 2, 1038);

  return cv;
}

/** For tests/preview: returns the card as a data URL. */
export async function shareCardDataUrl(data: ShareData): Promise<string> {
  const cv = await drawCard(data);
  return cv.toDataURL("image/png");
}

/**
 * Share the card: native share sheet with the image where supported
 * (iOS/Android), otherwise downloads the PNG. Returns how it was delivered.
 */
export async function shareScore(data: ShareData): Promise<"shared" | "downloaded"> {
  const cv = await drawCard(data);
  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  const file = new File([blob], "the-gauntlet-score.png", { type: "image/png" });

  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "The Gauntlet",
        text: `Can you beat me? Play The Gauntlet: https://${SITE}`,
      });
      return "shared";
    } catch {
      /* user cancelled or share failed — fall through to download */
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "the-gauntlet-score.png";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return "downloaded";
}
