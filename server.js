import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const W = 360, H = 640, TOP = 46, MAG = 30;
const STEP = 1 / 30, SNAPSHOT_STEP = 1 / 20;
const MAX_PLAYERS = 4, MAX_FISH = 40, MAX_BULLETS = 150;
const TYPES = {
  normal: { hp: 2, sp: 45, size: 13, pts: 10, dmg: 8 },
  fast: { hp: 1, sp: 90, size: 9, pts: 15, dmg: 6 },
  tank: { hp: 7, sp: 30, size: 21, pts: 40, dmg: 16 },
  puffer: { hp: 4, sp: 38, size: 15, pts: 25, dmg: 10 },
  elite: { hp: 12, sp: 52, size: 17, pts: 120, dmg: 12 }
};
const WEAPONS = {
  pistol: { cd: .12, dmg: 1, pellets: 1, spread: .03, speed: 520, life: .8, col: '#ffcf4d' },
  smg: { cd: .055, dmg: 1, pellets: 1, spread: .1, speed: 560, life: .8, dur: 20, col: '#ffe27a' },
  shotgun: { cd: .5, dmg: 1, pellets: 7, spread: .55, speed: 470, life: .35, dur: 20, col: '#ff9f4d' },
  rifle: { cd: .17, dmg: 3, pellets: 1, spread: .01, speed: 780, life: .9, dur: 20, pierce: 2, col: '#7dffb0' },
  rpg: { cd: .9, dmg: 0, pellets: 1, spread: .01, speed: 270, life: 2.2, dur: 15, boom: 62, boomDmg: 14, col: '#ff6a3d' }
};
const BUFFS = {
  dmg: { dur: 15 }, rapid: { dur: 15 }, speed: { dur: 15 }, regen: { dur: 12 },
  multi: { dur: 15 }, inf: { dur: 15 }, berserk: { dur: 12, boss: true },
  god: { dur: 8, boss: true }, vamp: { dur: 15, boss: true }, titan: { dur: 15, boss: true }
};
const NORMAL_BUFFS = Object.keys(BUFFS).filter(k => !BUFFS[k].boss);
const BOSS_BUFFS = Object.keys(BUFFS).filter(k => BUFFS[k].boss);
const ATKS = ['poison', 'lightning', 'bubble', 'grenade'];
const DESIGNS = ['angler', 'puffer', 'sword', 'shark', 'eel', 'piranha', 'manta'];
const BOSS_NAME = { angler: 'ราชาปลาตกเบ็ด', puffer: 'ปักเป่ายักษ์', sword: 'ปลาดาบพิฆาต', shark: 'ฉลามบกจอมโหด', eel: 'งูปลาไฟฟ้า', piranha: 'ราชาปิรันย่า', manta: 'กระเบนมรณะ' };
const BOSS_HUE = { angler: 230, puffer: 40, sword: 200, shark: 205, eel: 150, piranha: 0, manta: 280 };
const rooms = new Map();
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clampX = x => clamp(x, 20, W - 20);
const clampY = y => clamp(y, TOP + 20, H - 20);
const hsl = (h, s, l) => `hsla(${Math.round(((h % 360) + 360) % 360)},${s}%,${l}%,1)`;
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const cleanCode = v => String(v || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
const cleanName = v => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'ผู้เล่น';
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = prefix => `${prefix}_${randomUUID().slice(0, 8)}`;
const alivePlayers = room => [...room.players.values()].filter(p => p.alive && p.connected);
const nearestPlayer = (room, x, y) => {
  let best = null, distance = Infinity;
  for (const p of alivePlayers(room)) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < distance) { distance = d; best = p; }
  }
  return best;
};
function emitFx(room, type, data = {}) {
  io.to(room.code).volatile.emit('fx', { type, at: Date.now(), ...data });
}
function systemChat(room, text) {
  io.to(room.code).emit('chat', { id: randomUUID(), from: 'ระบบ', text: String(text).slice(0, 180), system: true, at: Date.now() });
}
function makeRoom(code, options = {}) {
  const room = {
    code, players: new Map(), fish: [], boss: null, bullets: [], eproj: [], strikes: [], nades: [], pickups: [],
    score: 0, wave: clamp(Math.floor(finite(options.startWave, 1)), 1, 999), time: 0, tick: 0,
    bossEvery: clamp(Math.floor(finite(options.bossEvery, 25)), 1, 100), spawnQ: 0, spawnT: 0,
    waveDelay: 0, isBossWave: false, snapshotT: 0, bossBag: [], usedSets: [], lastDesign: null, bossCount: 0,
    emptyT: 0
  };
  startWave(room);
  rooms.set(code, room);
  return room;
}
function makePlayer(id, socketId, name, slot) {
  return {
    id, socketId, name, slot, connected: true, disconnectT: 0, x: W / 2 + ((slot % 3) - 1) * 32,
    y: H - 120 - Math.floor(slot / 3) * 28, r: 13, hp: 100, armor: 0, aim: -Math.PI / 2,
    cd: 0, hurt: 0, flash: 0, buffs: {}, weapon: null, poison: 0, poisonMax: 5, poisonTick: 0,
    stun: 0, stunMax: 1.3, ammo: MAG, reloadT: 0, alive: true, respawnT: 0, score: 0,
    input: { mx: 0, my: 0, aim: -Math.PI / 2, fire: false, reload: false, auto: true, seq: 0 }, lastChat: 0
  };
}
function startWave(room) {
  room.isBossWave = room.wave % room.bossEvery === 0;
  const count = Math.max(1, room.players.size);
  room.spawnQ = room.isBossWave ? Math.min(6 + (count - 1) * 2, 18) : Math.min(5 + room.wave * 2 + (count - 1) * 3, 48);
  room.spawnT = room.isBossWave ? 3 : .5;
  room.waveDelay = 0;
  if (room.isBossWave) spawnBoss(room);
}
function spawnFish(room) {
  if (room.fish.length >= MAX_FISH) return;
  const r = Math.random(); let t = 'normal';
  if (room.wave >= 3 && r < .05) t = 'elite';
  else if (room.wave >= 3 && r < .17) t = 'tank';
  else if (room.wave >= 5 && r < .29) t = 'puffer';
  else if (room.wave >= 2 && r < .55) t = 'fast';
  const d = TYPES[t], side = (Math.random() * 3) | 0;
  let x, y;
  if (side === 0) { x = rand(0, W); y = TOP - 20; } else if (side === 1) { x = -20; y = rand(TOP, H); } else { x = W + 20; y = rand(TOP, H); }
  let h = rand(0, 360);
  if (t === 'fast') h = rand(10, 60); else if (t === 'tank') h = rand(250, 320); else if (t === 'puffer') h = rand(35, 75);
  const hp = d.hp + Math.floor(room.wave / 8);
  room.fish.push({
    id: uid('f'), t, x, y, hp, max: hp, ang: 0, ph: rand(0, 6), kb: 0, kx: 0, ky: 0,
    sp: d.sp * (1 + Math.min(room.wave, 40) * .03) * rand(.9, 1.1), size: d.size * rand(.9, 1.12),
    elite: t === 'elite', puffer: t === 'puffer', c1: t === 'elite' ? '#e0a800' : hsl(h, 65, 48),
    pattern: (Math.random() * 4) | 0, tail: (Math.random() * 3) | 0, fin: (Math.random() * 3) | 0
  });
}
function pickDesign(room) {
  if (!room.bossBag.length) room.bossBag = shuffle(DESIGNS.slice());
  let d = room.bossBag.pop();
  if (d === room.lastDesign && room.bossBag.length) { const e = room.bossBag.pop(); room.bossBag.push(d); d = e; }
  room.lastDesign = d;
  return d;
}
function pickAttacks(room, n) {
  let set, key, tries = 0;
  do { set = shuffle(ATKS.slice()).slice(0, n); key = set.slice().sort().join(); tries++; } while (room.usedSets.includes(key) && tries < 20);
  room.usedSets.push(key);
  return set;
}
function spawnBoss(room) {
  room.bossCount++;
  const n = Math.max(1, Math.floor(room.wave / room.bossEvery));
  const design = pickDesign(room), size = 40 + 7 * Math.min(n - 1, 6);
  const na = Math.min(4, 2 + (n >= 3 ? 1 : 0) + (n >= 5 ? 1 : 0));
  const scale = 1 + Math.max(0, room.players.size - 1) * .35;
  const hp = Math.round(150 * Math.pow(1.7, n - 1) * scale);
  room.boss = {
    id: uid('boss'), design, hue: BOSS_HUE[design] + rand(-25, 25), x: W / 2, y: TOP - size, size, r: size * .85,
    hp, max: hp, sp: Math.min(60, 26 + 6 * n), ang: Math.PI / 2, ph: 0, hit: 0, atk: 2.5, n,
    attacks: pickAttacks(room, na), enraged: false, intro: true, name: BOSS_NAME[design]
  };
  emitFx(room, 'boss', { name: room.boss.name, attacks: room.boss.attacks });
}
function mouth(b) { return { x: b.x + Math.cos(b.ang) * b.size * .9, y: b.y + Math.sin(b.ang) * b.size * .9 }; }
function bossAttack(room, b) {
  const target = nearestPlayer(room, b.x, b.y);
  if (!target) return;
  const k = pickOne(b.attacks), m = mouth(b), a = Math.atan2(target.y - m.y, target.x - m.x);
  if (k === 'bubble') {
    const n = 3 + Math.min(b.n, 3);
    for (let i = 0; i < n; i++) { const an = a + (i - (n - 1) / 2) * .3; room.eproj.push({ id: uid('e'), type: 'bubble', x: m.x, y: m.y, vx: Math.cos(an) * 85, vy: Math.sin(an) * 85, r: 10, life: 7, ph: rand(0, 6) }); }
  } else if (k === 'poison') {
    for (let i = 0; i < 3; i++) { const an = a + (i - 1) * .22; room.eproj.push({ id: uid('e'), type: 'poison', x: m.x, y: m.y, vx: Math.cos(an) * 135, vy: Math.sin(an) * 135, r: 8, life: 4, ph: 0 }); }
  } else if (k === 'lightning') {
    const n = 2 + Math.min(b.n, 3);
    for (let i = 0; i < n; i++) room.strikes.push({ id: uid('s'), x: i === 0 ? target.x : clampX(target.x + rand(-110, 110)), y: i === 0 ? target.y : clampY(target.y + rand(-110, 110)), t: 0, T: 1, fired: false, pts: null, flash: 0 });
  } else if (k === 'grenade') {
    const n = 1 + (b.n >= 2 ? 1 : 0) + (b.n >= 4 ? 1 : 0);
    for (let i = 0; i < n; i++) room.nades.push({ id: uid('n'), sx: m.x, sy: m.y, tx: clampX(target.x + (i ? rand(-80, 80) : 0)), ty: clampY(target.y + (i ? rand(-80, 80) : 0)), t: 0, T: 1 });
  }
}
function hurt(room, p, amount, bypass = false) {
  if (!p.alive || p.buffs.god) return;
  let d = amount * (p.buffs.titan ? .4 : 1);
  if (!bypass && p.armor > 0) { const absorbed = Math.min(p.armor, d); p.armor -= absorbed; d -= absorbed; }
  p.hp -= d;
  if (p.hp <= 0) {
    p.hp = 0; p.alive = false; p.respawnT = 5; p.input.fire = false; p.input.mx = p.input.my = 0;
    emitFx(room, 'playerDown', { id: p.id, name: p.name, x: p.x, y: p.y });
  }
}
function stun(p, t) { if (!p.buffs.god) { p.stun = Math.max(p.stun, t); p.stunMax = t; } }
function poison(p, t) { if (!p.buffs.god) { p.poison = t; p.poisonMax = t; } }
function addPickup(room, kind, key, x, y, life = 10) {
  if (room.pickups.length >= 80) return;
  room.pickups.push({ id: uid('i'), kind, key, x: clamp(x, 14, W - 14), y: clamp(y, TOP + 14, H - 14), life, max: life });
}
function dropRandom(room, x, y) {
  const r = Math.random();
  if (r < .28) addPickup(room, 'heart', 'heart', x, y);
  else if (r < .5) addPickup(room, 'armor', 'armor', x, y);
  else if (r < .78) addPickup(room, 'buff', pickOne(NORMAL_BUFFS), x, y);
  else addPickup(room, 'weapon', pickOne(['smg', 'shotgun', 'rifle']), x, y);
}
function dropFrom(room, f) {
  if (f.elite) {
    if (Math.random() < .4) addPickup(room, 'weapon', 'rpg', f.x, f.y, 14); else dropRandom(room, f.x, f.y);
    if (Math.random() < .5) dropRandom(room, f.x + 14, f.y + 6);
  } else if (Math.random() < .14) dropRandom(room, f.x, f.y);
}
function collect(room, p, k) {
  if (k.kind === 'heart') p.hp = Math.min(100, p.hp + 25);
  else if (k.kind === 'armor') p.armor = Math.min(100, p.armor + 40);
  else if (k.kind === 'weapon') { p.weapon = { key: k.key, t: WEAPONS[k.key].dur, max: WEAPONS[k.key].dur }; p.reloadT = 0; }
  else if (BUFFS[k.key]) p.buffs[k.key] = { t: BUFFS[k.key].dur, max: BUFFS[k.key].dur };
  emitFx(room, 'pickup', { playerId: p.id, kind: k.kind, key: k.key, x: k.x, y: k.y });
}
function killFish(room, f) {
  room.score += TYPES[f.t].pts;
  const owner = f.lastHit && room.players.get(f.lastHit);
  if (owner) owner.score += TYPES[f.t].pts;
  dropFrom(room, f);
  emitFx(room, 'fishDown', { x: f.x, y: f.y, color: f.c1, elite: f.elite });
}
function killBoss(room) {
  const b = room.boss;
  if (!b) return;
  room.boss = null;
  room.score += 1000 * b.n;
  const owner = b.lastHit && room.players.get(b.lastHit);
  if (owner) owner.score += 1000 * b.n;
  const bb = shuffle(BOSS_BUFFS.slice()).slice(0, 3);
  bb.forEach((k, i) => { const a = i / 3 * 6.283 + rand(0, 1); addPickup(room, 'buff', k, b.x + Math.cos(a) * 45, b.y + Math.sin(a) * 45, 18); });
  addPickup(room, 'heart', 'heart', b.x - 20, b.y + 40, 18);
  addPickup(room, 'armor', 'armor', b.x + 20, b.y + 40, 18);
  if (Math.random() < .6) addPickup(room, 'weapon', 'rpg', b.x, b.y - 40, 18);
  room.eproj = []; room.strikes = []; room.nades = [];
  emitFx(room, 'bossDown', { x: b.x, y: b.y, name: b.name });
}
function boom(room, x, y, r, dmg, owner) {
  emitFx(room, 'boom', { x, y, r });
  for (const f of room.fish) if (f.hp > 0 && Math.hypot(f.x - x, f.y - y) < r + f.size) {
    f.hp -= dmg; f.lastHit = owner; f.kb = .2; const a = Math.atan2(f.y - y, f.x - x); f.kx = Math.cos(a) * 200; f.ky = Math.sin(a) * 200;
  }
  const b = room.boss;
  if (b && Math.hypot(b.x - x, b.y - y) < r + b.r) { b.hp -= dmg; b.lastHit = owner; b.hit = .1; }
  for (const e of room.eproj) if (e.type === 'bubble' && Math.hypot(e.x - x, e.y - y) < r) e.life = 0;
}
function nearestTarget(room, p) {
  let best = null, distance = Infinity;
  for (const f of room.fish) {
    if (f.hp <= 0 || f.y < TOP - 10) continue;
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (d < distance) { distance = d; best = f; }
  }
  const b = room.boss;
  if (b && !b.intro) { const d = Math.hypot(b.x - p.x, b.y - p.y) - b.r; if (d < distance) best = b; }
  return best;
}
function shoot(room, p) {
  if (room.bullets.length >= MAX_BULLETS) return;
  const w = p.weapon ? WEAPONS[p.weapon.key] : WEAPONS.pistol;
  const dm = (p.buffs.dmg ? 2 : 1) * (p.buffs.berserk ? 3 : 1) * (p.buffs.titan ? 1.5 : 1);
  const rate = (p.buffs.rapid ? 1.7 : 1) * (p.buffs.berserk ? 2 : 1);
  const aims = [];
  for (let i = 0; i < w.pellets; i++) aims.push(p.aim + (w.pellets > 1 ? ((i - (w.pellets - 1) / 2) / (w.pellets - 1)) * w.spread + rand(-.04, .04) : rand(-w.spread, w.spread)));
  if (p.buffs.multi) aims.push(p.aim - .25, p.aim + .25);
  for (const a of aims) room.bullets.push({
    id: uid('b'), owner: p.id, x: p.x + Math.cos(a) * 22, y: p.y + Math.sin(a) * 22,
    vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, life: w.life, dmg: w.dmg * dm,
    pierce: w.pierce || 0, boom: w.boom || 0, boomDmg: (w.boomDmg || 0) * dm, hits: [], col: w.col, exp: false
  });
  if (!p.weapon && !p.buffs.inf) { p.ammo--; if (p.ammo <= 0) p.reloadT = 1.1; }
  p.cd = w.cd / rate; p.flash = .06;
}
function updatePlayer(room, p, dt) {
  if (!p.connected) {
    p.disconnectT -= dt;
    return;
  }
  if (!p.alive) {
    p.respawnT -= dt;
    if (p.respawnT <= 0) {
      p.alive = true; p.hp = 100; p.armor = 25; p.x = W / 2 + rand(-45, 45); p.y = H - 110;
      p.poison = p.stun = 0; p.buffs = { god: { t: 2, max: 2 } }; p.ammo = MAG; p.reloadT = 0;
      emitFx(room, 'respawn', { id: p.id, x: p.x, y: p.y });
    }
    return;
  }
  p.cd -= dt; p.flash -= dt; p.hurt -= dt;
  for (const k of Object.keys(p.buffs)) { p.buffs[k].t -= dt; if (p.buffs[k].t <= 0) delete p.buffs[k]; }
  if (p.weapon) { p.weapon.t -= dt; if (p.weapon.t <= 0) p.weapon = null; }
  if (p.buffs.regen) p.hp = Math.min(100, p.hp + 4 * dt);
  if (p.poison > 0) {
    p.poison -= dt; p.poisonTick -= dt;
    if (p.poisonTick <= 0) { p.poisonTick = .5; hurt(room, p, 2, true); }
  }
  if (!p.alive) return;
  if (p.stun > 0) p.stun -= dt;
  const input = p.input;
  if (input.auto) {
    const target = nearestTarget(room, p);
    if (target) input.aim = Math.atan2(target.y - p.y, target.x - p.x);
  }
  p.aim = input.aim;
  if (p.stun <= 0) {
    let mx = input.mx, my = input.my;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const speed = 125 * (p.buffs.speed ? 1.4 : 1);
    p.x = clamp(p.x + mx * speed * dt, p.r, W - p.r);
    p.y = clamp(p.y + my * speed * dt, TOP + p.r, H - p.r);
  }
  if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) p.ammo = MAG; }
  if (input.reload && !p.weapon && p.reloadT <= 0 && p.ammo < MAG) p.reloadT = 1.1;
  input.reload = false;
  const canFire = p.weapon || p.buffs.inf || (p.reloadT <= 0 && p.ammo > 0);
  if (p.stun <= 0 && input.fire && p.cd <= 0 && canFire) shoot(room, p);
}
function updateRoom(room, dt) {
  room.time += dt; room.tick++;
  for (const p of room.players.values()) updatePlayer(room, p, dt);
  for (const [id, p] of room.players) if (!p.connected && p.disconnectT <= 0) {
    room.players.delete(id);
    systemChat(room, `${p.name} ออกจากห้องแล้ว`);
  }
  if (!room.players.size) { room.emptyT += dt; if (room.emptyT > 20) { rooms.delete(room.code); return; } } else room.emptyT = 0;
  if (room.spawnQ > 0 && alivePlayers(room).length) {
    room.spawnT -= dt;
    if (room.spawnT <= 0) { spawnFish(room); room.spawnQ--; room.spawnT = room.isBossWave ? 2.2 : Math.max(.25, .9 - room.wave * .05); }
  } else if (!room.spawnQ && !room.fish.length && !room.boss && alivePlayers(room).length) {
    room.waveDelay += dt;
    if (room.waveDelay > 2) { room.wave++; startWave(room); emitFx(room, 'wave', { wave: room.wave, boss: room.isBossWave }); }
  }
  for (const b of room.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.x < -10 || b.x > W + 10 || b.y < TOP - 10 || b.y > H + 10) b.life = Math.min(b.life, 0);
    const hitTarget = t => {
      b.hits.push(t.id);
      if (b.boom) { b.exp = true; b.life = 0; boom(room, b.x, b.y, b.boom, b.boomDmg, b.owner); return; }
      t.hp -= b.dmg; t.lastHit = b.owner;
      if (t === room.boss) t.hit = .08; else { t.kb = .12; t.kx = b.vx * .12; t.ky = b.vy * .12; }
      const owner = room.players.get(b.owner);
      if (owner?.buffs.vamp) owner.hp = Math.min(100, owner.hp + .5);
      if (b.pierce > 0) b.pierce--; else b.life = 0;
    };
    for (const f of room.fish) { if (b.life <= 0) break; if (f.hp > 0 && !b.hits.includes(f.id) && Math.hypot(f.x - b.x, f.y - b.y) < f.size) hitTarget(f); }
    if (b.life > 0 && room.boss && !b.hits.includes(room.boss.id) && Math.hypot(room.boss.x - b.x, room.boss.y - b.y) < room.boss.r) hitTarget(room.boss);
    for (const e of room.eproj) if (b.life > 0 && e.life > 0 && e.type === 'bubble' && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 3) {
      e.life = 0;
      if (b.boom) { b.exp = true; b.life = 0; boom(room, b.x, b.y, b.boom, b.boomDmg, b.owner); } else if (b.pierce > 0) b.pierce--; else b.life = 0;
    }
    if (b.life <= 0 && b.boom && !b.exp) { b.exp = true; boom(room, b.x, b.y, b.boom, b.boomDmg, b.owner); }
  }
  room.bullets = room.bullets.filter(b => b.life > 0);
  for (const f of room.fish) {
    if (f.hp <= 0) continue;
    const target = nearestPlayer(room, f.x, f.y);
    if (!target) continue;
    const a = Math.atan2(target.y - f.y, target.x - f.x); f.ang = a; f.ph += dt * (6 + f.sp / 12);
    let sp = f.sp;
    if (f.kb > 0) { f.kb -= dt; f.x += f.kx * dt * 2; f.y += f.ky * dt * 2; sp *= .3; }
    f.x += Math.cos(a) * sp * dt; f.y += Math.sin(a) * sp * dt;
    for (const p of alivePlayers(room)) if (Math.hypot(p.x - f.x, p.y - f.y) < p.r + f.size * .7 && p.hurt <= 0) {
      hurt(room, p, TYPES[f.t].dmg); p.hurt = .6;
    }
  }
  for (const f of room.fish) if (f.hp <= 0) killFish(room, f);
  room.fish = room.fish.filter(f => f.hp > 0);
  const b = room.boss;
  if (b && b.hp <= 0) killBoss(room);
  if (room.boss) updateBoss(room, room.boss, dt);
  if (room.boss?.hp <= 0) killBoss(room);
  for (const e of room.eproj) {
    e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt; e.ph += dt * 6;
    if (e.type === 'bubble') e.x += Math.sin(e.ph) * 14 * dt;
    if (e.x < -30 || e.x > W + 30 || e.y < TOP - 40 || e.y > H + 30) e.life = 0;
    if (e.life > 0) for (const p of alivePlayers(room)) if (Math.hypot(p.x - e.x, p.y - e.y) < p.r + e.r) {
      e.life = 0;
      if (e.type === 'bubble') { hurt(room, p, 6); stun(p, 1.3); } else { hurt(room, p, 4); poison(p, 5); }
      break;
    }
  }
  room.eproj = room.eproj.filter(e => e.life > 0);
  for (const s of room.strikes) {
    s.t += dt;
    if (!s.fired && s.t >= s.T) {
      s.fired = true; s.flash = .3;
      const pts = [], cx = s.x + rand(-18, 18);
      for (let i = 0; i <= 9; i++) pts.push([cx + (s.x - cx) * i / 9 + (i > 0 && i < 9 ? rand(-12, 12) : 0), TOP + (s.y - TOP) * i / 9]);
      s.pts = pts;
      for (const p of alivePlayers(room)) if (Math.hypot(p.x - s.x, p.y - s.y) < p.r + 26) hurt(room, p, 22);
    }
    if (s.fired) s.flash -= dt;
  }
  room.strikes = room.strikes.filter(s => !s.fired || s.flash > 0);
  for (const n of room.nades) {
    n.t += dt;
    if (n.t >= n.T) {
      n.done = true;
      emitFx(room, 'boom', { x: n.tx, y: n.ty, r: 55, hostile: true });
      for (const p of alivePlayers(room)) if (Math.hypot(p.x - n.tx, p.y - n.ty) < p.r + 55) hurt(room, p, 25);
    }
  }
  room.nades = room.nades.filter(n => !n.done);
  for (const k of room.pickups) {
    k.life -= dt;
    if (k.life <= 0) continue;
    for (const p of alivePlayers(room)) if (Math.hypot(k.x - p.x, k.y - p.y) < 22) { collect(room, p, k); k.life = 0; break; }
  }
  room.pickups = room.pickups.filter(k => k.life > 0);
}
function updateBoss(room, b, dt) {
  b.ph += dt * 3; b.hit -= dt;
  const target = nearestPlayer(room, b.x, b.y);
  if (!target) return;
  const dx = target.x - b.x, dy = target.y - b.y, d = Math.hypot(dx, dy) || 1;
  let da = Math.atan2(dy, dx) - b.ang;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  b.ang += da * Math.min(1, dt * 3);
  const sp = b.sp * (b.enraged ? 1.35 : 1);
  if (b.intro) { b.y += sp * 1.6 * dt; if (b.y >= TOP + b.r * .8) b.intro = false; }
  else {
    const want = 150 + b.size;
    if (d > want) { b.x += dx / d * sp * dt; b.y += dy / d * sp * dt; }
    else if (d < want * .7) { b.x -= dx / d * sp * .6 * dt; b.y -= dy / d * sp * .6 * dt; }
    b.x += -dy / d * Math.sin(room.time * .8) * sp * .5 * dt;
    b.y += dx / d * Math.sin(room.time * .8) * sp * .5 * dt;
    b.x = clamp(b.x, b.r * .5, W - b.r * .5); b.y = clamp(b.y, TOP + b.r * .4, H - b.r * .4);
  }
  for (const p of alivePlayers(room)) if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r * .85 && p.hurt <= 0) { hurt(room, p, 18); p.hurt = .7; }
  if (!b.enraged && b.hp < b.max * .5) { b.enraged = true; emitFx(room, 'enrage', { name: b.name }); }
  if (!b.intro) {
    b.atk -= dt;
    if (b.atk <= 0) { bossAttack(room, b); b.atk = Math.max(1.1, 2.6 - b.n * .2) * (b.enraged ? .7 : 1) * rand(.85, 1.15); }
  }
}
function publicPlayer(p) {
  return {
    id: p.id, name: p.name, slot: p.slot, connected: p.connected, x: p.x, y: p.y, r: p.r, hp: p.hp,
    armor: p.armor, aim: p.aim, flash: Math.max(0, p.flash), hurt: Math.max(0, p.hurt), buffs: p.buffs,
    weapon: p.weapon, poison: Math.max(0, p.poison), poisonMax: p.poisonMax, stun: Math.max(0, p.stun),
    stunMax: p.stunMax, ammo: p.ammo, reloadT: Math.max(0, p.reloadT), alive: p.alive,
    respawnT: Math.max(0, p.respawnT), score: p.score, seq: p.input.seq
  };
}
function snapshot(room) {
  return {
    t: Date.now(), tick: room.tick, wave: room.wave, score: room.score, isBossWave: room.isBossWave,
    spawnQ: room.spawnQ, players: [...room.players.values()].map(publicPlayer), fish: room.fish,
    boss: room.boss, bullets: room.bullets.map(({ hits, ...b }) => b), eproj: room.eproj,
    strikes: room.strikes, nades: room.nades, pickups: room.pickups,
        fish: room.fish.map(f => ({ id: f.id, t: f.t, x: +f.x.toFixed(1), y: +f.y.toFixed(1), hp: f.hp, max: f.max, ang: +f.ang.toFixed(2), ph: +f.ph.toFixed(2), size: +f.size.toFixed(1), elite: f.elite, puffer: f.puffer, c1: f.c1, pattern: f.pattern, tail: f.tail, fin: f.fin }))
  };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) }));
    return;
  }
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/client.js': ['client.js', 'text/javascript; charset=utf-8'] };
  const file = files[url.pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(path.join(ROOT, file[0]));
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' }); res.end(body);
  } catch { res.writeHead(500); res.end('Server error'); }
});
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true, methods: ['GET', 'POST'] },
  serveClient: true, maxHttpBufferSize: 32_000, pingInterval: 10_000, pingTimeout: 8_000
});
io.on('connection', socket => {
  socket.on('join', (payload = {}, ack) => {
    if (socket.data.roomCode) return;
    const code = cleanCode(payload.room);
    let room = rooms.get(code);
    if (!room) room = makeRoom(code, payload);
    const session = /^[A-Za-z0-9_-]{8,64}$/.test(String(payload.session || '')) ? String(payload.session) : randomUUID();
    let p = room.players.get(session);
    if (p && p.connected) {
      ack?.({ ok: false, error: 'บัญชีผู้เล่นนี้กำลังเชื่อมต่ออยู่ กรุณารีเฟรชอีกครั้ง' });
      return;
    }
    if (!p && room.players.size >= MAX_PLAYERS) { ack?.({ ok: false, error: 'ห้องเต็มแล้ว (สูงสุด 4 คน)' }); return; }
    if (p) {
      p.socketId = socket.id; p.connected = true; p.disconnectT = 0; p.name = cleanName(payload.name || p.name);
      systemChat(room, `${p.name} กลับเข้าเกมแล้ว`);
    } else {
      p = makePlayer(session, socket.id, cleanName(payload.name), room.players.size);
      room.players.set(session, p);
      systemChat(room, `${p.name} เข้าร่วมห้อง ${code}`);
    }
    socket.data.roomCode = code; socket.data.playerId = session;
    socket.join(code);
    ack?.({ ok: true, id: session, session, room: code, serverTime: Date.now(), maxPlayers: MAX_PLAYERS });
    socket.emit('state', snapshot(room));
  });
  socket.on('input', data => {
    const room = rooms.get(socket.data.roomCode), p = room?.players.get(socket.data.playerId);
    if (!p || !p.connected || !data || typeof data !== 'object') return;
    p.input.mx = clamp(finite(data.mx), -1, 1); p.input.my = clamp(finite(data.my), -1, 1);
    const aim = finite(data.aim, p.aim); p.input.aim = Math.atan2(Math.sin(aim), Math.cos(aim));
    p.input.fire = data.fire === true; p.input.auto = data.auto !== false;
    p.input.seq = Math.max(p.input.seq, Math.floor(finite(data.seq)));
    if (data.reload === true) p.input.reload = true;
  });
  socket.on('chat', data => {
    const room = rooms.get(socket.data.roomCode), p = room?.players.get(socket.data.playerId);
    if (!room || !p || !data) return;
    const now = Date.now();
    if (now - p.lastChat < 650) return;
    const text = String(data.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
    if (!text) return;
    p.lastChat = now;
    io.to(room.code).emit('chat', { id: randomUUID(), from: p.name, playerId: p.id, text, system: false, at: now });
  });
  socket.on('time-sync', ack => { if (typeof ack === 'function') ack(Date.now()); });
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode), p = room?.players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false; p.disconnectT = 15; p.input.fire = false; p.input.mx = p.input.my = 0;
    systemChat(room, `${p.name} ขาดการเชื่อมต่อ กำลังรอเชื่อมต่อใหม่…`);
  });
});
let previous = process.hrtime.bigint(), accumulator = 0;
const timer = setInterval(() => {
  const now = process.hrtime.bigint();
  accumulator += Math.min(.25, Number(now - previous) / 1e9); previous = now;
  while (accumulator >= STEP) {
    for (const room of [...rooms.values()]) {
      updateRoom(room, STEP);
      if (!rooms.has(room.code)) continue;
      room.snapshotT += STEP;
      if (room.snapshotT >= SNAPSHOT_STEP) {
        room.snapshotT %= SNAPSHOT_STEP;
        io.to(room.code).volatile.emit('state', snapshot(room));
      }
    }
    accumulator -= STEP;
  }
}, 1000 / 60);
server.listen(PORT, '0.0.0.0', () => console.log(`Landfish multiplayer listening on port ${PORT}`));
function shutdown() {
  clearInterval(timer); io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
export { server, io, rooms };
