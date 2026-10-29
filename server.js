const express = require('express');
const nodemailer = require('nodemailer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const JWT_SECRET = 'advan_qc_secret_key_12345';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// KREDENSIAL LOGIN ADMIN
const ADMIN_USER = {
  username: 'admin',
  password: 'advanpassword123'
};

// MIDDLEWARE PROTEKSI ROUTE ADMIN
const requireAdminAuth = (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) {
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ success: false, message: 'Akses ditolak. Silakan login terlebih dahulu!' });
    }
    return res.redirect('/login.html');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    res.clearCookie('admin_token');
    if (req.xhr || req.headers.accept?.includes('json')) {
      return res.status(401).json({ success: false, message: 'Sesi habis. Silakan login kembali.' });
    }
    return res.redirect('/login.html');
  }
};

// PUBLIC STATIC FILES (Kecuali admin.html)
app.use((req, res, next) => {
  if (req.path === '/admin.html') {
    return requireAdminAuth(req, res, () => {
      res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    });
  }
  express.static(path.join(__dirname, 'public'))(req, res, next);
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage }).fields([
  { name: 'fotoProduk', maxCount: 5 },
  { name: 'videoProduk', maxCount: 2 }
]);

const DATA_FILE = path.join(__dirname, 'doa_tickets.json');
const getTickets = () => fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE)) : [];
const saveTickets = (tickets) => fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'email.purnajual@gmail.com',
    pass: 'xxxx xxxx xxxx xxxx'
  }
});

async function sendNotification(email, noWa, subject, pesanWA, htmlEmail) {
  const waPromise = axios.post('https://api.fonnte.com/send', {
    target: noWa,
    message: pesanWA
  }, {
    headers: { 'Authorization': 'TOKEN_FONNTE_KAMU' }
  }).catch(err => console.log("Gagal kirim WA:", err.message));

  const emailPromise = transporter.sendMail({
    from: '"Advan Service Center" <email.purnajual@gmail.com>',
    to: email,
    subject: subject,
    html: htmlEmail
  }).catch(err => console.log("Gagal kirim Email:", err.message));

  await Promise.all([waPromise, emailPromise]);
}

// ---------------- AUTH ENDPOINTS ----------------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER.username && password === ADMIN_USER.password) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '8h' });
    
    res.cookie('admin_token', token, {
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000
    });

    return res.json({ success: true, message: 'Login berhasil!' });
  }

  res.status(401).json({ success: false, message: 'Username atau Password salah!' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true, message: 'Logout berhasil' });
});

// ---------------- DOA CLAIM ENDPOINTS ----------------

app.post('/api/doa/submit', (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: 'Gagal upload file: ' + err.message });
    }

    const { nama, perusahaan, alamat, kota, email, noWa, tipeProduk, modelProduk, serialNumber, catatan } = req.body;
    
    if (!nama || !perusahaan || !alamat || !kota || !email || !noWa || !tipeProduk || !modelProduk || !serialNumber || !catatan) {
      return res.status(400).json({ success: false, message: 'Semua kolom input wajib diisi!' });
    }

    const videoFiles = req.files && req.files['videoProduk'] ? req.files['videoProduk'] : [];
    if (videoFiles.length === 0) {
      return res.status(400).json({ success: false, message: 'Minimal 1 video unboxing/kendala WAJIB diunggah!' });
    }

    const fotoFiles = req.files && req.files['fotoProduk'] ? req.files['fotoProduk'] : [];
    const noTiket = 'DOA-' + Date.now().toString().slice(-6);
    const fotoUrls = fotoFiles.map(file => '/uploads/' + file.filename);
    const videoUrls = videoFiles.map(file => '/uploads/' + file.filename);

    const newTicket = {
      noTiket,
      nama,
      perusahaan,
      alamat,
      kota,
      email,
      noWa,
      tipeProduk,
      modelProduk,
      serialNumber,
      catatan,
      fotoUrls,
      videoUrls,
      status: 'PENDING',
      createdAt: new Date().toLocaleString('id-ID')
    };

    const tickets = getTickets();
    tickets.unshift(newTicket);
    saveTickets(tickets);

    const pesanWA = `Halo Kak *${nama}* (*${perusahaan}* - *${kota}*),\n\nPengajuan Garansi DOA unit *${tipeProduk} ${modelProduk}* (SN: *${serialNumber}*) berhasil diterima.\n\n*Nomor Tiket:* #${noTiket}\n*Status:* Dalam Pemeriksaan QC Advan.\n\n_Tim After-Sales Advan_`;
    const htmlEmail = `<p>Halo <b>${nama}</b> (<b>${perusahaan}</b>, ${kota}),</p><p>Klaim Garansi DOA Anda (#${noTiket}) untuk produk <b>${tipeProduk} ${modelProduk}</b> telah terdaftar.</p>`;

    await sendNotification(email, noWa, `[Garansi DOA] #${noTiket}`, pesanWA, htmlEmail);

    res.json({ success: true, message: `Klaim berhasil dikirim! Nomor Tiket Anda: #${noTiket}` });
  });
});

app.get('/api/doa/list', requireAdminAuth, (req, res) => {
  res.json(getTickets());
});

app.post('/api/doa/action', requireAdminAuth, async (req, res) => {
  const { noTiket, action, alasan } = req.body;
  const tickets = getTickets();
  const ticket = tickets.find(t => t.noTiket === noTiket);

  if (!ticket) return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan' });

  ticket.status = action;
  ticket.alasanStatus = alasan || '-';
  saveTickets(tickets);

  let pesanWA, htmlEmail, subject;

  if (action === 'APPROVED') {
    subject = `[APPROVED] Penggantian Unit DOA Advan #${noTiket}`;
    pesanWA = `Selamat Kak *${ticket.nama}* (*${ticket.perusahaan}*)!\n\nKlaim Garansi DOA unit *${ticket.tipeProduk} ${ticket.modelProduk}* (#${noTiket}) telah *DISETUJUI (APPROVED)*.\n\nCatatan QC: ${alasan}`;
    htmlEmail = `<h2 style="color: green;">Klaim Garansi DOA Disetujui</h2><p>Halo <b>${ticket.nama}</b> (${ticket.perusahaan}), klaim unit <b>${ticket.tipeProduk} ${ticket.modelProduk}</b> Anda telah <b>APPROVED</b>.</p><p><b>Catatan QC:</b> ${alasan}</p>`;
  } else {
    subject = `[REJECTED] Hasil Pemeriksaan Garansi DOA Advan #${noTiket}`;
    pesanWA = `Halo Kak *${ticket.nama}* (*${ticket.perusahaan}*),\n\nMohon maaf, klaim Garansi DOA unit *${ticket.tipeProduk} ${ticket.modelProduk}* (#${noTiket}) *DITOLAK (REJECTED)*.\n\nAlasan: ${alasan}`;
    htmlEmail = `<h2 style="color: red;">Klaim Garansi DOA Ditolak</h2><p>Halo <b>${ticket.nama}</b> (${ticket.perusahaan}), klaim garansi DOA ditolak.</p><p><b>Alasan Penolakan:</b> ${alasan}</p>`;
  }

  await sendNotification(ticket.email, ticket.noWa, subject, pesanWA, htmlEmail);

  res.json({ success: true, message: `Status #${noTiket} diubah menjadi ${action} & Notifikasi terkirim!` });
});

app.listen(3000, () => {
  console.log('System DOA Advan berjalan di: http://localhost:3000');
});