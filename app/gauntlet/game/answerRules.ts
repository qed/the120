/**
 * C6 — the answer-normalization layer, built once from gauntletcontent.md's
 * Input-format + Accepted-answer legends. Ten rules, closed set: each rule is
 * ONE comparison function; entries select a rule id, never custom acceptance.
 *
 * Submit model (per the legend): fixed-length `single-number` keeps the
 * length-based auto-judge; `multiple-choice`/`true-false` judge on tap;
 * every variable-length format (two-numbers, fraction, decimal,
 * short-expression) is Enter-to-submit.
 */

export type AnswerRule =
  | "int-exact"
  | "pair-unordered"
  | "pair-ordered"
  | "frac-lowest-terms"
  | "frac-any-equivalent"
  | "dec-exact"
  | "expr-commutative-ws"
  | "factored-commutative-ws"
  | "tf"
  | "mc";

export type EntryFormat =
  | "single-number"
  | "two-numbers"
  | "multiple-choice"
  | "short-expression"
  | "true-false"
  | "fraction"
  | "decimal";

/* ---------- shared normalization ---------- */

/** ASCII-fy: unicode minus/times from prompts or pads → plain tokens. */
const ascii = (s: string) => s.replace(/−/g, "-").replace(/×/g, "*").replace(/\s+/g, "");

/** `007` → `7`, `-0` → `0`, lone `0` kept. Returns null when not an integer. */
function normInt(s: string): string | null {
  const t = ascii(s);
  if (!/^-?\d+$/.test(t)) return null;
  const n = String(parseInt(t, 10));
  return n === "-0" ? "0" : n;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** Parse a/b (or a bare integer as a/1); sign moved to the numerator;
 *  denominator positive. Returns null on anything malformed. */
function parseFrac(s: string): { n: number; d: number } | null {
  const t = ascii(s);
  const parts = t.split("/");
  if (parts.length > 2) return null;
  const n = normInt(parts[0]);
  if (n === null) return null;
  if (parts.length === 1) return { n: Number(n), d: 1 };
  const d = normInt(parts[1]);
  if (d === null || Number(d) === 0) return null;
  const sign = Number(n) * Number(d) < 0 ? -1 : 1;
  return { n: sign * Math.abs(Number(n)), d: Math.abs(Number(d)) };
}

/**
 * Normalize a short expression for `expr-commutative-ws`: whitespace-free,
 * top-level `+`/`-` terms sorted (commutative addition), factors inside each
 * term sorted (commutative multiplication). NO other rewrite — no
 * distribution, no simplification, no exponent evaluation.
 */
function normExprTerms(s: string): string[] | null {
  const t = ascii(s).replace(/\*/g, "");
  if (!t || /[^0-9a-z^+\-()/.]/i.test(t)) return null;
  // split into signed top-level terms (parens depth-aware)
  const terms: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "+" || ch === "-") && depth === 0 && i > 0 && !"^+-*/(".includes(t[i - 1])) {
      terms.push(cur);
      cur = ch === "-" ? "-" : "";
    } else {
      cur += ch;
    }
  }
  terms.push(cur);
  if (depth !== 0) return null;
  // canonicalize each term: sign apart, factors (coefficient · var^exp parts) sorted
  const canon = terms.map((term) => {
    let sign = "";
    let body = term;
    if (body.startsWith("-")) {
      sign = "-";
      body = body.slice(1);
    } else if (body.startsWith("+")) {
      body = body.slice(1);
    }
    // factor split: leading number, then var^exp units (e.g. "6x^2y" → 6·x^2·y)
    const factors = body.match(/(\d+(\.\d+)?|[a-z](\^\d+)?|\([^()]*\))/gi);
    if (!factors || factors.join("") !== body) return sign + body; // unparseable — compare literally
    factors.sort();
    return sign + factors.join("·");
  });
  return canon.sort();
}

/* ---------- the ten rules ---------- */

export function judge(rule: AnswerRule, entered: string, answer: string): boolean {
  switch (rule) {
    case "int-exact": {
      const a = normInt(entered);
      return a !== null && a === normInt(answer);
    }
    case "pair-unordered":
    case "pair-ordered": {
      const pe = ascii(entered).split(",");
      const pa = ascii(answer).split(",");
      if (pe.length !== 2 || pa.length !== 2) return false;
      const [e1, e2] = pe.map(normInt);
      const [a1, a2] = pa.map(normInt);
      if (e1 === null || e2 === null || a1 === null || a2 === null) return false;
      if (rule === "pair-ordered") return e1 === a1 && e2 === a2;
      return (e1 === a1 && e2 === a2) || (e1 === a2 && e2 === a1);
    }
    case "frac-lowest-terms": {
      const e = parseFrac(entered);
      const a = parseFrac(answer);
      if (!e || !a) return false;
      // value-equal AND the entered form is in lowest terms
      return e.n * a.d === a.n * e.d && gcd(e.n, e.d) === 1;
    }
    case "frac-any-equivalent": {
      const e = parseFrac(entered);
      const a = parseFrac(answer);
      return !!e && !!a && e.n * a.d === a.n * e.d;
    }
    case "dec-exact": {
      const t = ascii(entered);
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return false;
      return Number(t) === Number(ascii(answer));
    }
    case "expr-commutative-ws": {
      const e = normExprTerms(entered);
      const a = normExprTerms(answer);
      return !!e && !!a && e.length === a.length && e.every((t, i) => t === a[i]);
    }
    case "factored-commutative-ws": {
      // top-level parenthesized factors, order-insensitive, expr rules inside
      // each; an optional bare integer coefficient factor is allowed (6(x+2)).
      const split = (s: string): string[] | null => {
        const t = ascii(s);
        const groups = t.match(/\([^()]*\)/g) ?? [];
        if (groups.length === 0) return null;
        const remainder = groups.reduce((acc, g) => acc.replace(g, ""), t);
        if (!/^\d*$/.test(remainder)) return null; // only a coefficient may sit outside parens
        const factors = groups.map((f) => (normExprTerms(f.slice(1, -1)) ?? []).join("|")).sort();
        const coef = remainder === "" ? "1" : String(parseInt(remainder, 10));
        return [coef, ...factors];
      };
      const e = split(entered);
      const a = split(answer);
      return !!e && !!a && e.length === a.length && e.every((f, i) => f === a[i]);
    }
    case "tf":
    case "mc":
      return entered === answer;
  }
}

/* ---------- input-surface helpers (one pipeline per format) ---------- */

/** Characters the typing surface accepts for a format (desktop filtering). */
export function allowedCharsRe(entry: EntryFormat): RegExp {
  switch (entry) {
    case "two-numbers":
      return /[^0-9,\-]/g;
    case "fraction":
      return /[^0-9/\-]/g;
    case "decimal":
      return /[^0-9.\-]/g;
    case "short-expression":
      return /[^0-9a-z^+\-*/() ]/gi;
    default:
      return /[^0-9\-]/g;
  }
}

/** Fixed-length single-number keeps the shipped auto-judge; the rest wait for Enter. */
export const isAutoSubmit = (entry: EntryFormat): boolean => entry === "single-number";

/** Extra pad keys for a format (beyond the digit grid). */
export function padExtras(entry: EntryFormat, alphabet?: string[]): string[] {
  switch (entry) {
    case "two-numbers":
      return [","];
    case "fraction":
      return ["/"];
    case "decimal":
      return ["."];
    case "short-expression":
      return alphabet ?? ["x", "^", "+", "-"];
    default:
      return [];
  }
}
