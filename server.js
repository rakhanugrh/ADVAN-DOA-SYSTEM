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

// Cloudinary Configuration (Menggunakan Root Key kamu)
cloudinary.config({
  cloud_name: 'nb1uorww',
  api_key: '478548514282719',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'PwUq1jaEm2TRcK_6YEDqJyzjLbw'
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

// Multer Storage (Memory Storage untuk buffer upload langsung ke Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // Batas max 100MB per file
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

// Helper Upload Stream ke Cloudinary
const uploadToCloudinary = (fileBuffer, folderName) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: 'auto' // Otomatis mendeteksi Gambar maupun Video
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

// Helper Template Email HTML Pengajuan Baru
const generateSubmitEmailHTML = (noTiket, body) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; }
        .container { max-width: 600px; background: #ffffff; margin: 0 auto; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
        .header { background-color: #0f172a; padding: 25px; text-align: center; }
        .content { padding: 30px; color: #334155; line-height: 1.6; }
        .ticket-badge { background: #e0f2fe; color: #0369a1; padding: 6px 12px; border-radius: 6px; font-weight: bold; font-size: 14px; }
        .detail-box { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin: 20px 0; }
        .detail-row { padding: 6px 0; border-bottom: 1px dashed #cbd5e1; font-size: 14px; }
        .footer { background-color: #f1f5f9; text-align: center; padding: 15px; font-size: 12px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="color: #ffffff; margin:0;">ADVAN GARANSI DOA</h2>
        </div>
        <div class="content">
          <h2>Halo, ${body.nama}! 👋</h2>
          <p>Terima kasih telah mengajukan klaim garansi <b>Dead on Arrival (DOA)</b>. Pengajuan Anda telah kami terima dan sedang diproses oleh tim Quality Control (QC).</p>
          
          <div class="detail-box">
            <div class="detail-row"><b>Nomor Tiket:</b> <span class="ticket-badge">${noTiket}</span></div>
            <div class="detail-row"><b>Perusahaan/Toko:</b> ${body.perusahaan || '-'}</div>
            <div class="detail-row"><b>Tipe Unit:</b> ${body.tipeUnit}</div>
            <div class="detail-row"><b>Serial Number (SN):</b> ${body.snUnit}</div>
            <div class="detail-row"><b>Kategori Kendala:</b> ${body.kategori}</div>
          </div>

          <p><b>Keluhan yang Dilaporkan:</b><br><i>"${body.keluhan}"</i></p>

          <p>Tim kami akan melakukan verifikasi fisik dan fungsional unit. Update status akan kami kirimkan ke email ini secara berkala.</p>
        </div>
        <div class="footer">
          &copy; 2026 ADVAN Indonesia - Service Center & Quality Control
        </div>
      </div>
    </body>
    </html>
  `;
};

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Endpoint Submit Form Klaim DOA
app.post('/api/doa/submit', upload.array('files'), async (req, res) => {
  try {
    const noTiket = 'DOA-' + Date.now();
    const fileUrls = [];

    // 1. Upload File (Foto/Video) ke Cloudinary jika ada
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

    // 2. Simpan Data Log Teks ke Supabase
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

    // 3. Kirim Email Konfirmasi Otomatis ke User
    if (req.body.email) {
      const mailOptions = {
        from: `"Advan Service Center" <${SENDER_EMAIL}>`,
        to: req.body.email,
        subject: `[Klaim Garansi DOA] Tiket Berhasil Dibuat #${noTiket}`,
        html: generateSubmitEmailHTML(noTiket, req.body)
      };
      
      transporter.sendMail(mailOptions, (err) => {
        if (err) console.error('Gagal mengirim email konfirmasi:', err);
      });
    }

    res.json({ 
      success: true, 
      message: 'Pengajuan tiket berhasil dikirim!', 
      noTiket 
    });

  } catch (err) {
    console.error('Submit Error:', err);
    res.status(500).json({ success: false, message: 'Gagal memproses pengajuan: ' + err.message });
  }
});

// Endpoint Get All Tickets (Untuk Dashboard Admin)
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

// Endpoint Action Status (Approved / Rejected) oleh Admin
app.post('/api/doa/action', async (req, res) => {
  const { noTiket, statusBaru, emailUser, namaUser } = req.body;

  try {
    // 1. Update Status di Supabase Database
    const { error } = await supabase
      .from('doa_tickets')
      .update({ status: statusBaru, updated_at: new Date() })
      .eq('no_tiket', noTiket);

    if (error) throw error;

    // 2. Kirim Email Notification Update Status
    if (emailUser) {
      const isApproved = statusBaru === 'Approved';
      const mailOptions = {
        from: `"Advan Service Center" <${SENDER_EMAIL}>`,
        to: emailUser,
        subject: `[Update Status DOA] Tiket #${noTiket} - ${statusBaru}`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h3>Halo, ${namaUser}</h3>
            <p>Pengajuan Garansi DOA Anda dengan tiket <b>#${noTiket}</b> telah diperbarui.</p>
            <p style="font-size: 16px;"><b>STATUS: <span style="color: ${isApproved ? 'green' : 'red'};">${statusBaru.toUpperCase()}</span></b></p>
            <p>${isApproved ? 'Silakan lanjutkan pengiriman unit sesuai instruksi tim kami.' : 'Pengajuan Anda ditolak berdasarkan evaluasi tim QC.'}</p>
          </div>
        `
      };
      transporter.sendMail(mailOptions);
    }

    res.json({ success: true, message: `Status tiket #${noTiket} berhasil diubah menjadi ${statusBaru}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// 4. AUTO-DELETE MEDIA HAPUS MEDIA > 30 HARI
// ==========================================
// Menjalankan tugas pembersihan setiap 24 jam sekali
setInterval(async () => {
  try {
    console.log('🧹 Menjalankan tugas rutin pembersihan media lama...');
    const batasWaktu = new Date();
    batasWaktu.setDate(batasWaktu.getDate() - 30); // Batas 30 Hari yang lalu

    // Ambil data tiket lama yang melebihi 30 hari dari Supabase
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
              // Hapus media fisik dari Cloudinary berdasarkan resource_type
              await cloudinary.uploader.destroy(file.public_id, { resource_type: file.resource_type || 'image' });
            }
          }
        }
      }
      console.log(`✅ Berhasil membersihkan media dari ${oldTickets.length} tiket lama.`);
    }
  } catch (err) {
    console.error('❌ Gagal menjalankan auto-cleanup:', err);
  }
}, 24 * 60 * 60 * 1000); // 24 Jam

// Run Server
app.listen(PORT, () => {
  console.log(`🚀 Server Advan DOA berjalan di port ${PORT}`);
});