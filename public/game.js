/* ============================================================================
   EMBERFALL — knights & mages, duels & the Ashen Choir.
   Single-file client. The room host simulates enemies/missions; every client
   simulates its own hero; the server relays. Lag-tolerant by design.
   ============================================================================ */
'use strict';

/* ---------------------------------------------------------------- utils -- */
const TAU = Math.PI * 2;
const W = 1280, H = 720;
const FLOOR_TOP = 392, FLOOR_BOT = 688;      // playable depth band
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const $ = id => document.getElementById(id);
let _seed = 1;
const srand = s => { _seed = (s % 2147483646) + 1; };
const sr = () => { _seed = _seed * 16807 % 2147483647; return (_seed - 1) / 2147483646; };
const srr = (a, b) => a + sr() * (b - a);
const shade = (hex, f) => { // lighten/darken a #rrggbb
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

/* ---------------------------------------------------------------- audio -- */
const AU = {
  ac: null, amb: null, ambGain: null,
  ctx() { if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ac && this.ac.state === 'suspended') this.ac.resume(); return this.ac; },
  tone(f0, f1, dur, type, vol, delay) {
    const ac = this.ctx(); if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, hp, delay) {
    const ac = this.ctx(); if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = hp ? 'highpass' : 'lowpass'; f.frequency.value = hp || 900;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ac.destination); src.start(t);
  },
  swing() { this.noise(0.12, 0.16, 2200); },
  hit() { this.noise(0.09, 0.3, 500); this.tone(160, 60, 0.1, 'square', 0.16); },
  parry() { this.tone(1900, 2600, 0.16, 'triangle', 0.2); this.tone(950, 1400, 0.1, 'square', 0.1); },
  block() { this.tone(300, 180, 0.08, 'square', 0.14); this.noise(0.06, 0.12, 1500); },
  cast() { this.tone(500, 1400, 0.16, 'sine', 0.14); },
  nova() { this.tone(220, 60, 0.4, 'sawtooth', 0.2); this.noise(0.3, 0.22, 300); },
  bow(ch) { this.tone(700 + ch * 500, 200, 0.1, 'triangle', 0.14); this.noise(0.07, 0.12, 3000); },
  blink() { this.tone(1300, 300, 0.14, 'sine', 0.16); },
  roll() { this.noise(0.1, 0.1, 400); },
  hurt() { this.tone(220, 90, 0.14, 'sawtooth', 0.16); },
  die() { this.tone(200, 40, 0.5, 'sawtooth', 0.2); this.noise(0.4, 0.2, 250); },
  coin() { this.tone(1100, 1600, 0.06, 'square', 0.08); this.tone(1500, 2100, 0.08, 'square', 0.08, 0.06); },
  ui() { this.tone(600, 800, 0.05, 'square', 0.06); },
  gong() { this.tone(180, 150, 1.1, 'triangle', 0.24); this.tone(360, 300, 0.9, 'sine', 0.12); },
  bossRoar() { this.tone(90, 45, 0.8, 'sawtooth', 0.26); this.noise(0.6, 0.24, 200); },
  revive() { this.tone(400, 900, 0.3, 'sine', 0.16); this.tone(600, 1200, 0.3, 'sine', 0.1, 0.1); },
  ambient(zone) { // low bed of wind + drone, retuned per zone
    const ac = this.ctx(); if (!ac) return;
    this.stopAmbient();
    const g = ac.createGain(); g.gain.value = 0.035; g.connect(ac.destination);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.value = [55, 49, 41, 62, 46, 36][zone] || 50;
    const og = ac.createGain(); og.gain.value = 0.5; o.connect(og).connect(g); o.start();
    const n = ac.createBufferSource();
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf; n.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
    const ng = ac.createGain(); ng.gain.value = 0.8;
    n.connect(f).connect(ng).connect(g); n.start();
    this.amb = [o, n]; this.ambGain = g;
  },
  stopAmbient() { if (this.amb) { try { this.amb.forEach(x => x.stop()); this.ambGain.disconnect(); } catch (e) {} this.amb = null; } }
};

/* -------------------------------------------------------------- profile -- */
const SAVE_KEY = 'emberfall_v1';
const DEF_PROFILE = () => ({
  name: '', cls: 'knight',
  c1: '#8a4fbe', c2: '#3a2a44', c3: '#ffb14f',
  helm: 0, capeOn: false, trailOn: false,
  coins: 120,
  up: { vit: 0, mgt: 0, swf: 0, arc: 0 },
  wep: { knight: 0, mage: 0, ranger: 0 },
  armor: 0,
  own: {},          // owned unlockables: wk1,wk2,wm1,wm2,wr1,wr2,a1,a2,cape,helmB,helmC,trail
  prog: 0           // highest unlocked mission index
});
let P = DEF_PROFILE();
function loadProfile() {
  try { const s = localStorage.getItem(SAVE_KEY); if (s) P = Object.assign(DEF_PROFILE(), JSON.parse(s)); } catch (e) {}
  P.up = Object.assign({ vit: 0, mgt: 0, swf: 0, arc: 0 }, P.up);
  P.wep = Object.assign({ knight: 0, mage: 0, ranger: 0 }, P.wep);
  P.own = P.own || {};
}
function saveProfile() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(P)); } catch (e) {} }
function addCoins(n) { if (n <= 0) return; P.coins += n; saveProfile(); AU.coin(); }

/* ----------------------------------------------------------------- data -- */
const CLASSES = {
  knight: {
    name: 'Knight', hp: 150, spd: 2.55, dmg: 22, range: 78, col: '#e8b04a',
    desc: 'Sword and oath. High health, heavy three-hit swings, and a shield — hold your skill key to block, press it at the moment of impact to parry and stagger your foe.'
  },
  mage: {
    name: 'Mage', hp: 95, spd: 2.7, dmg: 16, col: '#82b6ff',
    desc: 'Glass and fire. Rapid firebolts aimed with the mouse, a devastating Ember Nova around you, and a blink instead of a dodge. Fragile — and lethal in careful hands.'
  },
  ranger: {
    name: 'Ranger', hp: 115, spd: 3.0, dmg: 14, col: '#9dc46a',
    desc: 'Patience made sharp. Hold attack to charge arrows — full draws pierce through lines of foes. Skill key looses a three-arrow volley. Fastest boots in Aldermere.'
  }
};
const HELMS = {
  knight: ['Great Helm', 'Plumed Helm', 'Hooded Coif'],
  mage: ['Pointed Hat', 'Circlet', 'Deep Cowl'],
  ranger: ['Ranger Hood', 'Feathered Cap', 'Bare-headed']
};
const WEAPONS = {
  knight: [{ n: 'Vigil Sword', m: 1 }, { n: 'Ember Brand', m: 1.22, c: 160, k: 'wk1' }, { n: 'Dawnbreaker', m: 1.5, c: 420, k: 'wk2' }],
  mage: [{ n: 'Ash Staff', m: 1 }, { n: 'Cindervein Rod', m: 1.22, c: 160, k: 'wm1' }, { n: 'Heart of the Choir', m: 1.5, c: 420, k: 'wm2' }],
  ranger: [{ n: 'Yew Bow', m: 1 }, { n: 'Marchwood Recurve', m: 1.22, c: 160, k: 'wr1' }, { n: 'The Long Silence', m: 1.5, c: 420, k: 'wr2' }]
};
const ARMORS = [
  { n: 'Traveler\u2019s Garb', hp: 0, def: 0 },
  { n: 'Vigil Plate', hp: 28, def: 0.08, c: 160, k: 'a1' },
  { n: 'Sanctum Aegis', hp: 60, def: 0.16, c: 420, k: 'a2' }
];
const UPGRADES = [
  { k: 'vit', n: 'Vitality', d: '+8% max health per rank', c: 90, max: 5 },
  { k: 'mgt', n: 'Might', d: '+6% damage per rank', c: 90, max: 5 },
  { k: 'swf', n: 'Swiftness', d: '+4% move speed per rank', c: 110, max: 3 },
  { k: 'arc', n: 'Arcana', d: '+10% mana & faster skill cooldowns per rank', c: 90, max: 5 }
];
const COSMETICS = [
  { k: 'cape', n: 'Vigil Cape', d: 'A tattered banner of the old order.', c: 130 },
  { k: 'helmB', n: 'Second headwear', d: 'Unlocks your class\u2019s second headpiece.', c: 100 },
  { k: 'helmC', n: 'Third headwear', d: 'Unlocks your class\u2019s third headpiece.', c: 100 },
  { k: 'trail', n: 'Ember Trail', d: 'Your steps leave living sparks.', c: 220 }
];
function helmOwned(i) { return i === 0 || (i === 1 && P.own.helmB) || (i === 2 && P.own.helmC); }
function myStats() {
  const base = CLASSES[P.cls], wep = WEAPONS[P.cls][P.wep[P.cls]], arm = ARMORS[P.armor];
  return {
    mhp: Math.round((base.hp + arm.hp) * (1 + 0.08 * P.up.vit)),
    dmg: base.dmg * wep.m * (1 + 0.06 * P.up.mgt),
    spd: base.spd * (1 + 0.04 * P.up.swf),
    def: arm.def,
    mana: Math.round(100 * (1 + 0.1 * P.up.arc)),
    cdMul: 1 / (1 + 0.07 * P.up.arc)
  };
}

/* zones: sky top/bottom, silhouettes, ground, fog color, particle kind */
const ZONES = [
  { n: 'Hearthfen Village', sky: ['#3b2033', '#c9502a'], far: '#241120', mid: '#170a13', ground: '#2a1a20', gline: '#48302f', fog: 'rgba(255,140,60,.05)', part: 'ember', props: 'village' },
  { n: 'The Hollow Road', sky: ['#1a2430', '#4a5a3a'], far: '#131c1a', mid: '#0c1210', ground: '#1a2019', gline: '#2e3a28', fog: 'rgba(140,180,120,.05)', part: 'leaf', props: 'forest' },
  { n: 'Gravemarsh', sky: ['#101a18', '#2e4a3a'], far: '#0c1614', mid: '#07100d', ground: '#13201a', gline: '#24382c', fog: 'rgba(110,200,150,.10)', part: 'fog', props: 'marsh' },
  { n: 'Turncoat Garrison', sky: ['#131625', '#3a4a6a'], far: '#10131f', mid: '#0a0c15', ground: '#1a1d29', gline: '#2e3350', fog: 'rgba(120,150,255,.05)', part: 'snow', props: 'garrison' },
  { n: 'Cathedral of Ash', sky: ['#22101a', '#6a2a20'], far: '#1a0c14', mid: '#100710', ground: '#241318', gline: '#452427', fog: 'rgba(255,90,60,.07)', part: 'ash', props: 'ruin' },
  { n: 'The Cantor\u2019s Sanctum', sky: ['#150a22', '#3a1a4a'], far: '#120820', mid: '#0a0414', ground: '#1c1028', gline: '#332048', fog: 'rgba(190,120,255,.08)', part: 'ash', props: 'sanctum' }
];

/* enemy archetypes (index order matters — used in net snapshots) */
const ETYPES = [
  { id: 'goblin', n: 'Marsh Goblin', hp: 32, spd: 2.3, dmg: 8, range: 46, coin: 3, w: 30, windup: 0.45, rec: 0.5, col: '#6a9a4a' },
  { id: 'bandit', n: 'Roadside Bandit', hp: 58, spd: 2.0, dmg: 12, range: 56, coin: 5, w: 36, windup: 0.5, rec: 0.55, col: '#8a6a4a', throws: true },
  { id: 'zombie', n: 'Hymn-risen', hp: 95, spd: 1.05, dmg: 16, range: 50, coin: 6, w: 38, windup: 0.7, rec: 0.8, col: '#5a7a6a', lunge: true },
  { id: 'soldier', n: 'Turncoat Soldier', hp: 82, spd: 1.65, dmg: 14, range: 60, coin: 8, w: 38, windup: 0.55, rec: 0.6, col: '#5a6a9a', shield: true },
  { id: 'cultist', n: 'Choir Cultist', hp: 46, spd: 1.8, dmg: 12, range: 380, coin: 8, w: 34, windup: 0.8, rec: 1.1, col: '#9a5a8a', caster: true },
  { id: 'maro', n: 'Captain Maro, the Turncoat', hp: 620, spd: 2.1, dmg: 20, range: 84, coin: 60, w: 52, windup: 0.55, rec: 0.5, col: '#7a8ac0', boss: true },
  { id: 'cantor', n: 'The Cantor', hp: 1150, spd: 1.5, dmg: 22, range: 90, coin: 120, w: 60, windup: 0.6, rec: 0.6, col: '#b070e0', boss: true },
  { id: 'stone', n: 'Resonance Stone', hp: 150, spd: 0, dmg: 0, range: 0, coin: 12, w: 44, windup: 0, rec: 0, col: '#b070e0', stone: true }
];
const ET = {}; ETYPES.forEach((e, i) => ET[e.id] = i);

/* ------------------------------------------------------------ the story -- */
const LORE_INTRO =
  'Aldermere was sung into being — so the old faith claims — by a god who died before the hymn was done. ' +
  'For an age the unfinished song slept under the Cathedral of Ash. Now something beneath the ruin has begun to sing it again, ' +
  'and the dead rise on its rhythm. The last knights of the Ember Vigil and the scattered mages of the burned College ' +
  'have set their old grudges aside. Someone must climb to the Sanctum and silence the Cantor before the final verse.';

const WHO = { ashe: 'Warden Ashe', senna: 'Archivist Senna', maro: 'Captain Maro', cantor: 'The Cantor', v: 'A villager' };

const MISSIONS = [
  {
    name: 'Embers at Dusk', zone: 0, reward: 130, levelW: 2000,
    blurb: 'Hearthfen burns at the edge of the marsh. Goblins and bandits strike at dusk — hold the village square.',
    intro: [
      ['ashe', 'Hearthfen still stands, barely. The marsh-goblins smell the fear on this place — and worse follows fear.'],
      ['senna', 'Listen, under the wind. A rhythm. The raids fall on the same beat, like a drum counting something down.'],
      ['ashe', 'Then we break the drum. Hold the square. No one else burns tonight.']
    ],
    outro: [['v', 'You... you came. The Vigil came. We thought the old orders were stories.'], ['ashe', 'Stories are what\u2019s left when duty is forgotten. Rest. We march at dawn.']],
    beats: [
      { t: 'wave', text: 'Repel the raiders', spawns: [['goblin', 5]] },
      { t: 'dlg', lines: [['senna', 'More shapes on the treeline — and men among them. Bandits running with goblins. That is not natural.']] },
      { t: 'wave', text: 'Repel the second wave', spawns: [['goblin', 4], ['bandit', 3]] },
      { t: 'wave', text: 'Break the raid-captain', spawns: [['bandit', 4], ['goblin', 3], ['bandit', 1, true]] }
    ]
  },
  {
    name: 'The Hollow Road', zone: 1, reward: 170, levelW: 3200,
    blurb: 'Senna\u2019s reliquary cart carries the only surviving score of the true hymn. Escort it down the Hollow Road.',
    intro: [
      ['senna', 'In this cart is the College\u2019s last relic: a fragment of the hymn as it was meant to be sung. If the Cantor completes its broken version first, Aldermere ends.'],
      ['ashe', 'Then the cart does not stop. Stay close to it — the road has ears, and the ears have knives.']
    ],
    outro: [['senna', 'The fragment is safe. I can almost read it now... it is not a song of ending. It was meant to be a lullaby.']],
    beats: [
      { t: 'escort', text: 'Guard the reliquary cart', hp: 340, press: [['bandit', 7.5], ['goblin', 5.5]] },
      { t: 'wave', text: 'Break the final ambush', spawns: [['bandit', 4], ['bandit', 1, true], ['goblin', 2]] }
    ]
  },
  {
    name: 'Gravemarsh', zone: 2, reward: 210, levelW: 2400,
    blurb: 'The dead of the marsh walk in time with the hymn. Light the three ward-beacons to break its rhythm here.',
    intro: [
      ['ashe', 'The marsh gave up its dead a week ago. They do not wander — they march. In step.'],
      ['senna', 'The old ward-beacons can deafen this ground to the song. Stand by each flame while I feed it — the dead will not approve.']
    ],
    outro: [['senna', 'Three flames against a choir. It is not victory. But tonight, the marsh sleeps silent.']],
    beats: [
      { t: 'beacons', text: 'Light the ward-beacons (stand close)', n: 3, press: [['zombie', 6.5], ['goblin', 8]] },
      { t: 'wave', text: 'Scatter the last of the risen', spawns: [['zombie', 4], ['zombie', 1, true]] }
    ]
  },
  {
    name: 'The Turncoat Garrison', zone: 3, reward: 270, levelW: 2200,
    blurb: 'Fort Merrow\u2019s garrison has sworn itself to the Choir. Captain Maro holds the only pass to the cathedral.',
    intro: [
      ['ashe', 'Maro trained half the Vigil. Myself included. If he has given the fort to the Choir, he did not do it out of fear.'],
      ['maro', 'Ashe! Still polishing a dead order\u2019s crest? The song is going to finish with us or without us. I chose WITH.'],
      ['ashe', 'Then you chose. Blades out — the pass is behind him.']
    ],
    outro: [['ashe', '...He smiled at the end. Like a man who\u2019d heard the last note early. Burn the gate. We go to the cathedral.']],
    beats: [
      { t: 'wave', text: 'Breach the outer yard', spawns: [['soldier', 4], ['bandit', 2]] },
      { t: 'wave', text: 'Cut through the garrison', spawns: [['soldier', 4], ['soldier', 1, true], ['cultist', 1]] },
      { t: 'boss', text: 'Defeat Captain Maro', type: 'maro' }
    ]
  },
  {
    name: 'Choir of Ash', zone: 4, reward: 320, levelW: 2600,
    blurb: 'Within the burned cathedral, three resonance stones carry the hymn out across Aldermere. Shatter them.',
    intro: [
      ['senna', 'Do you feel it in your teeth? The stones are singing the broken verse outward, like bells. Every one we shatter makes the Cantor\u2019s voice smaller.'],
      ['ashe', 'And angrier. Good. Angry things swing wide.']
    ],
    outro: [['senna', 'Silence. Real silence, for the first time in a season. All that remains of the song now is its singer.']],
    beats: [
      { t: 'destroy', text: 'Shatter the resonance stones', n: 3, hp: 150, press: [['cultist', 7], ['zombie', 7.5], ['soldier', 10]] },
      { t: 'wave', text: 'Silence the choir\u2019s guard', spawns: [['cultist', 2], ['cultist', 1, true], ['zombie', 3]] }
    ]
  },
  {
    name: 'The Last Hymn', zone: 5, reward: 420, levelW: 1800,
    blurb: 'The Sanctum. The singer. The end of the song — one way or the other.',
    intro: [
      ['cantor', 'You bring swords to a lullaby. The god died mid-verse and left the world AWAKE — I only mean to finish the song and let Aldermere finally sleep.'],
      ['senna', 'The fragment, Cantor — I have read it. It does not end in sleep. You have been singing it wrong.'],
      ['cantor', 'Then come. Correct me.']
    ],
    outro: [
      ['senna', 'It is done. The last verse, sung true — not an ending. A waking.'],
      ['ashe', 'Look east. I had forgotten dawn could be that color. Come on, heroes. Aldermere will want to know your names.']
    ],
    beats: [
      { t: 'wave', text: 'Break through the inner choir', spawns: [['cultist', 3], ['zombie', 2]] },
      { t: 'boss', text: 'Silence the Cantor', type: 'cantor' }
    ]
  }
];

const ARENAS = [
  { name: 'Vigil Courtyard', zone: 3, obs: [{ x: 420, y: 470, w: 60, h: 40 }, { x: 800, y: 590, w: 60, h: 40 }] },
  { name: 'The Broken Bridge', zone: 2, obs: [{ x: 300, y: 392, w: 680, h: 70 }, { x: 300, y: 620, w: 680, h: 70 }] },
  { name: 'Sanctum Circle', zone: 5, obs: [{ x: 200, y: 500, w: 50, h: 50 }, { x: 1030, y: 500, w: 50, h: 50 }, { x: 615, y: 420, w: 50, h: 44 }] }
];

/* ---------------------------------------------------------------- input -- */
const Keys = {};
let mouseX = 0, mouseY = 0, mouseInWorld = { x: 0, y: 0 }, usedMouse = false;
const KMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', j: 'atk', z: 'atk', k: 'skill', x: 'skill', ' ': 'dodge', l: 'dodge', shift: 'dodge', e: 'use', escape: 'esc' };
addEventListener('keydown', e => {
  const k = KMAP[e.key.toLowerCase()];
  if (k) { if (!Keys[k]) Keys[k + 'P'] = true; Keys[k] = true; usedMouse = (k === 'atk' || k === 'skill') ? false : usedMouse; if (k !== 'esc') e.preventDefault(); }
  if ((e.key === 'Enter' || e.key.toLowerCase() === 'f') && G.screen === 'game') UI.advanceDlg();
});
addEventListener('keyup', e => { const k = KMAP[e.key.toLowerCase()]; if (k) Keys[k] = false; });
addEventListener('blur', () => { for (const k in Keys) Keys[k] = false; });

/* ------------------------------------------------------------------ net -- */
const Net = {
  ws: null, connected: false,
  open(cb) {
    if (this.ws && this.ws.readyState === 1) return cb && cb();
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    this.ws = new WebSocket(proto + location.host);
    this.ws.onopen = () => { this.connected = true; cb && cb(); };
    this.ws.onmessage = m => { let d; try { d = JSON.parse(m.data); } catch (e) { return; } onNet(d); };
    this.ws.onclose = () => {
      this.connected = false;
      if (G.room) { UI.toast('Connection to the server was lost.'); leaveToMenu(); }
    };
    this.ws.onerror = () => { UI.toast('Could not reach the server.'); };
  },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  ev(o) { o.t = 'ev'; this.send(o); }
};

/* ------------------------------------------------------------ game state -- */
const G = {
  screen: 'menu', room: null, myId: 0, hostId: 0, host: false, mode: null,
  players: new Map(), me: null, roster: [],
  enemies: new Map(), nextEid: 1,
  projs: [], fx: [], texts: [],
  camX: 0, shT: 0, shA: 0, hstop: 0,
  levelW: W, zone: 0, obstacles: [], props: [], seed: 1,
  mission: -1, dir: null, objText: '', objs: [], boss: null, beatIdx: 0,
  duel: null, runCoins: 0, runKills: 0, over: false, started: false,
  lastSt: 0, lastWorld: 0, time: 0, countdown: 0, banner: null
};

function partyCount() { return Math.max(1, G.roster.length); }
function aliveHeroes() { const a = []; G.players.forEach(h => { if (!h.dead && !h.downed) a.push(h); }); return a; }

/* ----------------------------------------------------------------- hero -- */
class Hero {
  constructor(id, name, cls, look, remote) {
    this.id = id; this.name = name; this.cls = cls; this.look = look || {};
    this.remote = !!remote;
    this.x = 300; this.y = 540; this.dir = 1;
    if (remote) { this.mhp = 100; this.hp = 100; this.stats = { def: 0 }; }
    else {
      this.stats = myStats();
      this.mhp = this.stats.mhp; this.hp = this.mhp;
      this.mana = this.stats.mana; this.mmana = this.stats.mana;
    }
    this.anim = 0; this.animT = 0; this.walkT = 0;
    this.downed = false; this.downT = 0; this.dead = false;
    this.blocking = false; this.blockAt = -9; this.parryBuffT = 0;
    this.invT = 0; this.atkCd = 0; this.atkStage = 0; this.comboT = 0;
    this.skillCd = 0; this.dodgeCd = 0; this.chargeT = -1; this.charging = false;
    this.kbx = 0; this.kby = 0; this.stunT = 0; this.hurtT = 0; this.flashT = 0; this.lastDmgT = -99;
    this.tx = this.x; this.ty = this.y; this.reviveT = 0; this.revTarget = null;
  }
  aim() { // unit aim vector for ranged
    if (usedMouse) {
      const dx = mouseInWorld.x - this.x, dy = mouseInWorld.y - (this.y - 30);
      const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l };
    }
    let ax = 0, ay = 0;
    if (Keys.left) ax -= 1; if (Keys.right) ax += 1;
    if (Keys.up) ay -= 1; if (Keys.down) ay += 1;
    if (!ax && !ay) ax = this.dir;
    const l = Math.hypot(ax, ay); return { x: ax / l, y: ay / l };
  }
  update(dt) {
    if (this.remote) { // smooth toward replicated position
      this.x = lerp(this.x, this.tx, Math.min(1, dt * 10));
      this.y = lerp(this.y, this.ty, Math.min(1, dt * 10));
      this.walkT += dt * 6; this.animT += dt;
      if (this.parryBuffT > 0) this.parryBuffT -= dt;
      return;
    }
    this.invT -= dt; this.atkCd -= dt; this.skillCd -= dt; this.dodgeCd -= dt;
    this.comboT -= dt; this.hurtT -= dt; this.flashT -= dt; this.parryBuffT -= dt; this.animT += dt;
    if (this.stunT > 0) { this.stunT -= dt; this.applyKb(dt); return; }
    if (this.dead) return;
    if (this.downed) {
      this.downT -= dt;
      if (this.downT <= 0) { this.dead = true; UI.toast('You have fallen. Your allies fight on...'); }
      return;
    }
    if (G.countdown > 0) return; // duel countdown freeze
    if (this.mana != null) this.mana = Math.min(this.mmana, this.mana + dt * 12 * (1 + 0.1 * P.up.arc));
    if (G.mode === 'story' && G.time - this.lastDmgT > 6 && this.hp < this.mhp) this.hp = Math.min(this.mhp, this.hp + dt * 3);

    // ---- movement
    let mx = 0, my = 0;
    if (Keys.left) mx -= 1; if (Keys.right) mx += 1;
    if (Keys.up) my -= 1; if (Keys.down) my += 1;
    const ml = Math.hypot(mx, my); if (ml) { mx /= ml; my /= ml; }
    let spd = this.stats.spd * 60;
    const rolling = this.anim === 3 && this.animT < 0.32;
    if (rolling) { mx = this.rollDx; my = this.rollDy; spd *= 2.35; }
    else if (this.blocking) spd *= 0.4;
    else if (this.charging) spd *= 0.55;
    if (this.anim === 2 && this.animT < 0.22) spd *= 0.25; // committed swings
    if (mx && !rolling) this.dir = mx > 0 ? 1 : -1;
    this.x += mx * spd * dt; this.y += my * spd * dt;
    this.applyKb(dt);
    this.x = clamp(this.x, 30, G.levelW - 30);
    this.y = clamp(this.y, FLOOR_TOP, FLOOR_BOT);
    collideObstacles(this);
    if ((mx || my) && !rolling) this.walkT += dt * 8; 
    if (this.anim <= 1) this.anim = (mx || my) ? 1 : 0;
    if (this.anim >= 2 && this.animT > (this.anim === 2 ? 0.34 : this.anim === 3 ? 0.36 : 0.3)) { this.anim = 0; }
    if ((mx || my) && P.trailOn && Math.random() < 0.3) FX.spark(this.x, this.y - 4, '#ff8c3f', 1);

    // ---- class actions
    if (this.cls === 'knight') this.knightActs(dt);
    else if (this.cls === 'mage') this.mageActs(dt);
    else this.rangerActs(dt);

    // ---- dodge
    if (Keys.dodgeP && this.dodgeCd <= 0 && !this.blocking) {
      Keys.dodgeP = false;
      if (this.cls === 'mage') { // blink
        const a = ml ? { x: mx, y: my } : { x: this.dir, y: 0 };
        FX.poof(this.x, this.y - 20, '#82b6ff');
        this.x = clamp(this.x + a.x * 165, 30, G.levelW - 30);
        this.y = clamp(this.y + a.y * 165, FLOOR_TOP, FLOOR_BOT);
        collideObstacles(this);
        FX.poof(this.x, this.y - 20, '#82b6ff');
        this.invT = 0.32; this.dodgeCd = 1.6 * this.stats.cdMul; AU.blink();
      } else {
        this.rollDx = ml ? mx : this.dir; this.rollDy = ml ? my : 0;
        this.anim = 3; this.animT = 0; this.invT = 0.36; this.dodgeCd = 0.95 * this.stats.cdMul; AU.roll();
      }
    }

    // ---- revive allies
    this.revTarget = null;
    if (G.mode === 'story') {
      G.players.forEach(h => {
        if (h !== this && h.downed && dist2(this.x, this.y, h.x, h.y) < 75 * 75) this.revTarget = h;
      });
      if (this.revTarget && Keys.use) {
        this.reviveT += dt;
        if (this.reviveT >= 2.2) { this.reviveT = 0; Net.ev({ k: 'rev', tg: this.revTarget.id }); FX.ring(this.revTarget.x, this.revTarget.y - 20, 60, '#9dc46a'); AU.revive(); }
      } else this.reviveT = 0;
    }
    Keys.atkP = false; Keys.skillP = false;
  }
  applyKb(dt) {
    this.x += this.kbx * dt; this.y += this.kby * dt;
    this.kbx *= Math.pow(0.0001, dt); this.kby *= Math.pow(0.0001, dt);
    this.x = clamp(this.x, 30, G.levelW - 30); this.y = clamp(this.y, FLOOR_TOP, FLOOR_BOT);
  }
  knightActs(dt) {
    const wasBlocking = this.blocking;
    this.blocking = !!Keys.skill && this.anim !== 3;
    if (this.blocking && !wasBlocking) { this.blockAt = G.time; AU.ui(); }
    if (Keys.atkP && !this.blocking && this.atkCd <= 0) {
      Keys.atkP = false;
      if (this.comboT <= 0) this.atkStage = 0; else this.atkStage = (this.atkStage + 1) % 3;
      this.comboT = 0.9; this.atkCd = this.atkStage === 2 ? 0.55 : 0.4;
      this.anim = 2; this.animT = 0; AU.swing();
      const heavy = this.atkStage === 2;
      const mult = (heavy ? 1.55 : 1) * (this.parryBuffT > 0 ? 1.5 : 1);
      if (this.parryBuffT > 0) this.parryBuffT = 0;
      const dmg = this.stats.dmg * mult * rnd(0.92, 1.08);
      const kb = heavy ? 340 : 170;
      FX.slash(this.x + this.dir * 42, this.y - 26, this.dir, heavy ? 1.35 : 1, '#ffe9c0');
      Net.ev({ k: 'atk', x: this.x, y: this.y, dir: this.dir, hv: heavy ? 1 : 0 });
      setTimeout(() => meleeHit(this, dmg, CLASSES.knight.range, kb), 90);
    }
  }
  mageActs(dt) {
    if (Keys.atk && this.atkCd <= 0 && this.mana >= 7) {
      this.atkCd = 0.3; this.mana -= 7; this.anim = 2; this.animT = 0;
      const a = this.aim(); this.dir = a.x >= 0 ? 1 : -1;
      const dmg = this.stats.dmg * rnd(0.92, 1.08);
      fireProj('bolt', this.x + this.dir * 18, this.y - 32, a.x * 560, a.y * 560, dmg, false, 130);
      AU.cast();
    }
    if (Keys.skillP && this.skillCd <= 0 && this.mana >= 30) {
      Keys.skillP = false; this.skillCd = 4.5 * this.stats.cdMul; this.mana -= 30;
      this.anim = 2; this.animT = 0;
      const dmg = this.stats.dmg * 2.1;
      FX.ring(this.x, this.y - 10, 135, '#ff8c3f'); FX.ring(this.x, this.y - 10, 90, '#ffd9b0');
      shake(6, 0.2); AU.nova();
      Net.ev({ k: 'novafx', x: this.x, y: this.y });
      novaHit(this, dmg, 135);
    }
  }
  rangerActs(dt) {
    if (Keys.atk && !this.charging && this.atkCd <= 0) { this.charging = true; this.chargeT = 0; }
    if (this.charging) {
      this.chargeT += dt; this.anim = 8;
      const a = this.aim(); this.dir = a.x >= 0 ? 1 : -1;
      if (!Keys.atk) { // release
        this.charging = false; this.anim = 2; this.animT = 0; this.atkCd = 0.32;
        const ch = clamp(this.chargeT / 0.85, 0.15, 1);
        const dmg = this.stats.dmg * lerp(0.65, 2.4, ch) * rnd(0.92, 1.08);
        fireProj('arrow', this.x + this.dir * 16, this.y - 30, a.x * (520 + 380 * ch), a.y * (520 + 380 * ch), dmg, ch >= 0.99, 90 + 140 * ch);
        AU.bow(ch); this.chargeT = -1;
      }
    }
    if (Keys.skillP && this.skillCd <= 0) {
      Keys.skillP = false; this.skillCd = 5 * this.stats.cdMul;
      this.anim = 2; this.animT = 0; AU.bow(0.5);
      const a = this.aim(); this.dir = a.x >= 0 ? 1 : -1;
      const base = Math.atan2(a.y, a.x);
      for (let i = -1; i <= 1; i++) {
        const an = base + i * 0.16;
        fireProj('arrow', this.x + this.dir * 16, this.y - 30, Math.cos(an) * 620, Math.sin(an) * 620, this.stats.dmg * 0.85, false, 90);
      }
    }
  }
}

function collideObstacles(e) {
  for (const o of G.obstacles) {
    if (e.x > o.x - 16 && e.x < o.x + o.w + 16 && e.y > o.y - 8 && e.y < o.y + o.h + 8) {
      const dl = e.x - (o.x - 16), drr = (o.x + o.w + 16) - e.x, dt2 = e.y - (o.y - 8), db = (o.y + o.h + 8) - e.y;
      const m = Math.min(dl, drr, dt2, db);
      if (m === dl) e.x = o.x - 16; else if (m === drr) e.x = o.x + o.w + 16;
      else if (m === dt2) e.y = o.y - 8; else e.y = o.y + o.h + 8;
    }
  }
}

/* melee from my hero: hits enemies (story) or remote heroes (duel) */
function meleeHit(h, dmg, range, kb) {
  if (h.dead || h.downed) return;
  let landed = false;
  if (G.mode === 'story') {
    G.enemies.forEach(en => {
      if (en.hp <= 0) return;
      const dx = en.x - h.x, dy = Math.abs(en.y - h.y);
      if (dy < 52 && dx * h.dir > -14 && Math.abs(dx) < range + ETYPES[en.ti].w * 0.5) {
        hurtEnemy(en, dmg, kb, h.dir); landed = true;
      }
    });
  } else {
    G.players.forEach(t => {
      if (t === h || t.dead) return;
      const dx = t.x - h.x, dy = Math.abs(t.y - h.y);
      if (dy < 52 && dx * h.dir > -14 && Math.abs(dx) < range + 16) {
        Net.ev({ k: 'hitP', tg: t.id, dmg: Math.round(dmg), kb, dir: h.dir }); landed = true;
      }
    });
  }
  if (landed) { hitstop(0.05); shake(3, 0.12); }
}
function novaHit(h, dmg, r) {
  if (G.mode === 'story') {
    G.enemies.forEach(en => {
      if (en.hp <= 0) return;
      if (dist2(en.x, en.y, h.x, h.y) < r * r) hurtEnemy(en, dmg, 380, en.x >= h.x ? 1 : -1);
    });
  } else {
    G.players.forEach(t => {
      if (t === h || t.dead) return;
      if (dist2(t.x, t.y, h.x, h.y) < r * r) Net.ev({ k: 'hitP', tg: t.id, dmg: Math.round(dmg), kb: 380, dir: t.x >= h.x ? 1 : -1 });
    });
  }
}
/* route damage to an enemy: apply if host, else ask host */
function hurtEnemy(en, dmg, kb, dir) {
  if (G.host) applyEnemyHit(en.id, dmg, kb, dir);
  else Net.ev({ k: 'hitE', eid: en.id, dmg: Math.round(dmg), kb, dir });
  // immediate local feedback either way
  en.flashT = 0.12; FX.spark(en.x, en.y - 24, '#fff', 5); AU.hit();
}

function fireProj(kind, x, y, vx, vy, dmg, pierce, kb) {
  G.projs.push({ kind, x, y, vx, vy, dmg, pierce, kb, owner: 'me', life: 1.6, hits: new Set() });
  Net.ev({ k: 'shot', kind, x: Math.round(x), y: Math.round(y), vx: Math.round(vx), vy: Math.round(vy), dmg: Math.round(dmg), pierce: pierce ? 1 : 0, kb });
}

/* ---------------------------------------------------------- projectiles -- */
function updateProjs(dt) {
  for (let i = G.projs.length - 1; i >= 0; i--) {
    const p = G.projs[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    let dead = p.life <= 0 || p.x < -40 || p.x > G.levelW + 40;
    if (!dead && p.kind !== 'orb') { // pillars stop bolts/arrows/knives
      for (const o of G.obstacles) if (p.x > o.x && p.x < o.x + o.w && p.y > o.y - 40 && p.y < o.y + o.h) { dead = true; FX.spark(p.x, p.y, '#aaa', 4); break; }
    }
    if (!dead && p.owner === 'me' && G.mode === 'story') {
      G.enemies.forEach(en => {
        if (dead && !p.pierce) return;
        if (en.hp <= 0 || p.hits.has(en.id)) return;
        const r = ETYPES[en.ti].w * 0.55 + 8;
        if (dist2(p.x, p.y, en.x, en.y - 24) < r * r) {
          p.hits.add(en.id);
          hurtEnemy(en, p.dmg, p.kb, p.vx >= 0 ? 1 : -1);
          FX.spark(p.x, p.y, p.kind === 'bolt' ? '#ffb14f' : '#fff', 6);
          if (!p.pierce) dead = true;
        }
      });
    }
    if (!dead && G.me && !G.me.dead && !G.me.downed && (p.owner === 'enemy' || (p.owner === 'remote' && G.mode === 'duel'))) {
      if (dist2(p.x, p.y, G.me.x, G.me.y - 24) < 24 * 24) {
        damageMe(p.dmg, p.vx >= 0 ? 1 : -1, p.owner === 'enemy' ? 'enemy' : 'player', p.srcId, p.kb || 120);
        dead = true;
      }
    }
    if (dead) { if (p.kind === 'bolt' || p.kind === 'orb') FX.poof(p.x, p.y, p.kind === 'bolt' ? '#ff8c3f' : '#c080ff'); G.projs.splice(i, 1); }
  }
}

/* --------------------------------------------------------- taking damage -- */
function damageMe(dmg, dir, srcKind, srcId, kb) {
  const me = G.me;
  if (!me || me.dead || me.downed || me.invT > 0) return;
  // blocking / parry (knight)
  if (me.blocking && dir !== me.dir) { // attack comes from the side I face
    if (G.time - me.blockAt < 0.18) { // PARRY
      AU.parry(); FX.ring(me.x + me.dir * 30, me.y - 30, 40, '#ffe9c0'); hitstop(0.09); shake(4, 0.15);
      FX.text(me.x, me.y - 70, 'PARRY!', '#ffe9c0');
      me.parryBuffT = 2.2;
      if (srcKind === 'enemy' && srcId != null) { if (G.host) staggerEnemy(srcId); else Net.ev({ k: 'parryE', eid: srcId }); }
      if (srcKind === 'player' && srcId != null) Net.ev({ k: 'parried', tg: srcId });
      return;
    }
    dmg *= 0.15; AU.block(); FX.spark(me.x + me.dir * 26, me.y - 30, '#cfd6ff', 4);
    me.kbx += dir * (kb || 120) * 0.4;
  } else {
    AU.hurt(); me.hurtT = 0.25; me.flashT = 0.12; me.anim = 4; me.animT = 0;
    me.kbx += dir * (kb || 150); shake(5, 0.18); hitstop(0.04);
  }
  dmg *= (1 - (me.stats.def || 0));
  dmg = Math.max(1, Math.round(dmg));
  me.hp -= dmg; me.lastDmgT = G.time;
  FX.text(me.x, me.y - 70, '-' + dmg, '#ff7a6a');
  if (me.hp <= 0) {
    me.hp = 0;
    if (G.mode === 'duel') { me.dead = true; AU.die(); FX.poof(me.x, me.y - 20, '#fff'); Net.ev({ k: 'die' }); if (G.host) duelDeath(G.myId); }
    else {
      me.downed = true; me.downT = 25; AU.die();
      FX.text(me.x, me.y - 80, 'DOWNED', '#ff7a6a');
      if (partyCount() === 1 && G.host) emit({ k: 'fail' });
    }
  }
  pushSt(true);
}

/* -------------------------------------------------------------- enemies -- */
function spawnEnemy(tid, x, y, elite) {
  const id = 'e' + (G.nextEid++) + '_' + G.myId;
  const ti = ET[tid], t = ETYPES[ti];
  const pc = partyCount();
  const hpMul = t.boss ? [1, 1.7, 2.4][pc - 1] : [1, 1.5, 2][pc - 1];
  const en = {
    id, ti, x, y, tx: x, ty: y, dir: -1, elite: !!elite,
    mhp: Math.round(t.hp * hpMul * (elite ? 2.2 : 1)), hp: 0,
    state: 0, t: 0, atkCd: rnd(0.2, 1), stagT: 0, flashT: 0, dieT: 0,
    tgt: null, special: 0, phase: 1, summoned: false, teleCd: 3
  };
  en.hp = en.mhp;
  G.enemies.set(id, en);
  if (t.boss) { G.boss = { name: t.n, hp: en.hp, mhp: en.mhp }; AU.bossRoar(); emit({ k: 'boss', name: t.n }); }
  return en;
}
function applyEnemyHit(eid, dmg, kb, dir) { // HOST only
  const en = G.enemies.get(eid); if (!en || en.hp <= 0) return;
  const t = ETYPES[en.ti];
  if (t.shield && en.stagT <= 0 && dir !== en.dir) { dmg *= 0.3; FX.spark(en.x - en.dir * 20, en.y - 28, '#cfd6ff', 4); }
  dmg = Math.max(1, Math.round(dmg));
  en.hp -= dmg; en.flashT = 0.12;
  if (!t.boss && !t.stone) { en.kb = (en.kb || 0) + kb * dir * 0.8; }
  FX.text(en.x, en.y - 60, '-' + dmg, '#ffd9b0');
  if (en.hp <= 0) {
    en.hp = 0; en.state = 5; en.dieT = 0.5;
    if (t.boss) G.boss = null;
    const coin = t.coin + (en.elite ? 10 : 0);
    emit({ k: 'ekill', eid, coin, x: Math.round(en.x), y: Math.round(en.y) });
  }
}
function staggerEnemy(eid) {
  const en = G.enemies.get(eid); if (!en || en.hp <= 0) return;
  en.state = 4; en.t = 1.1; en.flashT = 0.2;
}
function enemyTargets() {
  const list = [];
  G.players.forEach(h => { if (!h.dead && !h.downed) list.push(h); });
  return list;
}
function nearestTarget(en) {
  let best = null, bd = 1e12;
  for (const h of enemyTargets()) {
    const d = dist2(en.x, en.y, h.x, h.y); if (d < bd) { bd = d; best = h; }
  }
  if (!best && G.dir && G.dir.wagon && G.dir.wagon.hp > 0) return G.dir.wagon;
  return best;
}
function updateEnemiesHost(dt) {
  G.enemies.forEach(en => {
    const t = ETYPES[en.ti];
    en.flashT -= dt;
    if (en.hp <= 0) { en.dieT -= dt; if (en.dieT <= 0) G.enemies.delete(en.id); return; }
    if (t.stone) return;
    if (en.kb) { en.x += en.kb * dt; en.kb *= Math.pow(0.0001, dt); if (Math.abs(en.kb) < 4) en.kb = 0; }
    en.x = clamp(en.x, 20, G.levelW - 20); en.y = clamp(en.y, FLOOR_TOP, FLOOR_BOT);
    if (en.stagT > 0) { en.stagT -= dt; return; }
    if (en.state === 4) { en.t -= dt; if (en.t <= 0) en.state = 0; return; }
    en.atkCd -= dt;

    if (t.boss) { updateBoss(en, t, dt); return; }

    // pick / keep target
    if (!en.tgt || Math.random() < 0.01) {
      const wagon = G.dir && G.dir.wagon && G.dir.wagon.hp > 0 ? G.dir.wagon : null;
      en.tgt = (wagon && Math.random() < 0.5) ? 'wagon' : (nearestTarget(en) ? nearestTarget(en).id : null);
    }
    let T = null;
    if (en.tgt === 'wagon' && G.dir && G.dir.wagon && G.dir.wagon.hp > 0) T = G.dir.wagon;
    else { T = G.players.get(en.tgt); if (!T || T.dead || T.downed) { T = nearestTarget(en); en.tgt = T && T.id ? T.id : (T ? 'wagon' : null); } }
    if (!T) { en.state = 0; return; }

    const dx = T.x - en.x, dy = T.y - en.y, d = Math.hypot(dx, dy);
    if (en.state === 0) { // seek
      en.dir = dx >= 0 ? 1 : -1;
      if (t.caster) {
        if (d < 200) { en.x -= (dx / d) * t.spd * 55 * dt; en.y -= (dy / d) * t.spd * 55 * dt; }
        else if (d > 430) { en.x += (dx / d) * t.spd * 60 * dt; en.y += (dy / d) * t.spd * 60 * dt; }
        if (d < 460 && en.atkCd <= 0) { en.state = 1; en.t = t.windup; }
      } else if (t.throws && d > 130 && d < 420 && en.atkCd <= 0 && Math.random() < 0.008) {
        en.state = 1; en.t = t.windup; en.thrown = true;
      } else {
        const sp = t.spd * 60 * (en.elite ? 1.15 : 1);
        if (d > t.range * 0.8 || Math.abs(dy) > 34) {
          en.x += (dx / (d || 1)) * sp * dt;
          en.y += (dy / (d || 1)) * sp * dt * 1.2;
        }
        if (d < t.range && Math.abs(dy) < 46 && en.atkCd <= 0) { en.state = 1; en.t = t.windup; en.thrown = false; }
      }
      en.x = clamp(en.x, 20, G.levelW - 20); en.y = clamp(en.y, FLOOR_TOP, FLOOR_BOT);
    } else if (en.state === 1) { // windup (telegraph)
      en.t -= dt; en.dir = dx >= 0 ? 1 : -1;
      if (en.t <= 0) {
        en.state = 2; en.t = 0.22;
        if (t.caster || en.thrown) {
          const sp2 = t.caster ? 300 : 420;
          const ax = dx / (d || 1), ay = dy / (d || 1);
          emit({ k: 'eshot', kind: t.caster ? 'orb' : 'knife', x: Math.round(en.x + en.dir * 14), y: Math.round(en.y - 30), vx: Math.round(ax * sp2), vy: Math.round(ay * sp2), dmg: t.dmg + (en.elite ? 5 : 0) });
        } else {
          if (t.lunge) { en.kb = en.dir * 320; }
          enemyStrike(en, t);
        }
        en.atkCd = t.rec + rnd(0.3, 0.9);
      }
    } else if (en.state === 2) { en.t -= dt; if (en.t <= 0) en.state = 3; }
    else if (en.state === 3) { en.t = (en.t || t.rec) - dt; if (en.t <= 0) { en.state = 0; en.t = 0; } }
  });
}
function enemyStrike(en, t, rangeMul, dmgMul) {
  const rg = t.range * (rangeMul || 1) + 14;
  const dmg = Math.round(t.dmg * (dmgMul || 1) * (en.elite ? 1.5 : 1));
  G.players.forEach(h => {
    if (h.dead || h.downed) return;
    const dx = h.x - en.x, dy = Math.abs(h.y - en.y);
    if (dy < 56 && dx * en.dir > -20 && Math.abs(dx) < rg) emit({ k: 'ehit', tg: h.id, dmg, dir: en.dir, kb: t.lunge ? 260 : 150 });
  });
  FX.slash(en.x + en.dir * 30, en.y - 24, en.dir, 0.9, '#ff9a8a');
}
function updateBoss(en, t, dt) {
  const T = nearestTarget(en); if (!T) return;
  const dx = T.x - en.x, dy = T.y - en.y, d = Math.hypot(dx, dy);
  en.teleCd -= dt;
  if (t.id === 'maro') {
    if (en.hp < en.mhp * 0.5 && !en.summoned) {
      en.summoned = true;
      spawnEnemy('soldier', en.x - 120, clamp(en.y - 60, FLOOR_TOP, FLOOR_BOT), false);
      spawnEnemy('soldier', en.x + 120, clamp(en.y + 60, FLOOR_TOP, FLOOR_BOT), true);
      emit({ k: 'dlg', lines: [['maro', 'Fort Merrow! To your captain!']] });
    }
    if (en.state === 0) {
      en.dir = dx >= 0 ? 1 : -1;
      const sp = t.spd * 60;
      if (d > t.range * 0.7 || Math.abs(dy) > 30) { en.x += (dx / (d || 1)) * sp * dt; en.y += (dy / (d || 1)) * sp * dt * 1.25; }
      if (en.atkCd <= 0) {
        en.special = (en.special + 1) % 4;
        if (en.special === 3 && d > 120) { // dash
          en.state = 6; en.t = 0.75; en.dashDir = dx >= 0 ? 1 : -1; en.dashY = T.y;
        } else if (d < t.range && Math.abs(dy) < 50) { en.state = 1; en.t = t.windup; en.hits = 0; }
      }
    } else if (en.state === 1) { en.t -= dt; en.dir = dx >= 0 ? 1 : -1; if (en.t <= 0) { en.state = 2; en.t = 0.18; en.hits = (en.hits || 0); } }
    else if (en.state === 2) {
      en.t -= dt;
      if (en.t <= 0) {
        enemyStrike(en, t, 1, en.hits === 2 ? 1.4 : 1); en.hits++;
        if (en.hits < 3) { en.state = 1; en.t = 0.3; } else { en.state = 3; en.t = t.rec; en.atkCd = 1.4; }
      }
    } else if (en.state === 3) { en.t -= dt; if (en.t <= 0) en.state = 0; }
    else if (en.state === 6) { // dash telegraph then charge
      en.t -= dt; en.dir = en.dashDir;
      if (en.t <= 0) { en.state = 7; en.t = 0.55; AU.bossRoar(); }
    } else if (en.state === 7) {
      en.t -= dt;
      en.x += en.dashDir * 620 * dt; en.y = lerp(en.y, en.dashY, dt * 4);
      en.x = clamp(en.x, 20, G.levelW - 20);
      G.players.forEach(h => {
        if (h.dead || h.downed) return;
        if (Math.abs(h.y - en.y) < 50 && Math.abs(h.x - en.x) < 54) {
          if (!en.dashHits) en.dashHits = new Set();
          if (!en.dashHits.has(h.id)) { en.dashHits.add(h.id); emit({ k: 'ehit', tg: h.id, dmg: 26, dir: en.dashDir, kb: 340 }); }
        }
      });
      if (en.t <= 0) { en.state = 3; en.t = 0.8; en.atkCd = 1.8; en.dashHits = null; }
    }
  } else { // cantor
    if (en.hp < en.mhp * 0.55 && en.phase === 1) { en.phase = 2; emit({ k: 'dlg', lines: [['cantor', 'You are RUINING the crescendo.']] }); AU.bossRoar(); }
    if (en.state === 0) {
      en.dir = dx >= 0 ? 1 : -1;
      if (en.teleCd <= 0 && (d < 110 || Math.random() < 0.004)) {
        en.teleCd = 4;
        emit({ k: 'poofAt', x: Math.round(en.x), y: Math.round(en.y) });
        en.x = clamp(T.x + (Math.random() < 0.5 ? -1 : 1) * rnd(220, 320), 40, G.levelW - 40);
        en.y = clamp(T.y + rnd(-100, 100), FLOOR_TOP, FLOOR_BOT);
        emit({ k: 'poofAt', x: Math.round(en.x), y: Math.round(en.y) });
      }
      const sp = t.spd * 60;
      if (d > 260) { en.x += (dx / (d || 1)) * sp * dt; en.y += (dy / (d || 1)) * sp * dt; }
      if (en.atkCd <= 0) {
        en.special = (en.special + 1) % (en.phase === 2 ? 3 : 2);
        en.state = 1; en.t = t.windup + 0.15;
      }
    } else if (en.state === 1) {
      en.t -= dt;
      if (en.t <= 0) {
        if (en.special === 0) { // fan of orbs
          const base = Math.atan2(dy, dx), n = en.phase === 2 ? 7 : 5;
          for (let i = 0; i < n; i++) {
            const an = base + (i - (n - 1) / 2) * 0.22;
            emit({ k: 'eshot', kind: 'orb', x: Math.round(en.x), y: Math.round(en.y - 34), vx: Math.round(Math.cos(an) * 260), vy: Math.round(Math.sin(an) * 260), dmg: 14 });
          }
          en.atkCd = 2.2;
        } else if (en.special === 1) { // summon (capped)
          let cult = 0; G.enemies.forEach(e2 => { if (ETYPES[e2.ti].id === 'cultist' && e2.hp > 0) cult++; });
          if (cult < 3) {
            spawnEnemy('cultist', clamp(en.x - 160, 40, G.levelW - 40), clamp(en.y - 60, FLOOR_TOP, FLOOR_BOT), false);
            if (partyCount() > 1) spawnEnemy('zombie', clamp(en.x + 160, 40, G.levelW - 40), clamp(en.y + 60, FLOOR_TOP, FLOOR_BOT), false);
          }
          en.atkCd = 3;
        } else { // phase 2: choir bells — telegraphed blasts on each player
          G.players.forEach(h => {
            if (h.dead || h.downed) return;
            emit({ k: 'zone', x: Math.round(h.x), y: Math.round(h.y), r: 95, d: 1.0, dmg: 24 });
          });
          en.atkCd = 3.4;
        }
        en.state = 3; en.t = t.rec;
      }
    } else if (en.state === 3) { en.t -= dt; if (en.t <= 0) en.state = 0; }
  }
}

/* ------------------------------------------------------- mission director -- */
function startMissionLocal(mi) {
  const M = MISSIONS[mi];
  G.mission = mi; G.zone = M.zone; G.levelW = M.levelW; G.beatIdx = -1;
  G.enemies.clear(); G.projs = []; G.fx = []; G.texts = []; G.objs = []; G.boss = null;
  G.runCoins = 0; G.runKills = 0; G.over = false; G.objText = ''; G.banner = null;
  G.obstacles = [];
  srand(G.seed); G.props = genProps(M.zone, M.levelW);
  // place heroes
  let i = 0;
  G.players.forEach(h => { h.x = 200 + i * 60; h.y = 500 + i * 55; h.hp = h.mhp; h.dead = false; h.downed = false; h.dir = 1; i++; });
  if (G.me) { G.me.hp = G.me.mhp; if (G.me.mana != null) G.me.mana = G.me.mmana; }
  G.camX = 0;
  AU.ambient(M.zone);
  UI.queueDlg(M.intro);
  if (G.host) {
    G.dir = { i: -1, waveIds: null, spawnQ: [], pressT: {}, wagon: null, beaconsDone: 0, doneT: 0, waitDlg: 0 };
    nextBeat();
  }
}
function nextBeat() {
  const M = MISSIONS[G.mission]; const D = G.dir;
  D.i++;
  G.beatIdx = D.i;
  if (D.i >= M.beats.length) { finishMission(true); return; }
  const b = M.beats[D.i];
  D.waveIds = null; D.spawnQ = []; D.pressT = {}; D.wagon = null; D.beaconsDone = 0;
  if (b.t === 'dlg') { emit({ k: 'dlg', lines: b.lines }); D.waitDlg = 1.2 + b.lines.length * 2.4; return; }
  setObj(b.text);
  if (b.t === 'wave') {
    D.waveIds = new Set();
    let delay = 0.4;
    for (const [tid, n, elite] of b.spawns) for (let j = 0; j < n; j++) { D.spawnQ.push({ tid, elite: !!elite, t: delay }); delay += 0.55; }
  } else if (b.t === 'escort') {
    D.wagon = { x: 260, y: 545, hp: b.hp, mhp: b.hp };
    for (const [tid, iv] of (b.press || [])) D.pressT[tid] = iv * 0.5;
  } else if (b.t === 'beacons') {
    D.beacons = [];
    for (let j = 0; j < b.n; j++) D.beacons.push({ x: G.levelW * (0.28 + j * 0.27), y: 470 + (j % 2) * 130, prog: 0, lit: false });
    for (const [tid, iv] of (b.press || [])) D.pressT[tid] = iv * 0.5;
  } else if (b.t === 'destroy') {
    D.stoneIds = [];
    for (let j = 0; j < b.n; j++) {
      const en = spawnEnemy('stone', G.levelW * (0.3 + j * 0.25), 480 + (j % 2) * 120, false);
      en.mhp = en.hp = b.hp * [1, 1.4, 1.8][partyCount() - 1];
      D.stoneIds.push(en.id);
    }
    for (const [tid, iv] of (b.press || [])) D.pressT[tid] = iv * 0.5;
  } else if (b.t === 'boss') {
    const c = partyCentroid();
    spawnEnemy(b.type, clamp(c.x + 480, 200, G.levelW - 120), 540, false);
  }
}
function partyCentroid() {
  let x = 0, y = 0, n = 0;
  G.players.forEach(h => { if (!h.dead) { x += h.x; y += h.y; n++; } });
  return n ? { x: x / n, y: y / n } : { x: G.levelW / 2, y: 540 };
}
function spawnNearParty(tid, elite) {
  const c = partyCentroid();
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = clamp(c.x + side * rnd(560, 760), 40, G.levelW - 40);
  return spawnEnemy(tid, x, rnd(FLOOR_TOP + 20, FLOOR_BOT - 20), elite);
}
function updateDirector(dt) {
  const D = G.dir; if (!D || G.over) return;
  const M = MISSIONS[G.mission];
  if (D.waitDlg > 0) { D.waitDlg -= dt; if (D.waitDlg <= 0) nextBeat(); return; }
  if (D.i < 0 || D.i >= M.beats.length) return;
  const b = M.beats[D.i];
  // staggered spawns
  for (const s of D.spawnQ) { s.t -= dt; if (s.t <= 0 && !s.done) { s.done = true; const en = spawnNearParty(s.tid, s.elite); if (D.waveIds) D.waveIds.add(en.id); } }
  // pressure spawns
  for (const tid in D.pressT) {
    D.pressT[tid] -= dt;
    if (D.pressT[tid] <= 0) {
      const iv = (b.press.find(p => p[0] === tid) || [0, 8])[1];
      D.pressT[tid] = iv * rnd(0.85, 1.2) / (0.7 + 0.3 * partyCount());
      spawnNearParty(tid, Math.random() < 0.08);
    }
  }
  let done = false;
  if (b.t === 'wave') {
    const allSpawned = D.spawnQ.every(s => s.done);
    let alive = 0; if (D.waveIds) D.waveIds.forEach(id => { const e = G.enemies.get(id); if (e && e.hp > 0) alive++; });
    done = allSpawned && alive === 0;
  } else if (b.t === 'escort') {
    const w = D.wagon;
    let near = false, danger = false;
    G.players.forEach(h => { if (!h.dead && !h.downed && dist2(h.x, h.y, w.x, w.y) < 190 * 190) near = true; });
    G.enemies.forEach(e => { if (e.hp > 0 && !ETYPES[e.ti].stone && dist2(e.x, e.y, w.x, w.y) < 130 * 130) danger = true; });
    if (near && !danger) w.x += 62 * dt;
    if (w.hp <= 0) { finishMission(false, 'The reliquary cart was destroyed.'); return; }
    if (w.x > G.levelW - 220) done = true;
  } else if (b.t === 'beacons') {
    let lit = 0;
    for (const bc of D.beacons) {
      if (bc.lit) { lit++; continue; }
      let near = false;
      G.players.forEach(h => { if (!h.dead && !h.downed && dist2(h.x, h.y, bc.x, bc.y) < 80 * 80) near = true; });
      if (near) { bc.prog += dt / 3; if (bc.prog >= 1) { bc.lit = true; emit({ k: 'beacon', x: Math.round(bc.x), y: Math.round(bc.y) }); } }
      else bc.prog = Math.max(0, bc.prog - dt / 6);
    }
    done = lit === D.beacons.length;
  } else if (b.t === 'destroy') {
    done = D.stoneIds.every(id => { const e = G.enemies.get(id); return !e || e.hp <= 0; });
  } else if (b.t === 'boss') {
    let bossAlive = false;
    G.enemies.forEach(e => { if (ETYPES[e.ti].boss && e.hp > 0) bossAlive = true; });
    done = !bossAlive && G.time - (D.bossGrace || 0) > 2 && D.bossSeen;
    G.enemies.forEach(e => { if (ETYPES[e.ti].boss) D.bossSeen = true; });
  }
  if (done) { D.doneT += dt; if (D.doneT > 1.2) { D.doneT = 0; nextBeat(); } } else D.doneT = 0;

  // total party wipe?
  let anyUp = false;
  G.players.forEach(h => { if (!h.dead && !h.downed) anyUp = true; });
  if (!anyUp && !G.over) { emit({ k: 'fail' }); }
}
function setObj(txt) { G.objText = txt || ''; }
function finishMission(win, why) {
  if (G.over) return;
  if (win) emit({ k: 'clear', reward: MISSIONS[G.mission].reward });
  else emit({ k: 'fail', why });
}

/* --------------------------------------------------------------- duel dir -- */
function startDuelLocal(arenaIdx) {
  const A = ARENAS[arenaIdx];
  G.mission = -1; G.zone = A.zone; G.levelW = W; G.obstacles = A.obs.map(o => Object.assign({}, o));
  G.enemies.clear(); G.projs = []; G.fx = []; G.texts = []; G.objs = []; G.boss = null;
  G.runCoins = 0; G.over = false; G.objText = A.name;
  srand(G.seed); G.props = genProps(A.zone, W);
  AU.ambient(A.zone);
  G.duel = { arena: arenaIdx, score: {}, round: 1, over: false };
  G.roster.forEach(r => G.duel.score[r.id] = 0);
  resetDuelRound();
}
function resetDuelRound() {
  let i = 0;
  const order = [...G.roster].sort((a, b) => a.id - b.id);
  order.forEach(r => {
    const h = G.players.get(r.id); if (!h) return;
    h.x = i === 0 ? 300 : W - 300; h.y = 540; h.dir = i === 0 ? 1 : -1;
    h.hp = h.mhp; h.dead = false; h.downed = false; h.kbx = h.kby = 0; h.anim = 0;
    if (h.mana != null) h.mana = h.mmana;
    i++;
  });
  G.projs = [];
  G.countdown = 3.2; AU.gong();
}
function duelDeath(deadId) { // HOST adjudicates
  if (!G.duel || G.duel.over || G.duel.resolving) return;
  G.duel.resolving = true;
  let winner = null;
  G.roster.forEach(r => { if (r.id !== deadId) winner = r.id; });
  if (winner == null) { G.duel.resolving = false; return; }
  G.duel.score[winner] = (G.duel.score[winner] || 0) + 1;
  const done = G.duel.score[winner] >= 2;
  emit({ k: 'round', w: winner, sc: G.duel.score, done });
  if (!done) setTimeout(() => { if (G.screen === 'game') { emit({ k: 'rs', n: ++G.duel.round }); } G.duel.resolving = false; }, 2400);
}

/* ---------------------------------------------------- event dispatch/net -- */
function emit(o) { Net.ev(Object.assign({}, o)); dispatch(Object.assign({ id: G.myId }, o)); }

function dispatch(m) {
  const sender = G.players.get(m.id);
  switch (m.k) {
    case 'atk':
      if (sender && sender.remote) { sender.anim = 2; sender.animT = 0; sender.dir = m.dir; FX.slash(m.x + m.dir * 42, m.y - 26, m.dir, m.hv ? 1.35 : 1, '#ffe9c0'); AU.swing(); }
      break;
    case 'shot':
      if (m.id !== G.myId) G.projs.push({ kind: m.kind, x: m.x, y: m.y, vx: m.vx, vy: m.vy, dmg: m.dmg, pierce: !!m.pierce, kb: m.kb, owner: 'remote', srcId: m.id, life: 1.6, hits: new Set() });
      break;
    case 'novafx':
      if (m.id !== G.myId) { FX.ring(m.x, m.y - 10, 135, '#ff8c3f'); AU.nova(); shake(4, 0.15); }
      break;
    case 'eshot':
      G.projs.push({ kind: m.kind, x: m.x, y: m.y, vx: m.vx, vy: m.vy, dmg: m.dmg, owner: 'enemy', life: 2.6, kb: 140, hits: new Set() });
      break;
    case 'hitE': if (G.host) applyEnemyHit(m.eid, m.dmg, m.kb, m.dir); break;
    case 'parryE': if (G.host) staggerEnemy(m.eid); break;
    case 'hitP': if (m.tg === G.myId) damageMe(m.dmg, m.dir, 'player', m.id, m.kb); break;
    case 'parried':
      if (m.tg === G.myId && G.me) { G.me.stunT = 1.0; G.me.anim = 4; G.me.animT = 0; FX.text(G.me.x, G.me.y - 70, 'PARRIED', '#cfd6ff'); AU.parry(); }
      break;
    case 'ehit': if (m.tg === G.myId) damageMe(m.dmg, m.dir, 'enemy', null, m.kb); break;
    case 'zone': FX.zone(m.x, m.y, m.r, m.d, m.dmg); break;
    case 'ekill': {
      const en = G.enemies.get(m.eid);
      if (en) { en.hp = 0; en.state = 5; en.dieT = 0.5; if (ETYPES[en.ti].boss) G.boss = null; }
      G.runKills++; G.runCoins += m.coin; addCoins(m.coin);
      FX.text(m.x, m.y - 50, '+' + m.coin + ' ◈', '#ffb14f'); FX.poof(m.x, m.y - 20, '#c0392b'); AU.die();
      break;
    }
    case 'beacon': FX.ring(m.x, m.y - 20, 90, '#9dc46a'); AU.revive(); break;
    case 'poofAt': FX.poof(m.x, m.y - 20, '#c080ff'); AU.blink(); break;
    case 'boss': G.banner = { txt: m.name, t: 3 }; break;
    case 'dlg': UI.queueDlg(m.lines); break;
    case 'rev':
      if (m.tg === G.myId && G.me && G.me.downed && !G.me.dead) {
        G.me.downed = false; G.me.hp = Math.round(G.me.mhp * 0.4); G.me.invT = 1.2; AU.revive();
        FX.ring(G.me.x, G.me.y - 20, 60, '#9dc46a'); pushSt(true);
      }
      break;
    case 'die': if (sender) { sender.dead = true; FX.poof(sender.x, sender.y - 20, '#fff'); } if (G.host && G.mode === 'duel') duelDeath(m.id); break;
    case 'round': {
      const wr = G.roster.find(r => r.id === m.w);
      G.duel.score = m.sc;
      G.banner = { txt: (wr ? wr.name : '???') + ' takes the round', t: 2.2 };
      AU.gong();
      if (m.done) {
        G.duel.over = true;
        const iWon = m.w === G.myId;
        const prize = iWon ? 110 : 35;
        addCoins(prize); G.runCoins += prize;
        setTimeout(() => showResults(iWon ? 'Victory' : 'Defeat',
          iWon ? 'The crowd of embers roars your name.' : 'Even the Vigil loses duels. Sharpen up and call a rematch.',
          [['Rounds won', m.sc[G.myId] || 0], ['Coin earned', prize]]), 1800);
        if (G.host) Net.send({ t: 'end' });
      }
      break;
    }
    case 'rs': G.duel.round = m.n; resetDuelRound(); break;
    case 'clear': {
      if (G.over) break; G.over = true;
      addCoins(m.reward); G.runCoins += m.reward;
      if (G.mission >= P.prog) { P.prog = Math.min(MISSIONS.length - 1, G.mission + 1); saveProfile(); }
      const M = MISSIONS[G.mission];
      UI.queueDlg(M.outro);
      setTimeout(() => showResults('Mission Complete', M.name + ' — ' + ZONES[M.zone].n,
        [['Foes slain', G.runKills], ['Mission reward', m.reward + ' ◈'], ['Total coin earned', G.runCoins + ' ◈']]), 2600);
      if (G.host) Net.send({ t: 'end' });
      break;
    }
    case 'fail': {
      if (G.over) break; G.over = true;
      setTimeout(() => showResults('The Vigil Falls', m.why || 'The hymn swells over the field. Regroup, re-arm at the shop, and try again.',
        [['Foes slain', G.runKills], ['Coin salvaged', G.runCoins + ' ◈']]), 1200);
      if (G.host) Net.send({ t: 'end' });
      break;
    }
  }
}

/* net state sync */
function pushSt(force) {
  if (!G.me || !G.started) return;
  if (!force && G.time - G.lastSt < 0.066) return;
  G.lastSt = G.time;
  const m = G.me;
  Net.send({ t: 'st', x: Math.round(m.x), y: Math.round(m.y), dir: m.dir, hp: Math.round(m.hp), mhp: m.mhp, anim: m.anim, dn: m.downed ? 1 : 0, dd: m.dead ? 1 : 0, bl: m.blocking ? 1 : 0, ch: m.charging ? 1 : 0 });
}
function pushWorld() {
  if (!G.host || !G.started || G.mode !== 'story') return;
  if (G.time - G.lastWorld < 0.1) return;
  G.lastWorld = G.time;
  const e = [];
  G.enemies.forEach(en => e.push([en.id, en.ti, Math.round(en.x), Math.round(en.y), Math.round(en.hp), en.mhp, en.state, en.dir, en.elite ? 1 : 0]));
  const objs = [];
  const D = G.dir;
  if (D) {
    if (D.wagon) objs.push(['w', Math.round(D.wagon.x), Math.round(D.wagon.y), Math.round(D.wagon.hp), D.wagon.mhp]);
    if (D.beacons) for (const b of D.beacons) objs.push(['b', Math.round(b.x), Math.round(b.y), Math.round(b.prog * 100), b.lit ? 1 : 0]);
  }
  Net.send({ t: 'world', e, o: objs, ot: G.objText, boss: G.boss ? [G.boss.name, Math.round(G.boss.hp), G.boss.mhp] : 0, bt: G.beatIdx });
  if (G.boss) { // keep boss bar fresh from live enemy
    G.enemies.forEach(en => { if (ETYPES[en.ti].boss && en.hp > 0) G.boss.hp = en.hp; });
  }
}
function applyWorld(m) {
  if (G.host) return;
  const seen = new Set();
  for (const r of m.e) {
    const [id, ti, x, y, hp, mhp, state, dir, elite] = r;
    seen.add(id);
    let en = G.enemies.get(id);
    if (!en) { en = { id, ti, x, y, tx: x, ty: y, hp, mhp, state, dir, elite: !!elite, flashT: 0, dieT: 0.5 }; G.enemies.set(id, en); }
    en.tx = x; en.ty = y; en.hp = hp; en.mhp = mhp; en.state = state; en.dir = dir;
  }
  G.enemies.forEach(en => { if (!seen.has(en.id) && en.hp > 0) G.enemies.delete(en.id); });
  G.objs = m.o || [];
  G.objText = m.ot || '';
  G.boss = m.boss ? { name: m.boss[0], hp: m.boss[1], mhp: m.boss[2] } : null;
  G.beatIdx = m.bt;
}
function updateShadowEnemies(dt) {
  G.enemies.forEach(en => {
    en.flashT -= dt;
    if (en.hp <= 0) { en.dieT -= dt; if (en.dieT <= 0) G.enemies.delete(en.id); return; }
    en.x = lerp(en.x, en.tx, Math.min(1, dt * 10));
    en.y = lerp(en.y, en.ty, Math.min(1, dt * 10));
  });
}
function adoptHost() {
  if (G.mode !== 'story' || !G.started || G.over) { G.host = true; return; }
  G.host = true;
  UI.toast('The host left — you now carry the banner.');
  // convert shadows to simulated enemies
  G.enemies.forEach(en => {
    en.state = en.hp > 0 ? 0 : 5; en.t = 0; en.atkCd = rnd(0.5, 1.5); en.stagT = 0; en.tgt = null;
    en.special = 0; en.phase = en.hp < en.mhp * 0.55 ? 2 : 1; en.summoned = true; en.teleCd = 3;
  });
  // resume director at replicated beat, in "finish current enemies" style
  const M = MISSIONS[G.mission];
  const i = clamp(G.beatIdx, 0, M.beats.length - 1);
  G.dir = { i, spawnQ: [], pressT: {}, wagon: null, beaconsDone: 0, doneT: 0, waitDlg: 0, waveIds: null, bossSeen: true };
  const b = M.beats[i];
  if (b) {
    if (b.t === 'wave') { G.dir.waveIds = new Set(); G.enemies.forEach(en => { if (en.hp > 0 && !ETYPES[en.ti].stone) G.dir.waveIds.add(en.id); }); }
    if (b.t === 'escort') { const w = G.objs.find(o => o[0] === 'w'); G.dir.wagon = w ? { x: w[1], y: w[2], hp: w[3], mhp: w[4] } : { x: 300, y: 545, hp: b.hp, mhp: b.hp }; for (const [tid, iv] of (b.press || [])) G.dir.pressT[tid] = iv; }
    if (b.t === 'beacons') { G.dir.beacons = G.objs.filter(o => o[0] === 'b').map(o => ({ x: o[1], y: o[2], prog: o[3] / 100, lit: !!o[4] })); if (!G.dir.beacons.length) { G.dir.beacons = []; for (let j = 0; j < b.n; j++) G.dir.beacons.push({ x: G.levelW * (0.28 + j * 0.27), y: 470 + (j % 2) * 130, prog: 0, lit: false }); } for (const [tid, iv] of (b.press || [])) G.dir.pressT[tid] = iv; }
    if (b.t === 'destroy') { G.dir.stoneIds = []; G.enemies.forEach(en => { if (ETYPES[en.ti].stone) G.dir.stoneIds.push(en.id); }); for (const [tid, iv] of (b.press || [])) G.dir.pressT[tid] = iv; }
    if (b.t === 'boss') { let alive = false; G.enemies.forEach(en => { if (ETYPES[en.ti].boss && en.hp > 0) alive = true; }); if (!alive) { const c = partyCentroid(); spawnEnemy(b.type, clamp(c.x + 480, 200, G.levelW - 120), 540, false); } }
    setObj(b.text || '');
  }
}

/* ------------------------------------------------------------------- fx -- */
function shake(a, t) { G.shA = Math.max(G.shA, a); G.shT = Math.max(G.shT, t); }
function hitstop(s) { G.hstop = Math.max(G.hstop, s); }
const FX = {
  slash(x, y, dir, s, col) { G.fx.push({ kind: 'slash', x, y, dir, s, col, t: 0, dur: 0.16 }); },
  ring(x, y, r, col) { G.fx.push({ kind: 'ring', x, y, r, col, t: 0, dur: 0.38 }); },
  poof(x, y, col) { for (let i = 0; i < 8; i++) G.fx.push({ kind: 'p', x, y, vx: rnd(-120, 120), vy: rnd(-160, 20), col, t: 0, dur: rnd(0.3, 0.5), r: rnd(2, 5) }); },
  spark(x, y, col, n) { for (let i = 0; i < (n || 4); i++) G.fx.push({ kind: 'p', x, y, vx: rnd(-200, 200), vy: rnd(-220, 40), col, t: 0, dur: rnd(0.15, 0.35), r: rnd(1.5, 3.5) }); },
  text(x, y, str, col) { G.texts.push({ x: x + rnd(-8, 8), y, str, col, t: 0 }); },
  zone(x, y, r, d, dmg) { G.fx.push({ kind: 'zone', x, y, r, d, dmg, t: 0, dur: d + 0.4, fired: false }); }
};
function updateFx(dt) {
  for (let i = G.fx.length - 1; i >= 0; i--) {
    const f = G.fx[i]; f.t += dt;
    if (f.kind === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 500 * dt; }
    if (f.kind === 'zone' && !f.fired && f.t >= f.d) {
      f.fired = true;
      FX.ring(f.x, f.y, f.r, '#c080ff'); AU.nova(); shake(4, 0.15);
      const me = G.me;
      if (me && !me.dead && !me.downed && me.invT <= 0 && dist2(me.x, me.y, f.x, f.y) < f.r * f.r)
        damageMe(f.dmg, me.x >= f.x ? 1 : -1, 'enemy', null, 260);
    }
    if (f.t > f.dur) G.fx.splice(i, 1);
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const t = G.texts[i]; t.t += dt; t.y -= 34 * dt;
    if (t.t > 0.9) G.texts.splice(i, 1);
  }
}

/* --------------------------------------------------------------- props -- */
function genProps(zone, levelW) {
  const props = [];
  const kinds = {
    village: ['house', 'fence', 'lantern'], forest: ['tree', 'stump', 'tree'],
    marsh: ['deadtree', 'reeds', 'pool'], garrison: ['tower', 'crate', 'brazier'],
    ruin: ['arch', 'pew', 'candles'], sanctum: ['pillar', 'shard', 'glyph']
  }[ZONES[zone].props];
  for (let x = -100; x < levelW + 200; x += srr(160, 320)) props.push({ layer: 0, kind: 'sil', x, h: srr(60, 170), w: srr(80, 200) });
  for (let x = -50; x < levelW + 100; x += srr(220, 420)) props.push({ layer: 1, kind: kinds[Math.floor(sr() * kinds.length)], x, y: srr(330, 380), s: srr(0.8, 1.3) });
  for (let x = 60; x < levelW; x += srr(340, 620)) props.push({ layer: 2, kind: kinds[Math.floor(sr() * kinds.length)], x, y: srr(FLOOR_TOP + 10, FLOOR_BOT - 10), s: srr(0.55, 0.8) });
  return props;
}

/* ambient particles (screen-space) */
const amb = [];
function ensureAmb() {
  while (amb.length < 42) amb.push({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-12, 12), vy: 0, s: rnd(1, 3.4), o: rnd(0.2, 0.7) });
}
function drawAmbient(ctx, kind, dt) {
  ensureAmb();
  ctx.save();
  for (const p of amb) {
    if (kind === 'ember') { p.y -= (14 + p.s * 8) * dt; p.x += Math.sin(G.time * 2 + p.s * 9) * 14 * dt; ctx.fillStyle = 'rgba(255,140,63,' + p.o * 0.7 + ')'; }
    else if (kind === 'leaf') { p.y += (16 + p.s * 6) * dt; p.x += Math.sin(G.time + p.s * 7) * 22 * dt; ctx.fillStyle = 'rgba(150,190,110,' + p.o * 0.5 + ')'; }
    else if (kind === 'fog') { p.x += (6 + p.s * 3) * dt; ctx.fillStyle = 'rgba(140,220,170,' + p.o * 0.06 + ')'; }
    else if (kind === 'snow') { p.y += (22 + p.s * 8) * dt; p.x += Math.sin(G.time + p.s * 5) * 10 * dt; ctx.fillStyle = 'rgba(220,225,255,' + p.o * 0.6 + ')'; }
    else { p.y += (10 + p.s * 5) * dt; p.x += Math.sin(G.time * 0.7 + p.s * 4) * 8 * dt; ctx.fillStyle = 'rgba(200,160,160,' + p.o * 0.45 + ')'; }
    if (p.y > H + 10) { p.y = -10; p.x = rnd(0, W); } if (p.y < -12) { p.y = H + 8; p.x = rnd(0, W); }
    if (p.x > W + 12) p.x = -10; if (p.x < -12) p.x = W + 10;
    if (kind === 'fog') { ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 26, 0, TAU); ctx.fill(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

/* ------------------------------------------------------------ rendering -- */
const cv = $('cv');
let ctx = cv.getContext('2d');

function drawBg(z) {
  const Z = ZONES[z];
  const g = ctx.createLinearGradient(0, 0, 0, 400);
  g.addColorStop(0, Z.sky[0]); g.addColorStop(1, Z.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 400);
  // moon / dying sun
  ctx.fillStyle = 'rgba(255,220,180,0.16)'; ctx.beginPath(); ctx.arc(W * 0.72 - G.camX * 0.05, 120, 62, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,220,180,0.3)'; ctx.beginPath(); ctx.arc(W * 0.72 - G.camX * 0.05, 120, 40, 0, TAU); ctx.fill();
  // far silhouettes
  ctx.fillStyle = Z.far;
  for (const p of G.props) if (p.layer === 0) {
    const x = p.x - G.camX * 0.25;
    if (x < -260 || x > W + 60) continue;
    ctx.beginPath(); ctx.moveTo(x, 372); ctx.lineTo(x + p.w * 0.2, 372 - p.h); ctx.lineTo(x + p.w * 0.55, 372 - p.h * 0.6); ctx.lineTo(x + p.w * 0.8, 372 - p.h * 0.9); ctx.lineTo(x + p.w, 372); ctx.fill();
  }
  // mid props
  for (const p of G.props) if (p.layer === 1) drawProp(p, p.x - G.camX * 0.55, 1, Z.mid);
  // ground
  ctx.fillStyle = Z.ground; ctx.fillRect(0, 372, W, H - 372);
  ctx.strokeStyle = Z.gline; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
  for (let y = 402; y < H; y += 34) {
    ctx.beginPath();
    const off = (G.camX * (0.4 + (y - 372) / (H - 372) * 0.6)) % 90;
    for (let x = -off; x < W + 90; x += 90) { ctx.moveTo(x + (y % 68), y); ctx.lineTo(x + 40 + (y % 68), y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 372, W, 10);
}
function drawProp(p, x, mul, col) {
  if (x < -160 || x > W + 160) return;
  const s = p.s * mul, y = p.layer === 1 ? 372 : p.y;
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = p.layer === 2 ? shade(ZONES[G.zone].ground, 1.7) : col;
  switch (p.kind) {
    case 'house': ctx.fillRect(-46, -70, 92, 70); ctx.beginPath(); ctx.moveTo(-58, -70); ctx.lineTo(0, -118); ctx.lineTo(58, -70); ctx.fill();
      ctx.fillStyle = 'rgba(255,170,80,.55)'; ctx.fillRect(-12, -52, 22, 24); break;
    case 'fence': for (let i = 0; i < 5; i++) ctx.fillRect(-60 + i * 28, -34, 8, 34); ctx.fillRect(-64, -28, 128, 6); break;
    case 'lantern': ctx.fillRect(-3, -86, 6, 86); ctx.fillRect(-11, -98, 22, 18);
      ctx.fillStyle = 'rgba(255,170,80,.8)'; ctx.beginPath(); ctx.arc(0, -89, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,170,80,.12)'; ctx.beginPath(); ctx.arc(0, -89, 30, 0, TAU); ctx.fill(); break;
    case 'tree': ctx.fillRect(-7, -66, 14, 66); ctx.beginPath(); ctx.arc(-16, -78, 26, 0, TAU); ctx.arc(14, -86, 30, 0, TAU); ctx.arc(-2, -108, 26, 0, TAU); ctx.fill(); break;
    case 'stump': ctx.fillRect(-14, -22, 28, 22); ctx.fillRect(-18, -26, 36, 6); break;
    case 'deadtree': ctx.fillRect(-6, -84, 12, 84); ctx.save(); ctx.rotate(-0.6); ctx.fillRect(0, -70, 44, 7); ctx.restore(); ctx.save(); ctx.rotate(0.5); ctx.fillRect(-40, -78, 42, 6); ctx.restore(); break;
    case 'reeds': for (let i = 0; i < 6; i++) { ctx.save(); ctx.rotate((i - 3) * 0.08 + Math.sin(G.time + i) * 0.04); ctx.fillRect(-18 + i * 7, -46, 3, 46); ctx.restore(); } break;
    case 'pool': ctx.fillStyle = 'rgba(90,180,140,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 60, 14, 0, 0, TAU); ctx.fill(); break;
    case 'tower': ctx.fillRect(-34, -140, 68, 140); for (let i = 0; i < 4; i++) ctx.fillRect(-34 + i * 20, -152, 12, 12); break;
    case 'crate': ctx.fillRect(-18, -32, 36, 32); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.strokeRect(-18, -32, 36, 32); break;
    case 'brazier': ctx.fillRect(-12, -30, 24, 8); ctx.fillRect(-4, -22, 8, 22);
      ctx.fillStyle = 'rgba(255,140,60,.85)'; ctx.beginPath(); ctx.arc(0, -34, 8 + Math.sin(G.time * 7) * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,140,60,.12)'; ctx.beginPath(); ctx.arc(0, -34, 34, 0, TAU); ctx.fill(); break;
    case 'arch': ctx.fillRect(-52, -120, 20, 120); ctx.fillRect(32, -120, 20, 120); ctx.beginPath(); ctx.arc(0, -114, 52, Math.PI, 0); ctx.lineTo(32, -96); ctx.arc(0, -114, 32, 0, Math.PI, true); ctx.fill(); break;
    case 'pew': ctx.fillRect(-40, -18, 80, 8); ctx.fillRect(-40, -34, 6, 34); ctx.fillRect(34, -34, 6, 34); break;
    case 'candles': for (let i = 0; i < 4; i++) { ctx.fillRect(-24 + i * 14, -14 - (i % 2) * 8, 5, 14 + (i % 2) * 8); ctx.fillStyle = 'rgba(255,190,90,.9)'; ctx.beginPath(); ctx.arc(-21 + i * 14, -18 - (i % 2) * 8, 2.6, 0, TAU); ctx.fill(); ctx.fillStyle = p.layer === 2 ? shade(ZONES[G.zone].ground, 1.7) : col; } break;
    case 'pillar': ctx.fillRect(-16, -150, 32, 150); ctx.fillRect(-24, -158, 48, 10); ctx.fillRect(-22, -8, 44, 8); break;
    case 'shard': ctx.save(); ctx.translate(0, -70 + Math.sin(G.time + p.x) * 8); ctx.rotate(0.4); ctx.fillStyle = 'rgba(180,110,230,.7)'; ctx.fillRect(-8, -26, 16, 52); ctx.restore(); break;
    case 'glyph': ctx.strokeStyle = 'rgba(190,120,255,.4)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, 46, 12, 0, 0, TAU); ctx.stroke(); break;
  }
  ctx.restore();
}

/* character rendering ----------------------------------------------------- */
function drawShadow(x, y, w) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, y + 2, w, w * 0.3, 0, 0, TAU); ctx.fill(); }

function drawHero(h) {
  const L = h.look, c1 = L.c1 || '#888', c2 = L.c2 || '#444', c3 = L.c3 || '#ffb14f';
  const x = h.x, y = h.y, d = h.dir;
  drawShadow(x, y, 20);
  ctx.save(); ctx.translate(x, y); ctx.scale(d, 1);
  const bob = (h.anim === 1) ? Math.sin(h.walkT * 2.4) * 2.5 : Math.sin(G.time * 2 + h.id) * 1.2;
  if (h.downed || h.dead) { ctx.rotate(-Math.PI / 2); ctx.translate(-6, 14); ctx.globalAlpha = h.dead ? 0.35 : 0.85; }
  else if (h.anim === 3) ctx.rotate(Math.min(1, h.animT / 0.32) * TAU * (h.rollDx >= 0 === (d > 0) ? 1 : -1) * 0.9);
  else if (h.anim === 4) ctx.rotate(-0.18);
  if (h.flashT > 0) { ctx.filter = 'brightness(3)'; }
  // legs
  const step = Math.sin(h.walkT * 2.4) * (h.anim === 1 ? 6 : 0);
  ctx.fillStyle = shade(c2, 0.8);
  ctx.fillRect(-9 + step * 0.5, -14, 8, 14); ctx.fillRect(2 - step * 0.5, -14, 8, 14);
  // cape
  if (L.cape) {
    ctx.fillStyle = shade(c3, 0.7);
    ctx.beginPath(); ctx.moveTo(-8, -46 + bob);
    ctx.quadraticCurveTo(-26 - step, -30 + bob, -18 - Math.sin(G.time * 3 + h.id) * 4, -4);
    ctx.lineTo(-6, -18); ctx.closePath(); ctx.fill();
  }
  // torso
  const isM = h.cls === 'mage';
  ctx.fillStyle = c1;
  if (isM) { ctx.beginPath(); ctx.moveTo(-11, -44 + bob); ctx.lineTo(11, -44 + bob); ctx.lineTo(15, -8); ctx.lineTo(-15, -8); ctx.closePath(); ctx.fill(); }
  else { rr(-11, -46 + bob, 22, 34, 6); }
  ctx.fillStyle = c3; ctx.fillRect(-11, -22 + bob, isM ? 26 : 22, 4); // belt/sash
  if (isM) ctx.fillRect(-13, -22 + bob, 26, 4);
  // head
  const hy = -54 + bob;
  ctx.fillStyle = '#d8b090'; ctx.beginPath(); ctx.arc(2, hy, 8, 0, TAU); ctx.fill();
  // helm per class
  ctx.fillStyle = shade(c1, 1.25);
  const hs = L.helm || 0;
  if (h.cls === 'knight') {
    if (hs === 0) { rr(-7, hy - 10, 18, 18, 4); ctx.fillStyle = '#100c10'; ctx.fillRect(3, hy - 3, 8, 3); }
    else if (hs === 1) { rr(-7, hy - 10, 18, 14, 4); ctx.fillStyle = c3; ctx.beginPath(); ctx.moveTo(-6, hy - 10); ctx.quadraticCurveTo(-16, hy - 22, -22, hy - 8); ctx.lineTo(-8, hy - 4); ctx.fill(); ctx.fillStyle = '#100c10'; ctx.fillRect(3, hy - 2, 8, 3); }
    else { ctx.fillStyle = shade(c2, 1.2); ctx.beginPath(); ctx.arc(2, hy - 2, 10, Math.PI * 0.9, Math.PI * 2.1); ctx.fill(); }
  } else if (h.cls === 'mage') {
    if (hs === 0) { ctx.beginPath(); ctx.moveTo(-12, hy - 4); ctx.lineTo(14, hy - 4); ctx.lineTo(3, hy - 26); ctx.closePath(); ctx.fill(); ctx.fillRect(-14, hy - 5, 30, 4); }
    else if (hs === 1) { ctx.fillStyle = c3; ctx.fillRect(-6, hy - 9, 16, 3); }
    else { ctx.beginPath(); ctx.arc(1, hy - 2, 11, Math.PI * 0.8, Math.PI * 2.2); ctx.fill(); ctx.fillStyle = '#100c10'; ctx.beginPath(); ctx.arc(4, hy, 6, 0, TAU); ctx.fill(); }
  } else {
    if (hs === 0) { ctx.fillStyle = shade(c1, 1.1); ctx.beginPath(); ctx.arc(1, hy - 2, 10, Math.PI * 0.75, Math.PI * 2.25); ctx.fill(); ctx.beginPath(); ctx.moveTo(-8, hy + 4); ctx.lineTo(-2, hy + 12); ctx.lineTo(-9, hy - 4); ctx.fill(); }
    else if (hs === 1) { ctx.beginPath(); ctx.arc(1, hy - 4, 9, Math.PI, TAU); ctx.fill(); ctx.fillStyle = c3; ctx.save(); ctx.rotate(-0.5); ctx.fillRect(-4, hy - 4, 16, 3); ctx.restore(); }
    // hs 2: bare-headed
  }
  // weapon + front arm
  ctx.fillStyle = '#d8b090';
  const tier = L.tier || 0;
  const bladeCol = tier === 2 ? '#ffd9a0' : tier === 1 ? '#e8c8d8' : '#c9ccd4';
  if (h.cls === 'knight') {
    let ang = 0.55; // rest angle
    if (h.anim === 2) { const p2 = clamp(h.animT / 0.22, 0, 1); ang = lerp(-1.9, 1.25, p2); }
    if (h.blocking) {
      // shield forward
      ctx.fillStyle = shade(c2, 1.3); rr(12, -46 + bob, 10, 30, 4);
      ctx.fillStyle = c3; ctx.fillRect(15, -34 + bob, 4, 8);
      ang = -0.8;
    }
    ctx.save(); ctx.translate(8, -34 + bob); ctx.rotate(ang);
    ctx.fillStyle = bladeCol; rr(-2.5, -40, 5, 36, 2);
    ctx.fillStyle = c3; ctx.fillRect(-7, -6, 14, 4); ctx.fillStyle = shade(c3, 0.7); ctx.fillRect(-2, -2, 4, 9);
    if (tier === 2) { ctx.fillStyle = 'rgba(255,180,80,.35)'; rr(-4.5, -42, 9, 40, 3); }
    ctx.restore();
    if (!h.blocking) { ctx.fillStyle = shade(c2, 1.3); rr(-16, -42 + bob, 8, 22, 3); } // shield on back
  } else if (h.cls === 'mage') {
    const cast = h.anim === 2 && h.animT < 0.2;
    ctx.save(); ctx.translate(10, -30 + bob); ctx.rotate(cast ? -0.5 : 0.15);
    ctx.fillStyle = shade(c2, 1.4); ctx.fillRect(-2, -34, 4, 46);
    ctx.fillStyle = c3; ctx.beginPath(); ctx.arc(0, -37, 5 + (cast ? 2 : Math.sin(G.time * 4) * 1), 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,177,79,.2)'; ctx.beginPath(); ctx.arc(0, -37, 13, 0, TAU); ctx.fill();
    ctx.restore();
  } else {
    const drawn = h.anim === 8 || (h.charging);
    ctx.save(); ctx.translate(12, -32 + bob);
    ctx.strokeStyle = shade(c2, 1.5); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 16, -Math.PI * 0.42, Math.PI * 0.42); ctx.stroke();
    ctx.strokeStyle = '#e8dcc3'; ctx.lineWidth = 1;
    const pull = drawn ? clamp(h.chargeT / 0.85, 0, 1) * 9 : 0;
    ctx.beginPath(); ctx.moveTo(Math.cos(-Math.PI * 0.42) * 16, Math.sin(-Math.PI * 0.42) * 16);
    ctx.lineTo(-pull, 0); ctx.lineTo(Math.cos(Math.PI * 0.42) * 16, Math.sin(Math.PI * 0.42) * 16); ctx.stroke();
    if (drawn) { ctx.strokeStyle = bladeCol; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-pull, 0); ctx.lineTo(14, 0); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = shade(c2, 0.9); rr(-14, -44 + bob, 8, 16, 3); // quiver
  }
  ctx.restore();
  // overhead: name + bars
  ctx.textAlign = 'center'; ctx.font = '13px Cinzel, serif';
  ctx.fillStyle = h.id === G.myId ? '#ffd9b0' : '#cfc4ae';
  ctx.fillText(h.name || '', x, y - 84);
  if (h.id !== G.myId || G.mode === 'duel') {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 24, y - 80, 48, 5);
    ctx.fillStyle = h.downed ? '#d8574a' : CLASSES[h.cls].col;
    ctx.fillRect(x - 24, y - 80, 48 * clamp(h.hp / (h.mhp || 1), 0, 1), 5);
  }
  if (h.downed && !h.dead) { ctx.fillStyle = '#ff9a8a'; ctx.font = '12px Alegreya'; ctx.fillText('DOWNED — revive with E (' + Math.ceil(h.downT) + ')', x, y - 94); }
  if (h.blocking) { ctx.strokeStyle = 'rgba(207,214,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + h.dir * 18, y - 32, 20, -1.1, 1.1); ctx.stroke(); }
}
function rr(x, y, w, h2, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h2, r); ctx.fill(); }

function drawEnemy(en) {
  const t = ETYPES[en.ti];
  const x = en.x, y = en.y, s = t.w / 36 * (en.elite ? 1.2 : 1);
  drawShadow(x, y, 16 * s);
  ctx.save(); ctx.translate(x, y); ctx.scale(en.dir * s, s);
  if (en.hp <= 0) { ctx.globalAlpha = Math.max(0, en.dieT / 0.5); ctx.rotate(-1.2); }
  if (en.flashT > 0) ctx.filter = 'brightness(3)';
  if (en.state === 1) { // windup telegraph
    ctx.strokeStyle = 'rgba(255,90,70,0.9)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, -26, 26, 0, TAU); ctx.stroke();
  }
  if (en.elite) { ctx.fillStyle = 'rgba(255,177,79,.14)'; ctx.beginPath(); ctx.arc(0, -24, 30, 0, TAU); ctx.fill(); }
  const bob = Math.sin(G.time * 3 + (en.x % 7)) * 1.5;
  const col = t.col, dk = shade(col, 0.6), lt = shade(col, 1.35);
  switch (t.id) {
    case 'goblin':
      ctx.fillStyle = col; rr(-9, -22 + bob, 18, 16, 5);
      ctx.beginPath(); ctx.arc(3, -28 + bob, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = dk; ctx.beginPath(); ctx.moveTo(-4, -32 + bob); ctx.lineTo(-13, -40 + bob); ctx.lineTo(-6, -27 + bob); ctx.fill();
      ctx.fillStyle = '#ffef9a'; ctx.beginPath(); ctx.arc(6, -29 + bob, 1.8, 0, TAU); ctx.fill();
      ctx.fillStyle = lt; ctx.fillRect(8, -20 + bob, 12, 3); break;
    case 'bandit':
      ctx.fillStyle = dk; rr(-10, -38 + bob, 20, 32, 5);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(2, -42 + bob, 9, Math.PI * 0.7, Math.PI * 2.3); ctx.fill();
      ctx.fillStyle = '#1a1012'; ctx.beginPath(); ctx.arc(4, -41 + bob, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0e4ea'; ctx.save(); ctx.translate(11, -22 + bob); ctx.rotate(en.state === 1 ? -1.2 : 0.4); ctx.fillRect(0, -12, 3, 12); ctx.restore(); break;
    case 'zombie':
      ctx.fillStyle = col; rr(-11, -36 + bob, 22, 30, 4);
      ctx.beginPath(); ctx.arc(4, -42 + bob, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = dk; ctx.fillRect(6, -30 + bob, 16, 5); ctx.fillRect(4, -22 + bob, 12, 5);
      ctx.fillStyle = '#c0e8a0'; ctx.beginPath(); ctx.arc(7, -43 + bob, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(120,220,160,.25)'; ctx.beginPath(); ctx.arc(0, -30, 22, 0, TAU); ctx.fill(); break;
    case 'soldier':
      ctx.fillStyle = col; rr(-10, -40 + bob, 20, 34, 4);
      ctx.fillStyle = lt; rr(-6, -52 + bob, 16, 12, 3);
      ctx.fillStyle = '#100c10'; ctx.fillRect(4, -47 + bob, 6, 3);
      ctx.fillStyle = shade(col, 0.8); rr(12, -44 + bob, 9, 34, 3); // tower shield
      ctx.fillStyle = '#e0e4ea'; ctx.fillRect(-16, -34 + bob, 3, 22); break;
    case 'cultist':
      ctx.fillStyle = dk; ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(-8, -42 + bob); ctx.lineTo(10, -42 + bob); ctx.lineTo(14, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8dcc3'; ctx.beginPath(); ctx.arc(2, -46 + bob, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#100c10'; ctx.fillRect(0, -48 + bob, 7, 2); ctx.fillRect(0, -44 + bob, 7, 2);
      const gl = en.state === 1 ? 6 + Math.sin(G.time * 14) * 2 : 3;
      ctx.fillStyle = '#c080ff'; ctx.beginPath(); ctx.arc(13, -28 + bob, gl, 0, TAU); ctx.fill(); break;
    case 'stone':
      ctx.save(); ctx.scale(en.dir, 1); // unflip
      ctx.fillStyle = '#3a2a4a'; ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-11, -58); ctx.lineTo(0, -70); ctx.lineTo(12, -56); ctx.lineTo(16, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(190,120,255,' + (0.5 + Math.sin(G.time * 5) * 0.3) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -34); ctx.lineTo(6, -44); ctx.stroke();
      const cr = 1 - en.hp / en.mhp;
      if (cr > 0.3) { ctx.strokeStyle = '#100c10'; ctx.beginPath(); ctx.moveTo(-10, -20); ctx.lineTo(2, -30); ctx.lineTo(-3, -44); ctx.stroke(); }
      ctx.restore(); break;
    case 'maro':
      ctx.fillStyle = col; rr(-14, -56 + bob, 28, 46, 6);
      ctx.fillStyle = lt; rr(-9, -72 + bob, 22, 18, 4);
      ctx.fillStyle = '#d8574a'; ctx.beginPath(); ctx.moveTo(-8, -72 + bob); ctx.quadraticCurveTo(-22, -90 + bob, -30, -66 + bob); ctx.lineTo(-10, -62 + bob); ctx.fill();
      ctx.fillStyle = '#100c10'; ctx.fillRect(4, -66 + bob, 9, 4);
      ctx.fillStyle = '#e0e4ea'; ctx.save(); ctx.translate(14, -40 + bob);
      ctx.rotate(en.state === 1 ? -1.6 : en.state === 7 ? 0.9 : 0.5); rr(-3, -52, 6, 50, 2); ctx.restore();
      if (en.state === 6) { ctx.fillStyle = 'rgba(255,90,70,.2)'; ctx.fillRect(0, -50, 600, 60); } break;
    case 'cantor':
      ctx.translate(0, -14 + Math.sin(G.time * 1.6) * 5);
      ctx.fillStyle = dk; ctx.beginPath(); ctx.moveTo(-18, 8); ctx.lineTo(-12, -66); ctx.lineTo(14, -66); ctx.lineTo(20, 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-12, -66); ctx.lineTo(1, -84); ctx.lineTo(14, -66); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe9c0'; ctx.beginPath(); ctx.arc(2, -70, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(190,120,255,.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { const a = G.time * 1.4 + i * TAU / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 34, -50 + Math.sin(a) * 16, 4, 0, TAU); ctx.stroke(); }
      break;
  }
  ctx.restore();
  if (en.hp > 0 && !t.boss && t.id !== 'stone') {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 18, y - 56 * s, 36, 4);
    ctx.fillStyle = en.elite ? '#ffb14f' : '#d8574a'; ctx.fillRect(x - 18, y - 56 * s, 36 * clamp(en.hp / en.mhp, 0, 1), 4);
  }
  if (t.id === 'stone' && en.hp > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 24, y - 84, 48, 5);
    ctx.fillStyle = '#c080ff'; ctx.fillRect(x - 24, y - 84, 48 * clamp(en.hp / en.mhp, 0, 1), 5);
  }
}
function drawObjs() {
  for (const o of G.objs.length ? G.objs : hostObjs()) {
    if (o[0] === 'w') {
      const [_, x, y, hp, mhp] = o;
      drawShadow(x, y, 42);
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = '#6a4a30'; rr(-44, -40, 88, 30, 5);
      ctx.fillStyle = '#8a6a4a'; rr(-38, -52, 40, 14, 3);
      ctx.fillStyle = '#c080ff'; ctx.beginPath(); ctx.arc(18, -46, 6 + Math.sin(G.time * 3) * 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2a1a14'; ctx.beginPath(); ctx.arc(-24, -6, 12, 0, TAU); ctx.arc(24, -6, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#100c10'; ctx.beginPath(); ctx.arc(-24, -6, 5, 0, TAU); ctx.arc(24, -6, 5, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x - 40, y - 66, 80, 6);
      ctx.fillStyle = '#9dc46a'; ctx.fillRect(x - 40, y - 66, 80 * clamp(hp / mhp, 0, 1), 6);
      ctx.fillStyle = '#cfc4ae'; ctx.font = '12px Cinzel'; ctx.textAlign = 'center'; ctx.fillText('RELIQUARY CART', x, y - 72);
    } else if (o[0] === 'b') {
      const [_, x, y, prog, lit] = o;
      drawShadow(x, y, 14);
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = '#3a3038'; ctx.fillRect(-8, -34, 16, 34); ctx.fillRect(-14, -40, 28, 8);
      if (lit) {
        ctx.fillStyle = 'rgba(157,196,106,.9)'; ctx.beginPath(); ctx.arc(0, -48, 9 + Math.sin(G.time * 6) * 2, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(157,196,106,.14)'; ctx.beginPath(); ctx.arc(0, -48, 46, 0, TAU); ctx.fill();
      } else if (prog > 0) {
        ctx.fillStyle = 'rgba(255,177,79,.8)'; ctx.beginPath(); ctx.arc(0, -46, 4 + prog / 100 * 6, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-20, -70, 40, 5);
        ctx.fillStyle = '#ffb14f'; ctx.fillRect(-20, -70, 40 * prog / 100, 5);
      }
      ctx.restore();
    }
  }
}
function hostObjs() {
  const objs = []; const D = G.dir;
  if (G.host && D) {
    if (D.wagon) objs.push(['w', D.wagon.x, D.wagon.y, D.wagon.hp, D.wagon.mhp]);
    if (D.beacons) for (const b of D.beacons) objs.push(['b', b.x, b.y, b.prog * 100, b.lit ? 1 : 0]);
  }
  return objs;
}
function drawProjs() {
  for (const p of G.projs) {
    ctx.save(); ctx.translate(p.x, p.y);
    if (p.kind === 'bolt') {
      ctx.fillStyle = 'rgba(255,140,63,.25)'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    } else if (p.kind === 'arrow') {
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.strokeStyle = '#e8dcc3'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = p.pierce ? '#ffd9a0' : '#c9ccd4'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(2, -3.4); ctx.lineTo(2, 3.4); ctx.fill();
      if (p.pierce) { ctx.strokeStyle = 'rgba(255,177,79,.5)'; ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(-12, 0); ctx.stroke(); }
    } else if (p.kind === 'knife') {
      ctx.rotate(G.time * 16); ctx.fillStyle = '#e0e4ea'; ctx.fillRect(-6, -1.5, 12, 3);
    } else { // orb
      ctx.fillStyle = 'rgba(192,128,255,.25)'; ctx.beginPath(); ctx.arc(0, 0, 13 + Math.sin(G.time * 9) * 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e0c0ff'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
function drawFx() {
  for (const f of G.fx) {
    const k = f.t / f.dur;
    if (f.kind === 'slash') {
      ctx.save(); ctx.translate(f.x, f.y); ctx.scale(f.dir * f.s, f.s);
      ctx.strokeStyle = f.col; ctx.lineWidth = 5 * (1 - k); ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.arc(0, 0, 34, -1.2 + k * 1.4, 0.2 + k * 1.6); ctx.stroke();
      ctx.restore();
    } else if (f.kind === 'ring') {
      ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.3 + k * 0.7), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (f.kind === 'p') {
      ctx.fillStyle = f.col; ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 - k * 0.6), 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else if (f.kind === 'zone') {
      const fill = clamp(f.t / f.d, 0, 1);
      ctx.strokeStyle = 'rgba(192,128,255,.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * 0.4, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(192,128,255,.16)';
      ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r * fill, f.r * 0.4 * fill, 0, 0, TAU); ctx.fill();
    }
  }
  ctx.font = 'bold 17px Cinzel, serif'; ctx.textAlign = 'center';
  for (const t of G.texts) { ctx.globalAlpha = 1 - t.t / 0.9; ctx.fillStyle = t.col; ctx.fillText(t.str, t.x, t.y); }
  ctx.globalAlpha = 1;
}
function drawHud() {
  const me = G.me; if (!me) return;
  ctx.save(); ctx.textAlign = 'left';
  // my vitals
  const bx = 24, by = H - 74;
  ctx.fillStyle = 'rgba(10,6,9,.7)'; rr(bx - 10, by - 26, 320, 88, 8);
  ctx.fillStyle = CLASSES[me.cls].col; ctx.beginPath(); ctx.arc(bx + 14, by + 4, 15, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0d090c'; ctx.font = 'bold 15px Cinzel'; ctx.textAlign = 'center';
  ctx.fillText(me.cls[0].toUpperCase(), bx + 14, by + 9);
  ctx.textAlign = 'left'; ctx.fillStyle = '#e9dcc3'; ctx.font = '13px Cinzel';
  ctx.fillText(me.name, bx + 38, by - 8);
  ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx + 38, by - 2, 250, 13);
  ctx.fillStyle = me.hp / me.mhp > 0.3 ? '#b04a3a' : '#d8574a';
  ctx.fillRect(bx + 38, by - 2, 250 * clamp(me.hp / me.mhp, 0, 1), 13);
  ctx.fillStyle = '#ffd9b0'; ctx.font = '11px Alegreya';
  ctx.fillText(Math.ceil(me.hp) + ' / ' + me.mhp, bx + 42, by + 8);
  if (me.cls === 'mage') {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx + 38, by + 14, 250, 8);
    ctx.fillStyle = '#5a8ad0'; ctx.fillRect(bx + 38, by + 14, 250 * clamp(me.mana / me.mmana, 0, 1), 8);
  }
  // cooldown pips
  const pips = [['DODGE', me.dodgeCd, me.cls === 'mage' ? 1.6 : 0.95], [me.cls === 'knight' ? 'BLOCK' : me.cls === 'mage' ? 'NOVA' : 'VOLLEY', me.cls === 'knight' ? 0 : me.skillCd, me.cls === 'mage' ? 4.5 : 5]];
  let px = bx + 38;
  for (const [nm, cd, mx] of pips) {
    const ready = cd <= 0;
    ctx.fillStyle = ready ? 'rgba(255,140,63,.85)' : 'rgba(120,100,90,.5)';
    rr(px, by + 28, 62, 16, 4);
    if (!ready) { ctx.fillStyle = 'rgba(255,140,63,.4)'; rr(px, by + 28, 62 * (1 - cd / mx), 16, 4); }
    ctx.fillStyle = '#0d090c'; ctx.font = 'bold 10px Cinzel'; ctx.textAlign = 'center';
    ctx.fillText(nm, px + 31, by + 40); px += 70;
  }
  // ranger charge
  if (me.charging) {
    const ch = clamp(me.chargeT / 0.85, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(me.x - G.camX - 24, me.y - 100, 48, 6);
    ctx.fillStyle = ch >= 1 ? '#ffd9a0' : '#9dc46a'; ctx.fillRect(me.x - G.camX - 24, me.y - 100, 48 * ch, 6);
  }
  // revive progress
  if (me.revTarget && me.reviveT > 0) {
    const t = me.revTarget;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(t.x - G.camX - 26, t.y - 106, 52, 7);
    ctx.fillStyle = '#9dc46a'; ctx.fillRect(t.x - G.camX - 26, t.y - 106, 52 * (me.reviveT / 2.2), 7);
  }
  // coins
  ctx.textAlign = 'right'; ctx.font = 'bold 17px Cinzel'; ctx.fillStyle = '#ffb14f';
  ctx.fillText('◈ ' + P.coins, W - 26, 38);
  // objective / arena
  ctx.textAlign = 'center';
  if (G.objText && !G.boss) {
    ctx.font = '13px Cinzel'; ctx.fillStyle = '#9a8878'; ctx.fillText(G.mode === 'story' ? 'OBJECTIVE' : 'ARENA', W / 2, 26);
    ctx.font = 'bold 17px Cinzel'; ctx.fillStyle = '#e9dcc3'; ctx.fillText(G.objText, W / 2, 46);
  }
  // boss bar
  if (G.boss) {
    ctx.font = 'bold 15px Cinzel'; ctx.fillStyle = '#e0c0ff'; ctx.fillText(G.boss.name, W / 2, 26);
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(W / 2 - 260, 34, 520, 12);
    ctx.fillStyle = '#8a4fbe'; ctx.fillRect(W / 2 - 260, 34, 520 * clamp(G.boss.hp / G.boss.mhp, 0, 1), 12);
    ctx.strokeStyle = '#c080ff'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - 260, 34, 520, 12);
  }
  // duel score
  if (G.mode === 'duel' && G.duel) {
    const order = [...G.roster].sort((a, b) => a.id - b.id);
    ctx.font = 'bold 15px Cinzel';
    order.forEach((r, i) => {
      const sc = G.duel.score[r.id] || 0;
      ctx.fillStyle = i === 0 ? '#ffd9b0' : '#cfd6ff'; ctx.textAlign = i === 0 ? 'right' : 'left';
      ctx.fillText(r.name + '  ' + '●'.repeat(sc) + '○'.repeat(Math.max(0, 2 - sc)), W / 2 + (i === 0 ? -40 : 40), 70);
    });
    ctx.textAlign = 'center'; ctx.font = '13px Cinzel'; ctx.fillStyle = '#9a8878';
    ctx.fillText('ROUND ' + G.duel.round + ' · FIRST TO 2', W / 2, 70);
  }
  // countdown
  if (G.countdown > 0) {
    const n = Math.ceil(G.countdown - 0.2);
    ctx.font = 'bold 110px Cinzel'; ctx.fillStyle = 'rgba(255,217,176,.9)';
    ctx.fillText(n > 0 ? n : '', W / 2, H / 2 - 40);
  } else if (G.countdown > -0.8 && G.mode === 'duel') {
    ctx.font = 'bold 74px Cinzel'; ctx.fillStyle = '#ff8c3f'; ctx.fillText('FIGHT', W / 2, H / 2 - 40);
  }
  // banner
  if (G.banner && G.banner.t > 0) {
    ctx.globalAlpha = Math.min(1, G.banner.t);
    ctx.font = 'bold 34px Cinzel'; ctx.fillStyle = '#e0c0ff'; ctx.fillText(G.banner.txt, W / 2, 130);
    ctx.globalAlpha = 1;
  }
  // downed overlay
  if (me.downed && !me.dead) {
    ctx.fillStyle = 'rgba(120,20,20,.18)'; ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 30px Cinzel'; ctx.fillStyle = '#ff9a8a';
    ctx.fillText('YOU ARE DOWN', W / 2, H / 2 - 80);
    ctx.font = '16px Alegreya'; ctx.fillStyle = '#e9dcc3';
    ctx.fillText(partyCount() > 1 ? 'An ally can revive you — hold on. (' + Math.ceil(me.downT) + 's)' : 'The hymn takes the field...', W / 2, H / 2 - 52);
  }
  if (me.dead && G.mode === 'story') {
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 26px Cinzel'; ctx.fillStyle = '#cfc4ae'; ctx.fillText('You watch from the embers — your allies fight on', W / 2, H / 2 - 60);
  }
  ctx.restore();
}

/* --------------------------------------------------------------- render -- */
function render(dt) {
  const Z = ZONES[G.zone];
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (G.shT > 0) { ctx.translate(rnd(-G.shA, G.shA), rnd(-G.shA, G.shA)); }
  drawBg(G.zone);
  ctx.save(); ctx.translate(-G.camX, 0);
  // ground props behind entities
  for (const p of G.props) if (p.layer === 2) drawProp(p, p.x, 1, Z.mid);
  // obstacles
  for (const o of G.obstacles) {
    ctx.fillStyle = shade(Z.ground, 1.9); ctx.fillRect(o.x, o.y - 44, o.w, o.h + 44);
    ctx.fillStyle = shade(Z.ground, 2.5); ctx.fillRect(o.x, o.y - 44, o.w, 10);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(o.x + o.w / 2, o.y + o.h, o.w * 0.7, 10, 0, 0, TAU); ctx.fill();
  }
  drawObjs();
  // depth sort entities
  const ents = [];
  G.players.forEach(h => ents.push({ y: h.y, f: () => drawHero(h) }));
  G.enemies.forEach(en => ents.push({ y: en.y, f: () => drawEnemy(en) }));
  ents.sort((a, b) => a.y - b.y);
  for (const e of ents) e.f();
  drawProjs();
  drawFx();
  ctx.restore();
  // atmosphere
  ctx.fillStyle = Z.fog; ctx.fillRect(0, 0, W, H);
  drawAmbient(ctx, Z.part, dt);
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  drawHud();
  ctx.restore();
}

/* ------------------------------------------------------------- main loop -- */
let lastT = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  if (!lastT) lastT = ts;
  let dt = Math.min(0.034, (ts - lastT) / 1000); lastT = ts;
  if (G.screen !== 'game') return;
  G.time += dt;
  if (G.banner) G.banner.t -= dt;
  if (G.countdown > -1) G.countdown -= dt;
  G.shT -= dt; if (G.shT <= 0) G.shA = 0;
  let wdt = dt;
  if (G.hstop > 0) { G.hstop -= dt; wdt = 0; }
  if (wdt > 0) {
    G.players.forEach(h => h.update(wdt));
    if (G.mode === 'story') {
      if (G.host) { updateEnemiesHost(wdt); updateDirector(wdt); }
      else updateShadowEnemies(wdt);
    }
    updateProjs(wdt);
  }
  updateFx(dt);
  // camera
  if (G.me) {
    const target = clamp(G.me.x - W / 2, 0, Math.max(0, G.levelW - W));
    G.camX = lerp(G.camX, target, Math.min(1, dt * 6));
  }
  mouseInWorld.x = mouseX + G.camX; mouseInWorld.y = mouseY;
  pushSt(); pushWorld();
  if (Keys.escP) { Keys.escP = false; $('esc').classList.toggle('on'); }
  render(dt);
}
requestAnimationFrame(loop);

/* ------------------------------------------------------------- UI layer -- */
const UI = {
  dlgQueue: [], dlgTimer: null,
  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    $(id).classList.add('on');
    G.screen = id === 's-game' ? 'game' : id.slice(2);
    if (id === 's-game') { $('cv').focus(); }
    else AU.stopAmbient();
  },
  toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), 3200);
  },
  queueDlg(lines) {
    for (const l of lines) this.dlgQueue.push(l);
    if (!$('dlg').classList.contains('on')) this.advanceDlg();
  },
  advanceDlg() {
    clearTimeout(this.dlgTimer);
    const next = this.dlgQueue.shift();
    if (!next) { $('dlg').classList.remove('on'); return; }
    $('dlg-name').textContent = WHO[next[0]] || next[0];
    $('dlg-text').textContent = next[1];
    $('dlg').classList.add('on');
    this.dlgTimer = setTimeout(() => this.advanceDlg(), 6000);
  }
};
$('dlg').addEventListener('click', () => UI.advanceDlg());

function showResults(title, sub, lines) {
  $('r-title').textContent = title;
  $('r-sub').textContent = sub;
  $('r-lines').innerHTML = lines.map(l => '<div><span>' + l[0] + '</span><span class="coin" style="color:var(--ink)">' + l[1] + '</span></div>').join('');
  UI.show('s-results');
  refreshMenuCoins();
}
function refreshMenuCoins() { $('m-coins').textContent = P.coins; $('shop-coins').textContent = P.coins; }

/* mouse on canvas */
cv.addEventListener('mousemove', e => {
  const r = cv.getBoundingClientRect();
  mouseX = (e.clientX - r.left) / r.width * W; mouseY = (e.clientY - r.top) / r.height * H;
  usedMouse = true;
});
cv.addEventListener('mousedown', e => {
  usedMouse = true; AU.ctx();
  if (e.button === 0) { Keys.atk = true; Keys.atkP = true; }
  if (e.button === 2) { Keys.skill = true; Keys.skillP = true; }
});
addEventListener('mouseup', e => { if (e.button === 0) Keys.atk = false; if (e.button === 2) Keys.skill = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('click', () => { if (UI.dlgQueue.length || $('dlg').classList.contains('on')) UI.advanceDlg(); });

/* -------------------------------------------------------------- net glue -- */
function onNet(m) {
  switch (m.t) {
    case 'joined': {
      G.room = m.code; G.myId = m.id; G.hostId = m.hostId; G.host = m.hostId === m.id; G.mode = m.mode;
      G.roster = m.players;
      G.players.clear();
      for (const r of m.players) {
        const h = new Hero(r.id, r.name, r.cls, r.look, r.id !== G.myId);
        G.players.set(r.id, h);
        if (r.id === G.myId) G.me = h;
      }
      if (m.started && m.startInfo && G.mode === 'story') {
        G.started = true; G.seed = m.startInfo.seed;
        UI.show('s-game'); startMissionLocal(m.startInfo.mission);
      } else { renderLobby(); UI.show('s-lobby'); }
      break;
    }
    case 'p+': {
      G.roster.push(m.p);
      G.players.set(m.p.id, new Hero(m.p.id, m.p.name, m.p.cls, m.p.look, true));
      UI.toast(m.p.name + ' has answered the call.');
      if (G.screen === 'lobby') renderLobby();
      break;
    }
    case 'p-': {
      const r = G.roster.find(x => x.id === m.id);
      G.roster = G.roster.filter(x => x.id !== m.id);
      G.players.delete(m.id);
      UI.toast((r ? r.name : 'A hero') + ' has left the field.');
      const wasHost = G.hostId === m.id;
      G.hostId = m.hostId;
      if (G.hostId === G.myId && !G.host) { if (G.started && G.screen === 'game') adoptHost(); else G.host = true; }
      if (G.mode === 'duel' && G.started && G.screen === 'game' && !G.duel.over) {
        G.duel.over = true;
        addCoins(60); G.runCoins += 60;
        showResults('Victory by Forfeit', 'Your opponent fled the field. The purse is yours.', [['Coin earned', 60]]);
        if (G.host) Net.send({ t: 'end' });
      }
      if (G.screen === 'lobby') renderLobby();
      break;
    }
    case 'started': {
      G.started = true; G.seed = m.info.seed; G.countdown = 0;
      UI.show('s-game');
      if (G.mode === 'story') startMissionLocal(m.info.mission);
      else startDuelLocal(m.info.arena);
      break;
    }
    case 'ended': G.started = false; break;
    case 'st': {
      let h = G.players.get(m.id);
      if (!h) return;
      h.tx = m.x; h.ty = m.y; h.dir = m.dir; h.hp = m.hp; h.mhp = m.mhp;
      if (h.anim !== 2 || m.anim === 2) h.anim = m.anim;
      h.downed = !!m.dn; h.dead = !!m.dd; h.blocking = !!m.bl; h.charging = !!m.ch;
      if (h.downed) h.downT = h.downT > 0 ? h.downT : 25;
      break;
    }
    case 'world': applyWorld(m); break;
    case 'ev': dispatch(m); break;
    case 'err': UI.toast(m.msg); break;
  }
}

function leaveToMenu() {
  try { if (Net.ws) Net.ws.close(); } catch (e) {}
  Net.ws = null;
  G.room = null; G.started = false; G.players.clear(); G.me = null; G.roster = [];
  G.enemies.clear(); G.projs = []; G.duel = null; G.dir = null; G.over = false;
  AU.stopAmbient();
  refreshMenuCoins();
  UI.show('s-menu');
}

/* -------------------------------------------------------------- lobby UI -- */
let lobbySel = 0;
function renderLobby() {
  $('lb-code').textContent = G.room || '····';
  const pl = $('lb-players'); pl.innerHTML = '';
  for (const r of G.roster) {
    const d = document.createElement('div'); d.className = 'lb-player';
    d.innerHTML = '<div class="lb-dot" style="color:' + CLASSES[r.cls].col + ';background:' + CLASSES[r.cls].col + '"></div>' +
      '<div class="grow"><b class="disp">' + esc(r.name) + '</b> <span class="mut small">· ' + CLASSES[r.cls].name + '</span></div>' +
      (r.id === G.hostId ? '<span class="mut small">HOST</span>' : '');
    pl.appendChild(d);
  }
  const isHost = G.hostId === G.myId;
  $('lb-host-opts').style.display = isHost ? 'block' : 'none';
  $('lb-wait').style.display = isHost ? 'none' : 'block';
  $('b-start').style.display = isHost ? 'inline-block' : 'none';
  if (isHost) {
    const list = $('lb-missions'); list.innerHTML = '';
    if (G.mode === 'story') {
      $('lb-pick-label').textContent = 'Choose the mission';
      lobbySel = Math.min(lobbySel, P.prog);
      MISSIONS.forEach((M, i) => {
        const locked = i > P.prog;
        const d = document.createElement('div');
        d.className = 'msn' + (i === lobbySel ? ' sel' : '') + (locked ? ' lock' : '');
        d.innerHTML = '<span class="n">' + ['I', 'II', 'III', 'IV', 'V', 'VI'][i] + '</span><span class="grow disp">' + M.name + '</span><span class="mut small">' + ZONES[M.zone].n + (locked ? ' · locked' : ' · ◈' + M.reward) + '</span>';
        if (!locked) d.onclick = () => { lobbySel = i; AU.ui(); renderLobby(); };
        list.appendChild(d);
      });
      $('lb-blurb').textContent = MISSIONS[lobbySel].blurb;
    } else {
      $('lb-pick-label').textContent = 'Choose the arena';
      lobbySel = Math.min(lobbySel, ARENAS.length - 1);
      ARENAS.forEach((A, i) => {
        const d = document.createElement('div');
        d.className = 'msn' + (i === lobbySel ? ' sel' : '');
        d.innerHTML = '<span class="n">' + (i + 1) + '</span><span class="grow disp">' + A.name + '</span><span class="mut small">' + ZONES[A.zone].n + '</span>';
        d.onclick = () => { lobbySel = i; AU.ui(); renderLobby(); };
        list.appendChild(d);
      });
      $('lb-blurb').textContent = 'Best of three rounds. Winner takes 110 coin, loser salvages 35.';
    }
  }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

/* --------------------------------------------------------------- menu UI -- */
function myLook() { return { c1: P.c1, c2: P.c2, c3: P.c3, helm: P.helm, cape: P.capeOn && P.own.cape, trail: P.trailOn && P.own.trail, tier: P.wep[P.cls] }; }
function ensureName() {
  P.name = $('i-name').value.trim() || P.name || 'Ashborn';
  saveProfile(); return P.name;
}
function connectAnd(fn) { AU.ctx(); Net.open(() => fn()); }

$('b-story').onclick = () => { ensureName(); connectAnd(() => Net.send({ t: 'create', mode: 'story', name: P.name, cls: P.cls, look: myLook() })); };
$('b-duel').onclick = () => { ensureName(); connectAnd(() => Net.send({ t: 'create', mode: 'duel', name: P.name, cls: P.cls, look: myLook() })); };
$('b-join').onclick = () => {
  const code = $('i-code').value.trim().toUpperCase();
  if (code.length !== 4) return UI.toast('Room codes are four characters.');
  ensureName(); connectAnd(() => Net.send({ t: 'join', code, name: P.name, cls: P.cls, look: myLook() }));
};
$('i-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('b-join').click(); });
$('b-start').onclick = () => {
  Net.send({ t: 'start', info: G.mode === 'story' ? { mission: lobbySel, seed: ri(1, 999999) } : { arena: lobbySel, seed: ri(1, 999999) } });
};
$('b-leave').onclick = () => leaveToMenu();
$('b-resume').onclick = () => $('esc').classList.remove('on');
$('b-quit').onclick = () => { $('esc').classList.remove('on'); leaveToMenu(); };
$('b-r-lobby').onclick = () => { if (G.room && Net.ws && Net.ws.readyState === 1) { renderLobby(); UI.show('s-lobby'); } else leaveToMenu(); };
$('b-r-menu').onclick = () => leaveToMenu();

document.querySelectorAll('.cls-btn').forEach(b => {
  b.onclick = () => {
    P.cls = b.dataset.cls; P.helm = helmOwned(P.helm) ? P.helm : 0; saveProfile();
    refreshClsUI(); AU.ui();
  };
});
function refreshClsUI() {
  document.querySelectorAll('.cls-btn').forEach(b => b.classList.toggle('sel', b.dataset.cls === P.cls));
  $('cls-desc').textContent = CLASSES[P.cls].desc;
}

/* ---------------------------------------------------------- customize UI -- */
const pcv = $('cv-prev'), pctx = pcv.getContext('2d');
let prevHero = null;
function refreshCustom() {
  $('i-c1').value = P.c1; $('i-c2').value = P.c2; $('i-c3').value = P.c3;
  $('helm-name').textContent = HELMS[P.cls][P.helm] + (helmOwned(P.helm) ? '' : ' 🔒');
  $('b-cape').textContent = P.own.cape ? (P.capeOn ? 'Equipped ✓' : 'Equip') : 'Locked — visit the shop';
  $('b-trail').textContent = P.own.trail ? (P.trailOn ? 'Equipped ✓' : 'Equip') : 'Locked — visit the shop';
  prevHero = new Hero(-1, P.name || 'You', P.cls, myLook(), true);
  prevHero.x = 0; prevHero.y = 0;
}
$('i-c1').oninput = e => { P.c1 = e.target.value; saveProfile(); refreshCustom(); };
$('i-c2').oninput = e => { P.c2 = e.target.value; saveProfile(); refreshCustom(); };
$('i-c3').oninput = e => { P.c3 = e.target.value; saveProfile(); refreshCustom(); };
$('b-helm-prev').onclick = () => { do { P.helm = (P.helm + 2) % 3; } while (!helmOwned(P.helm)); saveProfile(); refreshCustom(); AU.ui(); };
$('b-helm-next').onclick = () => { do { P.helm = (P.helm + 1) % 3; } while (!helmOwned(P.helm)); saveProfile(); refreshCustom(); AU.ui(); };
$('b-cape').onclick = () => { if (P.own.cape) { P.capeOn = !P.capeOn; saveProfile(); refreshCustom(); AU.ui(); } else UI.toast('The Vigil Cape waits in the shop.'); };
$('b-trail').onclick = () => { if (P.own.trail) { P.trailOn = !P.trailOn; saveProfile(); refreshCustom(); AU.ui(); } else UI.toast('The Ember Trail waits in the shop.'); };
$('b-custom').onclick = () => { ensureName(); refreshCustom(); UI.show('s-custom'); };
$('b-custom-done').onclick = () => { refreshMenuCoins(); UI.show('s-menu'); };
setInterval(() => { // preview render
  if (G.screen !== 'custom' || !prevHero) return;
  G.time += 0.05; prevHero.walkT += 0.05;
  pctx.clearRect(0, 0, 360, 280);
  pctx.save(); pctx.translate(180, 210); pctx.scale(2.1, 2.1);
  drawHeroOn(pctx, prevHero);
  pctx.restore();
}, 50);
function drawHeroOn(c2d, h) {
  const saved = ctx; ctx = c2d;
  try { drawHero(h); } finally { ctx = saved; }
}

/* --------------------------------------------------------------- shop UI -- */
function buildShop() {
  const list = $('shop-list'); list.innerHTML = '';
  const item = (nm, ds, price, state, onBuy) => {
    const d = document.createElement('div');
    d.className = 'shop-item' + (state === 'owned' || state === 'equipped' || state === 'maxed' ? ' owned' : '');
    let btn;
    if (state === 'equipped') btn = '<button disabled style="font-size:12px;padding:5px 12px">Equipped</button>';
    else if (state === 'maxed') btn = '<button disabled style="font-size:12px;padding:5px 12px">Maxed</button>';
    else if (state === 'owned') btn = '<button class="do" style="font-size:12px;padding:5px 12px">Equip</button>';
    else btn = '<button class="do" style="font-size:12px;padding:5px 12px">◈ ' + price + '</button>';
    d.innerHTML = '<div class="grow"><div class="nm">' + nm + '</div><div class="ds">' + ds + '</div></div>' + btn;
    const b = d.querySelector('.do');
    if (b) b.onclick = onBuy;
    list.appendChild(d);
  };
  // weapons for the current class
  WEAPONS[P.cls].forEach((w, i) => {
    if (i === 0) return;
    const owned = !!P.own[w.k], equipped = P.wep[P.cls] === i;
    item(w.n, CLASSES[P.cls].name + ' weapon · +' + Math.round((w.m - 1) * 100) + '% damage', w.c,
      equipped ? 'equipped' : owned ? 'owned' : 'buy',
      () => {
        if (!owned) { if (P.coins < w.c) return UI.toast('Not enough coin — the missions pay well.'); P.coins -= w.c; P.own[w.k] = true; AU.coin(); }
        P.wep[P.cls] = i; saveProfile(); buildShop(); refreshMenuCoins(); AU.ui();
      });
  });
  // armor
  ARMORS.forEach((a, i) => {
    if (i === 0) return;
    const owned = !!P.own[a.k], equipped = P.armor === i;
    item(a.n, 'Armor · +' + a.hp + ' health, ' + Math.round(a.def * 100) + '% damage taken reduced', a.c,
      equipped ? 'equipped' : owned ? 'owned' : 'buy',
      () => {
        if (!owned) { if (P.coins < a.c) return UI.toast('Not enough coin.'); P.coins -= a.c; P.own[a.k] = true; AU.coin(); }
        P.armor = i; saveProfile(); buildShop(); refreshMenuCoins(); AU.ui();
      });
  });
  // stat training
  UPGRADES.forEach(u => {
    const r = P.up[u.k];
    item(u.n + '  ·  rank ' + r + '/' + u.max, u.d, u.c, r >= u.max ? 'maxed' : 'buy',
      () => {
        if (P.up[u.k] >= u.max) return;
        if (P.coins < u.c) return UI.toast('Not enough coin.');
        P.coins -= u.c; P.up[u.k]++; saveProfile(); buildShop(); refreshMenuCoins(); AU.coin();
      });
  });
  // cosmetics
  COSMETICS.forEach(c => {
    const owned = !!P.own[c.k];
    item(c.n, c.d, c.c, owned ? 'owned' : 'buy',
      () => {
        if (owned) { // "equip" from shop just routes to customize
          if (c.k === 'cape') { P.capeOn = true; } if (c.k === 'trail') { P.trailOn = true; }
          saveProfile(); UI.toast('Equipped — see it in Customize.'); return;
        }
        if (P.coins < c.c) return UI.toast('Not enough coin.');
        P.coins -= c.c; P.own[c.k] = true;
        if (c.k === 'cape') P.capeOn = true; if (c.k === 'trail') P.trailOn = true;
        saveProfile(); buildShop(); refreshMenuCoins(); AU.coin();
      });
  });
}
$('b-shop').onclick = () => { ensureName(); buildShop(); refreshMenuCoins(); UI.show('s-shop'); };
$('b-shop-done').onclick = () => { refreshMenuCoins(); UI.show('s-menu'); };

/* --------------------------------------------------------- chronicle UI -- */
const CHRONICLE = {
  tabs: ['The World', 'The Factions', 'The Faces', 'The Missions'],
  data: [
    // ---- TAB 0: THE WORLD ----
    [
      { title: 'Aldermere', unlock: -1,
        text: 'Aldermere was sung into being — so the old faith claims — by a god who died before the hymn was done. For an age the unfinished song slept under the Cathedral of Ash, and the world grew over it like moss over a grave. Kingdoms rose, the Ember Vigil swore its oaths, the College of mages built its towers, and the god\'s silence was mistaken for peace.',
        who: 'Archivist Senna', quote: 'The old texts do not call it creation. They call it an interruption. The hymn was not finished — the world is what grew in the pause.' },
      { title: 'The Unfinished Hymn', unlock: -1,
        text: 'The hymn is not music in any mortal sense. It is the fundamental vibration of Aldermere — the resonance that holds earth to sky, water to shore, the living to the dead. As long as it remained incomplete, it held the world in a kind of waking equilibrium. But something beneath the Cathedral of Ash has begun to sing the missing verses, and the song is wrong. The dead rise on its rhythm. The marshes walk. Stone remembers how to scream.',
        who: 'Archivist Senna', quote: 'Listen, under the wind. A rhythm. The raids fall on the same beat, like a drum counting something down.' },
      { title: 'The Rising', unlock: 0,
        text: 'It began with small signs — livestock found standing dead, facing east. Wells that hummed at midnight. Then the marshes gave up their dead, and the dead marched in step, in time, toward the Cathedral. Villages burned. The Vigil\'s garrison forts went silent one by one. Now the hymn can be heard by anyone who stands still long enough in the open air. It gets louder every day.' },
      { title: 'The Reliquary Fragment', unlock: 1,
        text: 'In the ruins of the burned College, Archivist Senna found the last surviving transcription of the true hymn — the god\'s original melody, as it was meant to be sung. It is not a song of ending. It was meant to be a lullaby: a song to put a restless world gently to sleep, not to obliterate it. The Cantor\'s version is a corruption, howling where the original whispered.',
        who: 'Archivist Senna', quote: 'The fragment, Cantor — I have read it. It does not end in sleep. You have been singing it wrong.' },
      { title: 'The Silence After', unlock: 5,
        text: 'With the Cantor silenced and the true verse sung, the hymn completes at last — not as an ending, but as a settling. The dead lie down. The marshes go still. Dawn breaks in a color no one alive remembers seeing. Aldermere is not saved so much as it is finally, properly, awake.',
        who: 'Warden Ashe', quote: 'Look east. I had forgotten dawn could be that color.' }
    ],
    // ---- TAB 1: THE FACTIONS ----
    [
      { title: 'The Ember Vigil', unlock: -1,
        text: 'A knightly order founded in the age after the god\'s death, sworn to guard the Cathedral of Ash and ensure the hymn was never disturbed. Over centuries the oath became ceremonial, then political, then forgotten. When the hymn woke, fewer than forty knights still held the crest. Warden Ashe leads the last of them — underfunded, under-armed, and answering a call most of Aldermere no longer remembers making.',
        who: 'A villager', quote: 'You… you came. The Vigil came. We thought the old orders were stories.' },
      { title: 'The Scattered College', unlock: -1,
        text: 'The College of mages once stood at Ashenmere, a mile from the Cathedral. It was burned in the Doctrinal Wars — a conflict between mages who wanted to study the hymn and those who wanted it buried. The survivors scattered, taking what fragments of knowledge they could carry. Archivist Senna is one of the last who can still read the old notation. The Vigil and the College have a long, bitter history. Necessity has made them allies.',
        who: 'Archivist Senna', quote: 'The College burned because we asked too many questions. Now the world burns because we stopped.' },
      { title: 'The Ashen Choir', unlock: 2,
        text: 'Not all who hear the hymn resist it. The Choir is a cult of those who believe the god\'s death was a tragedy and that completing the song will bring it back — or at least bring the mercy of ending. They wear ash-colored robes and carry the hymn\'s resonance in crystal foci. Their cultists are fanatics, not soldiers, but fanaticism has its own kind of strength. Captain Maro\'s defection gave them a military arm.',
        who: 'Captain Maro', quote: 'The song is going to finish with us or without us. I chose WITH.' },
      { title: 'The Risen', unlock: 2,
        text: 'The walking dead of Aldermere are not undead in the traditional sense. They are echoes — the hymn remembers everyone who ever died within earshot of it, and the corrupted verses call those memories back into their bones. They do not think. They do not hunger. They simply march, in perfect time, toward the Cathedral. Breaking the resonance stones deafens the local dead to the call, but only silencing the singer will stop the rising for good.' }
    ],
    // ---- TAB 2: THE FACES ----
    [
      { title: 'Warden Ashe', unlock: -1,
        text: 'The last Warden of the Ember Vigil. A career soldier who took a ceremonial post and found it suddenly, terrifyingly real. Ashe is not a strategist or a philosopher — she is a woman who made an oath and will not be the one to break it. She trained under Captain Maro, and his betrayal is the wound she does not speak about.',
        who: 'Warden Ashe', quote: 'Stories are what\'s left when duty is forgotten.' },
      { title: 'Archivist Senna', unlock: -1,
        text: 'The last scholar of the Scattered College who can read the old hymnal notation. Brilliant, impatient, and deeply frightened — though she hides it behind academic detachment. She carries the reliquary fragment like a surgeon carries a scalpel: knowing it could save or kill, depending on steadiness of hand. She does not trust the Vigil, but she trusts the alternative less.',
        who: 'Archivist Senna', quote: 'The old texts do not call it creation. They call it an interruption.' },
      { title: 'Captain Maro, the Turncoat', unlock: 3,
        text: 'Once the finest officer in the Vigil, Maro heard the hymn before anyone else — a side effect of standing too many night watches at the Cathedral. It did not drive him mad. It showed him what he believes is truth: that the world is a wound left by a god\'s unfinished death, and that completing the song is mercy, not destruction. He defected to the Choir and gave them Fort Merrow, the only pass to the Cathedral. He is not a villain. He is a man who heard something he cannot unhear.',
        who: 'Warden Ashe', quote: 'He smiled at the end. Like a man who\'d heard the last note early.' },
      { title: 'The Cantor', unlock: 5,
        text: 'No one knows what the Cantor was before the hymn claimed it. A priest, perhaps, or a scholar — someone who found the sleeping song in the Cathedral\'s deepest crypt and tried to finish it. What sits in the Sanctum now is barely human: a figure wrapped in its own voice, surrounded by orbiting resonance shards, singing a verse that was never meant to be sung aloud. Its tragedy is that it believes it is being kind. It thinks it is singing a lullaby for a world that has suffered long enough. It is wrong — but it does not know that.',
        who: 'The Cantor', quote: 'You bring swords to a lullaby. I only mean to finish the song and let Aldermere finally sleep.' }
    ],
    // ---- TAB 3: THE MISSIONS ----
    [
      { title: 'I · Embers at Dusk', unlock: 0, zone: 0,
        text: 'Hearthfen village, at the edge of the Gravemarsh, burns at dusk. Goblins and bandits strike in waves — but Senna notices they attack on a rhythm, in time with something deeper. The Vigil holds the square and discovers that the raids are not random: they are synchronized with the hymn. This is not chaos. This is a beat.' },
      { title: 'II · The Hollow Road', unlock: 1, zone: 1,
        text: 'Senna\'s reliquary cart must reach safety. The cart carries the College\'s last relic: the original fragment of the hymn, transcribed before the College burned. The road through the forest is long, the ambushes are frequent, and the cart is fragile. If the fragment is lost, there is no correcting the Cantor\'s corrupted verse.' },
      { title: 'III · Gravemarsh', unlock: 2, zone: 2,
        text: 'The marshes have given up their dead. They do not wander — they march, in step, toward the Cathedral. The old ward-beacons can deafen this stretch of ground to the hymn, but lighting them means standing still while the dead close in. Three beacons, three chances to hold your nerve.' },
      { title: 'IV · The Turncoat Garrison', unlock: 3, zone: 3,
        text: 'Fort Merrow guards the only pass to the Cathedral. Captain Maro holds it for the Choir. He was Ashe\'s mentor. He is not afraid and he is not weak — he is a man who heard the hymn and made his choice. The fort must be breached, the garrison broken, and Maro faced. There is no path to the Cantor that does not go through him.' },
      { title: 'V · Choir of Ash', unlock: 4, zone: 4,
        text: 'Inside the burned Cathedral, three resonance stones carry the hymn outward across Aldermere like bells. Every risen corpse, every marching dead, every trembling ward-beacon is being driven by these stones. Shatter them, and the Cantor\'s reach shrinks to the Sanctum itself. The choir\'s guards will not let you touch them quietly.' },
      { title: 'VI · The Last Hymn', unlock: 5, zone: 5,
        text: 'The Sanctum. The singer. The end of the song. The Cantor does not believe it is a monster — it believes it is a mercy. Senna carries the true fragment. If the Cantor can be silenced, the correct verse can be sung, and the hymn can finally complete as it was meant to: not as an ending, but as a waking. The god\'s lullaby, finished at last.',
        who: 'The Cantor', quote: 'Then come. Correct me.' }
    ]
  ]
};

let chrTab = 0;
function buildChronicle() {
  const tabs = $('chr-tabs'); tabs.innerHTML = '';
  CHRONICLE.tabs.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'chr-tab' + (i === chrTab ? ' sel' : '');
    b.textContent = name;
    b.onclick = () => { chrTab = i; AU.ui(); buildChronicle(); };
    tabs.appendChild(b);
  });
  const scroll = $('chr-scroll'); scroll.innerHTML = '';
  const entries = CHRONICLE.data[chrTab];
  for (const e of entries) {
    const unlocked = e.unlock < 0 || P.prog >= e.unlock;
    const d = document.createElement('div');
    d.className = 'chr-entry' + (unlocked ? '' : ' locked');
    let html = '<h3>' + (unlocked ? e.title : e.title.replace(/[^·IVX\s\d]/g, '?').slice(0, 20) + '…') + '</h3>';
    if (unlocked) {
      html += '<p>' + e.text + '</p>';
      if (e.who && e.quote) html += '<div class="chr-who">' + esc(e.who) + '</div><div class="chr-quote">\u201C' + esc(e.quote) + '\u201D</div>';
    } else {
      html += '<p style="font-style:italic; color:var(--mut)">Complete more missions to reveal this entry.</p>';
    }
    d.innerHTML = html;
    scroll.appendChild(d);
  }
}

$('b-chronicle').onclick = () => { chrTab = 0; buildChronicle(); UI.show('s-chronicle'); AU.ui(); };
$('b-chr-done').onclick = () => UI.show('s-menu');

/* ------------------------------------------------------- title screen fx -- */
const tcv = $('title-cv'), tctx = tcv.getContext('2d');
const tEmbers = [];
function titleLoop() {
  requestAnimationFrame(titleLoop);
  if (G.screen === 'game') return;
  const w = tcv.offsetWidth || 600, h = tcv.offsetHeight || 240;
  if (tcv.width !== w) { tcv.width = w; tcv.height = h; }
  tctx.clearRect(0, 0, w, h);
  if (tEmbers.length < 36 && Math.random() < 0.4) tEmbers.push({ x: rnd(0, w), y: h + 8, vy: rnd(18, 46), s: rnd(1, 3), o: rnd(0.3, 0.85), ph: rnd(0, 9) });
  for (let i = tEmbers.length - 1; i >= 0; i--) {
    const p = tEmbers[i];
    p.y -= p.vy * 0.016; p.x += Math.sin(Date.now() / 700 + p.ph) * 0.4;
    p.o -= 0.0016;
    if (p.y < -8 || p.o <= 0) { tEmbers.splice(i, 1); continue; }
    tctx.fillStyle = 'rgba(255,140,63,' + p.o + ')';
    tctx.beginPath(); tctx.arc(p.x, p.y, p.s, 0, TAU); tctx.fill();
  }
}
requestAnimationFrame(titleLoop);

/* ------------------------------------------------------------------ boot -- */
loadProfile();
$('i-name').value = P.name || '';
$('i-name').addEventListener('change', () => { P.name = $('i-name').value.trim().slice(0, 14); saveProfile(); });
if (!helmOwned(P.helm)) P.helm = 0;
refreshClsUI();
refreshMenuCoins();
