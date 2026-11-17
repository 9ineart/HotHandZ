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
- **Size:** see below
- **Authentication:** SSH public key
- **Inbound ports:** SSH (22), HTTP (80), HTTPS (443)
- **Azure Spot discount:** leave **off**. Spot VMs are evictable at ~30
  seconds' notice, which would take the game down mid-judging.

### Which size

The 750 free hours/month cover three burstable sizes, not just one:

| Size | Arch | Notes |
| --- | --- | --- |
| `Standard_B2ats_v2` | x64 (AMD) | 2 vCPU / 1 GiB. **Best default.** |
| `Standard_B1s` | x64 | 1 vCPU / 1 GiB. Being retired in many regions, so it often does not appear at all. |
| `Standard_B2pts_v2` | **ARM64** | 2 vCPU / 1 GiB. Works, but you must pick the **Arm64** Ubuntu image to match. |

If no size is listed, it is a subscription-and-region restriction rather than
anything you did — try another region, or create the VM from the portal's
**Free services** page, which filters the list to free-eligible sizes.

### Or skip the form entirely

The portal's VM wizard moves its fields around between revisions. Azure Cloud
Shell (the `>_` icon in the portal's top bar) is already signed in as you and
needs nothing installed, and these commands do the same job deterministically:

```bash
# Which free-eligible burstable sizes does this region actually offer?
az vm list-skus --location eastus --size Standard_B2 --output table

az group create --name hothandz-rg --location eastus

az vm create \
  --resource-group hothandz-rg \
  --name hothandz \
  --image Ubuntu2404 \
  --size Standard_B2ats_v2 \
  --admin-username azureuser \
  --generate-ssh-keys \
  --public-ip-sku Standard

az vm open-port -g hothandz-rg -n hothandz --port 80 --priority 900
az vm open-port -g hothandz-rg -n hothandz --port 443 --priority 901
```

A Standard-SKU public IP is static by definition, so that box is ticked for
you. Port 22 is opened by `az vm create`. `--generate-ssh-keys` makes a key
pair in Cloud Shell if you have none; `az vm create` prints the public IP when
it finishes.

Cloud Shell asks to create a small storage account on first use, which costs a
few pence a month.

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

## 3. Install — the short way

Everything in sections 3 and 4 is scripted. On the VM:

```bash
curl -fsSL https://raw.githubusercontent.com/9ineart/HotHandZ/main/deploy/setup.sh | sudo bash
```

It adds swap, installs Node 22 and Caddy, clones and builds the app, installs
the service and the proxy, starts both, and checks the server is answering. It
is safe to run again — a second run updates, rebuilds and restarts.

Then skip to **section 5**. The rest of this section and section 4 are the
same steps by hand, if you would rather see them.

## 3a. Install — by hand

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
sudo NODE_OPTIONS=--max-old-space-size=2048 npm run build
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

Nothing deploys automatically. A push to GitHub sits there until the VM is
told to take it:

```bash
sudo bash /srv/hothandz/deploy/update.sh
```

That pulls, prints which commits arrived, reinstalls only if the lockfile
moved, rebuilds, restarts the room server and checks it came back.

It is manual on purpose. The live site changes only when you decide, which is
what you want while judges might be looking — an auto-deploy on every push can
take the site down with a bad commit at the worst possible moment.

Restarting drops any match in progress. Room state is in memory by design, so
there is nothing to migrate and nothing to corrupt — but don't run it mid-demo.

If you do want it hands-off later, the lowest-risk option is a systemd timer on
the VM polling `git` every few minutes. That needs no deploy key, no secret in
GitHub and no inbound access to the box — unlike a GitHub Actions workflow,
which would need your VM's private key stored as a repository secret.

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
