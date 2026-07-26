/* @ds-bundle: {"format":4,"namespace":"ThePathDesignSystem_05a7ec","components":[{"name":"Crest","sourcePath":"components/awards/Crest.jsx"},{"name":"Seal","sourcePath":"components/awards/Seal.jsx"},{"name":"PhaseSealCelebration","sourcePath":"components/celebration/PhaseSealCelebration.jsx"},{"name":"PhaseRow","sourcePath":"components/ledger/PhaseRow.jsx"},{"name":"PHASES","sourcePath":"components/lib/phases.js"},{"name":"PHASE_HSL","sourcePath":"components/lib/phases.js"},{"name":"Button","sourcePath":"components/primitives/Button.jsx"},{"name":"Icon","sourcePath":"components/primitives/Icon.jsx"},{"name":"ICON_NAMES","sourcePath":"components/primitives/Icon.jsx"},{"name":"SkinToggle","sourcePath":"components/primitives/SkinToggle.jsx"},{"name":"ReviewPanel","sourcePath":"components/review/ReviewPanel.jsx"},{"name":"ProgressMeter","sourcePath":"components/status/ProgressMeter.jsx"},{"name":"StatusChip","sourcePath":"components/status/StatusChip.jsx"},{"name":"HQTaskCard","sourcePath":"components/tasks/HQTaskCard.jsx"},{"name":"TrailStep","sourcePath":"components/tasks/TrailStep.jsx"},{"name":"MarginNote","sourcePath":"components/wisdom/MarginNote.jsx"},{"name":"WisdomCard","sourcePath":"components/wisdom/WisdomCard.jsx"}],"sourceHashes":{"components/awards/Crest.jsx":"bcb16e54bbfc","components/awards/Seal.jsx":"5564bc4f4230","components/celebration/PhaseSealCelebration.jsx":"c1c1f06b2281","components/ledger/PhaseRow.jsx":"738522d06f91","components/lib/phases.js":"159ed4307495","components/primitives/Button.jsx":"1b946ad07464","components/primitives/Icon.jsx":"f9cdd3672f45","components/primitives/SkinToggle.jsx":"2838335a0ff5","components/review/ReviewPanel.jsx":"5031e1f65e60","components/status/ProgressMeter.jsx":"19a51c72e3c0","components/status/StatusChip.jsx":"ab5219a299b9","components/tasks/HQTaskCard.jsx":"736e8a5d69fe","components/tasks/TrailStep.jsx":"5abf6168fa47","components/wisdom/MarginNote.jsx":"aae8c3f43b05","components/wisdom/WisdomCard.jsx":"3d7396f12f2e","ui_kits/hq/app.jsx":"dcdd5235bcda","ui_kits/hq/data.js":"052978ac6326","ui_kits/parent/app.jsx":"1c691d900669","ui_kits/parent/data.js":"200b6564dfc5","ui_kits/trail/app.jsx":"ecb9a9b165b6","ui_kits/trail/data.js":"a2a2f60f74aa"},"inlinedExternals":[],"unexposedExports":[{"name":"phaseAlpha","sourcePath":"components/lib/phases.js"},{"name":"phaseByKey","sourcePath":"components/lib/phases.js"},{"name":"phaseColor","sourcePath":"components/lib/phases.js"}]} */

(() => {

const __ds_ns = (window.ThePathDesignSystem_05a7ec = window.ThePathDesignSystem_05a7ec || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/lib/phases.js
try { (() => {
// THE PATH — the five phases are the spine of the whole system.
// Mechanics are constant across skins; only Trail vs HQ rendering differs.
// This is an internal helper (no .d.ts) imported by the components.

const PHASES = [{
  key: 'sell',
  index: 1,
  name: 'SELL',
  tagline: 'Learn to confidently sell anything.',
  territory: 'The Market Town'
}, {
  key: 'build',
  index: 2,
  name: 'BUILD',
  tagline: 'Make a real product with AI.',
  territory: 'The Workshop Quarter'
}, {
  key: 'validate',
  index: 3,
  name: 'VALIDATE',
  tagline: 'Test ideas like a scientist.',
  territory: 'The Observatory'
}, {
  key: 'grow',
  index: 4,
  name: 'GROW',
  tagline: 'Turn a validated idea into a running business.',
  territory: 'The Growing High Street'
}, {
  key: 'scale',
  index: 5,
  name: 'SCALE',
  tagline: 'Build systems so the business runs beyond them.',
  territory: 'The Summit City'
}];

// raw hsl channel refs, for inline styles / gradients / svg fills
const PHASE_HSL = {
  sell: 'var(--phase-sell)',
  build: 'var(--phase-build)',
  validate: 'var(--phase-validate)',
  grow: 'var(--phase-grow)',
  scale: 'var(--phase-scale)'
};
const phaseByKey = key => PHASES.find(p => p.key === key) || PHASES[0];

/** ready-to-use css color for a phase, e.g. hsl(var(--phase-sell)) */
const phaseColor = key => `hsl(${PHASE_HSL[key]})`;

/** phase color with an alpha, e.g. phaseAlpha('sell', 0.12) */
const phaseAlpha = (key, a) => `hsl(${PHASE_HSL[key]} / ${a})`;
Object.assign(__ds_scope, { PHASES, PHASE_HSL, phaseByKey, phaseColor, phaseAlpha });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/lib/phases.js", error: String((e && e.message) || e) }); }

// components/awards/Crest.jsx
try { (() => {
/**
 * Crest — the criterion achievement badge. One heraldic artwork lineage, two finishes:
 *   Trail → full-color illustrated heraldry mounted on the landmark
 *   HQ    → clean monochrome achievement mark on the trophy wall
 * so nothing feels lost when a student toggles skins (D4). 25 crests in all.
 */
function Crest({
  phase,
  criterion,
  skin = 'hq',
  size = 72,
  locked = false,
  className = ''
}) {
  const meta = __ds_scope.phaseByKey(phase);
  const color = __ds_scope.phaseColor(phase);
  const isTrail = skin === 'trail';
  const uid = ('crest-' + phase + '-' + (criterion || 'x')).replace(/\./g, '-');
  const stroke = locked ? 'hsl(var(--hq-border-strong))' : isTrail ? 'hsl(var(--trail-ink))' : color;
  const numeralColor = locked ? 'hsl(var(--hq-ink-muted))' : isTrail ? '#fff' : color;
  const numeral = criterion ? criterion.split('.')[1] || criterion : meta.index;
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-crest ' + className).trim(),
    title: `${meta.name} · ${criterion || meta.index}`
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    role: "img",
    "aria-label": `${meta.name} criterion ${criterion || ''} crest`,
    className: isTrail && !locked ? 'tp-crest__svg--trail' : undefined
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: uid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0",
    stopColor: color,
    stopOpacity: isTrail ? 0.95 : 0.14
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "1",
    stopColor: color,
    stopOpacity: isTrail ? 0.7 : 0.04
  }))), /*#__PURE__*/React.createElement("path", {
    d: "M50 6 L86 18 V50 C86 74 68 88 50 95 C32 88 14 74 14 50 V18 Z",
    fill: locked ? 'hsl(var(--hq-surface-sunken))' : `url(#${uid})`,
    stroke: stroke,
    strokeWidth: isTrail ? 3 : 2.5,
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 44 L50 30 L78 44",
    fill: "none",
    stroke: locked ? 'hsl(var(--hq-border-strong))' : isTrail ? '#fff' : color,
    strokeWidth: isTrail ? 3 : 2.25,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    opacity: 0.85
  }), /*#__PURE__*/React.createElement("text", {
    x: "50",
    y: "68",
    textAnchor: "middle",
    fontFamily: "Fraunces, serif",
    fontSize: "26",
    fontWeight: "700",
    fill: numeralColor
  }, numeral)));
}
Object.assign(__ds_scope, { Crest });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/awards/Crest.jsx", error: String((e && e.message) || e) }); }

// components/awards/Seal.jsx
try { (() => {
/**
 * Seal — the phase achievement mark. The report-card stamp, awarded 5 times.
 *   Trail → a large wax seal pressed on the gate between territories
 *   HQ    → a larger monochrome mark with completion date on the phase row
 * Pass `animate` to play the wax-press entrance (Tier 3 celebration).
 */
function Seal({
  phase,
  skin = 'hq',
  size = 96,
  sealed = true,
  date,
  animate = false,
  className = ''
}) {
  const meta = __ds_scope.phaseByKey(phase);
  const color = __ds_scope.phaseColor(phase);
  const isTrail = skin === 'trail';
  const ring = !sealed ? 'hsl(var(--hq-border-strong))' : isTrail ? 'hsl(var(--wax))' : color;
  const face = !sealed ? 'hsl(var(--hq-surface-sunken))' : isTrail ? 'hsl(var(--wax))' : `color-mix(in srgb, ${color} 12%, white)`;
  const text = !sealed ? 'hsl(var(--hq-ink-muted))' : isTrail ? '#fff' : color;
  const teeth = Array.from({
    length: 24
  });
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-seal ' + className).trim()
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 100 100",
    role: "img",
    "aria-label": `${meta.name} phase ${sealed ? 'sealed' : 'not sealed'}`,
    className: sealed && isTrail ? 'tp-seal__svg--trail' : undefined,
    style: animate ? {
      animation: 'tp-wax-press 0.7s var(--tp-ease-spring) both',
      transformOrigin: 'center'
    } : {
      transform: 'rotate(-6deg)'
    }
  }, teeth.map((_, i) => {
    const a = i / teeth.length * Math.PI * 2;
    const cx = 50 + Math.cos(a) * 44;
    const cy = 50 + Math.sin(a) * 44;
    return /*#__PURE__*/React.createElement("circle", {
      key: i,
      cx: cx,
      cy: cy,
      r: 5.5,
      fill: face,
      opacity: sealed ? 1 : 0.5
    });
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "50",
    cy: "50",
    r: "42",
    fill: face,
    stroke: ring,
    strokeWidth: "2.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "50",
    cy: "50",
    r: "34",
    fill: "none",
    stroke: ring,
    strokeWidth: "1.5",
    opacity: "0.6"
  }), /*#__PURE__*/React.createElement("text", {
    x: "50",
    y: "45",
    textAnchor: "middle",
    fontFamily: "Fraunces, serif",
    fontSize: "13",
    fontWeight: "700",
    letterSpacing: "1",
    fill: text
  }, meta.name), /*#__PURE__*/React.createElement("text", {
    x: "50",
    y: "63",
    textAnchor: "middle",
    fontFamily: "Spline Sans Mono, monospace",
    fontSize: "18",
    fontWeight: "500",
    fill: text
  }, "0", meta.index)), date ? /*#__PURE__*/React.createElement("span", {
    className: "tp-seal__date"
  }, date) : null);
}
Object.assign(__ds_scope, { Seal });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/awards/Seal.jsx", error: String((e && e.message) || e) }); }

// components/primitives/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the one action primitive both skins share.
 * HQ finish is crisp & squared; Trail finish is rounder & warmer.
 * Variants: primary (ink), secondary (outline), ghost (quiet), accent (phase color).
 */
function Button({
  skin = 'hq',
  variant = 'primary',
  size = 'md',
  phase,
  icon,
  className = '',
  style,
  children,
  ...props
}) {
  const cls = ['tp-btn', `tp-btn--${variant}`, `tp-btn--${size}`, `tp-btn--${skin}`, className].filter(Boolean).join(' ');
  const mergedStyle = phase ? {
    '--tp-accent': __ds_scope.phaseColor(phase),
    ...style
  } : style;
  return /*#__PURE__*/React.createElement("button", _extends({
    className: cls,
    style: mergedStyle
  }, props), icon, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/Button.jsx", error: String((e && e.message) || e) }); }

// components/primitives/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * THE PATH — Icon
 * The brand's iconography is Lucide (2px stroke, round caps & joins). Rather than
 * depend on a CDN at runtime, the design system inlines the subset it uses as SVG.
 * Pass a `name` from the set below; every icon inherits `currentColor`.
 */

const GLYPHS = {
  // brand / nav
  compass: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  })),
  map: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 5.764v15"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 3.236v15"
  })),
  dashboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    width: "7",
    height: "9",
    x: "3",
    y: "3",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    width: "7",
    height: "5",
    x: "14",
    y: "3",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    width: "7",
    height: "9",
    x: "14",
    y: "12",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    width: "7",
    height: "5",
    x: "3",
    y: "16",
    rx: "1"
  })),
  home: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "9 22 9 12 15 12 15 22"
  })),
  palette: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "13.5",
    cy: "6.5",
    r: ".5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "17.5",
    cy: "10.5",
    r: ".5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "8.5",
    cy: "7.5",
    r: ".5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "6.5",
    cy: "12.5",
    r: ".5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
  })),
  book: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12 7v14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
  })),
  // task states
  lock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    width: "18",
    height: "11",
    x: "3",
    y: "11",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 11V7a5 5 0 0 1 10 0v4"
  })),
  'circle-dashed': /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10",
    strokeDasharray: "2.6 3.2"
  }),
  'circle-dot': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "1",
    fill: "currentColor"
  })),
  clock: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "12 6 12 12 16 14"
  })),
  stamp: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M5 22h14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3c0 2 1 2 1 3.5V13"
  })),
  check: /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }),
  'check-check': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 7 17l-5-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m22 10-7.5 7.5L13 16"
  })),
  'circle-check': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 12 2 2 4-4"
  })),
  x: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m6 6 12 12"
  })),
  // evidence
  image: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    width: "18",
    height: "18",
    x: "3",
    y: "3",
    rx: "2",
    ry: "2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "9",
    r: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
  })),
  file: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 2v4a2 2 0 0 0 2 2h4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 9H8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 13H8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 17H8"
  })),
  link: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
  })),
  video: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m22 8-6 4 6 4V8Z"
  }), /*#__PURE__*/React.createElement("rect", {
    width: "14",
    height: "12",
    x: "2",
    y: "6",
    rx: "2",
    ry: "2"
  })),
  camera: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "13",
    r: "3"
  })),
  upload: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 8 12 3 7 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    x2: "12",
    y1: "3",
    y2: "15"
  })),
  text: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M17 6.1H3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12.1H3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15.1 18H3"
  })),
  eye: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })),
  // wisdom / celebration
  sparkles: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 3v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 5h-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 17v2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 18H3"
  })),
  quote: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"
  })),
  star: /*#__PURE__*/React.createElement("polygon", {
    points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
  }),
  party: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M5.8 11.3 2 22l10.7-3.79"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 3h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 8h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15 2h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 20h.01"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"
  })),
  calendar: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M8 2v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 2v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 10H3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21.29 14.7a2.43 2.43 0 0 0-2.65-.52c-.3.12-.57.3-.8.53l-.34.34-.35-.34a2.43 2.43 0 0 0-2.65-.53c-.3.12-.56.3-.79.53-.95.94-1 2.53.2 3.74L17.5 22l3.61-3.55c1.2-1.21 1.14-2.8.18-3.74Z"
  })),
  trophy: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 9h1.5a2.5 2.5 0 0 0 0-5H18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M4 22h16"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 2H6v7a6 6 0 0 0 12 0V2Z"
  })),
  // objects / trail
  backpack: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 10h8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 18h8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
  })),
  mountain: /*#__PURE__*/React.createElement("path", {
    d: "m8 3 4 8 5-5 5 15H2L8 3z"
  }),
  tent: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3.5 21 14 3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20.5 21 10 3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15.5 21 12 15l-3.5 6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 21h20"
  })),
  flag: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    x2: "4",
    y1: "22",
    y2: "15"
  })),
  'map-pin': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "10",
    r: "3"
  })),
  // ui / actions
  radio: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M4.9 19.1C1 15.2 1 8.8 4.9 4.9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.1 4.9C23 8.8 23 15.1 19.1 19"
  })),
  'arrow-right': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m12 5 7 7-7 7"
  })),
  'arrow-left': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m12 19-7-7 7-7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19 12H5"
  })),
  'chevron-right': /*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  }),
  'chevron-down': /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  }),
  'chevron-left': /*#__PURE__*/React.createElement("path", {
    d: "m15 18-6-6 6-6"
  }),
  plus: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M5 12h14"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 5v14"
  })),
  bell: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10.3 21a1.94 1.94 0 0 0 3.4 0"
  })),
  users: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "9",
    cy: "7",
    r: "4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M22 21v-2a4 4 0 0 0-3-3.87"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 3.13a4 4 0 0 1 0 7.75"
  })),
  user: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "8",
    r: "5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 21a8 8 0 0 0-16 0"
  })),
  settings: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  })),
  filter: /*#__PURE__*/React.createElement("polygon", {
    points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"
  }),
  send: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21.854 2.147-10.94 10.939"
  })),
  clipboard: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    width: "8",
    height: "4",
    x: "8",
    y: "2",
    rx: "1",
    ry: "1"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 14 2 2 4-4"
  })),
  'help-circle': /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 17h.01"
  })),
  menu: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "4",
    x2: "20",
    y1: "6",
    y2: "6"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    x2: "20",
    y1: "12",
    y2: "12"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "4",
    x2: "20",
    y1: "18",
    y2: "18"
  }))
};
function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  className = '',
  style,
  title,
  ...rest
}) {
  const glyph = GLYPHS[name];
  return /*#__PURE__*/React.createElement("svg", _extends({
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: ('tp-icon ' + className).trim(),
    style: style,
    role: title ? 'img' : undefined,
    "aria-hidden": title ? undefined : true,
    "aria-label": title
  }, rest), title ? /*#__PURE__*/React.createElement("title", null, title) : null, glyph || null);
}

/** the names available in this build, for consumers who want to enumerate */
const ICON_NAMES = Object.keys(GLYPHS);
Object.assign(__ds_scope, { Icon, ICON_NAMES });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/Icon.jsx", error: String((e && e.message) || e) }); }

// components/celebration/PhaseSealCelebration.jsx
try { (() => {
/**
 * PhaseSealCelebration — Tier 3, the big one. Shared structure in both skins:
 * the seal presses, a montage of the phase's own real evidence, the real numbers,
 * and the real-world celebration prompt. Trail plays it cinematic; HQ plays it
 * like closing a funding round — neither skin underplays it.
 */
function PhaseSealCelebration({
  phase,
  skin = 'hq',
  stats = [],
  montage = [],
  onCelebrate,
  onContinue,
  className = ''
}) {
  const meta = __ds_scope.phaseByKey(phase);
  const color = __ds_scope.phaseColor(phase);
  const isTrail = skin === 'trail';
  const next = __ds_scope.PHASES.find(p => p.index === meta.index + 1);
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-celebrate' + (isTrail ? ' tp-celebrate--trail' : '') + ' ' + className).trim(),
    style: {
      '--tp-accent': color
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-anim-rise",
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-celebrate__eyebrow"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "party",
    size: 16
  }), " Phase sealed"), /*#__PURE__*/React.createElement(__ds_scope.Seal, {
    phase: phase,
    skin: skin,
    size: 120,
    animate: true,
    sealed: true
  }), /*#__PURE__*/React.createElement("h2", {
    className: 'tp-celebrate__title' + (isTrail ? ' tp-celebrate__title--trail' : '')
  }, isTrail ? `The gate is open. You finished ${meta.name}.` : `Phase 0${meta.index} · ${meta.name} sealed.`), /*#__PURE__*/React.createElement("p", {
    className: "tp-celebrate__tagline"
  }, meta.tagline), montage.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "tp-celebrate__montage"
  }, montage.slice(0, 4).map((src, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "tp-celebrate__frame"
  }, /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: ""
  })))) : null, stats.length > 0 ? /*#__PURE__*/React.createElement("div", {
    className: "tp-celebrate__stats"
  }, stats.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: 'tp-celebrate__stat' + (isTrail ? ' tp-celebrate__stat--trail' : '')
  }, /*#__PURE__*/React.createElement("div", {
    className: 'tp-celebrate__statval' + (isTrail ? ' tp-celebrate__statval--trail' : '')
  }, s.value), /*#__PURE__*/React.createElement("div", {
    className: "tp-celebrate__statlabel"
  }, s.label)))) : null, /*#__PURE__*/React.createElement("div", {
    className: "tp-celebrate__actions"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    skin: skin,
    variant: "secondary",
    style: {
      flex: 1
    },
    onClick: onCelebrate,
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "calendar",
      size: 16
    })
  }, "This deserves a dinner"), next ? /*#__PURE__*/React.createElement(__ds_scope.Button, {
    skin: skin,
    style: {
      flex: 1
    },
    onClick: onContinue,
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "Open ", next.name) : null)));
}
Object.assign(__ds_scope, { PhaseSealCelebration });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/celebration/PhaseSealCelebration.jsx", error: String((e && e.message) || e) }); }

// components/primitives/SkinToggle.jsx
try { (() => {
/**
 * SkinToggle — the student's control to flip between Trail and HQ.
 * No data consequences; the choice belongs to the student. Everything earned
 * carries across the toggle — same badge, same progress, two renderings.
 */
function SkinToggle({
  value,
  onChange,
  className = ''
}) {
  const options = [{
    key: 'trail',
    label: 'Trail',
    icon: 'map'
  }, {
    key: 'hq',
    label: 'HQ',
    icon: 'dashboard'
  }];
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    "aria-label": "Skin",
    className: ('tp-skintoggle ' + className).trim()
  }, options.map(o => {
    const active = value === o.key;
    return /*#__PURE__*/React.createElement("button", {
      key: o.key,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(o.key),
      className: 'tp-skintoggle__opt' + (active ? ' tp-skintoggle__opt--active' : '')
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: o.icon,
      size: 16
    }), o.label);
  }));
}
Object.assign(__ds_scope, { SkinToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/primitives/SkinToggle.jsx", error: String((e && e.message) || e) }); }

// components/review/ReviewPanel.jsx
try { (() => {
const KIND_ICON = {
  photo: 'image',
  video: 'video',
  log: 'file',
  link: 'link',
  audio: 'radio',
  document: 'file',
  text: 'text'
};

/**
 * ReviewPanel — the parent's split view. Evidence on one side, the Done-when line
 * and band bar on the other, so the parent holds the right bar. Verifying is one
 * tap; Not Yet requires a note. Built to make verifying easier than doing the work.
 */
function ReviewPanel({
  taskId,
  title,
  doneWhen,
  bandVariant,
  phase,
  evidence = [],
  reviewer = 'You',
  onVerify,
  onNotYet,
  className = ''
}) {
  const color = __ds_scope.phaseColor(phase);
  return /*#__PURE__*/React.createElement("section", {
    className: ('tp-review ' + className).trim(),
    style: {
      '--tp-accent': color
    },
    "aria-label": `Review ${taskId}`
  }, /*#__PURE__*/React.createElement("header", {
    className: "tp-review__head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "tp-review__id"
  }, taskId), /*#__PURE__*/React.createElement("h3", {
    className: "tp-review__title"
  }, title)), /*#__PURE__*/React.createElement("span", {
    className: "tp-review__reviewer"
  }, "Reviewer: ", reviewer)), /*#__PURE__*/React.createElement("div", {
    className: "tp-review__grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-review__col"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-eyebrow"
  }, "Evidence"), /*#__PURE__*/React.createElement("ul", {
    className: "tp-review__evlist"
  }, evidence.map((e, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    className: "tp-review__ev"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-review__evicon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: KIND_ICON[e.kind] || 'file',
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "tp-review__evlabel"
  }, e.label))))), /*#__PURE__*/React.createElement("div", {
    className: "tp-review__col"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-eyebrow"
  }, "Does this clear the bar?"), /*#__PURE__*/React.createElement("div", {
    className: "tp-review__bar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-donewhen__label"
  }, "Done when"), /*#__PURE__*/React.createElement("p", {
    className: "tp-donewhen__text"
  }, doneWhen)), bandVariant ? /*#__PURE__*/React.createElement("p", {
    className: "tp-task__band",
    style: {
      marginTop: '0.75rem'
    }
  }, /*#__PURE__*/React.createElement("b", null, "Hold this bar:"), " ", bandVariant) : null)), /*#__PURE__*/React.createElement("footer", {
    className: "tp-review__foot"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    skin: "hq",
    variant: "secondary",
    size: "md",
    onClick: onNotYet
  }, "Not yet \u2014 add a note"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    skin: "hq",
    size: "md",
    onClick: onVerify,
    icon: /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 16
    })
  }, "Verify")));
}
Object.assign(__ds_scope, { ReviewPanel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/review/ReviewPanel.jsx", error: String((e && e.message) || e) }); }

// components/status/ProgressMeter.jsx
try { (() => {
const DEFAULT_PER_PHASE = {
  sell: 25,
  build: 26,
  validate: 24,
  grow: 25,
  scale: 25
};

/**
 * ProgressMeter — the "n / 125 verified" bar. The credential, identical across ages.
 * No XP, no daily-login rewards — the only score is verified tasks. Fills phase-by-
 * phase in each phase's accent color so progress reads at a glance.
 */
function ProgressMeter({
  value,
  total = 125,
  perPhase = DEFAULT_PER_PHASE,
  label = 'verified',
  className = ''
}) {
  let remaining = value;
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-meter ' + className).trim()
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-meter__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-meter__count"
  }, /*#__PURE__*/React.createElement("b", null, value), " ", /*#__PURE__*/React.createElement("span", null, "/ ", total)), /*#__PURE__*/React.createElement("span", {
    className: "tp-meter__label"
  }, label)), /*#__PURE__*/React.createElement("div", {
    className: "tp-meter__track"
  }, __ds_scope.PHASES.map(p => {
    const count = perPhase[p.key] || 25;
    const filled = Math.max(0, Math.min(count, remaining));
    remaining -= count;
    const pct = filled / count * 100;
    return /*#__PURE__*/React.createElement("div", {
      key: p.key,
      className: "tp-meter__seg",
      title: `${p.name} — ${Math.round(filled)}/${count}`
    }, /*#__PURE__*/React.createElement("div", {
      className: "tp-meter__fill",
      style: {
        width: `${pct}%`,
        background: __ds_scope.phaseColor(p.key)
      }
    }));
  })));
}
Object.assign(__ds_scope, { ProgressMeter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/ProgressMeter.jsx", error: String((e && e.message) || e) }); }

// components/status/StatusChip.jsx
try { (() => {
const CONFIG = {
  locked: {
    label: 'Locked',
    icon: 'lock'
  },
  available: {
    label: 'Available',
    icon: 'circle-dashed'
  },
  in_progress: {
    label: 'In progress',
    icon: 'circle-dot'
  },
  submitted: {
    label: 'Awaiting review',
    icon: 'clock'
  },
  not_yet: {
    label: 'Not yet',
    icon: 'stamp'
  },
  verified: {
    label: 'Verified',
    icon: 'check'
  }
};

/**
 * StatusChip — the quiet verification status pill used throughout HQ and inside
 * review surfaces in both skins. "Not yet" is amber, never red: a task is never
 * failed, only not done yet.
 */
function StatusChip({
  state,
  label,
  className = ''
}) {
  const cfg = CONFIG[state] || CONFIG.available;
  return /*#__PURE__*/React.createElement("span", {
    className: `tp-chip tp-chip--${state} ${className}`.trim()
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: cfg.icon,
    size: 14,
    strokeWidth: 2.25
  }), label || cfg.label);
}
Object.assign(__ds_scope, { StatusChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/StatusChip.jsx", error: String((e && e.message) || e) }); }

// components/ledger/PhaseRow.jsx
try { (() => {
/**
 * PhaseRow — one row of the HQ progress ledger. Criteria as five segments, a task
 * tally, and the phase's status (including the formal review banner). Sequential
 * phases render dimmed until the prior one seals.
 */
function PhaseRow({
  phase,
  criteriaCleared = 0,
  tasksVerified = 0,
  tasksTotal = 25,
  status = 'active',
  sealedDate,
  reviewer,
  className = ''
}) {
  const meta = __ds_scope.phaseByKey(phase);
  const color = __ds_scope.phaseColor(phase);
  const dim = status === 'locked';
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-phaserow' + (dim ? ' tp-phaserow--locked' : '') + ' ' + className).trim(),
    style: {
      '--tp-accent': color
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-phaserow__head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.75rem'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-phaserow__id"
  }, "0", meta.index), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h3", {
    className: "tp-phaserow__name"
  }, meta.name), /*#__PURE__*/React.createElement("p", {
    className: "tp-phaserow__tagline"
  }, meta.tagline))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, status === 'sealed' ? /*#__PURE__*/React.createElement(__ds_scope.StatusChip, {
    state: "verified"
  }) : null, status === 'review' ? /*#__PURE__*/React.createElement("span", {
    className: "tp-phaserow__review"
  }, "Review in progress") : null, status === 'locked' ? /*#__PURE__*/React.createElement(__ds_scope.StatusChip, {
    state: "locked"
  }) : null, status === 'active' ? /*#__PURE__*/React.createElement("span", {
    className: "tp-phaserow__tally"
  }, /*#__PURE__*/React.createElement("b", null, tasksVerified), "/", tasksTotal) : null)), /*#__PURE__*/React.createElement("div", {
    className: "tp-phaserow__segs"
  }, Array.from({
    length: 5
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "tp-phaserow__seg"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-phaserow__segfill",
    style: {
      width: i < criteriaCleared ? '100%' : '0%'
    }
  })))), status === 'review' && reviewer ? /*#__PURE__*/React.createElement("p", {
    className: "tp-phaserow__meta"
  }, "Reviewer: ", reviewer, " \xB7 Countersign: Guide (pending)") : null, status === 'sealed' && sealedDate ? /*#__PURE__*/React.createElement("p", {
    className: "tp-phaserow__meta"
  }, "Sealed ", sealedDate) : null);
}
Object.assign(__ds_scope, { PhaseRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ledger/PhaseRow.jsx", error: String((e && e.message) || e) }); }

// components/tasks/HQTaskCard.jsx
try { (() => {
/**
 * HQ TaskCard — the founder's spec sheet. Task body, the Done-when line highlighted,
 * band variant, and a quiet status chip. Plain, confident, no cheerleading. The
 * prominent "Now" card (now) gets a colored spine and stronger elevation.
 */
function HQTaskCard({
  task,
  now = false,
  onOpen,
  className = ''
}) {
  const color = __ds_scope.phaseColor(task.phase);
  const actionLabel = task.state === 'not_yet' ? 'Resubmit' : task.state === 'verified' ? 'View evidence' : 'Open task';
  return /*#__PURE__*/React.createElement("article", {
    className: ('tp-task' + (now ? ' tp-task--now' : '') + ' ' + className).trim(),
    style: {
      '--tp-accent': color
    }
  }, now ? /*#__PURE__*/React.createElement("span", {
    className: "tp-task__nowbar",
    "aria-hidden": true
  }) : null, /*#__PURE__*/React.createElement("header", {
    className: "tp-task__head"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-task__id"
  }, task.id), task.liveMoment ? /*#__PURE__*/React.createElement("span", {
    className: "tp-task__live"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "radio",
    size: 12
  }), " Live moment") : null), /*#__PURE__*/React.createElement("h3", {
    className: "tp-task__title"
  }, task.title)), /*#__PURE__*/React.createElement(__ds_scope.StatusChip, {
    state: task.state
  })), /*#__PURE__*/React.createElement("p", {
    className: "tp-task__body"
  }, task.body), /*#__PURE__*/React.createElement("div", {
    className: "tp-donewhen"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-donewhen__label"
  }, "Done when"), /*#__PURE__*/React.createElement("p", {
    className: "tp-donewhen__text"
  }, task.doneWhen)), task.bandVariant ? /*#__PURE__*/React.createElement("p", {
    className: "tp-task__band"
  }, /*#__PURE__*/React.createElement("b", null, "Band variant:"), " ", task.bandVariant) : null, task.state === 'not_yet' && task.reviewNote ? /*#__PURE__*/React.createElement("div", {
    className: "tp-task__note"
  }, /*#__PURE__*/React.createElement("b", null, "Not yet."), " ", task.reviewNote) : null, task.state === 'verified' && task.verifierComment ? /*#__PURE__*/React.createElement("div", {
    className: "tp-task__comment"
  }, "\u201C", task.verifierComment, "\u201D") : null, onOpen && task.state !== 'locked' ? /*#__PURE__*/React.createElement("div", {
    className: "tp-task__actions"
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    skin: "hq",
    variant: now ? 'primary' : 'secondary',
    size: "sm",
    onClick: onOpen
  }, actionLabel)) : null);
}
Object.assign(__ds_scope, { HQTaskCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/HQTaskCard.jsx", error: String((e && e.message) || e) }); }

// components/tasks/TrailStep.jsx
try { (() => {
/**
 * TrailStep — a single step on the illustrated trail.
 *   locked    → mist        available/in_progress → the glowing current step
 *   submitted → a satchel resting on the step, shimmering while inspected
 *   verified  → a wax-stamp footprint
 */
function TrailStep({
  index,
  state,
  phase,
  label,
  onClick,
  className = ''
}) {
  const color = __ds_scope.phaseColor(phase);
  const isCurrent = state === 'available' || state === 'in_progress';
  const isVerified = state === 'verified';
  const isSubmitted = state === 'submitted' || state === 'not_yet';
  const isLocked = state === 'locked';
  const mod = isCurrent ? 'tp-step__btn--current' : isSubmitted ? 'tp-step__btn--submitted' : isVerified ? 'tp-step__btn--verified' : '';
  return /*#__PURE__*/React.createElement("div", {
    className: ('tp-step ' + className).trim()
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    disabled: isLocked,
    className: ('tp-step__btn ' + mod).trim(),
    style: {
      '--tp-accent': color
    },
    "aria-label": label || `Step ${index}`
  }, isLocked ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "lock",
    size: 20,
    style: {
      color: 'hsl(var(--trail-ink) / 0.3)'
    }
  }) : null, isCurrent ? /*#__PURE__*/React.createElement("span", {
    className: "tp-step__dot"
  }) : null, isSubmitted ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "backpack",
    size: 24,
    className: "tp-anim-shimmer",
    style: {
      color
    }
  }) : null, isVerified ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "stamp",
    size: 24,
    strokeWidth: 2.25,
    className: "tp-anim-stamp",
    style: {
      color: 'hsl(var(--wax))'
    }
  }) : null), /*#__PURE__*/React.createElement("span", {
    className: 'tp-step__label' + (isLocked ? ' tp-step__label--locked' : '')
  }, label || `Step ${index}`));
}
Object.assign(__ds_scope, { TrailStep });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tasks/TrailStep.jsx", error: String((e && e.message) || e) }); }

// components/wisdom/MarginNote.jsx
try { (() => {
/**
 * MarginNote — HQ rendering of an Almanac entry. A typographically beautiful
 * pull-quote that slides in contextually and collects into the Almanac. Same
 * content as the Trail WisdomCard, quieter finish.
 */
function MarginNote({
  entry,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: ('tp-marginnote tp-anim-slide-in ' + className).trim()
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "quote",
    size: 16,
    style: {
      color: 'hsl(var(--hq-ink-muted))'
    }
  }), /*#__PURE__*/React.createElement("p", {
    className: "tp-marginnote__quote"
  }, entry.text), /*#__PURE__*/React.createElement("p", {
    className: "tp-marginnote__cite"
  }, "\u2014 ", entry.attribution, entry.original ? /*#__PURE__*/React.createElement("span", null, " \xB7 The 120") : null));
}
Object.assign(__ds_scope, { MarginNote });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/wisdom/MarginNote.jsx", error: String((e && e.message) || e) }); }

// components/wisdom/WisdomCard.jsx
try { (() => {
/**
 * WisdomCard — Trail rendering. A collectible illustrated card that flutters down
 * after a meaningful moment and files itself into the satchel's card book (the
 * Almanac). Content is a real vetted quote or a "120 original".
 */
function WisdomCard({
  entry,
  favorited = false,
  onFavorite,
  className = ''
}) {
  return /*#__PURE__*/React.createElement("figure", {
    className: ('tp-wisdom tp-anim-flutter ' + className).trim()
  }, /*#__PURE__*/React.createElement("div", {
    className: "tp-wisdom__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-wisdom__tag"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "sparkles",
    size: 14
  }), " Wisdom"), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onFavorite,
    "aria-label": favorited ? 'Unfavorite' : 'Favorite',
    className: 'tp-wisdom__fav' + (favorited ? ' tp-wisdom__fav--on' : '')
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "star",
    size: 16,
    style: {
      fill: favorited ? 'currentColor' : 'none'
    }
  }))), /*#__PURE__*/React.createElement("blockquote", {
    className: "tp-wisdom__quote"
  }, "\u201C", entry.text, "\u201D"), /*#__PURE__*/React.createElement("figcaption", {
    className: "tp-wisdom__cite"
  }, "\u2014 ", entry.attribution, entry.original ? /*#__PURE__*/React.createElement("span", null, " \xB7 The 120") : null));
}
Object.assign(__ds_scope, { WisdomCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/wisdom/WisdomCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hq/app.jsx
try { (() => {
/* First Profit — HQ (founder dashboard) UI kit. Composes the design-system components. */
const {
  Button,
  Icon,
  StatusChip,
  ProgressMeter,
  PhaseRow,
  HQTaskCard,
  Crest,
  Seal,
  MarginNote
} = window.TP;
const D = window.HQ_DATA;
const {
  useState
} = React;
const NAV = [{
  key: 'home',
  label: 'First Profit',
  icon: 'home'
}, {
  key: 'file',
  label: 'Founder File',
  icon: 'file'
}, {
  key: 'trophy',
  label: 'Trophy Wall',
  icon: 'trophy'
}, {
  key: 'almanac',
  label: 'Almanac',
  icon: 'book'
}];
function Sidebar({
  view,
  setView
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "hq-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hq-brand__mark"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.svg",
    alt: "",
    style: {
      height: 20
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hq-brand__name"
  }, "First Profit"), /*#__PURE__*/React.createElement("div", {
    className: "hq-brand__sub"
  }, "HQ"))), /*#__PURE__*/React.createElement("nav", {
    className: "hq-nav"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.key,
    className: 'hq-nav__item' + (view === n.key ? ' is-active' : ''),
    onClick: () => setView(n.key)
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 18
  }), " ", n.label))), /*#__PURE__*/React.createElement("div", {
    className: "hq-side__foot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-meter-mini"
  }, /*#__PURE__*/React.createElement(ProgressMeter, {
    value: D.verified
  })), /*#__PURE__*/React.createElement("div", {
    className: "hq-user"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hq-user__av"
  }, D.student.initials), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hq-user__name"
  }, D.student.name), /*#__PURE__*/React.createElement("div", {
    className: "hq-user__band"
  }, D.student.band)))));
}
function Topbar({
  title,
  crumb
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "hq-top"
  }, /*#__PURE__*/React.createElement("div", null, crumb ? /*#__PURE__*/React.createElement("div", {
    className: "hq-top__crumb"
  }, crumb) : null, /*#__PURE__*/React.createElement("h1", {
    className: "hq-top__title"
  }, title)), /*#__PURE__*/React.createElement("div", {
    className: "hq-top__actions"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hq-iconbtn",
    title: "Notifications"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 18
  })), /*#__PURE__*/React.createElement("button", {
    className: "hq-iconbtn",
    title: "Settings"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 18
  }))));
}
function Home({
  onOpenTask,
  task
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-home"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-home__main"
  }, /*#__PURE__*/React.createElement("section", {
    className: "hq-now"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-now__label"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-dot",
    size: 14
  }), " Now"), /*#__PURE__*/React.createElement(HQTaskCard, {
    task: task,
    now: true,
    onOpen: onOpenTask
  })), /*#__PURE__*/React.createElement("section", null, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Your Path \u2014 ", /*#__PURE__*/React.createElement("span", null, D.verified, " of 125 verified")), /*#__PURE__*/React.createElement("div", {
    className: "hq-ledger"
  }, D.phases.map(p => /*#__PURE__*/React.createElement(PhaseRow, {
    key: p.key,
    phase: p.key,
    criteriaCleared: p.criteriaCleared,
    tasksVerified: p.tasksVerified,
    tasksTotal: p.tasksTotal,
    status: p.status,
    sealedDate: p.sealedDate,
    reviewer: p.reviewer
  }))))), /*#__PURE__*/React.createElement("aside", {
    className: "hq-home__rail"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-rail-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "From the Almanac"), /*#__PURE__*/React.createElement(MarginNote, {
    entry: D.wisdom
  })), /*#__PURE__*/React.createElement("div", {
    className: "hq-rail-card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "This phase"), /*#__PURE__*/React.createElement("div", {
    className: "hq-crestrow"
  }, D.crests.filter(c => c[0] === 'build').map(c => /*#__PURE__*/React.createElement(Crest, {
    key: c[1],
    phase: c[0],
    criterion: c[1],
    skin: "hq",
    size: 52,
    locked: !c[2]
  }))), /*#__PURE__*/React.createElement("p", {
    className: "hq-muted"
  }, "2 of 5 landmarks cleared in BUILD."))));
}
function TaskDetail({
  task,
  onBack,
  onSubmit,
  submitted
}) {
  const state = submitted ? 'submitted' : task.state;
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-detail"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hq-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 16
  }), " Back to First Profit"), /*#__PURE__*/React.createElement("div", {
    className: "hq-detail__grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-detail__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hq-mono"
  }, task.id), /*#__PURE__*/React.createElement(StatusChip, {
    state: state
  })), /*#__PURE__*/React.createElement("h2", {
    className: "hq-detail__title"
  }, task.title), /*#__PURE__*/React.createElement("p", {
    className: "hq-detail__body"
  }, task.body), /*#__PURE__*/React.createElement("div", {
    className: "tp-donewhen",
    style: {
      '--tp-accent': 'hsl(var(--phase-build))'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tp-donewhen__label"
  }, "Done when"), /*#__PURE__*/React.createElement("p", {
    className: "tp-donewhen__text"
  }, task.doneWhen)), /*#__PURE__*/React.createElement("p", {
    className: "hq-band"
  }, /*#__PURE__*/React.createElement("b", null, "Band variant:"), " ", task.bandVariant)), /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad",
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Evidence ", /*#__PURE__*/React.createElement("span", null, "\xB7 into the Founder File")), /*#__PURE__*/React.createElement("div", {
    className: "hq-ev"
  }, D.evidence.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "hq-ev__item"
  }, /*#__PURE__*/React.createElement("span", {
    className: "hq-ev__icon"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: e.kind === 'photo' ? 'image' : 'file',
    size: 16
  })), /*#__PURE__*/React.createElement("span", {
    className: "hq-ev__label"
  }, e.label), /*#__PURE__*/React.createElement(StatusChip, {
    state: "verified",
    label: "Attached"
  }))), /*#__PURE__*/React.createElement("button", {
    className: "hq-drop"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "upload",
    size: 16
  }), " Add photo, video, log or link")))), /*#__PURE__*/React.createElement("aside", {
    className: "hq-detail__side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Submit"), state === 'submitted' ? /*#__PURE__*/React.createElement("div", {
    className: "hq-submitted"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 18
  }), " Awaiting review \u2014 Dad notified.") : /*#__PURE__*/React.createElement("p", {
    className: "hq-muted",
    style: {
      marginBottom: 12
    }
  }, "When your evidence clears the Done-when line, submit it for a real adult to verify."), /*#__PURE__*/React.createElement("div", {
    className: "hq-actions"
  }, /*#__PURE__*/React.createElement(Button, {
    skin: "hq",
    variant: "secondary",
    size: "md",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "sparkles",
      size: 16
    })
  }, "Readiness check"), /*#__PURE__*/React.createElement(Button, {
    skin: "hq",
    variant: "accent",
    phase: "build",
    size: "md",
    onClick: onSubmit,
    disabled: state === 'submitted',
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "send",
      size: 16
    })
  }, state === 'submitted' ? 'Submitted' : 'Submit for review'))), /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Safety"), /*#__PURE__*/React.createElement("p", {
    className: "hq-muted"
  }, "A parent approves every outreach channel before any message is sent.")))));
}
function TrophyWall() {
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-trophy"
  }, /*#__PURE__*/React.createElement("section", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Seals \u2014 phases sealed"), /*#__PURE__*/React.createElement("div", {
    className: "hq-seals"
  }, D.seals.map(s => /*#__PURE__*/React.createElement(Seal, {
    key: s.key,
    phase: s.key,
    skin: "hq",
    size: 92,
    sealed: s.sealed,
    date: s.date
  })))), /*#__PURE__*/React.createElement("section", {
    className: "hq-card hq-pad",
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Crests \u2014 criteria cleared ", /*#__PURE__*/React.createElement("span", null, "\xB7 7 of 25")), /*#__PURE__*/React.createElement("div", {
    className: "hq-crestgrid"
  }, D.crests.map(c => /*#__PURE__*/React.createElement(Crest, {
    key: c[0] + c[1],
    phase: c[0],
    criterion: c[1],
    skin: "hq",
    size: 62,
    locked: !c[2]
  })))));
}
function Almanac() {
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-almanac"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "The Almanac ", /*#__PURE__*/React.createElement("span", null, "\xB7 wisdom you've collected")), /*#__PURE__*/React.createElement("div", {
    className: "hq-almanac__list"
  }, D.almanac.map((e, i) => /*#__PURE__*/React.createElement(MarginNote, {
    key: i,
    entry: e
  })))));
}
function FounderFile() {
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-file"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-card hq-pad"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hq-secttitle"
  }, "Founder File ", /*#__PURE__*/React.createElement("span", null, "\xB7 every piece of evidence, filterable")), /*#__PURE__*/React.createElement("div", {
    className: "hq-filebar"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hq-chip is-on"
  }, "All"), /*#__PURE__*/React.createElement("button", {
    className: "hq-chip"
  }, "SELL"), /*#__PURE__*/React.createElement("button", {
    className: "hq-chip"
  }, "BUILD"), /*#__PURE__*/React.createElement("button", {
    className: "hq-chip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "filter",
    size: 13
  }), " Type")), /*#__PURE__*/React.createElement("div", {
    className: "hq-filegrid"
  }, ['booth.jpg', 'doorstep.jpg', 'handoff.jpg', 'product.jpg'].map((f, i) => /*#__PURE__*/React.createElement("figure", {
    key: i,
    className: "hq-fileitem"
  }, /*#__PURE__*/React.createElement("img", {
    src: '../../assets/evidence/' + f,
    alt: ""
  }), /*#__PURE__*/React.createElement("figcaption", null, /*#__PURE__*/React.createElement("span", {
    className: "hq-mono"
  }, "1.", i + 1, ".", i + 2), " \xB7 verified"))))));
}
const TITLES = {
  home: ['First Profit', 'HQ · ' + D.student.name],
  file: ['Founder File', 'HQ'],
  trophy: ['Trophy Wall', 'HQ'],
  almanac: ['Almanac', 'HQ'],
  task: ['Current task', 'BUILD · Criterion 2.3']
};
function App() {
  const [view, setView] = useState('home');
  const [submitted, setSubmitted] = useState(false);
  const task = D.nowTask;
  const openTask = () => setView('task');
  const title = TITLES[view] || TITLES.home;
  return /*#__PURE__*/React.createElement("div", {
    className: "hq-app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    view: view === 'task' ? 'home' : view,
    setView: v => {
      setView(v);
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "hq-content"
  }, /*#__PURE__*/React.createElement(Topbar, {
    title: title[0],
    crumb: title[1]
  }), /*#__PURE__*/React.createElement("main", {
    className: "hq-scroll"
  }, view === 'home' && /*#__PURE__*/React.createElement(Home, {
    onOpenTask: openTask,
    task: submitted ? {
      ...task,
      state: 'submitted'
    } : task
  }), view === 'task' && /*#__PURE__*/React.createElement(TaskDetail, {
    task: task,
    submitted: submitted,
    onBack: () => setView('home'),
    onSubmit: () => setSubmitted(true)
  }), view === 'trophy' && /*#__PURE__*/React.createElement(TrophyWall, null), view === 'almanac' && /*#__PURE__*/React.createElement(Almanac, null), view === 'file' && /*#__PURE__*/React.createElement(FounderFile, null))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hq/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hq/data.js
try { (() => {
// First Profit — HQ UI kit sample data (fake, illustrative). Plain JS: sets window.HQ_DATA.
window.HQ_DATA = {
  student: {
    name: 'Maya Okafor',
    band: 'Grades 3–5',
    initials: 'M'
  },
  verified: 37,
  phases: [{
    key: 'sell',
    criteriaCleared: 5,
    tasksVerified: 25,
    tasksTotal: 25,
    status: 'sealed',
    sealedDate: 'Mar 12, 2026'
  }, {
    key: 'build',
    criteriaCleared: 2,
    tasksVerified: 12,
    tasksTotal: 26,
    status: 'active'
  }, {
    key: 'validate',
    criteriaCleared: 0,
    tasksVerified: 0,
    tasksTotal: 24,
    status: 'locked'
  }, {
    key: 'grow',
    criteriaCleared: 0,
    tasksVerified: 0,
    tasksTotal: 25,
    status: 'locked'
  }, {
    key: 'scale',
    criteriaCleared: 0,
    tasksVerified: 0,
    tasksTotal: 25,
    status: 'locked'
  }],
  nowTask: {
    id: '2.3.4',
    title: 'Contact 21–40 and tally',
    phase: 'build',
    state: 'available',
    body: 'Finish the 40-contact list, then tally the funnel: contacted → replied → interested → bought.',
    doneWhen: 'All 40 rows are complete and the four-number tally is written at the bottom.',
    bandVariant: 'Grades 3–5: parent sends written messages the child composed; child handles in-person contacts.'
  },
  criterionTasks: [{
    id: '2.3.1',
    title: 'Build the 40-contact list',
    phase: 'build',
    state: 'verified',
    doneWhen: 'The 40-row list exists and every channel is parent-approved for safety.',
    verifierComment: 'Nice mix — six neighbours and the whole robotics club.'
  }, {
    id: '2.3.2',
    title: 'Write & approve the outreach message',
    phase: 'build',
    state: 'verified',
    doneWhen: 'Approved scripts are filed, marked APPROVED with the date.'
  }, {
    id: '2.3.3',
    title: 'Contact 1–20',
    phase: 'build',
    state: 'verified',
    doneWhen: 'Rows 1–20 are complete.'
  }, {
    id: '2.3.4',
    title: 'Contact 21–40 and tally',
    phase: 'build',
    state: 'available',
    doneWhen: 'All 40 rows are complete and the four-number tally is written at the bottom.',
    body: 'Finish the list, then tally the funnel.'
  }, {
    id: '2.3.5',
    title: 'Design the marketing piece; pick its metric first',
    phase: 'build',
    state: 'locked',
    doneWhen: 'The finished piece and its pre-declared metric + target are filed.'
  }, {
    id: '2.3.6',
    title: 'Launch, measure, conclude',
    phase: 'build',
    state: 'locked',
    doneWhen: 'The metric reading and three-sentence conclusion are filed.'
  }],
  evidence: [{
    kind: 'log',
    label: '40-contact tracker — rows 1–34 filled',
    img: null
  }, {
    kind: 'photo',
    label: 'Booth sign-up sheet from Saturday',
    img: 'doorstep.jpg'
  }],
  // 25 crests, phase + criterion + earned
  crests: [['sell', '1.1', 1], ['sell', '1.2', 1], ['sell', '1.3', 1], ['sell', '1.4', 1], ['sell', '1.5', 1], ['build', '2.1', 1], ['build', '2.2', 1], ['build', '2.3', 0], ['build', '2.4', 0], ['build', '2.5', 0], ['validate', '3.1', 0], ['validate', '3.2', 0], ['validate', '3.3', 0], ['validate', '3.4', 0], ['validate', '3.5', 0], ['grow', '4.1', 0], ['grow', '4.2', 0], ['grow', '4.3', 0], ['grow', '4.4', 0], ['grow', '4.5', 0], ['scale', '5.1', 0], ['scale', '5.2', 0], ['scale', '5.3', 0], ['scale', '5.4', 0], ['scale', '5.5', 0]],
  seals: [{
    key: 'sell',
    sealed: true,
    date: 'Mar 2026'
  }, {
    key: 'build',
    sealed: false
  }, {
    key: 'validate',
    sealed: false
  }, {
    key: 'grow',
    sealed: false
  }, {
    key: 'scale',
    sealed: false
  }],
  wisdom: {
    text: 'Contact forty. The funnel does not lie — it just tells you how many no\u2019s stand between you and a yes.',
    attribution: 'The 120'
  },
  almanac: [{
    text: 'Price is what you pay. Value is what you get.',
    attribution: 'Warren Buffett'
  }, {
    text: 'A no is not a door closing. It is a map telling you where the wall is.',
    attribution: 'The 120'
  }, {
    text: 'Make something people want.',
    attribution: 'Paul Graham'
  }, {
    text: 'The margin is the story the price tells about the work.',
    attribution: 'The 120'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hq/data.js", error: String((e && e.message) || e) }); }

// ui_kits/parent/app.jsx
try { (() => {
/* First Profit — Parent (verifier) UI kit. The grounded interface parents always see.
   Built around the Review Queue: verifying is one tap; Not Yet requires a note. */
const {
  ReviewPanel,
  StatusChip,
  Button,
  Icon,
  PhaseRow
} = window.TP;
const D = window.PARENT_DATA;
const {
  useState
} = React;
const NAV = [{
  key: 'queue',
  label: 'Review Queue',
  icon: 'clipboard'
}, {
  key: 'family',
  label: 'Children',
  icon: 'users'
}, {
  key: 'schedule',
  label: 'Schedule',
  icon: 'calendar'
}, {
  key: 'settings',
  label: 'Settings',
  icon: 'settings'
}];
function Sidebar({
  view,
  setView,
  pending
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "pa-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-brand__mark"
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.svg",
    alt: "",
    style: {
      height: 20
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pa-brand__name"
  }, "First Profit"), /*#__PURE__*/React.createElement("div", {
    className: "pa-brand__sub"
  }, "Parent"))), /*#__PURE__*/React.createElement("nav", {
    className: "pa-nav"
  }, NAV.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.key,
    className: 'pa-nav__item' + (view === n.key ? ' is-active' : ''),
    onClick: () => setView(n.key)
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-nav__l"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 18
  }), " ", n.label), n.key === 'queue' && pending > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "pa-badge"
  }, pending) : null))), /*#__PURE__*/React.createElement("div", {
    className: "pa-side__foot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-user"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-user__av"
  }, D.parent.initials), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pa-user__name"
  }, D.parent.name), /*#__PURE__*/React.createElement("div", {
    className: "pa-user__role"
  }, "Verifier \xB7 2 children")))));
}
function Queue({
  items,
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-queue"
  }, /*#__PURE__*/React.createElement("p", {
    className: "pa-lead"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 15
  }), " Submissions arrive in real time. Open each one to check the evidence against the Done-when line."), items.length === 0 ? /*#__PURE__*/React.createElement("div", {
    className: "pa-empty"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-check",
    size: 28
  }), /*#__PURE__*/React.createElement("p", null, "All caught up. Nothing waiting.")) : /*#__PURE__*/React.createElement("div", {
    className: "pa-qlist"
  }, items.map((it, i) => /*#__PURE__*/React.createElement("button", {
    key: it.taskId + i,
    className: "pa-qrow",
    onClick: () => onOpen(i),
    style: {
      '--tp-accent': 'hsl(var(--phase-' + it.phase + '))'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__spine"
  }), /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__av"
  }, it.child[0]), /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__main"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__top"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-mono"
  }, it.taskId), " \xB7 ", it.child, " ", /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__band"
  }, it.band)), /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__title"
  }, it.title)), /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__meta"
  }, /*#__PURE__*/React.createElement(StatusChip, {
    state: "submitted"
  }), /*#__PURE__*/React.createElement("span", {
    className: "pa-qrow__ago"
  }, it.ago)), /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 18
  })))));
}
function Review({
  item,
  onVerify,
  onNotYet,
  onBack
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-review"
  }, /*#__PURE__*/React.createElement("button", {
    className: "pa-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 16
  }), " Back to queue"), /*#__PURE__*/React.createElement(ReviewPanel, {
    taskId: item.taskId,
    title: item.title,
    phase: item.phase,
    reviewer: D.parent.name,
    doneWhen: item.doneWhen,
    bandVariant: item.bandVariant,
    evidence: item.evidence,
    onVerify: onVerify,
    onNotYet: () => setNoting(true)
  }), noting ? /*#__PURE__*/React.createElement("div", {
    className: "pa-note"
  }, /*#__PURE__*/React.createElement("label", {
    className: "pa-note__label"
  }, "Not Yet needs a note \u2014 point at the Done-when line, warmly."), /*#__PURE__*/React.createElement("textarea", {
    className: "pa-note__ta",
    rows: "2",
    value: note,
    onChange: e => setNote(e.target.value),
    placeholder: "e.g. The tally is missing the 'interested' number \u2014 add it and resubmit."
  }), /*#__PURE__*/React.createElement("div", {
    className: "pa-note__actions"
  }, /*#__PURE__*/React.createElement(Button, {
    skin: "hq",
    variant: "ghost",
    size: "sm",
    onClick: () => setNoting(false)
  }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
    skin: "hq",
    variant: "secondary",
    size: "sm",
    disabled: !note.trim(),
    onClick: () => onNotYet(note)
  }, "Send Not Yet"))) : null);
}
function PhaseStrip({
  phases
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-strip"
  }, phases.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.key,
    className: "pa-strip__cell",
    title: p.key,
    style: {
      '--tp-accent': 'hsl(var(--phase-' + p.key + '))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-strip__bar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-strip__fill",
    style: {
      width: p.criteriaCleared / 5 * 100 + '%'
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "pa-strip__st"
  }, p.status === 'sealed' ? /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 11
  }) : p.status === 'review' ? 'review' : p.status === 'active' ? p.criteriaCleared + '/5' : ''))));
}
function Family() {
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-family"
  }, /*#__PURE__*/React.createElement("p", {
    className: "pa-lead"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "users",
    size: 15
  }), " Every child, one Path each. You see progress and wins across the family \u2014 never one sibling's private evidence in another's view."), /*#__PURE__*/React.createElement("div", {
    className: "pa-children"
  }, D.children.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.name,
    className: "pa-child"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-child__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "pa-child__av"
  }, c.initials), /*#__PURE__*/React.createElement("div", {
    className: "pa-child__id"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pa-child__name"
  }, c.name), /*#__PURE__*/React.createElement("div", {
    className: "pa-child__band"
  }, c.band, " \xB7 ", c.skin)), c.pending > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "pa-child__pending"
  }, /*#__PURE__*/React.createElement(StatusChip, {
    state: "submitted",
    label: c.pending + ' to review'
  })) : null), /*#__PURE__*/React.createElement(PhaseStrip, {
    phases: c.phases
  }), /*#__PURE__*/React.createElement("div", {
    className: "pa-child__now"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-dot",
    size: 13
  }), " ", c.now)))));
}
function Stub({
  icon,
  title,
  body
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-stub"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 26
  }), /*#__PURE__*/React.createElement("h3", null, title), /*#__PURE__*/React.createElement("p", null, body));
}
function App() {
  const [view, setView] = useState('queue');
  const [queue, setQueue] = useState(D.queue);
  const [sel, setSel] = useState(null);
  const [toast, setToast] = useState(null);
  const flash = msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };
  const remove = i => setQueue(q => q.filter((_, idx) => idx !== i));
  const item = sel != null ? queue[sel] : null;
  const verify = () => {
    flash('Verified — ' + item.taskId + '. ' + item.child + ' notified.');
    remove(sel);
    setSel(null);
  };
  const notYet = () => {
    flash('Not Yet sent to ' + item.child + ' with your note.');
    remove(sel);
    setSel(null);
  };
  const titles = {
    queue: ['Review Queue', queue.length + ' waiting'],
    family: ['Children', '2 on First Profit'],
    schedule: ['Schedule', 'Demo Sessions & board meetings'],
    settings: ['Settings', 'Notifications · math gate · storage']
  };
  const t = sel != null ? ['Review', 'Evidence vs. the bar'] : titles[view] || titles.queue;
  return /*#__PURE__*/React.createElement("div", {
    className: "pa-app"
  }, /*#__PURE__*/React.createElement(Sidebar, {
    view: view,
    setView: v => {
      setSel(null);
      setView(v);
    },
    pending: queue.length
  }), /*#__PURE__*/React.createElement("div", {
    className: "pa-content"
  }, /*#__PURE__*/React.createElement("header", {
    className: "pa-top"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pa-top__crumb"
  }, t[1]), /*#__PURE__*/React.createElement("h1", {
    className: "pa-top__title"
  }, t[0])), view === 'queue' && sel == null ? /*#__PURE__*/React.createElement("span", {
    className: "pa-top__count"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 15
  }), " ", queue.length, " awaiting review") : null), /*#__PURE__*/React.createElement("main", {
    className: "pa-scroll"
  }, sel != null ? /*#__PURE__*/React.createElement(Review, {
    item: item,
    onVerify: verify,
    onNotYet: notYet,
    onBack: () => setSel(null)
  }) : view === 'queue' ? /*#__PURE__*/React.createElement(Queue, {
    items: queue,
    onOpen: setSel
  }) : view === 'family' ? /*#__PURE__*/React.createElement(Family, null) : view === 'schedule' ? /*#__PURE__*/React.createElement(Stub, {
    icon: "calendar",
    title: "Family Demo Sessions",
    body: "Schedule the every-other-Saturday demo, board meetings, and the Capstone Showcase. One-tap 1st/3rd-Saturday preset."
  }) : /*#__PURE__*/React.createElement(Stub, {
    icon: "settings",
    title: "Family settings",
    body: "Notification defaults (real-time on), the optional math gate (off by default), and storage plan live here."
  }))), toast ? /*#__PURE__*/React.createElement("div", {
    className: "pa-toast"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-check",
    size: 18
  }), " ", toast) : null);
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/parent/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/parent/data.js
try { (() => {
// First Profit — Parent (verifier) UI kit sample data. Sets window.PARENT_DATA.
window.PARENT_DATA = {
  parent: {
    name: 'Dad',
    initials: 'D'
  },
  queue: [{
    taskId: '2.3.4',
    title: 'Contact 21–40 and tally',
    child: 'Maya',
    band: 'Grades 3–5',
    phase: 'build',
    ago: '4m ago',
    doneWhen: 'All 40 rows are complete and the four-number tally is written at the bottom.',
    bandVariant: 'Grades 3–5: parent sends written messages the child composed; child handles in-person contacts.',
    evidence: [{
      kind: 'log',
      label: '40-contact tracker — all rows + tally'
    }, {
      kind: 'photo',
      label: 'Booth sign-up sheet, Saturday'
    }, {
      kind: 'text',
      label: 'Funnel: 40 contacted → 14 replied → 6 interested → 3 bought'
    }]
  }, {
    taskId: '4.5.5',
    title: 'Write the board memo',
    child: 'Dev',
    band: 'Grades 9–12',
    phase: 'grow',
    ago: '22m ago',
    doneWhen: 'The memo names what the board pushed on, what was conceded, and one commitment — and is sent.',
    bandVariant: 'Grades 9–12: child writes and sends.',
    evidence: [{
      kind: 'document',
      label: 'Board memo v2 (sent 8:14pm)'
    }, {
      kind: 'video',
      label: 'Board meeting recording — 11:32'
    }]
  }, {
    taskId: '2.2.5',
    title: 'The outside-reader test',
    child: 'Maya',
    band: 'Grades 3–5',
    phase: 'build',
    ago: '1h ago',
    doneWhen: 'A non-family reader says the gap and solution back accurately (parent witnesses).',
    bandVariant: 'Grades 3–5: as written.',
    evidence: [{
      kind: 'audio',
      label: "Neighbour's say-back, recorded"
    }, {
      kind: 'document',
      label: 'Final one-page brief'
    }]
  }],
  children: [{
    name: 'Maya',
    initials: 'M',
    band: 'Grades 3–5',
    skin: 'Trail',
    pending: 2,
    phases: [{
      key: 'sell',
      criteriaCleared: 5,
      status: 'sealed'
    }, {
      key: 'build',
      criteriaCleared: 2,
      status: 'active'
    }, {
      key: 'validate',
      criteriaCleared: 0,
      status: 'locked'
    }, {
      key: 'grow',
      criteriaCleared: 0,
      status: 'locked'
    }, {
      key: 'scale',
      criteriaCleared: 0,
      status: 'locked'
    }],
    now: '2.3.4 · Contact 21–40 and tally'
  }, {
    name: 'Dev',
    initials: 'D',
    band: 'Grades 9–12',
    skin: 'HQ',
    pending: 1,
    phases: [{
      key: 'sell',
      criteriaCleared: 5,
      status: 'sealed'
    }, {
      key: 'build',
      criteriaCleared: 5,
      status: 'sealed'
    }, {
      key: 'validate',
      criteriaCleared: 5,
      status: 'sealed'
    }, {
      key: 'grow',
      criteriaCleared: 5,
      status: 'review'
    }, {
      key: 'scale',
      criteriaCleared: 0,
      status: 'locked'
    }],
    now: 'Phase 04 · GROW — review underway'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/parent/data.js", error: String((e && e.message) || e) }); }

// ui_kits/trail/app.jsx
try { (() => {
/* First Profit — Trail (illustrated journey game) UI kit. Composes design-system components.
   The map here is a schematic of the illustrated world (final art would be commissioned —
   see the brief's open question on Trail's illustration identity). */
const {
  Crest,
  TrailStep,
  WisdomCard,
  PhaseSealCelebration,
  Button,
  Icon,
  ProgressMeter
} = window.TP;
const D = window.TRAIL_DATA;
const {
  useState
} = React;
function Avatar({
  size = 30
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "tl-avatar",
    style: {
      height: size,
      width: size
    }
  }, D.student.initials);
}
function Landmark({
  lm,
  phase,
  onOpen
}) {
  const cleared = lm.state === 'cleared';
  const current = lm.state === 'current';
  return /*#__PURE__*/React.createElement("div", {
    className: 'tl-lm' + (current ? ' is-current' : '')
  }, current ? /*#__PURE__*/React.createElement("div", {
    className: "tl-lm__avatar"
  }, /*#__PURE__*/React.createElement(Avatar, {
    size: 26
  })) : null, /*#__PURE__*/React.createElement("button", {
    className: "tl-lm__node",
    disabled: lm.state === 'locked',
    onClick: current ? onOpen : undefined,
    "aria-label": 'Landmark ' + lm.id
  }, /*#__PURE__*/React.createElement(Crest, {
    phase: phase,
    criterion: lm.id,
    skin: "trail",
    size: current ? 66 : 56,
    locked: lm.state === 'locked'
  })), lm.stage ? /*#__PURE__*/React.createElement("span", {
    className: "tl-lm__stage"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "flag",
    size: 11
  }), " stage") : null);
}
function TrailMap({
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "tl-map"
  }, /*#__PURE__*/React.createElement("header", {
    className: "tl-maphead"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "tl-eyebrow"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "map",
    size: 14
  }), " Your journey"), /*#__PURE__*/React.createElement("h1", {
    className: "tl-maptitle"
  }, "Five territories. ", D.distance.total, " steps in the real world.")), /*#__PURE__*/React.createElement("div", {
    className: "tl-distance"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-distance__meter"
  }, /*#__PURE__*/React.createElement(ProgressMeter, {
    value: D.distance.done
  })), /*#__PURE__*/React.createElement("span", {
    className: "tl-distance__cap"
  }, "distance travelled"))), /*#__PURE__*/React.createElement("div", {
    className: "tl-territories"
  }, D.territories.map(t => /*#__PURE__*/React.createElement("section", {
    key: t.key,
    className: 'tl-terr tl-terr--' + t.state,
    style: {
      '--tp-accent': 'hsl(var(--phase-' + t.key + '))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-terr__label"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tl-terr__badge"
  }, t.name), /*#__PURE__*/React.createElement("span", {
    className: "tl-terr__tag"
  }, t.tagline), t.state === 'mist' ? /*#__PURE__*/React.createElement("span", {
    className: "tl-terr__mist"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "lock",
    size: 12
  }), " mist \u2014 seal the phase before to reveal") : null), /*#__PURE__*/React.createElement("div", {
    className: "tl-path"
  }, t.landmarks.map(lm => /*#__PURE__*/React.createElement(Landmark, {
    key: lm.id,
    lm: lm,
    phase: t.key,
    onOpen: onOpen
  })))))));
}
function TrailLandmark({
  onBack,
  onSeal
}) {
  const L = D.landmark;
  const [steps, setSteps] = useState(L.steps);
  const advance = i => {
    setSteps(prev => prev.map((s, idx) => {
      if (idx === i && s.state === 'available') return {
        ...s,
        state: 'submitted'
      };
      return s;
    }));
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "tl-landmark"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tl-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 16
  }), " Back to the map"), /*#__PURE__*/React.createElement("div", {
    className: "tl-lmgrid"
  }, /*#__PURE__*/React.createElement("section", {
    className: "tl-scene"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-scene__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tl-terr__badge",
    style: {
      '--tp-accent': 'hsl(var(--phase-build))'
    }
  }, "The Workshop Quarter"), /*#__PURE__*/React.createElement("h2", {
    className: "tl-scene__title"
  }, "Landmark ", L.id), /*#__PURE__*/React.createElement("p", {
    className: "tl-scene__sub"
  }, L.title)), /*#__PURE__*/React.createElement("div", {
    className: "tl-steps"
  }, steps.map((s, i) => /*#__PURE__*/React.createElement(TrailStep, {
    key: i,
    index: i + 1,
    state: s.state,
    phase: "build",
    label: s.label,
    onClick: () => advance(i)
  }))), /*#__PURE__*/React.createElement("p", {
    className: "tl-hint"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "backpack",
    size: 14
  }), " Tap the glowing step to place your satchel \u2014 a parent inspects it, then the wax stamp lands.")), /*#__PURE__*/React.createElement("aside", {
    className: "tl-side"
  }, /*#__PURE__*/React.createElement(WisdomCard, {
    entry: D.wisdom,
    favorited: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "tl-satchel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tl-satchel__title"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "backpack",
    size: 16
  }), " Your satchel"), /*#__PURE__*/React.createElement("div", {
    className: "tl-satchel__shelf"
  }, ['booth.jpg', 'doorstep.jpg', 'product.jpg'].map((f, i) => /*#__PURE__*/React.createElement("img", {
    key: i,
    src: '../../assets/evidence/' + f,
    alt: ""
  }))), /*#__PURE__*/React.createElement("button", {
    className: "tl-sealbtn",
    onClick: onSeal
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "party",
    size: 15
  }), " Preview: seal a phase")))));
}
function TrailCelebration({
  onBack
}) {
  const C = D.celebration;
  return /*#__PURE__*/React.createElement("div", {
    className: "tl-celebrate"
  }, /*#__PURE__*/React.createElement("button", {
    className: "tl-back",
    onClick: onBack
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-left",
    size: 16
  }), " Back to the map"), /*#__PURE__*/React.createElement(PhaseSealCelebration, {
    phase: C.phase,
    skin: "trail",
    montage: C.montage.map(f => '../../assets/evidence/' + f),
    stats: C.stats,
    onCelebrate: () => {},
    onContinue: onBack
  }));
}
function App() {
  const [view, setView] = useState('map');
  return /*#__PURE__*/React.createElement("div", {
    className: "tl-app"
  }, view === 'map' && /*#__PURE__*/React.createElement(TrailMap, {
    onOpen: () => setView('landmark')
  }), view === 'landmark' && /*#__PURE__*/React.createElement(TrailLandmark, {
    onBack: () => setView('map'),
    onSeal: () => setView('celebrate')
  }), view === 'celebrate' && /*#__PURE__*/React.createElement(TrailCelebration, {
    onBack: () => setView('map')
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/trail/app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/trail/data.js
try { (() => {
// First Profit — Trail (journey game) UI kit sample data. Sets window.TRAIL_DATA.
window.TRAIL_DATA = {
  student: {
    name: 'Maya',
    initials: 'M'
  },
  distance: {
    done: 37,
    total: 125
  },
  // territories bottom-to-top of the journey; landmarks = criteria
  territories: [{
    key: 'sell',
    name: 'The Market Town',
    tagline: 'Learn to confidently sell anything.',
    state: 'cleared',
    landmarks: [{
      id: '1.1',
      state: 'cleared'
    }, {
      id: '1.2',
      state: 'cleared'
    }, {
      id: '1.3',
      state: 'cleared'
    }, {
      id: '1.4',
      state: 'cleared'
    }, {
      id: '1.5',
      state: 'cleared',
      stage: true
    }]
  }, {
    key: 'build',
    name: 'The Workshop Quarter',
    tagline: 'Make a real product with AI.',
    state: 'current',
    landmarks: [{
      id: '2.1',
      state: 'cleared'
    }, {
      id: '2.2',
      state: 'cleared'
    }, {
      id: '2.3',
      state: 'current'
    }, {
      id: '2.4',
      state: 'locked'
    }, {
      id: '2.5',
      state: 'locked',
      stage: true
    }]
  }, {
    key: 'validate',
    name: 'The Observatory',
    tagline: 'Test ideas like a scientist.',
    state: 'mist',
    landmarks: [{
      id: '3.1',
      state: 'locked'
    }, {
      id: '3.2',
      state: 'locked'
    }, {
      id: '3.3',
      state: 'locked'
    }, {
      id: '3.4',
      state: 'locked',
      stage: true
    }, {
      id: '3.5',
      state: 'locked'
    }]
  }, {
    key: 'grow',
    name: 'The Growing High Street',
    tagline: 'Turn a validated idea into a running business.',
    state: 'mist',
    landmarks: [{
      id: '4.1',
      state: 'locked'
    }, {
      id: '4.2',
      state: 'locked'
    }, {
      id: '4.3',
      state: 'locked'
    }, {
      id: '4.4',
      state: 'locked'
    }, {
      id: '4.5',
      state: 'locked',
      stage: true
    }]
  }, {
    key: 'scale',
    name: 'The Summit City',
    tagline: 'Build systems so the business runs beyond them.',
    state: 'mist',
    landmarks: [{
      id: '5.1',
      state: 'locked'
    }, {
      id: '5.2',
      state: 'locked'
    }, {
      id: '5.3',
      state: 'locked'
    }, {
      id: '5.4',
      state: 'locked'
    }, {
      id: '5.5',
      state: 'locked',
      stage: true
    }]
  }],
  // the current landmark (criterion 2.3) as a trail of steps
  landmark: {
    phase: 'build',
    id: '2.3',
    title: 'Contact 40 potential customers; launch one piece of marketing',
    steps: [{
      label: 'Build the 40-list',
      state: 'verified'
    }, {
      label: 'Write & approve the message',
      state: 'verified'
    }, {
      label: 'Contact 1–20',
      state: 'verified'
    }, {
      label: 'Contact 21–40 & tally',
      state: 'available'
    }, {
      label: 'Design the marketing piece',
      state: 'locked'
    }, {
      label: 'Launch, measure, conclude',
      state: 'locked'
    }]
  },
  wisdom: {
    text: 'A no is not a door closing. It is a map telling you where the wall is.',
    attribution: 'The 120'
  },
  celebration: {
    phase: 'sell',
    montage: ['booth.jpg', 'doorstep.jpg', 'handoff.jpg', 'product.jpg'],
    stats: [{
      value: '25',
      label: 'outreach'
    }, {
      value: '9',
      label: 'conversations'
    }, {
      value: '2',
      label: 'yeses'
    }]
  }
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/trail/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Crest = __ds_scope.Crest;

__ds_ns.Seal = __ds_scope.Seal;

__ds_ns.PhaseSealCelebration = __ds_scope.PhaseSealCelebration;

__ds_ns.PhaseRow = __ds_scope.PhaseRow;

__ds_ns.PHASES = __ds_scope.PHASES;

__ds_ns.PHASE_HSL = __ds_scope.PHASE_HSL;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.ICON_NAMES = __ds_scope.ICON_NAMES;

__ds_ns.SkinToggle = __ds_scope.SkinToggle;

__ds_ns.ReviewPanel = __ds_scope.ReviewPanel;

__ds_ns.ProgressMeter = __ds_scope.ProgressMeter;

__ds_ns.StatusChip = __ds_scope.StatusChip;

__ds_ns.HQTaskCard = __ds_scope.HQTaskCard;

__ds_ns.TrailStep = __ds_scope.TrailStep;

__ds_ns.MarginNote = __ds_scope.MarginNote;

__ds_ns.WisdomCard = __ds_scope.WisdomCard;

})();
