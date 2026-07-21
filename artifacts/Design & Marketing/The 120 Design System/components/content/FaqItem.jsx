import React from "react";

/**
 * FAQ accordion row: question with a +/− toggle, expanding answer. Single-open
 * behaviour lives in the parent — pass `open` and `onToggle`. Hairline divider
 * on top.
 */
export function FaqItem({ question, children, open = false, onToggle }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)" }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
          padding: "20px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "var(--font-sans)",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 17, color: "var(--ink)" }}>{question}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--red)", lineHeight: 1, flex: "none" }}>
          {open ? "\u2212" : "+"}
        </span>
      </button>
      {open ? (
        <div style={{ fontSize: 15, lineHeight: 1.65, color: "var(--ink-soft)", paddingBottom: 22, maxWidth: 720 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
