/**
 * Creator Metadata Studio v2.3
 * Perbaikan FFmpeg Worker untuk GitHub Pages (cross-origin)
 */

const files = [];
let selectedId = null;
let ffmpeg = null;
let ffmpegLoaded = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const logPanel = $('#logPanel');
const fileList = $('#fileList');
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function log(msg, type = 'info') {
  if (!logPanel) return;
  const line = document.createElement('div');
  line.className = type === 'error' ? 'text-red-400' : type === 'ok' ? 'text-green-400' : 'text-slate-300';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logPanel.appendChild(line);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function detectType(file) {
  const n = file.name.toLowerCase();
  const t = (file.type || '').toLowerCase();
  if (t.includes('jpeg') || n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpeg';
  if (t.includes('png') || n.endsWith('.png')) return 'png';
  if (t.includes('mp4') || n.endsWith('.mp4')) return 'mp4';
  if (t.includes('quicktime') || n.endsWith('.mov')) return 'mov';
  return 'unknown';
}

function toDatetimeLocal(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function uint8ToBinaryString(u8) {
  const CHUNK = 0x8000;
  let s = '';
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return s;
}

function binaryStringToUint8(str) {
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i);
  return u8;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function metaToTable(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return '<p class="text-xs text-slate-400">Tidak ada metadata</p>';
  }
  const skip = new Set(['thumbnail', 'Thumbnail', 'exif', 'icc', 'raw']);
  let html = '<table class="meta-table w-full"><tbody>';
  const keys = Object.keys(meta).filter(k => !skip.has(k) && meta[k] != null && typeof meta[k] !== 'object');
  keys.sort();
  for (const k of keys) {
    let v = meta[k];
    if (typeof v === 'number' && !Number.isInteger(v)) v = v.toFixed(6);
    html += `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`;
  }
  if (meta.latitude != null && meta.longitude != null) {
    html += `<tr><th>GPS</th><td>${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function resultName(entry) {
  const name = entry.file.name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return base + '_meta' + ext;
}

function downloadBlob(blob, filename) {
  if (!blob) {
    log('Tidak ada file untuk diunduh', 'error');
    return false;
  }
  try {
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveOrOpenBlob(blob, filename);
      log('Unduh: ' + filename, 'ok');
      return true;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    a.setAttribute('target', '_blank');
    document.body.appendChild(a);
    if (typeof a.click === 'function') a.click();
    else a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 2500);
    log('Unduh dimulai: ' + filename, 'ok');
    return true;
  } catch (err) {
    log('Gagal unduh: ' + err.message, 'error');
    try {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      log('File dibuka di tab baru — tekan lama lalu Simpan/Unduh', 'info');
      return true;
    } catch (e2) {
      log('Gagal membuka file: ' + e2.message, 'error');
      return false;
    }
  }
}

function downloadEntry(entry) {
  if (!entry || !entry.processedBlob) {
    log('File belum diproses. Proses dulu di Editor.', 'error');
    return;
  }
  downloadBlob(entry.processedBlob, resultName(entry));
}

$$('.sidebar-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    $$('.sidebar-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    $$('.panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById('panel-' + link.dataset.panel);
    if (panel) panel.classList.remove('hidden');
  });
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => addFiles(fileInput.files));

async function addFiles(fileListObj) {
  const arr = Array.from(fileListObj || []);
  for (const file of arr) {
    const type = detectType(file);
    if (type === 'unknown') {
      log(`Dilewati (tidak didukung): ${file.name}`, 'error');
      continue;
    }
    const entry = {
      id: uid(), file, type, status: 'loading',
      originalMeta: null, processedMeta: null, processedBlob: null,
      error: null, progress: 0
    };
    files.push(entry);
    log(`Ditambah ${file.name} (${type}, ${formatSize(file.size)})`);
    renderFileList();
    updateStats();
    try {
      entry.originalMeta = await readMetadata(entry);
      entry.status = 'ready';
      log(`Metadata dibaca: ${file.name}`, 'ok');
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      log(`Gagal baca ${file.name}: ${err.message}`, 'error');
    }
    renderFileList();
    updateStats();
    if ((type === 'mp4' || type === 'mov') && $('#optAutoLoadFFmpeg')?.checked) {
      loadFFmpeg().catch(() => {});
    }
  }
}

async function readMetadata(entry) {
  const { file, type } = entry;
  if (type === 'jpeg' || type === 'png') {
    const meta = await exifr.parse(file, {
      tiff: true, xmp: true, iptc: true, jfif: true, ihdr: true,
      gps: true, interop: true, reviveValues: true, mergeOutput: true
    }) || {};
    return {
      ...meta,
      _source: type,
      ImageDescription: meta.ImageDescription || meta.Description || meta.title || '',
      Artist: meta.Artist || meta.Creator || meta.artist || '',
      Copyright: meta.Copyright || meta.copyright || '',
      Make: meta.Make || '',
      Model: meta.Model || '',
      DateTimeOriginal: meta.DateTimeOriginal || meta.CreateDate || null,
      Orientation: meta.Orientation || null,
      ImageWidth: meta.ImageWidth || meta.ExifImageWidth || null,
      ImageHeight: meta.ImageHeight || meta.ExifImageHeight || null
    };
  }
  if (type === 'mp4' || type === 'mov') {
    return {
      _source: type,
      note: 'Probe dasar. Muat FFmpeg untuk tag lengkap.',
      fileName: file.name,
      size: file.size,
      type: file.type
    };
  }
  return {};
}

function setFFmpegStatus(label, state) {
  const el = $('#ffmpegStatus');
  if (el) {
    const color = state === 'ready' ? 'bg-emerald-400' : state === 'loading' ? 'bg-amber-400' : state === 'error' ? 'bg-red-400' : 'bg-slate-600';
    el.innerHTML = `<span class="w-1.5 h-1.5 rounded-full inline-block ${color}" id="ffmpegDot"></span> ${label}`;
  }
  const mob = $('#ffmpegStatusMobile');
  if (mob) {
    mob.textContent = state === 'ready' ? 'FFmpeg ✓' : state === 'loading' ? 'FFmpeg …' : state === 'error' ? 'FFmpeg ✗' : 'FFmpeg •';
    mob.className = 'text-[10px] font-medium ' + (state === 'ready' ? 'text-emerald-400' : state === 'error' ? 'text-red-400' : 'text-slate-400');
  }
}

async function loadFFmpeg() {
  if (ffmpegLoaded) return ffmpeg;
  setFFmpegStatus('FFmpeg: memuat…', 'loading');
  log('Memuat FFmpeg.wasm… (pertama kali bisa 20–60 detik)');
  try {
    if (typeof FFmpegWASM === 'undefined' || typeof FFmpegUtil === 'undefined') {
      throw new Error('Library FFmpeg belum termuat. Refresh halaman lalu coba lagi.');
    }
    const { FFmpeg } = FFmpegWASM;
    const { toBlobURL } = FFmpegUtil;
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', () => {});
    ffmpeg.on('progress', () => {});

    // Blob URL agar Worker tidak diblokir cross-origin di GitHub Pages
    const ffmpegUMD = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd';
    const coreUMD = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';

    const classWorkerURL = await toBlobURL(`${ffmpegUMD}/814.ffmpeg.js`, 'text/javascript');
    const coreURL = await toBlobURL(`${coreUMD}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${coreUMD}/ffmpeg-core.wasm`, 'application/wasm');

    await ffmpeg.load({
      classWorkerURL,
      coreURL,
      wasmURL
    });

    ffmpegLoaded = true;
    setFFmpegStatus('FFmpeg: siap', 'ready');
    log('FFmpeg.wasm berhasil dimuat', 'ok');
    return ffmpeg;
  } catch (err) {
    setFFmpegStatus('FFmpeg: gagal', 'error');
    log('Gagal memuat FFmpeg: ' + err.message, 'error');
    throw err;
  }
}

$('#btnLoadFFmpeg')?.addEventListener('click', () => loadFFmpeg());

async function processJpeg(entry, mode, values) {
  const buf = await entry.file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const binStr = uint8ToBinaryString(u8);

  if (mode === 'strip') {
    const cleaned = piexif.remove(binStr);
    const out = binaryStringToUint8(cleaned);
    entry.processedBlob = new Blob([out], { type: 'image/jpeg' });
    entry.processedMeta = { _note: 'Semua EXIF dihapus' };
    return;
  }

  let zeroth = {}, exifIfd = {}, gps = {};
  try {
    const existing = piexif.load(binStr);
    zeroth = existing['0th'] || {};
    exifIfd = existing['Exif'] || {};
    gps = existing['GPS'] || {};
  } catch (_) {}

  if (!$('#optPreserveOrientation')?.checked) {
    delete zeroth[piexif.ImageIFD.Orientation];
  }

  if (values.title) zeroth[piexif.ImageIFD.ImageDescription] = values.title;
  if (values.artist) zeroth[piexif.ImageIFD.Artist] = values.artist;
  if (values.copyright) zeroth[piexif.ImageIFD.Copyright] = values.copyright;
  if (values.make) zeroth[piexif.ImageIFD.Make] = values.make;
  if (values.model) zeroth[piexif.ImageIFD.Model] = values.model;
  if (values.dateTaken) {
    exifIfd[piexif.ExifIFD.DateTimeOriginal] = values.dateTaken;
    exifIfd[piexif.ExifIFD.DateTimeDigitized] = values.dateTaken;
    zeroth[piexif.ImageIFD.DateTime] = values.dateTaken;
  }

  const exifBytes = piexif.dump({ '0th': zeroth, 'Exif': exifIfd, 'GPS': gps });
  const newStr = piexif.insert(exifBytes, binStr);
  const out = binaryStringToUint8(newStr);
  entry.processedBlob = new Blob([out], { type: 'image/jpeg' });
  entry.processedMeta = {
    ImageDescription: values.title || '',
    Artist: values.artist || '',
    Copyright: values.copyright || '',
    Make: values.make || '',
    Model: values.model || '',
    DateTimeOriginal: values.dateTaken || null,
    _note: 'EXIF diperbarui'
  };
}

async function processPng(entry) {
  if ($('#optWarnPng')?.checked) {
    log(`PNG ${entry.file.name}: memakai re-encode canvas (metadata dihapus)`, 'info');
  }
  const bitmap = await createImageBitmap(entry.file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Gagal membuat PNG');
  entry.processedBlob = blob;
  entry.processedMeta = {
    _note: 'PNG di-re-encode; metadata dihapus',
    width: canvas.width,
    height: canvas.height
  };
}

async function processVideo(entry, mode, values) {
  await loadFFmpeg();
  const name = entry.file.name;
  const ext = name.slice(name.lastIndexOf('.'));
  const inputName = 'input' + ext;
  const outputName = 'output' + ext;

  const data = new Uint8Array(await entry.file.arrayBuffer());
  await ffmpeg.writeFile(inputName, data);

  const args = ['-i', inputName, '-c', 'copy'];
  if (mode === 'strip') {
    args.push('-map_metadata', '-1');
  } else {
    if (values.title) {
      args.push('-metadata', `title=${values.title}`);
      args.push('-metadata', `comment=${values.title}`);
    }
    if (values.artist) args.push('-metadata', `artist=${values.artist}`);
    if (values.copyright) args.push('-metadata', `copyright=${values.copyright}`);
  }
  args.push('-y', outputName);

  try {
    await ffmpeg.exec(args);
  } catch (err) {
    throw new Error('FFmpeg gagal (codec/container mungkin tidak mendukung): ' + err.message);
  }

  const out = await ffmpeg.readFile(outputName);
  entry.processedBlob = new Blob([out.buffer], { type: entry.file.type || 'video/mp4' });
  entry.processedMeta = mode === 'strip'
    ? { _note: 'Metadata container dihapus (stream copy)' }
    : {
        title: values.title || '',
        artist: values.artist || '',
        copyright: values.copyright || '',
        _note: 'Metadata deskriptif ditulis (stream copy)'
      };

  try { await ffmpeg.deleteFile(inputName); } catch (_) {}
  try { await ffmpeg.deleteFile(outputName); } catch (_) {}
}

async function processEntry(entry, mode, values = {}) {
  entry.status = 'processing';
  entry.progress = 10;
  renderFileList();
  hideDownloadBar();
  try {
    if (entry.type === 'jpeg') await processJpeg(entry, mode, values);
    else if (entry.type === 'png') await processPng(entry);
    else if (entry.type === 'mp4' || entry.type === 'mov') await processVideo(entry, mode, values);
    else throw new Error('Tipe tidak didukung');

    entry.status = 'done';
    entry.progress = 100;
    entry.error = null;
    log(`${mode} OK: ${entry.file.name}`, 'ok');
    showDownloadBar(entry);
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    log(`${mode} gagal ${entry.file.name}: ${err.message}`, 'error');
  }
  renderFileList();
  updateStats();
  updateExportList();
  if (selectedId === entry.id) refreshInspectorAndEditor();
}

function getEditorValues() {
  return {
    title: $('#edTitle').value.trim(),
    artist: $('#edArtist').value.trim(),
    copyright: $('#edCopyright').value.trim(),
    make: $('#edMake').value.trim(),
    model: $('#edModel').value.trim(),
    dateTaken: fromDatetimeLocal($('#edDateTaken').value)
  };
}

function showDownloadBar(entry) {
  let bar = $('#downloadBar');
  if (!bar) {
    const form = $('#editorForm');
    if (!form) return;
    bar = document.createElement('div');
    bar.id = 'downloadBar';
    bar.className = 'mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200';
    form.appendChild(bar);
  }
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <p class="text-sm font-semibold text-emerald-800 mb-2">✓ Proses selesai</p>
    <p class="text-xs text-emerald-700 mb-3 truncate">${escapeHtml(resultName(entry))}</p>
    <button type="button" id="btnDownloadNow" class="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-sm font-semibold px-5 py-3.5 rounded-xl shadow-lg shadow-emerald-500/30 transition">
      ⬇️ Unduh ke perangkat
    </button>
    <p class="text-[11px] text-emerald-600/80 mt-2">Jika tidak otomatis tersimpan: file mungkin terbuka di tab baru — tekan lama lalu pilih Simpan / Unduh.</p>
  `;
  $('#btnDownloadNow')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    downloadEntry(entry);
  });
}

function hideDownloadBar() {
  const bar = $('#downloadBar');
  if (bar) bar.classList.add('hidden');
}

function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="p-10 text-center text-slate-400 text-sm">Belum ada file. Tambah dari Dashboard.</div>';
    return;
  }
  const statusLabel = { loading: 'memuat', ready: 'siap', processing: 'proses', done: 'selesai', error: 'error' };
  const statusColor = { loading: 'text-slate-400', ready: 'text-indigo-600', processing: 'text-amber-600', done: 'text-emerald-600', error: 'text-red-600' };
  fileList.innerHTML = files.map(f => `
    <div class="file-row flex items-center gap-2 px-4 py-3.5 cursor-pointer ${selectedId === f.id ? 'selected' : ''}" data-id="${f.id}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate text-slate-800">${escapeHtml(f.file.name)}</div>
        <div class="text-xs text-slate-400 mt-0.5">${f.type.toUpperCase()} · ${formatSize(f.file.size)} · <span class="${statusColor[f.status] || ''}">${statusLabel[f.status] || f.status}</span></div>
        ${f.error ? `<div class="text-xs text-red-500 mt-0.5">${escapeHtml(f.error)}</div>` : ''}
      </div>
      ${f.processedBlob ? `<button type="button" data-dl="${f.id}" class="shrink-0 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 rounded-lg">Unduh</button>` : ''}
      <button type="button" data-remove="${f.id}" class="text-slate-300 hover:text-red-500 px-2 py-1 text-lg leading-none">×</button>
    </div>`).join('');

  fileList.querySelectorAll('.file-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.dataset.remove || e.target.dataset.dl) return;
      selectFile(row.dataset.id);
    });
  });
  fileList.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(btn.dataset.remove);
    });
  });
  fileList.querySelectorAll('[data-dl]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const entry = files.find(f => f.id === btn.dataset.dl);
      downloadEntry(entry);
    });
  });
}

function selectFile(id) {
  selectedId = id;
  renderFileList();
  refreshInspectorAndEditor();
  const entry = files.find(f => f.id === id);
  if (entry && entry.processedBlob) showDownloadBar(entry);
  else hideDownloadBar();
}

function removeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx >= 0) {
    log(`Dihapus ${files[idx].file.name}`);
    files.splice(idx, 1);
    if (selectedId === id) selectedId = null;
    renderFileList();
    updateStats();
    updateExportList();
    refreshInspectorAndEditor();
    hideDownloadBar();
  }
}

$('#btnClearAll')?.addEventListener('click', () => {
  files.length = 0;
  selectedId = null;
  renderFileList();
  updateStats();
  updateExportList();
  refreshInspectorAndEditor();
  hideDownloadBar();
  log('Semua file dihapus');
});

function updateStats() {
  if ($('#statTotal')) $('#statTotal').textContent = files.length;
  if ($('#statImages')) $('#statImages').textContent = files.filter(f => f.type === 'jpeg' || f.type === 'png').length;
  if ($('#statVideos')) $('#statVideos').textContent = files.filter(f => f.type === 'mp4' || f.type === 'mov').length;
  if ($('#statReady')) $('#statReady').textContent = files.filter(f => f.status === 'done').length;
}

function refreshInspectorAndEditor() {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) {
    if ($('#inspectorFileName')) $('#inspectorFileName').textContent = 'Pilih file di File Manager';
    if ($('#metaBefore')) $('#metaBefore').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    if ($('#metaAfter')) $('#metaAfter').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    if ($('#editorFileName')) $('#editorFileName').textContent = 'Pilih file terlebih dulu';
    if ($('#editorForm')) $('#editorForm').classList.add('hidden');
    return;
  }

  if ($('#inspectorFileName')) $('#inspectorFileName').textContent = entry.file.name;
  if ($('#metaBefore')) $('#metaBefore').innerHTML = metaToTable(entry.originalMeta);
  if ($('#metaAfter')) $('#metaAfter').innerHTML = metaToTable(entry.processedMeta);

  if ($('#editorFileName')) $('#editorFileName').textContent = entry.file.name + ` (${entry.type})`;
  if ($('#editorForm')) $('#editorForm').classList.remove('hidden');

  const m = entry.originalMeta || {};
  if ($('#edTitle')) $('#edTitle').value = m.ImageDescription || m.title || '';
  if ($('#edArtist')) $('#edArtist').value = m.Artist || m.artist || '';
  if ($('#edCopyright')) $('#edCopyright').value = m.Copyright || m.copyright || '';
  if ($('#edMake')) $('#edMake').value = m.Make || '';
  if ($('#edModel')) $('#edModel').value = m.Model || '';
  if ($('#edDateTaken')) $('#edDateTaken').value = toDatetimeLocal(m.DateTimeOriginal);

  let note = '';
  if (entry.type === 'png') note = 'PNG: edit penuh tidak didukung. Hapus metadata memakai re-encode.';
  if (entry.type === 'mp4' || entry.type === 'mov') note = 'Video: memakai FFmpeg stream copy. Hanya tag deskriptif yang diubah.';
  if (entry.type === 'jpeg') note = 'JPEG: edit & hapus EXIF didukung penuh.';
  if ($('#editorNote')) $('#editorNote').textContent = note;
}

$('#btnApplyEdit')?.addEventListener('click', async () => {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) return log('Belum ada file dipilih', 'error');
  await processEntry(entry, 'edit', getEditorValues());
});

$('#btnStripSelected')?.addEventListener('click', async () => {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) return log('Belum ada file dipilih', 'error');
  await processEntry(entry, 'strip');
});

async function runBatch(mode) {
  if (files.length === 0) return log('Tidak ada file', 'error');
  const values = getEditorValues();
  const total = files.length;
  let done = 0;
  if ($('#batchStatus')) $('#batchStatus').textContent = `Memproses 0 / ${total}…`;
  if ($('#batchProgress')) $('#batchProgress').style.width = '0%';

  for (const entry of files) {
    await processEntry(entry, mode, values);
    done++;
    const pct = Math.round((done / total) * 100);
    if ($('#batchProgress')) $('#batchProgress').style.width = pct + '%';
    if ($('#batchStatus')) $('#batchStatus').textContent = `Memproses ${done} / ${total}…`;
  }
  if ($('#batchStatus')) $('#batchStatus').textContent = `Selesai ${done} file`;
  log(`Batch ${mode} selesai (${done} file)`, 'ok');
}

$('#btnBatchStrip')?.addEventListener('click', () => runBatch('strip'));
$('#btnBatchApply')?.addEventListener('click', () => runBatch('edit'));

function updateExportList() {
  const el = $('#exportList');
  if (!el) return;
  const ready = files.filter(f => f.processedBlob);
  if (ready.length === 0) {
    el.innerHTML = '<p class="text-slate-400 text-xs">Belum ada file yang diproses</p>';
    return;
  }
  el.innerHTML = ready.map(f => `
    <div class="flex justify-between items-center gap-2 py-2.5 border-b border-slate-50 last:border-0">
      <span class="truncate text-xs text-slate-700">${escapeHtml(resultName(f))}</span>
      <button type="button" data-exportdl="${f.id}" class="shrink-0 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg">Unduh</button>
    </div>`).join('');

  el.querySelectorAll('[data-exportdl]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const entry = files.find(x => x.id === btn.dataset.exportdl);
      downloadEntry(entry);
    });
  });
}

async function downloadZip(onlyProcessed = false) {
  const list = onlyProcessed ? files.filter(f => f.processedBlob) : files;
  if (list.length === 0) return log('Tidak ada yang diunduh', 'error');

  const zip = new JSZip();
  for (const f of list) {
    const blob = f.processedBlob || f.file;
    zip.file(f.processedBlob ? resultName(f) : f.file.name, blob);
  }
  log('Membuat ZIP…');
  const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
    if ($('#batchProgress')) $('#batchProgress').style.width = Math.round(meta.percent) + '%';
  });
  downloadBlob(content, 'metadata-studio-export.zip');
}

$('#btnDownloadAll')?.addEventListener('click', () => downloadZip(false));
$('#btnDownloadReady')?.addEventListener('click', () => downloadZip(true));

log('Metadata Studio siap. Semua proses di browser Anda.');
updateStats();
