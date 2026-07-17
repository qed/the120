---
title: "Env-less `next build` breaks two ways: render-time `supabaseBrowser()` throws in prerender, and a fetch to an `undefined/...` URL hangs the full 60s page timeout"
date: 2026-07-17
category: docs/solutions/build-issues
module: site-wide (seats, dashboard store, reset forms)
problem_type: build_issue
component: build
symptoms:
  - "Prerender error on a static page: '@supabase/ssr: Your project's URL and API key are required to create a Supabase client!'"
  - "Static generation of /, /scholars, /tuition fails with 'took more than 60 seconds' ×3 attempts — build exits, no error message"
root_cause: missing_guard
resolution_type: code_fix
severity: high
related_components:
  - supabase
---

# Env-less builds must stay green — two ways they broke

Local dev machines intentionally carry **no Supabase env** (`.env.local` has only
`GEMINI_API_KEY`); every Supabase surface is supposed to degrade gracefully.
Two patterns violated that and only bit locally (Vercel always has env, so CI
was green):

## 1. `useRef(supabaseBrowser())` — client created during render

A `useRef(initializer)` initializer runs during render — **including SSR/prerender
of static pages**. `createBrowserClient` throws without env, killing the page's
prerender. Found in `app/crm/reset/ResetForm.tsx`, `app/reset/ResetForm.tsx`,
`app/dashboard/store.tsx`.

**Fix — lazy ref, client created on first use (always in the browser):**

```tsx
const supabaseRef = useRef<ReturnType<typeof supabaseBrowser> | null>(null);
const getSupabase = () => (supabaseRef.current ??= supabaseBrowser());
// use getSupabase() inside effects/handlers only — never in render
```

## 2. `fetch(\`${undefined}/rest/v1/...\`)` — hangs, doesn't throw

`getSeatsRemaining()` interpolated `process.env.NEXT_PUBLIC_SUPABASE_URL` into
the fetch URL. Env-less, that's the string `"undefined/rest/v1/rpc/seats_claimed"` —
and in this Next fork's patched fetch, static generation **stalls on it for the
full 60s per-page timeout** (×3 retries) instead of throwing into the
`try/catch` fallback. Every static page calling it died: `/`, `/scholars`,
`/tuition`. The failure message ("took more than 60 seconds") never mentions
fetch, env, or Supabase — which is why it reads like a worker/machine problem.

**Fix — guard env before building the URL; fall back immediately:**

```ts
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) return SEATS_REMAINING;
```

## The rules

1. **Never call `supabaseBrowser()` (or any env-requiring constructor) in the
   render path** — module scope, component body, or a `useRef`/`useState`
   initializer. Lazy-create inside effects/handlers.
2. **Never interpolate a possibly-undefined env var into a fetch URL.** Guard
   and fall back first. A bad URL may *hang* prerender rather than throw —
   and a 60s-timeout build failure with no stack is the tell.
3. `npm run build` on an env-less machine is part of the verification loop
   precisely because it catches this class; Vercel's green build does not.
