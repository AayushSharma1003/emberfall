// Headless client-logic test. Shims just enough DOM/canvas to run game.js in Node.
'use strict';
const noop = () => {};
const ctxProxy = () => new Proxy({}, {
  get(t, k) {
    if (k === 'canvas') return { width: 1280, height: 720 };
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (k === 'measureText') return () => ({ width: 10 });
    if (typeof k === 'string') return t[k] !== undefined ? t[k] : noop;
    return noop;
  },
  set(t, k, v) { t[k] = v; return true; }
});
function el(id) {
  return {
    id, style: {}, value: '', textContent: '', innerHTML: '', dataset: { cls: 'knight' },
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, appendChild: noop, querySelector: () => null,
    getContext: ctxProxy, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    offsetWidth: 600, offsetHeight: 240, width: 0, height: 0,
    onclick: null, oninput: null
  };
}
const els = {};
global.document = {
  getElementById: id => els[id] || (els[id] = el(id)),
  querySelectorAll: () => [],
  createElement: () => el('tmp')
};
global.window = global;
global.location = { protocol: 'http:', host: 'localhost:3000' };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
global.addEventListener = noop;
global.requestAnimationFrame = noop; // we drive the loop manually
global.AudioContext = function () { return { state: 'running', currentTime: 0, sampleRate: 44100, resume: noop, destination: {}, createOscillator: () => ({ type: '', frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop, value: 0 }, connect: o => o, start: noop, stop: noop }), createGain: () => ({ gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop, value: 0 }, connect: o => o, disconnect: noop }), createBuffer: (a, n) => ({ getChannelData: () => new Float32Array(n) }), createBufferSource: () => ({ buffer: null, loop: false, connect: o => o, start: noop, stop: noop }), createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, connect: o => o }) }; };
const sent = [];
global.WebSocket = function () { return { readyState: 1, send: m => sent.push(JSON.parse(m)), close: noop, set onopen(f) { setTimeout(f, 0); }, onmessage: null, onclose: null, onerror: null }; };

const fs = require('fs');
const code = fs.readFileSync(__dirname + '/public/game.js', 'utf8');
// expose module internals for testing
const exposed = `
;global.__T = { G, Hero, onNet, dispatch, startMissionLocal, startDuelLocal, updateEnemiesHost, updateDirector,
  updateProjs, updateFx, spawnEnemy, applyEnemyHit, damageMe, meleeHit, adoptHost, applyWorld, render, Keys, P,
  pushWorld, pushSt, MISSIONS, ETYPES, Net, resetDuelRound, duelDeath, drawHero, drawEnemy, UI, buildShop, FX };`;
eval(code + exposed);

const T = global.__T;
const { G } = T;
T.Net.ws = { readyState: 1, send: m => sent.push(JSON.parse(m)), close: noop };
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

// ---- join a 2-player story room as host
T.onNet({ t: 'joined', code: 'ABCD', id: 1, hostId: 1, mode: 'story', players: [{ id: 1, name: 'Me', cls: 'knight', look: { c1: '#fff', tier: 0 } }], started: false });
T.onNet({ t: 'p+', p: { id: 2, name: 'Pal', cls: 'mage', look: {} } });
ok(G.players.size === 2 && G.me && G.host, 'joined as host with 2 players');

// ---- start mission 1 (waves)
T.onNet({ t: 'started', info: { mission: 0, seed: 42 } });
ok(G.mission === 0 && G.dir && G.dir.i === 0, 'mission 0 started, first beat active');

function tick(n, dt) {
  for (let i = 0; i < n; i++) {
    G.time += dt;
    G.players.forEach(h => h.update(dt));
    T.updateEnemiesHost(dt); T.updateDirector(dt); T.updateProjs(dt); T.updateFx(dt);
    T.pushWorld(); T.pushSt();
  }
}
tick(300, 0.05); // 15s: wave 1 spawns
ok(G.enemies.size > 0, 'wave enemies spawned (' + G.enemies.size + ')');

// remote player position updates
T.onNet({ t: 'st', id: 2, x: 500, y: 520, dir: 1, hp: 95, mhp: 95, anim: 1, dn: 0, dd: 0, bl: 0, ch: 0 });
tick(20, 0.05);
const pal = G.players.get(2);
ok(Math.abs(pal.x - 500) < 30, 'remote hero interpolates toward replicated pos');

// melee an enemy to death
const firstEn = [...G.enemies.values()][0];
G.me.x = firstEn.x - 40; G.me.y = firstEn.y; G.me.dir = 1;
const coinsBefore = T.P.coins;
for (let i = 0; i < 30 && firstEn.hp > 0; i++) T.applyEnemyHit(firstEn.id, 20, 100, 1);
ok(firstEn.hp <= 0, 'enemy dies from hits');
ok(T.P.coins > coinsBefore, 'kill paid coins (' + (T.P.coins - coinsBefore) + ')');

// enemy hit event on me: blocking side check + damage path
G.me.hp = G.me.mhp; G.me.invT = 0; G.me.blocking = false; G.me.downed = false; G.me.dead = false; G.me.stunT = 0;
T.dispatch({ id: 99, k: 'ehit', tg: 1, dmg: 20, dir: -1, kb: 100 });
ok(G.me.hp < G.me.mhp, 'ehit damages me');
// parry: block pressed this instant, attack from front
G.me.hp = G.me.mhp; G.me.blocking = true; G.me.blockAt = G.time; G.me.dir = 1;
T.dispatch({ id: 99, k: 'ehit', tg: 1, dmg: 20, dir: -1, kb: 100 });
ok(G.me.hp === G.me.mhp && G.me.parryBuffT > 0, 'parry negates damage and grants riposte buff');

// kill everything to advance beats to completion
for (let guard = 0; guard < 40 && !G.over; guard++) {
  G.enemies.forEach(en => { if (en.hp > 0 && !T.ETYPES[en.ti].boss) T.applyEnemyHit(en.id, 500, 0, 1); });
  tick(60, 0.05);
}
ok(G.over === true, 'mission 0 completes after clearing all beats');
ok(T.P.prog >= 1, 'next mission unlocked (prog=' + T.P.prog + ')');

// ---- mission with boss (4): run and slay boss
G.over = false; G.started = true;
T.onNet({ t: 'started', info: { mission: 3, seed: 7 } });
for (let guard = 0; guard < 80 && !G.over; guard++) {
  G.enemies.forEach(en => { if (en.hp > 0) T.applyEnemyHit(en.id, 400, 0, 1); });
  tick(60, 0.05);
}
ok(G.over, 'garrison mission with Captain Maro completes');

// ---- escort mission (2nd): wagon moves when guarded
G.over = false;
T.onNet({ t: 'started', info: { mission: 1, seed: 9 } });
const wag = G.dir.wagon;
ok(!!wag, 'escort wagon exists');
G.me.x = wag.x + 50; G.me.y = wag.y; G.me.downed = false; G.me.dead = false; G.me.hp = G.me.mhp;
const wx0 = wag.x;
G.enemies.clear();
tick(100, 0.05);
ok(G.dir.wagon === null || G.dir.i > 0 || G.dir.wagon.x > wx0, 'wagon advances while guarded');

// ---- guest-side world snapshot handling
G.host = false;
T.applyWorld({ e: [['eX', 0, 900, 500, 30, 32, 1, -1, 1]], o: [['b', 400, 500, 50, 0]], ot: 'Test', boss: ['The Cantor', 500, 1150], bt: 1 });
ok(G.enemies.has('eX') && G.objs.length === 1 && G.boss && G.boss.hp === 500, 'guest applies world snapshot');

// ---- host migration
G.started = true; G.over = false; G.mission = 2; G.beatIdx = 0; G.mode = 'story';
T.onNet({ t: 'p-', id: 2, hostId: 1 }); // (we were host already in flag terms; force scenario)
G.host = false; G.hostId = 2; G.roster.push({ id: 2, name: 'Pal', cls: 'mage', look: {} }); G.players.set(2, new T.Hero(2, 'Pal', 'mage', {}, true));
T.onNet({ t: 'p-', id: 2, hostId: 1 });
ok(G.host === true && G.dir && G.dir.beacons && G.dir.beacons.length > 0, 'host migration adopts director (beacons rebuilt: ' + (G.dir.beacons ? G.dir.beacons.length : 0) + ')');

// ---- duel flow
G.players.clear(); G.roster = [];
T.onNet({ t: 'joined', code: 'DDDD', id: 1, hostId: 1, mode: 'duel', players: [{ id: 1, name: 'Me', cls: 'knight', look: {} }], started: false });
T.onNet({ t: 'p+', p: { id: 2, name: 'Rival', cls: 'ranger', look: {} } });
T.onNet({ t: 'started', info: { arena: 1, seed: 3 } });
ok(G.duel && G.countdown > 0, 'duel starts with countdown');
G.countdown = -1;
// opponent melee hits me via hitP until I die -> host (me) adjudicates
G.me.blocking = false; G.me.invT = 0;
let guard = 0;
while (!G.me.dead && guard++ < 60) T.dispatch({ id: 2, k: 'hitP', tg: 1, dmg: 30, dir: 1, kb: 50 });
ok(G.me.dead, 'duel: I can be slain');
ok(G.duel.score[2] === 1, 'host adjudicated round to opponent (score=' + JSON.stringify(G.duel.score) + ')');
// simulate my melee vs remote -> emits hitP over net
sent.length = 0;
T.resetDuelRound(); G.countdown = -1;
const rival = G.players.get(2);
G.me.x = rival.x - 40; G.me.y = rival.y; G.me.dir = 1; G.me.dead = false; G.me.downed = false;
T.meleeHit(G.me, 25, 78, 100);
ok(sent.some(m => m.t === 'ev' && m.k === 'hitP' && m.tg === 2), 'duel melee sends hitP to opponent');

// ---- render smoke (proxied canvas): draw everything once without throwing
try {
  G.mode = 'story'; T.onNet({ t: 'started', info: { mission: 5, seed: 11 } });
  T.spawnEnemy('cantor', 800, 500, false);
  ['goblin','bandit','zombie','soldier','cultist','stone','maro'].forEach((e,i)=>T.spawnEnemy(e, 300+i*80, 480, i%2===0));
  T.FX.slash(100,100,1,1,'#fff'); T.FX.ring(1,1,10,'#fff'); T.FX.zone(200,500,90,1,20); T.FX.text(1,1,'x','#fff');
  tick(10, 0.05);
  T.render(0.016);
  ok(true, 'full render pass with every enemy type + fx does not throw');
} catch (e) { ok(false, 'render threw: ' + e.message); }

console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL PASS');
process.exit(fails ? 1 : 0);
