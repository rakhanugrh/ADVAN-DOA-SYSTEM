const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const JWT_SECRET = 'advan-doa-secret-key-2026';

// Konfigurasi Supabase
const SUPABASE_URL = 'https://ncmixiohzzvqbupigvlo.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_WU6JONEkQQInzX1-NiCQjg_MicYa1z1'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer Upload untuk Vercel Serverless
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = '/tmp/uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Middleware Admin Auth
const requireAdminAuth = (req, res, next) => {
  const token = req.cookies.admin_token;
  if (!token) return res.status(401).json({ success: false, message: 'Silakan login.' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ success: false, message: 'Token tidak valid.' });
  }
};

// API 1: Login Admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('admin_token', token, { httpOnly: true });
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah!' });
});

// API 2: Submit Tiket (User) -> Simpan Ke Supabase
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const noTiket = 'DOA-' + Date.now();
    const { data, error } = await supabase
      .from('doa_tickets')
      .insert([{
        no_tiket: noTiket,
        nama: req.body.nama,
        perusahaan: req.body.perusahaan,
        email: req.body.email,
        nowa: req.body.nowa,
        kategori: req.body.kategori,
        tipe_unit: req.body.tipeUnit,
        sn_unit: req.body.snUnit,
        keluhan: req.body.keluhan,
        status: 'Pending'
      }]);

    if (error) throw error;
    res.json({ success: true, message: 'Pengajuan berhasil dikirim!', noTiket });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan ke database.' });
  }
});

// API 3: Get Tiket (Admin) -> Ambil Dari Supabase
app.get('/api/doa/tickets', requireAdminAuth, async (req, res) => {
  try {
    const { data: tickets, error } = await supabase
      .from('doa_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data tiket.' });
  }
});

// API 4: Action Admin (Approve/Reject)
app.post('/api/doa/action', requireAdminAuth, async (req, res) => {
  try {
    const { noTiket, action } = req.body;
    const statusBaru = action === 'approve' ? 'Approved' : 'Rejected';

    const { error } = await supabase
      .from('doa_tickets')
      .update({ status: statusBaru })
      .eq('no_tiket', noTiket);

    if (error) throw error;
    res.json({ success: true, message: `Status tiket diubah menjadi ${statusBaru}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengubah status.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;