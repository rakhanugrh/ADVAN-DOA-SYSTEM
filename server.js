const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. KONFIGURASI KREDENSIAL & ENVIRONMENT
// ==========================================

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://YOUR_SUPABASE_PROJECT.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'YOUR_SUPABASE_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Cloudinary Configuration (Root Key)
cloudinary.config({
  cloud_name: 'nb1uorww',
  api_key: '478548514282719',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'PASTE_API_SECRET_ROOT_ASLI_DISINI'
});

// Nodemailer SMTP Configuration
const SENDER_EMAIL = process.env.EMAIL_USER || 'admin.support@advan.co.id';
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: SENDER_EMAIL,
    pass: process.env.EMAIL_PASS || 'YOUR_GMAIL_APP_PASSWORD'
  }
});

// Multer Memory Storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

const uploadToCloudinary = (fileBuffer, folderName) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderName, resource_type: 'auto' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

const parseCSV = (bufferText) => {
  const lines = bufferText.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    if (values.length === headers.length) {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index];
      });
      results.push(obj);
    }
  }
  return results;
};

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Endpoint Login Admin
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const { data: admin, error } = await supabase
      .from('admin_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (error || !admin) {
      return res.status(401).json({ success: false, message: 'Username atau password salah!' });
    }

    res.json({ success: true, message: 'Login berhasil!', username: admin.username });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal melakukan verifikasi akun.' });
  }
});

// Endpoint Submit Form Klaim DOA
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const noTiket = 'DOA-' + Date.now();
    const fileUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const cloudResult = await uploadToCloudinary(file.buffer, `advan-doa/${noTiket}`);
        fileUrls.push({
          url: cloudResult.secure_url,
          public_id: cloudResult.public_id,
          resource_type: cloudResult.resource_type,
          created_at: new Date()
        });
      }
    }

    const { error: dbError } = await supabase
      .from('doa_tickets')
      .insert([{
        no_tiket: noTiket,
        nama: req.body.nama,
        perusahaan: req.body.perusahaan || null,
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

    res.json({ success: true, message: 'Pengajuan tiket berhasil dikirim!', noTiket });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal memproses pengajuan: ' + err.message });
  }
});

// Endpoint Get All Tickets
app.get('/api/doa/tickets', async (req, res) => {
  try {
    const { data: tickets, error } = await supabase
      .from('doa_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tickets });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint Action Status
app.post('/api/doa/action', async (req, res) => {
  const { noTiket, statusBaru } = req.body;

  try {
    const { error } = await supabase
      .from('doa_tickets')
      .update({ status: statusBaru, updated_at: new Date() })
      .eq('no_tiket', noTiket);

    if (error) throw error;
    res.json({ success: true, message: `Status tiket #${noTiket} berhasil diubah.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint IMPORT CSV
app.post('/api/doa/import-csv', upload.single('fileCsv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'File CSV tidak ditemukan.' });
    }

    const fileContent = req.file.buffer.toString('utf-8');
    const records = parseCSV(fileContent);

    if (records.length === 0) {
      return res.status(400).json({ success: false, message: 'Format CSV kosong atau tidak valid.' });
    }

    const payloadInsert = records.map((row, idx) => ({
      no_tiket: row.no_tiket || ('DOA-IMP-' + Date.now() + '-' + idx),
      nama: row.nama || 'Tanpa Nama',
      perusahaan: row.perusahaan || null,
      email: row.email || null,
      nowa: row.nowa || null,
      kategori: row.kategori || 'Umum',
      tipe_unit: row.tipe_unit || row.tipeUnit || '-',
      sn_unit: row.sn_unit || row.snUnit || '-',
      keluhan: row.keluhan || '-',
      status: row.status || 'Pending',
      file_urls: '[]'
    }));

    const { error } = await supabase.from('doa_tickets').insert(payloadInsert);
    if (error) throw error;

    res.json({ success: true, message: `Berhasil mengimpor ${payloadInsert.length} data tiket!` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal mengimpor CSV: ' + err.message });
  }
});

// ==========================================
// 4. AUTO-DELETE MEDIA > 30 HARI
// ==========================================
setInterval(async () => {
  try {
    const batasWaktu = new Date();
    batasWaktu.setDate(batasWaktu.getDate() - 30);

    const { data: oldTickets } = await supabase
      .from('doa_tickets')
      .select('no_tiket, file_urls')
      .lt('created_at', batasWaktu.toISOString());

    if (oldTickets && oldTickets.length > 0) {
      for (const ticket of oldTickets) {
        if (ticket.file_urls) {
          const files = JSON.parse(ticket.file_urls);
          for (const file of files) {
            if (file.public_id) {
              await cloudinary.uploader.destroy(file.public_id, { resource_type: file.resource_type || 'image' });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Auto cleanup error:', err);
  }
}, 24 * 60 * 60 * 1000);

// ==========================================
// 5. EXPORT VERCEL SERVERLESS
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Server lokal jalan di port ${PORT}`));
}

module.exports = app;