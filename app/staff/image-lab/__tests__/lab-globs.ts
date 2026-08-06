/**
 * THE ONE LIST OF EXTENSIONS A LAB MODULE CAN BE WRITTEN IN, and the globs built
 * from it — shared by BOTH structural guards so they cannot drift apart again.
 *
 * ⚠ THEY HAD ALREADY DRIFTED, AND IT WAS TWO OPEN ENDPOINTS. `service-role-only`
 * learned the lesson in Unit 4 (a `.js` module walked past a `{ts,tsx}` glob) and
 * enumerated eight extensions; `gate-enforcement` never got the fix, so it kept
 * globbing `{ts,tsx}` for BOTH its routable scan and its `"use server"` scan.
 * Verified against this branch, with the whole Lab suite green:
 *
 *   * `app/staff/image-lab/api/probe/route.js` — an UNGATED, network-reachable
 *     POST — passed gate-enforcement 20/20;
 *   * `app/staff/image-lab/lib/probe-actions.js` — `"use server"`, one ungated
 *     exported action — passed it too, because the action scan globs `{ts,tsx}`
 *     as well.
 *
 * `next.config.ts` sets no `pageExtensions`, so Next's default routing serves a
 * `.js` route handler in full. A lesson learned by one guard and not the other is
 * a lesson not learned, so the list lives here and both import it.
 *
 * NOT a `*.test.ts` file on purpose: it is imported by tests, not run as one.
 * It has no imports of its own, so the service-role graph walk crosses it and
 * finds nothing — which is the correct outcome for a module under the Lab.
 */

/** Every extension a module can be written in. A `.js` file under the Lab is
 *  still a Lab module, and Next still routes it. */
export const LAB_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

export const LAB_DIR = "app/staff/image-lab/";

/** `{ts,tsx,js,…}` — the brace body, without the dots. */
export const LAB_EXTENSION_BRACE = LAB_SOURCE_EXTENSIONS.map((e) => e.slice(1)).join(",");

/** Every module under the Lab, in every extension. */
export const LAB_SOURCE_GLOB = `${LAB_DIR}**/*.{${LAB_EXTENSION_BRACE}}`;

/**
 * EVERY Next routable convention under the Lab, in every extension.
 *
 * `page`/`layout`/`template`/`default` render; `route` does not render at all and
 * is reached directly. Missing `route` is what let an ungated
 * `api/generate/route.ts` sit invisible under the old `{page,layout}` glob;
 * missing `.js` is what let `api/probe/route.js` sit invisible under the one that
 * replaced it.
 */
export const LAB_ROUTABLE_GLOB =
  `${LAB_DIR}**/{page,layout,template,default,route}.{${LAB_EXTENSION_BRACE}}`;

/**
 * ⚠ ONLY `*.test.*` IS IGNORED, not all of `__tests__/`.
 *
 * `lib/__tests__/anon-helper.ts` is a PRODUCTION module by any measure that
 * matters — it can be imported from anywhere — and it was invisible to both the
 * old scan and to vitest. A directory name is not a guarantee; a filename suffix
 * at least matches what the runner actually executes.
 */
export const isLabTestFile = (file: string): boolean =>
  /(^|[\\/])[^\\/]*\.test\.[^\\/]+$/.test(file);
