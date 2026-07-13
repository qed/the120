import { ImageResponse } from "next/og";

/**
 * Favicon (Next app-icons convention): the "120" badge — white bold numerals
 * on the brand red (globals.css token #d92632).
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 15,
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
