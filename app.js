/**
 * Creator Metadata Studio v2.1
 * Browser-only metadata read / edit / strip for JPEG, PNG, MP4, MOV
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
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
  log('Memuat FFmpeg.wasm…');
  try {
    const { FFmpeg } = FFmpegWASM;
    const { toBlobURL } = FFmpegUtil;
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', () => {});
    ffmpeg.on('progress', () => {});
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
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

async function processPng(entry, mode) {
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
    if (values.title) { args.push('-metadata', `title=${values.title}`); args.push('-metadata', `comment=${values.title}`); }
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
    : { title: values.title || '', artist: values.artist || '', copyright: values.copyright || '', _note: 'Metadata deskriptif ditulis (stream copy)' };

  try { await ffmpeg.deleteFile(inputName); } catch (_) {}
  try { await ffmpeg.deleteFile(outputName); } catch (_) {}
}

async function processEntry(entry, mode, values = {}) {
  entry.status = 'processing';
  entry.progress = 10;
  renderFileList();
  try {
    if (entry.type === 'jpeg') await processJpeg(entry, mode, values);
    else if (entry.type === 'png') await processPng(entry, mode, values);
    else if (entry.type === 'mp4' || entry.type === 'mov') await processVideo(entry, mode, values);
    else throw new Error('Tipe tidak didukung');

    entry.status = 'done';
    entry.progress = 100;
    entry.error = null;
    log(`${mode} OK: ${entry.file.name}`, 'ok');
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

function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="p-10 text-center text-slate-400 text-sm">Belum ada file. Tambah dari Dashboard.</div>';
    return;
  }
  const statusLabel = { loading: 'memuat', ready: 'siap', processing: 'proses', done: 'selesai', error: 'error' };
  const statusColor = { loading: 'text-slate-400', ready: 'text-indigo-600', processing: 'text-amber-600', done: 'text-emerald-600', error: 'text-red-600' };
  fileList.innerHTML = files.map(f => `
    <div class="file-row flex items-center gap-3 px-4 py-3.5 cursor-pointer ${selectedId === f.id ? 'selected' : ''}" data-id="${f.id}">
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium truncate text-slate-800">${escapeHtml(f.file.name)}</div>
        <div class="text-xs text-slate-400 mt-0.5">${f.type.toUpperCase()} · ${formatSize(f.file.size)} · <span class="${statusColor[f.status] || ''}">${statusLabel[f.status] || f.status}</span></div>
        ${f.error ? `<div class="text-xs text-red-500 mt-0.5">${escapeHtml(f.error)}</div>` : ''}
      </div>
      <button data-remove="${f.id}" class="text-slate-300 hover:text-red-500 px-2 py-1 text-lg leading-none">×</button>
    </div>`).join('');

  fileList.querySelectorAll('.file-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.dataset.remove) return;
      selectFile(row.dataset.id);
    });
  });
  fileList.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(btn.dataset.remove);
    });
  });
}

function selectFile(id) {
  selectedId = id;
  renderFileList();
  refreshInspectorAndEditor();
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
  }
}

$('#btnClearAll')?.addEventListener('click', () => {
  files.length = 0;
  selectedId = null;
  renderFileList();
  updateStats();
  updateExportList();
  refreshInspectorAndEditor();
  log('Semua file dihapus');
});

function updateStats() {
  $('#statTotal').textContent = files.length;
  $('#statImages').textContent = files.filter(f => f.type === 'jpeg' || f.type === 'png').length;
  $('#statVideos').textContent = files.filter(f => f.type === 'mp4' || f.type === 'mov').length;
  $('#statReady').textContent = files.filter(f => f.status === 'done').length;
}

function refreshInspectorAndEditor() {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) {
    $('#inspectorFileName').textContent = 'Pilih file di File Manager';
    $('#metaBefore').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    $('#metaAfter').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    $('#editorFileName').textContent = 'Pilih file terlebih dulu';
    $('#editorForm').classList.add('hidden');
    return;
  }

  $('#inspectorFileName').textContent = entry.file.name;
  $('#metaBefore').innerHTML = metaToTable(entry.originalMeta);
  $('#metaAfter').innerHTML = metaToTable(entry.processedMeta);

  $('#editorFileName').textContent = entry.file.name + ` (${entry.type})`;
  $('#editorForm').classList.remove('hidden');

  const m = entry.originalMeta || {};
  $('#edTitle').value = m.ImageDescription || m.title || '';
  $('#edArtist').value = m.Artist || m.artist || '';
  $('#edCopyright').value = m.Copyright || m.copyright || '';
  $('#edMake').value = m.Make || '';
  $('#edModel').value = m.Model || '';
  $('#edDateTaken').value = toDatetimeLocal(m.DateTimeOriginal);

  let note = '';
  if (entry.type === 'png') note = 'PNG: edit penuh tidak didukung. Hapus metadata memakai re-encode.';
  if (entry.type === 'mp4' || entry.type === 'mov') note = 'Video: memakai FFmpeg stream copy. Hanya tag deskriptif yang diubah.';
  if (entry.type === 'jpeg') note = 'JPEG: edit & hapus EXIF didukung penuh.';
  $('#editorNote').textContent = note;
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
  $('#batchStatus').textContent = `Memproses 0 / ${total}…`;
  $('#batchProgress').style.width = '0%';

  for (const entry of files) {
    await processEntry(entry, mode, values);
    done++;
    const pct = Math.round((done / total) * 100);
    $('#batchProgress').style.width = pct + '%';
    $('#batchStatus').textContent = `Memproses ${done} / ${total}…`;
  }
  $('#batchStatus').textContent = `Selesai ${done} file`;
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
  el.innerHTML = ready.map(f => {
    const url = URL.createObjectURL(f.processedBlob);
    const name = f.file.name.replace(/\.[^.]+$/, '') + '_meta' + f.file.name.slice(f.file.name.lastIndexOf('.'));
    return `<div class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
      <span class="truncate text-xs text-slate-700 pr-2">${escapeHtml(name)}</span>
      <a href="${url}" download="${escapeHtml(name)}" class="text-indigo-600 text-xs font-medium hover:underline shrink-0">Unduh</a>
    </div>`;
  }).join('');
}

async function downloadZip(onlyProcessed = false) {
  const list = onlyProcessed ? files.filter(f => f.processedBlob) : files;
  if (list.length === 0) return log('Tidak ada yang diunduh', 'error');

  const zip = new JSZip();
  for (const f of list) {
    const blob = f.processedBlob || f.file;
    const suffix = f.processedBlob ? '_meta' : '';
    const name = f.file.name.replace(/\.[^.]+$/, '') + suffix + f.file.name.slice(f.file.name.lastIndexOf('.'));
    zip.file(name, blob);
  }
  log('Membuat ZIP…');
  const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
    $('#batchProgress').style.width = Math.round(meta.percent) + '%';
  });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'metadata-studio-export.zip';
  a.click();
  log('Download ZIP dimulai', 'ok');
}

$('#btnDownloadAll')?.addEventListener('click', () => downloadZip(false));
$('#btnDownloadReady')?.addEventListener('click', () => downloadZip(true));

log('Metadata Studio siap. Semua proses di browser Anda.');
updateStats();
