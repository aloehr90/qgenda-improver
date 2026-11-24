import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformIcs, shortTitle, findRule } from "../src/transform.mjs";

const config = JSON.parse(readFileSync(new URL("../src/sites.json", import.meta.url)));

const ev = (summary, start = "20270105T030000Z", end = "20270105T110000Z") =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "DESCRIPTION:AutoSync", `DTSTART:${start}`, `DTEND:${end}`,
   `SUMMARY:${summary}`, "TRANSP:TRANSPARENT", "UID:x@qgenda.com", "X-MICROSOFT-CDO-BUSYSTATUS:FREE", "END:VEVENT", "END:VCALENDAR"].join("\r\n") + "\r\n";

const run = (summary, opts) => transformIcs(ev(summary), config, opts).replace(/\r\n /g, "");

test("titles are shortened", () => {
  const t = (s) => { const f = findRule(s, config); return shortTitle(s, f.site, f.rule); };
  assert.equal(t("N N-7p 7p-3a [Loehr]"), "Nampa 7p-3a");
  assert.equal(t("B B-11a 11a-7p [Loehr]"), "Boise 11a-7p");
  assert.equal(t("M M2p 2p-10p [Loehr]"), "Meridian 2p-10p");
  assert.equal(t("B Trauma 2a-7a [Loehr]"), "Boise Trauma 2a-7a");
  assert.equal(t("Peer Review 12p-2:30p [Loehr]"), "Peer Review 12p-2:30p");
  assert.equal(t("Board Mtg 8a-2p [Loehr]"), "Board Meeting 8a-2p");
});

test("shifts become busy, located, and start early; original title kept in notes", () => {
  const out = run("N N-7p 7p-3a [Loehr]", { earlyMinutes: 15 });
  assert.match(out, /SUMMARY:Nampa 7p-3a\r\n/);
  assert.match(out, /TRANSP:OPAQUE/);
  assert.match(out, /X-MICROSOFT-CDO-BUSYSTATUS:BUSY/);
  assert.doesNotMatch(out, /TRANSP:TRANSPARENT|BUSYSTATUS:FREE/);
  assert.match(out, /DTSTART:20270105T024500Z/);
  assert.match(out, /DESCRIPTION:Shift starts 8:00 PM \(arrive 15 min early\)\\nQGenda: N N-7p 7p-3a \[Loehr\]\\nAutoSync/);
  assert.match(out, /X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTO/);
  assert.doesNotMatch(out, /VALARM/);
});

test("meetings get no early start", () => {
  for (const s of ["Peer Review 12p-2:30p [Loehr]", "Board Mtg 8a-2p [Loehr]"]) {
    const out = run(s, { earlyMinutes: 15 });
    assert.match(out, /DTSTART:20270105T030000Z/);
    assert.doesNotMatch(out, /arrive/);
    assert.match(out, /LOCATION:/);
  }
});

test("optional reminder", () => {
  assert.match(run("M M-6p 6p-2a [Loehr]", { alertMinutes: 60 }), /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Meridian 6p-2a\r\nTRIGGER:-PT60M\r\nEND:VALARM/);
  assert.doesNotMatch(run("M M-6p 6p-2a [Loehr]", {}), /VALARM/);
});

test("Ped2Night and unknown codes pass through untouched", () => {
  for (const s of ["B Ped2Night [Loehr]", "Z Mystery 1p-2p [Loehr]"]) {
    const out = run(s, { earlyMinutes: 15, alertMinutes: 60 });
    assert.match(out, new RegExp(`SUMMARY:${s.replace(/[[\]]/g, "\\$&")}`));
    assert.match(out, /TRANSP:TRANSPARENT/);
    assert.doesNotMatch(out, /LOCATION|VALARM/);
  }
});
