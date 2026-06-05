/**
 * CIMIS Weather API — Cloudflare Worker Proxy
 * ─────────────────────────────────────────────
 * Deployment steps:
 *   1. In Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. Paste this file into the editor
 *   3. Go to Settings → Variables → add secret:
 *        CIMIS_APP_KEY = your key from cimis.water.ca.gov
 *   4. Deploy. Your Worker URL will look like:
 *        https://cimis-proxy.YOUR-SUBDOMAIN.workers.dev
 *   5. In your HTML, set the fetch URL to:
 *        https://cimis-proxy.YOUR-SUBDOMAIN.workers.dev/api/cimis
 *
 * Your website sends:  GET /api/cimis?target=159&startDate=2024-11-01&endDate=2025-03-01
 * This Worker calls:   CIMIS API (with your hidden AppKey)
 * Your website gets:   Normalized JSON — { records: [...] }
 *
 * CIMIS AppKey never leaves Cloudflare. Your users never see it.
 */

// ─── CORS: restrict to your own domain in production ──────────────────────────
// During development you can use '*'. Before going live, change this to your
// actual domain, e.g. 'https://fruitforager.github.io'
const ALLOWED_ORIGIN = 'https://fruitforager.github.io';

// ─── CIMIS data items we need ──────────────────────────────────────────────────
// HlyAirTmp  = hourly air temperature (°F) — used for chill hour counting
// DayAirTmpMin / DayAirTmpMax — daily min/max for degree-day calculation
const CIMIS_DATA_ITEMS = 'HlyAirTmp,DayAirTmpMin,DayAirTmpMax';

// ─── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only handle /api/cimis
    if (url.pathname !== '/api/cimis') {
      return new Response('Not found', { status: 404 });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return corsResponse({ error: 'Method not allowed' }, 405);
    }

    // ── Validate required query params ────────────────────────────────────────
    const target    = url.searchParams.get('target')?.trim();
    const startDate = url.searchParams.get('startDate')?.trim();
    const endDate   = url.searchParams.get('endDate')?.trim();

    if (!target || !startDate || !endDate) {
      return corsResponse(
        { error: 'Missing required params: target, startDate, endDate' },
        400
      );
    }

    // ── Basic date sanity check ───────────────────────────────────────────────
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return corsResponse(
        { error: 'Dates must be YYYY-MM-DD format' },
        400
      );
    }

    if (new Date(startDate) >= new Date(endDate)) {
      return corsResponse(
        { error: 'startDate must be before endDate' },
        400
      );
    }

    // CIMIS caps single requests at 1825 days (~5 years). A Nov–Mar window is
    // ~120 days so this is never an issue, but we guard it anyway.
    const daySpan = (new Date(endDate) - new Date(startDate)) / 86_400_000;
    if (daySpan > 1825) {
      return corsResponse(
        { error: 'Date range too large. Maximum span is 5 years.' },
        400
      );
    }

    // ── Guard: AppKey must be configured ──────────────────────────────────────
    const appKey = env.CIMIS_APP_KEY;
    if (!appKey) {
      console.error('CIMIS_APP_KEY env variable is not set');
      return corsResponse(
        { error: 'Server misconfiguration: CIMIS AppKey not set' },
        500
      );
    }

    // ── Build CIMIS API URL ───────────────────────────────────────────────────
    // target can be a station ID (e.g. "159") or a ZIP code (e.g. "94611")
    const isZip = /^\d{5}$/.test(target);
    const cimisParts = new URLSearchParams({
      appKey,
      targets:   isZip ? `zip=${target}` : target,
      startDate,
      endDate,
      dataItems: CIMIS_DATA_ITEMS,
      unitOfMeasure: 'E',   // English units (°F)
    });

    const cimisUrl = `https://et.water.ca.gov/api/data?${cimisParts.toString()}`;

    // ── Fetch from CIMIS ──────────────────────────────────────────────────────
    let cimisRes;
    try {
      cimisRes = await fetch(cimisUrl, {
        headers: { 'Accept': 'application/json' },
        // Cloudflare Workers time out after 30s; CIMIS is usually fast
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      console.error('CIMIS fetch error:', err);
      return corsResponse(
        { error: 'Failed to reach CIMIS API. Try again in a moment.' },
        502
      );
    }

    if (!cimisRes.ok) {
      const body = await cimisRes.text().catch(() => '');
      console.error(`CIMIS returned ${cimisRes.status}:`, body);
      return corsResponse(
        { error: `CIMIS API error (${cimisRes.status}). Check your station ID or date range.` },
        502
      );
    }

    let raw;
    try {
      raw = await cimisRes.json();
    } catch {
      return corsResponse({ error: 'CIMIS returned malformed JSON' }, 502);
    }

    // ── Normalize CIMIS response into a flat records array ───────────────────
    // CIMIS response shape:
    // { Data: { Providers: [{ Records: [ { Date, HlyAirTmp: { Value }, ... } ] }] } }
    const providerRecords =
      raw?.Data?.Providers?.[0]?.Records ?? [];

    if (providerRecords.length === 0) {
      return corsResponse(
        { error: 'No records returned. Station may not have data for this date range.' },
        404
      );
    }

    // Group hourly rows by date, collect min/max and hourly temps per day
    const byDate = {};
    for (const rec of providerRecords) {
      const date = rec.Date;         // "2024-11-01"
      const hour = rec.Hour;         // 100, 200, ... 2400  (CIMIS uses 24-hr in hundreds)
      const airTmp  = parseFloat(rec.HlyAirTmp?.Value);
      const tmin    = parseFloat(rec.DayAirTmpMin?.Value);
      const tmax    = parseFloat(rec.DayAirTmpMax?.Value);

      if (!date) continue;

      if (!byDate[date]) {
        byDate[date] = { date, tmin: null, tmax: null, hourlyTemps: [] };
      }

      // Each record is one hour; collect the temperature
      if (!Number.isNaN(airTmp)) {
        byDate[date].hourlyTemps.push(airTmp);
      }

      // Daily min/max may repeat across hourly records — just overwrite; same value
      if (!Number.isNaN(tmin)) byDate[date].tmin = tmin;
      if (!Number.isNaN(tmax)) byDate[date].tmax = tmax;
    }

    const records = Object.values(byDate).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    // ── Return normalized payload ──────────────────────────────────────────────
    return corsResponse({
      source:    'CIMIS',
      target,
      startDate,
      endDate,
      stationMeta: extractStationMeta(raw),
      recordCount: records.length,
      records,
    });
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !Number.isNaN(Date.parse(str));
}

/** Pull station name / number out of CIMIS response if available */
function extractStationMeta(raw) {
  try {
    const provider = raw?.Data?.Providers?.[0];
    return {
      stationName:   provider?.Owner ?? null,
      stationNumber: provider?.Targets?.[0]?.StationNbr ?? null,
      city:          provider?.Targets?.[0]?.City ?? null,
      county:        provider?.Targets?.[0]?.County ?? null,
      elevation:     provider?.Targets?.[0]?.Elevation ?? null,
    };
  } catch {
    return null;
  }
}

/** Return a JSON Response with CORS headers */
function corsResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type',
      'Cache-Control':               'no-store',   // weather data should never be cached
    },
  });
}