# Deploying HotHandZ

The game is **two** deployments, not one:

| Piece | What it is | Where it goes |
| --- | --- | --- |
| `dist/` | static files from `npm run build` | any static host (Vercel, GitHub Pages) |
| `server/rooms.mjs` | always-on Node WebSocket server | a small VM (Azure B1s) |

The server is not optional and it is not only for multiplayer. The AI rival's
picks are scheduled server-side, so **without the room server there is no
match of any kind**, solo included.

The server cannot run on Vercel, Netlify or GitHub Pages. It holds room state
in an in-memory `Map`, which needs one long-lived process that every player
reaches; serverless hosts give you neither.

---

## 1. The VM

Azure's free account includes 750 hours/month of a B1s VM for 12 months, which
is one VM running continuously.

Create it in the Azure portal:

- **Image:** Ubuntu Server 24.04 LTS
- **Size:** B1s — this exact size is what the free allowance covers
- **Authentication:** SSH public key
- **Inbound ports:** SSH (22), HTTP (80), HTTPS (443)

Do **not** open 8787. The room server listens on localhost only; Caddy is the
only thing that talks to it.

Then set the public IP to **Static** (Networking → the IP resource →
Configuration). A dynamic IP changes when the VM is deallocated, which breaks
DNS and takes the certificate with it.

> The free allowance covers the VM's compute hours. A static IP and outbound
> bandwidth are billed separately on some subscriptions — check the cost
> estimate in the portal before you leave it running.

## 2. DNS

Point a hostname at the VM's public IP with an `A` record, e.g.
`rooms.yourdomain.com`. You need a real hostname: certificates are not issued
for bare IP addresses, and without a certificate there is no `wss://`.

Wait for it to resolve before the next step, or Caddy's first certificate
request will fail.

## 3. Install

SSH in, then:

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Node 22 is chosen to satisfy the `engines` range in `package.json`.

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 4. Deploy the server

```bash
sudo useradd --system --home /srv/hothandz --shell /usr/sbin/nologin hothandz
sudo mkdir -p /srv/hothandz /var/lib/hothandz
sudo git clone https://github.com/9ineart/HotHandz.git /srv/hothandz
cd /srv/hothandz
sudo npm ci --omit=dev
sudo chown -R hothandz:hothandz /srv/hothandz /var/lib/hothandz
```

`ws` is a runtime dependency, so `--omit=dev` keeps it. (It used to sit in
`devDependencies`, where a production install would have skipped it and the
server would have died on its first import.)

Install the service and the proxy:

```bash
sudo cp /srv/hothandz/deploy/hothandz-rooms.service /etc/systemd/system/
sudo cp /srv/hothandz/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/rooms.example.com/rooms.yourdomain.com/' /etc/caddy/Caddyfile

sudo systemctl daemon-reload
sudo systemctl enable --now hothandz-rooms
sudo systemctl reload caddy
```

Check it:

```bash
systemctl status hothandz-rooms --no-pager
curl https://rooms.yourdomain.com          # -> "HotHandZ room server"
```

That `curl` returning the health line over **https** proves both halves: the
server is up, and Caddy has a valid certificate.

## 5. Build and deploy the front end

The socket URL is baked in at build time, so it must be set when you build —
setting it afterwards does nothing.

```bash
VITE_HCA_SERVER_URL="wss://rooms.yourdomain.com/hca-ws" npm run build
```

The full path including `/hca-ws` is required; `NetClient` uses the value
verbatim.

On Windows PowerShell:

```powershell
$env:VITE_HCA_SERVER_URL="wss://rooms.yourdomain.com/hca-ws"; npm run build
```

Then publish `dist/`:

- **Vercel** — `npx vercel deploy --prod dist`. Free, HTTPS automatically, and
  it serves from the domain root so no extra configuration is needed.
- **GitHub Pages** — set `base: '/your-repository-name/'` in `vite.config.ts`
  first, or every asset 404s, then `npx gh-pages -d dist`.

## 6. Check it on the headset

Open the deployed URL in the Quest browser and start a solo match. If the
lobby sits on "looking for a challenger" and never counts down, the socket is
not connecting — check the browser console for the `wss://` URL it tried, and
`journalctl -u hothandz-rooms -f` on the VM.

---

## Updating

```bash
cd /srv/hothandz && sudo git pull && sudo npm ci --omit=dev
sudo systemctl restart hothandz-rooms
```

Restarting drops any match in progress. Room state is in memory by design;
there is nothing to migrate and nothing to corrupt.

The leaderboard at `/var/lib/hothandz/leaderboard.json` is deliberately outside
the checkout, so a redeploy cannot take it with it. Back it up before anything
drastic.
