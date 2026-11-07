// Metadata Editor - Client-side JPEG metadata editor
// Menggunakan exifr (baca) + piexifjs (tulis)

let currentFile = null;
let currentArrayBuffer = null;
let originalExif = null;

const fileInput = document.getElementById('fileInput');
const previewSection = document.getElementById('previewSection');
const metadataSection = document.getElementById('metadataSection');
const emptyState = document.getElementById('emptyState');
const previewImg = document.getElementById('previewImg');
const fileInfo = document.getElementById('fileInfo');
const statusEl = document.getElementById('status');
const downloadLink = document.getElementById('downloadLink');

// Helper: format datetime-local value
function toDatetimeLocal(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Helper: parse datetime-local ke format EXIF "YYYY:MM:DD HH:MM:SS"
function fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = `text-sm mt-2 ${isError ? 'text-red-600' : 'text-green-600'}`;
}

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.includes('jpeg') && !file.name.toLowerCase().endsWith('.jpg') && !file.name.toLowerCase().endsWith('.jpeg')) {
    showStatus('Hanya mendukung file JPEG (.jpg / .jpeg)', true);
    return;
  }

  currentFile = file;
  downloadLink.classList.add('hidden');
  showStatus('Membaca metadata...');

  try {
    // Preview
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewSection.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // File info
    fileInfo.innerHTML = `
      <p><strong>Nama:</strong> ${file.name}</p>
      <p><strong>Ukuran:</strong> ${(file.size / 1024).toFixed(1)} KB</p>
      <p><strong>Tipe:</strong> ${file.type || 'image/jpeg'}</p>
    `;

    // Baca metadata dengan exifr
    const exif = await exifr.parse(file, {
      tiff: true,
      xmp: true,
      icc: false,
      iptc: true,
      jfif: true,
      ihdr: true,
      gps: true,
      interop: true,
      translateKeys: false,
      translateValues: false,
      reviveValues: true,
      sanitize: true,
      mergeOutput: true
    });

    originalExif = exif || {};

    // Isi form
    document.getElementById('dateTaken').value = toDatetimeLocal(exif?.DateTimeOriginal || exif?.CreateDate);
    document.getElementById('dateModified').value = toDatetimeLocal(exif?.ModifyDate || exif?.DateTime);
    document.getElementById('make').value = exif?.Make || '';
    document.getElementById('model').value = exif?.Model || '';
    document.getElementById('description').value = exif?.ImageDescription || exif?.Description || '';
    document.getElementById('artist').value = exif?.Artist || exif?.Creator || '';
    document.getElementById('copyright').value = exif?.Copyright || '';

    // GPS
    const gpsDiv = document.getElementById('gpsInfo');
    const gpsText = document.getElementById('gpsText');
    if (exif?.latitude && exif?.longitude) {
      gpsText.textContent = `${exif.latitude.toFixed(6)}, ${exif.longitude.toFixed(6)}`;
      gpsDiv.classList.remove('hidden');
    } else {
      gpsDiv.classList.add('hidden');
    }

    // Simpan ArrayBuffer untuk piexif
    currentArrayBuffer = await file.arrayBuffer();

    metadataSection.classList.remove('hidden');
    showStatus('Metadata berhasil dibaca. Silakan edit lalu simpan.');
  } catch (err) {
    console.error(err);
    showStatus('Gagal membaca metadata: ' + err.message, true);
  }
});

document.getElementById('saveBtn').addEventListener('click', () => {
  if (!currentArrayBuffer) {
    showStatus('Belum ada file yang dipilih', true);
    return;
  }

  try {
    // Baca EXIF binary yang ada
    const binary = new Uint8Array(currentArrayBuffer);
    let zeroth = {}, exif = {}, gps = {};

    try {
      const existing = piexif.load(piexif.binaryToString ? piexif.binaryToString(binary) : String.fromCharCode.apply(null, binary));
      zeroth = existing['0th'] || {};
      exif = existing['Exif'] || {};
      gps = existing['GPS'] || {};
    } catch (e) {
      // Tidak ada EXIF sebelumnya, buat baru
    }

    // Update field dari form
    const dateTaken = fromDatetimeLocal(document.getElementById('dateTaken').value);
    const dateModified = fromDatetimeLocal(document.getElementById('dateModified').value);
    const make = document.getElementById('make').value.trim();
    const model = document.getElementById('model').value.trim();
    const description = document.getElementById('description').value.trim();
    const artist = document.getElementById('artist').value.trim();
    const copyright = document.getElementById('copyright').value.trim();

    if (dateTaken) {
      exif[piexif.ExifIFD.DateTimeOriginal] = dateTaken;
      exif[piexif.ExifIFD.DateTimeDigitized] = dateTaken;
    }
    if (dateModified) {
      zeroth[piexif.ImageIFD.DateTime] = dateModified;
    }
    if (make) zeroth[piexif.ImageIFD.Make] = make;
    if (model) zeroth[piexif.ImageIFD.Model] = model;
    if (description) zeroth[piexif.ImageIFD.ImageDescription] = description;
    if (artist) zeroth[piexif.ImageIFD.Artist] = artist;
    if (copyright) zeroth[piexif.ImageIFD.Copyright] = copyright;

    // Bangun EXIF baru
    const newExifObj = { '0th': zeroth, 'Exif': exif, 'GPS': gps };
    const exifBytes = piexif.dump(newExifObj);

    // Sisipkan ke JPEG
    // piexifjs mengharapkan string binary lama
    let jpegStr;
    if (typeof piexif.binaryToString === 'function') {
      jpegStr = piexif.binaryToString(binary);
    } else {
      // Fallback untuk browser modern
      jpegStr = '';
      for (let i = 0; i < binary.length; i++) {
        jpegStr += String.fromCharCode(binary[i]);
      }
    }

    const newJpegStr = piexif.insert(exifBytes, jpegStr);

    // Convert kembali ke Blob
    const newBinary = new Uint8Array(newJpegStr.length);
    for (let i = 0; i < newJpegStr.length; i++) {
      newBinary[i] = newJpegStr.charCodeAt(i);
    }

    const blob = new Blob([newBinary], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.download = currentFile.name.replace(/\.jpe?g$/i, '') + '_edited.jpg';
    downloadLink.classList.remove('hidden');
    downloadLink.textContent = 'Download Hasil';

    showStatus('Metadata berhasil disimpan! Klik tombol Download Hasil.');
  } catch (err) {
    console.error(err);
    showStatus('Gagal menyimpan metadata: ' + err.message, true);
  }
});

document.getElementById('removeBtn').addEventListener('click', () => {
  if (!currentArrayBuffer) {
    showStatus('Belum ada file yang dipilih', true);
    return;
  }

  try {
    const binary = new Uint8Array(currentArrayBuffer);

    // Hapus semua EXIF dengan piexif.remove
    let jpegStr;
    if (typeof piexif.binaryToString === 'function') {
      jpegStr = piexif.binaryToString(binary);
    } else {
      jpegStr = '';
      for (let i = 0; i < binary.length; i++) {
        jpegStr += String.fromCharCode(binary[i]);
      }
    }

    const cleanedStr = piexif.remove(jpegStr);

    const newBinary = new Uint8Array(cleanedStr.length);
    for (let i = 0; i < cleanedStr.length; i++) {
      newBinary[i] = cleanedStr.charCodeAt(i);
    }

    const blob = new Blob([newBinary], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);

    downloadLink.href = url;
    downloadLink.download = currentFile.name.replace(/\.jpe?g$/i, '') + '_no_metadata.jpg';
    downloadLink.classList.remove('hidden');
    downloadLink.textContent = 'Download Tanpa Metadata';

    // Kosongkan form
    document.getElementById('dateTaken').value = '';
    document.getElementById('dateModified').value = '';
    document.getElementById('make').value = '';
    document.getElementById('model').value = '';
    document.getElementById('description').value = '';
    document.getElementById('artist').value = '';
    document.getElementById('copyright').value = '';
    document.getElementById('gpsInfo').classList.add('hidden');

    showStatus('Semua metadata berhasil dihapus! Klik Download.');
  } catch (err) {
    console.error(err);
    showStatus('Gagal menghapus metadata: ' + err.message, true);
  }
});
