const WEAPONS = {
  pistol: { icon: '🔫', name: 'ปืนพก', col: '#ffcf4d' },
  smg: { icon: '🔫', name: 'SMG', dur: 20, col: '#ffe27a' },
  shotgun: { icon: '💢', name: 'ลูกซอง', dur: 20, col: '#ff9f4d' },
  rifle: { icon: '🎯', name: 'ไรเฟิล', dur: 20, col: '#7dffb0' },
  rpg: { icon: '🚀', name: 'RPG', dur: 15, col: '#ff6a3d' }
};
const BUFFS = {
  dmg: { icon: '💥', name: 'พลังโจมตี x2', col: '#ff6b35' },
  rapid: { icon: '⚡', name: 'ยิงรัว', col: '#ffd23f' },
  speed: { icon: '👟', name: 'วิ่งไว', col: '#5ee0a0' },
  regen: { icon: '💚', name: 'ฟื้นเลือด', col: '#4cd964' },
  multi: { icon: '🔱', name: 'ยิง 3 ทาง', col: '#8ab4ff' },
  inf: { icon: '♾️', name: 'กระสุนไม่จำกัด', col: '#c9a0ff' },
  berserk: { icon: '🔥', name: 'คลั่ง (โจมตี x3)', col: '#ff3b2f', boss: true },
  god: { icon: '🌟', name: 'อมตะ', col: '#ffe066', boss: true },
  vamp: { icon: '🧛', name: 'ดูดเลือด', col: '#c04ae0', boss: true },
  titan: { icon: '🦾', name: 'ไททัน (เจ็บน้อย)', col: '#7fb8ff', boss: true }
};
const ATK_ICON = { poison: '☠️', lightning: '⚡', bubble: '🫧', grenade: '💣' };
const MAG = 30;
const SLOT_COLORS = ['#45f58a', '#55c9ff', '#ffcf55', '#e98aff', '#ff806e', '#79ffe1', '#b7ff67', '#ffa6d5'];
const params = new URLSearchParams(location.search);
const socket = io({ autoConnect: false, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 4000, timeout: 7000 });
let joined = false, needsJoin = false, paused = false, chatOpen = false;
let playerId = null, roomCode = 'PUBLIC', latestState = null, snapshots = [];
let serverOffset = 0, offsetReady = false, ping = 0, seq = 0, pendingInputs = [];
let local = null, banner = null, unread = 0, lastNetUpdate = 0, lastFrame = performance.now();
let firing = false, mouseAim = null, reloadPending = false;
const keys = {}, parts = [], fx = [], pops = [];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const storage = {
  get(key, fallback = '') { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  session(room) { try { return sessionStorage.getItem(`landfish_${room}`); } catch { return null; } },
  saveSession(room, id) { try { sessionStorage.setItem(`landfish_${room}`, id); } catch {} }
};
$('nameInput').value = storage.get('landfish_name', `ผู้เล่น${Math.floor(Math.random() * 900 + 100)}`);
$('roomInput').value = (params.get('room') || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
function setNetwork(text, online = false) {
  $('net').textContent = text;
  $('net').classList.toggle('online', online);
  $('net').classList.toggle('offline', !online);
}
function showOverlay(title, text, button, joinMode = false) {
  $('ovTitle').textContent = title;
  $('ovText').innerHTML = text;
  $('startBtn').textContent = button;
  $('joinFields').classList.toggle('hidden', !joinMode);
  $('joinError').textContent = '';
  $('overlay').classList.remove('hidden');
}
function closeChat() {
  chatOpen = false;
  $('chatPanel').classList.add('hidden');
  $('chatInput').blur();
  firing = false;
}
function openChat() {
  if (!joined) return;
  chatOpen = true; unread = 0;
  $('chatBadge').classList.add('hidden');
  $('chatPanel').classList.remove('hidden');
  $('chatInput').focus();
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  firing = false;
}
function addChat(message) {
  const line = document.createElement('div');
  line.className = `chatLine${message.system ? ' system' : ''}`;
  if (message.system) line.textContent = message.text;
  else {
    const name = document.createElement('b'); name.textContent = `${message.from}: `;
    line.append(name, document.createTextNode(message.text));
  }
  $('chatLog').append(line);
  while ($('chatLog').children.length > 60) $('chatLog').firstElementChild.remove();
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  if (!chatOpen && !message.system) {
    unread = Math.min(99, unread + 1);
    $('chatBadge').textContent = unread;
    $('chatBadge').classList.remove('hidden');
  }
}
function joinRoom() {
  if (!socket.connected || !needsJoin) return;
  roomCode = ($('roomInput').value || 'PUBLIC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
  $('roomInput').value = roomCode;
  const name = $('nameInput').value.trim().slice(0, 16) || 'ผู้เล่น';
  storage.set('landfish_name', name);
  const session = storage.session(roomCode) || crypto.randomUUID();
  $('startBtn').disabled = true;
  $('joinError').textContent = 'กำลังเข้าห้อง…';
  socket.timeout(7000).emit('join', {
    room: roomCode, name, session,
    startWave: clamp(Math.floor(Number(params.get('wave')) || 1), 1, 999),
    bossEvery: clamp(Math.floor(Number(params.get('boss')) || 25), 1, 100)
  }, (err, result) => {
    $('startBtn').disabled = false;
    if (err || !result?.ok) {
      if (joined) {
        needsJoin = true;
        setNetwork('● กำลังกู้คืนการเชื่อมต่อ…');
        setTimeout(() => { if (needsJoin && socket.connected) joinRoom(); }, 1500);
      } else $('joinError').textContent = err ? 'เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่' : result?.error || 'เข้าห้องไม่สำเร็จ';
      return;
    }
    playerId = result.id; roomCode = result.room; joined = true; needsJoin = false; paused = false;
    storage.saveSession(roomCode, result.session);
    serverOffset = result.serverTime - Date.now(); offsetReady = true;
    latestState = null; snapshots = []; pendingInputs = []; local = null;
    $('overlay').classList.add('hidden');
    $('roomTag').textContent = `ห้อง ${roomCode} · คัดลอกลิงก์`;
    $('roomTag').classList.remove('hidden');
    $('chatToggle').classList.remove('hidden');
    const url = new URL(location.href); url.searchParams.set('room', roomCode);
    history.replaceState(null, '', url);
    setNetwork('● เชื่อมต่อแล้ว', true);
  });
}
$('startBtn').addEventListener('click', () => {
  if (paused) {
    paused = false; $('overlay').classList.add('hidden'); return;
  }
  needsJoin = true;
  if (socket.connected) joinRoom(); else socket.connect();
});
socket.on('connect', () => { setNetwork('● เชื่อมต่อแล้ว', true); joinRoom(); });
socket.on('disconnect', () => {
  firing = false;
  if (joined) { needsJoin = true; setNetwork('● หลุดการเชื่อมต่อ กำลังเชื่อมใหม่…'); }
  else setNetwork('● ยังไม่เชื่อมต่อ');
});
socket.on('connect_error', () => {
  if (!joined) $('joinError').textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่';
});
socket.on('chat', addChat);
socket.on('state', state => {
  if (!state || !Array.isArray(state.players)) return;
  latestState = state;
  snapshots.push(state);
  if (snapshots.length > 30) snapshots.shift();
  if (!offsetReady) { serverOffset = state.t - Date.now(); offsetReady = true; }
  const auth = state.players.find(p => p.id === playerId);
  if (auth) reconcileLocal(auth);
  window.__GAME_READY__ = true;
});
function replayInputs(auth) {
  pendingInputs = pendingInputs.filter(i => i.seq > (auth.seq || 0));
  let x = auth.x, y = auth.y;
  for (const i of pendingInputs) {
    if (!i.move) continue;
    let mx = i.mx, my = i.my;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    x = clamp(x + mx * i.speed * i.dt, 13, W - 13);
    y = clamp(y + my * i.speed * i.dt, TOP + 13, H - 13);
  }
  return { x, y };
}
function reconcileLocal(auth) {
  const predicted = replayInputs(auth);
  if (!local) local = { ...auth, ...predicted };
  else {
    const error = Math.hypot(local.x - predicted.x, local.y - predicted.y);
    const x = error > 45 ? predicted.x : lerp(local.x, predicted.x, .35);
    const y = error > 45 ? predicted.y : lerp(local.y, predicted.y, .35);
    local = { ...auth, x, y };
  }
}
const LERP_KEYS = ['x', 'y', 'hp', 'ph', 'life', 't', 'flash', 'hurt', 'sx', 'sy', 'tx', 'ty', 'vx', 'vy'];
function interpolateEntity(a, b, t) {
  if (!a || a.id !== b.id) return b;
  const out = Object.assign({}, b);
  for (const key of LERP_KEYS) { const p = a[key], q = b[key]; if (typeof p === 'number' && typeof q === 'number') out[key] = p + (q - p) * t; }
  if (typeof a.ang === 'number' && typeof b.ang === 'number') out.ang = lerpAngle(a.ang, b.ang, t);
  if (typeof a.aim === 'number' && typeof b.aim === 'number') out.aim = lerpAngle(a.aim, b.aim, t);
  return out;
}
function interpolateList(oldList = [], newList = [], t) {
  if (!oldList.__map) oldList.__map = new Map(oldList.map(e => [e.id, e]));
  const old = oldList.__map, out = new Array(newList.length);
  for (let i = 0; i < newList.length; i++) out[i] = interpolateEntity(old.get(newList[i].id), newList[i], t);
  return out;
}
function renderState() {
  if (!latestState) return null;
  if (snapshots.length < 2) return latestState;
  const renderTime = Date.now() + serverOffset - 100;
  let a = snapshots[0], b = snapshots[snapshots.length - 1];
  for (let i = snapshots.length - 1; i > 0; i--) {
    if (snapshots[i - 1].t <= renderTime) { a = snapshots[i - 1]; b = snapshots[i]; break; }
  }
  const t = b.t === a.t ? 1 : clamp((renderTime - a.t) / (b.t - a.t), 0, 1);
  return {
    ...b,
    players: interpolateList(a.players, b.players, t), fish: interpolateList(a.fish, b.fish, t),
    boss: b.boss ? interpolateEntity(a.boss, b.boss, t) : null,
    bullets: interpolateList(a.bullets, b.bullets, t), eproj: interpolateList(a.eproj, b.eproj, t),
    strikes: interpolateList(a.strikes, b.strikes, t), nades: interpolateList(a.nades, b.nades, t),
    pickups: interpolateList(a.pickups, b.pickups, t)
  };
}
function burst(x, y, color, n = 12) {
  for (let i = 0; i < n && parts.length < 400; i++) {
    const a = rand(0, Math.PI * 2), speed = rand(30, 140);
    parts.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: rand(.25, .65), color, r: rand(1.5, 3.5) });
  }
}
function setBanner(text, sub = '', duration = 2) { banner = { text, sub, t: duration, max: duration }; }
socket.on('fx', event => {
  if (!event) return;
  if (event.type === 'fishDown') { burst(event.x, event.y, event.color || '#fff', event.elite ? 22 : 12); burst(event.x, event.y, '#fff', 4); }
  else if (event.type === 'boom') { fx.push({ x: event.x, y: event.y, t: 0, T: .4, r: event.r || 55, col: event.hostile ? '#a0642d' : '#ff9a2e', fill: true }); burst(event.x, event.y, '#ffb347', 20); }
  else if (event.type === 'pickup') {
    const info = pickupInfo(event);
    fx.push({ x: event.x, y: event.y, t: 0, T: .35, r: 34, col: info.col });
    if (event.playerId === playerId && local) pops.push({ x: local.x, y: local.y - 24, t: 1.1, txt: info.txt, col: info.col });
  } else if (event.type === 'boss') setBanner('⚠ บอสมาแล้ว! ⚠', `${event.name}  ${(event.attacks || []).map(a => ATK_ICON[a]).join(' ')}`, 3);
  else if (event.type === 'bossDown') { setBanner('🏆 โค่นบอสสำเร็จ!', 'เก็บบัฟสุดโหดเร็ว!', 2.5); burst(event.x, event.y, '#ffd23f', 40); }
  else if (event.type === 'wave') setBanner(event.boss ? `⚠ เวฟบอส ${event.wave}` : `รอบ ${event.wave}`, '', 1.5);
  else if (event.type === 'enrage') setBanner('บอสโกรธแล้ว!!', event.name, 1.5);
  else if (event.type === 'playerDown') { burst(event.x, event.y, '#e44', 22); if (event.id === playerId) setBanner('คุณตายแล้ว', 'จะเกิดใหม่ในอีก 5 วินาที', 2); }
  else if (event.type === 'respawn' && event.id === playerId) burst(event.x, event.y, '#7fe', 24);
});
function pickupInfo(k) {
  if (k.kind === 'heart') return { icon: '❤️', col: '#ff5a6a', txt: '+เลือด' };
  if (k.kind === 'armor') return { icon: '🛡️', col: '#7fb8ff', txt: '+เกราะ' };
  if (k.kind === 'weapon') { const w = WEAPONS[k.key] || WEAPONS.pistol; return { icon: w.icon, col: '#ffd23f', txt: w.name, label: w.name }; }
  const b = BUFFS[k.key] || BUFFS.dmg;
  return { icon: b.icon, col: b.boss ? '#ffb300' : '#6ee7a0', txt: b.name, big: b.boss };
}
function currentInput() {
  const blocked = paused || chatOpen || !joined || !local?.alive;
  let mx = blocked ? 0 : (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  let my = blocked ? 0 : (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
  const length = Math.hypot(mx, my);
  if (length > 1) { mx /= length; my /= length; }
  const manual = !blocked && mouseAim && firing && !('ontouchstart' in window);
  const auto = !manual;
  let aim = local?.aim ?? -Math.PI / 2;
  if (manual) aim = Math.atan2(mouseAim.y - local.y, mouseAim.x - local.x);
  else if (auto && latestState && local) {
    let target = null, distance = Infinity;
    for (const f of latestState.fish || []) { const d = Math.hypot(f.x - local.x, f.y - local.y); if (f.y > TOP - 10 && d < distance) { target = f; distance = d; } }
    const b = latestState.boss;
    if (b && !b.intro) { const d = Math.hypot(b.x - local.x, b.y - local.y) - b.r; if (d < distance) target = b; }
    if (target) aim = Math.atan2(target.y - local.y, target.x - local.x);
    else if (length > .2) aim = Math.atan2(my, mx);
  }
  return { mx, my, aim, auto, fire: !blocked && (firing || keys.Space), move: !blocked && (local?.stun || 0) <= 0 };
}
function updateLocal(dt) {
  if (!local) return;
  local.flash = Math.max(0, local.flash - dt);
  if (!local.alive) return;
  const input = currentInput();
  local.aim = input.aim;
  if (input.move) {
    const speed = 125 * (local.buffs?.speed ? 1.4 : 1);
    local.x = clamp(local.x + input.mx * speed * dt, local.r, W - local.r);
    local.y = clamp(local.y + input.my * speed * dt, TOP + local.r, H - local.r);
  }
}
let lastSent = performance.now();
setInterval(() => {
  const now = performance.now(), dt = clamp((now - lastSent) / 1000, 0, .1); lastSent = now;
  if (!joined || !socket.connected || !local) return;
  const input = currentInput(), speed = 125 * (local.buffs?.speed ? 1.4 : 1);
  const packet = { ...input, seq: ++seq, reload: reloadPending };
  reloadPending = false;
  pendingInputs.push({ seq: packet.seq, dt, mx: input.mx, my: input.my, speed, move: input.move });
  if (pendingInputs.length > 120) pendingInputs.shift();
  socket.volatile.emit('input', packet);
}, 1000 / 30);
setInterval(() => {
  if (!socket.connected) return;
  const started = Date.now();
  socket.timeout(3000).emit('time-sync', (err, serverTime) => {
    if (err) return;
    const now = Date.now(), sample = Math.max(0, now - started);
    ping = Math.round(lerp(ping || sample, sample, .35));
    const offset = serverTime + sample / 2 - now;
    serverOffset = offsetReady ? lerp(serverOffset, offset, .2) : offset;
    offsetReady = true;
  });
}, 3000);
const joy = { x: 0, y: 0, id: null };
const joyEl = $('joy'), knob = $('knob'), fireEl = $('fire');
function joyMove(e) {
  const r = joyEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2, length = Math.hypot(dx, dy);
  if (length > max) { dx = dx / length * max; dy = dy / length * max; }
  joy.x = dx / max; joy.y = dy / max;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
joyEl.addEventListener('pointerdown', e => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) joyMove(e); });
const joyEnd = e => { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; } };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
fireEl.addEventListener('pointerdown', e => { firing = true; fireEl.classList.add('down'); fireEl.setPointerCapture(e.pointerId); });
const fireEnd = () => { firing = false; fireEl.classList.remove('down'); };
fireEl.addEventListener('pointerup', fireEnd); fireEl.addEventListener('pointercancel', fireEnd);
cv.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const r = cv.getBoundingClientRect();
  mouseAim = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
});
cv.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' || chatOpen || paused) return;
  firing = true;
  const r = cv.getBoundingClientRect();
  mouseAim = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
});
addEventListener('pointerup', e => { if (e.pointerType === 'mouse') firing = false; });
addEventListener('keydown', e => {
  if (document.activeElement === $('chatInput') || document.activeElement === $('nameInput') || document.activeElement === $('roomInput')) return;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Enter') { e.preventDefault(); chatOpen ? closeChat() : openChat(); return; }
  if (e.code === 'Escape') { if (chatOpen) closeChat(); else if (paused) $('startBtn').click(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyR') reloadPending = true;
  if (e.code === 'KeyP') togglePause();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { firing = false; joy.x = joy.y = 0; for (const k of Object.keys(keys)) keys[k] = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { firing = false; joy.x = joy.y = 0; } });
function togglePause() {
  if (!joined || chatOpen) return;
  paused = !paused; firing = false;
  if (paused) showOverlay('⏸ หยุดควบคุมชั่วคราว', 'เกมของทุกคนในห้องยังดำเนินต่อ ไม่ได้หยุดเซิร์ฟเวอร์<br>กดปุ่มด้านล่างหรือ P เพื่อกลับเข้าเกม', 'กลับเข้าเกม');
  else $('overlay').classList.add('hidden');
}
$('pause').addEventListener('click', togglePause);
$('chatToggle').addEventListener('click', () => chatOpen ? closeChat() : openChat());
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text && socket.connected) socket.emit('chat', { text });
  $('chatInput').value = '';
});
$('roomTag').addEventListener('click', async () => {
  const url = new URL(location.href); url.search = ''; url.searchParams.set('room', roomCode);
  try { await navigator.clipboard.writeText(url.toString()); $('roomTag').textContent = '✓ คัดลอกลิงก์แล้ว'; }
  catch { $('roomTag').textContent = `รหัสห้อง: ${roomCode}`; }
  setTimeout(() => { $('roomTag').textContent = `ห้อง ${roomCode} · คัดลอกลิงก์`; }, 1800);
});
function row(x, y, icon, name, frac, col) {
  ctx.textAlign = 'left'; ctx.font = '12px serif'; ctx.fillStyle = '#fff'; ctx.fillText(icon, x, y + 11);
  ctx.font = 'bold 8px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillText(name, x + 18, y + 6);
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(x + 18, y + 8, 66, 6);
  ctx.fillStyle = col; ctx.fillRect(x + 18, y + 8, 66 * clamp(frac, 0, 1), 6);
}
function drawPickup(k) {
  const info = pickupInfo(k);
  if (k.life < 3 && Math.floor(performance.now() / 125) % 2) return;
  const bob = Math.sin(performance.now() / 200 + k.x) * 2;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ell(k.x, k.y + 14, 9, 3);
  ctx.fillStyle = `${info.col}40`; dot(k.x, k.y + bob, info.big ? 16 : 13);
  ctx.strokeStyle = info.col; ctx.lineWidth = info.big ? 3 : 2; ctx.beginPath(); ctx.arc(k.x, k.y + bob, info.big ? 16 : 13, 0, 7); ctx.stroke();
  ctx.textAlign = 'center'; ctx.font = `${info.big ? 18 : 15}px serif`; ctx.fillStyle = '#fff'; ctx.fillText(info.icon, k.x, k.y + bob + 6);
  if (info.label) { ctx.font = 'bold 8px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(info.label, k.x, k.y + 25); }
}
function drawActor(p, isLocal) {
  ctx.save();
  if (!p.connected) ctx.globalAlpha = .35;
  if (!p.alive) ctx.globalAlpha = .25;
  drawPlayer(p, performance.now() / 1000);
  ctx.restore();
  ctx.textAlign = 'center'; ctx.font = 'bold 9px system-ui';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)';
  const status = !p.connected ? ' (ออฟไลน์)' : !p.alive ? ` ${Math.ceil(p.respawnT)}` : '';
  ctx.strokeText(p.name + status, p.x, p.y - 27); ctx.fillStyle = isLocal ? '#fff59a' : SLOT_COLORS[p.slot % SLOT_COLORS.length];
  ctx.fillText(p.name + status, p.x, p.y - 27);
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(p.x - 16, p.y - 23, 32, 3);
  ctx.fillStyle = SLOT_COLORS[p.slot % SLOT_COLORS.length]; ctx.fillRect(p.x - 16, p.y - 23, 32 * clamp(p.hp / 100, 0, 1), 3);
}
function updateEffects(dt) {
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  for (const e of fx) e.t += dt;
  for (let i = fx.length - 1; i >= 0; i--) if (fx[i].t >= fx[i].T) fx.splice(i, 1);
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .93; p.vy *= .93; p.life -= dt; }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
  for (const p of pops) { p.t -= dt; p.y -= 18 * dt; }
  for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t <= 0) pops.splice(i, 1);
}
function draw() {
  ctx.textAlign = 'left'; ctx.drawImage(ground, 0, 0, W, H);
  const flame = 6 + Math.sin(performance.now() / 55) * 2;
  ctx.fillStyle = '#ff7a18'; ell(34, 380, flame * .6, flame); ctx.fillStyle = '#ffd23f'; ell(34, 383, flame * .3, flame * .55);
  ctx.fillStyle = '#6b2a1a'; ctx.fillRect(25, 384, 18, 16);
  const world = renderState();
  if (!world) return;
  for (const k of world.pickups) drawPickup(k);
  for (const s of world.strikes) if (!s.fired) {
    const progress = clamp(s.t / s.T, 0, 1);
    ctx.fillStyle = `rgba(190,240,255,${.08 + .12 * progress})`; dot(s.x, s.y, 26);
    ctx.strokeStyle = `rgba(220,250,255,${.4 + .4 * progress})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 26, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(s.x, s.y, 26 * progress, 0, 7); ctx.stroke();
  }
  for (const n of world.nades) {
    const progress = clamp(n.t / n.T, 0, 1);
    ctx.fillStyle = `rgba(120,72,30,${.15 + .15 * progress})`; dot(n.tx, n.ty, 55);
    ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(n.tx, n.ty, 55 * (.4 + .6 * progress), 0, 7); ctx.stroke();
  }
  for (const f of world.fish) drawFish(f);
  if (world.boss) drawBoss(world.boss, performance.now() / 1000);
  for (const p of world.players) if (p.id !== playerId) drawActor(p, false);
  if (local) drawActor(local, true);
  if (local?.poison > 0) { ctx.fillStyle = 'rgba(60,220,60,.22)'; dot(local.x, local.y, local.r + 9); }
  if (local?.stun > 0) for (let i = 0; i < 3; i++) { const a = performance.now() / 160 + i * 2.1; ctx.fillStyle = '#7fd0ff'; dot(local.x + Math.cos(a) * 15, local.y - local.r - 7 + Math.sin(a) * 4, 3); }
  for (const e of world.eproj) {
    if (e.type === 'bubble') {
      ctx.fillStyle = 'rgba(80,180,255,.35)'; dot(e.x, e.y, e.r);
      ctx.strokeStyle = 'rgba(170,230,255,.95)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.8)'; dot(e.x - e.r * .35, e.y - e.r * .35, e.r * .22);
    } else {
      ctx.fillStyle = 'rgba(80,200,60,.4)'; dot(e.x - e.vx * .03, e.y - e.vy * .03, e.r * .7);
      ctx.fillStyle = '#4cd137'; dot(e.x, e.y, e.r); ctx.fillStyle = '#2d8a1f'; dot(e.x, e.y, e.r * .5);
    }
  }
  ctx.lineCap = 'round';
  for (const b of world.bullets) {
    if (b.boom) {
      ctx.fillStyle = 'rgba(255,140,40,.6)'; dot(b.x - b.vx * .02, b.y - b.vy * .02, 5);
      ctx.fillStyle = '#ddd'; dot(b.x, b.y, 4); ctx.fillStyle = '#ff5a2a'; dot(b.x - b.vx * .008, b.y - b.vy * .008, 2.5);
    } else {
      ctx.strokeStyle = b.col; ctx.lineWidth = b.dmg > 2 ? 3.5 : 2.5; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * .025, b.y - b.vy * .025); ctx.stroke();
    }
  }
  for (const n of world.nades) {
    const progress = clamp(n.t / n.T, 0, 1), x = lerp(n.sx, n.tx, progress), y = lerp(n.sy, n.ty, progress), z = Math.sin(Math.PI * progress) * 70;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ell(x, y, 6, 3); ctx.fillStyle = '#6b4423'; dot(x, y - z, 7);
    ctx.fillStyle = '#9b6a3c'; dot(x - 2, y - z - 2, 2.5); ctx.fillStyle = '#ffd23f'; dot(x + 4, y - z - 7, 2);
  }
  for (const s of world.strikes) if (s.fired && s.flash > 0 && s.pts) {
    const alpha = clamp(s.flash / .3, 0, 1);
    for (const [color, width] of [[`rgba(120,220,255,${alpha * .25})`, 9], [`rgba(255,255,255,${alpha * .5})`, 3]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
      s.pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
  }
  for (const e of fx) {
    const progress = e.t / e.T;
    if (e.fill) { ctx.globalAlpha = (1 - progress) * .35; ctx.fillStyle = e.col; dot(e.x, e.y, e.r * (.3 + .7 * progress)); }
    ctx.globalAlpha = 1 - progress; ctx.strokeStyle = e.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (.3 + .7 * progress), 0, 7); ctx.stroke();
  }
  for (const p of parts) { ctx.globalAlpha = clamp(p.life * 2, 0, 1); ctx.fillStyle = p.color; dot(p.x, p.y, p.r); }
  ctx.globalAlpha = 1;
  if (local?.reloadT > 0 && !local.weapon) {
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(local.x - 20, local.y + 26, 40, 5);
    ctx.fillStyle = '#4fc3f7'; ctx.fillRect(local.x - 20, local.y + 26, 40 * (1 - local.reloadT / 1.1), 5);
  }
  ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif';
  for (const p of pops) { ctx.globalAlpha = clamp(p.t * 2, 0, 1); ctx.fillStyle = '#000'; ctx.fillText(p.txt, p.x + 1, p.y + 1); ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, p.y); }
  ctx.globalAlpha = 1;
  let by = TOP + 8;
  if (world.boss) {
    const b = world.boss;
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(10, TOP + 6, W - 20, 11);
    ctx.fillStyle = b.enraged ? '#ff3b2f' : '#e63946'; ctx.fillRect(10, TOP + 6, (W - 20) * clamp(b.hp / b.max, 0, 1), 11);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(10, TOP + 6, W - 20, 11);
    ctx.textAlign = 'center'; ctx.font = 'bold 11px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(`${b.name}  ${b.attacks.map(a => ATK_ICON[a]).join(' ')}`, W / 2, TOP + 31); by = TOP + 38;
  }
  if (local) {
    if (local.weapon) { const w = WEAPONS[local.weapon.key] || WEAPONS.pistol; row(6, by, w.icon, w.name, local.weapon.t / local.weapon.max, w.col); by += 20; }
    for (const k of Object.keys(local.buffs || {})) { const b = BUFFS[k]; if (b) { row(6, by, b.icon, b.name, local.buffs[k].t / local.buffs[k].max, b.col); by += 20; } }
    let ry = world.boss ? TOP + 38 : TOP + 8;
    if (local.poison > 0) { row(W - 92, ry, '☠️', 'ติดพิษ', local.poison / local.poisonMax, '#4cd137'); ry += 20; }
    if (local.stun > 0) row(W - 92, ry, '😵', 'จุก!', local.stun / local.stunMax, '#4fc3f7');
  }
  if (banner) {
    const alpha = clamp(Math.min(1, banner.t / .4, (banner.max - banner.t) / .15 + .2), 0, 1);
    ctx.globalAlpha = alpha; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.font = 'bold 26px sans-serif'; ctx.strokeText(banner.text, W / 2, H * .36); ctx.fillStyle = '#ffd23f'; ctx.fillText(banner.text, W / 2, H * .36);
    if (banner.sub) { ctx.font = 'bold 14px sans-serif'; ctx.strokeText(banner.sub, W / 2, H * .36 + 24); ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, H * .36 + 24); }
    ctx.globalAlpha = 1;
  }
    const hpT = `❤️ ${Math.ceil(local?.hp ?? 100)}${local?.armor > 0 ? ` 🛡️${Math.ceil(local.armor)}` : ''}`, ammoT = `${local?.weapon?.key === 'rpg' ? '🚀' : '🔫'} ${local?.weapon || local?.buffs?.inf ? '∞' : local?.reloadT > 0 ? '...' : local?.ammo ?? MAG}`;
  const scoreT = `SCORE: ${world.score}`, waveT = `WAVE: ${world.wave}`;
  if (hpT !== lastHud.hp) $('hp').textContent = lastHud.hp = hpT;
  if (ammoT !== lastHud.ammo) $('ammo').textContent = lastHud.ammo = ammoT;
  if (scoreT !== lastHud.score) $('score').textContent = lastHud.score = scoreT;
  if (waveT !== lastHud.wave) $('wave').textContent = lastHud.wave = waveT;
  const showRespawn = local && !local.alive;
  $('respawn').classList.toggle('hidden', !showRespawn);
  if (showRespawn) $('respawn').textContent = `เกิดใหม่ใน ${Math.ceil(local.respawnT)} วินาที`;
  const now = performance.now();
  if (now - lastNetUpdate > 500) {
    lastNetUpdate = now;
    const count = world.players.filter(p => p.connected).length;
    if (socket.connected) setNetwork(`● ออนไลน์ ${count} คน · ${ping} ms`, true);
  }
}
function loop(now) {
  const dt = clamp((now - lastFrame) / 1000, 0, .05); lastFrame = now;
  updateLocal(dt); updateEffects(dt); draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__gameProbe = () => ({
  joined, playerId, room: roomCode, connected: socket.connected, ping, tick: latestState?.tick || 0,
  wave: latestState?.wave || 0, players: latestState?.players.length || 0, fish: latestState?.fish.length || 0,
  bullets: latestState?.bullets.length || 0, pickups: latestState?.pickups.length || 0,
  boss: latestState?.boss?.id || null, x: local?.x || 0, y: local?.y || 0, hp: local?.hp || 0
});
