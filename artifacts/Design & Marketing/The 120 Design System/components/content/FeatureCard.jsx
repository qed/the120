import React from "react";

/**
 * Feature card: image on top, then a title with a mono numeric index and a
 * body paragraph. White card, hairline border, square corners.
 */
export function FeatureCard({ image, title, index, body, alt = "" }) {
  return (
    <div
      style={{
        background: "var(--white)",
        border: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      {image ? (
        <img src={image} alt={alt} style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
      ) : null}
      <div style={{ padding: "26px 28px 30px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 21, color: "var(--ink)" }}>{title}</div>
          {index ? (
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--red)" }}>{index}</div>
          ) : null}
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--ink-soft)" }}>{body}</div>
      </div>
    </div>
  );
}
