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
    console.warn('audio CDN gagal, coba berikutnya:', curUrls[cdnIdx]);
    const at = audio.currentTime || 0;
    audio.src = curUrls[cdnIdx];
    audio.load();
    audio.currentTime = at;
    if (wantPlaying) audio.play().catch(() => {});
  }
});

// ---------- render ----------
function wordSpans(container, words, key) {
  container.innerHTML = '';
  words.forEach((w, i) => {
    const s = document.createElement('span');
    s.className = 'word';
    s.textContent = w[key];
    s.addEventListener('click', () => seekToWord(i));
    container.appendChild(s);
  });
}

function renderAyah() {
  const ay = data.ayat[idx];
  const c = data.chapter;
  el('headerAr').textContent = `${toArabic(c.id)} · ${c.name_arabic} · آية ${toArabic(ay.ayah)}`;
  el('headerEn').textContent = `${c.id} · ${c.name_simple} · Verse ${ay.ayah}`;
  el('ayahIndicator').textContent = `${ay.ayah}/${c.verses_count}`;
  wordSpans(el('arabic'), ay.words, 'ar');
  wordSpans(el('translit'), ay.words, 'tr');
  wordSpans(el('english'), ay.words, 'en');
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
  [el('arabic'), el('translit'), el('english')].forEach((layer) => {
    const spans = layer.children;
    for (let i = 0; i < words.length; i++) {
      const st = state(words[i], ms);
      const sp = spans[i];
      if (sp.dataset.st !== st) {
        sp.classList.remove('past', 'active');
        if (st !== 'future') sp.classList.add(st);
        sp.dataset.st = st;
      }
    }
  });
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
  renderAyah();
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

  audio.addEventListener('ended', () => {
    if (el('repeatAyah').checked) { audio.currentTime = 0; play(); return; }
    pause();
    if (el('autoAdvance').checked && idx < data.ayat.length - 1) goAyah(idx + 1, true);
  });

  // initial surah from hash (#/s/a) or default to first in manifest
  const m = location.hash.match(/#\/(\d+)\/(\d+)/);
  const first = parseInt(el('surahSelect').value, 10) || 1;
  await loadSurah(m ? parseInt(m[1], 10) : first);
  readHash();
  renderAyah();
}

document.addEventListener('DOMContentLoaded', init);
