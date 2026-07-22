"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { Icon } from "@/app/path/components/system/Icon";
import { signInStudent } from "@/app/path/lib/actions/sign-in";
import { signInParent } from "@/app/path/lib/actions/parent-sign-in";
import { cn } from "@/app/path/components/system/cn";

/**
 * Two doors on one form (T1 Unit 6 + Unit 15): the STUDENT tab is name +
 * password, nothing else — the system email never exists client-side. The
 * PARENT tab is a plain email + password against the parent's EXISTING account
 * (their 2026-27 application credentials). The toggle keeps the page static.
 *
 * The awaited actions are wrapped in try/catch/finally per the repo's
 * frozen-modal learning: an action can REJECT (not just return
 * {success:false}) and the busy flag must clear on every exit path, or the
 * form locks forever. Error copy comes from the server verbatim — it is
 * deliberately generic there (no account enumeration), so nothing is added or
 * specialized here.
 */
export default function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"student" | "parent">("student");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: "student" | "parent") => {
    if (busy || next === mode) return;
    setMode(next);
    setError(null);
    setPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "student"
          ? await signInStudent({ name, password })
          : await signInParent({ email, password });
      if (result.success) {
        // Parents land on their family dashboard; students on the journey.
        router.push(mode === "parent" ? "/path/family" : "/path");
        router.refresh();
        return; // finally still clears busy
      }
      setError(result.error);
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3.5 font-path-body text-sm text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";
  const tabCls = (active: boolean) =>
    cn(
      "flex-1 rounded-lg px-3 py-2 font-path-body text-[13px] font-semibold transition-colors",
      active ? "bg-hq-canvas text-hq-ink shadow-hq" : "text-hq-ink-soft hover:text-hq-ink"
    );

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
      <div
        className="flex rounded-xl border border-hq-border bg-hq-sunken p-1"
        role="tablist"
        aria-label="Who's signing in"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "student"}
          className={tabCls(mode === "student")}
          onClick={() => switchMode("student")}
        >
          Student
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "parent"}
          className={tabCls(mode === "parent")}
          onClick={() => switchMode("parent")}
        >
          Parent
        </button>
      </div>

      {mode === "student" ? (
        <label className="block" htmlFor="path-name">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Your name
          </span>
          <input
            id="path-name"
            type="text"
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="username"
            autoCapitalize="words"
            spellCheck={false}
            required
          />
        </label>
      ) : (
        <label className="block" htmlFor="path-email">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Your email
          </span>
          <input
            id="path-email"
            type="email"
            className={inputCls}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            spellCheck={false}
            required
          />
        </label>
      )}

      <label className="block" htmlFor="path-password">
        <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Your password
        </span>
        <input
          id="path-password"
          type="password"
          className={inputCls}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        skin="hq"
        size="lg"
        className="w-full"
        disabled={busy}
        icon={<Icon name="arrow-right" size={18} />}
      >
        {busy ? "Signing in…" : "Sign in"}
      </Button>

      {mode === "parent" && (
        <p className="text-center font-path-body text-xs leading-5 text-hq-ink-muted">
          Same account you applied with.{" "}
          <a href="/dashboard" className="underline underline-offset-2 hover:text-hq-ink">
            Forgot password?
          </a>
        </p>
      )}
    </form>
  );
}
