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

/** Returns { site, rule } for the first matching rule, or null if none match or the rule opts out. */
export function findRule(summary, config) {
  for (const rule of config.rules) {
    if (new RegExp(rule.match).test(summary)) {
      return rule.site ? { site: config.sites[rule.site], rule } : null;
    }
  }
  return null;
}

// "N N-7p 7p-3a [Loehr]" -> "Nampa 7p-3a". Falls back to the original minus the "[Name]" suffix.
export function shortTitle(summary, site, rule) {
  const clean = summary.replace(/\s*\[[^\]]*\]\s*$/, "");
  const hours = /\b(\d{1,2}(?::\d{2})?[ap])-(\d{1,2}(?::\d{2})?[ap])\b/.exec(clean);
  if (!hours) return clean;
  return `${rule.label ?? site.short} ${hours[1]}-${hours[2]}`;
}

/**
 * options.earlyMinutes: shift the event start earlier by this many minutes (not for rules with noEarly).
 * options.travel: add Apple's automatic travel-time advisory (drives "Time to Leave").
 * options.alertMinutes: if > 0, add a reminder this many minutes before the (shifted) event start.
 * options.onlyAfter: Date; if set, events starting before it are dropped (for test files).
 */
export function transformIcs(icsText, config, options = {}) {
  const { earlyMinutes = 0, travel = true, alertMinutes = 0, onlyAfter = null } = options;
  const opts = { earlyMinutes, travel, alertMinutes, onlyAfter };
  const lines = unfold(icsText).split(/\r?\n/).filter((l) => l.length);
  const out = [];
  let ev = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      ev = [];
      continue;
    }
    if (line === "END:VEVENT") {
      const processed = processEvent(ev, config, opts);
      if (processed) out.push("BEGIN:VEVENT", ...processed, "END:VEVENT");
      ev = null;
      continue;
    }
    if (ev) ev.push(line);
    else out.push(line);
  }
  return out.map(fold).join("\r\n") + "\r\n";
}

function processEvent(props, config, { earlyMinutes, travel, alertMinutes, onlyAfter }) {
  const get = (name) => props.find((p) => p.startsWith(name + ":"))?.slice(name.length + 1);
  const summary = get("SUMMARY") ?? "";
  const startRaw = get("DTSTART");
  const start = startRaw ? parseUtc(startRaw) : null;
  if (onlyAfter && start && start < onlyAfter) return null;

  const found = findRule(summary, config);
  if (!found) return props; // unmatched or intentionally left alone
  const { site, rule } = found;

  const early = rule.noEarly ? 0 : earlyMinutes;
  const title = shortTitle(summary, site, rule);
  const hhmm = (d) =>
    d.toLocaleTimeString("en-US", { timeZone: "America/Boise", hour: "numeric", minute: "2-digit" });

  // Drop what we replace, then re-add it below.
  let result = props.filter(
    (p) =>
      !/^(LOCATION|X-APPLE-STRUCTURED-LOCATION|X-APPLE-TRAVEL-ADVISORY-BEHAVIOR|TRANSP|X-MICROSOFT-CDO-BUSYSTATUS)[:;]/.test(p),
  );

  const notes = [];
  if (early > 0 && start) notes.push(`Shift starts ${hhmm(start)} (arrive ${early} min early)`);
  if (title !== summary) notes.push(`QGenda: ${summary}`);

  result = result.map((p) => {
    if (p.startsWith("SUMMARY:")) return `SUMMARY:${esc(title)}`;
    if (p.startsWith("DTSTART:") && early > 0 && start) return `DTSTART:${fmtUtc(new Date(start.getTime() - early * 60000))}`;
    if (p.startsWith("DESCRIPTION:") && notes.length) return `DESCRIPTION:${notes.map(esc).join("\\n")}\\n${p.slice("DESCRIPTION:".length)}`;
    return p;
  });
  if (notes.length && !result.some((p) => p.startsWith("DESCRIPTION:"))) {
    result.push(`DESCRIPTION:${notes.map(esc).join("\\n")}`);
  }

  result.push("TRANSP:OPAQUE", "X-MICROSOFT-CDO-BUSYSTATUS:BUSY");
  result.push(`LOCATION:${esc(site.title)}\\n${esc(site.address)}`);
  result.push(
    `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="${site.address}";X-APPLE-RADIUS=100;X-TITLE="${site.title}":geo:${site.lat},${site.lon}`,
  );
  if (travel) result.push("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTO");
  if (alertMinutes > 0) {
    result.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, `TRIGGER:-PT${alertMinutes}M`, "END:VALARM");
  }
  return result;
}
