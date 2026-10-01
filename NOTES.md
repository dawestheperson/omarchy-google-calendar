# NOTES: how this works and how to fix it

Maintainer notes for Google Calendar for Omarchy: architecture, file
locations, and fixes. For a future maintainer (probably a Claude session):
read this first, then run `calsync-doctor`. It checks everything below and
prints the fix. Install-specific details for one machine (which Google project,
etc.) go in a git-ignored `NOTES.local.md` beside this file.

## What it is

An Omarchy 4 shell plugin, id **`dawestheperson.gcal`**. It replaces the stock
`omarchy.clock` bar widget with the same clock and popup, plus Google Calendar
events. The calendar UI started from [OmaCal](https://github.com/crmne/omacal)
(MIT, see THIRD_PARTY_NOTICES.md). The stock clock is
**disabled**, not removed: `omarchy plugin enable omarchy.clock` brings it back.

Design rule: **no always-on process.** The bar only reads a JSON cache. A short
systemd oneshot (`calsync`) refreshes that cache, then exits.

## Architecture

```
Google Calendar ──(API, gcalcli's OAuth token)──► calsync-fetch (python, ~2 s)
                                                   │ writes atomically
                                                   ▼
             ~/.local/state/calsync/events.json  +  reminders.json  +  status.json
                    │                                   │
     bar widget: jq over the cache                calsync-reminders: one
     (backends/Gcal.js), re-read                  `systemd-run --on-calendar`
     every 5 min and on popup open                timer per reminder in the next 48 h
                    │
     quick-add ──► `gcalcli add` ──► Google ──► `systemctl --user start calsync`
```

### When a sync runs

| Trigger | Unit | Gate |
|---|---|---|
| Daily at midnight (`Persistent=true`: a missed run happens at next boot/wake) | `calsync.timer` → `calsync.service` | always |
| Login (user manager start + 1 min) | `calsync.timer` (`OnStartupSec=1min`) | always |
| Wake from sleep | `/etc/systemd/system/calsync-resume.service` → user `calsync.service` | always |
| Network connects | `/etc/NetworkManager/dispatcher.d/90-calsync` → `calsync@86400.service` | last success > 24 h, **or** an offline retry is pending |
| Popup opened | bar runs `systemctl --user start calsync@30.service` | last success > 30 s |
| Event added from the PC | `gcalcli add` then `calsync.service` | always |

`calsync@N.service` runs `calsync --if-stale N`. The phone uses the Google
Calendar app, so Google itself syncs events to it.

### Why the fetch reads the API instead of `gcalcli agenda --tsv`

gcalcli's TSV output has neither event reminders nor calendar colors, and the
design needs both. `calsync-fetch` therefore loads **gcalcli's own OAuth token**
(`~/.local/share/gcalcli/oauth`, a pickled `google.oauth2.credentials.Credentials`)
and calls the Calendar API through `google-api-python-client`, which gcalcli
already depends on. The login and the OAuth client are still gcalcli's, and writes
(`gcalcli add`) and the auth check (`gcalcli list`) still go through the gcalcli CLI.
If a gcalcli update ever changes where or how it stores the token, fix
`load_service()` in `sync/calsync-fetch`.

### Offline vs. real failure

`calsync` classifies each run:

- **ok**: the cache is updated, `last-success` is stamped, and the reminder timers
  are re-armed.
- **offline** (DNS fails, network/timeout errors, Google 5xx): writes status
  `offline`, touches `pending-retry`, and **exits 0**, so no alert. The
  network-online hook retries.
- **auth** (exit 3: token missing or revoked, 401/403) and **error** (exit 1):
  the unit fails, so `OnFailure=calsync-failed.service` sends the popup
  "Calendar sync failed — run calsync-doctor". That popup is rate-limited to one
  per 6 h.

The bar shows **⚠** when `status.json.last_success` is more than 36 h old. Its
tooltip explains why.

### Reminders

Every successful sync stops all `calsync-rem-*.timer` units, then arms one
transient timer (`systemd-run --user --on-calendar=…`) for each reminder due in
the next 48 h. That window outlasts the 24 h gap between daily syncs.

- The reminder time is the event's own Google reminder (its overrides, or the
  calendar's defaults).
- With no reminder set, timed events on calendars you own get **15 min**.
  All-day events and read-only calendars (US Holidays) stay silent, as they do
  in Google.
- Declined events never alert.

Timers fire `calsync-notify`, which uses `omarchy-notification-send` and falls
back to `notify-send`. Transient timers are lost at reboot or logout; the login
sync re-arms them. The shell's own in-panel reminder loop is switched off
(`notificationsEnabled: false` in `BarWidget.qml`), so nothing alerts twice.

### Omarchy updates

- `~/.config/omarchy/hooks/post-update.d/calsync-check` runs after
  `omarchy update`. It schedules `calsync-check-plugin --notify` for 2 min later,
  once the shell has restarted.
- Belt and braces: each sync compares `omarchy version` with
  `~/.local/state/calsync/omarchy-version`. If it changed, the sync runs the same
  check and stores the new version only when the check passes.
- The check confirms the plugin is installed, enabled, validates, is in the bar
  layout, and that the running shell answers `omarchy-shell dawestheperson.gcal ping`.
  If any of that fails, a critical notification tells you to run calsync-doctor.

## File locations

| What | Where |
|---|---|
| Installed plugin (a git clone made by `omarchy plugin add`, from GitHub or from a local checkout via `file://…`) | `~/.config/omarchy/plugins/dawestheperson.gcal/` |
| Bar entry (`format`, `formatAlt`, `weekStartDay`, `barEvent`, …) | `~/.config/omarchy/shell.json` → `bar.layout.center[]`, id `dawestheperson.gcal`; also `bar.centerAnchor` |
| Scripts (symlinks into `sync/`) | `~/.local/bin/calsync*` |
| User units (copies of `systemd/`) | `~/.config/systemd/user/calsync{.service,@.service,.timer,-failed.service}` |
| Root hooks (made by `root/install-root.sh`) | `/etc/NetworkManager/dispatcher.d/90-calsync`, `/etc/systemd/system/calsync-resume.service` |
| Omarchy hook | `~/.config/omarchy/hooks/post-update.d/calsync-check` |
| Cache and state | `~/.local/state/calsync/`: `events.json`, `reminders.json`, `status.json`, `last-success`, `pending-retry`, `omarchy-version`, `calsync.log`, `lock` |
| Logs | `journalctl --user -u calsync -u 'calsync@*' -u calsync-failed`; also `~/.local/state/calsync/calsync.log` (last 1000 lines) |
| gcalcli login | `~/.local/share/gcalcli/oauth` (mode 600) |
| Google OAuth client | The user's own project at console.cloud.google.com → Google Auth Platform: a Desktop client, Audience External, **In production**. How to make one: GOOGLE_SETUP.md. Which project this machine uses: NOTES.local.md. |

### Repo layout

- `BarWidget.qml` (bar label, sync status, ⚠, popup host), `Panel.qml`
  (month/week/day views), `EventCard.qml`, `EventForm.qml` (with AM/PM),
  `QuickAdd.qml`, `Service.qml` + `Shortcut*` (the Alt+Shift+Space binding),
  `SettingsView.qml`.
- `Calendar.js`: the date, event and bar model (pure JS, runs under node).
  `Model.js` is Omarchy's own stock clock model, unchanged.
- `backends/Gcal.js` is the Google backend: command lines only (jq over the
  cache, `gcalcli add`, the status/sync commands, and how links open).
- `sync/`: `calsync`, `calsync-fetch`, `calsync-reminders`, `calsync-failed`,
  `calsync-check-plugin`, `calsync-doctor`, `calsync-notify`.
- `systemd/`, `root/`, `hooks/`: the units and hooks listed above.
- `tests/run`: node tests in 5 timezones (`Calendar.js` and the backend).
- `install.sh` (install, repair, `--uninstall`), `GOOGLE_SETUP.md` (making the
  OAuth client), `README.md`.
- `docs/`: the GitHub Pages site (homepage + privacy policy) at
  https://dawestheperson.github.io/omarchy-google-calendar/. Users' OAuth
  consent screens link to it (GOOGLE_SETUP.md step 3), so keep both URLs
  working: Google can refuse sign-ins for an app whose links are dead.

## 12 or 24 hours

`timeFormat` "auto" (the default) follows the **bar clock's own format** first:
`dddd h:mm AP` means 12-hour. The shell's Qt locale often reads as C/24-hour
even on en_US systems, so the locale is only the last resort
(`Cal.prefersHour24`). This decides the bar label (`until 7:16pm`), the popup's
times, and the form: on a 12-hour clock, times are typed bare (`6:45`) and
**AM/PM is picked with buttons** next to From and To. Typing `pm` into the
field also works and moves the button. Reminder notifications are written by
`calsync-fetch` in 12-hour format.

## Google Calendar web app

**Every** link from the popup opens as an Omarchy web app window, never a
browser tab. That covers the ↗ button, `O`, clicking an event, and meeting links.
Calendar pages land in the **Google Calendar** web app. The web app was
installed with:

```bash
omarchy webapp install "Google Calendar" https://calendar.google.com/ \
  https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/google-calendar.png
```

That creates `~/.local/share/applications/Google Calendar.desktop`, which runs
`omarchy-launch-webapp`. `openCommand()` in `backends/Gcal.js` sends
`calendar.google.com/…` and `www.google.com/calendar/…` links to
`omarchy-launch-webapp`, falling back to `xdg-open`. Event links arrive as
`www.google.com/calendar/event?eid=…`, which redirects to another site; an app
window hands that redirect to the default browser, so
`directCalendarUrl()` rewrites them to `calendar.google.com/calendar/…` first.
If the web app is removed, the links
still work: `omarchy-launch-webapp` opens any URL as an app window.

## Keys and IPC

In the popup, the stock keys work: arrows, `[` `]`, `{` `}`, `T`. The added keys:

- `D` / `W` / `M`: day, week or month view. The stock week-start toggle moved to
  `Shift+W`.
- `N`: new event. `R`: re-read the cache. `O`: open the day in Google Calendar.
- `,` `.`: previous/next day. `<` `>`: previous/next week.

Quick add from anywhere: `Alt+Shift+Space` (setting `quickAddShortcut`).

IPC: `omarchy-shell dawestheperson.gcal <open|close|toggle|refresh|newEvent|settings|ping>`,
`omarchy-shell dawestheperson.gcal view <day|week|month>`, and
`omarchy-shell shell toggle dawestheperson.gcal` (the quick-add card).

## Change, update, reinstall

From a local git checkout (the installed plugin is a clone of it):

```bash
cd <your checkout>
# edit, then:
tests/run && omarchy plugin validate .
git commit -am "…"
omarchy plugin update dawestheperson.gcal --yes   # the installed copy pulls the commit
```

Sync scripts are symlinks, so they take effect immediately. After editing
`systemd/`, re-run `./install.sh`, which copies the units and runs daemon-reload.

**Gotcha:** after `omarchy plugin update`, run **`omarchy restart shell`**.
The shell hot-reloads the QML files, but it keeps the old copy of imported `.js`
files (`Calendar.js`, `backends/*.js`) and of IPC function lists. A fix in them
seems to do nothing until the restart.

Full reinstall, which is idempotent:

```bash
./install.sh                       # from the plugin folder or your checkout
sudo ./root/install-root.sh        # optional: network-online + wake hooks
```

`install.sh` does the following:

1. Symlinks the scripts into `~/.local/bin` and copies the units.
2. Enables `calsync.timer` and installs the post-update hook.
3. When run from a checkout, runs `omarchy plugin add file://<checkout> --yes`
   if the plugin is missing, otherwise `omarchy plugin update`.
4. Swaps `omarchy.clock` for `dawestheperson.gcal` in `shell.json`, keeping its
   settings and backing up to `shell.json.bak.<epoch>`.
5. Disables `omarchy.clock` and runs a first sync.

To uninstall: `sudo ./root/install-root.sh --remove` first (if the root hooks
are installed; the uninstaller refuses otherwise, since it deletes that
script), then `./install.sh --uninstall`. That puts the stock clock back in
the same slot, without this plugin's settings.

## Common failures and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Popup "Calendar sync failed", doctor says **auth** / `invalid_grant` | Token revoked or expired (password change, access removed at myaccount.google.com/permissions, or the app went back to Testing) | Check Audience is still **In production** in the Cloud console. Then run `gcalcli init` in a terminal and approve (Advanced → Go to <app name> (unsafe) → Continue; GOOGLE_SETUP.md step 6). Then `systemctl --user start calsync`. |
| Google login page: "Access blocked … has not completed the Google verification process", Error 403 access_denied | App is in Testing and you are not a test user | Audience → **Publish app**. If Publish is greyed out, Branding needs the homepage, privacy URL and authorized domain (GOOGLE_SETUP.md step 3), then Save. |
| `gcalcli init` asks for the client ID/secret again | `oauth` file deleted | The ID is shown under Clients in the Cloud console. The secret is shown only once, so create a new secret there (or a new Desktop client). |
| ⚠ in the bar, doctor says "offline" for days | Network hook not installed, or DNS broken | `sudo root/install-root.sh`. Check `getent hosts www.googleapis.com`. |
| ⚠ in the bar, no popup | Syncs aren't running at all | `systemctl --user status calsync.timer`. If it's not active, `./install.sh`. |
| Bar shows the plain stock clock, or nothing | Plugin disabled or removed from the layout (an Omarchy update or `omarchy refresh shell` rewrote `shell.json`) | `./install.sh`, then `omarchy restart shell`. |
| Bar module missing after an Omarchy update, "Calendar plugin broken" popup | Omarchy changed a shell API the QML uses (`qs.Ui`, `qs.Commons`, `BarWidget`, `Panel`, `KeyboardPanel`, …) | `journalctl --user -b \| grep -iE 'gcal\|qml'` for the error. Compare with the stock clock, which Omarchy keeps current: `diff /usr/share/omarchy/shell/plugins/panels/clock/Model.js Model.js` (should match exactly) and the stock `BarWidget.qml`/`Panel.qml` for renamed APIs. OmaCal (github.com/crmne/omacal) shares most of the UI and may already have the fix. Stopgap: `omarchy plugin enable omarchy.clock`. |
| Doctor says "a simulated failure is switched on" | Left over from testing | `rm ~/.local/state/calsync/simulate` |
| Event added on the PC is missing on the phone | `gcalcli add` failed (the error shows in the form) or went to another calendar | Look for it at calendar.google.com. The phone app pulls from Google, so nothing on this machine is involved. |
| No reminder popups | Timers not armed (reboot before a sync), or the event's calendar is read-only or all-day | `systemctl --user list-timers 'calsync-rem-*'`, then `systemctl --user start calsync`. |
| A reminder fires late | The machine was asleep at the reminder time; a systemd realtime timer fires on wake | Expected. |
| Empty days far ahead in the popup | Only ~7 days back and ~45 days ahead are synced; the popup says so | Change `DAYS_BACK`/`DAYS_AHEAD` in `sync/calsync-fetch`. |

### Test hooks

- `echo error > ~/.local/state/calsync/simulate` makes syncs fail (use `auth`
  or `offline` for the other paths). Remove the file to stop.
- To see the ⚠, backdate the last success:
  `echo $(( $(date +%s) - 40*3600 )) > ~/.local/state/calsync/last-success`.
  The next real sync resets it.
- `CALSYNC_PLUGIN_ID=x.missing calsync-check-plugin --notify` shows the
  broken-plugin alert without touching the real plugin.
- `rm ~/.local/state/calsync/last-failure-alert` lifts the 6 h popup rate limit.
