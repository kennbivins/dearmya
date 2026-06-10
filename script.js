// ─── CONFIG ───────────────────────────────────────────────────
// Your Google Sheet ID — must be shared as "Anyone with link — Viewer"
const SHEET_ID = '14uYCRxfeO63Fobux1MJy-33697jTfm90vQwvRxX5aLQ';

// ─── IMAGE URL NORMALIZER ──────────────────────────────────────
// Converts any Drive share URL to a thumbnail URL that browsers
// can load directly without CORS issues.
// Also catches Google Photos links and warns the user.
function normalizeImageUrl(url) {
  if (!url) return url;

  if (url.includes('photos.app.goo.gl') || url.includes('photos.google.com')) {
    return '__GOOGLE_PHOTOS__';
  }

  if (!url.includes('drive.google.com')) return url;

  let fileId = null;
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) fileId = fileMatch[1];
  if (!fileId) {
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch) fileId = idMatch[1];
  }
  if (!fileId) return url;

  // thumbnail endpoint: public, CORS-safe, supports sz param for resolution
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600-h900`;
}

// ─── CSV → QUOTES ──────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  function parseLine(line) {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
      else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g,'_'));
  const qi = headers.indexOf('quote'), ai = headers.indexOf('author'), ii = headers.indexOf('image_url');
  if (qi < 0 || ai < 0 || ii < 0) return null;

  return lines.slice(1)
    .map(l => parseLine(l))
    .filter(r => r[qi] && r[ai] && r[ii])
    .map(r => ({ text: r[qi], author: r[ai], imageUrl: normalizeImageUrl(r[ii]) }));
}

// ─── FETCH SHEET ───────────────────────────────────────────────
// Uses the public CSV export URL — works from any server when the
// sheet is shared as "Anyone with link — Viewer". No API key needed.
async function loadSheet() {
  // Published CSV URL from File → Share → Publish to web → CSV
  const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTO58wXAddfNfOo3yh5ZPlmUd8KOLcQNnlK7J3Yjfoz1tT3tIiqt5JqQj_G4O6glzUE-GX_6U0Mzwc8/pub?gid=847987611&single=true&output=csv';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();
  const quotes = parseCSV(text);
  if (!quotes || !quotes.length) throw new Error('No quotes found — check column headers: quote, author, image_url');
  return quotes;
}

// ─── STATE ────────────────────────────────────────────────────
let QUOTES = [];
let currentIndex = 0;
const imageCache = {};

// ─── DOM ─────────────────────────────────────────────────────
const bgA         = document.getElementById('bg-a');
const bgB         = document.getElementById('bg-b');
const curtain     = document.getElementById('curtain');
const quoteText   = document.getElementById('quote-text');
const attrName    = document.getElementById('attr-name');
const attribution = document.getElementById('attribution');
const filmstrip   = document.getElementById('filmstrip');
const counter     = document.getElementById('counter');
const datestamp   = document.getElementById('datestamp');
const loading     = document.getElementById('loading');
// const refreshBtn  = document.getElementById('refresh-btn');
const toast       = document.getElementById('toast');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setDate() {
  datestamp.textContent = new Date()
    .toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})
    .toUpperCase();
}

function showToast(msg, ms = 3000) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), ms);
}

// ─── PRELOAD ──────────────────────────────────────────────────
function preloadImage(url) {
  if (url === '__GOOGLE_PHOTOS__') return Promise.resolve('__GOOGLE_PHOTOS__');
  return new Promise(resolve => {
    if (imageCache[url]) { resolve(url); return; }
    const img = new Image();
    img.onload  = () => { imageCache[url] = true; resolve(url); };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

// ─── WORD REVEAL ──────────────────────────────────────────────
function revealWords(text) {
  quoteText.innerHTML = '';
  attribution.classList.remove('visible');

  const open = document.createElement('span');
  open.className = 'q-mark';
  open.style.cssText = 'opacity:0;transition:opacity 0.5s ease';
  open.textContent = '\u201C';
  quoteText.appendChild(open);
  requestAnimationFrame(() => { open.style.opacity = '1'; });

  const words = text.split(' ');
  const BASE = 200, STAGGER = 58;
  words.forEach((word, i) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = (i === 0 ? '' : ' ') + word;
    quoteText.appendChild(span);
    setTimeout(() => span.classList.add('visible'), BASE + i * STAGGER);
  });

  const close = document.createElement('span');
  close.className = 'word q-mark-close';
  close.textContent = '\u201D';
  quoteText.appendChild(close);
  setTimeout(() => close.classList.add('visible'), BASE + words.length * STAGGER);
  setTimeout(() => attribution.classList.add('visible'), BASE + (words.length + 1) * STAGGER + 300);
}

// ─── FILMSTRIP ────────────────────────────────────────────────
function buildThumb(q, idx) {
  const div = document.createElement('div');
  div.className = 'thumb';
  div.dataset.idx = idx;
  div.title = `"${q.text.substring(0,45)}…" — ${q.author}`;
  const img = document.createElement('img');
  img.src = q.imageUrl === '__GOOGLE_PHOTOS__' ? '' : q.imageUrl;
  img.alt = q.author; img.loading = 'lazy';
  const num = document.createElement('div');
  num.className = 'thumb-num';
  num.textContent = String(idx+1).padStart(2,'0');
  div.appendChild(img); div.appendChild(num);
  div.addEventListener('click', () => { if (idx !== currentIndex) switchTo(idx); });
  setTimeout(() => { div.style.animationPlayState = 'running'; }, idx * 80 + 400);
  return div;
}

function rebuildFilmstrip() {
  filmstrip.innerHTML = '';
  QUOTES.forEach((q,i) => filmstrip.appendChild(buildThumb(q,i)));
  updateThumbs();
}

function updateThumbs() {
  document.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('active-thumb', parseInt(t.dataset.idx) === currentIndex);
  });
}

// ─── SWITCH ───────────────────────────────────────────────────
async function switchTo(idx, skipCurtain = false) {
  if (!skipCurtain) { curtain.classList.add('closing'); await sleep(500); }
  currentIndex = idx;
  const q = QUOTES[idx];

  const resolvedUrl = await preloadImage(q.imageUrl);

  if (resolvedUrl === '__GOOGLE_PHOTOS__') {
    if (!skipCurtain) curtain.classList.remove('closing');
    revealWords(q.text);
    attrName.textContent = q.author;
    counter.textContent = `${String(idx+1).padStart(2,'0')} / ${String(QUOTES.length).padStart(2,'0')}`;
    updateThumbs();
    showToast('Google Photos links don\'t work — use Google Drive instead');
    return;
  }

  bgA.style.transition = 'none';
  bgA.style.backgroundImage = `url(${resolvedUrl})`;
  bgA.classList.add('active');   bgA.classList.remove('inactive');
  bgB.classList.add('inactive'); bgB.classList.remove('active');

  revealWords(q.text);
  attrName.textContent = q.author;
  counter.textContent = `${String(idx+1).padStart(2,'00')} / ${String(QUOTES.length).padStart(2,'0')}`;
  updateThumbs();

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => requestAnimationFrame(r));

  if (!skipCurtain) curtain.classList.remove('closing');
  setTimeout(() => { bgA.style.transition = ''; }, 550);

  [idx-1, idx+1].forEach(n => { if (QUOTES[n]) preloadImage(QUOTES[n].imageUrl); });
}

function goNext() {
  const next = (currentIndex + 1) % QUOTES.length;
  switchTo(next);
  const thumbs = filmstrip.querySelectorAll('.thumb');
  if (thumbs[next]) thumbs[next].scrollIntoView({behavior:'smooth',inline:'center'});
}

// ─── KEYBOARD / SWIPE ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
  if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')
    switchTo((currentIndex - 1 + QUOTES.length) % QUOTES.length);
});
let tx = 0;
document.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, {passive:true});
document.addEventListener('touchend',   e => {
  const dx = e.changedTouches[0].clientX - tx;
  if (Math.abs(dx) > 50) dx < 0 ? goNext() : switchTo((currentIndex-1+QUOTES.length) % QUOTES.length);
}, {passive:true});
document.getElementById('nav-next').addEventListener('click', goNext);

// ─── SYNC BUTTON ──────────────────────────────────────────────
// On a real server this works perfectly — fetches live from the sheet.
// In the Claude preview sandbox, cross-origin fetches are blocked,
// so it will show a toast explaining that.
// refreshBtn.addEventListener('click', async () => {
//   refreshBtn.classList.add('spinning');
//   refreshBtn.disabled = true;
//   try {
//     const fresh = await loadSheet();
//     QUOTES = fresh;
//     currentIndex = 0;
//     rebuildFilmstrip();
//     await switchTo(0, true);
//     showToast(`↑ ${QUOTES.length} quotes synced from sheet`);
//   } catch (err) {
//     console.error('Sync failed:', err);
//     showToast('Sync works on your server — preview blocks external fetches');
//   } finally {
//     refreshBtn.classList.remove('spinning');
//     refreshBtn.disabled = false;
//   }
// });

// ─── INIT ─────────────────────────────────────────────────────
async function init() {
  setDate();
  try {
    QUOTES = await loadSheet();
  } catch (err) {
    console.warn('Sheet load failed, no fallback:', err);
    loading.classList.add('hidden');
    showToast('Could not load sheet — check sharing settings', 5000);
    return;
  }
  rebuildFilmstrip();
  const firstUrl = await preloadImage(QUOTES[0].imageUrl);
  if (firstUrl !== '__GOOGLE_PHOTOS__') {
    bgA.style.backgroundImage = `url(${firstUrl})`;
  }
  revealWords(QUOTES[0].text);
  attrName.textContent = QUOTES[0].author;
  counter.textContent = `01 / ${String(QUOTES.length).padStart(2,'0')}`;
  updateThumbs();
  loading.classList.add('hidden');
  QUOTES.slice(1, 3).forEach(q => preloadImage(q.imageUrl));
}

init();
