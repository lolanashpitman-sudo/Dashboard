#!/usr/bin/env node
// Morning Board calendar sync (cloud).
// Reads Canvas and Apple (iCloud) calendar feeds from environment variables and prints
// { synced, events, next, todo } JSON for the board's schedule and to-do list.
//
//   CANVAS_FEED_URL       Canvas → Calendar → "Calendar Feed" link
//   ICLOUD_CALENDAR_URLS  one or more iCloud public calendar links (webcal://…), comma-separated
//
// The feed links are secrets: this script never prints them, and they must never go on the page.
// Usage: node calendar-sync.mjs [YYYY-MM-DD]   (defaults to today in America/Chicago)

const TZ = "America/Chicago";
const DAYS_AHEAD = 7;

// ---------- time helpers (all "wall time" is America/Chicago) ----------
const partsIn = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
};
// Convert a Chicago wall-clock time to a real Date.
const fromWall = (y, mo, d, h = 0, mi = 0, s = 0) => {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t));
    t += guess - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  }
  return new Date(t);
};
const dayKey = (d) => { const p = partsIn(d); return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const fmtTime = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const fmtDay = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });

// ---------- ICS parsing ----------
const unesc = (s) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function parseDate(value, params = "") {
  const v = value.trim();
  if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) {
    return { date: fromWall(+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (m[7]) return { date: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  // TZID times: iCloud and Canvas calendars here are in Central time; treat as Chicago wall time.
  return { date: fromWall(y, mo, d, h, mi, s), allDay: false };
}

function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const calName = (lines.find((l) => l.startsWith("X-WR-CALNAME:")) || "").slice(13).trim();
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = /^([A-Z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
    if (!m) continue;
    const [, key, params, value] = m;
    if (key === "EXDATE") value.split(",").forEach((v) => { const p = parseDate(v, params); if (p) cur.exdates.push(p.date.getTime()); });
    else if (!(key in cur)) cur[key] = { params, value };
  }
  return { calName, events };
}

// Expand an event (and its RRULE) into occurrences inside [from, to).
function occurrences(ev, from, to) {
  const start = parseDate(ev.DTSTART.value, ev.DTSTART.params);
  if (!start) return [];
  const end = ev.DTEND ? parseDate(ev.DTEND.value, ev.DTEND.params) : null;
  const dur = end ? end.date - start.date : 0;
  const out = [];
  const push = (d) => {
    if (ev.exdates.includes(d.getTime())) return;
    if (d < to && new Date(d.getTime() + Math.max(dur, 1)) > from) out.push({ start: d, end: new Date(d.getTime() + dur), allDay: start.allDay });
  };
  if (!ev.RRULE) { push(start.date); return out; }

  const r = Object.fromEntries(ev.RRULE.value.split(";").map((kv) => kv.split("=")));
  const freq = r.FREQ, interval = +(r.INTERVAL || 1);
  const until = r.UNTIL ? parseDate(r.UNTIL).date : null;
  const count = r.COUNT ? +r.COUNT : Infinity;
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => days.indexOf(x.slice(-2))) : null;
  const s = partsIn(start.date);
  let n = 0;
  const emit = (d) => { if (until && d > until) return false; if (n >= count) return false; n++; push(d); return true; };

  if (freq === "WEEKLY") {
    const wd = new Date(Date.UTC(s.y, s.mo - 1, s.d)).getUTCDay();
    const set = byday || [wd];
    for (let w = 0; w < 520; w++) {
      const weekStart = new Date(Date.UTC(s.y, s.mo - 1, s.d - wd + w * 7 * interval));
      if (weekStart > to) break;
      for (const dow of [...set].sort()) {
        const day = new Date(weekStart.getTime() + dow * 86400000);
        const occ = fromWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.h, s.mi, s.s);
        if (occ < start.date) continue;
        if (!emit(occ)) return out;
      }
    }
  } else if (freq === "DAILY" || freq === "MONTHLY" || freq === "YEARLY") {
    for (let i = 0; i < 3660; i++) {
      const k = i * interval;
      const y = s.y + (freq === "YEARLY" ? k : 0);
      const mo = s.mo + (freq === "MONTHLY" ? k : 0);
      const d = s.d + (freq === "DAILY" ? k : 0);
      const base = new Date(Date.UTC(y, mo - 1, d));
      if (freq !== "DAILY" && base.getUTCDate() !== s.d) continue; // e.g. no Feb 30
      const occ = fromWall(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), s.h, s.mi, s.s);
      if (byday && freq === "DAILY" && !byday.includes(base.getUTCDay())) continue;
      if (occ > to) break;
      if (!emit(occ)) break;
    }
  } else {
    push(start.date);
  }
  return out;
}

// curl honors the environment's HTTPS proxy settings (Node's fetch does not).
import { execFile } from "node:child_process";
function fetchText(url) {
  return new Promise((resolve, reject) => {
    execFile("curl", ["-sSfL", "--max-time", "30", url.replace(/^webcal:\/\//i, "https://")],
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => err ? reject(new Error(err.code === 22 ? "server refused (check the link)" : "network error or blocked host")) : resolve(stdout));
  });
}

// ---------- main ----------
const arg = process.argv[2];
const today = arg ? (() => { const [y, m, d] = arg.split("-").map(Number); return fromWall(y, m, d); })()
                  : (() => { const p = partsIn(new Date()); return fromWall(p.y, p.mo, p.d); })();
const todayKey = dayKey(today);
const rangeEnd = new Date(today.getTime() + (DAYS_AHEAD + 1) * 86400000 + 3 * 3600000);

const problems = [];
let loaded = 0;
const items = [];

async function load(url, label, isCanvas) {
  let text;
  try { text = await fetchText(url); } catch (e) { problems.push(`${label}: couldn't download (${e.message})`); return; }
  if (!/BEGIN:VCALENDAR/.test(text)) { problems.push(`${label}: not a calendar feed`); return; }
  loaded++;
  const { calName, events } = parseICS(text);
  // Instances moved/edited individually (RECURRENCE-ID) replace their original occurrence.
  const overridden = new Set(events.filter((e) => e["RECURRENCE-ID"]).map((e) => {
    const p = parseDate(e["RECURRENCE-ID"].value, e["RECURRENCE-ID"].params); return `${e.UID?.value}|${p?.date.getTime()}`;
  }));
  for (const ev of events) {
    if (!ev.DTSTART || !ev.SUMMARY) continue;
    if (ev.STATUS?.value === "CANCELLED") continue;
    for (const o of occurrences(ev, today, rangeEnd)) {
      if (!ev["RECURRENCE-ID"] && overridden.has(`${ev.UID?.value}|${o.start.getTime()}`)) continue;
      let title = unesc(ev.SUMMARY.value), course = "";
      const cm = isCanvas && /\s*\[([^\]]+)\]\s*$/.exec(title);
      if (cm) { course = cm[1]; title = title.slice(0, cm.index); }
      const url = ev.URL ? ev.URL.value.trim() : "";
      const assignment = isCanvas && (/assignment/i.test(ev.UID?.value || "") || /assignment/i.test(url) || o.allDay || fmtTime(o.start) === "11:59 PM");
      items.push({
        start: o.start, end: o.end, allDay: o.allDay, title, course, url, assignment,
        where: course || (ev.LOCATION ? unesc(ev.LOCATION.value) : ""),
        source: isCanvas ? "Canvas" : (calName || "Calendar"),
      });
    }
  }
}

const canvasUrl = (process.env.CANVAS_FEED_URL || "").trim();
const icloudUrls = (process.env.ICLOUD_CALENDAR_URLS || "").split(/[,\s]+/).filter(Boolean);
if (!canvasUrl) problems.push("CANVAS_FEED_URL is not set");
if (!icloudUrls.length) problems.push("ICLOUD_CALENDAR_URLS is not set");

await Promise.all([
  canvasUrl && load(canvasUrl, "Canvas", true),
  ...icloudUrls.map((u, i) => load(u, `Apple calendar ${i + 1}`, false)),
]);

items.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1));
const row = (e) => ({ start: e.allDay ? "" : fmtTime(e.start), end: e.allDay ? "" : fmtTime(e.end), title: e.title, where: e.where, allDay: e.allDay, source: e.source });
const isToday = (e) => dayKey(e.start) === todayKey || (e.start < today && e.end > today);

const result = {
  synced: loaded > 0,
  events: items.filter((e) => isToday(e) && !e.assignment).map(row),
  next: items.filter((e) => !isToday(e) && !e.assignment && e.start >= today).slice(0, 8).map((e) => ({ ...row(e), day: fmtDay(e.start) })),
  todo: items.filter((e) => e.assignment && e.start >= today).slice(0, 8).map((e) => ({
    id: e.url || `${e.title}|${dayKey(e.start)}`, title: e.title, course: e.course, due: fmtDay(e.start),
    time: e.allDay ? "" : fmtTime(e.start),
    url: /^https:\/\//.test(e.url) && !/feeds\/calendars|\.ics(\?|$)/i.test(e.url) ? e.url : "",
  })),
};
if (problems.length) process.stderr.write("Calendar sync problems:\n- " + problems.join("\n- ") + "\n");
process.stdout.write(JSON.stringify(result, null, 1) + "\n");
