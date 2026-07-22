/**
 * Side-effect registry barrel (T1 Unit 14; closes Unit 3's carried risk).
 *
 * `registerProgram` runs as an import side effect of each generated module, so
 * a server module calling `getProgram(versionId)` for a pinned student throws
 * "not registered" unless that version's generated module is in the SAME module
 * graph. This barrel is the one place that imports every generated module;
 * every `getProgram` caller imports this barrel (a bare side-effect import)
 * instead of any generated module directly — D27's pinning depends on ALL
 * versions being resolvable, and old modules are permanent fixtures.
 *
 * When a revision ships: add its generated module here, beside the old ones —
 * never replace a line.
 */

import "./generated/program-2026-27";
