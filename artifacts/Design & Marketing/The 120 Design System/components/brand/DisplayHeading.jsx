import React from "react";

/**
 * Georgia editorial display headline. Wrap the emphasised word in <em> to get
 * the italic accent — red on light, blush on dark.
 */
export function DisplayHeading({ children, as = "h2", size = 44, tone = "light", style }) {
  const Tag = as;
  return (
    <Tag
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 400,
        fontSize: size,
        letterSpacing: "-0.01em",
        lineHeight: 1.08,
        margin: 0,
        color: tone === "dark" ? "var(--paper)" : "var(--ink)",
        ...style,
      }}
      data-accent-tone={tone}
    >
      {children}
    </Tag>
  );
}
