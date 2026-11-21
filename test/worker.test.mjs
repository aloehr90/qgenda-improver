// Run: QGENDA_FEED=/path/to/feed.ics node --test test/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handle } from "../worker/index.js";

const KEY = "11111111-2222-3333-4444-555555555555";
const feed = process.env.QGENDA_FEED ? readFileSync(process.env.QGENDA_FEED, "utf8") : null;
const fakeFetch = async (url) => {
  assert.equal(url, `https://app.qgenda.com/ical?key=${KEY}`);
  return new Response(feed, { status: 200 });
};
const req = (qs) => new Request(`https://w.example/cal?${qs}`);

test("rejects bad key and out-of-range early", async () => {
  assert.equal((await handle(req("k=nope"), fakeFetch)).status, 400);
  assert.equal((await handle(req(`k=${KEY}&early=999`), fakeFetch)).status, 400);
  assert.equal((await handle(new Request("https://w.example/other"), fakeFetch)).status, 404);
});

test("never fetches anything but app.qgenda.com", async () => {
  await handle(req(`k=${KEY}&early=5`), async (u) => { assert.ok(u.startsWith("https://app.qgenda.com/ical?key=")); return new Response("BEGIN:VCALENDAR\nEND:VCALENDAR", { status: 200 }); });
});

test("upstream failure surfaces as 502", async () => {
  const res = await handle(req(`k=${KEY}`), async () => new Response("no", { status: 404 }));
  assert.equal(res.status, 502);
});

test("transforms the real feed", { skip: !feed }, async () => {
  const res = await handle(req(`k=${KEY}&early=30`), fakeFetch);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/calendar/);
  const body = await res.text();
  const events = body.split("BEGIN:VEVENT").length - 1;
  assert.equal(events, 82, "no events lost");
  assert.equal((body.match(/^LOCATION:/gm) || []).length, 81, "all but Ped2Night located");
  assert.ok(!body.split("\r\n").some((l) => Buffer.byteLength(l) > 75), "lines folded");
  assert.match(body, /SUMMARY:B Ped2Night/);
});
