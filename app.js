/**
 * Creator Metadata Studio v2
 * Browser-only metadata read / edit / strip for JPEG, PNG, MP4, MOV
 * Libraries: exifr, piexifjs, JSZip, FFmpeg.wasm (lazy)
 */

// ---------- State ----------
const files = []; // { id, file, type, status, originalMeta, processedMeta, processedBlob, error, progress }
let selectedId = null;
let ffmpeg = null;
let ffmpegLoaded = false;

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const logPanel = $('#logPanel');
const fileList = $('#fileList');
const fileListEmpty = $('#fileListEmpty');
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');

// ---------- Utils ----------
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

/** Safe binary ↔ string for piexifjs (avoids apply argument limit) */
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
    return '<p class="text-xs text-slate-400">No metadata</p>';
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
  // GPS special
  if (meta.latitude != null && meta.longitude != null) {
    html += `<tr><th>GPS</th><td>${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

// ---------- Navigation ----------
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

// ---------- Drop / Upload ----------
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
      log(`Skipped unsupported: ${file.name}`, 'error');
      continue;
    }
    const entry = {
      id: uid(),
      file,
      type,
      status: 'loading',
      originalMeta: null,
      processedMeta: null,
      processedBlob: null,
      error: null,
      progress: 0
    };
    files.push(entry);
    log(`Added ${file.name} (${type}, ${formatSize(file.size)})`);
    renderFileList();
    updateStats();

    try {
      entry.originalMeta = await readMetadata(entry);
      entry.status = 'ready';
      log(`Metadata read: ${file.name}`, 'ok');
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      log(`Read failed ${file.name}: ${err.message}`, 'error');
    }
    renderFileList();
    updateStats();

    if ((type === 'mp4' || type === 'mov') && $('#optAutoLoadFFmpeg')?.checked) {
      loadFFmpeg().catch(() => {});
    }
  }
}

// ---------- Metadata readers ----------
async function readMetadata(entry) {
  const { file, type } = entry;
  if (type === 'jpeg' || type === 'png') {
    const meta = await exifr.parse(file, {
      tiff: true, xmp: true, iptc: true, jfif: true, ihdr: true,
      gps: true, interop: true, reviveValues: true, mergeOutput: true
    }) || {};
    // Normalize common keys
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
    // Basic container probe without FFmpeg first (limited)
    // Full tags after FFmpeg load via ffprobe-like
    return {
      _source: type,
      note: 'Basic probe. Load FFmpeg for full container tags.',
      fileName: file.name,
      size: file.size,
      type: file.type
    };
  }
  return {};
}

// ---------- FFmpeg ----------
async function loadFFmpeg() {
  if (ffmpegLoaded) return ffmpeg;
  $('#ffmpegStatus').textContent = 'FFmpeg: loading…';
  log('Loading FFmpeg.wasm (this may take a moment)…');
  try {
    const { FFmpeg } = FFmpegWASM;
    const { toBlobURL } = FFmpegUtil;
    ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      // quiet
    });
    ffmpeg.on('progress', ({ progress }) => {
      // used per-task
    });
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
    ffmpegLoaded = true;
    $('#ffmpegStatus').textContent = 'FFmpeg: ready';
    log('FFmpeg.wasm loaded', 'ok');
    return ffmpeg;
  } catch (err) {
    $('#ffmpegStatus').textContent = 'FFmpeg: failed';
    log('FFmpeg load failed: ' + err.message, 'error');
    throw err;
  }
}

$('#btnLoadFFmpeg')?.addEventListener('click', () => loadFFmpeg());

// ---------- JPEG processing ----------
async function processJpeg(entry, mode, values) {
  const buf = await entry.file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const binStr = uint8ToBinaryString(u8);

  if (mode === 'strip') {
    const cleaned = piexif.remove(binStr);
    const out = binaryStringToUint8(cleaned);
    entry.processedBlob = new Blob([out], { type: 'image/jpeg' });
    entry.processedMeta = { _note: 'All EXIF stripped' };
    return;
  }

  // edit
  let zeroth = {}, exifIfd = {}, gps = {};
  try {
    const existing = piexif.load(binStr);
    zeroth = existing['0th'] || {};
    exifIfd = existing['Exif'] || {};
    gps = existing['GPS'] || {};
  } catch (_) {}

  // Preserve orientation if option set
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
    _note: 'EXIF updated (GPS preserved unless stripped)'
  };
}

// ---------- PNG processing (limited) ----------
async function processPng(entry, mode, values) {
  // PNG metadata writing is limited in pure browser without heavy libs.
  // Strip = re-encode via canvas (removes most metadata, may change compression).
  // Edit descriptive = not fully supported; we still offer strip + warn.

  if (mode === 'strip' || mode === 'edit') {
    if ($('#optWarnPng')?.checked) {
      log(`PNG ${entry.file.name}: processing uses canvas re-encode (metadata largely removed; quality may change slightly)`, 'info');
    }
    const bitmap = await createImageBitmap(entry.file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    entry.processedBlob = blob;
    entry.processedMeta = {
      _note: mode === 'strip'
        ? 'PNG re-encoded; most metadata removed'
        : 'PNG re-encoded; full EXIF-style edit not supported in browser — metadata mostly cleared',
      width: canvas.width,
      height: canvas.height
    };
  }
}

// ---------- Video processing (FFmpeg stream copy) ----------
async function processVideo(entry, mode, values) {
  await loadFFmpeg();
  const name = entry.file.name;
  const inputName = 'input' + name.slice(name.lastIndexOf('.'));
  const outputName = 'output' + name.slice(name.lastIndexOf('.'));

  const data = new Uint8Array(await entry.file.arrayBuffer());
  await ffmpeg.writeFile(inputName, data);

  const args = ['-i', inputName, '-c', 'copy']; // stream copy — never silent re-encode

  if (mode === 'strip') {
    args.push('-map_metadata', '-1');
  } else {
    // descriptive tags
    if (values.title) args.push('-metadata', `title=${values.title}`);
    if (values.artist) args.push('-metadata', `artist=${values.artist}`);
    if (values.copyright) args.push('-metadata', `copyright=${values.copyright}`);
    // comment / description
    if (values.title) args.push('-metadata', `comment=${values.title}`);
  }

  args.push('-y', outputName);

  try {
    await ffmpeg.exec(args);
  } catch (err) {
    // Some codecs/containers may reject certain metadata ops
    throw new Error('FFmpeg failed (codec/container may not support requested metadata op): ' + err.message);
  }

  const out = await ffmpeg.readFile(outputName);
  entry.processedBlob = new Blob([out.buffer], { type: entry.file.type || 'video/mp4' });
  entry.processedMeta = mode === 'strip'
    ? { _note: 'Container metadata stripped (stream copy)' }
    : {
        title: values.title || '',
        artist: values.artist || '',
        copyright: values.copyright || '',
        _note: 'Descriptive metadata written via stream copy'
      };

  // cleanup
  try { await ffmpeg.deleteFile(inputName); } catch (_) {}
  try { await ffmpeg.deleteFile(outputName); } catch (_) {}
}

// ---------- Unified process ----------
async function processEntry(entry, mode, values = {}) {
  entry.status = 'processing';
  entry.progress = 10;
  renderFileList();
  try {
    if (entry.type === 'jpeg') await processJpeg(entry, mode, values);
    else if (entry.type === 'png') await processPng(entry, mode, values);
    else if (entry.type === 'mp4' || entry.type === 'mov') await processVideo(entry, mode, values);
    else throw new Error('Unsupported type');

    entry.status = 'done';
    entry.progress = 100;
    entry.error = null;
    log(`${mode} OK: ${entry.file.name}`, 'ok');
  } catch (err) {
    entry.status = 'error';
    entry.error = err.message;
    log(`${mode} failed ${entry.file.name}: ${err.message}`, 'error');
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

// ---------- UI: File list ----------
function renderFileList() {
  if (files.length === 0) {
    fileList.innerHTML = '<div class="p-8 text-center text-slate-400 text-sm" id="fileListEmpty">No files yet. Use Dashboard to add files.</div>';
    return;
  }
  fileList.innerHTML = files.map(f => {
    const statusColor = {
      loading: 'text-slate-400',
      ready: 'text-blue-600',
      processing: 'text-amber-600',
      done: 'text-green-600',
      error: 'text-red-600'
    }[f.status] || '';
    return `
      <div class="file-row flex items-center gap-3 px-4 py-3 cursor-pointer ${selectedId === f.id ? 'selected' : ''}" data-id="${f.id}">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">${escapeHtml(f.file.name)}</div>
          <div class="text-xs text-slate-400">${f.type.toUpperCase()} · ${formatSize(f.file.size)} · <span class="${statusColor}">${f.status}</span></div>
          ${f.error ? `<div class="text-xs text-red-500 mt-0.5">${escapeHtml(f.error)}</div>` : ''}
        </div>
        <button data-remove="${f.id}" class="text-xs text-slate-400 hover:text-red-600 px-2">✕</button>
      </div>`;
  }).join('');

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
  // switch to inspector for convenience
}

function removeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx >= 0) {
    log(`Removed ${files[idx].file.name}`);
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
  log('Cleared all files');
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
    $('#inspectorFileName').textContent = 'Select a file from File Manager';
    $('#metaBefore').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    $('#metaAfter').innerHTML = '<p class="text-xs text-slate-400">—</p>';
    $('#editorFileName').textContent = 'Select a file first';
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
  if (entry.type === 'png') note = 'PNG: full EXIF write not supported. Strip uses canvas re-encode.';
  if (entry.type === 'mp4' || entry.type === 'mov') note = 'Video: uses FFmpeg stream copy. Only descriptive container tags are edited.';
  if (entry.type === 'jpeg') note = 'JPEG: full EXIF edit/strip supported. Orientation preserved if setting enabled.';
  $('#editorNote').textContent = note;
}

// ---------- Editor actions ----------
$('#btnApplyEdit')?.addEventListener('click', async () => {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) return log('No file selected', 'error');
  await processEntry(entry, 'edit', getEditorValues());
});

$('#btnStripSelected')?.addEventListener('click', async () => {
  const entry = files.find(f => f.id === selectedId);
  if (!entry) return log('No file selected', 'error');
  await processEntry(entry, 'strip');
});

// ---------- Batch ----------
async function runBatch(mode) {
  if (files.length === 0) return log('No files', 'error');
  const values = getEditorValues();
  const total = files.length;
  let done = 0;
  $('#batchStatus').textContent = `Processing 0 / ${total}…`;
  $('#batchProgress').style.width = '0%';

  for (const entry of files) {
    await processEntry(entry, mode, values);
    done++;
    const pct = Math.round((done / total) * 100);
    $('#batchProgress').style.width = pct + '%';
    $('#batchStatus').textContent = `Processing ${done} / ${total}…`;
  }
  $('#batchStatus').textContent = `Finished ${done} files`;
  log(`Batch ${mode} complete (${done} files)`, 'ok');
}

$('#btnBatchStrip')?.addEventListener('click', () => runBatch('strip'));
$('#btnBatchApply')?.addEventListener('click', () => runBatch('edit'));

// ---------- Export ----------
function updateExportList() {
  const el = $('#exportList');
  if (!el) return;
  const ready = files.filter(f => f.processedBlob);
  if (ready.length === 0) {
    el.innerHTML = '<p class="text-slate-400 text-xs">No processed files yet</p>';
    return;
  }
  el.innerHTML = ready.map(f => {
    const url = URL.createObjectURL(f.processedBlob);
    const name = f.file.name.replace(/\.[^.]+$/, '') + '_meta' + f.file.name.slice(f.file.name.lastIndexOf('.'));
    return `<div class="flex justify-between items-center py-1">
      <span class="truncate text-xs">${escapeHtml(name)}</span>
      <a href="${url}" download="${escapeHtml(name)}" class="text-blue-600 text-xs hover:underline">Download</a>
    </div>`;
  }).join('');
}

async function downloadZip(onlyProcessed = false) {
  const list = onlyProcessed ? files.filter(f => f.processedBlob) : files;
  if (list.length === 0) return log('Nothing to download', 'error');

  const zip = new JSZip();
  for (const f of list) {
    const blob = f.processedBlob || f.file;
    const suffix = f.processedBlob ? '_meta' : '';
    const name = f.file.name.replace(/\.[^.]+$/, '') + suffix + f.file.name.slice(f.file.name.lastIndexOf('.'));
    zip.file(name, blob);
  }
  log('Building ZIP…');
  const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
    $('#batchProgress').style.width = Math.round(meta.percent) + '%';
  });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'metadata-studio-export.zip';
  a.click();
  log('ZIP download started', 'ok');
}

$('#btnDownloadAll')?.addEventListener('click', () => downloadZip(false));
$('#btnDownloadReady')?.addEventListener('click', () => downloadZip(true));

// ---------- Init ----------
log('Creator Metadata Studio ready. All processing stays in your browser.');
updateStats();
