// Usage: node scripts/make-test-ics.mjs <input.ics> <output.ics> [earlyMinutes]
// Writes a small test calendar (next few shifts) to import on a phone.
import { readFileSync, writeFileSync } from "node:fs";
import { transformIcs } from "../src/transform.mjs";

const [input, output, early = "30"] = process.argv.slice(2);
const config = JSON.parse(readFileSync(new URL("../src/sites.json", import.meta.url)));
const full = transformIcs(readFileSync(input, "utf8"), config, {
  earlyMinutes: Number(early),
  onlyAfter: new Date(),
});

// Keep header plus the first 4 events only.
const events = full.split("BEGIN:VEVENT");
const trimmed = [events[0], ...events.slice(1, 5)].join("BEGIN:VEVENT").replace(/END:VCALENDAR\r\n.*$/s, "") + "END:VCALENDAR\r\n";
writeFileSync(output, trimmed);
console.log(`wrote ${output}`);
