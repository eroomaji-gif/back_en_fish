const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ===== กันเซิร์ฟเวอร์ล่มทั้งตัวเมื่อมี error หลุดมา (เดิม error เดียวทำให้ทุกคนเล่นไม่ได้) =====
process.on('uncaughtException', (err) => console.error('[!] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[!] unhandledRejection:', err));

const app = express();
app.use(cors());

// เส้นทางเช็คสถานะเซิร์ฟเวอร์
app.get('/', (req, res) => {
  res.send('Fish Game Server is Online!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e5 // จำกัดขนาดข้อความที่ client ส่งมา (100KB) กันยัดข้อมูลก้อนใหญ่
});

// ===== ค่าตั้งต้น (ปรับได้) =====
const TICK_RATE = 30;               // รอบต่อวินาที
const MAX_FISH = 15;                // ปลาในจอพร้อมกันสูงสุด
const BULLET_LIFE_MS = 1500;        // กระสุนอยู่ได้กี่ ms แล้วลบทิ้ง
const MAX_BULLETS = 300;            // กระสุนรวมทั้งเซิร์ฟเวอร์
const MAX_BULLETS_PER_PLAYER = 40;  // กระสุนต่อผู้เล่น
const MIN_SHOOT_INTERVAL_MS = 40;   // ยิงถี่สุดได้ทุกกี่ ms (กันสแปม)

// เก็บข้อมูลเกมทั้งหมด (ผู้เล่น, ปลา, กระสุน, บอส, เวฟ)
let players = {};
let fishes = [];
let bullets = [];
let boss = null;
let wave = 1;

// แปลงค่าที่ client ส่งมาให้เป็นตัวเลขที่ปลอดภัย (ถ้าผิดปกติใช้ค่า fallback)
function num(v, min, max, fallback) {
  v = Number(v);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
const newId = () => Math.random().toString(36).slice(2, 11);

// ลูปหลักของเซิร์ฟเวอร์ (ทำงาน 30 ครั้งต่อวินาที เพื่อซิงค์ทุกอย่างให้ตรงกัน)
setInterval(() => {
  try {
    // ไม่มีผู้เล่น = ไม่ต้องทำอะไร (เดิมลูปรันและสะสมของไปเรื่อยๆ)
    if (Object.keys(players).length === 0) {
      fishes = [];
      bullets = [];
      return;
    }

    const now = Date.now();

    // 1. สุ่มสร้างปลาเข้ามาในเกม (ถ้าปลาน้อยกว่า MAX_FISH ตัว)
    if (fishes.length < MAX_FISH) {
      fishes.push({
        id: newId(),
        x: Math.random() * 600 + 60, // สุ่มตำแหน่งแกน X
        y: -20,                      // เริ่มจากด้านบนจอ
        type: 'normal',
        hp: 2
      });
    }

    // 2. ขยับตำแหน่งปลาให้ไหลลงมาข้างล่างพร้อมกันทุกเครื่อง
    fishes.forEach(f => {
      f.y += 1.5;
    });

    // ลบปลาที่ตกจอออกไปแล้ว
    fishes = fishes.filter(f => f.y < 1300);

    // ลบกระสุนที่หมดอายุ (เดิมไม่เคยลบ → array โตไม่จำกัด → ข้อมูลที่ส่งทุก 1/30 วินาทีใหญ่ขึ้นเรื่อยๆ จนเกมค้าง/หลุด)
    bullets = bullets.filter(b => now - b.born < BULLET_LIFE_MS);

    // 3. ส่งข้อมูลสถานะเกมทั้งหมด (Game State) กลับไปให้ผู้เล่นทุกคนเห็นเหมือนกัน
    io.emit('game-state', { players, fishes, bullets, boss, wave });
  } catch (err) {
    console.error('[!] error ในลูปหลัก:', err);
  }
}, 1000 / TICK_RATE);

// จัดการการเชื่อมต่อของผู้เล่น
io.on('connection', (socket) => {
  console.log(`[+] ผู้เล่นเชื่อมต่อเข้ามาแล้ว ID: ${socket.id}`);

  // สุ่มตำแหน่งเกิดซ้าย-ขวาเล็กน้อยอัตโนมัติ เพื่อไม่ให้ตัวละครทับกันเวลาคนอื่นแจมเข้ามา
  let randomX = 180 + (Object.keys(players).length * 50) % 400;

  // กำหนดค่าเริ่มต้น (เล่นคนเดียวได้ทันทีโดยไม่ต้องรอใคร)
  players[socket.id] = {
    x: randomX,
    y: 1100,
    aim: 0,
    hp: 100
  };

  let lastShot = 0;

  socket.on('error', (err) => console.error(`[!] socket error ${socket.id}:`, err));

  // รับพิกัดและการเคลื่อนไหวจากผู้เล่นแบบเรียลไทม์
  socket.on('player-move', (data) => {
    try {
      const p = players[socket.id];
      // เดิม data เป็น null/ไม่ใช่ object แล้ว data.x พัง → เซิร์ฟเวอร์ล่ม
      if (!p || !data || typeof data !== 'object') return;
      p.x = num(data.x, -5000, 5000, p.x);
      p.y = num(data.y, -5000, 5000, p.y);
      p.aim = num(data.aim, -1000, 1000, p.aim);
      p.hp = num(data.hp, 0, 1000, p.hp);
    } catch (err) {
      console.error('[!] player-move:', err);
    }
  });

  // รับข้อมูลเมื่อผู้เล่นยิงกระสุน
  socket.on('shoot', (bulletData) => {
    try {
      if (!players[socket.id] || !bulletData || typeof bulletData !== 'object') return;

      const now = Date.now();
      if (now - lastShot < MIN_SHOOT_INTERVAL_MS) return; // ยิงถี่เกิน
      lastShot = now;

      if (bullets.length >= MAX_BULLETS) return;
      let mine = 0;
      for (const b of bullets) if (b.playerId === socket.id) mine++;
      if (mine >= MAX_BULLETS_PER_PLAYER) return;

      bullets.push({
        id: newId(),
        playerId: socket.id,
        x: num(bulletData.x, -5000, 5000, players[socket.id].x),
        y: num(bulletData.y, -5000, 5000, players[socket.id].y),
        vx: num(bulletData.vx, -3000, 3000, 0),
        vy: num(bulletData.vy, -3000, 3000, 0),
        born: now
      });
    } catch (err) {
      console.error('[!] shoot:', err);
    }
  });

  // เมื่อผู้เล่นออกจากเกม หรือปิดหน้าเว็บ
  socket.on('disconnect', () => {
    console.log(`[-] ผู้เล่นออกจากเกม ID: ${socket.id}`);
    delete players[socket.id];
    bullets = bullets.filter(b => b.playerId !== socket.id); // ลบกระสุนของคนที่ออกไปด้วย
    io.emit('update-players', players);
  });
});

// รันพอร์ตบนเซิร์ฟเวอร์ Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`>>> เซิร์ฟเวอร์เกมกำลังรันอยู่ที่พอร์ต ${PORT} <<<`);
});

