# Third-party notices

Google Calendar for Omarchy builds on two MIT-licensed projects. Their
copyright notices are kept in [LICENSE](LICENSE).

- **Omarchy's stock clock plugin** (`$OMARCHY_PATH/shell/plugins/panels/clock`).
  `Model.js` is that plugin's file, unchanged. The clock label, the month
  grid, week numbers and year bar in `BarWidget.qml` and `Panel.qml` come
  from it.
- **[OmaCal](https://github.com/crmne/omacal)** by Carmine Paolino. The
  calendar UI started from OmaCal 1.0.0: the day chips, day view, event
  cards, new-event form, quick-add card and shortcut handling (`Panel.qml`,
  `EventCard.qml`, `EventForm.qml`, `QuickAdd.qml`, `Shortcut*`,
  `SettingsView.qml`), and the date and event model in `Calendar.js`.

Everything that talks to Google, and the sync around it, is this project's
own work: `backends/Gcal.js`, `sync/`, `systemd/`, `root/`, `hooks/` and
`install.sh`. So are the week and day views, the AM/PM entry, the sync-health
warning and the web app links.

Google Calendar is a trademark of Google LLC. This project is not affiliated
with, endorsed by or supported by Google, Omarchy or 37signals.
