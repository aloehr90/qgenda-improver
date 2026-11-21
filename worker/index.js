import { transformIcs } from "../src/transform.mjs";
import config from "../src/sites.json" with { type: "json" };

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024;

const text = (body, status) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

// Exported separately so tests can inject a fake fetch.
export async function handle(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== "/cal") return text("QGenda calendar enhancer. Use the web page to generate a link.", 404);
  if (request.method !== "GET" && request.method !== "HEAD") return text("Method not allowed", 405);

  // Only a bare key is accepted, never a full URL, so this can't be pointed at arbitrary hosts.
  const key = url.searchParams.get("k") ?? "";
  if (!KEY_RE.test(key)) return text("Missing or invalid QGenda key.", 400);

  const early = Number(url.searchParams.get("early") ?? "0");
  if (!Number.isInteger(early) || early < 0 || early > 240) return text("early must be a whole number of minutes, 0-240.", 400);
  const travel = url.searchParams.get("travel") !== "0";

  let upstream;
  try {
    upstream = await fetchImpl(`https://app.qgenda.com/ical?key=${key}`, {
      redirect: "manual", // never follow redirects; a 3xx is treated as failure below
      cf: { cacheTtl: 300, cacheEverything: true },
    });
  } catch (e) {
    return text(`Could not reach QGenda (${e?.name}: ${e?.message}).`, 502);
  }
  if (!upstream.ok) return text(`QGenda returned ${upstream.status}. Check that the key is correct.`, 502);

  const body = await upstream.text();
  if (body.length > MAX_BYTES || !body.startsWith("BEGIN:VCALENDAR")) return text("QGenda did not return a calendar.", 502);

  const out = transformIcs(body, config, { earlyMinutes: early, travel });
  return new Response(request.method === "HEAD" ? null : out, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=900",
      "content-disposition": 'inline; filename="qgenda.ics"',
    },
  });
}

export default { fetch: (request) => handle(request) };
