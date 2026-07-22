"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { Icon } from "@/app/path/components/system/Icon";
import { signInStudent } from "@/app/path/lib/actions/sign-in";

/**
 * Name + password, nothing else — the system email never exists client-side.
 * The awaited action is wrapped in try/catch/finally per the repo's
 * frozen-modal learning: the action can REJECT (not just return
 * {success:false}) and the busy flag must clear on every exit path, or the
 * form locks forever. Error copy comes from the server verbatim — it is
 * deliberately generic there (no account enumeration), so nothing is added or
 * specialized here.
 */
export default function SignInForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await signInStudent({ name, password });
      if (result.success) {
        router.push("/path");
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

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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
    </form>
  );
}
