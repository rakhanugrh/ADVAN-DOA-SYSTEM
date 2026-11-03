const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Supabase Safe Initialization
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.error('Supabase Init Error:', e);
  }
}

// Cloudinary Safe Initialization
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// 1. API Cloudinary Signature
app.get('/api/doa/cloudinary-signature', (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'advan_doa_uploads';
    const transformation = 'q_auto,f_auto';

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder, transformation },
      process.env.CLOUDINARY_API_SECRET || ''
    );

    res.json({
      signature,
      timestamp,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
      api_key: process.env.CLOUDINARY_API_KEY || '',
      folder,
      transformation
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Gagal membuat signature Cloudinary' });
  }
});

// 2. API Submit Tiket
app.post('/api/doa/submit', async (req, res) => {
  try {
    if (!supabase) throw new Error('Database Supabase belum terkoneksi');

    const { nama, perusahaan, email, nowa, kota, alamat, kategori, tipeUnit, snUnit, keluhan, directFiles } = req.body;
    const mediaFiles = directFiles ? JSON.parse(directFiles) : [];
    const noTiket = 'DOA-' + Date.now().toString().slice(-6);

    const { data, error } = await supabase
      .from('doa_tickets')
      .insert([{
        no_tiket: noTiket,
        nama,
        perusahaan,
        email,
        nowa,
        kota: kota || '',
        alamat: alamat || '',
        kategori,
        tipe_unit: tipeUnit,
        sn_unit: snUnit,
        keluhan,
        files: mediaFiles,
        status: 'Pending',
        created_at: new Date()
      }]);

    if (error) throw error;
    res.json({ success: true, noTiket, message: 'Tiket berhasil dibuat!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Gagal menyimpan tiket' });
  }
});

// 3. API Login Handler (PASTI RESPON JSON 200 OK)
const handleLogin = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const { username, password } = req.body || {};

    // Bypass Utama: admin / admin123
    if (username === 'admin' && password === 'admin123') {
      return res.status(200).json({ success: true, message: 'Login berhasil!' });
    }

    // Secondary DB Check
    if (supabase) {
      const { data } = await supabase
        .from('admin_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

      if (data) {
        return res.status(200).json({ success: true, message: 'Login berhasil!' });
      }
    }

    return res.status(200).json({ success: false, message: 'Username atau password salah!' });
  } catch (err) {
    console.error('Login Route Error:', err);
    return res.status(200).json({ success: false, message: 'Terjadi gangguan internal server' });
  }
};

app.post('/api/login', handleLogin);
app.post('/api/admin/login', handleLogin);

// 4. API Dashboard Admin
app.get('/api/admin/tickets', async (req, res) => {
  try {
    if (!supabase) throw new Error('Database tidak terkoneksi');
    const { data, error } = await supabase
      .from('doa_tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, tickets: data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Serve HTML
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
module.exports = app;