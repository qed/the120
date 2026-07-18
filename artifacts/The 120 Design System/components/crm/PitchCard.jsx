import React from "react";

/**
 * The one "loud" card on staff surfaces: electric-blue block with a blush mono
 * kicker and a Georgia-italic body. Used for the dossier PROJECT PITCH and the
 * CRM Conversation Co-pilot. Optional pulsing red dot + a white next-move pill.
 */
export function PitchCard({ kicker = "PROJECT PITCH", children, dot = false, action }) {
  return (
    <div
      style={{
        background: "var(--crm-blue)",
        borderRadius: "var(--radius-card-crm)",
        padding: "18px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxSizing: "border-box",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        {dot ? (
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "var(--radius-pill)",
              background: "var(--red)",
              boxShadow: "0 0 0 0 var(--red)",
              animation: "pitch-pulse 1.6s var(--ease) infinite",
            }}
          />
        ) : null}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.12em", color: "var(--blush)" }}>
          {kicker}
        </span>
      </span>
      <p
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 16,
          lineHeight: 1.5,
          color: "var(--paper)",
          margin: 0,
        }}
      >
        {children}
      </p>
      {action ? (
        <span
          style={{
            alignSelf: "flex-start",
            marginTop: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--ink)",
            background: "var(--white)",
            padding: "8px 14px",
            borderRadius: "var(--radius-pill)",
          }}
        >
          {action}
        </span>
      ) : null}
      <style>{`@keyframes pitch-pulse{0%{box-shadow:0 0 0 0 rgba(217,38,50,0.6)}70%{box-shadow:0 0 0 6px rgba(217,38,50,0)}100%{box-shadow:0 0 0 0 rgba(217,38,50,0)}}`}</style>
    </div>
  );
}
