# HotHandZ

Rock, Paper, Scissors as a tabletop game for VR.

A Meta Quest mixed-reality game built with [IWSDK](https://developers.meta.com/vr/documentation/iwsdk/),
Vite and TypeScript. You place an arena on your real table through passthrough,
and throw rock, paper or scissors with your bare hands — no controllers. The
gesture you hold is read from your hand joints, locks in on a five-count, and
your fighter acts it out against the rival's.

## Running it locally

```sh
npm install
npm run dev
```

That starts the Vite dev server, the room server and a managed browser
together. On the flat desktop view, keys `1`, `2` and `3` stand in for rock,
paper and scissors — hold one for about half a second to lock it.

To put it on a headset on the same network, take the network URL from
`npx @iwsdk/cli dev status` and accept the local certificate warning.

## Architecture

This is **two deployments, not one**:

| | |
| --- | --- |
| `dist/` | static build from `npm run build` |
| `server/rooms.mjs` | always-on WebSocket room server |

The server is authoritative. It owns room membership, the round clock, hidden
picks, damage and the winner; clients send intents and render what comes back.
The AI rival's picks are scheduled server-side too, **so there is no match of
any kind without it — solo included.** It cannot run on a static host.

See [docs/DEPLOY.md](docs/DEPLOY.md) for deploying both halves, and
[docs/SUBMISSION.md](docs/SUBMISSION.md) for the current state of the project.

## Layout

```
iwsdk.config.json      project authority: scene, assets, components, world
src/index.ts           World.create() + explicit system registration
src/game/              gameplay systems (combat, match, UI, calibration, fx)
src/scene-assets/      procedural Object3D prototypes
public/scenes/         scene composition JSON
public/ui/             UIKitML panels
server/                authoritative room server
```

Deeper conventions live in `AGENTS.md` and the scoped instruction files beside
the code they govern.
