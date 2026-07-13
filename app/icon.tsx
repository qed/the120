import { ImageResponse } from "next/og";

/**
 * Favicon (Next app-icons convention): the "120" badge — white numerals on
 * ink with the brand-red baseline, matching the site wordmark and the CRM
 * badge. Colors are the globals.css tokens (ink #131416, red #d92632).
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
          flexDirection: "column",
          background: "#131416",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.06em",
          }}
        >
          120
        </div>
        <div style={{ height: 4, background: "#d92632" }} />
      </div>
    ),
    { ...size }
  );
}
