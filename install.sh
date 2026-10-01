#!/bin/bash
# Google Calendar for Omarchy: installs (or re-installs) the sync, the timers
# and the bar widget. Idempotent, so it is safe to re-run after an update or a
# fix.
#
#   ./install.sh               install / repair
#   ./install.sh --uninstall   remove everything and bring back the stock clock
#
# Run it from wherever the code is: the plugin folder that
# `omarchy plugin add` made (~/.config/omarchy/plugins/dawestheperson.gcal), or
# a git checkout you develop in, which it then installs from with
# `omarchy plugin add file://…`.
#
# Optional, once, for syncing on reconnect and on wake from sleep:
#   sudo ./root/install-root.sh
#
# Nothing in /usr/share/omarchy is touched.

set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
ID="dawestheperson.gcal"
PLUGIN_DIR="$HOME/.config/omarchy/plugins/$ID"
SHELL_JSON="$HOME/.config/omarchy/shell.json"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
BIN_DIR="$HOME/.local/bin"
SCRIPTS=(calsync calsync-fetch calsync-reminders calsync-check-plugin calsync-failed calsync-doctor calsync-notify)
UNITS=(calsync.service calsync@.service calsync.timer calsync-failed.service)

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

if [[ ${1:-} == --uninstall ]]; then
  # The root hooks are removed by a script in this folder, which is about to
  # be deleted, so they have to go first.
  if [[ -e /etc/NetworkManager/dispatcher.d/90-calsync || -e /etc/systemd/system/calsync-resume.service ]]; then
    die "remove the root hooks first: sudo $REPO/root/install-root.sh --remove   (then run this again)"
  fi
  step "Removing Google Calendar for Omarchy"
  systemctl --user disable --now calsync.timer 2>/dev/null || true
  systemctl --user stop 'calsync-rem-*.timer' 2>/dev/null || true
  for u in "${UNITS[@]}"; do rm -f "$UNIT_DIR/$u"; done
  systemctl --user daemon-reload
  for f in "${SCRIPTS[@]}"; do
    [[ -L $BIN_DIR/$f ]] && rm -f "$BIN_DIR/$f"
  done
  rm -f "$HOME/.config/omarchy/hooks/post-update.d/calsync-check"
  layout=""
  if [[ -f $SHELL_JSON ]] && jq -e --arg id "$ID" '[.bar.layout[]?[]?.id] | index($id)' "$SHELL_JSON" >/dev/null 2>&1; then
    cp "$SHELL_JSON" "$SHELL_JSON.bak.$(date +%s)"
    # The stock clock goes back in the same slot, with the clock's own
    # settings and none of this plugin's.
    layout=$(jq -c --arg id "$ID" '
      .bar.layout | map_values(map(if .id == $id
        then (.id = "omarchy.clock" | del(.barEvent, .alertLeadMinutes, .timeFormat, .lastCalendarId,
          .quickAddShortcut, .hiddenCalendars, .refreshIntervalSec, .notifications, .liveSync))
        else . end))' "$SHELL_JSON")
  fi
  omarchy plugin enable omarchy.clock >/dev/null 2>&1 || true
  omarchy plugin remove "$ID" --yes 2>/dev/null || true
  if [[ -n $layout ]]; then
    # `plugin enable` and `plugin remove` re-place widgets; put the saved
    # layout back so the clock is exactly where this plugin was.
    jq --argjson layout "$layout" --arg id "$ID" '
      .bar.layout = $layout
      | if .bar.centerAnchor == $id then .bar.centerAnchor = "omarchy.clock" else . end
    ' "$SHELL_JSON" >"$SHELL_JSON.tmp" && mv "$SHELL_JSON.tmp" "$SHELL_JSON"
  fi
  echo "Done. The stock clock is back where this one was."
  echo "Kept: your calendar cache (~/.local/state/calsync) and gcalcli login (~/.local/share/gcalcli)."
  exit 0
fi

step "Checking requirements"
command -v omarchy >/dev/null || die "this is an Omarchy plugin; the omarchy command is missing"
command -v jq >/dev/null || die "jq is missing: omarchy pkg add jq"
if ! command -v gcalcli >/dev/null; then
  die "gcalcli is missing. Install it with: omarchy pkg aur add gcalcli   (then see GOOGLE_SETUP.md)"
fi
/usr/bin/python3 -c 'import googleapiclient, google.oauth2' 2>/dev/null ||
  die "gcalcli's Python libraries are missing; reinstall gcalcli"
echo "omarchy, jq and gcalcli found"

step "Sync scripts → $BIN_DIR"
mkdir -p "$BIN_DIR"
for f in "${SCRIPTS[@]}"; do
  ln -sfn "$REPO/sync/$f" "$BIN_DIR/$f"
done
echo "${SCRIPTS[*]}"
case ":$PATH:" in
*":$BIN_DIR:"*) ;;
*) echo "note: $BIN_DIR is not on your PATH; calsync-doctor will need its full path" ;;
esac

step "systemd user units → $UNIT_DIR"
mkdir -p "$UNIT_DIR"
for u in "${UNITS[@]}"; do
  install -m 0644 "$REPO/systemd/$u" "$UNIT_DIR/"
done
systemctl --user daemon-reload
systemctl --user enable --now calsync.timer

step "Omarchy post-update check"
install -D -m 0755 "$REPO/hooks/post-update" "$HOME/.config/omarchy/hooks/post-update.d/calsync-check"

oauth="${XDG_DATA_HOME:-$HOME/.local/share}/gcalcli/oauth"
[[ -f $oauth ]] && chmod 600 "$oauth"

step "Bar widget ($ID)"
if [[ $REPO == "$(readlink -f "$PLUGIN_DIR" 2>/dev/null)" ]]; then
  echo "running from the installed plugin; update it with: omarchy plugin update $ID"
elif [[ ! -d $PLUGIN_DIR ]]; then
  if [[ -n $(git -C "$REPO" status --porcelain 2>/dev/null) ]]; then
    echo "note: uncommitted changes in $REPO are not installed until committed"
  fi
  omarchy plugin add "file://$REPO" --yes
elif [[ -d $PLUGIN_DIR/.git ]]; then
  omarchy plugin update "$ID" --yes || echo "already up to date"
fi

step "Put it where the stock clock was, keeping the clock's settings"
if ! jq -e --arg id "$ID" '[.bar.layout[]?[]?.id] | index($id)' "$SHELL_JSON" >/dev/null 2>&1; then
  cp "$SHELL_JSON" "$SHELL_JSON.bak.$(date +%s)"
  if jq -e '[.bar.layout[]?[]?.id] | index("omarchy.clock")' "$SHELL_JSON" >/dev/null; then
    jq --arg id "$ID" '
      .bar.layout |= map_values(map(if .id == "omarchy.clock" then .id = $id else . end))
      | if .bar.centerAnchor == "omarchy.clock" then .bar.centerAnchor = $id else . end
    ' "$SHELL_JSON" >"$SHELL_JSON.tmp" && mv "$SHELL_JSON.tmp" "$SHELL_JSON"
  else
    omarchy plugin enable "$ID" --section center
  fi
fi
# Enable without `omarchy plugin enable`, which re-places a widget that is
# already in the bar.
omarchy-shell -q shell setPluginEnabled "$ID" true
omarchy plugin disable omarchy.clock >/dev/null 2>&1 || true
omarchy-shell -q shell rescanPlugins

step "First sync"
if [[ ! -f $oauth ]]; then
  echo "gcalcli is not signed in yet. Follow GOOGLE_SETUP.md, run \`gcalcli init\`,"
  echo "then: systemctl --user start calsync"
elif systemctl --user start calsync.service; then
  echo "ok"
else
  echo "the first sync failed; run calsync-doctor"
fi

step "Optional (needs sudo): sync on reconnect and on wake from sleep"
echo "  sudo $REPO/root/install-root.sh"
echo
echo "Done. Restart the shell to load everything: omarchy restart shell"
echo "Check health any time with: calsync-doctor"
