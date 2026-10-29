const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');

const app = express();
const JWT_SECRET = 'advan-doa-secret-key-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Menyajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Multer untuk Upload File (Tmp storage untuk Serverless)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = '/tmp/uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Helper membaca data tiket
const getTickets = () => {
  const filePath = path.join(__dirname, 'doa_tickets.json');
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data || '[]');
  } catch (err) {
    return [];
  }
};

// Middleware Autentikasi Admin
const requireAdminAuth = (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Akses ditolak. Silakan login.' });
  }
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.admin = verified;
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Token tidak valid.' });
  }
};

// Dummy Notifikasi
async function sendNotification(email, phone, subject, messageWA, htmlEmail) {
  console.log(`[NOTIFIKASI] Mengirim ke Email: ${email} | WA: ${phone}`);
}

// ROUTE API

// 1. Submit Klaim Garansi DOA
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const tickets = getTickets();
    const noTiket = 'DOA-' + Date.now();
    
    const newTicket = {
      noTiket,
      nama: req.body.nama,
      perusahaan: req.body.perusahaan,
      email: req.body.email,
      nowa: req.body.nowa,
      tipeUnit: req.body.tipeUnit,
      snUnit: req.body.snUnit,
      keluhan: req.body.keluhan,
      status: 'Pending',
      tanggal: new Date().toISOString(),
      files: req.files ? req.files.map(f => f.filename) : []
    };

    tickets.push(newTicket);
    
    // Simpan ke tmp jika di serverless
    try {
      fs.writeFileSync(path.join(__dirname, 'doa_tickets.json'), JSON.stringify(tickets, null, 2));
    } catch (e) {
      console.log('Penyimpanan lokal bersifat sementara di Serverless.');
    }

    const subject = `[BERHASIL] Pengajuan Klaim Garansi DOA Advan #${noTiket}`;
    const pesanWA = `Halo Kak *${newTicket.nama}*, Klaim Garansi DOA unit *${newTicket.tipeUnit}* berhasil diterima dengan Nomor Tiket: *${noTiket}*.`;
    const htmlEmail = `<h2>Pengajuan Klaim Berhasil</h2><p>Nomor Tiket Anda: <b>${noTiket}</b></p>`;

    await sendNotification(newTicket.email, newTicket.nowa, subject, pesanWA, htmlEmail);

    res.json({ success: true, message: 'Pengajuan berhasil dikirim!', noTiket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memproses pengajuan.' });
  }
});

// 2. Login Admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('admin_token', token, { httpOnly: true });
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah!' });
});

// 3. Get Semua Tiket (Admin)
app.get('/api/doa/tickets', requireAdminAuth, (req, res) => {
  const tickets = getTickets();
  res.json({ success: true, tickets });
});

// 4. Action Admin (Approve / Reject)
app.post('/api/doa/action', requireAdminAuth, async (req, res) => {
  const { noTiket, action } = req.body;
  const tickets = getTickets();
  const ticket = tickets.find(t => t.noTiket === noTiket);

  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
  }

  ticket.status = action === 'approve' ? 'Approved' : 'Rejected';

  let subject, pesanWA, htmlEmail;
  if (action === 'approve') {
    subject = `[APPROVED] Hasil Pemeriksaan Garansi DOA Advan #${noTiket}`;
    pesanWA = `Halo Kak *${ticket.nama}*, klaim Garansi DOA unit *${ticket.tipeUnit}* disetujui.`;
    htmlEmail = `<h2 style="color: green;">Klaim Garansi DOA Disetujui</h2><p>Nomor Tiket: <b>${noTiket}</b></p>`;
  } else {
    subject = `[REJECTED] Hasil Pemeriksaan Garansi DOA Advan #${noTiket}`;
    pesanWA = `Halo Kak *${ticket.nama}*, mohon maaf klaim Garansi DOA unit *${ticket.tipeUnit}* ditolak.`;
    htmlEmail = `<h2 style="color: red;">Klaim Garansi DOA Ditolak</h2><p>Nomor Tiket: <b>${noTiket}</b></p>`;
  }

  await sendNotification(ticket.email, ticket.nowa, subject, pesanWA, htmlEmail);

  res.json({ success: true, message: `Status #${noTiket} diubah menjadi ${action} & Notifikasi terkirim!` });
});

// Jalankan Server Lokal
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`System DOA Advan berjalan di: http://localhost:${PORT}`);
});

// Wajib dikirimkan untuk Serverless Vercel
module.exports = app;