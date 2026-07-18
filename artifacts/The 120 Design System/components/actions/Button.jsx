import React from "react";

/**
 * The 120 button system. Squared 10px radius, IBM Plex Mono uppercase label,
 * 1px lift on hover. Red is reserved for the primary "Join" action; use it
 * once per view. Renders as <a> when href is given, else <button>.
 *
 * Variants:
 *  - primary   red fill / white text (the one loud CTA)
 *  - ink       ink fill / white text (secondary primary on light)
 *  - ghost     bordered, ink text (light surfaces)
 *  - white     white fill / ink text (dark & red surfaces)
 *  - ghostLight bordered white (dark & red surfaces)
 */
const VARIANTS = {
  primary: { background: "var(--red)", color: "#fff", border: "none" },
  ink: { background: "var(--ink)", color: "#fff", border: "none" },
  ghost: { background: "transparent", color: "var(--ink)", border: "1px solid var(--line-strong)" },
  white: { background: "var(--white)", color: "var(--ink)", border: "none" },
  ghostLight: { background: "transparent", color: "#fff", border: "1.5px solid rgba(255,255,255,0.6)" },
};

export function Button({ children, variant = "primary", href, onClick, block = false, style, ...rest }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const css = {
    display: block ? "flex" : "inline-flex",
    width: block ? "100%" : undefined,
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    whiteSpace: "nowrap",
    padding: "12px 21px",
    borderRadius: "var(--radius-button)",
    textDecoration: "none",
    cursor: "pointer",
    transition: "transform var(--dur) var(--ease), background var(--dur) var(--ease), border-color var(--dur) var(--ease)",
    ...v,
    ...style,
  };
  if (href) {
    return (
      <a href={href} onClick={onClick} style={css} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} style={css} {...rest}>
      {children}
    </button>
  );
}
