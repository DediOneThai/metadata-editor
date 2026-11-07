# Metadata Editor - Foto & Video

Aplikasi web sederhana untuk membaca, mengubah, dan menghapus metadata pada file foto (JPEG).

## Fitur Saat Ini

- Upload foto JPEG
- Baca metadata EXIF (tanggal, kamera, GPS, dll)
- Edit beberapa field metadata penting
- Hapus semua metadata (privacy)
- Download foto yang sudah diubah
- **Semua proses berjalan di browser** (file tidak dikirim ke server)

## Cara Menggunakan

1. Buka file `index.html` di browser, atau deploy ke GitHub Pages / Netlify / Vercel.
2. Pilih file foto (JPEG).
3. Lihat metadata yang ada.
4. Ubah field yang diinginkan lalu klik **Simpan Metadata**.
5. Atau klik **Hapus Semua Metadata** untuk membersihkan data sensitif.

## Teknologi

- Pure HTML + JavaScript (tanpa framework)
- [exifr](https://github.com/MikeKovarik/exifr) untuk membaca metadata
- [piexifjs](https://github.com/hMatoba/piexifjs) untuk menulis ulang EXIF

## Catatan

- Saat ini fokus ke **foto JPEG**. Dukungan video akan ditambahkan kemudian (menggunakan FFmpeg.wasm).
- Beberapa metadata (seperti GPS) perlu format khusus. Versi ini fokus pada field yang paling sering diubah.

## Cara Deploy Cepat (GitHub Pages)

1. Settings → Pages
2. Source: Deploy from a branch → `main` / root
3. Selesai. Aplikasi akan tersedia di `https://semutservercomback-png.github.io/metadata-editor/`

---

Dibuat untuk keperluan pribadi / edukasi.
