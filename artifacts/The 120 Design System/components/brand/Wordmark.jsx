import React from "react";

/**
 * The 120 logo lockup: a square red "120" chip beside the stacked wordmark
 * over a letterspaced sublabel. On dark surfaces the wordmark is bone and the
 * sublabel is blush.
 */
export function Wordmark({ tone = "dark", sublabel = "TORONTO", stacked = true }) {
  const isLight = tone === "light";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 11, fontFamily: "var(--font-sans)" }}>
      <span
        style={{
          background: "var(--red)",
          color: "#fff",
          fontWeight: 700,
          fontSize: 17,
          letterSpacing: "var(--tracking-wordmark)",
          lineHeight: 1,
          padding: "6px 9px",
        }}
      >
        120
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            whiteSpace: "nowrap",
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            color: isLight ? "var(--paper)" : "var(--ink)",
          }}
        >
          The 120
        </span>
        {stacked && sublabel ? (
          <span
            style={{
              whiteSpace: "nowrap",
              fontWeight: 500,
              fontSize: 9,
              letterSpacing: "0.2em",
              lineHeight: 1,
              color: isLight ? "var(--blush)" : "var(--red)",
            }}
          >
            {sublabel}
          </span>
        ) : null}
      </span>
    </span>
  );
}
