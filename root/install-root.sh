#!/bin/bash
# Optional system-level hooks for the calendar sync. Run once with sudo from
# the plugin folder:
#   sudo ./root/install-root.sh
# Installs:
#   /etc/NetworkManager/dispatcher.d/90-calsync   sync on connect if >24h stale
#   /etc/systemd/system/calsync-resume.service    sync after wake from sleep
# Both only start the user's own calsync units; they run nothing else as root.
# Remove with: sudo ./root/install-root.sh --remove
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo" >&2; exit 1; }
user="${SUDO_USER:-}"
[[ -n $user && $user != root ]] || { echo "run via sudo from your own account" >&2; exit 1; }

if [[ ${1:-} == --remove ]]; then
  systemctl disable --now calsync-resume.service 2>/dev/null || true
  rm -f /etc/NetworkManager/dispatcher.d/90-calsync /etc/systemd/system/calsync-resume.service
  systemctl daemon-reload
  echo "removed"
  exit 0
fi

if [[ -d /etc/NetworkManager/dispatcher.d ]] && systemctl is-enabled --quiet NetworkManager 2>/dev/null; then
install -m 0755 -o root -g root /dev/stdin /etc/NetworkManager/dispatcher.d/90-calsync <<SCRIPT
#!/bin/sh
# Installed by Google Calendar for Omarchy (root/install-root.sh). Starts $user's
# calendar sync when a connection comes up, if the last success is >24h old
# or an offline retry is pending (calsync decides; this only asks).
case "\$2" in
  up|connectivity-change) ;;
  *) exit 0 ;;
esac
[ "\$2" = connectivity-change ] && [ "\${CONNECTIVITY_STATE:-}" != FULL ] && exit 0
exec systemctl --user -M $user@ start --no-block calsync@86400.service
SCRIPT
echo "installed the network-online hook"
else
  echo "NetworkManager is not in use here; skipping the network-online hook"
fi

install -m 0644 -o root -g root /dev/stdin /etc/systemd/system/calsync-resume.service <<UNIT
# Installed by Google Calendar for Omarchy (root/install-root.sh)
[Unit]
Description=Start $user's calendar sync after waking from sleep
After=suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --user -M $user@ start --no-block calsync.service

[Install]
WantedBy=suspend.target hibernate.target hybrid-sleep.target suspend-then-hibernate.target
UNIT

systemctl daemon-reload
systemctl enable calsync-resume.service
echo "installed the wake-from-sleep hook for $user"
