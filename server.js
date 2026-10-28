const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// อนุญาตให้หน้าเว็บเกมทุกที่สามารถเข้าถึงและรับส่งข้อมูล Socket ได้
app.use(cors());

// เส้นทางสำหรับเช็คว่าเซิร์ฟเวอร์ยังทำงานอยู่ไหม
app.get('/', (req, res) => {
  res.send('Fish Game Server is Online!');
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // รองรับการเชื่อมต่อจากทุกโดเมน (เช่น GitHub Pages)
    methods: ["GET", "POST"]
  }
});

// เก็บข้อมูลผู้เล่นทุกคนที่กำลังออนไลน์ในขณะนั้น
let players = {};

io.on('connection', (socket) => {
  console.log(`[+] มีผู้เล่นเข้ามาใหม่ Socket ID: ${socket.id}`);

  // กำหนดข้อมูลเริ่มต้นเมื่อผู้เล่นเชื่อมต่อเข้ามา
  players[socket.id] = {
    x: 180,
    y: 320,
    aim: 0,
    hp: 100
  };

  // รับค่าตำแหน่งและการกระทำของผู้เล่นจากฝั่งหน้าเว็บ
  socket.on('player-move', (data) => {
    if (players[socket.id]) {
      players[socket.id] = data;
    }
    // กระจายตำแหน่งผู้เล่นทุกคนในห้องส่งกลับไปให้ทุกๆ เครื่องอัปเดตหน้าจอ
    io.emit('update-players', players);
  });

  // เมื่อผู้เล่นกดปิดเว็บ หรือหลุดการเชื่อมต่อ
  socket.on('disconnect', () => {
    console.log(`[-] ผู้เล่นออกจากเกม Socket ID: ${socket.id}`);
    delete players[socket.id];
    // อัปเดตรายชื่อผู้เล่นที่เหลือส่งกลับไปให้เครื่องที่เหลือ
    io.emit('update-players', players);
  });
});

// รันเซิร์ฟเวอร์รองรับ พอร์ต Dynamic บน Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`>>> เซิร์ฟเวอร์เกมรันอยู่ที่พอร์ต ${PORT} <<<`);
});
