// Plain node, no dependencies: `tests/run` runs this in several timezones.
var assert = require("assert")
var Cal = require("../Calendar.js")
var Gcal = require("../backends/Gcal.js")

var tz = process.env.TZ || "local"
var failures = 0

function test(name, fn) {
  try {
    fn()
  } catch (e) {
    failures++
    console.error("FAIL [" + tz + "] " + name + "\n  " + e.message)
  }
}

// A timed event at local wall-clock times, so expectations hold in any zone.
function timed(id, title, y, m, d, h, min, durationMin, extra) {
  var start = new Date(y, m - 1, d, h, min)
  var end = new Date(start.getTime() + durationMin * 60000)
  var raw = {
    id: id, title: title, all_day: false,
    starts_at: start.toISOString(), ends_at: end.toISOString(),
    calendar: "Work", color: "blue", reminders: []
  }
  for (var k in extra || {}) raw[k] = extra[k]
  return Cal.normalizeEvent(raw)
}

function allDay(id, title, startKey, endKey, extra) {
  var raw = {
    id: id, title: title, all_day: true,
    starts_at: startKey + "T00:00:00Z", ends_at: (endKey || startKey) + "T00:00:00Z",
    calendar: "Relationships", color: "red", reminders: []
  }
  for (var k in extra || {}) raw[k] = extra[k]
  return Cal.normalizeEvent(raw)
}

// ---- Days

test("all-day events stay on their date in every zone", function() {
  var e = allDay(1, "Bday", "2026-09-26")
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-09-26"])
})

test("multi-day all-day events end exclusively", function() {
  var e = allDay(1, "Trip", "2026-10-13", "2026-10-16")
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-10-13", "2026-10-14", "2026-10-15"])
})

test("timed events span every local day they cover", function() {
  var e = timed(1, "Train", 2026, 10, 6, 9, 0, (5 * 24 + 1) * 60)
  var keys = Cal.eventDayKeys(e)
  assert.strictEqual(keys[0], "2026-10-06")
  assert.strictEqual(keys[keys.length - 1], "2026-10-11")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-06"), "first")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-08"), "middle")
  assert.strictEqual(Cal.spanPosition(e, "2026-10-11"), "last")
})

test("a timed event ending at midnight does not spill into the next day", function() {
  var e = timed(1, "Late", 2026, 9, 28, 22, 0, 120)
  assert.deepStrictEqual(Cal.eventDayKeys(e), ["2026-09-28"])
})

test("weekKeysBetween names Monday weeks", function() {
  assert.deepStrictEqual(Cal.weekKeysBetween("2026-08-30", "2026-10-10"),
    ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"])
})

// ---- Chips

test("chips group a day by color with counts, in the day's order", function() {
  var events = [
    timed(1, "Podcast", 2026, 9, 28, 13, 0, 90),
    timed(2, "Standup", 2026, 9, 28, 9, 0, 15),
    timed(3, "Dinner", 2026, 9, 28, 18, 30, 60, { color: "red", calendar: "Relationships" })
  ]
  var chips = Cal.dayChips(Cal.eventsForDay(events, "2026-09-28"), 3)
  assert.deepStrictEqual(chips.map(function(c) { return c.color + ":" + c.count }), ["blue:2", "red:1"])
})

test("past the limit, the last chip is +N for the rest", function() {
  var colors = ["blue", "red", "gold", "teal", "green"]
  var events = colors.map(function(color, i) {
    return timed(i + 1, "E" + i, 2026, 9, 28, 8 + i, 0, 30, { color: color })
  })
  var chips = Cal.dayChips(Cal.eventsForDay(events, "2026-09-28"), 3)
  assert.strictEqual(chips.length, 3)
  assert.strictEqual(chips[2].overflow, true)
  assert.strictEqual(chips[2].count, 3)
})

// ---- Parsing

test("week output: failures are null, not empty", function() {
  var out = '{"week":"2026-09-28","events":[{"id":1,"title":"A","starts_at":"2026-09-28T10:00:00Z","ends_at":"2026-09-28T11:00:00Z"}]}\n'
    + '{"week":"2026-10-05","error":true}\n'
  var weeks = Cal.parseRangeOutput(out)
  assert.strictEqual(weeks["2026-09-28"].length, 1)
  assert.strictEqual(weeks["2026-10-05"], null)
  assert.strictEqual(Cal.parseRangeOutput(""), null)
})

test("unsafe links are dropped", function() {
  assert.strictEqual(Cal.safeUrl("javascript:alert(1)"), "")
  assert.strictEqual(Cal.safeUrl("https://meet.example.com/x"), "https://meet.example.com/x")
})

test("hidden calendars are matched by name, case-insensitively", function() {
  var events = [timed(1, "A", 2026, 9, 28, 9, 0, 30), timed(2, "B", 2026, 9, 28, 10, 0, 30, { calendar: "Todoist" })]
  var hidden = Cal.parseHiddenCalendars("todoist, ")
  assert.deepStrictEqual(Cal.withoutHidden(events, hidden).map(function(e) { return e.title }), ["A"])
})

// ---- Repeats (backends that list a series once)

test("yearly all-day series land on their date in the range", function() {
  var e = allDay(9, "Bday", "1987-07-14", "1987-07-14", { repeat_kind: "rrule", repeat_description: "yearly on the 14th day of the month in July" })
  var out = Cal.expandRecurring(e, "2026-07-01", "2026-07-31")
  assert.deepStrictEqual(out.map(function(o) { return o.startsAt.substr(0, 10) }), ["2026-07-14"])
})

test("weekly series stop at their 'until' date", function() {
  var e = timed(5, "Meetup", 2026, 7, 30, 19, 30, 60, { repeat_kind: "every_week", repeat_description: "every week until September  3, 2026" })
  var keys = Cal.expandRecurring(e, "2026-08-24", "2026-09-13").map(function(o) { return Cal.eventDayKeys(o)[0] })
  assert.deepStrictEqual(keys, ["2026-08-27", "2026-09-03"])
})

test("weekday series skip weekends and honour a count", function() {
  var e = timed(6, "Standup", 2026, 9, 25, 9, 0, 15, { repeat_kind: "every_weekday", repeat_description: "every weekday 4 times" })
  var keys = Cal.expandRecurring(e, "2026-09-20", "2026-10-10").map(function(o) { return Cal.eventDayKeys(o)[0] })
  assert.deepStrictEqual(keys, ["2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30"])
})

test("monthly series skip months without that day", function() {
  var e = allDay(7, "Rent", "2026-01-31", "2026-01-31", { repeat_kind: "every_day_of_month", repeat_description: "every month" })
  var keys = Cal.expandRecurring(e, "2026-02-01", "2026-04-30").map(function(o) { return o.startsAt.substr(0, 10) })
  assert.deepStrictEqual(keys, ["2026-03-31"])
})

test("occurrences keep their local wall-clock time across DST", function() {
  var e = timed(8, "Gym", 2026, 3, 20, 7, 0, 60, { repeat_kind: "every_week", repeat_description: "every week" })
  var out = Cal.expandRecurring(e, "2026-04-01", "2026-04-07")
  assert.strictEqual(out.length, 1)
  var start = new Date(out[0].startMs)
  assert.strictEqual(start.getHours(), 7)
  assert.strictEqual(out[0].key !== e.key, true)
})

// ---- Bar

test("the bar names an event and says when", function() {
  var e = timed(1, "Team sync", 2026, 9, 28, 13, 0, 90)
  var before = e.startMs - 12 * 60000
  assert.strictEqual(Cal.barEventLabel(e, before, true), "Team sync · in 12m")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs + 60000, true), "Team sync · until 14:30")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs - 3 * 3600000, true), "Team sync · at 13:00")
  assert.strictEqual(Cal.barEventLabel(e, e.startMs - 24 * 3600000, true), "Team sync · tomorrow 13:00")
})

test("the bar opens at the earliest reminder, or the lead time without one", function() {
  var e = timed(1, "Flight", 2026, 9, 28, 13, 0, 90)
  e.reminders = [e.startMs - 30 * 60000, e.startMs - 24 * 3600000]
  assert.deepStrictEqual(Cal.barSelection("soon", [e], [], e.startMs - 20 * 3600000, 15), [e])
  assert.deepStrictEqual(Cal.barSelection("soon", [e], [], e.startMs - 25 * 3600000, 15), [])
  var plain = timed(2, "Call", 2026, 9, 28, 13, 0, 30)
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.startMs - 20 * 60000, 15), [])
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.startMs - 10 * 60000, 15), [plain])
  assert.deepStrictEqual(Cal.barSelection("soon", [plain], [], plain.endMs, 15), [])
})

test("all-day events show from their reminder, never without one", function() {
  var bday = allDay(3, "Lena's bday", "2026-09-29")
  var eve = new Date(2026, 8, 28, 20, 0).getTime()
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], eve, 15), [])
  bday.reminders = [new Date(2026, 8, 28, 8, 0).getTime()]
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], eve, 15), [bday])
  assert.strictEqual(Cal.barEventLabel(bday, eve, true), "Lena's bday · tomorrow")
  assert.deepStrictEqual(Cal.barSelection("soon", [bday], [], new Date(2026, 8, 30, 0, 1).getTime(), 15), [])
})

test("overlaps: about to start beats under way beats coming beats all day", function() {
  var now = new Date(2026, 9, 1, 10, 0).getTime()
  var meeting = timed(1, "Meeting", 2026, 10, 1, 9, 30, 60)
  var soon = timed(2, "Standup", 2026, 10, 1, 10, 10, 15)
  var later = timed(3, "Lunch", 2026, 10, 1, 12, 0, 60)
  later.reminders = [later.startMs - 3 * 3600000]
  var holiday = allDay(4, "Holiday", "2026-10-01", "2026-10-01", { reminders: ["2026-09-30T08:00:00Z"] })
  var pick = Cal.barSelection("soon", [holiday, later, meeting, soon], [], now, 15)
  assert.deepStrictEqual(pick.map(function(e) { return e.title }), ["Standup", "Meeting", "Lunch", "Holiday"])
  assert.strictEqual(Cal.barLabel(pick, now, true), "Standup · in 10m  +3")
  var afterStandup = Cal.barSelection("soon", [meeting, later], [], now + 5 * 60000, 15)
  assert.strictEqual(afterStandup[0].title, "Meeting")
})

test("time mode drops the title and keeps the when", function() {
  var e = timed(1, "Secret meeting", 2026, 9, 28, 13, 0, 30)
  var now = e.startMs - 12 * 60000
  var pick = Cal.barSelection("time", [e], [e], now, 15)
  assert.strictEqual(Cal.barLabel(pick, now, true, "time"), "in 12m")
})

test("name mode keeps the title and drops the when", function() {
  var a = timed(1, "Standup", 2026, 9, 28, 13, 0, 15)
  var b = timed(2, "Lunch", 2026, 9, 28, 13, 5, 60)
  var now = a.startMs - 5 * 60000
  var pick = Cal.barSelection("name", [a, b], [a, b], now, 15)
  assert.strictEqual(Cal.barLabel(pick, now, true, "name"), "Standup  +1")
})

test("next mode falls back to today's next event", function() {
  var e = timed(1, "Dinner", 2026, 9, 28, 18, 30, 60)
  var now = e.startMs - 3 * 3600000
  assert.deepStrictEqual(Cal.barSelection("next", [e], [e], now, 15), [e])
  assert.deepStrictEqual(Cal.barSelection("off", [e], [e], e.startMs - 60000, 15), [])
})

test("long titles are cut to fit the bar", function() {
  var e = timed(1, "A very long meeting title that goes on and on", 2026, 9, 28, 13, 0, 30)
  assert.ok(Cal.barEventLabel(e, e.startMs - 60000, true).indexOf("…") !== -1)
})

// ---- Standard shapes any backend prints

test("calendar colors: named colors, hex, the accent otherwise", function() {
  assert.strictEqual(Cal.calendarColor("blue", "#000000"), "#6baffc")
  assert.strictEqual(Cal.calendarColor("#1A2B3C", "#000000"), "#1a2b3c")
  assert.strictEqual(Cal.calendarColor("chartreuse", "#000000"), "#000000")
})

// ---- Reminders

test("due reminders fire once, and never for what came due before start", function() {
  var now = Date.UTC(2026, 8, 28, 10, 30)
  var e = Cal.normalizeEvent({ id: 1, title: "Podcast", starts_at: "2026-09-28T11:00:00Z", ends_at: "2026-09-28T12:30:00Z",
    reminders: ["2026-09-28T10:30:00Z", "2026-09-28T09:00:00Z"] })
  var due = Cal.dueReminders([e], now, now - 60000, {})
  assert.strictEqual(due.length, 1)
  var shown = {}
  shown[due[0].key] = now
  assert.strictEqual(Cal.dueReminders([e], now + 15000, now - 60000, shown).length, 0)
  assert.strictEqual(Cal.reminderLead(e, now), "In 30 min")
})

test("declined events never notify", function() {
  var now = Date.UTC(2026, 8, 28, 10, 30)
  var e = Cal.normalizeEvent({ id: 1, title: "Nope", starts_at: "2026-09-28T11:00:00Z", status: "declined",
    reminders: ["2026-09-28T10:30:00Z"] })
  assert.strictEqual(Cal.dueReminders([e], now, 0, {}).length, 0)
})

// ---- New events

test("clock input is forgiving", function() {
  assert.strictEqual(Cal.parseClock("9"), "09:00")
  assert.strictEqual(Cal.parseClock("930"), "09:30")
  assert.strictEqual(Cal.parseClock("21.30"), "21:30")
  assert.strictEqual(Cal.parseClock("9:30pm"), "21:30")
  assert.strictEqual(Cal.parseClock("12am"), "00:00")
  assert.strictEqual(Cal.parseClock("25:00"), "")
  assert.strictEqual(Cal.parseClock("soon"), "")
})

test("day input is forgiving, relative to today (a Monday)", function() {
  var today = "2026-09-28"
  assert.strictEqual(Cal.parseDay("", today), today)
  assert.strictEqual(Cal.parseDay("tomorrow", today), "2026-09-29")
  assert.strictEqual(Cal.parseDay("fri", today), "2026-10-02")
  assert.strictEqual(Cal.parseDay("mon", today), today)
  assert.strictEqual(Cal.parseDay("next mon", today), "2026-10-05")
  assert.strictEqual(Cal.parseDay("in 3 days", today), "2026-10-01")
  assert.strictEqual(Cal.parseDay("+2w", today), "2026-10-12")
  assert.strictEqual(Cal.parseDay("3 oct", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("Oct 3rd", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("3", today), "2026-10-03")
  assert.strictEqual(Cal.parseDay("30", today), "2026-09-30")
  assert.strictEqual(Cal.parseDay("1 jan", today), "2027-01-01")
  assert.strictEqual(Cal.parseDay("2026-12-24", today), "2026-12-24")
  assert.strictEqual(Cal.parseDay("31 feb", today), "")
  assert.strictEqual(Cal.parseDay("someday", today), "")
})

test("arrow keys nudge times on a quarter-hour grid, and wrap lists", function() {
  assert.strictEqual(Cal.nudgeClock("9:07", 15, ""), "09:15")
  assert.strictEqual(Cal.nudgeClock("9:07", -15, ""), "09:00")
  assert.strictEqual(Cal.nudgeClock("09:00", 15, ""), "09:15")
  assert.strictEqual(Cal.nudgeClock("", 15, "14:00"), "14:15")
  assert.strictEqual(Cal.nudgeClock("23:45", 15, ""), "00:00")
  assert.strictEqual(Cal.shiftClock("9:30", 60), "10:30")
  assert.strictEqual(Cal.cycle([1, 2, 3], 3, 1), 1)
  assert.strictEqual(Cal.cycle([1, 2, 3], 1, -1), 3)
  assert.strictEqual(Cal.cycle(["", "10m"], "", 1), "10m")
})

// validateEvent checks the form; the backend turns the request into argv.
function build(form) {
  var checked = Cal.validateEvent(form)
  return checked.error ? checked : { command: Gcal.createCommand(checked.request) }
}

test("the add command is an argv, with every field in its own argument", function() {
  var args = build({ title: "Dinner; rm -rf ~", date: "2026-09-28", startTime: "7pm", endTime: "22:00",
    calendarId: 3, location: "Café Luna", remind: "30m" }).command
  assert.ok(args.indexOf("Dinner; rm -rf ~") !== -1)
  assert.deepStrictEqual(args.slice(args.indexOf("--when"), args.indexOf("--when") + 2), ["--when", "2026-09-28 19:00"])
  assert.deepStrictEqual(args.slice(args.indexOf("--duration"), args.indexOf("--duration") + 2), ["--duration", "180"])
  assert.deepStrictEqual(args.slice(args.indexOf("--reminder"), args.indexOf("--reminder") + 2), ["--reminder", "30m popup"])
  assert.strictEqual(args[4], "3")
})

test("an end before the start is the next morning", function() {
  var args = build({ title: "Party", date: "2026-09-28", startTime: "22:00", endTime: "1:00" }).command
  assert.deepStrictEqual(args.slice(args.indexOf("--duration"), args.indexOf("--duration") + 2), ["--duration", "180"])
})

test("the form refuses what Google would", function() {
  assert.ok(Cal.validateEvent({ title: " ", date: "2026-09-28" }).error)
  assert.ok(Cal.validateEvent({ title: "X", date: "2026-09-28", startTime: "nope" }).error)
  assert.ok(Cal.validateEvent({ title: "X", date: "2026-09-28", startTime: "10:00", endTime: "10:00" }).error)
})

// ---- Google backend and the bar

test("upcoming names the next owned event on any day, skipping read-only calendars", function() {
  var now = new Date(2026, 8, 28, 12, 0).getTime()
  var holiday = Cal.normalizeEvent({ id: "h", title: "Holiday", all_day: true, starts_at: "2026-09-30", ends_at: "2026-10-01", owned: false })
  var dentist = timed("d", "Dentist", 2026, 10, 2, 9, 30, 60)
  var past = timed("p", "Past", 2026, 9, 27, 9, 0, 30)
  assert.strictEqual(Cal.upcomingEvent([past, holiday, dentist], now).title, "Dentist")
  assert.strictEqual(Cal.barSelection("upcoming", [past, holiday, dentist], [], now, 15)[0].title, "Dentist")
  assert.strictEqual(Cal.upcomingEvent([past, holiday], now), null)
})

test("the create command maps the form onto gcalcli add", function() {
  var timedArgs = Gcal.createCommand({ title: "Lunch", date: "2026-10-01", allDay: false, startTime: "12:00",
    endTime: "13:30", endDate: "2026-10-01", calendarId: 2, location: "Cafe", remind: "10m" }).slice(4)
  assert.deepStrictEqual(timedArgs, ["2", "--title", "Lunch", "--when", "2026-10-01 12:00", "--duration", "90",
    "--where", "Cafe", "--reminder", "10m popup"])
  var overnight = Gcal.createCommand({ title: "Late", date: "2026-10-01", allDay: false, startTime: "22:00",
    endTime: "01:00", endDate: "2026-10-02", calendarId: 0 }).slice(4)
  assert.deepStrictEqual(overnight.slice(0, 1).concat(overnight.slice(5, 7)), ["0", "--duration", "180"])
  var allDay = Gcal.createCommand({ title: "Trip", date: "2026-10-01", allDay: true, endDate: "2026-10-03", calendarId: 1 }).slice(4)
  assert.deepStrictEqual(allDay, ["1", "--title", "Trip", "--allday", "--when", "2026-10-01", "--duration", "3", "--default-reminders"])
})

test("gcal day links open Google Calendar's day view", function() {
  assert.strictEqual(Gcal.dayUrl("2026-10-05"), "https://calendar.google.com/calendar/r/day/2026/10/5")
})

test("every link opens as a web app", function() {
  assert.strictEqual(Gcal.openCommand("https://calendar.google.com/calendar/r/day/2026/10/5")[0], "bash")
  assert.strictEqual(Gcal.openCommand("https://www.google.com/calendar/event?eid=abc").slice(-1)[0], "https://calendar.google.com/calendar/event?eid=abc")
  assert.strictEqual(Gcal.openCommand("https://meet.google.com/abc-defg-hij")[0], "bash")
})

test("12 or 24 hours follows the bar clock's own format", function() {
  assert.strictEqual(Cal.prefersHour24("auto", "dddd h:mm AP", "HH:mm"), false)
  assert.strictEqual(Cal.prefersHour24("auto", "dddd HH:mm", "h:mm AP"), true)
  assert.strictEqual(Cal.prefersHour24("24", "dddd h:mm AP", ""), true)
  assert.strictEqual(Cal.displayClock("18:30", false), "6:30pm")
  assert.strictEqual(Cal.displayClock("00:15", false), "12:15am")
  assert.strictEqual(Cal.displayClock("18:30", true), "18:30")
})

test("12-hour forms send the picked AM/PM, and a typed one wins", function() {
  assert.strictEqual(Cal.withMeridiem("6:45", "pm"), "6:45pm")
  assert.strictEqual(Cal.withMeridiem("6:45am", "pm"), "6:45am")
  assert.strictEqual(Cal.withMeridiem("", "pm"), "")
  assert.deepStrictEqual(Cal.splitClock("18:30"), { text: "6:30", meridiem: "pm" })
  assert.deepStrictEqual(Cal.splitClock("00:15"), { text: "12:15", meridiem: "am" })
  function req(startTime, endTime) {
    return Cal.validateEvent({ title: "T", date: "2026-09-30", startTime: startTime, endTime: endTime }).request
  }
  assert.strictEqual(req(Cal.withMeridiem("6:45", "pm")).startTime, "18:45")
  var r = req(Cal.withMeridiem("3", "pm"), Cal.withMeridiem("4", "pm"))
  assert.deepStrictEqual([r.startTime, r.endTime, r.endDate], ["15:00", "16:00", "2026-09-30"])
  var late = req(Cal.withMeridiem("10", "pm"), Cal.withMeridiem("1", "am"))
  assert.deepStrictEqual([late.endTime, late.endDate], ["01:00", "2026-10-01"])
})

if (failures > 0) {
  console.error(failures + " failed [" + tz + "]")
  process.exit(1)
}
console.log("ok [" + tz + "]")
