/*!
 * Quran Recital — Slow Step
 * Copyright (c) 2026 Ivo Setyadi — MIT License (see LICENSE)
 * https://github.com/ivosetyadi/quran-recital
 * Vanilla JS: play audio (CDN, with fallback) + word-by-word highlight.
 */
'use strict';

const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
const toArabic = (n) => String(n).split('').map((d) => AR_DIGITS[+d] ?? d).join('');
const pad3 = (n) => String(n).padStart(3, '0');

const el = (id) => document.getElementById(id);
const audio = el('audio');

// loading indicator (shown during real network fetches, hidden when done)
let loadingCount = 0;
function showLoading() { loadingCount++; el('loading').hidden = false; }
function hideLoading() { loadingCount = Math.max(0, loadingCount - 1); if (loadingCount === 0) el('loading').hidden = true; }

let data = null;      // current surah data
let idx = 0;          // current ayah index
let rafId = null;
let cdnIdx = 0;       // current audio CDN index
let curUrls = [];     // audio URLs for the current ayah
let wantPlaying = false;

// extra per-word translation (fetched live from Quran.com API; CORS-enabled)
const EXTRA_LANGS = [
  { iso: 'id', name: 'Indonesian' }, { iso: 'ur', name: 'Urdu' },
  { iso: 'bn', name: 'Bengali' }, { iso: 'tr', name: 'Turkish' },
  { iso: 'fa', name: 'Persian' }, { iso: 'hi', name: 'Hindi' },
  { iso: 'ta', name: 'Tamil' },
];
const RTL_LANGS = ['ur', 'fa'];
let extraIso = '';          // '' = off
let curExtra = null;        // map { ayahNumber: [gloss per word] } for current surah+lang
const extraCache = {};      // key `${iso}:${surahId}` -> map
let lastActive = -1;        // last highlighted word index (for auto-scroll)

async function loadExtra(iso, surahId) {
  const key = `${iso}:${surahId}`;
  if (extraCache[key]) return extraCache[key];
  // pre-hosted locally: data/wbw/{iso}/{NNN}.json = { "<ayah>": [gloss...] } — instant, no API
  showLoading();
  try {
    const map = await (await fetch(`data/wbw/${iso}/${pad3(surahId)}.json`)).json();
    extraCache[key] = map;
    return map;
  } finally { hideLoading(); }
}
function setCurExtra() {
  curExtra = extraIso && data ? (extraCache[`${extraIso}:${data.chapter.id}`] || null) : null;
}

// ---------- data ----------
let SURAHS = []; // [{id,name}] from manifest

async function loadManifest() {
  SURAHS = await (await fetch('data/manifest.json')).json();
  const sel = el('surahSelect');
  const dl = el('surahList');
  sel.innerHTML = '';
  dl.innerHTML = '';
  SURAHS.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.id}. ${s.name}`;
    sel.appendChild(o);
    const d = document.createElement('option'); // datalist entry for search
    d.value = `${s.id}. ${s.name}`;
    dl.appendChild(d);
  });
}

async function loadSurah(surahId) {
  showLoading();
  try {
    data = await (await fetch(`data/${pad3(surahId)}.json`)).json();
    idx = 0;
    el('credit').textContent = 'Recited by ' + data.reciter;
    el('surahSelect').value = surahId;
  } finally { hideLoading(); }
}

// ---------- audio with CDN fallback ----------
function audioUrlsFor(ay) {
  // islamic.network is ~5x faster and timing-identical (same recording, verified);
  // everyayah + mirror as fallback.
  return [
    `https://cdn.islamic.network/quran/audio/64/ar.husary/${ay.global}.mp3`,
    ...(data.audioCdns || []).map((b) => b + ay.audio),
  ];
}
function setAudio(ay) {
  curUrls = audioUrlsFor(ay);
  cdnIdx = 0;
  audio.src = curUrls[0];
  audio.playbackRate = parseFloat(el('speedSelect').value);
}
audio.addEventListener('error', () => {
  if (cdnIdx < curUrls.length - 1) {
    cdnIdx++;
    console.warn('audio CDN failed, trying next:', curUrls[cdnIdx]);
    const at = audio.currentTime || 0;
    audio.src = curUrls[cdnIdx];
    audio.load();
    audio.currentTime = at;
    if (wantPlaying) audio.play().catch(() => {});
  }
});

// ---------- render (interlinear: each word is a column Arabic/translit/meaning) ----------
function renderVerse(words) {
  const v = el('verse');
  v.innerHTML = '';
  const ayahNo = data.ayat[idx].ayah;
  const extra = curExtra && curExtra[ayahNo];
  const extraRtl = RTL_LANGS.includes(extraIso);
  words.forEach((w, i) => {
    const u = document.createElement('div');
    u.className = 'w';
    for (const [cls, val] of [['ar', w.ar], ['tr', w.tr], ['en', w.en]]) {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = val;
      u.appendChild(d);
    }
    if (extra) {
      const q = document.createElement('div');
      q.className = 'qul';
      q.textContent = extra[i] || '';
      q.dir = extraRtl ? 'rtl' : 'ltr';
      u.appendChild(q);
    }
    u.addEventListener('click', () => seekToWord(i));
    v.appendChild(u);
  });
}

function renderAyah() {
  const ay = data.ayat[idx];
  const c = data.chapter;
  el('headerAr').textContent = `${toArabic(c.id)} · ${c.name_arabic} · آية ${toArabic(ay.ayah)}`;
  el('headerEn').textContent = `${c.id} · ${c.name_simple} · Verse ${ay.ayah}`;
  el('ayahIndicator').textContent = `${ay.ayah}/${c.verses_count}`;
  setCurExtra();
  renderVerse(ay.words);
  lastActive = -1;
  setAudio(ay);
  paintHighlight(0);
}

// ---------- highlight sync ----------
function state(w, ms) {
  if (w.start == null || w.end == null) return 'future';
  if (ms >= w.end) return 'past';
  if (ms >= w.start) return 'active';
  return 'future';
}
function paintHighlight(ms) {
  const words = data.ayat[idx].words;
  const units = el('verse').children;
  let active = -1;
  for (let i = 0; i < words.length; i++) {
    const st = state(words[i], ms);
    const u = units[i];
    if (st === 'active') active = i;
    if (u.dataset.st !== st) {
      u.classList.remove('past', 'active');
      if (st !== 'future') u.classList.add(st);
      u.dataset.st = st;
    }
  }
  // auto-scroll: keep the current word centered (only on change, while playing)
  if (active !== -1 && active !== lastActive && wantPlaying) {
    units[active].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  if (active !== -1) lastActive = active;
}
function tick() {
  paintHighlight(audio.currentTime * 1000);
  rafId = requestAnimationFrame(tick);
}

// ---------- controls ----------
function play() {
  wantPlaying = true;
  audio.play().catch(() => {});
  el('playBtn').textContent = '⏸';
  cancelAnimationFrame(rafId);
  tick();
}
function pause() {
  wantPlaying = false;
  audio.pause();
  el('playBtn').textContent = '▶';
  cancelAnimationFrame(rafId);
}
function togglePlay() { audio.paused ? play() : pause(); }

function goAyah(i, autoplay) {
  if (i < 0 || i >= data.ayat.length) return;
  idx = i;
  renderAyah();
  if (autoplay) play(); else pause();
  updateHash();
}
function seekToWord(i) {
  const w = data.ayat[idx].words[i];
  if (w.start != null) { audio.currentTime = w.start / 1000; play(); }
}

// ---------- hash routing (#/surah/ayah[/lang]) ----------
function updateHash() {
  const base = `#/${data.chapter.id}/${data.ayat[idx].ayah}`;
  history.replaceState(null, '', extraIso ? `${base}/${extraIso}` : base);
}
function parseHash() {
  const m = location.hash.match(/#\/(\d+)\/(\d+)(?:\/([a-z]+))?/i);
  return m ? { surah: +m[1], ayah: +m[2], lang: (m[3] || '').toLowerCase() } : null;
}
function readHash() {
  const h = parseHash();
  if (h) { const f = data.ayat.findIndex((x) => x.ayah === h.ayah); if (f >= 0) idx = f; }
}

// ---------- init ----------
async function openSurah(surahId, autoplay) {
  await loadSurah(surahId);
  if (extraIso) { try { await loadExtra(extraIso, surahId); } catch {} }
  renderAyah();
  updateHash();
  if (autoplay) play();
}

async function init() {
  await loadManifest();

  el('surahSelect').addEventListener('change', (e) => openSurah(parseInt(e.target.value, 10), false));
  el('surahSearch').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    if (!v) return;
    let s = SURAHS.find((x) => `${x.id}. ${x.name}`.toLowerCase() === v.toLowerCase())
      || SURAHS.find((x) => x.name.toLowerCase().includes(v.toLowerCase()));
    if (!s && /^\d+$/.test(v)) s = SURAHS.find((x) => x.id === +v);
    if (s) { e.target.value = ''; openSurah(s.id, false); }
  });
  el('playBtn').addEventListener('click', togglePlay);
  el('prevBtn').addEventListener('click', () => goAyah(idx - 1, wantPlaying));
  el('nextBtn').addEventListener('click', () => goAyah(idx + 1, wantPlaying));
  el('speedSelect').addEventListener('change', () => {
    audio.playbackRate = parseFloat(el('speedSelect').value);
  });

  // extra translation (pre-hosted locally in data/wbw/)
  const langSel = el('extraLang');
  let langs = EXTRA_LANGS;
  try { langs = await (await fetch('data/wbw/langs.json')).json(); } catch {}
  langSel.innerHTML = '<option value="">— language —</option>' +
    langs.map((l) => `<option value="${l.iso}">${l.name}</option>`).join('');
  el('extraToggle').addEventListener('change', async (e) => {
    langSel.disabled = !e.target.checked;
    if (!e.target.checked) { extraIso = ''; setCurExtra(); renderAyah(); updateHash(); return; }
    if (langSel.value) langSel.dispatchEvent(new Event('change'));
  });
  langSel.addEventListener('change', async () => {
    extraIso = langSel.value;
    if (!extraIso) { setCurExtra(); renderAyah(); updateHash(); return; }
    try { await loadExtra(extraIso, data.chapter.id); } catch {}
    setCurExtra();
    renderAyah();
    updateHash();
  });

  audio.addEventListener('ended', () => {
    const mode = el('playMode').value;
    if (mode === 'repeat-ayah') { audio.currentTime = 0; play(); return; }
    pause();
    if (mode === 'stop') return;
    if (idx < data.ayat.length - 1) { goAyah(idx + 1, true); return; }
    // end of surah
    if (mode === 'repeat-surah') { goAyah(0, true); return; }
    const nextId = data.chapter.id + 1; // 'advance' (Continuous) → next surah
    if (nextId <= 114) openSurah(nextId, true);
  });

  // initial load from hash (#/s/a[/lang]) or default
  const h = parseHash();
  const first = parseInt(el('surahSelect').value, 10) || 1;
  const startSurah = h ? h.surah : first;
  await loadSurah(startSurah);
  readHash();
  if (h && h.lang && Array.from(langSel.options).some((o) => o.value === h.lang)) {
    el('extraToggle').checked = true;
    langSel.disabled = false;
    langSel.value = h.lang;
    extraIso = h.lang;
    try { await loadExtra(extraIso, startSurah); } catch {}
  }
  renderAyah();
}

document.addEventListener('DOMContentLoaded', init);
