const baseUrl = new URL(
  process.argv[2] || process.env.GAUNTLET_BASE_URL || "https://120.school"
);
const date = new Date().toISOString().slice(0, 10);
const bands = ["g34", "g56", "g78", "g910", "g11", "g12"];

async function checkPage() {
  const url = new URL("/gauntlet/beta", baseUrl);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`beta page returned HTTP ${response.status}`);
  return response.url;
}

async function checkBoard(band) {
  const url = new URL("/api/gauntlet/daily-sprint", baseUrl);
  url.searchParams.set("date", date);
  url.searchParams.set("band", band);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${band} board did not return JSON (HTTP ${response.status})`);
  }
  if (!response.ok || body.available !== true || !Array.isArray(body.rows)) {
    throw new Error(
      `${band} board unavailable (HTTP ${response.status}, available=${String(body.available)})`
    );
  }
  return { band, rows: body.rows.length };
}

try {
  const [page, ...boards] = await Promise.all([
    checkPage(),
    ...bands.map(checkBoard),
  ]);
  console.log(`Gauntlet beta reachable: ${page}`);
  for (const board of boards) {
    console.log(`${board.band}: database query healthy (${board.rows} public rows today)`);
  }
  console.log("Gauntlet production verification passed.");
} catch (error) {
  console.error(
    `Gauntlet production verification failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
