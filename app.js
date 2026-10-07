// Quran Recital — Slow Step. Vanilla JS: play audio (CDN, with fallback) + word highlight.
'use strict';

const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
const toArabic = (n) => String(n).split('').map((d) => AR_DIGITS[+d] ?? d).join('');
const pad3 = (n) => String(n).padStart(3, '0');

const el = (id) => document.getElementById(id);
const audio = el('audio');

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
  const map = {};
  let page = 1;
  while (true) {
    const url = `https://api.quran.com/api/v4/verses/by_chapter/${surahId}?words=true&language=${iso}&word_fields=text_uthmani&per_page=50&page=${page}`;
    const d = await (await fetch(url)).json();
    d.verses.forEach((v) => {
      map[v.verse_number] = v.words.filter((w) => w.char_type_name === 'word').map((w) => w.translation?.text || '');
    });
    if (!d.pagination || !d.pagination.next_page) break;
    page = d.pagination.next_page;
  }
  extraCache[key] = map;
  return map;
}
function setCurExtra() {
  curExtra = extraIso && data ? (extraCache[`${extraIso}:${data.chapter.id}`] || null) : null;
}

// ---------- data ----------
async function loadManifest() {
  const list = await (await fetch('data/manifest.json')).json();
  const sel = el('surahSelect');
  sel.innerHTML = '';
  list.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.id}. ${s.name}`;
    sel.appendChild(o);
  });
}

async function loadSurah(surahId) {
  data = await (await fetch(`data/${pad3(surahId)}.json`)).json();
  idx = 0;
  el('credit').textContent = 'Recited by ' + data.reciter;
  el('surahSelect').value = surahId;
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

// ---------- hash routing (#/surah/ayah) ----------
function updateHash() {
  history.replaceState(null, '', `#/${data.chapter.id}/${data.ayat[idx].ayah}`);
}
function readHash() {
  const m = location.hash.match(/#\/(\d+)\/(\d+)/);
  if (m) {
    const found = data.ayat.findIndex((x) => x.ayah === parseInt(m[2], 10));
    if (found >= 0) idx = found;
  }
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
  el('playBtn').addEventListener('click', togglePlay);
  el('prevBtn').addEventListener('click', () => goAyah(idx - 1, wantPlaying));
  el('nextBtn').addEventListener('click', () => goAyah(idx + 1, wantPlaying));
  el('speedSelect').addEventListener('change', () => {
    audio.playbackRate = parseFloat(el('speedSelect').value);
  });

  // extra translation (live from Quran.com API)
  const langSel = el('extraLang');
  langSel.innerHTML = '<option value="">— language —</option>' +
    EXTRA_LANGS.map((l) => `<option value="${l.iso}">${l.name}</option>`).join('');
  el('extraToggle').addEventListener('change', async (e) => {
    langSel.disabled = !e.target.checked;
    if (!e.target.checked) { extraIso = ''; setCurExtra(); renderAyah(); return; }
    if (langSel.value) langSel.dispatchEvent(new Event('change'));
  });
  langSel.addEventListener('change', async () => {
    extraIso = langSel.value;
    if (!extraIso) { setCurExtra(); renderAyah(); return; }
    try { await loadExtra(extraIso, data.chapter.id); } catch {}
    setCurExtra();
    renderAyah();
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

  // initial surah from hash (#/s/a) or default to first in manifest
  const m = location.hash.match(/#\/(\d+)\/(\d+)/);
  const first = parseInt(el('surahSelect').value, 10) || 1;
  await loadSurah(m ? parseInt(m[1], 10) : first);
  readHash();
  renderAyah();
}

document.addEventListener('DOMContentLoaded', init);
