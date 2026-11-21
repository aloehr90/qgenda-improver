// Pure ICS transform: no I/O, so it can run in Node, a Cloudflare Worker, or tests.

export function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

// Fold to 75 octets per RFC 5545 (counting UTF-8 bytes, never splitting a character).
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // continuation lines lose one octet to the leading space
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

function fmtUtc(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function parseUtc(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export function findSite(summary, config) {
  for (const rule of config.rules) {
    if (new RegExp(rule.match).test(summary)) return rule.site ? config.sites[rule.site] : null;
  }
  return null;
}

/**
 * options.earlyMinutes: shift the event start earlier by this many minutes.
 * options.travel: add Apple's automatic travel-time advisory (drives "Time to Leave").
 * options.onlyAfter: Date; if set, events starting before it are dropped (for test files).
 */
export function transformIcs(icsText, config, options = {}) {
  const { earlyMinutes = 0, travel = true, onlyAfter = null } = options;
  const lines = unfold(icsText).split(/\r?\n/).filter((l) => l.length);
  const out = [];
  let ev = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      ev = [];
      continue;
    }
    if (line === "END:VEVENT") {
      const processed = processEvent(ev, config, { earlyMinutes, travel, onlyAfter });
      if (processed) out.push("BEGIN:VEVENT", ...processed, "END:VEVENT");
      ev = null;
      continue;
    }
    if (ev) ev.push(line);
    else out.push(line);
  }
  return out.map(fold).join("\r\n") + "\r\n";
}

function processEvent(props, config, { earlyMinutes, travel, onlyAfter }) {
  const get = (name) => props.find((p) => p.startsWith(name + ":"))?.slice(name.length + 1);
  const summary = get("SUMMARY") ?? "";
  const startRaw = get("DTSTART");
  const start = startRaw ? parseUtc(startRaw) : null;
  if (onlyAfter && start && start < onlyAfter) return null;

  const site = findSite(summary, config);
  if (!site) return props; // unmatched or intentionally left alone

  let result = props.filter(
    (p) => !/^(LOCATION|X-APPLE-STRUCTURED-LOCATION|X-APPLE-TRAVEL-ADVISORY-BEHAVIOR)[:;]/.test(p),
  );

  if (earlyMinutes > 0 && start) {
    const early = new Date(start.getTime() - earlyMinutes * 60000);
    const hhmm = (d) =>
      d.toLocaleTimeString("en-US", { timeZone: "America/Boise", hour: "numeric", minute: "2-digit" });
    result = result.map((p) => {
      if (p.startsWith("DTSTART:")) return `DTSTART:${fmtUtc(early)}`;
      if (p.startsWith("DESCRIPTION:")) {
        return `DESCRIPTION:Shift starts ${hhmm(start)} (arrive ${earlyMinutes} min early)\\n` + p.slice("DESCRIPTION:".length);
      }
      return p;
    });
  }

  result.push(`LOCATION:${esc(site.title)}\\n${esc(site.address)}`);
  result.push(
    `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="${site.address}";X-APPLE-RADIUS=100;X-TITLE="${site.title}":geo:${site.lat},${site.lon}`,
  );
  if (travel) result.push("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTO");
  return result;
}
