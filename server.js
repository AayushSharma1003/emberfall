// EMBERFALL server — static host + lightweight WebSocket room relay.
// The server is intentionally "dumb": it manages rooms and relays messages.
// Game simulation runs on the clients (the room host simulates enemies/missions).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(PUB, path.normalize(p).replace(/^([.][.][/\\])+/, ''));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map(); // code -> room
let nextId = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += A[(Math.random() * A.length) | 0];
  return rooms.has(c) ? makeCode() : c;
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function bcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const [pid, p] of room.players) if (pid !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}
function roster(room) {
  const r = [];
  for (const [pid, p] of room.players) r.push({ id: pid, name: p.name, cls: p.cls, look: p.look });
  return r;
}

wss.on('connection', (ws) => {
  let room = null, id = null, rc = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch (e) { return; }
    if (m.t === 'create') {
      rc = makeCode(); id = nextId++;
      room = { mode: m.mode === 'duel' ? 'duel' : 'story', players: new Map(), hostId: id, started: false, startInfo: null };
      room.players.set(id, { ws, name: String(m.name || 'Nameless').slice(0, 16), cls: m.cls, look: m.look });
      rooms.set(rc, room);
      send(ws, { t: 'joined', code: rc, id, hostId: id, mode: room.mode, players: roster(room), started: false });
    } else if (m.t === 'join') {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(ws, { t: 'err', msg: 'No room with that code. Check it and try again.' });
      const cap = r.mode === 'duel' ? 2 : 3;
      if (r.players.size >= cap) return send(ws, { t: 'err', msg: 'That room is full.' });
      if (r.started && r.mode === 'duel') return send(ws, { t: 'err', msg: 'That duel is already underway.' });
      room = r; rc = String(m.code).toUpperCase().trim(); id = nextId++;
      room.players.set(id, { ws, name: String(m.name || 'Nameless').slice(0, 16), cls: m.cls, look: m.look });
      send(ws, { t: 'joined', code: rc, id, hostId: room.hostId, mode: room.mode, players: roster(room), started: room.started, startInfo: room.startInfo });
      bcast(room, { t: 'p+', p: { id, name: room.players.get(id).name, cls: m.cls, look: m.look } }, id);
    } else if (!room) {
      // ignore anything else before joining
    } else if (m.t === 'start') {
      if (id !== room.hostId) return;
      room.started = true; room.startInfo = m.info;
      bcast(room, { t: 'started', info: m.info });
    } else if (m.t === 'end') {
      if (id !== room.hostId) return;
      room.started = false; room.startInfo = null;
      bcast(room, { t: 'ended' });
    } else if (m.t === 'st' || m.t === 'ev' || m.t === 'world') {
      m.id = id;
      bcast(room, m, id);
    }
  });

  ws.on('close', () => {
    if (!room || id == null) return;
    room.players.delete(id);
    if (room.players.size === 0) { rooms.delete(rc); return; }
    if (room.hostId === id) room.hostId = room.players.keys().next().value;
    bcast(room, { t: 'p-', id, hostId: room.hostId });
    room = null;
  });
});

// Heartbeat: drop dead sockets so disconnects are detected promptly.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 15000);

server.listen(PORT, () => console.log('EMBERFALL is lit → http://localhost:' + PORT));
