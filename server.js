const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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
  }
});

// เก็บข้อมูลเกมทั้งหมด (ผู้เล่น, ปลา, กระสุน, บอส, เวฟ)
let players = {};
let fishes = [];
let bullets = [];
let boss = null;
let wave = 1;

// ลูปหลักของเซิร์ฟเวอร์ (ทำงาน 30 ครั้งต่อวินาที เพื่อซิงค์ทุกอย่างให้ตรงกัน)
setInterval(() => {
  // 1. สุ่มสร้างปลาเข้ามาในเกม (ถ้าปลาน้อยกว่า 15 ตัว)
  if (fishes.length < 15) {
    fishes.push({
      id: Math.random().toString(36).substr(2, 9),
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

  // 3. ส่งข้อมูลสถานะเกมทั้งหมด (Game State) กลับไปให้ผู้เล่นทุกคนเห็นเหมือนกัน
  io.emit('game-state', { players, fishes, bullets, boss, wave });

}, 1000 / 30);

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

  // รับพิกัดและการเคลื่อนไหวจากผู้เล่นแบบเรียลไทม์
  socket.on('player-move', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].aim = data.aim;
      players[socket.id].hp = data.hp;
    }
  });

  // รับข้อมูลเมื่อผู้เล่นยิงกระสุน
  socket.on('shoot', (bulletData) => {
    bullets.push({
      id: Math.random().toString(36).substr(2, 9),
      playerId: socket.id,
      x: bulletData.x,
      y: bulletData.y,
      vx: bulletData.vx,
      vy: bulletData.vy
    });
  });

  // เมื่อผู้เล่นออกจากเกม หรือปิดหน้าเว็บ
  socket.on('disconnect', () => {
    console.log(`[-] ผู้เล่นออกจากเกม ID: ${socket.id}`);
    delete players[socket.id];
    io.emit('update-players', players);
  });
});

// รันพอร์ตบนเซิร์ฟเวอร์ Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`>>> เซิร์ฟเวอร์เกมกำลังรันอยู่ที่พอร์ต ${PORT} <<<`);
});
