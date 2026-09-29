#!/usr/bin/osascript -l JavaScript
// Morning Board calendar sync for macOS.
// Reads today's and the next 7 days' events from Apple Calendar (EventKit)
// and your Canvas calendar feed, then prints JSON for the board:
//   { "synced": true, "events": [...today], "next": [...coming days], "todo": [...Canvas due items] }
// Run: osascript -l JavaScript morning-calendar.js
//
// Treat the Canvas feed link like a password: paste it below ONLY in the copy
// on your Mac. Never commit it, publish it, or paste it into the board.
const CANVAS_FEED = "PASTE_YOUR_CANVAS_CALENDAR_FEED_LINK_HERE";
const DAYS_AHEAD = 7;

ObjC.import("Foundation");
ObjC.import("EventKit");

const now = new Date();
const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const endOfToday = new Date(startOfToday.getTime() + 86400000);
const endOfRange = new Date(startOfToday.getTime() + (DAYS_AHEAD + 1) * 86400000);

const fmtTime = d => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtDay = d => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayKey = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

function item(title, start, end, allDay, where, source) {
  return { start: allDay ? "" : fmtTime(start), end: allDay ? "" : fmtTime(end), title, where: where || "",
           allDay, source, day: fmtDay(start), _t: start.getTime(), _k: dayKey(start) };
}

// ---- Apple Calendar via EventKit (expands repeating events) ----
function appleEvents() {
  const store = $.EKEventStore.alloc.init;
  let done = false;
  const ask = (ok, err) => { done = true; };
  if (store.respondsToSelector("requestFullAccessToEventsWithCompletion:")) store.requestFullAccessToEventsWithCompletion(ask);
  else store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, ask);
  for (let i = 0; i < 100 && !done; i++) $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.1));

  const pred = store.predicateForEventsWithStartDateEndDateCalendars(
    $.NSDate.dateWithTimeIntervalSince1970(startOfToday.getTime() / 1000),
    $.NSDate.dateWithTimeIntervalSince1970(endOfRange.getTime() / 1000), $());
  const evs = store.eventsMatchingPredicate(pred);
  const out = [];
  for (let i = 0; i < evs.count; i++) {
    const e = evs.objectAtIndex(i);
    const cal = ObjC.unwrap(e.calendar.title) || "";
    // Skip the subscribed Canvas calendar here; the feed below is parsed directly.
    if (/canvas/i.test(cal)) continue;
    const s = new Date(e.startDate.timeIntervalSince1970 * 1000);
    const en = new Date(e.endDate.timeIntervalSince1970 * 1000);
    out.push(item(ObjC.unwrap(e.title) || "(No title)", s, en, !!e.allDay, ObjC.unwrap(e.location) || "", cal));
  }
  return out;
}

// ---- Canvas .ics feed ----
function fetchText(url) {
  const data = $.NSData.dataWithContentsOfURL($.NSURL.URLWithString(url));
  if (data.isNil()) return "";
  return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)) || "";
}
function parseICSDate(v, params) {
  if (/VALUE=DATE/.test(params) || /^\d{8}$/.test(v)) {
    return { date: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const parts = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]];
  // Canvas sends UTC (Z). A TZID time is treated as the Mac's local time.
  return { date: m[7] ? new Date(Date.UTC(...parts)) : new Date(...parts), allDay: false };
}
const unesc = s => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
function canvasItems() {
  if (!CANVAS_FEED || /PASTE_YOUR/.test(CANVAS_FEED)) return [];
  const text = fetchText(CANVAS_FEED).replace(/\r?\n[ \t]/g, "");
  const out = [];
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const get = key => { const m = new RegExp("^" + key + "((?:;[^:\\n]*)?):(.*)$", "m").exec(block); return m ? { params: m[1], value: m[2].trim() } : null; };
    const sum = get("SUMMARY"), dt = get("DTSTART"), de = get("DTEND"), url = get("URL"), loc = get("LOCATION");
    if (!sum || !dt) continue;
    const s = parseICSDate(dt.value, dt.params); if (!s) continue;
    const e = de ? parseICSDate(de.value, de.params) : null;
    if (s.date < startOfToday || s.date >= endOfRange) continue;
    let title = unesc(sum.value), course = "";
    const cm = /\s*\[([^\]]+)\]\s*$/.exec(title);          // Canvas puts the course in [brackets]
    if (cm) { course = cm[1]; title = title.slice(0, cm.index); }
    const it = item(title, s.date, e ? e.date : s.date, s.allDay, course || (loc ? unesc(loc.value) : ""), "Canvas");
    it._url = url ? url.value : "";
    it._course = course;
    it._assignment = /assignment/i.test(block) || /[?&#]assignment|\/assignments\//.test(it._url) || s.allDay || fmtTime(s.date) === "11:59 PM";
    out.push(it);
  }
  return out;
}

const apple = (() => { try { return appleEvents(); } catch (e) { return []; } })();
const canvas = (() => { try { return canvasItems(); } catch (e) { return []; } })();
const all = apple.concat(canvas).sort((a, b) => (a.allDay === b.allDay ? a._t - b._t : a.allDay ? -1 : 1));
const todayKey = dayKey(now);
const clean = ({ _t, _k, _url, _course, _assignment, day, ...rest }) => rest;

const result = {
  synced: true,
  events: all.filter(e => e._k === todayKey && !(e.source === "Canvas" && e._assignment)).map(clean),
  next: all.filter(e => e._k !== todayKey && !(e.source === "Canvas" && e._assignment)).slice(0, 8)
           .map(e => ({ ...clean(e), day: e.day })),
  todo: canvas.filter(e => e._assignment).sort((a, b) => a._t - b._t).slice(0, 8).map(e => ({
    id: e._url || e.title + "|" + e._k, title: e.title, course: e._course, due: e.day,
    time: e.allDay ? "" : e.start, url: /^https:\/\//.test(e._url) && !/feeds\/calendars|\.ics(\?|$)/i.test(e._url) ? e._url : ""
  }))
};
JSON.stringify(result, null, 1);
