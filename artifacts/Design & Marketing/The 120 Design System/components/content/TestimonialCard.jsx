import React from "react";

/** Testimonial card: quote in Space Grotesk, name + mono attribution. */
export function TestimonialCard({ quote, name, role }) {
  return (
    <div
      style={{
        background: "var(--white)",
        border: "1px solid var(--line)",
        padding: "30px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontFamily: "var(--font-sans)", fontWeight: 500, fontSize: 17, lineHeight: 1.5, color: "var(--ink)" }}>
        &ldquo;{quote}&rdquo;
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{name}</div>
        {role ? (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>{role}</div>
        ) : null}
      </div>
    </div>
  );
}
