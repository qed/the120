/* @ds-bundle: {"format":4,"namespace":"The120DesignSystem_cdb8b7","components":[{"name":"Button","sourcePath":"components/actions/Button.jsx"},{"name":"DisplayHeading","sourcePath":"components/brand/DisplayHeading.jsx"},{"name":"Kicker","sourcePath":"components/brand/Kicker.jsx"},{"name":"SeatsDot","sourcePath":"components/brand/SeatsDot.jsx"},{"name":"Wordmark","sourcePath":"components/brand/Wordmark.jsx"},{"name":"FaqItem","sourcePath":"components/content/FaqItem.jsx"},{"name":"FeatureCard","sourcePath":"components/content/FeatureCard.jsx"},{"name":"GroupCard","sourcePath":"components/content/GroupCard.jsx"},{"name":"StatCard","sourcePath":"components/content/StatCard.jsx"},{"name":"TestimonialCard","sourcePath":"components/content/TestimonialCard.jsx"},{"name":"FilterChip","sourcePath":"components/crm/FilterChip.jsx"},{"name":"HeatPips","sourcePath":"components/crm/HeatPips.jsx"},{"name":"PitchCard","sourcePath":"components/crm/PitchCard.jsx"},{"name":"StatusPill","sourcePath":"components/crm/StatusPill.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"}],"sourceHashes":{"components/actions/Button.jsx":"a544b308f8cf","components/brand/DisplayHeading.jsx":"df4bc8e09114","components/brand/Kicker.jsx":"d0198cc52c84","components/brand/SeatsDot.jsx":"375ae2512ca3","components/brand/Wordmark.jsx":"e53ba902f1c4","components/content/FaqItem.jsx":"47a88ba98653","components/content/FeatureCard.jsx":"b388b99fb4a7","components/content/GroupCard.jsx":"9aa696a9770a","components/content/StatCard.jsx":"97949f2e67d5","components/content/TestimonialCard.jsx":"883ee675d2b5","components/crm/FilterChip.jsx":"7453147a3d41","components/crm/HeatPips.jsx":"3dcc598c0cfd","components/crm/PitchCard.jsx":"4b9c9633f7ac","components/crm/StatusPill.jsx":"ec744cb52a25","components/forms/Checkbox.jsx":"56ec84905fca","components/forms/Select.jsx":"e3b7358c97b2","components/forms/TextField.jsx":"57dc2ad83fd9","ui_kits/marketing-site/HomeScreen.jsx":"204b96dcbdf4","ui_kits/member-dashboard/DashboardScreen.jsx":"8349f58e63d4","ui_kits/staff-crm/CrmScreen.jsx":"8fc6394b195f"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.The120DesignSystem_cdb8b7 = window.The120DesignSystem_cdb8b7 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/actions/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  primary: {
    background: "var(--red)",
    color: "#fff",
    border: "none"
  },
  ink: {
    background: "var(--ink)",
    color: "#fff",
    border: "none"
  },
  ghost: {
    background: "transparent",
    color: "var(--ink)",
    border: "1px solid var(--line-strong)"
  },
  white: {
    background: "var(--white)",
    color: "var(--ink)",
    border: "none"
  },
  ghostLight: {
    background: "transparent",
    color: "#fff",
    border: "1.5px solid rgba(255,255,255,0.6)"
  }
};
function Button({
  children,
  variant = "primary",
  href,
  onClick,
  block = false,
  style,
  ...rest
}) {
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
    ...style
  };
  if (href) {
    return /*#__PURE__*/React.createElement("a", _extends({
      href: href,
      onClick: onClick,
      style: css
    }, rest), children);
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    style: css
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/actions/Button.jsx", error: String((e && e.message) || e) }); }

// components/brand/DisplayHeading.jsx
try { (() => {
/**
 * Georgia editorial display headline. Wrap the emphasised word in <em> to get
 * the italic accent — red on light, blush on dark.
 */
function DisplayHeading({
  children,
  as = "h2",
  size = 44,
  tone = "light",
  style
}) {
  const Tag = as;
  return /*#__PURE__*/React.createElement(Tag, {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 400,
      fontSize: size,
      letterSpacing: "-0.01em",
      lineHeight: 1.08,
      margin: 0,
      color: tone === "dark" ? "var(--paper)" : "var(--ink)",
      ...style
    },
    "data-accent-tone": tone
  }, children);
}
Object.assign(__ds_scope, { DisplayHeading });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/DisplayHeading.jsx", error: String((e && e.message) || e) }); }

// components/brand/Kicker.jsx
try { (() => {
/**
 * Mono eyebrow/kicker — the typographic label that opens most sections and
 * cards. Uppercase IBM Plex Mono, letterspaced, red by default. Segments are
 * joined with a · separator by convention.
 */
function Kicker({
  children,
  tone = "red",
  size = 12
}) {
  const color = tone === "muted" ? "var(--muted)" : tone === "blush" ? "var(--blush)" : "var(--red)";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: size,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color
    }
  }, children);
}
Object.assign(__ds_scope, { Kicker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Kicker.jsx", error: String((e && e.message) || e) }); }

// components/brand/SeatsDot.jsx
try { (() => {
/**
 * Scarcity indicator: an 8px dot + mono seat count. Red dot on light
 * surfaces, blush on dark. Counts feed from one shared source of truth.
 */
function SeatsDot({
  remaining = 113,
  total = 120,
  tone = "light"
}) {
  const onDark = tone === "onDark";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "var(--radius-pill)",
      background: onDark ? "var(--blush)" : "var(--red)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      letterSpacing: "0.06em",
      color: onDark ? "var(--text-on-dark-soft)" : "var(--ink)"
    }
  }, remaining, " OF ", total, " SEATS REMAIN"));
}
Object.assign(__ds_scope, { SeatsDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/SeatsDot.jsx", error: String((e && e.message) || e) }); }

// components/brand/Wordmark.jsx
try { (() => {
/**
 * The 120 logo lockup: a square red "120" chip beside the stacked wordmark
 * over a letterspaced sublabel. On dark surfaces the wordmark is bone and the
 * sublabel is blush.
 */
function Wordmark({
  tone = "dark",
  sublabel = "TORONTO",
  stacked = true
}) {
  const isLight = tone === "light";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 11,
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--red)",
      color: "#fff",
      fontWeight: 700,
      fontSize: 17,
      letterSpacing: "var(--tracking-wordmark)",
      lineHeight: 1,
      padding: "6px 9px"
    }
  }, "120"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap",
      fontWeight: 700,
      fontSize: 17,
      letterSpacing: "-0.02em",
      lineHeight: 1,
      color: isLight ? "var(--paper)" : "var(--ink)"
    }
  }, "The 120"), stacked && sublabel ? /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: "nowrap",
      fontWeight: 500,
      fontSize: 9,
      letterSpacing: "0.2em",
      lineHeight: 1,
      color: isLight ? "var(--blush)" : "var(--red)"
    }
  }, sublabel) : null));
}
Object.assign(__ds_scope, { Wordmark });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Wordmark.jsx", error: String((e && e.message) || e) }); }

// components/content/FaqItem.jsx
try { (() => {
/**
 * FAQ accordion row: question with a +/− toggle, expanding answer. Single-open
 * behaviour lives in the parent — pass `open` and `onToggle`. Hairline divider
 * on top.
 */
function FaqItem({
  question,
  children,
  open = false,
  onToggle
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--line)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onToggle,
    style: {
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
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 17,
      color: "var(--ink)"
    }
  }, question), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 18,
      color: "var(--red)",
      lineHeight: 1,
      flex: "none"
    }
  }, open ? "\u2212" : "+")), open ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      lineHeight: 1.65,
      color: "var(--ink-soft)",
      paddingBottom: 22,
      maxWidth: 720
    }
  }, children) : null);
}
Object.assign(__ds_scope, { FaqItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/FaqItem.jsx", error: String((e && e.message) || e) }); }

// components/content/FeatureCard.jsx
try { (() => {
/**
 * Feature card: image on top, then a title with a mono numeric index and a
 * body paragraph. White card, hairline border, square corners.
 */
function FeatureCard({
  image,
  title,
  index,
  body,
  alt = ""
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--white)",
      border: "1px solid var(--line)",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box"
    }
  }, image ? /*#__PURE__*/React.createElement("img", {
    src: image,
    alt: alt,
    style: {
      width: "100%",
      height: 200,
      objectFit: "cover",
      display: "block"
    }
  }) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "26px 28px 30px",
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 21,
      color: "var(--ink)"
    }
  }, title), index ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--red)"
    }
  }, index) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--ink-soft)"
    }
  }, body)));
}
Object.assign(__ds_scope, { FeatureCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/FeatureCard.jsx", error: String((e && e.message) || e) }); }

// components/content/GroupCard.jsx
try { (() => {
/**
 * Group card from the five-groups band: bone card, mono category, Georgia
 * name, blurb, and a bottom mono CTA line. Lifts 1px on hover. Links to the
 * group page.
 */
function GroupCard({
  category,
  name,
  blurb,
  cta = "ENROLLING NOW · BOOK OR JOIN →",
  href = "#"
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("a", {
    href: href,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      transition: "transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      letterSpacing: "0.12em",
      opacity: 0.75
    }
  }, category), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: 400,
      fontSize: 26,
      lineHeight: 1.05,
      letterSpacing: "-0.01em",
      marginTop: 8
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      lineHeight: 1.55,
      opacity: 0.85,
      marginTop: 10
    }
  }, blurb), /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: "auto",
      paddingTop: 18,
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.08em",
      color: "var(--red)"
    }
  }, cta));
}
Object.assign(__ds_scope, { GroupCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/GroupCard.jsx", error: String((e && e.message) || e) }); }

// components/content/StatCard.jsx
try { (() => {
/**
 * Stat card on ink: oversized Space Grotesk numeral with a red accent
 * character, a mono data label, and optional supporting line.
 */
function StatCard({
  value,
  accent,
  label,
  note
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--ink)",
      padding: "30px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 46,
      letterSpacing: "-0.02em",
      color: "var(--paper)",
      fontFamily: "var(--font-sans)"
    }
  }, value, accent ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--red)"
    }
  }, accent) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.08em",
      color: "var(--muted)"
    }
  }, label), note ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      lineHeight: 1.5,
      color: "var(--muted)",
      marginTop: 8
    }
  }, note) : null);
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/StatCard.jsx", error: String((e && e.message) || e) }); }

// components/content/TestimonialCard.jsx
try { (() => {
/** Testimonial card: quote in Space Grotesk, name + mono attribution. */
function TestimonialCard({
  quote,
  name,
  role
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--white)",
      border: "1px solid var(--line)",
      padding: "30px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontWeight: 500,
      fontSize: 17,
      lineHeight: 1.5,
      color: "var(--ink)"
    }
  }, "\u201C", quote, "\u201D"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 14,
      color: "var(--ink)"
    }
  }, name), role ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--muted)"
    }
  }, role) : null));
}
Object.assign(__ds_scope, { TestimonialCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/content/TestimonialCard.jsx", error: String((e && e.message) || e) }); }

// components/crm/FilterChip.jsx
try { (() => {
/**
 * Filter chip (mono). Active = electric-blue filled, white text; inactive =
 * bone with a hairline border. Matches the CRM/dossier-queue filter row.
 */
function FilterChip({
  children,
  active = false,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "7px 13px",
      borderRadius: "var(--radius-pill)",
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "all var(--dur) var(--ease)",
      background: active ? "var(--crm-blue)" : "var(--crm-card)",
      color: active ? "#fff" : "var(--ink-soft)",
      border: active ? "1px solid var(--crm-blue)" : "1px solid var(--line-strong)"
    }
  }, children);
}
Object.assign(__ds_scope, { FilterChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/crm/FilterChip.jsx", error: String((e && e.message) || e) }); }

// components/crm/HeatPips.jsx
try { (() => {
/**
 * Heat meter — five 8px squares (echoing the square 120 chip), filled red for
 * the current value. Optionally shows the auto-suggested value as ghost
 * outlines when overridden.
 */
function HeatPips({
  value = 3,
  max = 5,
  suggested
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: 4
    }
  }, Array.from({
    length: max
  }).map((_, i) => {
    const filled = i < value;
    const isSuggestedEdge = suggested != null && i < suggested && !filled;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        width: 8,
        height: 8,
        borderRadius: 2,
        background: filled ? "var(--red)" : "transparent",
        border: filled ? "none" : isSuggestedEdge ? "1px solid var(--red)" : "1px solid #e0ddd7",
        boxSizing: "border-box"
      }
    });
  }));
}
Object.assign(__ds_scope, { HeatPips });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/crm/HeatPips.jsx", error: String((e && e.message) || e) }); }

// components/crm/PitchCard.jsx
try { (() => {
/**
 * The one "loud" card on staff surfaces: electric-blue block with a blush mono
 * kicker and a Georgia-italic body. Used for the dossier PROJECT PITCH and the
 * CRM Conversation Co-pilot. Optional pulsing red dot + a white next-move pill.
 */
function PitchCard({
  kicker = "PROJECT PITCH",
  children,
  dot = false,
  action
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-blue)",
      borderRadius: "var(--radius-card-crm)",
      padding: "18px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8
    }
  }, dot ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: "var(--radius-pill)",
      background: "var(--red)",
      boxShadow: "0 0 0 0 var(--red)",
      animation: "pitch-pulse 1.6s var(--ease) infinite"
    }
  }) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      letterSpacing: "0.12em",
      color: "var(--blush)"
    }
  }, kicker)), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--font-display)",
      fontStyle: "italic",
      fontSize: 16,
      lineHeight: 1.5,
      color: "var(--paper)",
      margin: 0
    }
  }, children), action ? /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: "flex-start",
      marginTop: 4,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "var(--ink)",
      background: "var(--white)",
      padding: "8px 14px",
      borderRadius: "var(--radius-pill)"
    }
  }, action) : null, /*#__PURE__*/React.createElement("style", null, `@keyframes pitch-pulse{0%{box-shadow:0 0 0 0 rgba(217,38,50,0.6)}70%{box-shadow:0 0 0 6px rgba(217,38,50,0)}100%{box-shadow:0 0 0 0 rgba(217,38,50,0)}}`));
}
Object.assign(__ds_scope, { PitchCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/crm/PitchCard.jsx", error: String((e && e.message) || e) }); }

// components/crm/StatusPill.jsx
try { (() => {
/**
 * Pipeline / review status pill (mono, uppercase, pill radius). Colour maps to
 * the family's stage or a child's review status — matching the CRM spec.
 */
const TONES = {
  neutral: {
    background: "#e0ddd7",
    color: "var(--ink-soft)"
  },
  blue: {
    background: "var(--crm-blue)",
    color: "#fff"
  },
  red: {
    background: "var(--red)",
    color: "#fff"
  },
  ink: {
    background: "var(--ink)",
    color: "#fff"
  },
  blush: {
    background: "var(--blush)",
    color: "var(--ink)"
  },
  green: {
    background: "var(--green)",
    color: "#fff"
  }
};
function StatusPill({
  children,
  tone = "neutral"
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "4px 10px",
      borderRadius: "var(--radius-pill)",
      whiteSpace: "nowrap",
      ...t
    }
  }, children);
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/crm/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Consent-style checkbox with wrapping label. Red accent. Never pre-checked
 * for CASL consent (Canadian anti-spam) — the box ships empty by design.
 */
function Checkbox({
  children,
  checked,
  onChange,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      lineHeight: 1.5,
      color: "var(--ink-soft)",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    onChange: onChange,
    style: {
      marginTop: 3,
      accentColor: "var(--red)",
      width: 16,
      height: 16,
      flex: "none"
    }
  }, rest)), /*#__PURE__*/React.createElement("span", null, children));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Select styled to match TextField. Options passed as [{value,label}] or strings. */
function Select({
  label,
  options = [],
  flat = false,
  style,
  ...rest
}) {
  const field = {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    padding: flat ? "13px 16px" : "11px 13px",
    border: flat ? "1.5px solid var(--line)" : "1px solid var(--line-strong)",
    background: flat ? "var(--paper)" : "var(--white)",
    color: "var(--ink-soft)",
    borderRadius: flat ? 0 : "var(--radius-button)",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    appearance: "none",
    ...style
  };
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, label ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--ink)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("select", _extends({
    style: field
  }, rest), options.map((o, i) => {
    const value = typeof o === "string" ? o : o.value;
    const text = typeof o === "string" ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: i,
      value: value
    }, text);
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Labelled text input. Space Grotesk, hairline border, focus goes ink.
 * Default is the app/CRM style (white field, 10px radius). Pass flat for the
 * squared marketing lead-capture style (bone field, 1.5px border, no radius).
 */
function TextField({
  label,
  hint,
  flat = false,
  style,
  ...rest
}) {
  const field = {
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    padding: flat ? "13px 16px" : "11px 13px",
    border: flat ? "1.5px solid var(--line)" : "1px solid var(--line-strong)",
    background: flat ? "var(--paper)" : "var(--white)",
    color: "var(--ink)",
    borderRadius: flat ? 0 : "var(--radius-button)",
    outline: "none",
    boxSizing: "border-box",
    width: "100%",
    ...style
  };
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, label ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 600,
      color: "var(--ink)"
    }
  }, label) : null, /*#__PURE__*/React.createElement("input", _extends({
    style: field,
    onFocus: e => e.target.style.borderColor = "var(--ink)",
    onBlur: e => e.target.style.borderColor = flat ? "var(--line)" : "var(--line-strong)"
  }, rest)), hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      color: "var(--muted)"
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing-site/HomeScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// The 120 marketing home — recreation composing DS primitives.
// Exposes MarketingApp on window for index.html.
const {
  Wordmark,
  Button,
  SeatsDot,
  Kicker,
  DisplayHeading,
  GroupCard,
  StatCard,
  FeatureCard,
  FaqItem
} = window.The120DesignSystem_cdb8b7;
const GROUPS = [{
  category: "ATHLETES",
  name: "The Athletes",
  blurb: "Train seriously, compete seriously, and think like a pro."
}, {
  category: "ENTREPRENEURS",
  name: "The Founders",
  blurb: "Start something real. Customers, revenue, lessons learned."
}, {
  category: "CREATIVE",
  name: "The Makers",
  blurb: "Art, film, music, invention. A real body of work, shipped."
}, {
  category: "GIFTED & TALENTED",
  name: "The Scholars",
  blurb: "Accelerated academics. Mastery with no ceiling.",
  cta: "ENROLLING NOW · GT TORONTO →"
}, {
  category: "SERVICE",
  name: "The Givers",
  blurb: "Lead real service. Projects that change a corner of the city."
}];
const FAQS = [{
  q: "What is the Tin Can?",
  a: "A screen-free phone with the 120 Address Book — the network in your kid's pocket, without the internet."
}, {
  q: "How many hours a week?",
  a: "3–5 hours a week, alongside any school. Membership is designed to sit beside whatever your child already does."
}, {
  q: "What does it cost?",
  a: "$3,000 CAD a year for Membership, or $15,000 for the Full Academic Core with TimeBack. Every group is enrolling now."
}];
function Nav({
  onJoin
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 18,
      zIndex: 50,
      margin: "18px 20px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      borderRadius: "var(--radius-card)",
      background: "var(--white)",
      boxShadow: "var(--shadow-nav)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "11px 22px"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    tone: "dark",
    sublabel: "TORONTO"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 18
    }
  }, ["The Gauntlet", "Tuition", "FAQ"].map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 14,
      color: "var(--ink)"
    }
  }, l)), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Book a call"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: onJoin
  }, "Join the 120"))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: "relative",
      minHeight: 620,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      overflow: "hidden",
      marginTop: -92
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/hero-science.webp",
    alt: "",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: "72% 32%",
      zIndex: -2
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      zIndex: -1,
      background: "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "176px 44px 40px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    className: "display",
    style: {
      maxWidth: 820,
      fontSize: 60,
      color: "#fff",
      margin: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block"
    }
  }, "Build your network."), /*#__PURE__*/React.createElement("span", {
    className: "accent-blush",
    style: {
      display: "block"
    }
  }, "Top 1% academics."), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block"
    }
  }, "Super interesting projects."), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block"
    }
  }, "Ages 8\u201317.")), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "26px 0 18px",
      height: 1,
      maxWidth: 820,
      background: "rgba(255,255,255,0.45)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      gap: 32,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      maxWidth: 680,
      fontSize: 18,
      lineHeight: 1.5,
      color: "#fff"
    }
  }, "Athletes, founders, makers, scholars, givers: Toronto's most motivated and engaged kids, ages 8\u201317, building interesting lives together."), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.08em",
      color: "rgba(255,255,255,0.85)",
      whiteSpace: "nowrap"
    }
  }, "FOUNDING COHORT \xB7 FALL 2026 \xB7 TORONTO"))));
}
function Section({
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--content-max)",
      margin: "0 auto",
      padding: "0 44px",
      ...style
    }
  }, children);
}
function MarketingApp() {
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [faq, setFaq] = React.useState(0);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      color: "var(--ink)",
      background: "var(--paper)"
    }
  }, /*#__PURE__*/React.createElement(Nav, {
    onJoin: () => setJoinOpen(true)
  }), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Section, {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 32,
      padding: "44px",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: 720,
      fontSize: 18,
      lineHeight: 1.6,
      color: "var(--ink-soft)",
      margin: 0
    }
  }, "The 120 is a selective network of 120 kids across five groups. Your child finds people with the same core interests, and different ones, in a cohort where everyone is building something. 3\u20135 hours a week, alongside any school."), /*#__PURE__*/React.createElement(SeatsDot, {
    remaining: 113
  })), /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--blue)",
      padding: "80px 44px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--content-max)",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: 40
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      gap: 32,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    tone: "blush"
  }, "FIVE GROUPS \xB7 ONE NETWORK"), /*#__PURE__*/React.createElement(DisplayHeading, {
    tone: "dark",
    size: 44
  }, "Every kid needs ", /*#__PURE__*/React.createElement("em", {
    style: {
      fontStyle: "italic",
      color: "var(--blush)"
    }
  }, "their people"))), /*#__PURE__*/React.createElement("span", {
    style: {
      maxWidth: 380,
      fontSize: 15,
      lineHeight: 1.6,
      color: "rgba(255,255,255,0.75)"
    }
  }, "120 seats across 5 groups. Book a call or join today.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(5,1fr)",
      gap: 14
    }
  }, GROUPS.map(g => /*#__PURE__*/React.createElement(GroupCard, _extends({
    key: g.name
  }, g)))))), /*#__PURE__*/React.createElement(Section, {
    style: {
      padding: "88px 44px",
      display: "flex",
      flexDirection: "column",
      gap: 40
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    size: 42
  }, "Membership is ", /*#__PURE__*/React.createElement("em", {
    style: {
      fontStyle: "italic",
      color: "var(--red)"
    }
  }, "3 things")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 24
    }
  }, [["01 · THE NETWORK", "The people and the Tin Can", "A screen-free phone with the 120 Address Book, and a cohort of kids who all take their thing seriously."], ["02 · THE PROJECT", "A year-long build", "A mentored project — a venture, a season, a body of work — demoed at the quarterly Toronto intensives."], ["03 · THE CRAFT", "Accelerated academics", "Math through Math Academy, or the Full Academic Core with TimeBack — paced to your kid, never the average."]].map(([k, t, b]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      borderTop: "2px solid var(--ink)",
      paddingTop: 18,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Kicker, null, k), /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 21,
      letterSpacing: "-0.01em"
    }
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--ink-soft)"
    }
  }, b))))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--ink)",
      padding: "72px 44px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--content-max)",
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr",
      gap: 20,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(FeatureCard, {
    image: "../../assets/project-robotics.webp",
    index: "01",
    title: "The year-long project",
    body: "A mentored project demoed to the whole network at the quarterly Toronto intensives \u2014 a venture, a season, a film, a service program."
  }), /*#__PURE__*/React.createElement(StatCard, {
    value: "1400",
    accent: "+",
    label: "SAT BY 8TH GRADE",
    note: "2 Hour Learning network results."
  }), /*#__PURE__*/React.createElement(StatCard, {
    value: "120",
    label: "SEATS \xB7 ONE COHORT",
    note: "Founding year, Fall 2026, Toronto."
  }))), /*#__PURE__*/React.createElement(Section, {
    style: {
      padding: "88px 44px",
      display: "flex",
      flexDirection: "column",
      gap: 20,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    size: 42
  }, "Two prices. ", /*#__PURE__*/React.createElement("em", {
    style: {
      fontStyle: "italic",
      color: "var(--red)"
    }
  }, "Two ways in.")), /*#__PURE__*/React.createElement("p", {
    style: {
      maxWidth: 720,
      fontSize: 17,
      lineHeight: 1.6,
      color: "var(--ink-soft)",
      margin: 0
    }
  }, "$3,000 CAD a year for Membership with math through Math Academy, or $15,000 for the Full Academic Core with TimeBack. Every group is enrolling now."), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "See tuition \u2192")), /*#__PURE__*/React.createElement(Section, {
    style: {
      padding: "0 44px 88px",
      maxWidth: 900,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(Kicker, null, "COMMON QUESTIONS"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, FAQS.map((f, i) => /*#__PURE__*/React.createElement(FaqItem, {
    key: i,
    question: f.q,
    open: faq === i,
    onToggle: () => setFaq(faq === i ? -1 : i)
  }, f.a)))), /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--red)",
      padding: "88px 44px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 800,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: 24,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    tone: "dark",
    size: 52,
    style: {
      color: "#fff"
    }
  }, "Come join the network. ", /*#__PURE__*/React.createElement("em", {
    style: {
      fontStyle: "italic",
      color: "var(--blush)"
    }
  }, "Come join the 120.")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 17,
      color: "rgba(255,255,255,0.9)"
    }
  }, "113 of 120 seats remain for the founding cohort."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "white",
    onClick: () => setJoinOpen(true)
  }, "Join the 120"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghostLight"
  }, "Book a call")))), /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "var(--blue)",
      padding: "48px 44px 36px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--content-max)",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 24
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    tone: "light"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 24,
      flexWrap: "wrap"
    }
  }, ["The groups", "Parents", "Tuition", "FAQ", "Sign in"].map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      fontSize: 13,
      color: "var(--muted)"
    }
  }, l)))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid rgba(255,255,255,0.25)",
      paddingTop: 20
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      lineHeight: 1.6,
      color: "rgba(255,255,255,0.7)"
    }
  }, "\xA9 2026 The 120 \xB7 A learning centre. Not an accredited school. TIN CAN is a trademark of Tin Can Untechnologies, Inc.")))), joinOpen ? /*#__PURE__*/React.createElement(JoinModal, {
    onClose: () => setJoinOpen(false)
  }) : null);
}
function JoinModal({
  onClose
}) {
  const {
    TextField,
    Select,
    Checkbox
  } = window.The120DesignSystem_cdb8b7;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(19,20,22,0.55)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: "var(--white)",
      borderRadius: "var(--radius-card)",
      padding: 40,
      maxWidth: 560,
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Kicker, null, "SECURE YOUR CANDIDACY \xB7 FALL 2026"), /*#__PURE__*/React.createElement(DisplayHeading, {
    size: 28
  }, "Create your family account"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "First name",
    placeholder: "Jordan"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Last name",
    placeholder: "Ng"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Email",
    placeholder: "parent@email.com"
  }), /*#__PURE__*/React.createElement(Select, {
    label: "Child's grade",
    options: ["Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8"]
  })), /*#__PURE__*/React.createElement(Checkbox, null, "Yes \u2014 I consent to receive email and SMS updates from The 120. I can unsubscribe at any time."), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    onClick: onClose
  }, "Join the 120")));
}
window.MarketingApp = MarketingApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing-site/HomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/member-dashboard/DashboardScreen.jsx
try { (() => {
// The 120 member dashboard — recreation. Sidebar + dossier cards + seat pipeline.
const {
  Wordmark,
  Button,
  StatusPill,
  Kicker,
  DisplayHeading
} = window.The120DesignSystem_cdb8b7;
const KIDS = [{
  name: "Maya Okafor",
  meta: "Grade 5 · Cottingham Jr PS",
  status: "SUBMITTED",
  tone: "blue",
  pct: 100,
  canSubmit: false
}, {
  name: "Theo Okafor",
  meta: "Grade 3 · Cottingham Jr PS",
  status: "DRAFT",
  tone: "neutral",
  pct: 45,
  canSubmit: false
}];
const PIPELINE = ["ACCOUNT", "DOSSIER", "CALL", "ASSESSMENT", "OFFER", "MEMBER"];
function SideBtn({
  active,
  children,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      textAlign: "left",
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      color: active ? "#fff" : "rgba(255,255,255,0.7)",
      background: active ? "rgba(255,255,255,0.12)" : "transparent",
      border: "none",
      borderRadius: 8,
      padding: "9px 12px",
      cursor: "pointer"
    }
  }, children);
}
function KidCard({
  kid
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-card)",
      border: "1px solid var(--crm-line)",
      borderRadius: "var(--radius-card)",
      padding: "26px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 24,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 22,
      letterSpacing: "-0.01em"
    }
  }, kid.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--ink-soft)"
    }
  }, kid.meta)), /*#__PURE__*/React.createElement(StatusPill, {
    tone: kid.tone
  }, kid.status)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      letterSpacing: "0.1em",
      color: "var(--muted)"
    }
  }, "DOSSIER COMPLETENESS"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      color: "var(--ink)"
    }
  }, kid.pct, "%")), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 7,
      background: "#e0ddd7",
      borderRadius: 100,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: kid.pct + "%",
      height: "100%",
      background: kid.pct === 100 ? "var(--green)" : "var(--crm-blue)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ink",
    style: {
      background: "var(--crm-blue)"
    }
  }, "Edit dossier"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "View dossier"), kid.pct === 100 ? /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Submit for review") : null));
}
function DashboardApp() {
  const [view, setView] = React.useState("overview");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      color: "var(--ink)",
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "250px 1fr",
      background: "var(--crm-bg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-blue)",
      padding: "26px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 28,
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    tone: "light",
    sublabel: "TORONTO"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(SideBtn, {
    active: view === "overview",
    onClick: () => setView("overview")
  }, "Overview"), /*#__PURE__*/React.createElement(SideBtn, {
    active: view === "catalog",
    onClick: () => setView("catalog")
  }, "Workshop catalog")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.14em",
      color: "rgba(255,255,255,0.6)"
    }
  }, "YOUR KIDS"), KIDS.map(k => /*#__PURE__*/React.createElement(SideBtn, {
    key: k.name
  }, k.name.split(" ")[0]))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "rgba(255,255,255,0.7)"
    }
  }, "Ada Okafor"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.06em",
      color: "rgba(255,255,255,0.6)"
    }
  }, "113 OF 120 SEATS REMAIN"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "36px 44px",
      maxWidth: 1080,
      boxSizing: "border-box"
    }
  }, view === "overview" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 28
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    as: "h1",
    size: 36
  }, "Welcome back, Ada."), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      color: "var(--ink-soft)"
    }
  }, "Build each child's dossier, then submit it for review. We'll take it from there.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, KIDS.map(k => /*#__PURE__*/React.createElement(KidCard, {
    key: k.name,
    kid: k
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1.5px dashed #c9c6c0",
      borderRadius: "var(--radius-card)",
      padding: "22px 28px",
      display: "flex",
      alignItems: "center",
      gap: 14,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--ink-soft)"
    }
  }, "Add another child"), /*#__PURE__*/React.createElement(Button, {
    variant: "ink",
    style: {
      background: "var(--crm-blue)"
    }
  }, "Add child")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-blue)",
      borderRadius: "var(--radius-card)",
      padding: "26px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    tone: "blush"
  }, "THE PATH TO A SEAT"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, PIPELINE.map((p, i) => /*#__PURE__*/React.createElement("span", {
    key: p,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      letterSpacing: "0.06em",
      padding: "6px 12px",
      borderRadius: 100,
      background: i <= 1 ? "var(--white)" : "rgba(255,255,255,0.14)",
      color: i <= 1 ? "var(--crm-blue)" : "rgba(255,255,255,0.75)"
    }
  }, p), i < PIPELINE.length - 1 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "rgba(255,255,255,0.5)",
      fontSize: 12
    }
  }, "\u2192") : null))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    as: "h1",
    size: 36
  }, "Workshop catalog"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      color: "var(--ink-soft)"
    }
  }, "Browse the year's workshops and add them to a child's dossier. Catalog view is a stub in this kit."))));
}
window.DashboardApp = DashboardApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/member-dashboard/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/staff-crm/CrmScreen.jsx
try { (() => {
// The 120 staff CRM — recreation. Chrome + tabs; Dossier queue (two-pane) and Pipeline (table).
const {
  StatusPill,
  HeatPips,
  FilterChip,
  PitchCard,
  Button,
  Kicker,
  DisplayHeading
} = window.The120DesignSystem_cdb8b7;
const DOSSIERS = [{
  name: "Maya Okafor",
  meta: "Grade 5 · Cottingham Jr PS",
  date: "JUL 14",
  status: "SUBMITTED",
  tone: "blue",
  subjects: "Math, Writing, Science",
  parent: "Ada Okafor · Leaside",
  pitch: "A city-wide chess ladder for kids who can't afford coaching — run out of three libraries by spring.",
  interests: "Provincial chess (U12, 3rd). Codes small game bots. Reads two grades up.",
  scores: "MAP Math 99th · Reading 96th."
}, {
  name: "Sofia Marchetti",
  meta: "Grade 4 · Rosedale JPS",
  date: "JUL 13",
  status: "IN REVIEW",
  tone: "blue",
  subjects: "Math, Reading",
  parent: "Elena Marchetti · Rosedale",
  pitch: "A short documentary about the ravine behind our school and the people who clean it.",
  interests: "Films on an old iPhone; edits herself. Junior rowing.",
  scores: "MAP Math 94th · Reading 98th."
}, {
  name: "Dev Patel",
  meta: "Grade 6 · North York",
  date: "JUL 12",
  status: "OFFERED",
  tone: "red",
  subjects: "Math, Science, History",
  parent: "Rohan Patel · North York",
  pitch: "A solar phone charger kids can build for $8, with a printed guide for a classroom set.",
  interests: "Robotics club captain. Sells 3D prints at markets.",
  scores: "MAP Math 99th · Science 97th."
}];
const QUEUE_FILTERS = ["ALL", "SUBMITTED", "IN REVIEW", "INVITED", "OFFERED", "MEMBER"];
const STAGE_BTNS = ["SUBMITTED", "IN REVIEW", "INVITED TO ASSESSMENT", "OFFERED A SEAT", "MEMBER OF THE 120"];
const PIPELINE_ROWS = [{
  fam: "Okafor",
  kids: "2 kids · Leaside",
  stage: "DOSSIER SUBMITTED",
  tone: "blue",
  heat: 4,
  source: "AMB-RANA",
  concerns: ["time-commitment"],
  consent: true,
  touch: "2d",
  touchTone: "var(--green)",
  next: "Call them — submitted, no call yet."
}, {
  fam: "Marchetti",
  kids: "1 kid · Rosedale",
  stage: "CALL HELD",
  tone: "blue",
  heat: 4,
  source: "info-session",
  concerns: ["price-value"],
  consent: true,
  touch: "5d",
  touchTone: "var(--green)",
  next: "Send T+1 recap + deposit link."
}, {
  fam: "Patel",
  kids: "1 kid · North York",
  stage: "DEPOSIT PAID",
  tone: "red",
  heat: 5,
  source: "math-contest",
  concerns: [],
  consent: true,
  touch: "1d",
  touchTone: "var(--green)",
  next: "Founding welcome — ask for one intro."
}, {
  fam: "Nguyen",
  kids: "2 kids · Beaches",
  stage: "ACCOUNT CREATED",
  tone: "neutral",
  heat: 3,
  source: "facebook-group",
  concerns: ["screen-time", "socialization"],
  consent: true,
  touch: "9d",
  touchTone: "var(--amber)",
  next: "Dossier nudge — the dossier is the application."
}, {
  fam: "Awad",
  kids: "1 kid · Midtown",
  stage: "INTERESTED",
  tone: "neutral",
  heat: 2,
  source: "coffee-intro",
  concerns: ["selectivity-anxiety"],
  consent: false,
  touch: "16d",
  touchTone: "var(--red)",
  next: "Cold — one last info-session invite."
}];
function Chrome({
  tab,
  setTab
}) {
  return /*#__PURE__*/React.createElement("header", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-blue)",
      padding: "14px 28px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: "var(--red)",
      color: "#fff",
      fontWeight: 700,
      fontSize: 15,
      letterSpacing: "-0.04em",
      padding: "5px 8px",
      lineHeight: 1
    }
  }, "120"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700,
      fontSize: 15,
      letterSpacing: "-0.02em",
      color: "var(--paper)"
    }
  }, "The 120")), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 20,
      background: "rgba(255,255,255,0.24)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.12em",
      color: "rgba(255,255,255,0.75)"
    }
  }, "ADMISSIONS \xB7 CRM"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.08em",
      color: "var(--ink)",
      background: "var(--blush)",
      padding: "4px 10px",
      borderRadius: 100
    }
  }, "STAFF ONLY"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      letterSpacing: "0.06em",
      color: "rgba(255,255,255,0.75)"
    }
  }, "7 SEATS FILLED \xB7 113 REMAIN")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      padding: "10px 28px",
      background: "var(--white)",
      borderBottom: "1px solid var(--crm-line)"
    }
  }, ["Dashboard", "Pipeline", "Dossiers", "Library"].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setTab(t),
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "7px 14px",
      borderRadius: 100,
      cursor: "pointer",
      border: "none",
      background: tab === t ? "var(--crm-blue)" : "transparent",
      color: tab === t ? "#fff" : "var(--ink-soft)"
    }
  }, t))));
}
function DossierQueue() {
  const [sel, setSel] = React.useState(0);
  const [filter, setFilter] = React.useState("ALL");
  const d = DOSSIERS[sel];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.05fr 1fr",
      minHeight: "calc(100vh - 108px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "26px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      borderRight: "1px solid var(--crm-line)",
      boxSizing: "border-box"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    as: "h1",
    size: 28
  }, "Dossier queue"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      color: "var(--muted)"
    }
  }, "3 OF 3 DOSSIERS")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, QUEUE_FILTERS.map(f => /*#__PURE__*/React.createElement(FilterChip, {
    key: f,
    active: filter === f,
    onClick: () => setFilter(f)
  }, f))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, DOSSIERS.map((row, i) => /*#__PURE__*/React.createElement("button", {
    key: row.name,
    onClick: () => setSel(i),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      textAlign: "left",
      cursor: "pointer",
      padding: "14px 16px",
      borderRadius: "var(--radius-card-crm)",
      boxSizing: "border-box",
      background: i === sel ? "var(--white)" : "transparent",
      border: i === sel ? "1px solid var(--crm-blue)" : "1px solid var(--crm-line)",
      boxShadow: i === sel ? "var(--shadow-selected)" : "none",
      fontFamily: "var(--font-sans)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600,
      fontSize: 15.5
    }
  }, row.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      color: "var(--muted)"
    }
  }, row.meta)), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 10,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: "var(--muted)"
    }
  }, row.date), /*#__PURE__*/React.createElement(StatusPill, {
    tone: row.tone
  }, row.status)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "26px 28px",
      boxSizing: "border-box",
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    size: 10
  }, "CANDIDATE DOSSIER"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 28,
      letterSpacing: "-0.01em"
    }
  }, d.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      color: "var(--ink-soft)"
    }
  }, d.meta)), /*#__PURE__*/React.createElement(StatusPill, {
    tone: d.tone
  }, d.status)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.06em",
      color: "#fff",
      background: "var(--green)",
      padding: "5px 11px",
      borderRadius: 100
    }
  }, "$250 PAID \xB7 JUL 20"), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.06em",
      color: "var(--ink-soft)"
    }
  }, "OPEN IN STRIPE \u2192"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      letterSpacing: "0.1em",
      color: "var(--muted)"
    }
  }, "GROUP"), /*#__PURE__*/React.createElement(StatusPill, {
    tone: "neutral"
  }, "SCHOLARS")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, [["SUBJECTS", d.subjects], ["PARENT", d.parent]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      background: "var(--crm-card)",
      border: "1px solid var(--crm-line)",
      borderRadius: "var(--radius-card-crm)",
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    size: 9.5
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, v)))), /*#__PURE__*/React.createElement(PitchCard, {
    kicker: "PROJECT PITCH"
  }, d.pitch), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    size: 9.5,
    tone: "muted"
  }, "INTERESTS & EVIDENCE"), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.6,
      color: "var(--ink-soft)",
      margin: 0
    }
  }, d.interests), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 13.5,
      lineHeight: 1.6,
      color: "var(--ink-soft)",
      margin: 0
    }
  }, d.scores)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--crm-card)",
      border: "1px solid var(--crm-line)",
      borderRadius: "var(--radius-card-crm)",
      padding: "16px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Kicker, {
    size: 9.5
  }, "MOVE CANDIDATE"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, STAGE_BTNS.map((b, i) => /*#__PURE__*/React.createElement("span", {
    key: b,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      letterSpacing: "0.04em",
      padding: "8px 13px",
      borderRadius: 100,
      cursor: "pointer",
      background: i === 1 ? "var(--crm-blue)" : "var(--white)",
      color: i === 1 ? "#fff" : "var(--ink-soft)",
      border: i === 1 ? "1px solid var(--crm-blue)" : "1px solid var(--crm-line-2)"
    }
  }, b))))));
}
function PipelineTable() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "26px 28px",
      display: "flex",
      flexDirection: "column",
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 16,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(DisplayHeading, {
    as: "h1",
    size: 28
  }, "Family pipeline"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Add family")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(FilterChip, {
    active: true
  }, "ALL STAGES"), /*#__PURE__*/React.createElement(FilterChip, null, "NEEDS ATTENTION"), /*#__PURE__*/React.createElement(FilterChip, null, "AMBASSADOR"), /*#__PURE__*/React.createElement(FilterChip, null, "NO CASL")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--white)",
      border: "1px solid var(--crm-line)",
      borderRadius: "var(--radius-card-crm)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      fontFamily: "var(--font-sans)",
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: "left"
    }
  }, ["Family", "Stage", "Heat", "Source", "Consent", "Last touch", "Next action"].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      letterSpacing: "0.1em",
      color: "var(--muted)",
      fontWeight: 500,
      padding: "12px 16px",
      borderBottom: "1px solid var(--crm-line)"
    }
  }, h.toUpperCase())))), /*#__PURE__*/React.createElement("tbody", null, PIPELINE_ROWS.map(r => /*#__PURE__*/React.createElement("tr", {
    key: r.fam,
    style: {
      borderBottom: "1px solid var(--crm-line)"
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 100,
      background: "var(--paper-2)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 11,
      fontWeight: 600
    }
  }, r.fam[0]), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, r.fam), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--muted)"
    }
  }, r.kids)))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement(StatusPill, {
    tone: r.tone
  }, r.stage)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement(HeatPips, {
    value: r.heat
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: r.source.startsWith("AMB") ? "var(--red)" : "var(--ink-soft)"
    }
  }, r.source)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, r.consent ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--green)",
      fontWeight: 600
    }
  }, "\u2713") : /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      color: "#fff",
      background: "var(--amber)",
      padding: "3px 8px",
      borderRadius: 100
    }
  }, "NO CASL")), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: r.touchTone
    }
  }, r.touch)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: "14px 16px",
      maxWidth: 220,
      color: "var(--ink-soft)",
      fontSize: 12.5
    }
  }, r.next)))))));
}
function CrmApp() {
  const [tab, setTab] = React.useState("Dossiers");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      color: "var(--ink)",
      minHeight: "100vh",
      background: "var(--crm-bg)"
    }
  }, /*#__PURE__*/React.createElement(Chrome, {
    tab: tab,
    setTab: setTab
  }), tab === "Pipeline" ? /*#__PURE__*/React.createElement(PipelineTable, null) : /*#__PURE__*/React.createElement(DossierQueue, null));
}
window.CrmApp = CrmApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/staff-crm/CrmScreen.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.DisplayHeading = __ds_scope.DisplayHeading;

__ds_ns.Kicker = __ds_scope.Kicker;

__ds_ns.SeatsDot = __ds_scope.SeatsDot;

__ds_ns.Wordmark = __ds_scope.Wordmark;

__ds_ns.FaqItem = __ds_scope.FaqItem;

__ds_ns.FeatureCard = __ds_scope.FeatureCard;

__ds_ns.GroupCard = __ds_scope.GroupCard;

__ds_ns.StatCard = __ds_scope.StatCard;

__ds_ns.TestimonialCard = __ds_scope.TestimonialCard;

__ds_ns.FilterChip = __ds_scope.FilterChip;

__ds_ns.HeatPips = __ds_scope.HeatPips;

__ds_ns.PitchCard = __ds_scope.PitchCard;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.TextField = __ds_scope.TextField;

})();
