# Deploying HotHandZ

Everything runs from **one host**: `hothandz.nineart.studio`, an Azure B1s VM
with Caddy in front.

| Path | Served by |
| --- | --- |
| `/hca-ws` | `server/rooms.mjs` on localhost:8787 |
| everything else | the static build in `/srv/hothandz/dist` |

Sharing an origin is the point. `NetClient` falls back to
`wss://<the page's own host>/hca-ws` when `VITE_HCA_SERVER_URL` is unset, so
**the socket URL never has to be baked into the build** — a plain
`npm run build` is correct. That removes the deployment step most likely to
fail silently.

The room server is not optional and not only for multiplayer: the AI rival's
picks are scheduled server-side, so **without it there is no match of any kind,
solo included.** This is why a static-only host (GitHub Pages, Vercel,
Netlify) cannot run this game on its own.

---

## 1. The VM

Azure's free account includes 750 hours/month of a B1s for 12 months — one VM
running continuously.

In the Azure portal:

- **Image:** Ubuntu Server 24.04 LTS
- **Size:** B1s — this exact size is what the free allowance covers
- **Authentication:** SSH public key
- **Inbound ports:** SSH (22), HTTP (80), HTTPS (443)

Do **not** open 8787. The room server listens on localhost; Caddy is the only
thing that reaches it.

Set the public IP to **Static** (Networking → the IP resource →
Configuration). The default is dynamic, and when it changes your DNS and your
certificate both break.

> The free allowance covers compute hours. A static IP and outbound bandwidth
> are billed separately on some subscriptions — check the portal's estimate.

## 2. DNS

Point `hothandz.nineart.studio` at the VM's public IP with an `A` record.

Wait for it to resolve before installing Caddy, or its first certificate
request will fail.

```bash
dig +short hothandz.nineart.studio
```

## 3. Install

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Node 22 satisfies the `engines` range in `package.json`.

**Add swap before building.** A B1s has 1 GiB of RAM and a Vite production
build can exceed it. This is the difference between a build that works and one
that is killed halfway with a confusing error:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 4. Deploy

```bash
sudo useradd --system --home /srv/hothandz --shell /usr/sbin/nologin hothandz
sudo mkdir -p /srv/hothandz /var/lib/hothandz
sudo git clone https://github.com/9ineart/HotHandZ.git /srv/hothandz
cd /srv/hothandz
sudo npm ci
sudo npm run build
sudo chown -R hothandz:hothandz /srv/hothandz /var/lib/hothandz
```

A full `npm ci` here, not `--omit=dev`: Vite is a dev dependency and the build
needs it. (`ws`, which the server needs at runtime, is a real dependency — it
used to sit in `devDependencies`, where a production-only install would have
skipped it and the server would have died on its first import.)

Install the service and the proxy:

```bash
sudo cp /srv/hothandz/deploy/hothandz-rooms.service /etc/systemd/system/
sudo cp /srv/hothandz/deploy/Caddyfile /etc/caddy/Caddyfile

sudo systemctl daemon-reload
sudo systemctl enable --now hothandz-rooms
sudo systemctl reload caddy
```

The Caddyfile already names `hothandz.nineart.studio`. If you use a different
hostname, change it there first.

## 5. Check it

```bash
systemctl status hothandz-rooms --no-pager
curl -I https://hothandz.nineart.studio           # 200, and a valid certificate
```

Then open `https://hothandz.nineart.studio` in a browser. The lobby should
load and a solo match should count down. If it sits on "looking for a
challenger", the socket is not connecting:

```bash
journalctl -u hothandz-rooms -f      # is the server seeing the upgrade?
sudo journalctl -u caddy -f          # is Caddy routing /hca-ws?
```

## 6. Check it on the headset

Open the same URL in the Quest browser. This is the only test that proves hand
tracking, gesture recognition, passthrough, table calibration and frame rate —
none of which the desktop view or the emulator can show you.

---

## Updating

```bash
cd /srv/hothandz && sudo git pull && sudo npm ci && sudo npm run build
sudo systemctl restart hothandz-rooms
```

Restarting drops any match in progress. Room state is in memory by design;
there is nothing to migrate and nothing to corrupt.

The leaderboard at `/var/lib/hothandz/leaderboard.json` sits outside the
checkout deliberately, so a redeploy cannot take it with it.

## If you later want a CDN in front

A B1s serving static files to a room full of judges is the weak point, not the
WebSocket. If it matters, put the build on Vercel and leave the socket on the
VM — but then the two are no longer same-origin, so the build needs the URL
baked in:

```bash
VITE_HCA_SERVER_URL="wss://hothandz.nineart.studio/hca-ws" npm run build
```
