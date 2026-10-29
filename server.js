const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const JWT_SECRET = 'advan-doa-secret-key-2026';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Menyajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Konfigurasi Multer Upload (Tmp storage untuk Vercel)
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

// Helper membaca data tiket lokal
const getTickets = () => {
  const filePath = path.join(__dirname, 'doa_tickets.json');
  if (!fs.existsSync(filePath)) return [];
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

// --- ROUTE API ---

// 1. Login Admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('admin_token', token, { httpOnly: true });
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah!' });
});

// 2. Submit Tiket DOA (User)
app.post('/api/doa/submit', upload.array('files'), (req, res) => {
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
      tanggal: new Date().toISOString()
    };

    tickets.push(newTicket);
    res.json({ success: true, message: 'Pengajuan berhasil dikirim!', noTiket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memproses pengajuan.' });
  }
});

// 3. Get Semua Tiket (Admin)
app.get('/api/doa/tickets', requireAdminAuth, (req, res) => {
  const tickets = getTickets();
  res.json({ success: true, tickets });
});

// 4. Action Admin (Approve / Reject)
app.post('/api/doa/action', requireAdminAuth, (req, res) => {
  const { noTiket, action } = req.body;
  const tickets = getTickets();
  const ticket = tickets.find(t => t.noTiket === noTiket);

  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
  }

  ticket.status = action === 'approve' ? 'Approved' : 'Rejected';
  res.json({ success: true, message: `Status #${noTiket} diubah menjadi ${action}` });
});

// Jalankan Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
});

module.exports = app;