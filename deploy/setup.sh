#!/usr/bin/env bash
#
# One-shot bootstrap for the HotHandZ host on a fresh Ubuntu 24.04 B1s.
#
#   curl -fsSL https://raw.githubusercontent.com/9ineart/HotHandZ/main/deploy/setup.sh | sudo bash
#
# or, once the repo is cloned:  sudo bash deploy/setup.sh
#
# Safe to run again: every step checks before it acts, so a re-run updates the
# checkout, rebuilds and restarts rather than duplicating anything.

set -euo pipefail

HOSTNAME_FQDN="${HOTHANDZ_HOST:-hothandz.nineart.studio}"
REPO="${HOTHANDZ_REPO:-https://github.com/9ineart/HotHandZ.git}"
APP_DIR=/srv/hothandz
DATA_DIR=/var/lib/hothandz
APP_USER=hothandz

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/setup.sh" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Host: $HOSTNAME_FQDN"

# --- swap -------------------------------------------------------------------
# A B1s has 1 GiB of RAM and the Vite build can exceed it. Without swap the
# build is killed partway through with an error that does not mention memory.
if ! swapon --show | grep -q /swapfile; then
  say "Adding 2G swap (the build needs more than 1 GiB)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
else
  say "Swap already present, skipping"
fi

# --- packages ---------------------------------------------------------------
say "Installing base packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [[ "$(node -v)" != v22.* ]]; then
  say "Installing Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
else
  say "Node $(node -v) already installed"
fi

if ! command -v caddy >/dev/null; then
  say "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
else
  say "Caddy already installed"
fi

# --- application ------------------------------------------------------------
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"

if [[ -d $APP_DIR/.git ]]; then
  say "Updating the checkout"
  git -C "$APP_DIR" pull --ff-only
else
  say "Cloning $REPO"
  git clone --depth 1 "$REPO" "$APP_DIR"
fi

say "Installing dependencies and building"
# A full install, not --omit=dev: Vite is a dev dependency and the build needs
# it. (ws is a real dependency, so the server has it either way.)
cd "$APP_DIR"
npm ci
npm run build

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

# --- services ---------------------------------------------------------------
say "Installing the service and the proxy"
cp "$APP_DIR/deploy/hothandz-rooms.service" /etc/systemd/system/
sed "s/hothandz\.nineart\.studio/$HOSTNAME_FQDN/" "$APP_DIR/deploy/Caddyfile" >/etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable --now hothandz-rooms
systemctl restart hothandz-rooms
systemctl reload caddy || systemctl restart caddy

# --- verify -----------------------------------------------------------------
say "Checking"
sleep 2
systemctl is-active --quiet hothandz-rooms \
  && echo "  room server: running" \
  || { echo "  room server: FAILED - journalctl -u hothandz-rooms -n 40"; exit 1; }

if curl -fsS --max-time 5 http://127.0.0.1:8787/ | grep -q HotHandZ; then
  echo "  localhost:8787: answering"
else
  echo "  localhost:8787: no answer - journalctl -u hothandz-rooms -n 40"
  exit 1
fi

cat <<EOF

Done. Now check from outside:

  curl -I https://$HOSTNAME_FQDN

If the certificate is not ready yet, give Caddy a minute and check:

  sudo journalctl -u caddy -n 40

The first request triggers certificate issuance, which needs DNS for
$HOSTNAME_FQDN to already point at this machine.
EOF
