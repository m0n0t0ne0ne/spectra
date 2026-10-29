import { NUTRIENTS, BY_KEY, GROUPS, fmt, deriveTotals } from './nutrients.js';
import { storageUsage, exportData, importPreview, importData, dataBreakdown, deleteDiaryMonths, deleteBodyMonths, deleteFoods } from './store.js';
import { store, sortMeal, energyTargetFor, totals, coverage, todayISO, ACTIVITY_LEVELS, ACTIVITY_TYPES, activityKcalFor, activityName, bmrFor, dayEnergy, activityKcal } from './store.js';
import { fdcSearch, isPlaceholderServing } from './api.js';
import { lookupBarcode, foodFromSearchHit } from './pipeline.js';
import { startScanner, stopScanner, decodeImageFile } from './scanner.js';
import { parseLocal, detectBasis, firstUrl, servingFromText } from './paste.js';
import { foodTile, foodKind, FOOD_KINDS } from './foodicon.js';
import { insightsHTML } from './insights.js';
import { geminiNutrientPrompt } from './prompts.js';
import { INFO, MACRO_KEYS, ulFor, DRI_NAME, describePerson, lifeStageCalories } from './nutrient-info.js';

/* ---------------- helpers ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const view = () => $('#main');
// Inside the Android app the native layer provides AndroidBridge (Google barcode scanner, file saving).
const NATIVE = typeof window.AndroidBridge !== 'undefined';
const APP_VERSION = '1.0.5';
const SITE = 'https://m0n0t0ne0ne.github.io/spectra/';
const appVersion = () => { try { return (NATIVE && window.AndroidBridge.appVersion?.()) || APP_VERSION; } catch { return APP_VERSION; } };
// Text shared to the app (Gemini's answer → Share → Spectra) opens the paste sheet for the food you asked about.
// Gemini's "Product: Brand – Name" and "Serving size:" lines fill whatever the scan couldn't: a barcode nobody knew
// gets its name, brand and serving; a scanned product missing its name or brand gets just those.
const placeholderName = (n) => !n || /^(barcode \d+|unnamed product|new food)$/i.test(n.trim());
function identifyFromText(food, text) {
  const clean = (x) => x.replace(/[*_#`]/g, '').trim();
  const prod = text.match(/^[\s*_#-]*product\s*:\s*(.+)$/im);
  const serv = text.match(/^[\s*_#-]*serving size\s*:\s*(.+)$/im);
  const patch = {};
  if (prod) {
    const [first, ...rest] = clean(prod[1]).split(/\s+[–—-]\s+/);
    const brand = rest.length ? first.trim() : '';
    const name = (rest.length ? rest.join(' – ') : first).trim();
    if (name && (food.unidentified || placeholderName(food.name))) patch.name = name;
    if (brand && (food.unidentified || !food.brand)) patch.brand = brand;
    if (food.unidentified) patch.unidentified = false;
  }
  if (serv && (food.unidentified || !(food.servings || []).some((x) => x.grams > 0 && !isPlaceholderServing(x)))) {
    const g = clean(serv[1]).match(/(\d+(?:\.\d+)?)\s*(g|grams?)\b/i);
    if (g) {
      const label = clean(serv[1]).replace(/\s*\(\s*\d+(?:\.\d+)?\s*(g|grams?)\s*\)\s*/i, '').trim() || 'Serving';
      patch.servings = [{ label: `${label} (${+Number(g[1]).toFixed(2)} g)`, grams: Number(g[1]) }, ...(food.servings || [])];
    }
  }
  if (!Object.keys(patch).length) return food;
  const what = [patch.name && 'name', patch.brand && 'brand', patch.servings && 'serving size'].filter(Boolean);
  if (what.length) patch.sources = [...(food.sources || []), { kind: 'label', title: 'Product info: Gemini app', count: 0, note: `${what.join(', ').replace(/^./, (c) => c.toUpperCase())} from Gemini’s answer` }];
  return store.saveFood({ ...store.food(food.id), ...patch });
}

window.__onSharedText = (text) => {
  const s = store.settings();
  let food = (s.askedFood && store.food(s.askedFood)) || store.recentFoods(1)[0];
  if (!food || !text) return;
  if (/^\s*https?:\/\/\S+\s*$/.test(String(text))) { toast('Gemini shared a link, not the answer. In Gemini, long-press the answer and choose Copy, then use Paste answer.'); return; }
  food = identifyFromText(food, String(text));
  location.hash = `#/food/${encodeURIComponent(food.id)}`;
  setTimeout(() => { openPaste(food); ui.paste.text = String(text); renderPaste(); }, 120);
};
window.__onNativeScan = (code) => { if (parseRoute().name === 'scan') runLookup(String(code).replace(/\D/g, '')); };
window.__onNativeScanCancel = () => { const m = $('#scan-msg'); if (m) { m.hidden = false; m.textContent = 'Scan cancelled. Tap Scan barcode to try again, or type the number.'; } };
window.__onNativeScanError = (msg) => { const m = $('#scan-msg'); if (m) { m.hidden = false; m.textContent = 'Scanner unavailable: ' + msg + '. Type the number instead.'; } };

const mealName = (k) => store.meals().find((m) => m.key === k)?.name || 'Meal';
const MACROS = [
  { key: 'protein', name: 'Protein', color: 'var(--lilac)', kcal: 4 },
  { key: 'carbs', name: 'Carbs', color: 'var(--sky)', kcal: 4 },
  { key: 'fat', name: 'Fat', color: 'var(--wheat)', kcal: 9 }
];
const SRC_LABEL = { label: 'Label', spec: 'Spec', lab: 'Lab', est: 'est.' };

function mealForNow(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  const want = h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 17 ? 'snacks' : h < 21.5 ? 'dinner' : 'snacks';
  const meals = store.meals();
  return (meals.find((m) => m.key === want) || meals.find((m) => m.key === 'snacks') || meals[0]).key;
}
const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayTitle(date) {
  const t = todayISO();
  const y = todayISO(new Date(Date.now() - 864e5));
  if (date === t) return 'Today';
  if (date === y) return 'Yesterday';
  return new Date(date + 'T12:00:00').toLocaleDateString([], { weekday: 'long' });
}
// Weights keep one decimal (151.2 lb), unlike nutrient amounts over 100.
const lbs = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
const longDate = (date) => new Date(date + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const shiftDate = (date, days) => todayISO(new Date(new Date(date + 'T12:00:00').getTime() + days * 864e5));
function tsFor(date, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(date + 'T00:00:00');
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const I = {
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
  down: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  insights: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/><path d="M9.5 19.5h5M10.5 22h3"/></svg>',
  dots: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  cal: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  diary: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  report: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  scan: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 9v6M12 9v6M16 9v6"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>',
  target: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  summary: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  copy: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

/* ---------------- UI state ---------------- */

const ui = {
  page: 0, open: {}, swiped: null, menu: null,
  reportGroup: 'Key', foodGroup: 'Key', mealGroup: 'Key', expandedRow: null,
  add: null, scan: null, search: { q: '', results: null }
};

/* ---------------- routing ---------------- */

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'day', parts: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || '')) };
}
const go = (hash) => { location.hash = hash; };

let lastRoute = '';
const scrollMemo = {};
// The diary for today has two addresses (#/ and #/day/<today>); treat them as one page.
function routeKey(hash) {
  const h = (hash || '').replace(/^#/, '');
  if (h === '' || h === '/' || h === `/day/${todayISO()}`) return 'day:' + todayISO();
  return h.split('?')[0];
}

function render() {
  const r = parseRoute();
  const key = location.hash;
  if (r.name !== 'scan') stopScanner();
  const changed = key !== lastRoute;
  // Remember where you were on the page you're leaving, so coming back lands in the same spot.
  if (changed && lastRoute != null) scrollMemo[routeKey(lastRoute)] = window.scrollY;
  lastRoute = key;
  if (changed) {
    ui.menu = null; ui.swiped = null; ui.expandedRow = null;
    // Sheets belong to the page they were opened on (Android's back button also lands here).
    document.querySelectorAll('.scrim').forEach((x) => x.remove());
    ui.paste = null;
  }
  // Horizontal chip rows are rebuilt on each render; remember where they were scrolled.
  const rowScroll = {};
  document.querySelectorAll('.chips.scroll[id]').forEach((el) => { rowScroll[el.id] = el.scrollLeft; });
  switch (r.name) {
    case 'scan': renderScan(r, changed); break;
    case 'food': renderFood(r, changed); break;
    case 'foods': renderScan(r, changed); break;
    case 'report': renderReport(r.parts[0] || todayISO()); break;
    case 'nutrient': renderNutrient(r.parts[0], r.q.date || todayISO()); break;
    case 'meal': renderMeal(r.parts[0] || todayISO(), r.parts[1] || store.meals()[0].key); break;
    case 'settings': renderSettings(); break;
    case 'insights': renderInsights(); break;
    case 'data': renderData(r.parts[0], changed); break;
    default: renderDay(r.parts[0] || todayISO()); placePill(false); fitSummary(); hintSwipe();
  }
  renderTabs(r);
  if (changed) {
    const back = ['day', 'report', 'foods', 'meal', 'settings', 'nutrient', 'insights'].includes(r.name) || r.name === '' || !r.name ? scrollMemo[routeKey(key)] : null;
    const at = r.q?.at && document.getElementById('sec-' + r.q.at);
    if (at) at.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, back || 0);
  }
  document.querySelectorAll('.chips.scroll[id]').forEach((el) => {
    if (!changed && rowScroll[el.id] != null) el.scrollLeft = rowScroll[el.id];
    // Keep the selected chip fully visible without moving the page vertically.
    const sel = el.querySelector('[aria-pressed="true"]');
    if (sel) {
      const left = sel.offsetLeft - el.offsetLeft, right = left + sel.offsetWidth;
      if (left < el.scrollLeft + 16) el.scrollLeft = Math.max(0, left - 16);
      else if (right > el.scrollLeft + el.clientWidth - 16) el.scrollLeft = right - el.clientWidth + 16;
    }
  });
}

function renderTabs(r) {
  const date = ['day', 'report'].includes(r.name) && r.parts[0] ? r.parts[0] : todayISO();
  const cur = (n) => (r.name === n || (n === 'settings' && r.name === 'data') || (n === 'day' && !['report', 'insights', 'settings', 'nutrient', 'data'].includes(r.name)) || (n === 'report' && r.name === 'nutrient') ? 'aria-current="page"' : '');
  $('#tabs').innerHTML = `
    <a href="#/day/${date}" ${cur('day')}>${I.diary}Diary</a>
    <a href="#/report/${date}" ${cur('report')}>${I.report}Report</a>
    <a href="#/insights" ${cur('insights')}>${I.insights}Insights</a>
    <a href="#/settings" ${cur('settings')}>${I.target}Targets</a>`;
  document.querySelector('nav.tabs').hidden = ['scan', 'foods', 'food', 'data'].includes(r.name);
}

/* ---------------- shared pieces ---------------- */

function macroBlock(tot, grams = null) {
  const kcalOf = (m) => (tot[m.key]?.v || 0) * m.kcal;
  const sum = MACROS.reduce((a, m) => a + kcalOf(m), 0) || 1;
  return `
    <div class="stack" style="height:10px" aria-hidden="true">
      ${MACROS.map((m) => `<span style="flex:${kcalOf(m) / sum || 0.0001};background:${m.color}"></span>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" class="mt16">
      ${MACROS.map((m) => `<div class="col" style="gap:3px">
        <span class="row small muted" style="gap:6px"><span class="dot" style="background:${m.color}"></span>${m.name}</span>
        <span class="s15 b6">${fmt(tot[m.key]?.v ?? 0, 'g')}</span>
      </div>`).join('')}
    </div>`;
}

function pctColor(n, pct) {
  if (n.limit && pct > 100) return 'var(--rose)';
  if (pct < 50) return 'var(--wheat)';
  return 'var(--lilac)';
}

const GROUP_TABS = ['Key', 'All', ...GROUPS];
const KEY_SET = ['energy', 'protein', 'carbs', 'fat', 'fiber', 'sodium', 'vit_d', 'vit_a', 'vit_c', 'b12', 'folate', 'calcium', 'iron', 'iodine', 'magnesium', 'potassium', 'omega3'];

// Nutrient list with % of daily target. `rowKey` makes rows expandable to show contributing foods.
function nutrientRows(tot, group, { expandable = false, scope = '', date = todayISO() } = {}) {
  const list = NUTRIENTS.filter((n) => group === 'All' || (group === 'Key' ? KEY_SET.includes(n.key) : n.group === group));
  const rows = list.map((n) => {
    const t = tot[n.key];
    const target = store.target(n.key);
    const v = t?.v;
    const pct = target && v != null ? Math.round((v / target) * 100) : null;
    const est = t && t.estShare > 0.3;
    const rowId = scope + n.key;
    const contributors = (t?.foods || []).filter((f) => f.v > 0);
    const canExpand = expandable && contributors.length > 0;
    const open = canExpand && ui.expandedRow === rowId;
    const swiped = ui.swiped === rowId;
    const inner = `
      <div class="spread" style="align-items:baseline">
        <span class="s15 ellipsis" style="flex:1;font-weight:500">${esc(n.name)}</span>
        ${est ? '<span class="tag est">est.</span>' : ''}
        <span class="s13 muted" style="white-space:nowrap">${v != null ? fmt(v) : '—'}${target ? ' / ' + fmt(target) : ''} ${n.unit}</span>
        <span class="s14 b6" style="width:46px;text-align:right;color:${pct != null ? (n.limit && pct > 100 ? 'var(--rose)' : 'var(--text)') : 'var(--text-3)'}">${pct != null ? pct + '%' : ''}</span>
      </div>
      ${target ? `<div class="bar mt8" aria-hidden="true"><span style="width:${Math.min(100, pct || 0)}%;background:${pctColor(n, pct || 0)}"></span></div>` : ''}`;
    const foods = open ? `<div class="col mt8" style="gap:6px">${contributors.slice(0, 4).map((f) => `<div class="spread s13"><span class="ellipsis muted" style="flex:1">${esc(f.name)}</span><span class="muted" style="white-space:nowrap;flex:none">${fmt(f.v, n.unit)}</span></div>`).join('')}</div>` : '';
    const body = canExpand
      ? `<button class="item col" style="align-items:stretch;padding:13px 0" data-act="row" data-id="${rowId}" aria-expanded="${open ? 'true' : 'false'}">${inner}${foods}</button>`
      : `<div style="padding:13px 0">${inner}</div>`;
    return `<div class="meal-head nut-head ${swiped ? 'open' : ''}" data-head="${rowId}">
      <div class="meal-reveal"><button class="icon-btn" style="background:var(--lilac);color:var(--on-accent)" data-act="nut-open" data-k="${n.key}" data-date="${date}" aria-label="${esc(n.name)} details">${I.dots}</button></div>
      <div class="meal-front" data-swipe="${rowId}">${body}</div>
    </div>`;
  });
  return rows.join('');
}

function groupChips(current, act) {
  return `<div class="chips scroll" id="chips-${act}" role="group" aria-label="Nutrient group">${GROUP_TABS.map((g) => `<button class="chip" data-act="${act}" data-g="${g}" aria-pressed="${g === current}">${g === 'Protein' ? 'Amino acids' : g}</button>`).join('')}</div>`;
}

function entryLine(e) {
  const f = store.food(e.foodId);
  if (!f) return '';
  const kcal = f.per100.energy ? Math.round((f.per100.energy.v * e.grams) / 100) : '—';
  const amt = esc(amountText(e));
  const key = 'e:' + e.id;
  const row = `<a class="item entry-row" draggable="false" data-eid="${e.id}" data-meal="${e.meal}" href="#/food/${encodeURIComponent(f.id)}?entry=${e.id}&date=${e._date}">
    ${foodTile(f, 36)}
    <span class="col" style="flex:1;min-width:0;gap:2px"><span class="s14 ellipsis" style="font-weight:500">${esc(f.name)}</span><span class="small muted">${amt}</span></span>
    <span class="s14 b6">${kcal}</span></a>`;
  const swiped = ui.swiped === key, menu = ui.menu === key;
  const other = e._date === todayISO() ? shiftDate(e._date, 1) : todayISO();
  return `<div class="meal-head entry-head ${swiped ? 'open' : ''}" data-head="${key}" data-eid="${e.id}">
    <div class="meal-reveal"><button class="icon-btn" style="background:var(--lilac);color:var(--on-accent)" data-act="entry-menu" data-key="${key}" aria-label="${esc(f.name)} options" aria-expanded="${menu}">${I.dots}</button></div>
    <div class="meal-front" data-swipe="${key}">${row}</div>
  </div>
  ${menu ? `<div class="menu entry-menu" role="menu">
    <a role="menuitem" href="#/food/${encodeURIComponent(f.id)}?entry=${e.id}&date=${e._date}&at=nutrients" class="b6">${I.summary.replace('currentColor', 'var(--lilac)')} Show nutrition summary</a>
    <button role="menuitem" data-act="entry-copy" data-eid="${e.id}" data-date="${e._date}">${I.copy} Copy to ${other === todayISO() ? 'today' : 'tomorrow'}</button>
    <button role="menuitem" data-act="entry-again" data-eid="${e.id}" data-date="${e._date}">${I.plus} Add again</button>
    <button role="menuitem" class="danger" data-act="entry-remove" data-eid="${e.id}" data-date="${e._date}">${I.trash} Remove from diary</button>
  </div>` : ''}`;
}



// Size the summary card to the tab that's showing, so short tabs don't leave empty space.
let lastSummaryH = null;
// Move the summary to page n: the content slides and the tab pill glides to its tab.
function placePill(animate = true, frac = null) {
  const tabsEl = document.querySelector('.sum-tabs');
  const pill = tabsEl?.querySelector('.sum-pill');
  if (!pill) return;
  const btns = [...tabsEl.querySelectorAll('.sum-tab')];
  const pos = frac ?? (ui.page || 0);
  const a = btns[Math.floor(pos)] || btns[0], b = btns[Math.ceil(pos)] || a, t = pos - Math.floor(pos);
  const x = a.offsetLeft + (b.offsetLeft - a.offsetLeft) * t;
  const w = a.offsetWidth + (b.offsetWidth - a.offsetWidth) * t;
  pill.style.transition = animate ? '' : 'none';
  pill.style.transform = `translateX(${x}px)`;
  pill.style.width = `${w}px`;
}
function setSummaryPage(n, animate = true) {
  const track = document.querySelector('.sum-track');
  if (!track) return;
  const N = track.children.length;
  n = Math.max(0, Math.min(N - 1, n));
  ui.page = n;
  track.style.transition = animate ? 'transform .34s cubic-bezier(.2,.8,.2,1)' : 'none';
  track.style.transform = `translateX(-${n * (100 / N)}%)`;
  [...track.children].forEach((p, i) => p.setAttribute('aria-hidden', String(i !== n)));
  document.querySelectorAll('.sum-tab').forEach((b, i) => b.setAttribute('aria-selected', String(i === n)));
  placePill(animate);
  fitSummary();
}

function fitSummary() {
  const box = document.querySelector('[data-summary]');
  if (!box) return;
  const panel = box.querySelectorAll('[role=tabpanel]')[ui.page || 0];
  if (!panel) return;
  const h = panel.offsetHeight;
  if (lastSummaryH != null) { box.style.height = lastSummaryH + 'px'; box.offsetHeight; }
  box.style.height = h + 'px';
  lastSummaryH = h;
}

// One gentle peek on the first meal with food, to show it can be swiped, until the first real swipe.
let hintedThisSession = false;
function hintSwipe() {
  if (hintedThisSession || store.settings().swipeHintSeen) return;
  const meal = [...document.querySelectorAll('.meal-head')].find((h) => h.closest('.meal')?.querySelector('.item'));
  if (!meal) return;
  hintedThisSession = true;
  setTimeout(() => meal.classList.add('peek'), 700);
  meal.addEventListener('animationend', () => meal.classList.remove('peek'), { once: true });
}

/* ---------------- Diary ---------------- */


function greeting() {
  const h = new Date().getHours();
  const name = store.settings().name;
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${esc(name)}` : part;
}

function weekStrip(date) {
  const d = new Date(date + 'T12:00:00');
  const monday = shiftDate(date, -((d.getDay() + 6) % 7));
  const log = store.log();
  const today = todayISO();
  return `<nav aria-label="Week" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px">
    ${Array.from({ length: 7 }, (_, i) => {
      const day = shiftDate(monday, i);
      const dd = new Date(day + 'T12:00:00');
      const sel = day === date;
      const future = day > today;
      const logged = (log[day] || []).length > 0;
      const inner = `<span style="font-size:11px;color:${sel ? 'var(--lilac)' : 'var(--text-3)'}">${dd.toLocaleDateString([], { weekday: 'short' })}</span>
        <span style="font-size:16px;font-weight:600">${dd.getDate()}</span>
        <span style="width:4px;height:4px;border-radius:2px;background:${logged ? (sel ? 'var(--lilac)' : 'var(--text-4)') : 'transparent'}"></span>`;
      const style = `height:64px;border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:${sel ? 'var(--fill-2)' : 'transparent'};color:${future ? 'var(--text-3)' : 'var(--text)'}`;
      return future
        ? `<span style="${style}" aria-disabled="true">${inner}</span>`
        : `<a href="#/day/${day}" aria-label="${dd.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}" ${sel ? 'aria-current="date"' : ''} style="${style}">${inner}</a>`;
    }).join('')}
  </nav>`;
}

// Daily balance = eaten − burned. Over +50 kcal is a surplus, 0 to 50 is maintaining, below 0 is a deficit.
const BALANCE = {
  surplus: { label: 'Surplus', color: 'var(--wheat)' },
  maintain: { label: 'Maintaining', color: 'var(--lilac)' },
  deficit: { label: 'Deficit', color: 'var(--sky)' }
};
function balanceStatus(b) { return b > 50 ? 'surplus' : b >= 0 ? 'maintain' : 'deficit'; }

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

// Calories eaten per day for the last 7 or 30 days, against calories burned.
function trendData(date, range) {
  const n = range === 'month' ? 30 : 7;
  const target = store.target('energy') || 0;
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(date, i - (n - 1));
    const entries = store.day(d);
    const eaten = entries.length ? totals(entries).energy?.v || 0 : null;
    const en = dayEnergy(d, eaten || 0);
    const ref = en.ready ? en.burned : target || null; // burned when BMR is set up, else the target
    const balance = eaten != null && ref ? eaten - ref : null;
    return { date: d, eaten, ref, burnedKnown: en.ready, balance, status: balance == null ? null : balanceStatus(balance) };
  });
}

function trendDetail(day) {
  const label = new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (day.eaten == null) return `<span class="s13 muted">${label} · nothing logged</span>`;
  const st = day.status ? BALANCE[day.status] : null;
  const sign = day.balance > 0 ? '+' : day.balance < 0 ? '−' : '';
  return `<span class="s13"><span class="muted">${label} · </span><b class="b6">${fmt(Math.round(day.eaten))}</b> <span class="muted">eaten${day.ref ? ` · ${fmt(Math.round(day.ref))} ${day.burnedKnown ? 'burned' : 'target'}` : ''}</span>${st ? ` · <span class="b6" style="color:${st.color}">${sign}${fmt(Math.abs(Math.round(day.balance)))} ${st.label.toLowerCase()}</span>` : ''}</span>`;
}

function trendPage(date) {
  const range = store.settings().trendRange === 'month' ? 'month' : 'week';
  const days = trendData(date, range);
  const logged = days.filter((d) => d.eaten != null);
  const anyBurned = days.some((d) => d.burnedKnown);
  const W = 320, H = 150, top = 10, bottom = 22, left = 30, right = 4;
  const plotH = H - top - bottom, plotW = W - left - right;
  const max = Math.max(500, ...days.map((d) => Math.max(d.eaten || 0, d.ref || 0))) * 1.08;
  const step = max > 3200 ? 1000 : 500;
  const y = (v) => top + plotH - (v / max) * plotH;
  const slot = plotW / days.length;
  const bw = Math.max(3, Math.min(26, slot * (range === 'month' ? 0.62 : 0.56)));
  const grid = [];
  for (let v = step; v < max; v += step) grid.push(v);
  const sel = days.findIndex((d) => d.date === date);
  const bars = days.map((d, i) => {
    const cx = left + slot * i + slot / 2;
    const hit = `<rect x="${(cx - slot / 2).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${plotH + bottom}" fill="transparent" data-trend-day="${i}"/>`;
    if (d.eaten == null) return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(top + plotH - 2).toFixed(1)}" width="${bw.toFixed(1)}" height="2" rx="1" fill="var(--fill-2)"/>${hit}`;
    const h = Math.max(2, (d.eaten / max) * plotH);
    const color = d.status ? BALANCE[d.status].color : 'var(--text-3)';
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2).toFixed(1)}" fill="${color}" opacity="${i === sel ? 1 : 0.85}"/>${hit}`;
  }).join('');
  // What you burned each day, as a line the bars rise above (surplus) or stay under (deficit).
  const pts = days.map((d, i) => (d.ref ? `${(left + slot * i + slot / 2).toFixed(1)},${y(d.ref).toFixed(1)}` : null));
  const segs = [];
  let cur = [];
  pts.forEach((p) => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
  if (cur.length) segs.push(cur);
  const refLine = segs.map((sg) => sg.length > 1
    ? `<polyline points="${sg.join(' ')}" fill="none" stroke="var(--text)" stroke-width="1.6" stroke-dasharray="4 3" stroke-linejoin="round" opacity=".75"/>`
    : `<line x1="${(+sg[0].split(',')[0] - bw / 2 - 2).toFixed(1)}" x2="${(+sg[0].split(',')[0] + bw / 2 + 2).toFixed(1)}" y1="${sg[0].split(',')[1]}" y2="${sg[0].split(',')[1]}" stroke="var(--text)" stroke-width="1.6" opacity=".75"/>`).join('');
  const xl = days.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    const show = range === 'week' || i === days.length - 1 || (days.length - 1 - i) % 7 === 0;
    if (!show) return '';
    const txt = range === 'week' ? 'SMTWTFS'[dt.getDay()] : `${dt.getMonth() + 1}/${dt.getDate()}`;
    return `<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="${i === sel ? 'var(--text)' : 'var(--text-3)'}" font-weight="${i === sel ? 600 : 400}">${txt}</text>`;
  }).join('');
  const counts = { surplus: 0, maintain: 0, deficit: 0 };
  logged.forEach((d) => { if (d.status) counts[d.status]++; });
  const avg = logged.length ? logged.reduce((a, d) => a + d.eaten, 0) / logged.length : 0;
  const withBal = logged.filter((d) => d.balance != null);
  const net = withBal.reduce((a, d) => a + d.balance, 0);
  return `
    <div class="spread" style="align-items:flex-start">
      <div class="col" style="gap:2px">
        <span class="row" style="gap:6px;align-items:baseline;white-space:nowrap"><span style="font-size:36px;font-weight:300;letter-spacing:-.03em;line-height:1">${logged.length ? fmt(Math.round(avg)) : '—'}</span><span class="s13 muted">kcal/day</span></span>
        <span class="s13 muted">${logged.length ? `average of ${logged.length} logged day${logged.length === 1 ? '' : 's'}` : 'No days logged yet'}</span>
      </div>
      <div class="seg seg-sm" role="group" aria-label="Trend range">${[['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button class="chip" data-act="trend-range" data-v="${v}" aria-pressed="${range === v}">${l}</button>`).join('')}</div>
    </div>
    <svg class="mt16 trend-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Calories eaten each day for the last ${days.length} days, against calories ${anyBurned ? 'burned' : 'target'}">
      ${grid.map((v) => `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="var(--text-3)">${v >= 1000 ? (v / 1000) + 'k' : v}</text>`).join('')}
      <line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" stroke="var(--text-4)" stroke-width="1"/>
      ${bars}${refLine}${xl}
    </svg>
    <div class="mt8" id="trend-detail" style="min-height:20px">${trendDetail(days[sel >= 0 ? sel : days.length - 1])}</div>
    <div class="row mt12 s13" style="gap:6px 12px;flex-wrap:wrap">
      ${Object.entries(BALANCE).map(([k, b]) => `<span class="row" style="gap:5px"><span class="dot" style="background:${b.color}"></span>${b.label} <span class="b6">${counts[k]}</span></span>`).join('')}
      <span class="row muted" style="gap:5px"><svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="currentColor" stroke-width="1.6" stroke-dasharray="4 3"/></svg>${anyBurned ? 'Burned' : 'Target'}</span>
    </div>
    ${withBal.length ? `<p class="s13 muted" style="margin:10px 0 0">Net ${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt(Math.abs(Math.round(net)))} kcal ${range === 'month' ? 'over 30 days' : 'this week'}.${anyBurned ? '' : ' <a href="#/settings" style="color:var(--lilac)">Set up BMR</a> to compare with what you burn.'}</p>` : ''}
    <p class="small faint" style="margin:6px 0 0;line-height:1.45">Surplus is more than 50 kcal over what you burned, maintaining is 0–50 over, deficit is under.</p>`;
}

// One plain sentence tying burned, balance and target together, against the deficit or surplus you planned
// (your target minus what you burn). E.g. "117 kcal deficit so far — 383 short of your 500 kcal plan."
function planLine(en, et) {
  if (!en.ready || !et.total) return '';
  const planned = Math.round(et.total - en.burned);
  const bal = Math.round(en.balance);
  const n = (v) => fmt(Math.abs(v));
  let text, color = 'var(--text-2)';
  if (Math.abs(planned) < 50) {
    text = bal > 50 ? `You’ve eaten ${n(bal)} kcal more than you burned today. Your target keeps you at maintenance.`
      : bal < 0 ? `You’re ${n(bal)} kcal under what you burned today. Your target keeps you at maintenance.`
      : 'You’re right at maintenance today.';
  } else if (planned < 0) {
    const need = -planned, have = -bal;
    if (bal >= 0) { text = `No deficit yet: you’ve eaten ${n(bal)} kcal more than you burned. Your plan is a ${n(need)} kcal deficit.`; color = 'var(--rose)'; }
    else if (have >= need) { text = `${n(have)} kcal deficit today — your ${n(need)} kcal plan is met${have - need >= 10 ? `, with ${n(have - need)} to spare` : ''}.`; color = 'var(--lilac)'; }
    else { text = `${n(have)} kcal deficit today — ${n(need - have)} short of your ${n(need)} kcal deficit plan.`; color = 'var(--wheat)'; }
  } else {
    const need = planned;
    if (bal >= need) { text = `${n(bal)} kcal surplus today — your ${n(need)} kcal plan is met.`; color = 'var(--lilac)'; }
    else { text = `${bal > 0 ? `${n(bal)} kcal surplus` : 'No surplus'} today — ${n(need - Math.max(0, bal))} short of your ${n(need)} kcal surplus plan.`; color = 'var(--wheat)'; }
  }
  return `<p class="s13 mt12" style="margin-bottom:0;line-height:1.45;color:${color}">${text}</p>`;
}

function summaryPages(tot, entries, date) {
  const et = energyTargetFor(date);
  const eTarget = et.total;
  const eaten = tot.energy?.v || 0;
  const kcal = MACROS.map((m) => (tot[m.key]?.v || 0) * m.kcal);
  const ksum = kcal.reduce((a, b) => a + b, 0) || 1;
  const scaleMax = Math.max(eaten, eTarget, 1);
  const filled = (eaten / scaleMax) * 100;
  const markAt = (eTarget / scaleMax) * 100;
  const diff = Math.round(eaten) - Math.round(eTarget);
  const en = dayEnergy(date, eaten);
  const goal = store.profile().goal;
  const balColor = !en.ready ? 'var(--text-3)'
    : goal === 'lose' ? (en.balance > 0 ? 'var(--rose)' : 'var(--lilac)')
    : goal === 'gain' ? (en.balance < 0 ? 'var(--wheat)' : 'var(--lilac)')
    : Math.abs(en.balance) <= 150 ? 'var(--lilac)' : 'var(--wheat)';

  const energy = `
    <div class="col" style="gap:2px">
      <span class="row" style="gap:8px;align-items:baseline"><span style="font-size:52px;font-weight:300;letter-spacing:-.03em;line-height:1">${fmt(eaten)}</span><span class="s15 muted">kcal</span></span>
      <span class="s14 muted">eaten of today’s ${fmt(Math.round(eTarget))} kcal target</span>
      ${et.activities > 0 ? `<span class="small faint">${fmt(Math.round(et.base))} target + ${fmt(Math.round(et.activities))} from workouts</span>` : ''}
    </div>
    <div style="position:relative;padding-top:18px" class="mt16">
      ${eTarget ? `<span style="position:absolute;top:0;left:${markAt}%;transform:translateX(-50%);font-size:11px" class="muted">target</span>
      <span style="position:absolute;top:14px;bottom:-4px;left:${markAt}%;width:2px;background:var(--text);border-radius:1px" aria-hidden="true"></span>` : ''}
      <div style="height:10px;border-radius:5px;background:var(--fill-2);overflow:hidden" aria-hidden="true">
        <div class="stack" style="height:100%;width:${filled}%;gap:3px">${MACROS.map((m, i) => `<span style="flex:${kcal[i] / ksum || 0.0001};background:${m.color}"></span>`).join('')}</div>
      </div>
    </div>
    ${eaten > 0 ? `<div class="mt12" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" aria-label="Share of calories from each macro">
      ${MACROS.map((m, i) => `<div class="col" style="gap:1px"><span class="row small muted" style="gap:5px"><span class="dot" style="background:${m.color}"></span>${m.name}</span><span class="s13"><b class="b6">${Math.round((kcal[i] / ksum) * 100)}%</b> <span class="muted">of kcal</span></span></div>`).join('')}
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px" class="mt16">
      ${en.ready
        ? `<button class="col" data-act="burned" data-date="${date}" aria-label="Calories burned: ${fmt(Math.round(en.burned))}. Show breakdown" style="gap:2px;align-items:flex-start;border:none;background:none;padding:0;text-align:left;cursor:pointer"><span class="small muted row" style="gap:3px">Burned <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></span><span class="b6" style="font-size:17px">${fmt(Math.round(en.burned))}</span></button>`
        : `<a class="col" href="#/settings" style="gap:2px"><span class="small muted">Burned</span><span class="b6" style="font-size:15px;color:var(--lilac);line-height:1.55">Set up</span></a>`}
      <div class="col" style="gap:2px"><span class="small muted">${en.ready ? BALANCE[balanceStatus(en.balance)].label : 'Balance'}</span><span class="b6" style="font-size:17px;color:${en.ready ? BALANCE[balanceStatus(en.balance)].color : balColor}">${en.ready ? (en.balance > 0 ? '+' : '−') + fmt(Math.abs(Math.round(en.balance))) : '—'}</span></div>
      <div class="col" style="gap:2px"><span class="small muted">${diff > 0 ? 'Over target' : 'Left to eat'}</span><span class="b6" style="font-size:17px;color:${diff > 0 ? 'var(--rose)' : 'var(--text)'}">${fmt(Math.abs(Math.round(diff)))}</span></div>
    </div>
    ${planLine(en, et)}
    `;

  const macros = MACROS.map((m) => {
    const v = tot[m.key]?.v || 0;
    const t = store.target(m.key) || 0;
    const pct = t ? Math.round((v / t) * 100) : 0;
    const note = !t ? '' : v > t ? `${fmt(v - t)} g over · ${pct}%` : `${fmt(t - v)} g to go`;
    return `<div class="col" style="gap:8px">
      <div class="row" style="gap:8px;align-items:baseline"><span class="dot" style="background:${m.color};width:8px;height:8px;align-self:center"></span><span class="s15 b6" style="flex:1">${m.name}</span><span class="s14 muted">${fmt(v)} / ${fmt(t)} g</span></div>
      <div class="bar" style="height:6px" aria-hidden="true"><span style="width:${Math.min(100, pct)}%;background:${m.color}"></span></div>
      <span class="small" style="color:${pct > 115 ? 'var(--rose)' : 'var(--text-2)'}">${note}</span>
    </div>`;
  }).join('');

  const cov = coverage(tot);
  const withData = Object.values(tot).filter((t) => t.v > 0);
  const estShare = withData.length ? withData.reduce((a, t) => a + t.estShare, 0) / withData.length : 0;
  const lows = NUTRIENTS.filter((n) => !n.limit && store.target(n.key) && n.group !== 'General')
    .map((n) => ({ n, p: (tot[n.key]?.v || 0) / store.target(n.key) })).filter((x) => x.p < 1)
    .sort((a, b) => a.p - b.p).slice(0, 3);
  const nutrients = `
    <div class="col" style="gap:2px">
      <span class="row" style="gap:8px;align-items:baseline"><span style="font-size:52px;font-weight:300;letter-spacing:-.03em;line-height:1">${Math.round(cov * 100)}%</span><span class="s15 muted">of targets</span></span>
      <span class="s14 muted">${withData.length} nutrients tracked · ${Math.round(estShare * 100)}% estimated</span>
    </div>
    <div class="col mt16" style="gap:10px">
      <span class="small muted">${lows.length ? 'Still low today' : 'Every target met'}</span>
      ${lows.map((l) => `<a href="#/report/${entries[0]?._date || todayISO()}" class="row" style="gap:10px">
        <span class="s14 ellipsis" style="width:100px">${esc(l.n.name)}</span>
        <span class="bar" style="flex:1;height:6px" aria-hidden="true"><span style="width:${Math.round(l.p * 100)}%;background:var(--lilac)"></span></span>
        <span class="s13 muted" style="width:38px;text-align:right">${Math.round(l.p * 100)}%</span></a>`).join('')}
    </div>`;
  return [energy, `<div class="col" style="gap:16px">${macros}</div>`, nutrients, trendPage(date)];
}

function mealCard(date, key, items, idx = 0, count = 1) {
  const name = esc(mealName(key));
  const mt = totals(items);
  const pk = (mt.protein?.v || 0) * 4, ck = (mt.carbs?.v || 0) * 4, fk = (mt.fat?.v || 0) * 9;
  const open = ui.open[date + key] !== undefined ? ui.open[date + key] : items.length > 0;
  const swiped = ui.swiped === key;
  const menu = ui.menu === key;
  return `<div class="card meal">
    <div class="meal-head ${swiped ? 'open' : ''}" data-head="${key}">
      <div class="meal-reveal"><button class="icon-btn" style="background:var(--lilac);color:var(--on-accent)" data-act="meal-menu" data-meal="${key}" aria-label="${name} options" aria-expanded="${menu}">${I.dots}</button></div>
      <div class="meal-front" data-swipe="${key}">
        <div class="col" style="flex:1;min-width:0;gap:8px">
          <span class="row" style="gap:8px;align-items:baseline"><span class="b6" style="font-size:17px">${name}</span><span class="s13 muted">${fmt(mt.energy?.v || 0)} kcal</span></span>
          <span class="stack" style="height:4px;width:140px;background:var(--fill-2);border-radius:2px" aria-hidden="true">
            ${items.length ? `<span style="flex:${pk || 0.001};background:var(--lilac)"></span><span style="flex:${ck || 0.001};background:var(--sky)"></span><span style="flex:${fk || 0.001};background:var(--wheat)"></span>` : ''}
          </span>
        </div>
        <a class="icon-btn add-btn" href="#/scan?date=${date}&meal=${key}" aria-label="Add food to ${name}" ${swiped ? 'tabindex="-1" aria-hidden="true"' : ''}>${I.plus}</a>
        <button class="icon-btn ghost" data-act="toggle" data-meal="${date + key}" data-open="${open}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${name}"><span style="display:flex;transform:rotate(${open ? 180 : 0}deg);transition:transform .2s">${I.down}</span></button>
      </div>
    </div>
    ${menu ? `<div class="menu" role="menu">
      <a role="menuitem" href="#/meal/${date}/${key}" class="b6">${I.summary.replace('currentColor', 'var(--lilac)')} Show nutrition summary</a>
      <button role="menuitem" data-act="copy-meal" data-meal="${key}" data-date="${date}" ${items.length ? '' : 'disabled'}>${I.copy} Copy to ${date === todayISO() ? 'tomorrow' : 'today'}</button>
      <a role="menuitem" href="#/scan?date=${date}&meal=${key}">${I.plus} Add food</a>
      <div class="menu-sep" role="separator"></div>
      <button role="menuitem" data-act="meal-move" data-meal="${key}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>${I.up} Move up</button>
      <button role="menuitem" data-act="meal-move" data-meal="${key}" data-dir="1" ${idx === count - 1 ? 'disabled' : ''}>${I.down} Move down</button>
      <button role="menuitem" data-act="meal-rename" data-meal="${key}">${I.edit} Rename meal</button>
      <button role="menuitem" data-act="meal-add" data-after="${key}">${I.plus} Add a meal below</button>
      <div class="menu-sep" role="separator"></div>
      <button role="menuitem" class="danger" data-act="clear-meal" data-meal="${key}" data-date="${date}" ${items.length ? '' : 'disabled'}>${I.trash} Clear meal</button>
      <button role="menuitem" class="danger" data-act="meal-delete" data-meal="${key}" ${count > 1 ? '' : 'disabled'}>${I.trash} Delete meal</button>
    </div>` : ''}
    ${open ? `<div style="padding:0 18px 6px">
      ${items.length ? `<div class="list entry-list" data-date="${date}" data-meal="${key}" style="border-top:1px solid var(--line)">${items.map(entryLine).join('')}</div>`
        : `<a href="#/scan?date=${date}&meal=${key}" class="row s14 muted" style="justify-content:center;gap:8px;height:48px;margin:2px 0 12px;border-radius:16px;border:1px dashed var(--text-4)">Scan or search to log ${name.toLowerCase()}</a>`}
    </div>` : ''}
  </div>`;
}

function renderDay(date) {
  const entries = store.day(date).map((e) => ({ ...e, _date: date }));
  const tot = totals(entries);
  const pages = summaryPages(tot, entries, date);
  const page = ui.page || 0;
  const tabs = ['Energy', 'Macros', 'Nutrients', 'Trend'];
  const N = tabs.length;
  view().innerHTML = `
  <header class="spread" style="padding:18px 20px 0">
    <div class="col" style="gap:2px"><span class="s14 muted">${greeting()}</span><h1 class="h1">${dayTitle(date)}</h1></div>
    <div class="row" style="gap:8px">
      <button class="icon-btn" data-act="cal-open" data-date="${date}" aria-label="Pick a date">${I.cal}</button>
    </div>
  </header>

  <section class="screen mt16">${weekStrip(date)}</section>

  <section class="screen mt16" aria-label="Daily summary">
    <div class="card" style="overflow:hidden">
      <div role="tablist" aria-label="Summary view" class="sum-tabs">
        <span class="sum-pill" aria-hidden="true"></span>
        ${tabs.map((t, i) => `<button role="tab" class="sum-tab" data-act="sum-tab" data-i="${i}" aria-selected="${i === page}">${t}</button>`).join('')}
      </div>
      <div data-summary style="overflow:hidden;touch-action:pan-y;transition:height .32s cubic-bezier(.22,1,.36,1)">
        <div class="sum-track" style="display:flex;align-items:flex-start;width:${N * 100}%;transform:translateX(-${page * (100 / N)}%)">
          ${pages.map((p, i) => `<div role="tabpanel" aria-hidden="${i !== page}" style="width:${100 / N}%;box-sizing:border-box;padding:20px 22px 24px">${p}</div>`).join('')}
        </div>
      </div>
    </div>
  </section>

  ${activitiesCard(date)}
  <div class="spread" style="padding:26px 20px 12px;align-items:baseline">
    <h2 class="h2" style="font-size:20px">Meals</h2>
    <button class="link-btn s14 b6" data-act="meal-add" style="color:var(--lilac)">+ Add meal</button>
  </div>
  <section class="screen col" style="gap:10px">
    ${store.meals().map(({ key: k }, i, all) => mealCard(date, k, sortMeal(entries.filter((e) => e.meal === k)), i, all.length)).join('')}
  </section>
  ${!entries.length ? `<div class="screen mt16"><div class="note">${date === todayISO() ? 'Nothing logged yet today.' : 'Nothing logged this day.'} Tap + on a meal to search, scan or create a food.</div></div>` : ''}`;
}

/* ---------------- Scan ---------------- */

const STEP_INFO = [
  { id: 'info', title: 'Product info', idle: 'Name and serving size from the barcode' },
  { id: 'nutrients', title: 'Nutrients', idle: 'Label values from the barcode databases' }
];
// Foods picked from USDA search still show where their lab data came from.
const SEARCH_STEPS = [
  { id: 'label', title: 'Nutrition label', idle: 'USDA' },
  { id: 'lab', title: 'Lab databases', idle: 'USDA reference data' }
];

function stepsHTML(steps) {
  const list = Object.keys(steps).some((k) => k === 'label' || k === 'lab') ? SEARCH_STEPS : STEP_INFO;
  return `<ol class="steps">${list.map((s, i) => {
    const st = steps[s.id] || { status: 'idle', detail: typeof s.idle === 'function' ? s.idle() : s.idle };
    const word = { running: 'Checking', found: 'Found', cached: 'Saved', none: 'None', skipped: 'Off', error: 'Error', idle: '' }[st.status];
    return `<li class="step ${st.status}">
      <div class="mark"><span class="o">${['found', 'cached'].includes(st.status) ? I.check : ''}</span>${i < list.length - 1 ? '<span class="ln"></span>' : ''}</div>
      <div class="spread" style="flex:1;align-items:flex-start;padding-bottom:14px">
        <div class="col" style="gap:2px"><span class="s15 b6" style="color:${st.status === 'idle' ? 'var(--text-2)' : 'var(--text)'}">${s.title}</span><span class="small muted">${esc(st.detail)}</span></div>
        <span class="small b6" style="color:${st.status === 'error' ? 'var(--rose)' : st.status === 'found' || st.status === 'cached' ? 'var(--lilac)' : 'var(--text-3)'}">${word}</span>
      </div></li>`;
  }).join('')}</ol>`;
}

// Add food: one place to find anything, modelled on the big trackers (MyFitnessPal, Cronometer, Lose It!):
// a search box at the top that also takes barcode numbers, the scanner one tap away, then your own foods —
// recent ones first and the rest grouped by type, so you can find something even when you forget its name.
function renderScan(r, changed) {
  const date = r.q.date || todayISO();
  const meal = r.q.meal || mealForNow();
  if (changed || !ui.scan) ui.scan = { status: 'camera', code: '', steps: {}, error: '', date, meal, q: '', db: null, webCam: false };
  const s = ui.scan;
  const busy = s.status !== 'camera';
  view().innerHTML = `
  <header class="top">
    <a class="icon-btn" href="#/day/${date}" aria-label="Close">${I.close}</a>
    <span class="s15 b6">Add to ${esc(mealName(meal))}</span>
    <span style="width:44px" aria-hidden="true"></span>
  </header>
  <section class="screen mt12">
    <div class="row" style="gap:10px">
      <form class="add-search" data-form="add-search" role="search" style="flex:1;min-width:0">
        <span class="add-search-icon" aria-hidden="true">${I.search.replace(/22/g, '18')}</span>
        <input id="add-q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search foods or brands" value="${esc(s.q)}" aria-label="Search foods, brands or a barcode number">
      </form>
      <button class="add-scan-btn" data-act="native-scan" aria-label="Scan a barcode">${I.scan}</button>
    </div>
  </section>
  <div class="viewfinder mt12" id="vf" ${!NATIVE && s.webCam && !busy ? '' : 'hidden'}>
    <video id="video" playsinline muted aria-label="Camera view"></video>
    <div class="frame" aria-hidden="true"><span class="c tl"></span><span class="c tr"></span><span class="c bl"></span><span class="c br"></span><span class="line"></span></div>
  </div>
  <p class="s14 muted" id="scan-msg" style="text-align:center;margin:12px 16px 0" aria-live="polite" ${busy ? '' : 'hidden'}>${s.code ? `Barcode ${esc(s.code)}` : ''}</p>
  <section class="screen">
    <div id="scan-steps" class="card pad mt12" ${busy ? '' : 'hidden'}>${stepsHTML(s.steps)}</div>
    <div id="scan-err"></div>
  </section>
  <div id="add-results" style="padding-bottom:120px" ${busy ? "hidden" : ""}>${addResultsHTML()}</div>`;
  if (!NATIVE && s.webCam && !busy) {
    startScanner($('#video'), (code) => runLookup(code), (err) => { const m = $('#scan-msg'); m.hidden = false; m.textContent = err.message; });
  }
}

// Saved foods grouped by kind of food.
// Broad groups for the filter chips, so there are a handful of chips rather than one per icon.
const FOOD_GROUPS = [
  ['protein', 'Protein', ['beef', 'pork', 'poultry', 'fish', 'shellfish', 'egg', 'powder', 'bar']],
  ['produce', 'Produce', ['veg', 'fruit', 'legume']],
  ['dairy', 'Dairy', ['dairy', 'cheese']],
  ['grains', 'Grains', ['grain', 'bread']],
  ['nuts', 'Nuts & seeds', ['nuts']],
  ['snacks', 'Snacks', ['snack', 'sweets']],
  ['pantry', 'Pantry', ['oil', 'sauce', 'herbs', 'soup', 'meal']],
  ['drinks', 'Drinks', ['coffee', 'drink']],
  ['supps', 'Supplements', ['supplement']]
];
function groupOf(food) { const k = foodKind(food); return FOOD_GROUPS.find((g) => g[2].includes(k))?.[0] || 'pantry'; }
function savedFoods() {
  return Object.values(store.foods()).filter((f) => !(f.unidentified && !Object.keys(f.per100 || {}).length))
    .sort((a, b) => (b.usedAt || b.savedAt || 0) - (a.usedAt || a.savedAt || 0));
}

// One food row: tap to open, + to log it again at the usual amount.
function foodRowHTML(food, last, date, meal) {
  const sv = food.servings?.find((x) => x.grams > 0 && !isPlaceholderServing(x));
  const amt = last ? amountText(last) : sv?.label || '100 g';
  const grams = last ? last.grams : sv?.grams || 100;
  const kcal = food.per100?.energy ? Math.round((food.per100.energy.v * grams) / 100) : null;
  return `<div class="row yf-row" style="gap:12px;padding:8px 0">
    ${foodTile(food, 36)}
    <a class="col" href="#/food/${encodeURIComponent(food.id)}?date=${date}&meal=${meal}" style="flex:1;min-width:0;gap:2px;padding:4px 0">
      <span class="s14 ellipsis" style="font-weight:500">${esc(food.name)}</span>
      <span class="small muted ellipsis">${food.brand ? esc(food.brand) + ' · ' : ''}${esc(amt)}${kcal != null ? ' · ' + kcal + ' kcal' : ''}</span>
    </a>
    <button class="icon-btn" data-act="qa" data-id="${esc(food.id)}" data-date="${date}" data-meal="${meal}" aria-label="Add ${esc(food.name)}, ${esc(amt)}, to ${esc(mealName(meal))}">${I.plus}</button>
  </div>`;
}

function addResultsHTML() {
  const s = ui.scan;
  const { date, meal } = s;
  const q = (s.q || '').trim();
  const lastBy = new Map(loggedFoods().map(({ food, last }) => [food.id, last]));
  const all = savedFoods();
  const list = (foods) => `<div class="card list mt12" style="padding:0 6px 0 14px">${foods.map((f) => foodRowHTML(f, lastBy.get(f.id), date, meal)).join('')}</div>`;
  const textLink = (act, label, extra = '') => `<button class="add-link" data-act="${act}" ${extra}>${label}</button>`;
  if (!q) {
    if (!all.length) return `<section class="screen mt24"><div class="empty">Scan a barcode or search to add your first food.</div></section>`;
    const counts = new Map();
    all.forEach((f) => { const g = groupOf(f); counts.set(g, (counts.get(g) || 0) + 1); });
    const groups = FOOD_GROUPS.filter((g) => counts.has(g[0]));
    const sel = s.group && counts.has(s.group) ? s.group : 'recent';
    const shown = sel === 'recent' ? all.slice(0, 12) : all.filter((f) => groupOf(f) === sel);
    return `<section class="screen mt16">
      <div class="chips scroll" id="add-groups" role="group" aria-label="Show">
        <button class="chip" data-act="add-group" data-g="recent" aria-pressed="${sel === 'recent'}">Recent</button>
        ${groups.map((g) => `<button class="chip" data-act="add-group" data-g="${g[0]}" aria-pressed="${sel === g[0]}">${g[1]}</button>`).join('')}
      </div>
      ${list(shown)}
      <div class="row mt12" style="justify-content:center">${textLink('add-custom', `${I.plus.replace(/width="\d+"/, 'width="16"').replace(/height="\d+"/, 'height="16"')} Create a food`)}</div>
    </section>`;
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const mine = all.filter((f) => { const t = `${f.name} ${f.brand || ''}`.toLowerCase(); return words.every((w) => t.includes(w)); }).slice(0, 30);
  const digits = q.replace(/\s/g, '');
  const isCode = /^\d{6,14}$/.test(digits);
  const db = s.db && s.db.q === q ? s.db : null;
  return `<section class="screen mt16">
    ${isCode ? `<button class="btn primary block" data-act="add-code" data-code="${esc(digits)}">Look up barcode ${esc(digits)}</button>` : ''}
    ${mine.length ? `<span class="small muted">Your foods</span>${list(mine)}` : ''}
    ${!isCode ? `<div class="${mine.length ? 'mt24' : ''}"><span class="small muted">All foods</span>
      ${db?.loading ? '<div class="empty">Searching…</div>'
        : db?.error ? `<div class="err mt8">${esc(db.error)}</div>`
        : db?.results ? (db.results.length ? `<div class="card list mt12" style="padding:0 18px">${db.results.map((f, i) => `
          <button class="item" data-act="pick-hit" data-i="${i}" data-date="${date}" data-meal="${meal}">
            <span class="col" style="flex:1;min-width:0;gap:3px"><span class="s14 ellipsis" style="font-weight:500">${esc(titleCaseName(f.description))}</span>
            <span class="small muted ellipsis">${esc(f.brandName || f.brandOwner || '')}${f.brandName || f.brandOwner ? ' · ' : ''}${f.dataType === 'Branded' ? 'Packaged' : 'Lab-analyzed'}</span></span>
            ${I.next}
          </button>`).join('')}</div>` : '<div class="empty">No matches in the food database.</div>')
        : `<button class="btn quiet block mt12" data-act="add-db">Search all foods for “${esc(q)}”</button>`}</div>` : ''}
    <div class="col mt24" style="gap:2px;align-items:center">
      <span class="small faint">Can’t find it?</span>
      <div class="row" style="gap:4px;flex-wrap:wrap;justify-content:center">
        ${NATIVE ? textLink('add-ask', '✦ Ask Gemini', `data-name="${esc(q)}"`) + '<span class="faint">·</span>' : ''}
        ${textLink('add-custom', 'Create it yourself', `data-name="${esc(q)}"`)}
      </div>
    </div>
  </section>`;
}
const titleCaseName = (t) => String(t || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

function refreshAddResults() {
  const box = document.getElementById('add-results');
  if (!box || !ui.scan) return;
  const x = document.getElementById('add-groups')?.scrollLeft || 0;
  box.innerHTML = addResultsHTML();
  const row = document.getElementById('add-groups'); if (row) row.scrollLeft = x;
}

async function searchDatabase(q) {
  const s = ui.scan;
  s.db = { q, loading: true };
  refreshAddResults();
  try { s.db = { q, results: await fdcSearch(q) }; }
  catch (e) { s.db = { q, error: e.status === 429 ? 'The shared USDA key is busy. Add your own free key under Targets → Data sources.' : 'Search failed. Check your connection and try again.' }; }
  ui.search = { q, results: s.db.results || null };
  if (ui.scan === s && s.q.trim() === q) refreshAddResults();
}

// Log a food again: the amount you had last time, else one serving, else 100 g.
function quickAdd(food, date, meal) {
  const last = loggedFoods().find((x) => x.food.id === food.id)?.last;
  const sv = food.servings?.find((x) => x.grams > 0 && !isPlaceholderServing(x));
  const entry = last ? { grams: last.grams, unit: last.unit, qty: last.qty } : sv ? { grams: sv.grams, unit: sv.label, qty: 1 } : { grams: 100, unit: 'g', qty: 100 };
  store.addEntry(date, { foodId: food.id, ...entry, meal, ts: tsFor(date, hhmm(Date.now())) });
}

// Foods you've logged before, most recently used first, with the last amount you had.
function loggedFoods() {
  const seen = new Map();
  for (const [date, entries] of Object.entries(store.log())) {
    for (const e of entries) {
      const prev = seen.get(e.foodId);
      if (!prev || e.ts > prev.ts) seen.set(e.foodId, { ...e, date });
    }
  }
  return [...seen.values()].sort((a, b) => b.ts - a.ts).map((e) => ({ food: store.food(e.foodId), last: e })).filter((x) => x.food);
}


async function runLookup(code) {
  const s = ui.scan;
  if (!s) return;
  stopScanner();
  s.status = 'looking'; s.code = code; s.steps = {};
  const vf = $('#vf'); if (vf) vf.style.display = 'none';
  const ns = $('#native-scan'); if (ns) ns.style.display = 'none';
  const ar = $('#add-results'); if (ar) ar.hidden = true;
  const msg = $('#scan-msg'); if (msg) { msg.hidden = false; msg.textContent = `Barcode ${code}`; }
  const box = $('#scan-steps'); if (box) { box.hidden = false; box.innerHTML = stepsHTML(s.steps); }
  $('#scan-err').innerHTML = '';
  try {
    const food = await lookupBarcode(code, (id, status, detail) => {
      s.steps[id] = { status, detail };
      const b = $('#scan-steps'); if (b && ui.scan === s) b.innerHTML = stepsHTML(s.steps);
    });
    if (ui.scan !== s) return;
    s.status = 'done';
    go(`#/food/${encodeURIComponent(food.id)}?date=${s.date}&meal=${s.meal}`);
  } catch (e) {
    if (ui.scan !== s) return;
    s.status = 'error';
    $('#scan-err').innerHTML = `<div class="err mt12">${e.code === 'not_found'
      ? `We couldn’t find barcode ${esc(code)}. You can ask the Gemini app about it, search by name or add it as a custom food.`
      : esc(e.message)}</div>
      ${e.code === 'not_found' ? `${NATIVE ? `<button class="btn primary block mt12" data-act="ask-gemini-barcode" data-code="${esc(code)}">✦ Ask the Gemini app about this barcode</button>` : ''}
      <div class="row mt8" style="gap:8px"><button class="btn tint" style="flex:1" data-act="barcode-paste" data-code="${esc(code)}">Paste answer</button><button class="btn quiet" style="flex:1" data-act="barcode-custom" data-code="${esc(code)}">Enter it yourself</button></div>
      <p class="small faint" style="margin:8px 2px 0;line-height:1.45">After Gemini answers: copy its answer and tap <b>Paste answer</b>, or tap <b>Share</b> under the answer and pick <b>Spectra</b>.</p>` : ''}
      <div class="row mt12"><a class="btn quiet" style="flex:1" href="#/foods?date=${s.date}&meal=${s.meal}">Search by name</a><button class="btn tint" style="flex:1" data-act="rescan">Scan again</button></div>`;
  }
}

/* ---------------- Food detail / add ---------------- */

// Kitchen volumes in millilitres.
const VOLUME_ML = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, 'fl oz': 29.5735, ml: 1 };
const VOLUME_RE = /(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)?\s*(teaspoons?|tsps?|tablespoons?|tbsps?|tbs|cups?|fl\.?\s*oz|fluid ounces?|ml|milliliters?|millilitres?)\b/i;
function parseAmount(t) {
  if (!t) return 1;
  const m = t.trim().match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return +m[1] + m[2] / m[3];
  const f = t.match(/^(\d+)\/(\d+)$/); if (f) return f[1] / f[2];
  return Number(t) || 1;
}
function volumeKey(word) {
  const w = word.toLowerCase().replace(/\s+/g, ' ');
  if (/^t(ea)?sp|^teaspoon/.test(w)) return 'tsp';
  if (/^tb|^tablespoon/.test(w)) return 'tbsp';
  if (/^cup/.test(w)) return 'cup';
  if (/fl|fluid/.test(w)) return 'fl oz';
  return 'ml';
}
// Grams per millilitre: from a serving that names a volume ("2 tbsp (32 g)"), else a typical value for the kind of food.
const KIND_DENSITY = { oil: 0.92, dairy: 1.03, drink: 1.0, coffee: 1.0, soup: 1.0, sauce: 1.1, sweets: 0.85, grain: 0.45, powder: 0.45, supplement: 0.6, nuts: 0.6, legume: 0.75, fruit: 0.65, veg: 0.5, cheese: 0.45, bread: 0.3, snack: 0.15 };
function densityFor(food) {
  for (const sv of food.servings || []) {
    const m = sv.label?.match(VOLUME_RE);
    if (m && sv.grams > 0) {
      const ml = parseAmount(m[1]) * VOLUME_ML[volumeKey(m[2])];
      if (ml > 0) return { gPerMl: sv.grams / ml, exact: true };
    }
  }
  return { gPerMl: KIND_DENSITY[foodKind(food)] ?? 1, exact: false };
}

function unitsFor(food) {
  const servings = (food.servings || []).filter((s) => s.grams > 0 && !isPlaceholderServing(s));
  const d = densityFor(food);
  const vol = Object.entries(VOLUME_ML).map(([label, ml]) => ({ label, grams: ml * d.gPerMl, volume: true, approx: !d.exact }));
  return [...servings, { label: 'g', grams: 1, plain: true }, { label: 'oz', grams: 28.3495, plain: true }, { label: 'lb', grams: 453.592, plain: true }, ...vol];
}
function unitStep(u) { return u.label === 'g' || u.label === 'ml' ? 10 : u.label === 'cup' ? 0.25 : u.label === 'lb' ? 0.25 : 0.5; }
// "2 tbsp", "1.5 oz", "1 slice (34 g)", "2 × 1 slice"
function amountText(e) {
  if (!e.unit || e.unit === 'g') return `${fmt(e.grams)} g`;
  if (/^(oz|lb|tsp|tbsp|cup|fl oz|ml)$/.test(e.unit)) return `${fmt(e.qty)} ${e.unit === 'cup' && Number(e.qty) !== 1 ? 'cups' : e.unit}`;
  return Number(e.qty) === 1 ? e.unit : `${fmt(e.qty)} × ${e.unit}`;
}

// Quick picks for the serving's household measure. Count units (tablet, softgel…) don't need a weight:
// supplements are tracked per piece, so a nominal 1 g each is used when the label gives none.
// Serving editor: an amount plus a unit you tap, instead of typing "1 oz" and grams by hand.
const SV_WEIGHT = { g: 1, oz: 28.3495 };
const SV_COUNT = ['tablet', 'capsule', 'softgel', 'gummy', 'scoop', 'packet', 'piece', 'slice', 'bar', 'bottle', 'can'];
const plural = (u, n) => (n <= 1 || u === 'g' || u === 'oz' || u === 'ml' || u === 'tsp' || u === 'tbsp' || u === 'fl oz' ? u : u === 'gummy' ? 'gummies' : u + 's');

// Read "2 tbsp (32 g)", "1 oz (28.35 g)", "1 softgel" back into amount / unit / weight.
function parseServingLabel(sv) {
  if (!sv) return { amount: 1, unit: 'g', weight: '' };
  const m = sv.label.match(/^\s*(\d+(?:\.\d+)?|\d+\/\d+)?\s*([a-z ]+?)s?\s*(?:\(|$)/i);
  const amount = m?.[1] ? parseAmount(m[1]) : 1;
  const word = (m?.[2] || '').trim().toLowerCase();
  const unit = word === 'g' || word === 'gram' ? 'g' : word === 'oz' ? 'oz' : VOLUME_ML[volumeKey(word)] && VOLUME_RE.test(word) ? volumeKey(word) : SV_COUNT.find((u) => word.startsWith(u.slice(0, 4))) || 'g';
  if (unit === 'g') return { amount: +sv.grams.toFixed(2), unit: 'g', weight: '' };
  return { amount, unit, weight: sv.nominal || unit === 'oz' ? '' : +sv.grams.toFixed(2) };
}

function servingFields(prefix, init = { amount: 1, unit: 'g', weight: '' }) {
  const chip = (u) => `<button class="chip" data-act="sv-unit" data-prefix="${prefix}" data-u="${u}" aria-pressed="${init.unit === u}" style="height:34px;font-size:13.5px">${u}</button>`;
  const volume = Object.keys(VOLUME_ML);
  const isVol = volume.includes(init.unit);
  const needsWeight = !(init.unit in SV_WEIGHT);
  return `<div class="col sv-fields" id="${prefix}-fields" data-unit="${init.unit}" style="gap:10px">
    <div class="row" style="gap:10px;align-items:center">
      <input class="input" id="${prefix}-amt" type="number" inputmode="decimal" min="0" step="any" value="${init.amount}" enterkeyhint="done" style="width:96px;text-align:center;font-size:18px;font-weight:600">
      <span class="s15 b6" id="${prefix}-unit-label">${init.unit}</span>
    </div>
    <div class="chips" role="group" aria-label="Unit">${['g', 'oz', ...SV_COUNT].map(chip).join('')}<button class="chip" data-act="sv-baking" data-prefix="${prefix}" aria-expanded="${isVol}" style="height:34px;font-size:13.5px;color:var(--lilac)">Baking ▾</button></div>
    <div class="chips" id="${prefix}-baking" role="group" aria-label="Kitchen measures" ${isVol ? '' : 'hidden'}>${volume.map(chip).join('')}</div>
    <div class="row" id="${prefix}-wrow" style="gap:8px;align-items:center" ${needsWeight ? '' : 'hidden'}>
      <span class="s14 muted">Weighs</span>
      <input class="input" id="${prefix}-grams" type="number" inputmode="decimal" min="0" step="any" placeholder="optional" value="${init.weight}" enterkeyhint="done" style="width:110px">
      <span class="s14 muted">g</span>
    </div>
    <span class="small faint" id="${prefix}-hint" style="line-height:1.4" ${needsWeight ? '' : 'hidden'}>Use the gram weight from the label if it gives one. Not needed for tablets, softgels and other pieces.</span>
  </div>`;
}

// Turn the editor into a serving: { label, grams, nominal, ok }.
function readServingFields(prefix, food) {
  const box = document.getElementById(prefix + '-fields');
  const unit = box?.dataset.unit || 'g';
  const amount = Number(document.getElementById(prefix + '-amt')?.value) || 0;
  const weight = Number(document.getElementById(prefix + '-grams')?.value) || 0;
  if (!(amount > 0)) return { ok: false };
  const amt = +amount.toFixed(3);
  if (unit === 'g') return { label: `${amt} g`, grams: amount, ok: true };
  if (unit === 'oz') { const g = amount * SV_WEIGHT.oz; return { label: `${amt} oz (${fmt(g)} g)`, grams: g, ok: true }; }
  const name = `${amt} ${plural(unit, amount)}`;
  if (weight > 0) return { label: `${name} (${fmt(weight)} g)`, grams: weight, ok: true };
  if (VOLUME_ML[unit]) { const g = amount * VOLUME_ML[unit] * densityFor(food || {}).gPerMl; return { label: `${name} (${fmt(g)} g)`, grams: g, ok: true, approx: true }; }
  return { label: name, grams: amount, nominal: true, ok: true }; // pieces: 1 g each, by count
}

function servingEditorHTML(food) {
  const cur = (food.servings || []).find((x) => x.grams > 0 && !isPlaceholderServing(x));
  return `<div class="col serving-editor" style="gap:10px;padding:14px;background:var(--fill);border-radius:18px">
    <span class="s13 muted" style="line-height:1.4">Serving size as printed on the label</span>
    ${servingFields('sv', parseServingLabel(cur))}
    <div class="row" style="gap:8px"><button class="btn quiet" style="flex:1" data-act="serving-cancel">Cancel</button><button class="btn tint" style="flex:1" data-act="serving-save">Save</button></div>
  </div>`;
}

function renderFood(r, changed) {
  const food = store.food(r.parts[0]);
  if (!food) { view().innerHTML = `<div class="screen mt24"><div class="err">That food isn’t saved on this device.</div><a class="btn quiet block mt12" href="#/">Back to diary</a></div>`; return; }
  const date = r.q.date || todayISO();
  const entry = r.q.entry ? store.day(date).find((e) => e.id === r.q.entry) : null;
  const units = unitsFor(food);
  if (changed || !ui.add || ui.add.foodId !== food.id) {
    let unitIdx = 0, qty = 1;
    if (entry) {
      unitIdx = Math.max(0, units.findIndex((u) => u.label === entry.unit));
      if (units[unitIdx].label === 'g') qty = entry.grams; else qty = entry.qty ?? entry.grams / units[unitIdx].grams;
    } else if (units[0].label === 'g') qty = 100;
    ui.add = { foodId: food.id, unitIdx, qty, meal: entry?.meal || r.q.meal || mealForNow(), time: hhmm(entry?.ts || Date.now()), date, entryId: entry?.id || null };
  }
  const a = ui.add;
  const unit = units[a.unitIdx] || units[0];
  const grams = a.qty * unit.grams;
  const bakingOpen = a.baking ?? !!unit.volume;
  // Editing previews changes; nothing is saved until you tap Save. Back discards them.
  const dirty = !!(entry && (Math.abs(grams - entry.grams) > 1e-6 || unit.label !== (entry.unit || 'g') || a.meal !== entry.meal || a.time !== hhmm(entry.ts)));
  const tot = {};
  for (const [k, c] of Object.entries(food.per100)) if (c?.v != null) tot[k] = { v: (c.v * grams) / 100, estShare: c.src === 'est' ? 1 : 0, src: c.src };
  if (tot.energy) tot.energy_kj = { ...tot.energy, v: tot.energy.v * 4.184 };
  const kcal = tot.energy?.v;
  const counts = Object.values(food.per100).reduce((acc, c) => { acc[c.src] = (acc[c.src] || 0) + 1; return acc; }, {});
  const total = Object.keys(food.per100).length;
  const list = NUTRIENTS.filter((n) => food.per100[n.key] && (ui.foodGroup === 'All' || (ui.foodGroup === 'Key' ? KEY_SET.includes(n.key) : n.group === ui.foodGroup)));

  view().innerHTML = `
  <header class="top">
    <button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button>
    <div class="title"><span class="s15 b6">${a.entryId ? 'Edit entry' : 'Add food'}</span>${dirty ? `<button class="was-btn small" data-act="entry-reset" aria-label="Go back to the logged amount">Was ${esc(amountText(entry))} · ${fmt(Math.round(((food.per100.energy?.v || 0) * entry.grams) / 100))} kcal</button>` : ''}</div>
    ${dirty ? `<button class="btn primary save-pill" data-act="save-entry">Save</button>` : '<span style="width:44px"></span>'}
  </header>

  <div class="screen mt16 row" style="gap:16px">
    <button class="tile-btn" data-act="kind-pick" data-id="${esc(food.id)}" aria-label="Change the icon for ${esc(food.name)}">${foodTile(food, 64)}</button>
    <button class="col name-btn" data-act="name-edit" aria-label="Edit name" style="gap:3px;min-width:0;flex:1;align-items:flex-start;text-align:left;border:none;background:none;padding:0;color:inherit;font:inherit;cursor:pointer">${food.brand ? `<span class="s13 muted">${esc(food.brand)}</span>` : ''}<h1 class="h1" style="font-size:22px;line-height:1.2">${esc(food.name)} <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:1px"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></h1></button>
  </div>
  ${ui.add?.editName ? `<section class="screen mt12"><div class="col name-editor" style="gap:10px;padding:14px;background:var(--fill);border-radius:18px">
    <label class="field">Name<input class="input" id="nm-name" value="${esc(food.unidentified ? '' : food.name)}" placeholder="e.g. Vitamin D3 1000 IU Softgels" enterkeyhint="next"></label>
    <label class="field">Brand<input class="input" id="nm-brand" value="${esc(food.brand || '')}" placeholder="Optional" enterkeyhint="done"></label>
    <div class="row" style="gap:8px"><button class="btn quiet" style="flex:1" data-act="name-cancel">Cancel</button><button class="btn tint" style="flex:1" data-act="name-save">Save</button></div>
  </div></section>` : ''}
  ${!total && !ui.add?.editName ? `<section class="screen mt16"><div class="card pad col" style="gap:10px">
    <span class="s15 b6">No nutrition data yet</span>
    <span class="s13 muted" style="line-height:1.45">${NATIVE ? 'Ask Gemini about this product, then share or paste its answer back. The name, brand and serving size fill in too if they’re missing.' : 'Paste the nutrition facts from the label or the brand’s website.'}</span>
    ${NATIVE ? `<button class="btn primary block" data-act="ask-gemini" data-id="${esc(food.id)}">✦ Ask Gemini</button>` : ''}
    <button class="btn tint block" data-act="paste-open" data-id="${esc(food.id)}">Paste answer</button>
  </div></section>` : ''}

  <section class="screen mt16"><div class="card pad col" style="gap:16px">
    <div class="spread">
      <label class="s15 b6" for="qty">Amount</label>
      <div class="row" style="gap:6px;padding:4px;background:var(--fill);border-radius:26px">
        <button class="icon-btn" style="background:var(--fill-2)" data-act="qty" data-d="-1" aria-label="Less">−</button>
        <input id="qty" data-act="qty-input" type="number" inputmode="decimal" min="0" step="any" value="${+a.qty.toFixed(2)}" style="width:64px;height:40px;border:none;background:transparent;text-align:center;font-size:18px;font-weight:600;outline:none">
        <button class="icon-btn" style="background:var(--fill-2)" data-act="qty" data-d="1" aria-label="More">+</button>
      </div>
    </div>
    <div class="col" style="gap:8px"><span class="s13 muted">Unit</span>
      <div class="chips" role="group" aria-label="Unit">${units.map((u, i) => u.volume ? '' : `<button class="chip" data-act="unit" data-i="${i}" aria-pressed="${i === a.unitIdx}">${esc(u.label)}${!u.plain && !u.nominal && !/\d\s*g\b/i.test(u.label) ? ` · ${fmt(u.grams)} g` : ''}</button>`).join('')}<button class="chip" data-act="baking" aria-expanded="${!!bakingOpen}" aria-pressed="${!!unit.volume}" style="${unit.volume ? '' : 'color:var(--lilac)'}">Baking ${bakingOpen ? '▴' : '▾'}</button><button class="chip" data-act="serving-edit" style="color:var(--lilac)">${units.some((u) => !u.plain && !u.volume) ? 'Edit serving' : '+ Serving size'}</button></div>
      ${bakingOpen ? `<div class="chips mt8" role="group" aria-label="Kitchen measures">${units.map((u, i) => u.volume ? `<button class="chip" data-act="unit" data-i="${i}" aria-pressed="${i === a.unitIdx}">${u.label}</button>` : '').join('')}</div>
      <span class="small faint" style="display:block;margin-top:6px;line-height:1.4">${units.find((u) => u.volume)?.approx ? `≈ ${fmt(units.find((u) => u.label === 'tbsp').grams)} g per tbsp, typical for this kind of food. Add a serving like “1 tbsp (15 g)” from the label for an exact match.` : `1 tbsp = ${fmt(units.find((u) => u.label === 'tbsp').grams)} g, from this food’s label serving.`}</span>` : ''}
      ${a.editServing ? servingEditorHTML(food) : ''}</div>
    <div class="col" style="gap:8px"><span class="s13 muted">Meal</span>
      <div class="chips" role="group" aria-label="Meal">${store.meals().map((m) => `<button class="chip" data-act="meal" data-m="${m.key}" aria-pressed="${m.key === a.meal}">${esc(m.name)}</button>`).join('')}</div></div>
    <label class="spread"><span class="s13 muted">Time</span><input type="time" data-act="time" value="${a.time}" class="input" style="width:150px;height:40px"></label>
    ${a.entryId ? '' : `<button class="btn primary block" data-act="save-entry">Add to ${esc(mealName(a.meal))}</button>`}
  </div></section>

  <section class="screen mt12"><div class="card pad">
    <div class="row" style="gap:8px;align-items:baseline"><span class="big">${kcal != null ? fmt(kcal) : '—'}</span><span class="s15 muted">kcal · ${fmt(grams)} g</span></div>
    <div class="mt16">${macroBlock(tot)}</div>
  </div></section>

  <section class="screen mt12"><div class="card pad">
    <div class="spread"><span class="s15 b6">Where this data comes from</span><span class="s13 muted">${total} nutrients</span></div>
    <div class="stack mt12" style="height:6px" aria-hidden="true">
      ${['label', 'spec', 'lab', 'est'].map((k) => counts[k] ? `<span style="flex:${counts[k]};background:${{ label: 'var(--text)', spec: 'var(--lilac)', lab: 'var(--sky)', est: 'var(--wheat)' }[k]};opacity:${k === 'est' ? 0.6 : 1}"></span>` : '').join('')}
    </div>
    <div class="list mt8">${(food.sources || []).map((s) => `
      <div class="col" style="gap:3px;padding:12px 0">
        <div class="spread"><span class="row" style="gap:8px"><span class="tag ${s.kind}">${SRC_LABEL[s.kind] || s.kind}</span><span class="s14 b6">${esc(s.title)}</span></span><span class="s13 muted">${s.count || ''}</span></div>
        ${s.note ? `<span class="s13 muted" style="line-height:1.45">${esc(s.note)}</span>` : ''}
        ${s.url ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer" class="s13 b6" style="color:var(--lilac)">View source</a>` : ''}
      </div>`).join('')}</div>
  </div></section>

  <section class="screen mt12 col" style="gap:8px">
    <button class="btn tint block" data-act="paste-open" data-id="${esc(food.id)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/></svg>Paste nutrient info</button>
    <button class="btn quiet block" data-act="ask-gemini" data-id="${esc(food.id)}" style="font-weight:600"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z"/></svg>Ask Gemini about this food</button>
  </section>
  <section class="screen mt24">
    <h2 class="h2" id="sec-nutrients" style="scroll-margin-top:12px">Nutrients</h2>
    <div class="mt12">${groupChips(ui.foodGroup, 'food-group')}</div>
    <div class="card mt12 list" style="padding:4px 20px">
      ${list.length ? list.map((n) => {
        const c = food.per100[n.key];
        const v = (c.v * grams) / 100;
        const t = store.target(n.key);
        return `<div class="spread" style="padding:12px 0">
          <span class="s14 ellipsis" style="flex:1">${esc(n.name)}</span>
          <span class="tag ${c.src}">${SRC_LABEL[c.src]}</span>
          <span class="s14 b6" style="min-width:70px;text-align:right">${fmt(v, n.unit)}</span>
          <span class="small muted" style="width:40px;text-align:right">${t ? Math.round((v / t) * 100) + '%' : ''}</span></div>`;
      }).join('') : '<div class="empty">No values in this group.</div>'}
    </div>
  </section>

  <div style="height:24px"></div>`;
}

/* ---------------- Report ---------------- */

function ratioRows(tot) {
  const v = (k) => tot[k]?.v || 0;
  const defs = [
    { label: 'Omega-6 : omega-3', a: 'omega6', b: 'omega3', lo: 0, hi: 4, max: 20, aim: 'aim under 4' },
    { label: 'Zinc : copper', a: 'zinc', b: 'copper', lo: 8, hi: 12, max: 20, aim: 'aim 8–12' },
    { label: 'Potassium : sodium', a: 'potassium', b: 'sodium', lo: 2, hi: 6, max: 6, aim: 'aim over 2' },
    { label: 'Calcium : magnesium', a: 'calcium', b: 'magnesium', lo: 1, hi: 2, max: 4, aim: 'aim 1–2' }
  ];
  return defs.filter((d) => v(d.a) > 0 && v(d.b) > 0).map((d) => {
    const r = v(d.a) / v(d.b);
    const ok = r >= d.lo && r <= d.hi;
    const pos = Math.min(100, (r / d.max) * 100);
    return `<div class="col" style="gap:10px;padding:14px 0">
      <div class="spread" style="align-items:baseline"><span class="s15" style="flex:1;font-weight:500">${d.label}</span><span class="small muted">${d.aim}</span><span class="s15 b6" style="width:44px;text-align:right;color:${ok ? 'var(--sage)' : 'var(--wheat)'}">${r.toFixed(1)}</span></div>
      <div style="position:relative;height:6px;border-radius:3px;background:var(--fill-2)" aria-hidden="true">
        <span style="position:absolute;top:0;bottom:0;left:${(d.lo / d.max) * 100}%;width:${(Math.min(d.hi, d.max) - d.lo) / d.max * 100}%;background:var(--sage-t);border-radius:3px"></span>
        <span style="position:absolute;top:-4px;left:${pos}%;width:14px;height:14px;margin-left:-7px;border-radius:7px;background:${ok ? 'var(--sage)' : 'var(--wheat)'};border:3px solid var(--bg)"></span>
      </div></div>`;
  }).join('');
}

function renderReport(date) {
  const entries = store.day(date);
  const tot = totals(entries);
  const cov = coverage(tot);
  const targeted = NUTRIENTS.filter((n) => store.target(n.key));
  const met = targeted.filter((n) => !n.limit && (tot[n.key]?.v || 0) >= store.target(n.key)).length;
  const below = targeted.filter((n) => !n.limit && (tot[n.key]?.v || 0) < store.target(n.key)).length;
  const over = targeted.filter((n) => n.limit && (tot[n.key]?.v || 0) > store.target(n.key)).length;
  const withData = Object.values(tot).filter((t) => t.v > 0);
  const estShare = withData.length ? withData.reduce((a, t) => a + t.estShare, 0) / withData.length : 0;
  // Only nutrients your foods actually list: one no food reports would always read 0%.
  const lowest = NUTRIENTS.filter((n) => !n.limit && store.target(n.key) && n.group !== 'General' && tot[n.key])
    .map((n) => ({ n, p: (tot[n.key]?.v || 0) / store.target(n.key) })).sort((a, b) => a.p - b.p)[0];
  const C = 2 * Math.PI * 52;
  const ratios = ratioRows(tot);
  view().innerHTML = `
  <header class="top">
    <a class="icon-btn ghost" href="#/report/${shiftDate(date, -1)}" aria-label="Previous day">${I.back}</a>
    <div class="title"><h1 style="margin:0;font-size:17px" class="b6">Report</h1><span class="small muted">${dayTitle(date)} · ${longDate(date)}</span></div>
    ${date < todayISO() ? `<a class="icon-btn ghost" href="#/report/${shiftDate(date, 1)}" aria-label="Next day">${I.next}</a>` : '<span style="width:44px"></span>'}
  </header>
  ${!entries.length ? `<div class="screen mt24"><div class="note">Nothing logged on this day yet.</div></div>` : `
  <section class="screen mt16"><div class="card" style="padding:22px;display:flex;align-items:center;gap:22px">
    <div style="position:relative;width:120px;height:120px;flex:none">
      <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--fill-2)" stroke-width="10"/>
      <circle cx="60" cy="60" r="52" fill="none" stroke="var(--lilac)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * cov).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)" ${cov > 0 ? '' : 'opacity="0"'}/></svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-size:30px;font-weight:300;letter-spacing:-.02em">${Math.round(cov * 100)}%</span><span class="small muted">of targets</span></div>
    </div>
    <div class="col" style="flex:1;gap:10px">
      <div class="spread s14"><span class="row muted" style="gap:8px"><span class="dot" style="background:var(--lilac)"></span>Met</span><span class="b6">${met}</span></div>
      <div class="spread s14"><span class="row muted" style="gap:8px"><span class="dot" style="background:var(--wheat)"></span>Below</span><span class="b6">${below}</span></div>
      <div class="spread s14"><span class="row muted" style="gap:8px"><span class="dot" style="background:var(--rose)"></span>Over a limit</span><span class="b6">${over}</span></div>
      <div class="spread s14"><span class="row muted" style="gap:8px"><span class="dot" style="background:var(--text-4)"></span>Estimated</span><span class="b6">${Math.round(estShare * 100)}%</span></div>
    </div>
  </div></section>
  ${lowest && lowest.p < 1 ? `<section class="screen mt12"><div class="card" style="padding:16px 18px;background:var(--lilac-t);border-color:transparent">
    <span class="s14 b6">Lowest today: ${esc(lowest.n.name)} at ${Math.round(lowest.p * 100)}%</span>
    <p class="s13 muted" style="margin:4px 0 0;line-height:1.45">${fmt(store.target(lowest.n.key) - (tot[lowest.n.key]?.v || 0), lowest.n.unit)} to go.${tot[lowest.n.key]?.estShare > 0.3 ? ' Much of today’s value is estimated, so treat it as a rough guide.' : ''} Tap a nutrient below to see which foods it came from.</p>
  </div></section>` : ''}
  <section class="screen mt24">${groupChips(ui.reportGroup, 'report-group')}
    <div class="card list mt12" style="padding:0 20px">${nutrientRows(tot, ui.reportGroup, { expandable: true, scope: 'r', date })}</div>
  </section>
  ${ratios ? `<section class="screen mt24"><h2 class="h2">Balance</h2><div class="card list mt12" style="padding:0 20px">${ratios}</div></section>` : ''}`}`;
}

/* ---------------- Meal summary ---------------- */

function renderMeal(date, mealKey) {
  const entries = sortMeal(store.day(date).filter((e) => e.meal === mealKey));
  const tot = totals(entries);
  const kcal = tot.energy?.v || 0;
  const eTarget = energyTargetFor(date).total;
  const srcCount = {};
  entries.forEach((e) => Object.values(store.food(e.foodId)?.per100 || {}).forEach((c) => { srcCount[c.src] = (srcCount[c.src] || 0) + 1; }));
  const all = Object.values(srcCount).reduce((a, b) => a + b, 0) || 1;
  const pct = (k) => Math.round(((srcCount[k] || 0) / all) * 100);
  const byFood = entries.map((e) => { const f = store.food(e.foodId); return { e, f, kcal: f?.per100.energy ? (f.per100.energy.v * e.grams) / 100 : 0 }; }).sort((a, b) => b.kcal - a.kcal);
  view().innerHTML = `
  <header class="top">
    <a class="icon-btn" href="#/day/${date}" aria-label="Back to diary">${I.back}</a>
    <div class="title"><h1 style="margin:0;font-size:17px" class="b6">${esc(mealName(mealKey))}</h1><span class="small muted">${longDate(date)} · ${entries.length} food${entries.length === 1 ? '' : 's'}</span></div>
    <span style="width:44px"></span>
  </header>
  ${!entries.length ? `<div class="screen mt24"><div class="note">Nothing logged in this meal.</div></div>` : `
  <section class="screen mt24 col" style="align-items:center;gap:4px;text-align:center">
    <span class="row" style="gap:8px;align-items:baseline"><span style="font-size:60px;font-weight:300;letter-spacing:-.03em;line-height:1">${fmt(kcal)}</span><span class="s15 muted">kcal</span></span>
    <span class="s14 muted">${eTarget ? Math.round((kcal / eTarget) * 100) + '% of your daily energy target' : ''}</span>
  </section>
  <section class="screen mt24"><div class="card pad">${macroBlock(tot)}</div></section>
  <section class="screen mt12"><div class="card pad col" style="gap:12px">
    <div class="spread"><span class="s15 b6">Where the numbers come from</span><span class="s13 muted">${Object.keys(tot).length} nutrients</span></div>
    <div class="stack" style="height:6px" aria-hidden="true">
      <span style="flex:${pct('label') + 0.01};background:var(--text)"></span><span style="flex:${pct('spec') + pct('lab') + 0.01};background:var(--lilac)"></span><span style="flex:${pct('est') + 0.01};background:var(--wheat);opacity:.6"></span>
    </div>
    <div class="row small muted" style="flex-wrap:wrap;gap:14px">
      <span class="row" style="gap:6px"><span class="dot" style="background:var(--text)"></span>Label ${pct('label')}%</span>
      <span class="row" style="gap:6px"><span class="dot" style="background:var(--lilac)"></span>Spec sheet + lab ${pct('spec') + pct('lab')}%</span>
      <span class="row" style="gap:6px"><span class="dot" style="background:var(--wheat);opacity:.6"></span>Estimated ${pct('est')}%</span>
    </div>
  </div></section>
  <section class="screen mt24"><div class="spread"><h2 class="h2">All nutrients</h2><span class="small faint">% of daily target</span></div>
    <div class="mt12">${groupChips(ui.mealGroup, 'meal-group')}</div>
    <div class="card list mt12" style="padding:0 20px">${nutrientRows(tot, ui.mealGroup, { expandable: true, scope: 'm', date })}</div>
  </section>
  <section class="screen mt12"><div class="card list" style="padding:6px 20px">
    <div class="s15 b6" style="padding:12px 0">What each food added</div>
    ${byFood.map(({ e, f, kcal: k }) => f ? `<a class="item" href="#/food/${encodeURIComponent(f.id)}?entry=${e.id}&date=${date}"><span class="s14 ellipsis" style="flex:1">${esc(f.name)}</span><span class="s14 b6">${fmt(k)} kcal</span></a>` : '').join('')}
  </div></section>`}`;
}

/* ---------------- Targets & settings ---------------- */


function bodySection() {
  const p = store.profile();
  const today = todayISO();
  const w = store.weightOn(today);
  const all = Object.entries(store.weights()).sort((a, b) => b[0].localeCompare(a[0]));
  const recent = all.slice(0, 5);
  const first = all[all.length - 1];
  const change = w && first && first[0] !== w.date ? w.lbs - first[1] : null;
  const bmr = bmrFor(today);
  const baseline = activityKcalFor(bmr, p);
  const maint = bmr != null ? bmr + baseline + lifeStageCalories(p) : null;
  const ft = p.heightIn ? Math.floor(p.heightIn / 12) : '';
  const inch = p.heightIn ? Math.round((p.heightIn % 12) * 10) / 10 : '';
  const adj = p.goal === 'lose' ? -500 * p.rateLb : p.goal === 'gain' ? 500 * p.rateLb : 0;
  const seg = (name, val, opts) => `<div class="seg" role="group" aria-label="${name}">${opts.map(([v, l]) => `<button class="chip" data-act="profile-set" data-k="${name}" data-v="${v}" aria-pressed="${String(val) === String(v)}">${l}</button>`).join('')}</div>`;
  return `
  <section class="screen mt16"><div class="card pad col" style="gap:14px">
    <div class="spread" style="align-items:flex-end">
      <div class="col" style="gap:2px"><span class="s13 muted">Weight</span>
        <span class="row" style="gap:6px;align-items:baseline"><span style="font-size:40px;font-weight:300;letter-spacing:-.03em;line-height:1">${w ? lbs(w.lbs) : '—'}</span><span class="s15 muted">lb</span></span>
        <span class="small muted">${w ? (w.date === today ? 'Logged today' : 'Last logged ' + longDate(w.date)) : 'Log your weight to calculate BMR'}${change != null ? ` · ${change > 0 ? '+' : ''}${lbs(change)} lb since ${longDate(first[0])}` : ''}</span>
      </div>
    </div>
    <form class="row" data-form="weight" style="gap:8px">
      <label for="w-date" style="position:absolute;left:-999px">Date</label>
      <input class="input" id="w-date" type="date" max="${today}" value="${ui.weightDate || today}" style="width:150px;flex:none">
      <label for="w-in" style="position:absolute;left:-999px">Weight in pounds</label>
      <input class="input" id="w-in" type="number" inputmode="decimal" step="0.1" placeholder="Weight (lb)" value="${store.weights()[ui.weightDate || today] ?? ''}" style="min-width:0;flex:1">
      <button class="btn tint" style="height:48px;flex:none">Log</button></form>
    ${recent.length > 1 ? `<div class="list">${recent.map(([d, v], i) => {
      const prev = recent[i + 1]?.[1];
      const diff = prev != null ? v - prev : null;
      return `<div class="spread s14" style="padding:9px 0"><span class="muted">${longDate(d)}</span><span class="row" style="gap:12px"><span class="small" style="color:${diff == null ? 'var(--text-3)' : diff > 0 ? 'var(--wheat)' : 'var(--lilac)'}">${diff == null ? '' : (diff > 0 ? '+' : '') + lbs(diff)}</span><span class="b6">${lbs(v)} lb</span><button class="icon-btn ghost" style="width:32px;height:32px" data-act="weight-del" data-d="${d}" aria-label="Delete ${longDate(d)} weight">${I.close}</button></span></div>`;
    }).join('')}</div>` : ''}
  </div></section>

  <section class="screen mt12"><div class="card pad col" style="gap:14px">
    <div class="spread"><span class="s15 b6">BMR calculator</span><span class="small muted">Mifflin-St Jeor</span></div>
    ${seg('sex', p.sex, [['male', 'Male'], ['female', 'Female']])}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <label class="field">Age<input class="input" type="number" inputmode="numeric" data-profile="age" value="${esc(p.age)}"></label>
      <label class="field">Height ft<input class="input" type="number" inputmode="numeric" data-height="ft" value="${ft}"></label>
      <label class="field">in<input class="input" type="number" inputmode="decimal" data-height="in" value="${inch}"></label>
    </div>
    <label class="field">Daily activity (outside logged workouts)
      <select class="input" data-profile="activity">${Object.entries(ACTIVITY_LEVELS).map(([k, l]) => `<option value="${k}" ${(p.activity || 'sedentary') === k ? 'selected' : ''}>${l.name}: ${l.sub}</option>`).join('')}</select></label>
    ${p.activity === 'custom' ? `<div class="col" style="gap:10px;padding:14px;background:var(--fill);border-radius:16px">
      ${seg('activityMode', p.activityMode === 'factor' ? 'factor' : 'kcal', [['kcal', 'kcal a day'], ['factor', '× BMR']])}
      ${p.activityMode === 'factor'
        ? `<label class="field">Activity multiplier<input class="input" type="number" inputmode="decimal" step="0.01" min="1" max="3" data-profile="activityFactor" style="background:var(--fill-2)" value="${esc(p.activityFactor ?? '')}" placeholder="e.g. 1.45"></label>
      <p class="small faint" style="margin:0;line-height:1.45">Maintenance before workouts = BMR × this number. The presets are 1.2 (sedentary), 1.375, 1.55 and 1.725 (very active). Use 1 to 3.</p>`
        : `<label class="field">Daily activity, kcal a day<input class="input" type="number" inputmode="numeric" step="1" min="0" max="5000" data-profile="activityKcal" style="background:var(--fill-2)" value="${esc(p.activityKcal ?? '')}" placeholder="e.g. 450"></label>
      <p class="small faint" style="margin:0;line-height:1.45">Calories you burn moving around on a normal day, on top of BMR, not counting workouts you log. A fitness tracker’s average “active calories” on rest days is a good number to use. Stays the same when your weight changes.</p>`}
      ${(p.activityMode === 'factor' ? !(Number(p.activityFactor) >= 1 && Number(p.activityFactor) <= 3) : !(p.activityKcal !== '' && p.activityKcal != null && Number(p.activityKcal) >= 0 && Number(p.activityKcal) <= 5000)) ? `<span class="small" style="color:var(--wheat)">Enter a number to use it. Until then, sedentary is used.</span>` : ''}
    </div>` : ''}
    <label class="spread s14"><span class="col" style="gap:2px"><span>Count digestion (TEF)</span><span class="small muted">Adds 10% of the calories you eat to calories burned</span></span><span class="switch"><input type="checkbox" data-profile-check="tef" ${p.tef ? 'checked' : ''}><span aria-hidden="true"></span></span></label>
    ${bmr != null ? `<div class="list" style="background:var(--fill);border-radius:16px;padding:0 14px">
      <div class="spread s14" style="padding:11px 0"><span class="muted">BMR (at rest)</span><span class="b6">${fmt(Math.round(bmr))} kcal</span></div>
      <div class="spread s14" style="padding:11px 0"><span class="muted">Daily activity (${esc(activityName(p))})</span><span class="b6">${fmt(Math.round(baseline))} kcal</span></div>
      ${lifeStageCalories(p) ? `<div class="spread s14" style="padding:11px 0"><span class="muted">${p.stage === 'pregnant' ? 'Pregnancy' : 'Breastfeeding'}</span><span class="b6">${lifeStageCalories(p)} kcal</span></div>` : ''}
      <div class="spread s14" style="padding:11px 0"><span>Maintenance, before workouts</span><span class="b6">${fmt(Math.round(maint))} kcal</span></div>
    </div>` : `<div class="note">${!w ? 'Log your weight above' : 'Add your age and height'} to calculate your BMR.</div>`}
  </div></section>

  <section class="screen mt12"><div class="card pad col" style="gap:14px">
    <div class="col" style="gap:2px"><span class="s15 b6">Life stage and diet</span><span class="small muted">Adjusts recommended vitamin and mineral amounts</span></div>
    ${p.sex === 'female' ? `<div class="col" style="gap:8px"><span class="s13 muted">Life stage</span>
      ${seg('stage', p.stage || 'none', [['none', 'None'], ['pregnant', 'Pregnant'], ['breastfeeding', 'Breastfeeding']])}</div>
      ${p.stage === 'pregnant' ? `<div class="col" style="gap:8px"><span class="s13 muted">Trimester</span>${seg('trimester', p.trimester || 1, [[1, '1st'], [2, '2nd'], [3, '3rd']])}</div>` : ''}
      ${p.stage === 'breastfeeding' ? `<div class="col" style="gap:8px"><span class="s13 muted">Baby’s age</span>${seg('months', p.months || 1, [[1, '0–6 months'], [2, '7–12 months']])}</div>` : ''}
      ${p.stage && p.stage !== 'none' && Number(p.age) && (Number(p.age) < 19 || Number(p.age) > 50) ? `<div class="note">Pregnancy and breastfeeding values here are for ages 19–50. Ask your doctor or dietitian about your needs.</div>` : ''}` : ''}
    <div class="col" style="gap:8px"><span class="s13 muted">Diet</span>${seg('diet', p.diet || 'omnivore', [['omnivore', 'Eats meat'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan']])}</div>
    <label class="spread s14" style="gap:12px;cursor:pointer"><span class="col" style="gap:2px"><span>I smoke</span><span class="small muted">Raises vitamin C needs by 35 mg</span></span>
      <span class="switch"><input type="checkbox" data-profile-check="smoker" ${p.smoker ? 'checked' : ''}><span aria-hidden="true"></span></span></label>
    ${lifeStageCalories(p) ? `<div class="spread s14" style="padding:12px 14px;border-radius:16px;background:var(--fill)"><span>Extra calories for ${p.stage === 'pregnant' ? 'pregnancy' : 'breastfeeding'}</span><span class="b6">+${lifeStageCalories(p)} kcal</span></div>` : ''}
  </div></section>

  <section class="screen mt12"><div class="card pad col" style="gap:14px">
    <span class="s15 b6">Weight goal</span>
    ${seg('goal', p.goal, [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']])}
    ${p.goal !== 'maintain' ? `<label class="field">Rate
      <select class="input" data-profile="rateLb">${[0.25, 0.5, 0.75, 1, 1.5, 2].map((r) => `<option value="${r}" ${Number(p.rateLb) === r ? 'selected' : ''}>${r} lb per week (${p.goal === 'lose' ? '−' : '+'}${r * 500} kcal a day)</option>`).join('')}</select></label>` : ''}
    ${maint != null && p.goal === 'lose' && maint + adj < (p.sex === 'female' ? 1200 : 1500) ? `<div class="note" style="color:var(--wheat)">${fmt(Math.round(maint + adj))} kcal a day is below the ${p.sex === 'female' ? '1,200' : '1,500'} kcal usually advised as a minimum without medical supervision. A slower rate keeps you above it.</div>` : ''}
    ${p.sex === 'female' && p.stage === 'pregnant' && p.goal === 'lose' ? `<div class="note" style="color:var(--wheat)">Losing weight usually isn’t recommended during pregnancy. Check with your doctor before setting a weight-loss goal.</div>` : ''}
    <label class="spread s14"><span class="col" style="gap:2px"><span>Set my energy target from this</span><span class="small muted">${maint != null ? `${fmt(Math.round(maint + adj))} kcal a day` : 'Needs your BMR first'}</span></span><span class="switch"><input type="checkbox" data-profile-check="autoTarget" ${p.autoTarget ? 'checked' : ''} ${maint == null ? 'disabled' : ''}><span aria-hidden="true"></span></span></label>
    <label class="spread s14"><span class="col" style="gap:2px"><span>Add workouts to that day’s target</span><span class="small muted">A 300 kcal workout lets you eat 300 kcal more, so your planned deficit or surplus stays the same</span></span><span class="switch"><input type="checkbox" data-setting-check="workoutsInTarget" ${store.settings().workoutsInTarget !== false ? 'checked' : ''}><span aria-hidden="true"></span></span></label>
  </div></section>`;
}

function renderInsights() {
  const range = ['7', '30', '90', 'all'].includes(store.settings().insRange) ? store.settings().insRange : '30';
  view().innerHTML = insightsHTML(range, !!ui.insAll);
}

function renderSettings() {
  const s = store.settings();
  const prof = store.profile();
  const e = store.target('energy');
  const macroK = MACROS.reduce((a, m) => a + (store.target(m.key) || 0) * m.kcal, 0);
  const off = Math.round(macroK - e);
  view().innerHTML = `
  <header class="top" style="justify-content:flex-start"><h1 class="h1">Targets</h1></header>
  ${bodySection()}
  <section class="screen mt24"><h2 class="h2">Energy and macros</h2></section>
  <section class="screen mt12"><div class="card pad col" style="gap:14px">
    <label class="spread"><span class="col" style="gap:2px"><span class="s15 b6">Daily energy</span><span class="small muted">${prof.autoTarget && bmrFor() != null ? 'Set from your weight goal' : 'kcal'}</span></span>
      <input class="input" style="width:110px;text-align:center;font-weight:600" type="number" inputmode="numeric" data-target="energy" value="${e}" ${prof.autoTarget && bmrFor() != null ? 'disabled' : ''}></label>
    <div class="list">${MACROS.map((m) => `
      <label class="spread" style="padding:10px 0"><span class="row" style="gap:10px"><span class="dot" style="background:${m.color};width:9px;height:9px"></span><span class="col" style="gap:1px"><span class="s15 b6">${m.name}</span><span class="small muted">${fmt((store.target(m.key) || 0) * m.kcal)} kcal</span></span></span>
      <span class="row" style="gap:8px"><input class="input" style="width:90px;text-align:center;font-weight:600" type="number" inputmode="numeric" data-target="${m.key}" value="${store.target(m.key)}"><span class="s13 muted">g</span></span></label>`).join('')}</div>
    <div class="spread" style="padding:12px 14px;border-radius:16px;background:${Math.abs(off) < 10 ? 'var(--sage-t)' : 'var(--fill)'}">
      <span class="s13" style="color:${Math.abs(off) < 10 ? 'var(--sage)' : 'var(--text)'}">${Math.abs(off) < 10 ? 'Macros match your energy target.' : `Macros add up to ${fmt(macroK)} kcal, ${Math.abs(off)} ${off > 0 ? 'over' : 'under'}.`}</span>
      ${Math.abs(off) >= 10 ? '<button class="chip" data-act="balance" style="background:var(--text);color:var(--bg)">Balance fat</button>' : ''}
    </div>
  </div></section>

  <section class="screen mt12"><div class="card pad"><p class="s13 muted" style="margin:0;line-height:1.5">Vitamins, minerals and other nutrients use the recommended amounts for your age and sex. To use your own number for one, swipe right on it in the Report and switch on a custom target.</p></div></section>

  <section class="screen mt24"><h2 class="h2">Data sources</h2>
    <div class="card pad col mt12" style="gap:14px">
      <p class="s13 muted" style="margin:0;line-height:1.5">A scan gets the product’s name, brand, serving size and label values from Open Food Facts and USDA, or the name and brand from UPCitemdb. For every other nutrient, open the food and tap Ask Gemini, then paste the answer.</p>
      <label class="field">USDA FoodData Central key<input class="input" autocomplete="off" data-setting="fdcKey" value="${esc(s.fdcKey)}" placeholder="Optional. Uses the shared demo key if empty"></label>
      <p class="small faint" style="margin:0">Get a free USDA key at api.data.gov/signup. The demo key is limited to a few dozen lookups an hour.</p>
    </div>
  </section>

  <section class="screen mt24"><h2 class="h2">Your data</h2>
    <div class="mt12">${storageCard()}</div>
    <div class="card list mt12" style="padding:0 18px">
      <button class="item s15" data-act="export" style="padding:16px 0">Export</button>
      <button class="item s15" data-act="import" style="padding:16px 0">Import</button>
    </div>
  </section>

  <section class="screen mt24" style="padding-bottom:12px"><h2 class="h2">About</h2>
    <div class="card list mt12" style="padding:0 18px">
      <div class="spread s15" style="padding:16px 0"><span>Spectra</span><span class="muted">Version ${esc(appVersion())}</span></div>
      <a class="item s15 spread" href="${SITE}" target="_blank" rel="noopener" style="padding:16px 0">Guide and features <span class="muted">${I.next}</span></a>
      <a class="item s15 spread" href="${SITE}privacy.html" target="_blank" rel="noopener" style="padding:16px 0">Privacy <span class="muted">${I.next}</span></a>
      <a class="item s15 spread" href="https://github.com/m0n0t0ne0ne/spectra" target="_blank" rel="noopener" style="padding:16px 0">Source code and releases <span class="muted">${I.next}</span></a>
    </div>
    <p class="small faint mt12" style="line-height:1.5">Your diary and foods stay on this phone. Food lookups go to Open Food Facts, USDA and UPCitemdb; Ask Gemini opens the Gemini app, where you see the question before sending.</p>
  </section>`;
}


// Opens the Gemini app (or Gemini on the web) with this product's details, for follow-up questions.
// A placeholder food for a barcode no database knows; Gemini's answer or your own entries fill it in.
function barcodeFood(code) {
  const id = 'upc:' + code.replace(/^0+/, '');
  return store.food(id) || store.saveFood({ id, name: `Barcode ${code}`, brand: '', upc: code, unidentified: true, servings: [], per100: {}, sources: [{ kind: 'label', title: 'Added by you', count: 0, note: 'No database had this barcode' }], createdAt: Date.now() });
}

function askGeminiApp(food) {
  if (!food) return;
  // Remember which food Gemini's answer belongs to, for when it's shared back to the app.
  store.saveSettings({ askedFood: food.id });
  const text = geminiNutrientPrompt(food);
  if (NATIVE && window.AndroidBridge.shareToGemini) {
    if (!window.AndroidBridge.shareToGemini(text)) toast('Gemini app not found. Shared instead.');
    return;
  }
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  navigator.clipboard?.writeText(text).then(() => toast('Copied. Paste it into Gemini.')).catch(() => {});
  window.open('https://gemini.google.com/app', '_blank', 'noopener');
}




// The app's own confirm sheet. The Android WebView has no browser dialogs, so window.confirm() silently says no.
function askConfirm(message, actionLabel = 'OK') {
  return new Promise((resolve) => {
    document.getElementById('confirm-scrim')?.remove();
    const scrim = document.createElement('div');
    scrim.className = 'scrim'; scrim.id = 'confirm-scrim';
    scrim.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg"><div class="handle"></div>
      <p class="s15" id="confirm-msg" style="margin:4px 0 18px;line-height:1.45">${esc(message)}</p>
      <div class="row" style="gap:10px"><button class="btn quiet" style="flex:1" data-confirm="no">Cancel</button><button class="btn" style="flex:1;background:var(--rose);color:var(--on-accent)" data-confirm="yes">${esc(actionLabel)}</button></div>
    </div>`;
    const done = (v) => { scrim.remove(); resolve(v); };
    scrim.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-confirm]');
      if (b) done(b.dataset.confirm === 'yes'); else if (e.target === scrim) done(false);
    });
    document.body.appendChild(scrim);
  });
}

/* ---------------- export / import ---------------- */

const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
const RANGE_KINDS = [['all', 'Everything'], ['day', 'One day'], ['month', 'A month'], ['year', 'A year'], ['range', 'Date range']];
const monthName = (ym) => new Date(ym + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function storageCard() {
  const u = storageUsage();
  const used = u.foods + u.log + u.other;
  const room = u.native ? (u.free ?? 0) : Math.max(0, (u.cap || 0) - used);
  const scale = Math.max(used * 4, Math.min(used + room, used * 40), 1); // keep the bar readable
  const seg = (b, c) => `<span style="flex:${(b / scale) || 0.0001};background:${c}"></span>`;
  return `<div class="card" style="padding:16px 18px">
    <div class="spread" style="align-items:baseline"><span class="s15 b6">Storage</span><span class="s13 muted">${fmtBytes(used)} used${u.native && u.free != null ? ` · ${fmtBytes(u.free)} free on phone` : u.cap ? ` of about ${fmtBytes(u.cap)}` : ''}</span></div>
    <div class="ins-stack mt12" style="height:10px;background:var(--fill-2)" aria-hidden="true">${seg(u.log, 'var(--sky)')}${seg(u.foods, 'var(--lilac)')}${seg(u.other, 'var(--wheat)')}<span style="flex:${Math.max(0, scale - used) / scale}"></span></div>
    <div class="list mt12">
      ${[['diary', 'Diary', `${u.dayCount} day${u.dayCount === 1 ? '' : 's'} logged`, u.log, 'var(--sky)'], ['foods', 'Foods', `${u.foodCount} saved`, u.foods, 'var(--lilac)'], ['body', 'Weights and workouts', 'Weigh-ins and workouts by month', u.other, 'var(--wheat)']].map(([k, name, sub, b, c]) => `
      <a class="dm-cat" href="#/data/${k}"><span class="dot" style="background:${c};width:10px;height:10px"></span><span class="col" style="flex:1;gap:1px"><span class="s15 b6">${name}</span><span class="small muted">${sub}</span></span><span class="s13 muted">${fmtBytes(b)}</span><span class="dm-chev" aria-hidden="true">${I.next}</span></a>`).join('')}
    </div>
    <p class="small muted" style="margin:6px 0 0;line-height:1.45">${u.native ? 'Saved in the app’s private storage on this phone. Tap a category to export or delete parts of it.' : 'Saved in this browser (about 5 MB max). Tap a category to export or delete parts of it.'}</p>
  </div>`;
}

/* ---------------- Data manager ---------------- */

const DM = {
  diary: { title: 'Diary', parts: ['diary'], note: 'Select months to export or delete. The foods they use stay saved.' },
  body: { title: 'Weights and workouts', parts: ['body'], note: 'Select months of weigh-ins and workouts to export or delete.' },
  foods: { title: 'Foods', note: 'Foods your diary uses can’t be deleted, so no entry loses its nutrients. Delete those days first if you want them gone.' }
};
const monthOnly = (m) => new Date(m + '-15T12:00:00').toLocaleDateString(undefined, { month: 'long' });
const checkHTML = (state) => `<span class="dm-check" data-state="${state}" aria-hidden="true">${state === 'on' ? I.check : state === 'some' ? '<i></i>' : ''}</span>`;

function renderData(cat, changed) {
  if (!DM[cat]) { go('#/settings'); return; }
  if (changed || !ui.dm || ui.dm.cat !== cat) ui.dm = { cat, sel: [], open: {}, q: '', filter: 'all' };
  const st = ui.dm, sel = new Set(st.sel);
  const b = dataBreakdown();
  let body = '', total = 0, selBytes = 0, selCount = 0, selDesc = '';
  if (cat === 'foods') {
    const q = st.q.trim().toLowerCase();
    const list = b.foods.filter((f) => (st.filter === 'unused' ? !f.uses : true) && (!q || (f.name + ' ' + f.brand).toLowerCase().includes(q)))
      .sort((x, y) => (x.uses ? 1 : 0) - (y.uses ? 1 : 0) || y.bytes - x.bytes);
    total = b.foods.reduce((a, f) => a + f.bytes, 0);
    const unused = b.foods.filter((f) => !f.uses);
    b.foods.forEach((f) => { if (sel.has(f.id)) { selBytes += f.bytes; selCount++; } });
    selDesc = `${selCount} food${selCount === 1 ? '' : 's'}`;
    body = `
      <div class="row" style="gap:8px"><input class="input" id="dm-q" type="search" placeholder="Search foods" value="${esc(st.q)}" style="flex:1"></div>
      <div class="chips mt12"><button class="chip" data-act="dm-filter" data-v="all" aria-pressed="${st.filter === 'all'}">All ${b.foods.length}</button><button class="chip" data-act="dm-filter" data-v="unused" aria-pressed="${st.filter === 'unused'}">Never logged ${unused.length}</button>${unused.length ? `<button class="chip" data-act="dm-all-unused" style="color:var(--lilac)">Select all unused</button>` : ''}</div>
      <div class="card list mt12" style="padding:0 16px">${list.length ? list.map((f) => `
        <button class="dm-row" data-act="dm-toggle" data-k="${esc(f.id)}" ${f.uses ? 'disabled' : ''} aria-pressed="${sel.has(f.id)}">
          ${checkHTML(f.uses ? 'locked' : sel.has(f.id) ? 'on' : 'off')}
          <span class="col" style="flex:1;min-width:0;gap:1px;text-align:left"><span class="s14 b6 ellipsis">${esc(f.name)}</span><span class="small muted ellipsis">${f.uses ? `In your diary on ${f.days} day${f.days === 1 ? '' : 's'} · last ${shortDay(f.last)}` : 'Never logged'}${f.brand ? ' · ' + esc(f.brand) : ''}</span></span>
          <span class="s13 muted">${fmtBytes(f.bytes)}</span>
        </button>`).join('') : '<div class="empty">No foods match.</div>'}</div>`;
  } else {
    const rows = cat === 'diary' ? b.diary : b.body;
    const years = {};
    rows.forEach((m) => (years[m.month.slice(0, 4)] = years[m.month.slice(0, 4)] || []).push(m));
    total = rows.reduce((a, m) => a + m.bytes, 0);
    rows.forEach((m) => { if (sel.has(m.month)) { selBytes += m.bytes; selCount++; } });
    selDesc = `${selCount} month${selCount === 1 ? '' : 's'}`;
    const desc = (m) => (cat === 'diary' ? `${m.days} day${m.days === 1 ? '' : 's'} · ${m.entries} entr${m.entries === 1 ? 'y' : 'ies'}` : [m.weighins ? `${m.weighins} weigh-in${m.weighins === 1 ? '' : 's'}` : '', m.workouts ? `${m.workouts} workout${m.workouts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '));
    const ys = Object.keys(years).sort().reverse();
    const yearAgo = addDays(todayISO(), -365).slice(0, 7);
    body = rows.length ? `
      <div class="chips"><button class="chip" data-act="dm-pick" data-v="all">Select all</button>${rows.some((m) => m.month < yearAgo) ? `<button class="chip" data-act="dm-pick" data-v="old">Older than a year</button>` : ''}${sel.size ? `<button class="chip" data-act="dm-pick" data-v="none">Clear</button>` : ''}</div>
      ${ys.map((y, yi) => {
        const ms = years[y], on = ms.filter((m) => sel.has(m.month)).length;
        const open = st.open[y] ?? yi === 0;
        const days = ms.reduce((a, m) => a + (cat === 'diary' ? m.days : m.weighins + m.workouts), 0);
        return `<div class="card mt12" style="padding:0 16px">
          <div class="dm-row dm-year">
            <button class="dm-hit" data-act="dm-year" data-y="${y}" aria-label="Select ${y}">${checkHTML(on === ms.length ? 'on' : on ? 'some' : 'off')}</button>
            <button class="dm-hit" data-act="dm-open" data-y="${y}" style="flex:1;justify-content:space-between" aria-expanded="${open}">
              <span class="col" style="gap:1px;text-align:left"><span class="s15 b6">${y}</span><span class="small muted">${days} ${cat === 'diary' ? 'days' : 'records'} · ${ms.length} month${ms.length === 1 ? '' : 's'}</span></span>
              <span class="row" style="gap:8px"><span class="s13 muted">${fmtBytes(ms.reduce((a, m) => a + m.bytes, 0))}</span><span style="display:flex;transform:rotate(${open ? 180 : 0}deg);transition:transform .2s;color:var(--text-3)">${I.down}</span></span>
            </button>
          </div>
          ${open ? ms.map((m) => `<button class="dm-row" data-act="dm-toggle" data-k="${m.month}" aria-pressed="${sel.has(m.month)}">
            ${checkHTML(sel.has(m.month) ? 'on' : 'off')}
            <span class="col" style="flex:1;gap:1px;text-align:left"><span class="s14 b6">${monthOnly(m.month)}</span><span class="small muted">${desc(m)}</span></span>
            <span class="s13 muted">${fmtBytes(m.bytes)}</span></button>`).join('') : ''}
        </div>`;
      }).join('')}` : `<div class="note">Nothing stored here yet.</div>`;
  }
  view().innerHTML = `
  <header class="top">
    <button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button>
    <div class="title"><span class="s15 b6">${DM[cat].title}</span><span class="small muted">${fmtBytes(total)}</span></div>
    <span style="width:44px"></span>
  </header>
  <section class="screen mt12"><p class="s13 muted" style="margin:0 0 14px;line-height:1.45">${DM[cat].note}</p>${body}</section>
  <div style="height:${selCount ? 110 : 24}px"></div>
  ${selCount ? `<div class="dm-bar"><div class="dm-bar-in">
    <span class="col" style="flex:1;gap:1px"><span class="s14 b6">${selDesc} selected</span><span class="small muted">${fmtBytes(selBytes)}</span></span>
    ${cat !== 'foods' ? `<button class="btn quiet" data-act="dm-export">Export</button>` : ''}
    <button class="btn" style="background:var(--rose);color:var(--on-accent)" data-act="dm-delete">Delete</button>
  </div></div>` : ''}`;
}

const dmFilter = () => (ui.dm.cat === 'foods' ? null : ((set) => (d) => set.has(d.slice(0, 7)))(new Set(ui.dm.sel)));
function dmExport() {
  const st = ui.dm, ms = st.sel.slice().sort();
  const tag = ms.length === 1 ? ms[0] : `${ms[0]}_to_${ms[ms.length - 1]}`;
  return saveText(`spectra-${st.cat}-${tag}.json`, JSON.stringify(exportData(dmFilter(), DM[st.cat].parts)));
}
// Three-way confirm: export first (recommended), delete anyway, or cancel.
function askDelete(message, withExport) {
  return new Promise((resolve) => {
    document.getElementById('confirm-scrim')?.remove();
    const scrim = document.createElement('div');
    scrim.className = 'scrim'; scrim.id = 'confirm-scrim';
    scrim.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg"><div class="handle"></div>
      <p class="s15" id="confirm-msg" style="margin:4px 0 18px;line-height:1.45">${esc(message)}</p>
      <div class="col" style="gap:10px">
        ${withExport ? `<button class="btn primary block" data-confirm="export">Export, then delete</button>` : ''}
        <button class="btn block" style="background:${withExport ? 'var(--rose-t)' : 'var(--rose)'};color:${withExport ? 'var(--rose)' : 'var(--on-accent)'}" data-confirm="delete">${withExport ? 'Delete without exporting' : 'Delete'}</button>
        <button class="btn quiet block" data-confirm="no">Cancel</button>
      </div></div>`;
    const done = (v) => { scrim.remove(); resolve(v); };
    scrim.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-confirm]'); if (b) done(b.dataset.confirm); else if (e.target === scrim) done('no'); });
    document.body.appendChild(scrim);
  });
}
async function dmDelete() {
  const st = ui.dm, n = st.sel.length;
  if (st.cat === 'foods') {
    const ans = await askDelete(`Delete ${n} food${n === 1 ? '' : 's'}? They aren’t in your diary, so nothing else changes. You can scan or search for them again later.`, false);
    if (ans !== 'delete') return;
    const k = deleteFoods(st.sel); st.sel = []; render(); toast(`Deleted ${k} food${k === 1 ? '' : 's'}`);
    return;
  }
  const what = st.cat === 'diary' ? 'diary' : 'weights and workouts';
  const ans = await askDelete(`Delete ${n} month${n === 1 ? '' : 's'} of ${what}? This can’t be undone. Export first if you might want it back.`, true);
  if (ans === 'no') return;
  if (ans === 'export' && !dmExport()) { toast('Couldn’t save the export, so nothing was deleted'); return; }
  const k = st.cat === 'diary' ? deleteDiaryMonths(st.sel) : deleteBodyMonths(st.sel);
  st.sel = []; render();
  toast(`${ans === 'export' ? 'Exported to Downloads and deleted' : 'Deleted'} ${k} ${st.cat === 'diary' ? `day${k === 1 ? '' : 's'}` : `record${k === 1 ? '' : 's'}`}`);
}

// Range picker shared by export and import. dates: the days available, sorted.
function rangeState(dates) {
  const last = dates[dates.length - 1] || todayISO(), first = dates[0] || last;
  return { kind: 'all', day: last, month: last.slice(0, 7), year: last.slice(0, 4), from: first, to: last };
}
function resolveRange(st) {
  if (st.kind === 'day') return { from: st.day, to: st.day };
  if (st.kind === 'month') return { from: st.month + '-01', to: st.month + '-31' };
  if (st.kind === 'year') return { from: st.year + '-01-01', to: st.year + '-12-31' };
  if (st.kind === 'range') return st.from <= st.to ? { from: st.from, to: st.to } : { from: st.to, to: st.from };
  return null;
}
function rangeFields(st, dates) {
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))].reverse();
  const years = [...new Set(dates.map((d) => d.slice(0, 4)))].reverse();
  const min = dates[0] || '', max = dates[dates.length - 1] || '';
  let field = '';
  if (st.kind === 'day') field = `<label class="field">Day<input class="input" type="date" data-rf="day" value="${st.day}" min="${min}" max="${max}"></label>`;
  if (st.kind === 'month') field = `<label class="field">Month<select class="input" data-rf="month">${months.map((m) => `<option value="${m}" ${m === st.month ? 'selected' : ''}>${monthName(m)}</option>`).join('')}</select></label>`;
  if (st.kind === 'year') field = `<label class="field">Year<select class="input" data-rf="year">${years.map((y) => `<option ${y === st.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>`;
  if (st.kind === 'range') field = `<div class="row" style="gap:10px"><label class="field" style="flex:1">From<input class="input" type="date" data-rf="from" value="${st.from}" min="${min}" max="${max}"></label><label class="field" style="flex:1">To<input class="input" type="date" data-rf="to" value="${st.to}" min="${min}" max="${max}"></label></div>`;
  return `<div class="chips" role="group" aria-label="What to include">${RANGE_KINDS.map(([k, l]) => `<button type="button" class="chip" data-rk="${k}" aria-pressed="${st.kind === k}">${l}</button>`).join('')}</div>${field ? `<div class="mt12">${field}</div>` : ''}`;
}
function dataSheet(id, build, onAction) {
  document.getElementById(id)?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = id;
  const paint = () => { scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${build()}</div>`; };
  paint();
  scrim.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target === scrim || e.target.closest('[data-ds=close]')) { scrim.remove(); return; }
    onAction(e, paint, () => scrim.remove());
  });
  scrim.addEventListener('change', (e) => { e.stopPropagation(); onAction(e, paint, () => scrim.remove()); });
  document.body.appendChild(scrim);
}
function rangeEvent(e, st) {
  const k = e.target.closest('[data-rk]');
  if (k && e.type === 'click') { st.kind = k.dataset.rk; return true; }
  const f = e.target.closest('[data-rf]');
  if (f && e.type === 'change' && f.value) { st[f.dataset.rf] = f.value; return true; }
  return false;
}
const rangeLabel = (r, st) => (!r ? 'everything' : st?.kind === 'month' ? monthName(st.month) : st?.kind === 'year' ? st.year : r.from === r.to ? longDate(r.from) : `${shortDay(r.from)} – ${shortDay(r.to)}`);
const shortDay = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function saveText(name, text) {
  if (NATIVE && window.AndroidBridge.saveFile) return window.AndroidBridge.saveFile(name, text);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

function openExport() {
  const dates = Object.keys(store.log()).filter((d) => store.log()[d].length).sort();
  const st = rangeState(dates);
  dataSheet('export-scrim', () => {
    const r = resolveRange(st);
    const data = exportData(r);
    const n = Object.values(data.log).filter((l) => l.length).length;
    return `<div class="handle"></div>
      <div class="spread"><h2 class="h2" style="margin:0">Export</h2><button class="icon-btn ghost" data-ds="close" aria-label="Close">${I.close}</button></div>
      <p class="s13 muted" style="margin:6px 0 14px">Saves a file to Downloads that you can import later or keep as a copy.</p>
      ${rangeFields(st, dates)}
      <p class="s13 mt16" style="margin-bottom:12px">${n} day${n === 1 ? '' : 's'} logged · ${Object.keys(data.foods).length} food${Object.keys(data.foods).length === 1 ? '' : 's'} · ${Object.keys(data.weights).length} weigh-in${Object.keys(data.weights).length === 1 ? '' : 's'}${r ? '' : ' · settings and targets'}</p>
      <button class="btn primary block" data-ds="go" ${n || !r ? '' : 'disabled'}>Export ${rangeLabel(r, st)}</button>`;
  }, (e, paint, close) => {
    if (rangeEvent(e, st)) { paint(); return; }
    if (e.type === 'click' && e.target.closest('[data-ds=go]')) {
      const r = resolveRange(st);
      const tag = !r ? todayISO() : st.kind === 'day' ? st.day : st.kind === 'month' ? st.month : st.kind === 'year' ? st.year : `${r.from}_to_${r.to}`;
      const ok = saveText(`spectra-${tag}.json`, JSON.stringify(exportData(r)));
      close(); toast(ok ? 'Saved to Downloads' : 'Could not save the file');
    }
  });
}

function startImport() {
  if (NATIVE && window.AndroidBridge.pickFile) { window.AndroidBridge.pickFile(); return; }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => { const f = inp.files[0]; if (f) window.__onImportFile(await f.text(), f.name); };
  inp.click();
}
window.__onImportFile = (text, name = 'backup') => {
  if (text == null) return;
  let data;
  try { data = JSON.parse(text); } catch { toast('That file isn’t a Spectra backup'); return; }
  if (!data || typeof data.log !== 'object' || !data.log) { toast('That file isn’t a Spectra backup'); return; }
  const dates = Object.keys(data.log).filter((d) => (data.log[d] || []).length).sort();
  if (!dates.length) { toast('That backup has no logged days'); return; }
  const st = rangeState(dates);
  let mode = 'keep';
  dataSheet('import-scrim', () => {
    const r = resolveRange(st);
    const pv = importPreview(data, r, mode);
    const what = !pv.days ? 'No logged days in that range.'
      : mode === 'keep' ? `Adds ${pv.add} day${pv.add === 1 ? '' : 's'}${pv.clash ? `, skips ${pv.clash} you already have` : ''}.`
      : `Brings in ${pv.days} day${pv.days === 1 ? '' : 's'}${pv.clash ? `, replacing ${pv.clash} you already have` : ''}.`;
    return `<div class="handle"></div>
      <div class="spread"><h2 class="h2" style="margin:0">Import</h2><button class="icon-btn ghost" data-ds="close" aria-label="Close">${I.close}</button></div>
      <p class="s13 muted" style="margin:6px 0 14px">${esc(name)} · ${shortDay(dates[0])} – ${shortDay(dates[dates.length - 1])} · ${dates.length} day${dates.length === 1 ? '' : 's'} · ${Object.keys(data.foods || {}).length} food${Object.keys(data.foods || {}).length === 1 ? '' : 's'}</p>
      <span class="s13 muted">What to bring in</span><div class="mt8">${rangeFields(st, dates)}</div>
      <span class="s13 muted" style="display:block;margin-top:16px">If a day already has entries</span>
      <div class="chips mt8" role="group"><button type="button" class="chip" data-mode="keep" aria-pressed="${mode === 'keep'}">Keep mine, add missing</button><button type="button" class="chip" data-mode="replace" aria-pressed="${mode === 'replace'}">Replace with backup</button></div>
      <p class="s13 mt16" style="margin-bottom:12px;line-height:1.45">${what} Foods those days use come along; foods you already have aren’t changed.</p>
      <button class="btn primary block" data-ds="go" ${pv.changed ? '' : 'disabled'}>Import ${pv.changed} day${pv.changed === 1 ? '' : 's'}</button>`;
  }, (e, paint, close) => {
    if (rangeEvent(e, st)) { paint(); return; }
    const m = e.type === 'click' && e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; paint(); return; }
    if (e.type === 'click' && e.target.closest('[data-ds=go]')) {
      const res = importData(data, resolveRange(st), mode);
      close(); render(); toast(res.ok ? `Imported ${res.days} day${res.days === 1 ? '' : 's'}` : 'Import failed: not enough space');
    }
  });
};
window.addEventListener('nt-storage-error', () => toast('Couldn’t save: storage is full'));

// A one-field sheet for typing a short name. Resolves to the trimmed text, or null if cancelled.
function askText({ title, label, value = '', placeholder = '', action = 'Save' }) {
  return new Promise((resolve) => {
    document.getElementById('text-scrim')?.remove();
    const scrim = document.createElement('div');
    scrim.className = 'scrim'; scrim.id = 'text-scrim';
    scrim.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="text-title"><div class="handle"></div>
      <h2 class="h2" id="text-title" style="margin:0 0 14px">${esc(title)}</h2>
      <label class="field">${esc(label)}<input class="input" id="text-val" maxlength="30" autocomplete="off" enterkeyhint="done" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
      <div class="row mt16" style="gap:10px"><button type="button" class="btn quiet" style="flex:1" data-text="no">Cancel</button><button type="submit" class="btn primary" style="flex:1" data-text="yes">${esc(action)}</button></div>
    </form>`;
    const input = () => scrim.querySelector('#text-val');
    const done = (v) => { scrim.remove(); resolve(v); };
    const ok = () => { const v = input().value.trim().replace(/\s+/g, ' '); if (v) done(v); else input().focus(); };
    scrim.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-text]')) e.preventDefault(); });
    scrim.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-text]');
      if (b?.dataset.text === 'no' || e.target === scrim) done(null);
      else if (b?.dataset.text === 'yes') { e.preventDefault(); ok(); }
    });
    scrim.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); e.stopPropagation(); ok(); });
    document.body.appendChild(scrim);
    setTimeout(() => input().focus(), 50);
  });
}

// Pick the icon for a food when its name doesn't say what kind of food it is.
function openKindPicker(food) {
  if (!food) return;
  document.getElementById('kind-scrim')?.remove();
  const cur = foodKind(food);
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = 'kind-scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="kind-title"><div class="handle"></div>
    <div class="spread"><h2 class="h2" id="kind-title" style="margin:0">Food type</h2><button class="icon-btn ghost" data-act="kind-close" aria-label="Close">${I.close}</button></div>
    <p class="s13 muted" style="margin:6px 0 14px;line-height:1.45">Sets the icon for ${esc(food.name)}.${food.kind ? '' : ' Picked from its name.'}</p>
    <div class="kind-grid">${FOOD_KINDS.map((k) => `<button class="kind-opt" data-act="kind-set" data-id="${esc(food.id)}" data-kind="${k.kind}" aria-pressed="${k.kind === cur}">${foodTile({ kind: k.kind }, 48)}<span>${k.label}</span></button>`).join('')}</div>
    ${food.kind ? `<button class="btn quiet block mt16" data-act="kind-set" data-id="${esc(food.id)}" data-kind="">Pick from the name again</button>` : ''}
  </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-act=kind-close]')) scrim.remove(); });
}

// Breakdown of calories burned, opened by tapping "Burned" on the Diary.
function openBurned(date) {
  const entries = store.day(date);
  const eaten = totals(entries).energy?.v || 0;
  const en = dayEnergy(date, eaten);
  if (!en.ready) return;
  const p = store.profile();
  const acts = store.activities(date);
  const parts = [
    { label: 'Resting (BMR)', v: en.bmr, color: 'var(--text-2)' },
    { label: `Daily activity · ${activityName(p)}`, v: en.baseline, color: 'var(--sky)' },
    { label: 'Workouts', v: en.activities, color: 'var(--lilac)' },
    ...(en.tef ? [{ label: 'Digestion', v: en.tef, color: 'var(--wheat)' }] : [])
  ];
  document.getElementById('burn-scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = 'burn-scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="burn-title"><div class="handle"></div>
    <div class="spread"><h2 class="h2" id="burn-title">Calories burned</h2><button class="icon-btn ghost" data-act="burn-close" aria-label="Close">${I.close}</button></div>
    <div class="row mt12" style="gap:8px;align-items:baseline"><span style="font-size:44px;font-weight:300;letter-spacing:-.03em;line-height:1">${fmt(Math.round(en.burned))}</span><span class="s15 muted">kcal ${date === todayISO() ? 'today' : 'on ' + longDate(date)}</span></div>
    <div class="stack mt16" style="height:10px;border-radius:5px" aria-hidden="true">${parts.filter((x) => x.v > 0).map((x) => `<span style="flex:${x.v};background:${x.color}"></span>`).join('')}</div>
    <div class="list mt12">${parts.map((x) => `<div class="spread s14" style="padding:12px 0"><span class="row" style="gap:10px"><span class="dot" style="background:${x.color};width:8px;height:8px"></span>${esc(x.label)}</span><span class="b6">${fmt(Math.round(x.v))}</span></div>`).join('')}
      ${acts.map((a) => `<div class="spread small muted" style="padding:6px 0 6px 18px;border:none"><span>${esc(a.name)}${a.minutes ? ' · ' + fmt(Number(a.minutes)) + ' min' : ''}</span><span>${fmt(Math.round(Number(a.kcal) || 0))}</span></div>`).join('')}
    </div>
    <div class="spread mt12" style="padding:14px;border-radius:16px;background:var(--fill)"><span class="s14">${en.balance > 0 ? 'Surplus' : 'Deficit'} after ${fmt(Math.round(eaten))} kcal eaten</span><span class="s15 b6">${en.balance > 0 ? '+' : '−'}${fmt(Math.abs(Math.round(en.balance)))}</span></div>
    <a href="#/settings" class="btn quiet block mt12" data-act="burn-close" style="font-weight:600">Edit profile and activity level</a>
  </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
}


/* ---------------- Calendar ---------------- */

function openCalendar(date) {
  ui.cal = { selected: date, month: date.slice(0, 7) };
  document.getElementById('cal-scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = 'cal-scrim';
  scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="cal-title" id="cal-sheet"></div>';
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  renderCalendar();
}

function renderCalendar() {
  const box = document.getElementById('cal-sheet');
  if (!box || !ui.cal) return;
  const { selected, month } = ui.cal;
  const today = todayISO();
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday, like the week strip
  const log = store.log();
  const acts = store.allActivities();
  const iso = (d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const isCurrentMonth = month === today.slice(0, 7);
  const prevMonth = new Date(y, m - 2, 1), nextMonth = new Date(y, m, 1);
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const day = iso(d);
    const future = day > today;
    const sel = day === selected;
    const isToday = day === today;
    const logged = (log[day] || []).length > 0 || (acts[day] || []).length > 0;
    const style = `height:44px;border-radius:14px;border:${isToday && !sel ? '1.5px solid var(--lilac)' : '1.5px solid transparent'};background:${sel ? 'var(--lilac)' : 'transparent'};color:${sel ? 'var(--on-accent)' : future ? 'var(--text-4)' : 'var(--text)'};font:inherit;font-size:15px;font-weight:${sel || isToday ? 700 : 500};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:${future ? 'default' : 'pointer'}`;
    const dot = `<span style="width:4px;height:4px;border-radius:2px;background:${logged ? (sel ? 'var(--on-accent)' : 'var(--lilac)') : 'transparent'}"></span>`;
    cells.push(future
      ? `<span style="${style}" aria-disabled="true">${d}${dot}</span>`
      : `<button data-act="cal-pick" data-d="${day}" style="${style}" aria-label="${new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${logged ? ', has entries' : ''}" ${sel ? 'aria-current="date"' : ''}>${d}${dot}</button>`);
  }
  box.innerHTML = `<div class="handle"></div>
    <div class="spread">
      <button class="icon-btn" data-act="cal-month" data-m="${ym(prevMonth)}" aria-label="Previous month">${I.back}</button>
      <h2 class="h2" id="cal-title" aria-live="polite">${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
      <button class="icon-btn" data-act="cal-month" data-m="${ym(nextMonth)}" aria-label="Next month" ${isCurrentMonth ? 'disabled style="opacity:.3"' : ''}>${I.next}</button>
    </div>
    <div class="mt16" style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;text-align:center" aria-hidden="true">
      ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="small faint" style="padding-bottom:6px">${d}</span>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px">${cells.join('')}</div>
    <div class="row mt16">
      <button class="btn quiet" style="flex:1" data-act="cal-close">Cancel</button>
      <button class="btn primary" style="flex:1" data-act="cal-pick" data-d="${today}" ${selected === today ? 'disabled' : ''}>Go to today</button>
    </div>`;
}


/* ---------------- Nutrient detail ---------------- */

function renderNutrient(key, date) {
  const n = BY_KEY[key];
  if (!n) { view().innerHTML = `<div class="screen mt24"><div class="err">Unknown nutrient.</div></div>`; return; }
  const info = INFO[key] || {};
  const p = store.profile();
  const tot = totals(store.day(date))[key];
  const v = tot?.v || 0;
  const isMacro = MACRO_KEYS.includes(key);
  const dri = isMacro ? null : store.dri(key);
  const customOn = !isMacro && store.customOn(key);
  const target = store.target(key);
  const ul = isMacro ? null : ulFor(key, p);
  const isLimit = !!n.limit;
  const refLabel = isMacro ? 'Your target' : customOn ? 'Custom target' : dri ? (dri.name || DRI_NAME[dri.type] || dri.type) : null;
  const refShort = isMacro ? 'Target' : customOn ? 'Target' : dri ? (dri.type === 'Limit' ? 'Limit' : dri.type) : null;
  const who = describePerson(p);

  // Range bar: 0 → recommended → upper limit, red past the limit.
  const max = Math.max(ul ? ul.value * 1.15 : (target || 1) * 1.6, v * 1.08, target || 1);
  const at = (x) => Math.max(0, Math.min(100, (x / max) * 100));
  const upTo = isLimit && !ul ? target : null;
  const segs = upTo
    ? [{ from: 0, to: upTo, c: 'var(--lilac)' }, { from: upTo, to: max, c: 'var(--rose)' }]
    : ul
      ? [{ from: 0, to: target || 0, c: 'var(--fill-2)' }, { from: target || 0, to: ul.value, c: 'var(--lilac)' }, { from: ul.value, to: max, c: 'var(--rose)' }]
      : [{ from: 0, to: target || 0, c: 'var(--fill-2)' }, { from: target || 0, to: max, c: 'var(--lilac)' }];
  const ticks = [{ x: 0, l: '0' }, ...(target ? [{ x: target, l: refShort }] : []), ...(ul ? [{ x: ul.value, l: ul.short }] : [])];
  const pct = target ? Math.round((v / target) * 100) : null;
  const over = (ul && v > ul.value) || (upTo && v > upTo);
  const status = over ? (ul ? `Above the ${ul.short}` : 'Over the limit') : !target ? '' : v >= target ? (isLimit ? 'At the limit' : 'Target met') : `${fmt(target - v, n.unit)} to go`;
  const statusColor = over ? 'var(--rose)' : target && v >= target && !isLimit ? 'var(--lilac)' : 'var(--text-2)';
  const contributors = (tot?.foods || []).filter((f) => f.v > 0);
  const row = (label, value, bold = false) => `<div class="spread s14" style="padding:12px 0;gap:12px"><span class="${bold ? 'b6' : ''}" style="flex:1">${label}</span><span class="${bold ? 'b6' : ''}" style="white-space:nowrap">${value}</span></div>`;

  view().innerHTML = `
  <header class="top">
    <button class="icon-btn" data-act="back" aria-label="Back">${I.back}</button>
    <div class="title"><h1 style="margin:0;font-size:17px" class="b6">${esc(n.name)}</h1><span class="small muted">${dayTitle(date)} · ${longDate(date)}</span></div>
    <span style="width:44px"></span>
  </header>

  <section class="screen mt16"><div class="card pad">
    <div class="spread" style="align-items:flex-end">
      <div class="col" style="gap:2px"><span class="s13 muted">Consumed</span>
        <span class="row" style="gap:6px;align-items:baseline"><span style="font-size:44px;font-weight:300;letter-spacing:-.03em;line-height:1">${fmt(v)}</span><span class="s15 muted">${n.unit}</span></span></div>
      ${pct != null ? `<div class="col" style="align-items:flex-end;gap:2px"><span style="font-size:22px;font-weight:600">${pct}%</span><span class="small" style="color:${statusColor}">${status}</span></div>` : ''}
    </div>
    <p class="s13 muted" style="margin:12px 0 0;line-height:1.5">${isMacro ? 'Compared to the target you set in Targets.' : customOn ? 'Compared to your custom target.' : dri ? `Compared to the Dietary Reference Intakes for ${who}. <a href="#/settings" style="color:var(--lilac);font-weight:600">${p.age ? 'Change' : 'Set your age and sex'}</a>` : 'No recommended daily intake has been set for this nutrient.'}</p>
    ${!isMacro && p.age && Number(p.age) < 14 ? `<p class="small" style="margin:8px 0 0;line-height:1.5;color:var(--wheat)">These values are for ages 14 and up. Children’s needs are different, so check with a doctor or dietitian.</p>` : ''}
    ${target || ul ? `<div style="position:relative;margin:34px 0 28px" role="img" aria-label="${esc(n.name)}: ${fmt(v)} ${n.unit}${target ? ', ' + refShort + ' ' + fmt(target) : ''}${ul ? ', ' + ul.short + ' ' + fmt(ul.value) : ''}">
      <span style="position:absolute;left:${at(v)}%;top:-18px;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:10px solid var(--text)"></span>
      <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px">${segs.filter((g) => g.to > g.from).map((g) => `<span style="flex:${g.to - g.from};background:${g.c}"></span>`).join('')}</div>
      ${ticks.map((t) => `<span class="small muted" style="position:absolute;top:16px;left:${at(t.x)}%;transform:translateX(${t.x === 0 ? '0' : at(t.x) > 88 ? '-100%' : '-50%'});white-space:nowrap">${t.l}</span>`).join('')}
    </div>` : ''}
    <div class="list" style="background:var(--fill);border-radius:16px;padding:0 14px;${target || ul ? '' : 'margin-top:16px'}">
      ${row('Consumed', fmt(v, n.unit), true)}
      ${refLabel && target ? row(esc(refLabel), fmt(target, n.unit)) : ''}
      ${customOn && dri ? row(`<span class="muted">${esc(DRI_NAME[dri.type] || dri.type)}</span>`, `<span class="muted">${fmt(dri.value, n.unit)}</span>`) : ''}
      ${ul ? row(esc(ul.name), fmt(ul.value, n.unit)) : isMacro ? '' : row('Tolerable Upper Intake Level (UL)', '<span class="muted">None set</span>')}
    </div>
    ${!isMacro && !ul ? `<p class="small muted" style="margin:10px 2px 0;line-height:1.5">No upper limit has been set for ${esc(n.name.toLowerCase())}. There isn’t enough evidence of harm from high intakes to set one, which doesn’t mean any amount is safe.</p>` : ''}
    ${info.ulNote && ul ? `<p class="small muted" style="margin:10px 2px 0;line-height:1.5">${esc(info.ulNote)}</p>` : ''}
    ${dri?.note ? `<p class="small muted" style="margin:10px 2px 0;line-height:1.5">${esc(dri.note)}</p>` : ''}
    ${dri && ul && dri.value > ul.value && !customOn ? `<p class="small" style="margin:10px 2px 0;line-height:1.5;color:var(--wheat)">Your recommended amount is above the upper limit. The limit mostly reflects side effects from supplements, so follow your doctor’s advice on how much to take.</p>` : ''}
    ${dri?.adjustedNote && !customOn ? `<p class="small" style="margin:10px 2px 0;line-height:1.5;color:var(--lilac)">${esc(dri.adjustedNote)}</p>` : ''}
    ${dri?.perWeight ? `<p class="small muted" style="margin:10px 2px 0;line-height:1.5">Based on your weight of ${fmt(store.weightOn(todayISO()).lbs)} lb.</p>` : ''}
    ${tot?.estShare > 0.3 ? `<p class="small" style="margin:10px 2px 0;line-height:1.5;color:var(--wheat)">${Math.round(tot.estShare * 100)}% of this day’s amount is estimated.</p>` : ''}

    ${isMacro
      ? `<a href="#/settings" class="btn quiet block mt16" style="height:46px;font-size:14px">Edit in Targets</a>`
      : `<label class="spread mt16" style="gap:12px;cursor:pointer"><span class="s14">Use a custom target instead</span>
          <span class="switch"><input type="checkbox" data-act="custom-toggle" data-k="${key}" ${customOn ? 'checked' : ''}><span aria-hidden="true"></span></span></label>
        ${customOn ? `<form class="row mt12" data-form="nut-target" data-k="${key}">
          <label for="nut-target-in" class="s14 muted" style="flex:1">Custom target</label>
          <input class="input" id="nut-target-in" type="number" inputmode="decimal" step="any" value="${target ?? ''}" style="width:100px;text-align:center;font-weight:600">
          <span class="small muted" style="width:28px">${n.unit}</span></form>` : ''}`}
  </div></section>

  ${contributors.length ? `<section class="screen mt24"><h2 class="h2">Where it came from</h2>
    <div class="card list mt12" style="padding:4px 20px">${contributors.map((f) => `
      <div class="col" style="gap:8px;padding:12px 0">
        <div class="spread s14"><span class="ellipsis" style="flex:1">${esc(f.name)}</span><span class="b6" style="white-space:nowrap">${fmt(f.v, n.unit)}</span></div>
        <div class="bar" aria-hidden="true"><span style="width:${v ? Math.round((f.v / v) * 100) : 0}%;background:var(--lilac)"></span></div>
      </div>`).join('')}</div></section>` : ''}

  ${info.fn ? `<section class="screen mt24"><h2 class="h2">What it does</h2><div class="card pad mt12"><p class="s15" style="margin:0;line-height:1.6;color:#CFD5D1">${esc(info.fn)}</p></div></section>` : ''}
  ${info.src ? `<section class="screen mt24"><h2 class="h2">Good sources</h2><div class="card pad mt12"><p class="s15" style="margin:0;line-height:1.6;color:#CFD5D1">${esc(info.src)}</p></div></section>` : ''}
  <p class="small faint screen mt16" style="line-height:1.5">Recommended amounts and upper limits are the U.S. Dietary Reference Intakes. This is general information, not medical advice.</p>`;
}

/* ---------------- Activities ---------------- */

const I_RUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2v5M6 12l3-3h4l3 3 3 1M11 15l-1-4"/></svg>';

function activitiesCard(date) {
  const list = store.activities(date);
  return `<div class="spread" style="padding:26px 20px 12px;align-items:baseline">
    <h2 class="h2" style="font-size:20px">Activities</h2>
  </div>
  <section class="screen"><div class="card">
    ${list.length ? `<div class="list" style="padding:0 18px">${list.map((a) => `
      <button class="item" data-act="act-edit" data-id="${a.id}" data-date="${date}" style="padding:14px 0">
        <span style="width:36px;height:36px;border-radius:12px;background:var(--lilac-t);color:var(--lilac);display:flex;align-items:center;justify-content:center;flex:none">${I_RUN}</span>
        <span class="col" style="flex:1;min-width:0;gap:2px"><span class="s15 ellipsis" style="font-weight:500">${esc(a.name)}</span><span class="small muted">${a.minutes ? fmt(Number(a.minutes)) + ' min · ' : ''}${timeLabel(a.ts)}</span></span>
        <span class="s15 b6">${fmt(Math.round(Number(a.kcal) || 0))} <span class="small muted" style="font-weight:400">kcal</span></span>
      </button>`).join('')}</div>` : ''}
    <button class="item" data-act="act-new" data-date="${date}" style="padding:14px 18px;${list.length ? 'border-top:1px solid var(--line)' : ''}">
      <span style="width:36px;height:36px;border-radius:12px;background:var(--fill);display:flex;align-items:center;justify-content:center;flex:none">${I.plus}</span>
      <span class="s15 muted" style="flex:1">${list.length ? 'Add another activity' : 'Log a workout or activity'}</span>
    </button>
  </div></section>`;
}

function openActivity(date, id) {
  const existing = id ? store.activities(date).find((a) => a.id === id) : null;
  ui.act = existing
    ? { date, id, name: existing.name, met: existing.met ?? null, minutes: existing.minutes ?? '', kcal: existing.kcal ?? '', kcalEdited: true, time: hhmm(existing.ts) }
    : { date, id: null, name: '', met: null, minutes: 30, kcal: '', kcalEdited: false, time: hhmm(Date.now()) };
  document.getElementById('act-scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim'; scrim.id = 'act-scrim';
  scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="act-title" id="act-sheet"></div>';
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closeActivity(); });
  renderActivity();
}
function closeActivity() { document.getElementById('act-scrim')?.remove(); ui.act = null; }

function renderActivity() {
  const a = ui.act;
  const box = document.getElementById('act-sheet');
  if (!a || !box) return;
  const auto = activityKcal(a.met, Number(a.minutes), a.date);
  if (!a.kcalEdited && auto != null) a.kcal = auto;
  const noWeight = !store.weightOn(a.date);
  box.innerHTML = `<div class="handle"></div>
    <div class="spread"><h2 class="h2" id="act-title">${a.id ? 'Edit activity' : 'Log activity'}</h2><button class="icon-btn ghost" data-act="act-close" aria-label="Close">${I.close}</button></div>
    <div class="chips scroll mt16" id="chips-act" role="group" aria-label="Activity type">${ACTIVITY_TYPES.map((t) => `<button class="chip" data-act="act-type" data-name="${esc(t.name)}" aria-pressed="${a.name === t.name}">${esc(t.name)}</button>`).join('')}</div>
    <label class="field mt16">Name<input class="input" data-act-field="name" value="${esc(a.name)}" placeholder="e.g. Morning run"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px" class="mt12">
      <label class="field">Minutes<input class="input" type="number" inputmode="numeric" data-act-field="minutes" value="${esc(a.minutes)}"></label>
      <label class="field">Calories<input class="input" type="number" inputmode="numeric" data-act-field="kcal" value="${a.kcal === '' ? '' : Math.round(a.kcal)}" placeholder="kcal"></label>
      <label class="field">Time<input class="input" type="time" data-act-field="time" value="${a.time}"></label>
    </div>
    <p class="small muted" style="margin:10px 0 0;line-height:1.45">${a.met && !noWeight ? `Calories are worked out from the activity, how long, and your weight. Edit them if your watch or machine says otherwise.` : a.met && noWeight ? 'Log your weight in Targets to calculate calories automatically.' : 'Enter the calories from your watch or machine.'}</p>
    <div class="row mt16">${a.id ? `<button class="btn quiet" style="flex:1;color:var(--rose)" data-act="act-delete">Delete</button>` : ''}<button class="btn primary" style="flex:2" data-act="act-save">${a.id ? 'Save' : 'Add activity'}</button></div>`;
}

/* ---------------- Paste nutrient info ---------------- */

function pasteBases(food) {
  return [...(food.servings || []).filter((x) => x.grams > 0 && !isPlaceholderServing(x)).map((x) => ({ label: x.label, grams: x.grams })), { label: '100 g', grams: 100 }];
}

function openPaste(food) {
  ui.paste = { foodId: food.id, text: '', basis: food.servings?.find((x) => x.grams > 0 && !isPlaceholderServing(x))?.grams || 100, result: null, busy: false, error: '', replaceLabel: store.settings().pasteOverLabel !== false };
  document.querySelector('.scrim')?.remove();
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.id = 'paste-scrim';
  scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="paste-title" id="paste-sheet"></div>';
  document.body.appendChild(scrim);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) closePaste(); });
  renderPaste();
}

function closePaste() { document.getElementById('paste-scrim')?.remove(); ui.paste = null; }

function pastePlan() {
  const p = ui.paste;
  const food = store.food(p.foodId);
  if (!p.result) return null;
  const scale = 100 / p.basis;
  const rows = Object.entries(p.result.nutrients).filter(([k]) => BY_KEY[k]).map(([k, v]) => {
    const old = food.per100[k];
    const per100 = v * scale;
    const comp = (p.result.comparable || []).includes(k);
    const lab = !comp && (p.result.lab || []).includes(k);
    let action = 'new';
    if (old) {
      if (comp) action = old.src === 'est' ? 'replace' : 'keep';
      else if (lab) action = old.src === 'est' || old.src === 'lab' ? 'replace' : 'keep';
      else action = old.src === 'label' && !p.replaceLabel ? 'keep' : old.src === 'spec' ? 'update' : 'replace';
    }
    return { k, n: BY_KEY[k], v, per100, old, action, comp, lab };
  }).sort((a, b) => NUTRIENTS.indexOf(a.n) - NUTRIENTS.indexOf(b.n));
  const labelP = food.per100.protein?.v;
  const pasted = p.result.nutrients.protein != null ? p.result.nutrients.protein * scale : null;
  const mismatch = labelP > 1 && pasted != null && (pasted / labelP < 0.85 || pasted / labelP > 1.15);
  // Does the answer name a different product than this food? (e.g. a protein powder's answer pasted into sunflower seeds)
  const named = (p.text.match(/^[\s*_#-]*product\s*:\s*(.+)$/im)?.[1] || p.text.match(/breakdown(?:\s*:|\s+for)\s+(.+?)(?:\s+\(|\s+based|\.|$)/im)?.[1] || '').replace(/[*_#]/g, '').trim();
  const words = (x) => new Set(x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4));
  const fw = words(`${food.brand || ''} ${food.name}`), nw = words(named);
  const otherProduct = named && !food.unidentified && nw.size && fw.size && ![...nw].some((w) => fw.has(w)) ? named : '';
  return { food, rows, mismatch, labelP, pasted, otherProduct };
}

function renderPaste() {
  const box = document.getElementById('paste-sheet');
  const p = ui.paste;
  if (!box || !p) return;
  const food = store.food(p.foodId);
  const plan = pastePlan();
  const bases = pasteBases(food);
  const applyN = plan ? plan.rows.filter((r) => r.action !== 'keep').length : 0;
  const word = { new: 'New', replace: 'Replaces est.', update: 'Updates', keep: 'Kept' };
  box.innerHTML = `<div class="handle"></div>
    <div class="spread"><h2 class="h2" id="paste-title">Paste nutrient info</h2><button class="icon-btn ghost" data-act="paste-close" aria-label="Close">${I.close}</button></div>
    <p class="s13 muted" style="margin:6px 0 14px;line-height:1.5">Paste what Gemini or the spec sheet says for ${esc(food.name)}. Lists, tables and paragraphs all work.</p>
    ${!plan ? `
      <label class="sr-only" for="paste-text" style="position:absolute;left:-999px">Nutrient text</label>
      <textarea id="paste-text" class="input" style="height:200px;padding:12px 14px;resize:vertical;line-height:1.45" placeholder="Glycine: 2.3 g&#10;Proline: 1.3 g&#10;Vitamin D: 2 mcg">${esc(p.text)}</textarea>
      <button class="btn quiet block mt8" data-act="paste-clip" style="height:44px;font-size:14px;font-weight:600">Paste</button>
      <p class="small faint" style="margin:8px 0 0;line-height:1.45">Or in Gemini, tap <b>Share</b> on the answer and pick <b>Spectra</b>.</p>
      <div class="col mt16" style="gap:8px"><span class="s13 muted">Amounts are per</span>
        <div class="chips" role="group" aria-label="Amounts are per">${bases.map((b) => `<button class="chip" data-act="paste-basis" data-g="${b.grams}" aria-pressed="${b.grams === p.basis}">${esc(b.label)}${b.label !== '100 g' && !/\d\s*g\b/i.test(b.label) ? ' · ' + fmt(b.grams) + ' g' : ''}</button>`).join('')}<button class="chip" data-act="paste-serving-edit" style="color:var(--lilac)">${bases.length > 1 ? 'Other serving' : '+ Serving size'}</button></div>
        ${p.editServing ? `<div class="col serving-editor" style="gap:8px;padding:12px;background:var(--fill);border-radius:16px">
          <span class="s13 muted">Serving size from the label</span>
          ${servingFields('psv')}
          <button class="btn tint" data-act="paste-serving-save">Use this serving</button>
        </div>` : ''}
        <span class="small faint">If the text says, the app uses that instead.</span></div>
      ${p.error ? `<div class="err mt12">${esc(p.error)}</div>` : ''}
      <button class="btn primary block mt16" data-act="paste-read" ${p.busy ? 'disabled' : ''}>${p.busy ? 'Reading…' : 'Read nutrients'}</button>`
    : `
      ${plan.rows.some((r) => r.comp) ? `<p class="small muted" style="margin:0 0 10px;line-height:1.45">Values from a comparable product are saved as estimates (est.) and never replace label or spec-sheet values.</p>` : plan.rows.some((r) => r.lab) ? `<p class="small muted" style="margin:0 0 10px;line-height:1.45">Lab values come from a generic version of this food and never replace label or spec-sheet values.</p>` : ''}
      <div class="spread"><span class="s14 b6">${plan.rows.length} nutrients found</span><span class="s13 muted">per ${fmt(p.basis)} g · ${esc(p.result.method)}</span></div>
      ${plan.rows.some((r) => r.old?.src === 'label' && !r.comp && !r.lab) ? `<label class="spread mt12 s13" style="gap:12px;padding:12px 14px;background:var(--fill);border-radius:14px"><span style="line-height:1.4">Use these values over the saved label<br><span class="muted small">Label values from Open Food Facts or USDA get replaced. Comparable and lab values never replace them.</span></span><input type="checkbox" data-act="paste-label" ${p.replaceLabel ? 'checked' : ''} style="width:22px;height:22px;flex:none;accent-color:var(--lilac)"></label>` : ''}
      ${plan.otherProduct ? `<div class="err mt12">This answer is for <b>${esc(plan.otherProduct)}</b>, but you're filling in <b>${esc(plan.food.name)}</b>. Check you opened the right food.</div>` : ''}
      ${plan.mismatch && !plan.otherProduct ? (() => {
        const serving = (plan.food.servings || []).some((x) => Math.abs(x.grams - p.basis) < 0.5);
        const per = (v) => fmt(v * p.basis / 100);
        if (!serving) return `<div class="err mt12">Protein here works out to ${fmt(plan.pasted)} g per 100 g, but the saved label says ${fmt(plan.labelP)} g. Check that "amounts are per" is right before filling.</div>`;
        return `<div class="note mt12" style="padding:12px 14px;border-radius:14px;background:var(--fill);line-height:1.45" ><span class="s13">The pasted protein (${per(plan.pasted)} g per ${fmt(p.basis)} g) differs from the saved label (${per(plan.labelP)} g). ${p.replaceLabel ? 'The pasted values will replace the saved label.' : 'Switch on “Use these values over the saved label” to use the pasted numbers.'}</span></div>`;
      })() : ''}
      <div class="list mt12" style="max-height:44dvh;overflow:auto">${plan.rows.map((r) => `
        <div class="spread" style="padding:10px 0;opacity:${r.action === 'keep' ? 0.5 : 1}">
          <span class="s14 ellipsis" style="flex:1">${esc(r.n.name)}</span>
          ${r.comp ? '<span class="tag est">comparable</span>' : r.lab ? '<span class="tag">lab</span>' : ''}
          <span class="small" style="color:${r.action === 'new' ? 'var(--lilac)' : r.action === 'keep' ? 'var(--text-3)' : 'var(--wheat)'}">${r.action === 'replace' ? 'Replaces ' + ({ est: 'est.', lab: 'lab', label: 'label' }[r.old.src] || '') : word[r.action]}</span>
          <span class="s14 b6" style="min-width:76px;text-align:right">${fmt(r.v, r.n.unit)}</span></div>`).join('') || '<div class="empty">Nothing recognizable. Try including units, like "2.3 g".</div>'}</div>

      <div class="row mt16"><button class="btn quiet" style="flex:1" data-act="paste-back">Back</button><button class="btn primary" style="flex:2" data-act="paste-apply" ${applyN ? '' : 'disabled'}>Fill ${applyN} nutrient${applyN === 1 ? '' : 's'}</button></div>`}`;
}

async function readPaste() {
  const p = ui.paste;
  const ta = document.getElementById('paste-text');
  p.text = ta ? ta.value : p.text;
  if (!p.text.trim()) { p.error = 'Paste some text first.'; renderPaste(); return; }
  if (/^\s*https?:\/\/\S+\s*$/.test(p.text)) { p.error = 'That’s a link to the chat, not the answer. In Gemini, long-press the answer (or tap ⋮) and choose Copy, then paste here.'; renderPaste(); return; }
  let food = store.food(p.foodId);
  const hadServing = (food.servings || []).length;
  food = identifyFromText(food, p.text);
  const sv = food.servings?.[0];
  if (sv && (food.servings.length > hadServing) && !/per\s*100\s*g/i.test(p.text)) p.basis = sv.grams;
  p.busy = true; p.error = ''; renderPaste();
  const local = parseLocal(p.text);
  const result = { nutrients: local.nutrients, comparable: local.comparable, lab: local.lab, basis: detectBasis(p.text), url: firstUrl(p.text), method: 'read on device' };
  if (!result.url) result.url = firstUrl(p.text);
  p.textServing = /per\s*100\s*(g|grams)\b/i.test(p.text) ? null : servingFromText(p.text);
  if (result.basis) p.basis = result.basis;
  p.busy = false;
  if (!Object.keys(result.nutrients).length) { p.error = 'Couldn’t find any nutrient amounts. Make sure each has a number and unit, like "Glycine: 2.3 g".'; renderPaste(); return; }
  p.result = result;
  renderPaste();
}

function applyPaste() {
  const plan = pastePlan();
  if (!plan) return;
  const { food, rows } = plan;
  const p = ui.paste;
  const per100 = { ...food.per100 };
  let n = 0;
  for (const r of rows) {
    if (r.action === 'keep') continue;
    // A pasted value that replaces a label value is the label as Gemini read it.
    per100[r.k] = { v: r.per100, src: r.comp ? 'est' : r.lab ? 'lab' : r.old?.src === 'label' ? 'label' : 'spec' };
    n++;
  }
  // Recompute omega totals from their parts when the parts changed but the total wasn't pasted.
  const changed = new Set(rows.filter((r) => r.action !== 'keep').map((r) => r.k));
  if (['ala', 'epa', 'dha'].some((k) => changed.has(k)) && !changed.has('omega3')) delete per100.omega3;
  if (['la', 'aa'].some((k) => changed.has(k)) && !changed.has('omega6')) delete per100.omega6;
  deriveTotals(per100);
  const sources = (food.sources || []).filter((x) => x.title !== 'Pasted nutrient info');
  sources.push({ kind: 'spec', title: 'Pasted nutrient info', url: p.result.url || '', count: n, note: `Added by you, ${p.result.method}. Amounts were per ${fmt(p.basis)} g.` });
  // The answer's serving ("1 oz (28.35 g)") becomes a unit you can pick, if the food doesn't have it yet.
  let servings = food.servings || [];
  const ts = p.textServing;
  if (ts && Math.abs(ts.grams - p.basis) < 0.01 && !servings.some((x) => Math.abs(x.grams - ts.grams) < 0.5)) servings = [ts, ...servings.filter((x) => !isPlaceholderServing(x))];
  store.saveFood({ ...food, per100, sources, servings });
  if (ui.add?.foodId === food.id && servings[0] === ts) Object.assign(ui.add, { unitIdx: 0, qty: 1 });
  closePaste();
  render();
  toast(`Filled ${n} nutrient${n === 1 ? '' : 's'}`);
}

/* ---------------- events ---------------- */

// Insights charts: tapping a mark shows its numbers under the chart and highlights it.
document.addEventListener('click', (ev) => {
  const t = ev.target.closest?.('[data-tip]');
  if (!t) return;
  const card = t.closest('.ins-chart');
  const out = card?.querySelector('.ins-tip');
  if (!out) return;
  out.textContent = t.dataset.tip; out.classList.add('on');
  card.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  t.previousElementSibling?.classList.add('sel');
});
document.addEventListener('click', (ev) => {
  const hit = ev.target.closest?.('[data-trend-day]');
  if (!hit) return;
  const date = parseRoute().parts[0] || todayISO();
  const range = store.settings().trendRange === 'month' ? 'month' : 'week';
  const day = trendData(date, range)[Number(hit.dataset.trendDay)];
  const box = document.getElementById('trend-detail');
  if (day && box) box.innerHTML = trendDetail(day);
});

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) {
    if (ui.menu && !ev.target.closest('.menu') && !ev.target.closest('.sheet')) { ui.menu = null; render(); }
    return;
  }
  const act = el.dataset.act;
  const r = parseRoute();
  switch (act) {
    case 'toggle': ui.open[el.dataset.meal] = el.dataset.open !== 'true'; render(); break;
    case 'sum-tab': setSummaryPage(Number(el.dataset.i)); break;
    case 'trend-range': store.saveSettings({ trendRange: el.dataset.v }); render(); break;
    case 'meal-menu': ui.menu = ui.menu === el.dataset.meal ? null : el.dataset.meal; render(); break;
    case 'entry-menu': ui.menu = ui.menu === el.dataset.key ? null : el.dataset.key; render(); break;
    case 'entry-copy':
    case 'entry-again': {
      const from = el.dataset.date;
      const e = store.day(from).find((x) => x.id === el.dataset.eid);
      if (!e) break;
      const { id, order, ...rest } = e;
      if (act === 'entry-copy') {
        const to = from === todayISO() ? shiftDate(from, 1) : todayISO();
        const shift = new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime();
        // Keep its place in the meal: its position in the day's order, not its time.
        store.addEntry(to, { ...rest, ts: e.ts + shift, ...(order != null ? { order } : {}) }, { keepOrder: true });
        toast(`Copied to ${to === todayISO() ? 'today' : 'tomorrow'}`);
      } else {
        store.addEntry(from, { ...rest, ts: Date.now() });
        toast(`Added again to ${mealName(e.meal)}`);
      }
      ui.menu = null; ui.swiped = null; render();
      break;
    }
    case 'entry-remove': {
      const f = store.food(store.day(el.dataset.date).find((x) => x.id === el.dataset.eid)?.foodId);
      if (await askConfirm(`Remove ${f?.name || 'this food'} from your diary?`, 'Remove')) { store.removeEntry(el.dataset.date, el.dataset.eid); ui.menu = null; ui.swiped = null; render(); toast('Removed'); }
      break;
    }
    case 'copy-meal': {
      const from = el.dataset.date;
      const to = from === todayISO() ? shiftDate(from, 1) : todayISO();
      const n = store.copyMeal(from, el.dataset.meal, to);
      ui.menu = null; ui.swiped = null; render();
      toast(`Copied ${n} food${n === 1 ? '' : 's'} to ${to === todayISO() ? 'today' : 'tomorrow'}`);
      break;
    }
    case 'clear-meal':
      if (await askConfirm(`Remove everything from ${mealName(el.dataset.meal)}?`, 'Clear meal')) { store.clearMeal(el.dataset.date, el.dataset.meal); ui.menu = null; ui.swiped = null; render(); }
      break;
    case 'dm-toggle': { const k = el.dataset.k, i = ui.dm.sel.indexOf(k); if (i >= 0) ui.dm.sel.splice(i, 1); else ui.dm.sel.push(k); render(); break; }
    case 'dm-open': ui.dm.open[el.dataset.y] = el.getAttribute('aria-expanded') !== 'true'; render(); break;
    case 'dm-year': {
      const rows = (ui.dm.cat === 'diary' ? dataBreakdown().diary : dataBreakdown().body).filter((m) => m.month.startsWith(el.dataset.y)).map((m) => m.month);
      const all = rows.every((m) => ui.dm.sel.includes(m));
      ui.dm.sel = all ? ui.dm.sel.filter((m) => !rows.includes(m)) : [...new Set([...ui.dm.sel, ...rows])];
      render(); break;
    }
    case 'dm-pick': {
      const rows = (ui.dm.cat === 'diary' ? dataBreakdown().diary : dataBreakdown().body).map((m) => m.month);
      const yearAgo = addDays(todayISO(), -365).slice(0, 7);
      ui.dm.sel = el.dataset.v === 'all' ? rows : el.dataset.v === 'old' ? rows.filter((m) => m < yearAgo) : [];
      if (el.dataset.v === 'old') rows.filter((m) => m < yearAgo).forEach((m) => { ui.dm.open[m.slice(0, 4)] = true; });
      render(); break;
    }
    case 'dm-filter': ui.dm.filter = el.dataset.v; render(); break;
    case 'dm-all-unused': ui.dm.sel = dataBreakdown().foods.filter((f) => !f.uses).map((f) => f.id); render(); break;
    case 'dm-export': { const ok = dmExport(); toast(ok ? 'Saved to Downloads' : 'Could not save the file'); break; }
    case 'dm-delete': await dmDelete(); break;
    case 'ins-range': store.saveSettings({ insRange: el.dataset.v }); render(); break;
    case 'ins-all': ui.insAll = !ui.insAll; render(); break;
    case 'ins-jump': {
      const id = el.dataset.to;
      let t = document.getElementById(id);
      if (!t && id.startsWith('ins-n-') && !ui.insAll) { ui.insAll = true; render(); t = document.getElementById(id); }
      if (!t) t = document.getElementById(id.startsWith('ins-tip') ? 'ins-change' : id.startsWith('ins-n-') ? 'ins-nutrients' : 'ins-change');
      if (!t) break;
      t.scrollIntoView({ behavior: 'smooth', block: id.startsWith('ins-n-') || id.startsWith('ins-l-') ? 'center' : 'start' });
      document.querySelectorAll('.ins-flash').forEach((x) => x.classList.remove('ins-flash')); void t.offsetWidth; t.classList.add('ins-flash');
      break;
    }
    case 'meal-move': store.moveMeal(el.dataset.meal, Number(el.dataset.dir)); render(); break;
    case 'meal-add': {
      const name = await askText({ title: 'New meal', label: 'Meal name', placeholder: 'e.g. Pre-workout, Brunch, Late snack', action: 'Add meal' });
      if (!name) break;
      if (store.meals().some((m) => m.name.toLowerCase() === name.toLowerCase())) { toast(`You already have ${name}`); break; }
      const key = store.addMeal(name, el.dataset.after || null);
      ui.menu = null; ui.swiped = null; ui.open[(r.parts[0] || todayISO()) + key] = true; render();
      toast(`Added ${name}`);
      break;
    }
    case 'meal-rename': {
      const cur = mealName(el.dataset.meal);
      const name = await askText({ title: 'Rename meal', label: 'Meal name', value: cur, action: 'Save' });
      if (!name || name === cur) break;
      store.renameMeal(el.dataset.meal, name); ui.menu = null; ui.swiped = null; render();
      break;
    }
    case 'meal-delete': {
      const meals = store.meals();
      const i = meals.findIndex((m) => m.key === el.dataset.meal);
      if (i < 0 || meals.length < 2) break;
      const dest = meals[i > 0 ? i - 1 : 1];
      const use = store.mealUsage(el.dataset.meal);
      const msg = use.entries
        ? `Delete ${meals[i].name}? The ${use.entries} food${use.entries === 1 ? '' : 's'} logged in it${use.days > 1 ? ` across ${use.days} days` : ''} will move to ${dest.name}, so your totals stay the same.`
        : `Delete ${meals[i].name} from your diary?`;
      if (await askConfirm(msg, 'Delete meal')) { store.deleteMeal(el.dataset.meal, dest.key); ui.menu = null; ui.swiped = null; render(); toast(`Deleted ${meals[i].name}`); }
      break;
    }
    case 'report-group': ui.reportGroup = el.dataset.g; render(); break;
    case 'meal-group': ui.mealGroup = el.dataset.g; render(); break;
    case 'food-group': ui.foodGroup = el.dataset.g; render(); break;
    case 'row': ui.expandedRow = ui.expandedRow === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'back': history.length > 1 ? history.back() : go('#/'); break;
    case 'qty': ui.add.qty = Math.max(0, +(ui.add.qty + Number(el.dataset.d) * unitStep(unitsFor(store.food(ui.add.foodId))[ui.add.unitIdx])).toFixed(2)); render(); break;
    case 'baking': { const u = unitsFor(store.food(ui.add.foodId))[ui.add.unitIdx]; ui.add.baking = !(ui.add.baking ?? !!u?.volume); render(); break; }
    case 'kind-pick': openKindPicker(store.food(el.dataset.id)); break;
    case 'name-edit': ui.add.editName = true; render(); setTimeout(() => document.getElementById('nm-name')?.focus(), 50); break;
    case 'name-cancel': ui.add.editName = false; render(); break;
    case 'name-save': {
      const f = store.food(ui.add.foodId);
      const name = (document.getElementById('nm-name')?.value || '').trim();
      if (!name) { toast('Enter a name'); break; }
      store.saveFood({ ...f, name, brand: (document.getElementById('nm-brand')?.value || '').trim(), unidentified: false });
      ui.add.editName = false; render(); toast('Name saved');
      break;
    }
    case 'barcode-paste':
    case 'barcode-custom': {
      // A food for a barcode we couldn't find: paste Gemini's answer into it, or fill it in yourself.
      const food = barcodeFood(el.dataset.code);
      store.saveSettings({ askedFood: food.id });
      location.hash = `#/food/${encodeURIComponent(food.id)}?date=${ui.scan?.date || todayISO()}&meal=${ui.scan?.meal || mealForNow()}`;
      setTimeout(() => {
        if (act === 'barcode-paste') openPaste(store.food(food.id));
        else { ui.add.editName = true; ui.add.editServing = true; render(); setTimeout(() => document.getElementById('nm-name')?.focus(), 50); }
      }, 80);
      break;
    }
    case 'kind-set': {
      const f = store.food(el.dataset.id);
      if (!f) break;
      const { kind, ...rest } = f;
      store.saveFood(el.dataset.kind ? { ...rest, kind: el.dataset.kind } : rest);
      document.getElementById('kind-scrim')?.remove();
      render();
      break;
    }
    case 'sv-unit': {
      const pre = el.dataset.prefix, u = el.dataset.u, box = document.getElementById(pre + '-fields');
      if (!box) break;
      box.dataset.unit = u;
      box.querySelectorAll('[data-act=sv-unit]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.u === u)));
      document.getElementById(pre + '-unit-label').textContent = u;
      const weighs = !(u in SV_WEIGHT);
      document.getElementById(pre + '-wrow').hidden = !weighs;
      document.getElementById(pre + '-hint').hidden = !weighs;
      break;
    }
    case 'sv-baking': { const row = document.getElementById(el.dataset.prefix + '-baking'); if (row) { row.hidden = !row.hidden; el.setAttribute('aria-expanded', String(!row.hidden)); } break; }
    case 'serving-edit': ui.add.editServing = true; render(); setTimeout(() => document.getElementById('sv-amt')?.select(), 50); break;
    case 'serving-cancel': ui.add.editServing = false; render(); break;
    case 'serving-save': {
      const food = store.food(ui.add.foodId);
      const sv = readServingFields('sv', food);
      if (!sv.ok) { toast('Enter the serving amount'); break; }
      const old = (food.servings || []).filter((x) => x.grams > 0 && !isPlaceholderServing(x));
      const servings = [{ label: sv.label, grams: sv.grams, ...(sv.nominal ? { nominal: true } : {}) }, ...old.slice(1).filter((x) => Math.abs(x.grams - sv.grams) > 0.01)];
      store.saveFood({ ...food, servings });
      Object.assign(ui.add, { editServing: false, unitIdx: 0, qty: 1 });
      render(); toast('Serving size saved');
      break;
    }
    case 'unit': {
      const units = unitsFor(store.food(ui.add.foodId));
      const grams = ui.add.qty * units[ui.add.unitIdx].grams;
      ui.add.unitIdx = Number(el.dataset.i);
      // Keep the exact amount (the box shows it rounded) so switching units never changes how much food it is.
      ui.add.qty = grams / units[ui.add.unitIdx].grams;
      render(); break;
    }
    case 'meal': ui.add.meal = el.dataset.m; render(); break;
    case 'entry-reset': ui.add = null; render(); break;
    case 'save-entry': {
      syncAddForm();
      const a = ui.add;
      const food = store.food(a.foodId);
      const unit = unitsFor(food)[a.unitIdx];
      const grams = a.qty * unit.grams;
      if (!(grams > 0)) { toast('Enter an amount'); break; }
      const data = { foodId: food.id, grams, unit: unit.label, qty: a.qty, meal: a.meal, ts: tsFor(a.date, a.time) };
      if (a.entryId) {
        // Editing: stay on this food so you can see the change.
        store.updateEntry(a.date, a.entryId, data);
        render();
        toast('Saved');
        break;
      }
      store.addEntry(a.date, data);
      ui.add = null;
      toast(`Added to ${mealName(data.meal)}`);
      go(`#/day/${a.date}`);
      break;
    }
    case 'rescan': ui.scan = null; render(); break;
    case 'paste-open': openPaste(store.food(el.dataset.id)); break;
    case 'paste-close': closePaste(); break;
    case 'paste-basis': ui.paste.text = document.getElementById('paste-text')?.value ?? ui.paste.text; ui.paste.basis = Number(el.dataset.g); renderPaste(); break;
    case 'paste-read': readPaste(); break;
    case 'paste-serving-edit': ui.paste.text = document.getElementById('paste-text')?.value ?? ui.paste.text; ui.paste.editServing = !ui.paste.editServing; renderPaste(); setTimeout(() => document.getElementById('psv-amt')?.select(), 50); break;
    case 'paste-serving-save': {
      const f = store.food(ui.paste.foodId);
      const sv = readServingFields('psv', f);
      if (!sv.ok) { toast('Enter the serving amount'); break; }
      const grams = sv.grams;
      const servings = [{ label: sv.label, grams, ...(sv.nominal ? { nominal: true } : {}) }, ...(f.servings || []).filter((x) => Math.abs(x.grams - grams) > 0.01 && !isPlaceholderServing(x))];
      store.saveFood({ ...f, servings });
      ui.paste.basis = grams; ui.paste.editServing = false;
      if (ui.add?.foodId === f.id) Object.assign(ui.add, { unitIdx: 0, qty: 1 });
      renderPaste(); render();
      toast('Serving size saved');
      break;
    }
    case 'paste-back': ui.paste.result = null; renderPaste(); break;
    case 'paste-apply': applyPaste(); break;
    case 'paste-clip': {
      let t = '';
      try { t = NATIVE && window.AndroidBridge.readClipboard ? window.AndroidBridge.readClipboard() : await navigator.clipboard.readText(); } catch { /* blocked */ }
      if (t) { ui.paste.text = t; renderPaste(); } else toast('Couldn’t read the clipboard. Long-press the box and choose Paste.');
      break;
    }
    case 'cal-open': openCalendar(el.dataset.date || todayISO()); break;
    case 'cal-month': ui.cal.month = el.dataset.m; renderCalendar(); break;
    case 'cal-pick': document.getElementById('cal-scrim')?.remove(); go(`#/day/${el.dataset.d}`); break;
    case 'cal-close': document.getElementById('cal-scrim')?.remove(); break;
    case 'quick-add': {
      const last = store.day(el.dataset.from).find((e) => e.id === el.dataset.entry);
      const food = store.food(el.dataset.id);
      if (!last || !food) break;
      const meal = el.dataset.meal;
      store.addEntry(el.dataset.date, { foodId: food.id, grams: last.grams, unit: last.unit, qty: last.qty, meal, ts: tsFor(el.dataset.date, hhmm(Date.now())) });
      el.innerHTML = I.check.replace(/12/g, '16');
      el.style.background = 'var(--lilac)'; el.style.color = 'var(--on-accent)';
      el.disabled = true;
      toast(`Added ${food.name} to ${mealName(meal)}`);
      break;
    }
    case 'nut-open': go(`#/nutrient/${el.dataset.k}?date=${el.dataset.date}`); break;
    case 'burned': openBurned(el.dataset.date); break;
    case 'burn-close': document.getElementById('burn-scrim')?.remove(); break;
    case 'act-new': openActivity(el.dataset.date || todayISO()); break;
    case 'act-edit': openActivity(el.dataset.date, el.dataset.id); break;
    case 'act-close': closeActivity(); break;
    case 'act-type': {
      const t = ACTIVITY_TYPES.find((x) => x.name === el.dataset.name);
      const prevName = ui.act.name;
      ui.act.met = t?.met ?? null;
      if (!prevName || ACTIVITY_TYPES.some((x) => x.name === prevName)) ui.act.name = t.name;
      ui.act.kcalEdited = false;
      if (!t?.met) ui.act.kcal = '';
      renderActivity(); break;
    }
    case 'act-save': {
      const a = ui.act;
      const kcal = Number(a.kcal);
      if (!(kcal > 0)) { toast('Enter the calories burned'); break; }
      store.saveActivity(a.date, { id: a.id || undefined, name: a.name.trim() || 'Activity', met: a.met, minutes: Number(a.minutes) || '', kcal, ts: tsFor(a.date, a.time) });
      closeActivity(); render(); toast(a.id ? 'Activity updated' : `Added ${Math.round(kcal)} kcal burned`); break;
    }
    case 'act-delete': store.removeActivity(ui.act.date, ui.act.id); closeActivity(); render(); toast('Activity removed'); break;
    case 'profile-set': store.saveProfile({ [el.dataset.k]: el.dataset.v }); render(); break;
    case 'weight-del': store.setWeight(el.dataset.d, ''); render(); break;
    case 'ask-gemini': askGeminiApp(store.food(el.dataset.id)); break;
    case 'ask-gemini-barcode': askGeminiApp(barcodeFood(el.dataset.code)); break;
    case 'native-scan':
      if (NATIVE) window.AndroidBridge?.scanBarcode();
      else { ui.scan.webCam = !ui.scan.webCam; render(); }
      break;
    case 'add-db': searchDatabase(ui.scan.q.trim()); break;
    case 'add-code': runLookup(el.dataset.code); break;
    case 'add-group': ui.scan.group = el.dataset.g; refreshAddResults(); break;
    case 'qa': {
      const food = store.food(el.dataset.id);
      if (!food) break;
      quickAdd(food, el.dataset.date, el.dataset.meal);
      el.innerHTML = I.check.replace(/12/g, '16');
      el.style.background = 'var(--lilac)'; el.style.color = 'var(--on-accent)';
      el.disabled = true;
      toast(`Added ${food.name} to ${mealName(el.dataset.meal)}`);
      break;
    }
    case 'add-ask':
    case 'add-custom': {
      // A new food named after what you searched for. Gemini's answer (shared or pasted) fills it in,
      // or you enter the serving and nutrients yourself.
      const name = (el.dataset.name || '').trim();
      const s = ui.scan || {};
      if (act === 'add-ask' && !name) { toast('Type the food’s name in the search box first'); document.getElementById('add-q')?.focus(); break; }
      const food = store.saveFood({ id: 'custom:' + Date.now().toString(36), name: name || 'New food', brand: '', unidentified: !name, servings: [], per100: {}, sources: [{ kind: 'label', title: 'Added by you', count: 0 }], createdAt: Date.now() });
      store.saveSettings({ askedFood: food.id });
      if (act === 'add-ask') {
        askGeminiApp(food);
        location.hash = `#/food/${encodeURIComponent(food.id)}?date=${s.date || todayISO()}&meal=${s.meal || mealForNow()}`;
      } else {
        location.hash = `#/food/${encodeURIComponent(food.id)}?date=${s.date || todayISO()}&meal=${s.meal || mealForNow()}`;
        setTimeout(() => { if (ui.add) { ui.add.editName = !name; ui.add.editServing = true; render(); } }, 80);
      }
      break;
    }
    case 'pick-hit': {
      const hit = ui.search.results?.[Number(el.dataset.i)];
      if (!hit) break;
      const date = el.dataset.date, meal = el.dataset.meal;
      showLookupSheet(hit, date, meal);
      break;
    }
    case 'balance': {
      const fat = Math.max(0, Math.round((store.target('energy') - (store.target('protein') || 0) * 4 - (store.target('carbs') || 0) * 4) / 9));
      store.setTarget('fat', fat); render(); toast(`Fat target set to ${fat} g`); break;
    }
    case 'export': openExport(); break;
    case 'import': startImport(); break;
    case 'close-sheet': document.querySelector('.scrim')?.remove(); break;
    default: break;
  }
  void r;
});

// Pick up what's typed in the amount and time boxes even if the keyboard is still open
// (the box hasn't lost focus, so its change event hasn't fired yet).
function syncAddForm() {
  if (!ui.add) return;
  const q = document.getElementById('qty');
  // Only take the box's number if it was typed; otherwise keep the exact amount behind the rounded display.
  if (q && q.value !== '' && Number(q.value) !== +ui.add.qty.toFixed(2)) ui.add.qty = Math.max(0, Number(q.value) || 0);
  const t = document.querySelector('[data-act=time]');
  if (t?.value) ui.add.time = t.value;
}
// Re-draw the numbers while you type, keeping the same amount box so the keyboard stays up.
let qtyTimer = 0;
function liveQty() {
  const box = document.getElementById('qty');
  const sel = box ? [box.selectionStart, box.selectionEnd] : null;
  render();
  const fresh = document.getElementById('qty');
  if (box && fresh && box !== fresh) {
    fresh.replaceWith(box);
    box.focus({ preventScroll: true });
    try { if (sel) box.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs may not support selection */ }
  }
}
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'dm-q' && ui.dm) {
    ui.dm.q = ev.target.value;
    const pos = ev.target.selectionStart; render();
    const box = document.getElementById('dm-q'); if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch { /* search inputs */ } }
    return;
  }
  if (ev.target.dataset?.act === 'qty-input' && ui.add && ev.target.value !== '') {
    ui.add.qty = Math.max(0, Number(ev.target.value) || 0);
    clearTimeout(qtyTimer);
    qtyTimer = setTimeout(liveQty, 250);
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;

  if (el.id === 'w-date') { ui.weightDate = el.value && el.value <= todayISO() ? el.value : null; const box = $('#w-in'); if (box) box.value = store.weights()[ui.weightDate || todayISO()] ?? ''; return; }
  if (el.dataset.settingCheck) { store.saveSettings({ [el.dataset.settingCheck]: el.checked }); toast('Saved'); return; }
  if (el.dataset.act === 'qty-input') { clearTimeout(qtyTimer); ui.add.qty = Math.max(0, Number(el.value) || 0); render(); }
  if (el.dataset.act === 'paste-label' && ui.paste) { ui.paste.replaceLabel = el.checked; store.saveSettings({ pasteOverLabel: el.checked }); renderPaste(); return; }
  if (el.dataset.act === 'time') { ui.add.time = el.value || ui.add.time; if (ui.add.entryId) render(); }
  if (el.dataset.act === 'photo' && el.files?.[0]) {
    const msg = $('#scan-msg');
    if (msg) msg.textContent = 'Reading the photo…';
    try { const code = await decodeImageFile(el.files[0]); runLookup(code); }
    catch { if (msg) msg.textContent = 'No barcode found in that photo. Try again closer, or type the number.'; }
  }
  if (el.dataset.act === 'custom-toggle') { store.setCustomOn(el.dataset.k, el.checked); render(); return; }
  if (el.id === 'nut-target-in') { el.closest('form')?.requestSubmit(); return; }
  if (el.dataset.target) { store.setTarget(el.dataset.target, el.value); render(); }
  if (el.dataset.profile) { store.saveProfile({ [el.dataset.profile]: el.value }); render(); return; }
  if (el.dataset.profileCheck) { store.saveProfile({ [el.dataset.profileCheck]: el.checked }); render(); return; }
  if (el.dataset.height) {
    const ftEl = document.querySelector('[data-height=ft]'), inEl = document.querySelector('[data-height=in]');
    const total = (Number(ftEl?.value) || 0) * 12 + (Number(inEl?.value) || 0);
    store.saveProfile({ heightIn: total > 0 ? total : '' }); render(); return;
  }
  if (el.dataset.setting) { store.saveSettings({ [el.dataset.setting]: el.value.trim() }); toast('Saved'); }
});

document.addEventListener('input', (ev) => {
  if (ev.target.id === 'add-q' && ui.scan) {
    ui.scan.q = ev.target.value;
    refreshAddResults();
    return;
  }
  if (ev.target.id === 'kl-q') {
    const words = ev.target.value.toLowerCase().split(/\s+/).filter(Boolean);
    document.querySelectorAll('#kl-list [data-q]').forEach((row) => { row.hidden = !words.every((w) => row.dataset.q.includes(w)); });
    return;
  }
  if (ev.target.id === 'yf-q') {
    const q = ev.target.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    document.querySelectorAll('#yf-list .yf-row').forEach((row) => {
      const hit = words.every((w) => row.dataset.q.includes(w));
      row.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    const empty = $('#yf-empty'); if (empty) empty.hidden = shown > 0;
    return;
  }
  const f = ev.target.dataset?.actField;
  if (!f || !ui.act) return;
  ui.act[f] = ev.target.value;
  if (f === 'kcal') ui.act.kcalEdited = ev.target.value !== '';
  if (f === 'minutes' && !ui.act.kcalEdited) {
    const k = activityKcal(ui.act.met, Number(ev.target.value), ui.act.date);
    const kc = document.querySelector('[data-act-field=kcal]');
    if (k != null && kc) { ui.act.kcal = k; kc.value = k; }
  }
});

document.addEventListener('submit', async (ev) => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  ev.preventDefault();
  if (form.dataset.form === 'nut-target') {
    const val = $('#nut-target-in').value;
    store.setTarget(form.dataset.k, val); render(); toast(val === '' ? 'Target removed' : 'Target saved'); return;
  }
  if (form.dataset.form === 'weight') {
    const v = Number($('#w-in').value);
    const d = $('#w-date')?.value || todayISO();
    if (!(v > 40 && v < 1000)) { toast('Enter your weight in pounds'); return; }
    if (d > todayISO()) { toast('Pick today or an earlier day'); return; }
    store.setWeight(d, v); ui.weightDate = null; render();
    toast(d === todayISO() ? 'Weight logged' : `Weight logged for ${longDate(d)}`); return;
  }
  if (form.dataset.form === 'add-search') {
    const input = document.getElementById('add-q');
    const q = (input?.value || '').trim();
    if (!q || !ui.scan) return;
    ui.scan.q = q;
    input.blur();
    const digits = q.replace(/\s/g, '');
    if (/^\d{6,14}$/.test(digits)) runLookup(digits); else searchDatabase(q);
    return;
  }

});

// Swipe right on a meal header to reveal its options; swipe left (or tap the card) to hide.
// The card follows the finger, then glides open or closed. No re-render, so the motion stays smooth.
const REVEAL = 76;
let drag = null, sumX = null, swallowClick = false, sumSwipedAt = 0;
// A swipe that started on a bar, link or button in the summary isn't also a tap.
document.addEventListener('click', (ev) => {
  if (Date.now() - sumSwipedAt < 400 && ev.target.closest?.('[data-summary]')) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
// While the keyboard is up, pressing a button would first close the keyboard, the page would jump, and the tap
// would land somewhere else. Keep focus (and the layout) until the tap completes, then close the keyboard.
document.addEventListener('pointerdown', (ev) => {
  const a = document.activeElement;
  if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const btn = ev.target.closest?.('button, [data-act]');
  if (btn && !/^(INPUT|TEXTAREA|SELECT|LABEL)$/.test(btn.tagName)) ev.preventDefault();
}, true);
document.addEventListener('click', (ev) => {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && ev.target.closest?.('button, [data-act]') && !ev.target.closest('input, textarea')) setTimeout(() => a.blur(), 0);
});

function setMealOpen(head, open) {
  const key = head.dataset.head;
  head.classList.toggle('open', open);
  const add = head.querySelector('.add-btn');
  if (add) { if (open) { add.setAttribute('tabindex', '-1'); add.setAttribute('aria-hidden', 'true'); } else { add.removeAttribute('tabindex'); add.removeAttribute('aria-hidden'); } }
  if (open) {
    document.querySelectorAll('.meal-head.open').forEach((h) => { if (h !== head) h.classList.remove('open'); });
    ui.swiped = key;
    if (!store.settings().swipeHintSeen) store.saveSettings({ swipeHintSeen: true });
  } else if (ui.swiped === key) {
    ui.swiped = null;
    if (ui.menu === key) { ui.menu = null; setTimeout(render, 340); }
  }
}

document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('[data-summary]')) sumX = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, active: false, t: performance.now() };
  const front = ev.target.closest('[data-swipe]');
  if (!front || (ev.target.closest('a,button') && !ev.target.closest('[data-act=row], .entry-row')) || ev.button > 0) return;
  const head = front.closest('.meal-head');
  drag = { head, front, x: ev.clientX, y: ev.clientY, start: head.classList.contains('open') ? REVEAL : 0, active: false, offset: 0, t: performance.now(), lastX: ev.clientX, v: 0, id: ev.pointerId };
});

document.addEventListener('pointermove', (ev) => {
  if (drag && hold?.active) { drag = null; }
  if (sumX && ev.pointerId === sumX.id) {
    const dx = ev.clientX - sumX.x, dy = ev.clientY - sumX.y;
    if (!sumX.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { sumX = null; return; }
      if (Math.abs(dx) < 8) return;
      sumX.active = true;
    }
    const track = document.querySelector('.sum-track');
    const box = document.querySelector('[data-summary]');
    if (track && box) {
      const N = track.children.length, w = box.offsetWidth || 1;
      let pos = (ui.page || 0) - dx / w;
      if (pos < 0) pos *= 0.3; if (pos > N - 1) pos = N - 1 + (pos - (N - 1)) * 0.3;
      track.style.transition = 'none';
      track.style.transform = `translateX(${-(pos * w)}px)`;
      placePill(false, Math.max(0, Math.min(N - 1, pos)));
    }
  }
  if (!drag || ev.pointerId !== drag.id) return;
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; } // vertical scroll wins
    if (Math.abs(dx) < 8) return;
    drag.active = true;
    drag.head.classList.add('dragging');
    try { drag.front.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  }
  let off = drag.start + dx;
  if (off > REVEAL) off = REVEAL + (off - REVEAL) * 0.25; // soft resistance past the stop
  if (off < 0) off = off * 0.25;
  drag.offset = off;
  const now = performance.now();
  drag.v = (ev.clientX - drag.lastX) / Math.max(1, now - drag.t);
  drag.lastX = ev.clientX; drag.t = now;
  drag.head.style.setProperty('--p', Math.max(-0.2, Math.min(1.15, off / REVEAL)).toFixed(3));
});

function endDrag(ev) {
  if (sumX && ev.pointerId === sumX.id) {
    const s = sumX;
    sumX = null;
    if (s.active) {
      const d = ev.type === 'pointerup' ? ev.clientX - s.x : 0;
      const w = document.querySelector('[data-summary]')?.offsetWidth || 320;
      const fast = Math.abs(d) / Math.max(1, performance.now() - s.t) > 0.5;
      const go = Math.abs(d) > w * 0.22 || (fast && Math.abs(d) > 30) ? (d < 0 ? 1 : -1) : 0;
      setSummaryPage((ui.page || 0) + go);
      sumSwipedAt = Date.now();
    }
  }
  if (!drag || ev.pointerId !== drag.id) return;
  const { head, active, offset, start, v } = drag;
  drag = null;
  if (!active) {
    // A tap on an open card closes it.
    if (start === REVEAL && ev.type === 'pointerup') { setMealOpen(head, false); swallowClick = true; setTimeout(() => { swallowClick = false; }, 400); }
    return;
  }
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 400);
  const open = v > 0.35 ? true : v < -0.35 ? false : offset > REVEAL / 2;
  head.classList.remove('dragging');
  head.style.removeProperty('--p');
  setMealOpen(head, open);
}
// Tapping anywhere in the revealed strip of an open row runs its ⋯ action right away on finger-up,
// so it never needs a second tap (some Android WebViews drop the first click after a swipe).
let revealFiredAt = 0;
document.addEventListener('pointerup', (ev) => {
  if (drag) return;
  const strip = ev.target.closest('.meal-head.open .meal-reveal');
  if (!strip) return;
  const btn = strip.querySelector('[data-act]');
  if (!btn) return;
  revealFiredAt = performance.now();
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, true);
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
// Swallow the click that follows a drag so it doesn't trigger other handlers.
document.addEventListener('click', (ev) => {
  // Drop the browser's own click that follows a reveal tap we already handled.
  if (ev.isTrusted && performance.now() - revealFiredAt < 600 && ev.target.closest('.meal-reveal')) { ev.stopPropagation(); ev.preventDefault(); return; }
}, true);
document.addEventListener('click', (ev) => { if (swallowClick) { swallowClick = false; if (ev.target.closest('[data-swipe]')) { ev.stopPropagation(); ev.preventDefault(); } } }, true);

// Bottom sheet showing lookup progress for a search result.
async function showLookupSheet(hit, date, meal) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Looking up food"><div class="handle"></div>
    <div class="s15 b6">${esc(hit.description)}</div><div class="small muted mt8" style="margin-bottom:16px">${esc(hit.brandName || hit.brandOwner || 'USDA reference food')}</div>
    <div id="sheet-steps">${stepsHTML({})}</div><div id="sheet-err"></div></div>`;
  document.body.appendChild(scrim);
  const steps = {};
  try {
    const food = await foodFromSearchHit(hit, (id, status, detail) => { steps[id] = { status, detail }; const b = $('#sheet-steps'); if (b) b.innerHTML = stepsHTML(steps); });
    scrim.remove();
    go(`#/food/${encodeURIComponent(food.id)}?date=${date}&meal=${meal}`);
  } catch (e) {
    const box = $('#sheet-err');
    if (box) box.innerHTML = `<div class="err mt12">${esc(e.message)}</div><button class="btn quiet block mt12" data-act="close-sheet">Close</button>`;
  }
}

/* ---------------- long-press a food in the diary to move it up or down its meal ---------------- */

let hold = null, swallowEntryClick = false;
// Each food sits in its own swipe wrapper (.entry-head). Those wrappers are what move: the dragged one follows the
// finger above the others, and the rest slide up or down one place as it passes them, so every food stays visible.
document.addEventListener('pointerdown', (ev) => {
  const row = ev.target.closest?.('.entry-row');
  if (!row || ev.button > 0) return;
  const list = row.closest('.entry-list');
  if (!list || list.querySelectorAll('.entry-row').length < 2) return;
  hold = { row, list, startX: ev.clientX, startY: ev.clientY, y: ev.clientY, pointerId: ev.pointerId, active: false };
  hold.timer = setTimeout(startReorder, 420);
});
function startReorder() {
  const h = hold;
  if (!h) return;
  h.active = true;
  h.items = [...h.list.querySelectorAll(':scope > .entry-head')];
  h.item = h.row.closest('.entry-head');
  h.idx = h.items.indexOf(h.item);
  h.newIdx = h.idx;
  const boxes = h.items.map((el) => el.getBoundingClientRect());
  h.tops = boxes.map((r) => r.top + scrollY);
  h.heights = boxes.map((r) => r.height);
  h.scroll0 = scrollY;
  h.list.classList.add('reordering');
  h.item.classList.add('lifted');
  try { h.row.setPointerCapture(h.pointerId); } catch { /* ignore */ }
  try { navigator.vibrate?.(12); } catch { /* ignore */ }
  h.raf = requestAnimationFrame(autoScroll);
}
// Where the dragged food would land, and how far each other food moves to make room.
function layoutReorder(h) {
  const dy = h.y - h.startY + (scrollY - h.scroll0);
  h.item.style.transform = `translateY(${dy}px)`;
  const center = h.tops[h.idx] + h.heights[h.idx] / 2 + dy;
  let n = 0;
  h.items.forEach((el, i) => { if (i !== h.idx && h.tops[i] + h.heights[i] / 2 < center) n++; });
  h.newIdx = n;
  const H = h.heights[h.idx];
  h.items.forEach((el, i) => {
    if (i === h.idx) return;
    const shift = h.idx < n && i > h.idx && i <= n ? -H : h.idx > n && i < h.idx && i >= n ? H : 0;
    el.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}
// Near the top or bottom of the screen, scroll so a food can be dragged past what's visible.
function autoScroll() {
  const h = hold;
  if (!h?.active) return;
  const edge = 90, bottom = innerHeight - (document.querySelector('nav.tabs')?.offsetHeight || 0);
  const v = h.y < edge ? -(edge - h.y) / 6 : h.y > bottom - edge ? (h.y - (bottom - edge)) / 6 : 0;
  if (v) { scrollBy(0, Math.max(-14, Math.min(14, v))); layoutReorder(h); }
  h.raf = requestAnimationFrame(autoScroll);
}
function clearReorder(h) {
  cancelAnimationFrame(h.raf);
  h.items?.forEach((el) => { el.style.transform = ''; });
  h.item?.classList.remove('lifted', 'settling');
  h.list.classList.remove('reordering');
}
function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.active) clearReorder(hold);
  hold = null;
}
document.addEventListener('pointermove', (ev) => {
  const h = hold;
  if (!h || ev.pointerId !== h.pointerId) return;
  if (!h.active) { if (Math.hypot(ev.clientX - h.startX, ev.clientY - h.startY) > 8) cancelHold(); return; }
  h.y = ev.clientY;
  layoutReorder(h);
});
// Keep the page from scrolling while a food is being dragged.
document.addEventListener('touchmove', (ev) => { if (hold?.active) ev.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (ev) => { if (ev.target.closest?.('.entry-row')) ev.preventDefault(); });
document.addEventListener('dragstart', (ev) => { if (ev.target.closest?.('.entry-row')) ev.preventDefault(); });
function endHold(ev) {
  const h = hold;
  if (!h || (ev.pointerId != null && ev.pointerId !== h.pointerId)) return;
  if (!h.active || ev.type === 'pointercancel') { cancelHold(); return; }
  clearTimeout(h.timer);
  cancelAnimationFrame(h.raf);
  hold = null;
  swallowEntryClick = true;
  setTimeout(() => { swallowEntryClick = false; }, 400);
  // Glide into the gap, then save the new order.
  const H = h.heights;
  let target = 0;
  if (h.newIdx > h.idx) for (let i = h.idx + 1; i <= h.newIdx; i++) target += H[i];
  else for (let i = h.newIdx; i < h.idx; i++) target -= H[i];
  h.item.classList.add('settling');
  h.item.style.transform = `translateY(${target}px)`;
  setTimeout(() => {
    if (h.newIdx !== h.idx) {
      const ids = h.items.map((el) => el.dataset.eid);
      const [moved] = ids.splice(h.idx, 1);
      ids.splice(h.newIdx, 0, moved);
      store.reorderMeal(h.list.dataset.date, h.list.dataset.meal, ids);
      render();
    } else clearReorder(h);
  }, 190);
}
document.addEventListener('pointerup', endHold);
document.addEventListener('pointercancel', endHold);
document.addEventListener('click', (ev) => {
  if (swallowEntryClick && ev.target.closest?.('.entry-row')) { swallowEntryClick = false; ev.preventDefault(); ev.stopPropagation(); }
}, true);

// The brand-logo feature was removed; free the space its caches used.
try { ['nt.brandDomains', 'nt.brandDomains2', 'nt.icons', 'nt.icons2'].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

// Enter / Done on the keyboard saves the serving size.
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.closest?.('.serving-editor')) { ev.preventDefault(); ev.target.closest('.serving-editor').querySelector('[data-act=serving-save], [data-act=paste-serving-save]')?.click(); }
});

window.addEventListener('hashchange', render);
render();

// The browser version works offline once loaded; the Android app ships its files inside the APK.
if ('serviceWorker' in navigator && !NATIVE) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
