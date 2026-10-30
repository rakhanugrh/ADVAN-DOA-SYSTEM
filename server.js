const express = require('express');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const JWT_SECRET = 'advan-doa-secret-key-2026';

// Konfigurasi Supabase
const SUPABASE_URL = 'https://ncmixiohzzvqbupigvlo.supabase.co'; 
const SUPABASE_KEY = 'sb_publishable_WU6JONEkQQInzX1-NiCQjg_MicYa1z1'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Konfigurasi Transporter Nodemailer (Gmail)
const SENDER_EMAIL = 'emailkamu@gmail.com'; 
const SENDER_APP_PASSWORD = 'abcd efgh ijkl mnop'; 

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER_EMAIL, pass: SENDER_APP_PASSWORD }
});

// ==========================================
// FITUR CYBER SECURITY (100% GRATIS)
// ==========================================

// 1. Amankan HTTP Header dari vulnerability umum
app.use(helmet({ contentSecurityPolicy: false }));

// 2. Anti Brute-Force Limiter khusus Halaman Login (Maks 5x Coba per 15 Menit)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 5, 
  message: { success: false, message: '🔒 Terlalu banyak percobaan login! Akses diblokir sementara. Coba lagi setelah 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 3. Helper Validator Magic Byte Biner (Deteksi File Jahat/Malware Mengubah Ekstensi)
const isValidFileMagicByte = (buffer) => {
  const hex = buffer.toString('hex', 0, 8).toUpperCase();
  const isJPEG = hex.startsWith('FFD8FF');
  const isPNG = hex.startsWith('89504E47');
  const isWEBP = hex.startsWith('52494646'); // RIFF header
  const isMP4orMOV = hex.includes('66747970'); // 'ftyp' header
  
  return isJPEG || isPNG || isWEBP || isMP4orMOV;
};

// Middleware Umum
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer Storage Memory
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 4.5 * 1024 * 1024 }
});

// Middleware Auth Admin
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

// Routing Utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. API Login Admin (Dilindungi Proteksi Anti Brute-Force Login)
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const { data: user } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (user) {
      const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '1d' });
      res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax' });
      return res.json({ success: true, message: 'Login berhasil!' });
    }
    res.status(401).json({ success: false, message: 'Username atau password salah!' });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Username atau password salah!' });
  }
});

// 2. API Register Admin Baru
app.post('/api/admin/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password wajib diisi!' });
    }

    const { data: existingUser } = await supabase
      .from('admin_users')
      .select('username')
      .eq('username', username)
      .single();

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username sudah terdaftar!' });
    }

    const { error: insertError } = await supabase
      .from('admin_users')
      .insert([{ username, password }]);

    if (insertError) throw insertError;
    res.json({ success: true, message: 'Akun admin berhasil dibuat! Silakan login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membuat akun admin.' });
  }
});

// 3. API Submit Tiket (User) + Validasi File Malware + Auto Send Email
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const noTiket = 'DOA-' + Date.now();
    const fileUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        
        // --- PROTEKSI CYBER: Cek Kebenaran Header Biner File (Sanitasi File) ---
        if (!isValidFileMagicByte(file.buffer)) {
          return res.status(400).json({ 
            success: false, 
            message: `⚠️ FILE DITOLAK! File '${file.originalname}' terdeteksi bukan gambar/video asli atau berpotensi bahaya.` 
          });
        }

        const fileExt = path.extname(file.originalname).toLowerCase();
        const fileName = `${noTiket}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

        let mimeType = file.mimetype;
        if (fileExt === '.mp4') mimeType = 'video/mp4';
        else if (fileExt === '.mov') mimeType = 'video/quicktime';
        else if (fileExt === '.webm') mimeType = 'video/webm';

        const { error: uploadError } = await supabase.storage
          .from('doa-files')
          .upload(fileName, file.buffer, {
            contentType: mimeType,
            upsert: true
          });

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage
            .from('doa-files')
            .getPublicUrl(fileName);
          
          if (publicUrlData && publicUrlData.publicUrl) {
            fileUrls.push({ url: publicUrlData.publicUrl, type: mimeType });
          }
        }
      }
    }

    // Simpan ke database Supabase
    const { error: dbError } = await supabase
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
        status: 'Pending',
        file_urls: JSON.stringify(fileUrls)
      }]);

    if (dbError) throw dbError;

    // Email Notification
    if (req.body.email && SENDER_EMAIL !== 'emailkamu@gmail.com') {
      const mailOptions = {
        from: `"Advan DOA Service Center" <${SENDER_EMAIL}>`,
        to: req.body.email,
        subject: `[Klaim Garansi DOA] Konfirmasi Pengajuan Tiket #${noTiket}`,
        html: `<p>Halo <b>${req.body.nama}</b>, pengajuan klaim garansi Anda (#${noTiket}) telah diterima.</p>`
      };
      transporter.sendMail(mailOptions).catch(err => console.error('Gagal Kirim Email:', err));
    }

    res.json({ success: true, message: 'Pengajuan berhasil dikirim!', noTiket });
  } catch (err) {
    console.error('Submit Error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan data pengajuan.' });
  }
});

// 4. API Ambil Data Tiket (Admin)
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

// 5. API Ubah Status (Approve/Reject)
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