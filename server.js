const express = require('express');
const path = require('path');
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer Storage Memory
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 4.5 * 1024 * 1024 } // Limit Vercel Serverless (Max 4.5MB)
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

// Routing Halaman Utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 1. API Login Admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === 'admin' && password === 'admin123') {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax' });
    return res.json({ success: true, message: 'Login berhasil!' });
  }
  res.status(401).json({ success: false, message: 'Username atau password salah!' });
});

// 2. API Submit Tiket (User) -> Upload dengan Explicit MIME Type Video
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const noTiket = 'DOA-' + Date.now();
    const fileUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const fileExt = path.extname(file.originalname).toLowerCase();
        const fileName = `${noTiket}/${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

        // Deteksi MIME Type Akurat
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
            fileUrls.push({ 
              url: publicUrlData.publicUrl, 
              type: mimeType 
            });
          }
        }
      }
    }

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
    res.json({ success: true, message: 'Pengajuan berhasil dikirim!', noTiket });
  } catch (err) {
    console.error('Submit Error:', err);
    res.status(500).json({ success: false, message: 'Gagal menyimpan data pengajuan.' });
  }
});

// 3. API Ambil Data Tiket (Admin)
app.get('/api/doa/tickets', requireAdminAuth, async (req, res) => {
  try {
    const { data: tickets, error } = await supabase
      .from('doa_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tickets });
  } catch (err) {
    console.error('Fetch Tickets Error:', err);
    res.status(500).json({ success: false, message: 'Gagal mengambil data tiket.' });
  }
});

// 4. API Ubah Status (Approve/Reject)
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
    console.error('Action Error:', err);
    res.status(500).json({ success: false, message: 'Gagal mengubah status.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;