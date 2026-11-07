# Creator Metadata Studio

Aplikasi web untuk membaca, mengubah, dan menghapus metadata foto & video.  
**Semua proses berjalan di browser. Tidak ada upload ke server.**

**Repository:** https://github.com/DediOneThai/metadata-editor

---

## Format yang Didukung

| Format | Baca metadata | Edit | Hapus metadata | Keterangan |
|--------|---------------|------|----------------|------------|
| **JPEG** | Lengkap | Ya | Ya | Paling bagus |
| **PNG** | Terbatas | Sebagian | Ya | Pakai cara re-encode |
| **MP4** | Ya | Ya | Ya | Pakai FFmpeg (stream copy) |
| **MOV** | Ya | Ya | Ya | Sama seperti MP4 |

---

## Fitur

- Upload banyak file sekaligus
- Lihat metadata sebelum & sesudah
- Edit judul, artist, copyright, kamera, tanggal
- Hapus semua metadata (privacy)
- Proses banyak file sekaligus (batch)
- Download satu-satu atau ZIP
- Semua proses lokal di browser

---

## Cara Menjalankan

### Langsung di komputer
Buka file `index.html` di browser (Chrome / Edge / Firefox).

### GitHub Pages
1. Masuk ke repository → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **main** → folder **/ (root)**
4. Klik **Save**
5. Tunggu 1–2 menit, lalu buka:  
   **https://DediOneThai.github.io/metadata-editor/**

---

## Catatan Penting

- **Video**: Klik tombol **Load FFmpeg.wasm** di menu Settings dulu sebelum memproses video.
- **PNG**: Penghapusan metadata memakai cara re-encode (kualitas bisa sedikit berubah).
- File besar (video) bisa memakan memori browser — proses sedikit demi sedikit jika perlu.

---

## Versi

v2.0 — Dashboard, multi-file, JPEG/PNG/MP4/MOV, batch, ZIP.
