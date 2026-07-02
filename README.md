# EMBERFALL

A 2D knights-&-mages action game for the browser. Online **1v1 duels** and a **1–3 player co-op story campaign** set in the dying realm of **Aldermere**, where the last knights of the Ember Vigil and the mages of the burned College march to silence **the Cantor** before it finishes the hymn that is raising the dead.

## Run it

```bash
npm install
npm start
```

Open **http://localhost:3000** — that's the whole game.

## Play with friends

Everyone needs to reach the same server:

- **Same Wi-Fi:** find your LAN IP (`ipconfig getifaddr en0` on your Mac) and have friends open `http://<your-ip>:3000`.
- **Over the internet (recommended):** deploy to Render/Railway — it's a plain Node web service:
  - Build command: `npm install`
  - Start command: `node server.js`
  - (Render sets `PORT` automatically; the server reads it.)
  Then share the URL. WebSockets work over the same address, `wss://` is handled automatically on https.
- Or tunnel your local server with `ngrok http 3000` / `cloudflared tunnel --url http://localhost:3000`.

**In the game:** one player clicks *Begin a Campaign* (story, 1–3 players) or *Open a Duel* (1v1), then shares the 4-letter room code shown in the lobby. Friends type it into *Join a Friend*. The host picks the mission/arena and sounds the horn. Solo story works too — just start with nobody else in the lobby.

## Controls

| Action | Keys |
|---|---|
| Move | WASD / arrows |
| Attack | J / left-click (Ranger: **hold** to charge) |
| Class skill | K / right-click — Knight: **hold to block, tap on impact to parry** · Mage: Ember Nova · Ranger: volley |
| Dodge / blink | Space |
| Revive ally / interact | E (hold near a downed ally) |
| Advance dialogue | click / Enter |
| Menu | Esc |

Mage and Ranger aim with the mouse.

## Progression

Coins from kills, mission rewards, and duels are saved **per browser** (localStorage), and are spent in the shop on weapons, armor, stat training, and cosmetics. Story missions unlock in order; the host can pick any mission they've unlocked.

## Architecture notes

- `server.js` — static host + dumb WebSocket relay with rooms, heartbeats, and host migration. No game logic on the server.
- `public/game.js` — everything else. Each client simulates its own hero (your dodge/block/parry is judged on *your* machine, so it stays fair under lag); the room host simulates enemies and mission logic and broadcasts snapshots ~10 Hz. If the host disconnects, another player adopts the simulation mid-mission.
- `test-net.js` / `test-logic.js` — protocol and headless game-logic tests (`node test-net.js` with the server running; `node test-logic.js` standalone).

Netcode is trust-based (fine for playing with friends, not tournament-grade anti-cheat), and it favors stability over frame-perfect sync by design.
