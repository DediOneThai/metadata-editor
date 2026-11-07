# Creator Metadata Studio

Browser-only tool for reading, editing, and stripping metadata from photos and videos.  
**No backend. No uploads to any server. Compatible with static hosting (GitHub Pages / Vercel).**

**Repository:** https://github.com/semutservercomback-png/metadata-editor

---

## Capability Matrix (honest)

| Format | Read metadata | Edit descriptive fields | Strip / Privacy | Preserve streams / quality | Notes |
|--------|---------------|-------------------------|-----------------|----------------------------|-------|
| **JPEG** | Full EXIF (exifr) | Yes (piexifjs) | Yes | Yes (lossless EXIF rewrite) | Orientation can be preserved |
| **PNG** | XMP / limited | Partial | Yes (canvas re-encode) | Re-encode may slightly change compression | Full EXIF-style write not available in pure browser |
| **MP4** | Basic + container tags (via FFmpeg) | Yes (title, artist, copyright…) | Yes (`-map_metadata -1`) | **Stream copy** (`-c copy`) | Never silent re-encode |
| **MOV** | Same as MP4 | Yes | Yes | Stream copy | Same pipeline as MP4 |

### Explicitly out of scope
- Falsifying provenance, authorship, or timestamps for deceptive purposes
- Watermark / fingerprint removal
- Server-side processing or paid APIs

---

## Features

- **Multi-file** upload (drag & drop or picker)
- **File Manager** with per-file status and removal
- **Metadata Inspector** — before / after view
- **Metadata Editor** — title, artist, copyright, make, model, date taken
- **Batch** strip or apply editor values to all files
- **Export** individual downloads + ZIP (all or only processed)
- **Settings** — preserve JPEG orientation, PNG warning, lazy FFmpeg load
- Activity log

---

## How to run

### Local
Open `index.html` in a modern browser (Chrome / Edge / Firefox recommended).

### GitHub Pages
1. Settings → Pages → Deploy from branch `main` / root  
2. Live at: `https://semutservercomback-png.github.io/metadata-editor/`

### Vercel / Netlify
Static deploy of the repository root. No build step required.

---

## Technical notes

### JPEG
- Read: `exifr`
- Write / strip: `piexifjs` with chunked binary conversion (avoids large-file crashes)

### PNG
- Read: `exifr` (XMP etc.)
- Strip / “edit”: canvas re-encode — removes most metadata; quality may change slightly  
- Clear warning is shown when the setting is enabled

### Video (MP4 / MOV)
- Uses **FFmpeg.wasm** (loaded on demand, ~25–30 MB)
- Always prefers **stream copy** (`-c copy`)
- Metadata ops: `-metadata key=value` or `-map_metadata -1`
- If a codec/container combination rejects the operation, an explicit error is shown — no silent re-encode

### Batch & ZIP
- Sequential processing with progress bar
- ZIP via JSZip

### Privacy
- All processing stays in the browser
- GPS and other EXIF can be stripped on JPEG
- Video container metadata can be stripped

---

## Known limitations / partial support

1. **PNG write** is not full EXIF — browser has no lightweight pure-JS PNG metadata writer comparable to piexifjs.
2. **Video probe before FFmpeg load** is minimal (filename, size, type). Full tags require FFmpeg.
3. **Very large videos** may hit browser memory limits; process in smaller batches if needed.
4. Some exotic codecs inside MP4/MOV may cause FFmpeg metadata write to fail — reported clearly.
5. HEIC / WebP / MKV not supported in this version.

---

## Libraries (CDN)

- Tailwind CSS
- [exifr](https://github.com/MikeKovarik/exifr)
- [piexifjs](https://github.com/hMatoba/piexifjs)
- [JSZip](https://stuk.github.io/jszip/)
- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) (+ util)

---

## Version

**v2.0** — Dashboard UI, multi-format, batch, ZIP, FFmpeg stream-copy pipeline.

Original single-JPEG prototype preserved in spirit; all previous working JPEG features retained and hardened.
