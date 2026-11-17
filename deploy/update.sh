#!/usr/bin/env bash
#
# Pull the latest commit, rebuild, restart. Run on the VM:
#
#   sudo bash /srv/hothandz/deploy/update.sh
#
# Deliberately manual. The live site changes only when you say so, which is
# what you want while judges might be looking at it -- an auto-deploy that
# fires on every push can take the site down with a bad commit at the worst
# possible moment.

set -euo pipefail

APP_DIR=/srv/hothandz
APP_USER=hothandz

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash $APP_DIR/deploy/update.sh" >&2
  exit 1
fi

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

cd "$APP_DIR"

before_head=$(git rev-parse HEAD)
before_lock=$(sha1sum package-lock.json | cut -d' ' -f1)

say "Pulling"
git pull --ff-only
after_head=$(git rev-parse HEAD)

if [[ $before_head == "$after_head" ]]; then
  say "Already at $(git rev-parse --short HEAD) -- rebuilding anyway"
else
  say "$(git rev-parse --short "$before_head") -> $(git rev-parse --short "$after_head")"
  git --no-pager log --oneline "$before_head..$after_head" | sed 's/^/    /'
fi

# npm ci wipes node_modules and reinstalls, which takes minutes on this box.
# Only worth it when the lockfile actually moved.
if [[ "$(sha1sum package-lock.json | cut -d' ' -f1)" != "$before_lock" ]]; then
  say "Lockfile changed, reinstalling"
  npm ci
else
  say "Lockfile unchanged, skipping install"
fi

say "Building"
# V8 caps its heap from detected RAM and will not grow past it however much
# swap exists; without this the build dies on this 1 GiB box.
NODE_OPTIONS=--max-old-space-size=2048 npm run build

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "Restarting the room server"
# This drops any match in progress. Room state is in memory by design, so
# there is nothing to migrate -- but do not run this mid-demo.
systemctl restart hothandz-rooms

sleep 2
if systemctl is-active --quiet hothandz-rooms && curl -fsS --max-time 5 http://127.0.0.1:8787/ | grep -q HotHandZ; then
  say "Live at $(git rev-parse --short HEAD)"
else
  echo "Room server did not come back: journalctl -u hothandz-rooms -n 40" >&2
  exit 1
fi
