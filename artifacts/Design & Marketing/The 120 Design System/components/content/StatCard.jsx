import React from "react";

/**
 * Stat card on ink: oversized Space Grotesk numeral with a red accent
 * character, a mono data label, and optional supporting line.
 */
export function StatCard({ value, accent, label, note }) {
  return (
    <div
      style={{
        background: "var(--ink)",
        padding: "30px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 46, letterSpacing: "-0.02em", color: "var(--paper)", fontFamily: "var(--font-sans)" }}>
        {value}
        {accent ? <span style={{ color: "var(--red)" }}>{accent}</span> : null}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", color: "var(--muted)" }}>
        {label}
      </div>
      {note ? (
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--muted)", marginTop: 8 }}>{note}</div>
      ) : null}
    </div>
  );
}
