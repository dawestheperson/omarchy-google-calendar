// The Google Calendar backend. It never talks to the network
// while the bar is running: `calsync` (a systemd oneshot, see sync/ and
// NOTES.md) fetches ~45 days into $XDG_STATE_HOME/calsync/events.json, and
// every read here is `jq` over that file. Writes go to Google through
// `gcalcli add`, then start calsync.service so the cache catches up at once.
//
// A backend is command lines that print the standard
// shapes at the top of Calendar.js, and no parsing. Qt-free, runs under node.

var info = {
  id: "gcal",
  name: "Google Calendar",
  capabilities: {
    create: true,
    // gcalcli deletes by search, not id; delete in Google Calendar itself.
    delete: false,
    // No always-on process: syncs are scheduled (see NOTES.md).
    watch: false,
    dayLink: true
  }
}

var cacheOutputByteLimit = 4 * 1024 * 1024

// Paths are resolved by bash, so the QML never needs to know $HOME.
var stateDirExpr = "${XDG_STATE_HOME:-$HOME/.local/state}/calsync"

function isDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
}

function shiftDay(key, delta) {
  var parts = String(key).split("-")
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + delta)
  var month = date.getMonth() + 1
  var day = date.getDate()
  return date.getFullYear() + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
}

// ---------------------------------------------------------------------------
// Probe: gcalcli installed? (The cache may not exist yet; that is a fetch
// error, shown in the panel, not a reason to give up for the session.)
// ---------------------------------------------------------------------------

var probeCommand = ["bash", "-c", "command -v gcalcli >/dev/null && echo cache", "gcal"]

function probe(output) {
  if (String(output || "").indexOf("cache") !== -1) return { mode: "cache", version: "", error: "" }
  return { mode: "", version: "", error: "gcalcli is not installed. Install it with `omarchy pkg aur add gcalcli`, then see GOOGLE_SETUP.md." }
}

function modeNote(mode, version) {
  return "Synced by calsync from Google; calendars hidden in Google Calendar are left out."
}

// ---------------------------------------------------------------------------
// Reading events: one line per Monday-named week, from the cache.
// ---------------------------------------------------------------------------

// Arguments are pairs "monday:sunday". A week whose days all fall
// outside the synced range is still answered (empty), and the panel says how
// far the sync reaches instead of pretending it looked.
var weekScript = [
  "file=" + stateDirExpr + "/events.json",
  "if ! jq -e '.events' \"$file\" >/dev/null 2>&1; then",
  "  for pair in \"$@\"; do printf '{\"week\":\"%s\",\"error\":true}\\n' \"${pair%%:*}\"; done",
  "  exit 0",
  "fi",
  "jq -c '. as $c | $ARGS.positional[] | split(\":\") as [$w, $e]"
    + " | {week: $w, events: [$c.events[] | select(.first_day <= $e and .last_day >= $w)]}' \"$file\" --args \"$@\""
    + " | head -c " + (cacheOutputByteLimit + 1)
].join("\n")

function fetchCommand(mode, weekKeys) {
  var pairs = []
  var list = Array.isArray(weekKeys) ? weekKeys : []
  for (var i = 0; i < list.length; i++) {
    if (!isDayKey(list[i])) continue
    var pair = list[i] + ":" + shiftDay(list[i], 6)
    if (pairs.indexOf(pair) === -1) pairs.push(pair)
  }
  return ["bash", "-c", weekScript, "gcal"].concat(pairs)
}

var calendarsCommand = ["bash", "-c",
  "jq -c '[.calendars[] | {id, name, color, kind, owned}]' " + stateDirExpr + "/events.json 2>/dev/null | head -c 262144",
  "gcal"]

// ---------------------------------------------------------------------------
// Writing events
// ---------------------------------------------------------------------------

// $1 = numeric calendar id from the cache; the rest is gcalcli's argv. The
// calendar's Google name is looked up in the cache, since gcalcli selects
// calendars by name. On success the sync is started and waited for (a few
// seconds), so the new event is in the cache when the panel re-reads it.
var addScript = [
  "state=" + stateDirExpr,
  "id=$1; shift",
  "cal=$(jq -r --argjson id \"$id\" '(.calendars[] | select(.id == $id) | .name) // empty' \"$state/events.json\" 2>/dev/null)",
  "[ -z \"$cal\" ] && cal=$(jq -r '(.calendars[] | select(.primary) | .name) // empty' \"$state/events.json\" 2>/dev/null)",
  "set -- --calendar \"$cal\" \"$@\"",
  "[ -z \"$cal\" ] && shift 2",
  "if out=$(timeout -k 3 45 gcalcli --nocolor add --noprompt \"$@\" 2>&1); then",
  "  systemctl --user start calsync.service >/dev/null 2>&1",
  "  jq -cn --arg c \"$cal\" '{ok: true, summary: (\"Added to \" + $c)}'",
  "else",
  "  jq -cn --arg e \"$(printf '%s' \"$out\" | tail -n 3)\" '{ok: false, error: (\"gcalcli: \" + $e)}'",
  "fi"
].join("\n")

function minutesBetween(startHHMM, endHHMM, sameDay) {
  var s = startHHMM.split(":")
  var e = endHHMM.split(":")
  var diff = (Number(e[0]) * 60 + Number(e[1])) - (Number(s[0]) * 60 + Number(s[1]))
  return sameDay ? diff : diff + 1440
}

function daysBetween(fromKey, toKey) {
  var a = fromKey.split("-")
  var b = toKey.split("-")
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000)
}

// The form's reminders ("10m", "30m", "1h", "1d") are gcalcli's syntax.
function createCommand(request) {
  var r = request || {}
  var args = ["--title", r.title]
  if (r.allDay) {
    var days = r.endDate && r.endDate !== r.date ? daysBetween(r.date, r.endDate) + 1 : 1
    args.push("--allday", "--when", r.date, "--duration", String(days))
  } else {
    args.push("--when", r.date + " " + r.startTime)
    var minutes = r.endTime ? minutesBetween(r.startTime, r.endTime, !r.endDate || r.endDate === r.date) : 60
    args.push("--duration", String(minutes > 0 ? minutes : 60))
  }
  if (r.location) args.push("--where", r.location)
  if (r.remind) args.push("--reminder", r.remind + " popup")
  else args.push("--default-reminders")
  var calendarId = Number(r.calendarId) > 0 ? String(Math.round(Number(r.calendarId))) : "0"
  return ["bash", "-c", addScript, "gcal", calendarId].concat(args)
}

function deleteCommand(event) {
  return []
}

function writeResult(exitCode, stdout) {
  var parsed = null
  try {
    parsed = JSON.parse(String(stdout || ""))
  } catch (e) {
    parsed = null
  }
  if (parsed && parsed.ok === true) return { ok: true, message: String(parsed.summary || "") }
  var message = parsed ? String(parsed.error || "") : ""
  if (message === "") message = "gcalcli did not answer (exit " + exitCode + ")."
  return { ok: false, message: message }
}

// ---------------------------------------------------------------------------
// Sync triggers
// ---------------------------------------------------------------------------

// Opening the popup: sync unless the last success is under 30 seconds old,
// so changes made on the phone show up as soon as you look.
// Blocks until the oneshot finishes, so the caller can re-read afterwards.
var syncIfStaleCommand = ["systemctl", "--user", "start", "calsync@30.service"]

var statusCommand = ["bash", "-c",
  "jq -c . " + stateDirExpr + "/status.json 2>/dev/null || echo; jq -c '.range' " + stateDirExpr + "/events.json 2>/dev/null",
  "gcal"]


// Links open through Omarchy's web app launcher; calendar pages land in the
// "Google Calendar" web app window (installed with `omarchy webapp install`).
// If the launcher is ever gone, they fall back to the browser.
function isCalendarUrl(url) {
  return /^https:\/\/(calendar\.google\.com\/|www\.google\.com\/calendar\/)/.test(String(url || ""))
}

// Google hands out event links on www.google.com/calendar/…, which redirect
// to calendar.google.com. An app window treats that redirect as leaving the
// app and passes it to the default browser, so go to calendar.google.com
// directly; the path and ?eid= are the same on both.
function directCalendarUrl(url) {
  return String(url || "").replace(/^https:\/\/www\.google\.com\/calendar\//, "https://calendar.google.com/calendar/")
}

// Every link opens as an Omarchy web app window, never a browser tab:
// calendar pages, meeting links, the lot.
function openCommand(url) {
  url = directCalendarUrl(url)
  return ["bash", "-c",
    "command -v omarchy-launch-webapp >/dev/null && exec omarchy-launch-webapp \"$1\"; exec xdg-open \"$1\"",
    "gcal", url]
}

// Google Calendar's day view for a date.
function dayUrl(dayKey) {
  if (!isDayKey(dayKey)) return "https://calendar.google.com/calendar/r"
  var p = dayKey.split("-")
  return "https://calendar.google.com/calendar/r/day/" + p[0] + "/" + Number(p[1]) + "/" + Number(p[2])
}

if (typeof module !== "undefined") {
  module.exports = {
    info: info,
    probeCommand: probeCommand,
    probe: probe,
    modeNote: modeNote,
    fetchCommand: fetchCommand,
    weekScript: weekScript,
    calendarsCommand: calendarsCommand,
    createCommand: createCommand,
    deleteCommand: deleteCommand,
    writeResult: writeResult,
    syncIfStaleCommand: syncIfStaleCommand,
    statusCommand: statusCommand,
    dayUrl: dayUrl,
    isCalendarUrl: isCalendarUrl,
    openCommand: openCommand,
    directCalendarUrl: directCalendarUrl
  }
}
