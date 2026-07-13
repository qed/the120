/**
 * Vitest stub for the `server-only` package, which throws on import outside
 * a React Server Components bundle. Aliased in `vitest.config.ts` so tests
 * can import `queries.ts` (whose supabase admin import chain pulls it in)
 * to exercise the pure `buildTimeline` function.
 */
export {};
