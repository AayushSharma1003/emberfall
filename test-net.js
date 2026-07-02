const WebSocket = require('ws');
const log = [];
function client(name) {
  const ws = new WebSocket('ws://localhost:3000');
  ws.msgs = [];
  ws.on('message', d => { const m = JSON.parse(d); ws.msgs.push(m); log.push(name + ' <- ' + m.t + (m.k ? ':' + m.k : '')); });
  return new Promise(res => ws.on('open', () => res(ws)));
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const a = await client('A');
  a.send(JSON.stringify({ t: 'create', mode: 'story', name: 'Aayush', cls: 'knight', look: { c1: '#fff' } }));
  await wait(200);
  const joined = a.msgs.find(m => m.t === 'joined');
  console.log('A joined:', JSON.stringify(joined));
  const code = joined.code;

  const b = await client('B');
  b.send(JSON.stringify({ t: 'join', code, name: 'Friend', cls: 'mage', look: {} }));
  await wait(200);
  console.log('B joined:', JSON.stringify(b.msgs.find(m => m.t === 'joined')));
  console.log('A saw p+:', !!a.msgs.find(m => m.t === 'p+'));

  // non-host tries to start (should be ignored), then host starts
  b.send(JSON.stringify({ t: 'start', info: { mission: 0, seed: 42 } }));
  await wait(150);
  console.log('start blocked for non-host:', !a.msgs.find(m => m.t === 'started'));
  a.send(JSON.stringify({ t: 'start', info: { mission: 0, seed: 42 } }));
  await wait(150);
  console.log('both got started:', !!a.msgs.find(m => m.t === 'started'), !!b.msgs.find(m => m.t === 'started'));

  // relay st + ev + world
  a.send(JSON.stringify({ t: 'st', x: 100, y: 500, dir: 1, hp: 150, mhp: 150, anim: 1 }));
  a.send(JSON.stringify({ t: 'world', e: [['e1_1', 0, 300, 500, 32, 32, 0, -1, 0]], o: [], ot: 'Repel', boss: 0, bt: 0 }));
  b.send(JSON.stringify({ t: 'ev', k: 'hitE', eid: 'e1_1', dmg: 10, kb: 100, dir: 1 }));
  await wait(200);
  console.log('B got st:', !!b.msgs.find(m => m.t === 'st' && m.x === 100));
  console.log('B got world:', !!b.msgs.find(m => m.t === 'world'));
  console.log('A got hitE ev with sender id:', JSON.stringify(a.msgs.find(m => m.t === 'ev')));

  // wrong room join
  const c = await client('C');
  c.send(JSON.stringify({ t: 'join', code: 'ZZZZ', name: 'X', cls: 'ranger', look: {} }));
  await wait(150);
  console.log('bad code err:', JSON.stringify(c.msgs.find(m => m.t === 'err')));

  // host disconnect -> migration
  a.close();
  await wait(300);
  const pm = b.msgs.find(m => m.t === 'p-');
  console.log('B saw p- with new host = B:', JSON.stringify(pm));

  // late join into started story room
  c.send(JSON.stringify({ t: 'join', code, name: 'Late', cls: 'ranger', look: {} }));
  await wait(200);
  const lj = c.msgs.filter(m => m.t === 'joined')[0];
  console.log('late join got started+startInfo:', lj && lj.started, JSON.stringify(lj && lj.startInfo));
  b.close(); c.close();
  process.exit(0);
})();
