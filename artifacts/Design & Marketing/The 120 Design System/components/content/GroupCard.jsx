import React from "react";
import { Kicker } from "../brand/Kicker.jsx";

/**
 * Group card from the five-groups band: bone card, mono category, Georgia
 * name, blurb, and a bottom mono CTA line. Lifts 1px on hover. Links to the
 * group page.
 */
export function GroupCard({ category, name, blurb, cta = "ENROLLING NOW · BOOK OR JOIN →", href = "#" }) {
  const [hover, setHover] = React.useState(false);
  return (
    <a
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 250,
        background: "var(--paper)",
        color: "var(--ink)",
        borderRadius: "var(--radius-card)",
        padding: 22,
        textDecoration: "none",
        boxSizing: "border-box",
        transform: hover ? "translateY(-4px)" : "none",
        boxShadow: hover ? "var(--shadow-card-hover)" : "none",
        transition: "transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)",
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.12em", opacity: 0.75 }}>
        {category}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: 26,
          lineHeight: 1.05,
          letterSpacing: "-0.01em",
          marginTop: 8,
        }}
      >
        {name}
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.55, opacity: 0.85, marginTop: 10 }}>{blurb}</span>
      <span
        style={{
          marginTop: "auto",
          paddingTop: 18,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--red)",
        }}
      >
        {cta}
      </span>
    </a>
  );
}
