import { ImageResponse } from "next/og";

/** Apple touch icon — same "120" badge as app/icon.tsx at home-screen size. */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#d92632",
          color: "#ffffff",
          fontSize: 76,
          fontWeight: 700,
          letterSpacing: "-0.06em",
        }}
      >
        120
      </div>
    ),
    { ...size }
  );
}
