// Insights: what all of your logged days add up to — where your weight is heading and how fast, how well you
// keep to your goal, which nutrients you're short on or over, and what to eat more or less of to fix it.
import { store, totals, dayEnergy, todayISO, autoEnergyTarget, bmrFor } from './store.js';
import { NUTRIENTS, RARELY_MEASURED, fmt } from './nutrients.js';
import { INFO, ulFor } from './nutrient-info.js';

const KCAL_PER_LB = 3500;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = {
  good: { label: 'Good', color: 'var(--lilac)', tint: 'var(--lilac-t)', icon: '<path d="M5 12.5l4.5 4.5L19 7.5"/>' },
  warn: { label: 'Watch', color: 'var(--wheat)', tint: 'var(--wheat-t)', icon: '<path d="M12 7v6"/><path d="M12 17h.01"/>' },
  bad: { label: 'Needs work', color: 'var(--rose)', tint: 'var(--rose-t)', icon: '<path d="M12 7v6"/><path d="M12 17h.01"/>' },
  none: { label: 'Not enough data', color: 'var(--text-3)', tint: 'var(--fill-2)', icon: '<path d="M8 12h8"/>' }
};
const BAL = { surplus: 'var(--wheat)', maintain: 'var(--lilac)', deficit: 'var(--sky)' };
const balStatus = (b) => (b > 50 ? 'surplus' : b >= 0 ? 'maintain' : 'deficit');
const signed = (v, d = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace(/\.0+$/, '');
const kcalS = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString();
const pct = (v) => Math.round(v * 100) + '%';
const ratioText = (r) => `${r >= 10 ? Math.round(r) : r.toFixed(1).replace(/\.0$/, '')} : 1`;

export const RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All']];

function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return todayISO(d); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000); }
const short = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const wday = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });

function badge(st, text) {
  const s = STATUS[st];
  return `<span class="ins-badge" style="color:${s.color};background:${s.tint}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${s.icon}</svg>${esc(text || s.label)}</span>`;
}

// The calorie target that applied on a given day (goal-based when auto target is on, plus that day's workouts).
function targetOn(date) {
  const p = store.profile();
  const base = (p.autoTarget ? autoEnergyTarget(date) : null) ?? (store.target('energy') || 0);
  const acts = store.activities(date).reduce((a, x) => a + (Number(x.kcal) || 0), 0);
  return base + (store.settings().workoutsInTarget !== false ? acts : 0);
}

function goalInfo() {
  const p = store.profile();
  const rate = Number(p.rateLb) || 0;
  if (p.goal === 'lose' && rate > 0) return { kind: 'lose', rate: -rate, daily: -500 * rate, text: `Lose ${rate} lb a week`, need: `a ${Math.round(500 * rate)} kcal deficit` };
  if (p.goal === 'gain' && rate > 0) return { kind: 'gain', rate, daily: 500 * rate, text: `Gain ${rate} lb a week`, need: `a ${Math.round(500 * rate)} kcal surplus` };
  return { kind: 'maintain', rate: 0, daily: 0, text: 'Maintain weight', need: 'eating about what you burn' };
}

/* ---------------- analysis ---------------- */

export function analyze(range) {
  const today = todayISO();
  const log = store.log();
  const loggedDates = Object.keys(log).filter((d) => (log[d] || []).length && d <= today).sort();
  // Today is still in progress, so it only counts when there is nothing else.
  const past = loggedDates.filter((d) => d < today);
  const pool = past.length ? past : loggedDates;
  if (!pool.length) return { empty: true };
  const end = past.length ? addDays(today, -1) : today;
  const start = range === 'all' ? pool[0] : addDays(end, -(Number(range) - 1));
  const spanDays = daysBetween(start, end) + 1;
  const goal = goalInfo();

  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const entries = log[d] || [];
    if (!entries.length) { days.push({ date: d, logged: false }); continue; }
    const tot = totals(entries);
    const eaten = tot.energy?.v || 0;
    const en = dayEnergy(d, eaten);
    const target = targetOn(d);
    const row = { date: d, logged: true, entries, tot, eaten, target, burned: en.ready ? en.burned : null };
    row.balance = row.burned != null ? eaten - row.burned : null;
    // A day far under target was probably not fully logged; it would skew every average.
    row.partial = eaten < Math.max(800, 0.45 * (target || 2000));
    if (row.balance != null) row.status = balStatus(row.balance);
    days.push(row);
  }
  const logged = days.filter((d) => d.logged);
  const full = logged.filter((d) => !d.partial);
  const use = full.length ? full : logged;
  const n = use.length;

  // Energy and goal adherence
  const avg = (f, list = use) => { const xs = list.map(f).filter((x) => x != null && Number.isFinite(x)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const withBal = use.filter((d) => d.balance != null);
  const avgEaten = avg((d) => d.eaten);
  const avgBurned = avg((d) => d.burned, withBal);
  const avgBal = avg((d) => d.balance, withBal);
  const avgTarget = avg((d) => d.target || null);
  const byBurn = withBal.length > 0;
  const tol = 25;
  const judge = (d) => {
    if (byBurn && d.balance != null) {
      const off = d.balance - goal.daily; // + means ate more than the goal allows
      const met = goal.kind === 'lose' ? off <= tol : goal.kind === 'gain' ? off >= -tol : Math.abs(off) <= 100;
      return { met, off };
    }
    if (!d.target) return null;
    const off = d.eaten - d.target;
    const met = goal.kind === 'gain' ? off >= -tol : goal.kind === 'lose' ? off <= tol : Math.abs(off) <= 100;
    return { met, off };
  };
  use.forEach((d) => { const j = judge(d); if (j) Object.assign(d, { met: j.met, off: j.off }); });
  const judged = use.filter((d) => d.met != null);
  const metDays = judged.filter((d) => d.met).length;
  const missed = judged.filter((d) => !d.met).sort((a, b) => Math.abs(b.off) - Math.abs(a.off));
  const lbWeek = avgBal != null ? (avgBal * 7) / KCAL_PER_LB : null;

  // Weight: what the scale says vs. what your calories predict.
  const weights = store.weights();
  const wDates = Object.keys(weights).filter((d) => d >= start && d <= end).sort();
  const before = Object.keys(weights).filter((d) => d < start).sort().pop();
  const wPts = (before && !wDates.length ? [before] : []).concat(wDates).map((d) => ({ date: d, lbs: weights[d] }));
  let observed = null;
  if (wPts.length >= 2) {
    const a = wPts[0], b = wPts[wPts.length - 1], span = daysBetween(a.date, b.date);
    if (span >= 5) observed = { change: b.lbs - a.lbs, perWeek: ((b.lbs - a.lbs) / span) * 7, span, from: a, to: b };
  }
  let predicted = null;
  if (wPts.length && avgBal != null) {
    const p0 = wPts[0];
    let w = p0.lbs; const line = [{ date: p0.date, lbs: w }];
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    for (let d = addDays(p0.date, 1); d <= end; d = addDays(d, 1)) {
      const row = byDate[d];
      const bal = row && row.balance != null && !row.partial ? row.balance : avgBal;
      w += bal / KCAL_PER_LB; line.push({ date: d, lbs: w });
    }
    predicted = line;
  }

  // Everything eaten in the period, summed
  const allEntries = use.flatMap((d) => d.entries);
  const sum = totals(allEntries);
  const avgOf = (k) => (sum[k]?.v || 0) / (n || 1);
  const foodsById = store.foods();
  // How much of what you ate has a value for each nutrient (by calories, or by item for zero-calorie foods).
  const covered = {}; let kcalAll = 0, items = 0;
  for (const e of allEntries) {
    const f = foodsById[e.foodId]; if (!f) continue;
    const kc = ((f.per100?.energy?.v || 0) * e.grams) / 100;
    const w = kc > 0 ? kc : 0; kcalAll += w; items++;
    for (const [k, c] of Object.entries(f.per100 || {})) if (c?.v != null) covered[k] = (covered[k] || 0) + w;
  }
  const coverage = (k) => (kcalAll > 0 ? Math.min(1, (covered[k] || 0) / kcalAll) : 0);

  const prof = store.profile();
  // Fluoride is left out (it comes from water and toothpaste, not food); omega-6 is judged by its ratio to omega-3.
  const SKIP = ['energy', 'water', 'carbs', 'fluoride', 'omega6', 'la', 'ala'];
  const nutrients = NUTRIENTS.filter((x) => !x.limit && (!x.derived || x.key === 'omega3') && store.target(x.key) && !SKIP.includes(x.key) && (x.group !== 'Protein' || x.key === 'protein'))
    .map((x) => {
      const t = store.target(x.key), v = avgOf(x.key), cov = coverage(x.key), p = t ? v / t : 0;
      const daysMet = use.filter((d) => (d.tot[x.key]?.v || 0) >= t).length;
      const thin = cov < 0.5 && p < 0.9;
      return { key: x.key, name: x.name, unit: x.unit, group: x.group, target: t, v, p, cov, thin, rare: RARELY_MEASURED.includes(x.key), daysMet, est: sum[x.key]?.estShare || 0 };
    });
  const gaps = nutrients.filter((x) => x.p < 0.7 && !x.thin && !x.rare).sort((a, b) => a.p - b.p);
  const close = nutrients.filter((x) => x.p >= 0.7 && x.p < 0.9 && !x.thin).sort((a, b) => a.p - b.p);
  const unknown = nutrients.filter((x) => x.thin || (x.rare && x.p < 0.7));

  // Amino acids: all essentials met?
  const amino = NUTRIENTS.filter((x) => x.group === 'Protein' && x.key !== 'protein' && store.target(x.key)).map((x) => ({ name: x.name, p: avgOf(x.key) / store.target(x.key), cov: coverage(x.key) }));

  // Limits: sodium, added sugar, saturated fat, and upper limits for anything that has one.
  const kcal = avgEaten || 0;
  const limits = [
    { key: 'sodium', name: 'Sodium', unit: 'mg', v: avgOf('sodium'), limit: 2300, ideal: store.target('sodium') || 1500, why: 'Above 2,300 mg a day raises blood pressure risk.' },
    { key: 'added_sugars', name: 'Added sugar', unit: 'g', v: avgOf('added_sugars'), limit: Math.min(store.target('added_sugars') || 50, Math.max(25, (kcal * 0.1) / 4)), why: 'Guidelines keep added sugar under 10% of calories.' },
    { key: 'sat_fat', name: 'Saturated fat', unit: 'g', v: avgOf('sat_fat'), limit: Math.max(10, (kcal * 0.1) / 9), why: 'Under 10% of calories is the guideline for heart health.' }
  ].map((l) => ({ ...l, cov: coverage(l.key), p: l.limit ? l.v / l.limit : 0, daysOver: use.filter((d) => (d.tot[l.key]?.v || 0) > l.limit).length }));
  const ulHits = [];
  for (const x of NUTRIENTS) {
    if (['sodium', 'caffeine'].includes(x.key) || !INFO[x.key]?.ul || INFO[x.key]?.ulNote) continue;
    const ul = ulFor(x.key, prof); if (!ul) continue;
    const over = use.filter((d) => (d.tot[x.key]?.v || 0) > ul.value);
    if (over.length) ulHits.push({ key: x.key, name: x.name, unit: x.unit, ul: ul.value, days: over.length, max: Math.max(...over.map((d) => d.tot[x.key].v)) });
  }
  const caffeine = (() => { const ul = ulFor('caffeine', prof); const over = use.filter((d) => (d.tot.caffeine?.v || 0) > (ul?.value || 400)); return over.length ? { days: over.length, limit: ul?.value || 400, avg: avgOf('caffeine') } : null; })();

  // Omega-6 to omega-3 ratio: about 4:1 or lower is the usual aim; typical Western diets run 15:1 or more.
  const n6 = avgOf('omega6'), n3 = avgOf('omega3');
  const omegaCov = Math.min(coverage('omega6'), coverage('omega3'));
  const omega = n3 > 0 && n6 > 0 ? { n6, n3, ratio: n6 / n3, cov: omegaCov, thin: omegaCov < 0.5 } : null;

  // Macros
  const macro = ['protein', 'carbs', 'fat'].map((k) => ({ key: k, v: avgOf(k), target: store.target(k) || null, kcal: avgOf(k) * (k === 'fat' ? 9 : 4) }));
  const lastW = store.weightOn(end)?.lbs || null;
  const proteinPerKg = lastW ? avgOf('protein') / (lastW * 0.45359237) : null;
  const fiberPer1000 = kcal ? (avgOf('fiber') / kcal) * 1000 : null;

  // Patterns: weekday averages and where the calories come from.
  const wk = Array.from({ length: 7 }, (_, i) => ({ i, xs: [] }));
  use.forEach((d) => wk[new Date(d.date + 'T12:00:00').getDay()].xs.push(d.eaten));
  const weekday = wk.map((w) => ({ day: w.i, avg: w.xs.length ? w.xs.reduce((a, b) => a + b, 0) / w.xs.length : null, n: w.xs.length }));
  const mealKcal = {};
  for (const e of allEntries) { const f = foodsById[e.foodId]; if (f) mealKcal[e.meal] = (mealKcal[e.meal] || 0) + ((f.per100?.energy?.v || 0) * e.grams) / 100; }
  const meals = store.meals().map((m) => ({ ...m, kcal: (mealKcal[m.key] || 0) / (n || 1) }));

  // Foods: what you eat most, where calories come from, and your best sources of each nutrient.
  const foodAgg = {};
  for (const d of use) for (const e of d.entries) {
    const f = foodsById[e.foodId]; if (!f) continue;
    const a = (foodAgg[f.id] = foodAgg[f.id] || { food: f, times: 0, grams: 0, days: new Set() });
    a.times++; a.grams += e.grams; a.days.add(d.date);
  }
  const contrib = (k) => {
    const tot = sum[k]?.v || 0; if (!tot) return [];
    return Object.values(foodAgg).map((a) => ({ food: a.food, v: ((a.food.per100?.[k]?.v || 0) * a.grams) / 100 }))
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => ({ ...x, share: x.v / tot }));
  };
  // Your usual portion of every food you've ever logged, for "foods you already eat that are rich in X".
  const usual = {};
  for (const list of Object.values(log)) for (const e of list) { const u = (usual[e.foodId] = usual[e.foodId] || { g: 0, c: 0, ts: 0 }); u.g += e.grams; u.c++; u.ts = Math.max(u.ts, e.ts || 0); }
  const richIn = (k, target) => Object.entries(usual).map(([id, u]) => {
    const f = foodsById[id]; const c = f?.per100?.[k];
    if (!f || c?.v == null) return null;
    const g = u.g / u.c; const v = (c.v * g) / 100;
    const kc = f.per100.energy?.v || 0, val = (key) => f.per100[key]?.v || 0;
    const junk = kc > 0 && (val('sodium') / kc > 0.9 || (val('added_sugars') * 4) / kc > 0.2 || (val('sat_fat') * 9) / kc > 0.12);
    // Per 100 kcal, so foods that add the nutrient without many calories rank first.
    const density = kc > 0 ? (c.v / kc) * 100 : Infinity;
    return junk ? null : { food: f, grams: g, v, p: target ? v / target : 0, times: u.c, density };
  }).filter((x) => x && x.p >= 0.08).sort((a, b) => b.density - a.density || b.p - a.p).slice(0, 3);

  const estShare = (() => { const ks = nutrients.filter((x) => sum[x.key]?.v > 0); return ks.length ? ks.reduce((a, x) => a + (sum[x.key].estShare || 0), 0) / ks.length : 0; })();

  return {
    empty: false, range, start, end, spanDays, days, logged, full, use, n, partial: logged.filter((d) => d.partial),
    goal, byBurn, avgEaten, avgBurned, avgBal, avgTarget, lbWeek, metDays, judged: judged.length, missed,
    weights: wPts, observed, predicted, hasBmr: bmrFor(end) != null,
    nutrients, gaps, close, unknown, amino, limits, omega, ulHits, caffeine, macro, proteinPerKg, fiberPer1000, lastW,
    weekday, meals, foodAgg, contrib, richIn, estShare, sum, avgOf, includesToday: !past.length
  };
}

/* ---------------- charts ---------------- */

const W = 320;
function niceStep(span, target = 4, mults = [1, 2, 2.5, 5, 10]) {
  const raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  return mults.map((m) => m * mag).find((s) => span / s <= target + 0.5) || 10 * mag;
}

// Daily energy balance as diverging bars around zero, with the goal as a dashed line.
function balanceChart(a) {
  let rows = a.days.map((d) => ({ date: d.date, v: d.logged && !d.partial ? (a.byBurn ? d.balance : d.eaten - d.target) : null, partial: d.partial, logged: d.logged }));
  let label = (r) => short(r.date);
  if (rows.length > 92) { // weekly averages so bars stay readable
    const wk = [];
    for (let i = 0; i < rows.length; i += 7) {
      const g = rows.slice(i, i + 7), xs = g.map((r) => r.v).filter((v) => v != null);
      wk.push({ date: g[0].date, end: g[g.length - 1].date, v: xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null, logged: xs.length > 0, week: true });
    }
    rows = wk; label = (r) => `Week of ${short(r.date)}`;
  }
  const H = 170, top = 12, bottom = 22, left = 36, right = 6;
  const plotH = H - top - bottom, plotW = W - left - right;
  const vals = rows.map((r) => r.v).filter((v) => v != null).concat([a.goal.daily, 0]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max(100, (hi - lo) * 0.12); lo -= pad; hi += pad;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const y = (v) => top + ((hi - v) / (hi - lo)) * plotH;
  const slot = plotW / rows.length, bw = Math.max(2, Math.min(22, slot * 0.62));
  const grid = []; for (let v = lo; v <= hi + 1e-6; v += step) grid.push(v);
  const bars = rows.map((r, i) => {
    const cx = left + slot * i + slot / 2;
    const tip = r.v == null ? `${label(r)} · ${r.partial ? 'partly logged, left out' : 'not logged'}`
      : `${label(r)} · ${kcalS(r.v)} kcal ${a.byBurn ? (r.v > 50 ? 'surplus' : r.v >= 0 ? 'maintaining' : 'deficit') : 'vs target'}${a.goal.kind !== 'maintain' ? ` · goal ${kcalS(a.goal.daily)}` : ''}`;
    const hit = `<rect x="${(cx - slot / 2).toFixed(1)}" y="${top}" width="${slot.toFixed(1)}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (r.v == null) return `<circle cx="${cx.toFixed(1)}" cy="${y(0).toFixed(1)}" r="${Math.min(1.6, bw / 2)}" fill="var(--text-4)"/>${hit}`;
    const y0 = y(0), y1 = y(r.v), h = Math.max(1.5, Math.abs(y1 - y0));
    const color = BAL[balStatus(a.byBurn ? r.v : r.v + 0)];
    const rr = Math.min(3, bw / 2);
    // Rounded at the data end only.
    const x0 = cx - bw / 2, up = r.v >= 0;
    const yt = up ? y0 - h : y0;
    const path = up
      ? `M${x0},${y0} V${yt + rr} Q${x0},${yt} ${x0 + rr},${yt} H${x0 + bw - rr} Q${x0 + bw},${yt} ${x0 + bw},${yt + rr} V${y0} Z`
      : `M${x0},${y0} V${y0 + h - rr} Q${x0},${y0 + h} ${x0 + rr},${y0 + h} H${x0 + bw - rr} Q${x0 + bw},${y0 + h} ${x0 + bw},${y0 + h - rr} V${y0} Z`;
    return `<path d="${path}" fill="${color}"/>${hit}`;
  }).join('');
  const goalY = y(a.goal.daily);
  const ticks = rows.map((r, i) => {
    const every = Math.ceil(rows.length / 6);
    if (rows.length > 7 && (rows.length - 1 - i) % every !== 0) return '';
    const t = rows.length <= 7 ? wday(r.date)[0] : short(r.date).replace(/^(\w{3}) /, '$1 ');
    return `<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--text-3)">${t}</text>`;
  }).join('');
  return `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily calorie balance with the goal line">
    ${grid.map((v) => `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="var(--text-3)">${v === 0 ? '0' : (v > 0 ? '+' : '−') + Math.abs(v)}</text>`).join('')}
    <line x1="${left}" x2="${W - right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--text-4)"/>
    ${bars}
    ${a.goal.kind !== 'maintain' ? `<line x1="${left}" x2="${W - right}" y1="${goalY.toFixed(1)}" y2="${goalY.toFixed(1)}" stroke="var(--text)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".8"/>` : ''}
    ${ticks}
  </svg>`;
}

// Scale weight against what your logged calories predict.
function weightChart(a) {
  const pts = a.weights, pred = a.predicted || [];
  const all = pts.map((p) => p.lbs).concat(pred.map((p) => p.lbs));
  if (!all.length) return '';
  const first = [pts[0]?.date, pred[0]?.date, a.start].filter(Boolean).sort()[0];
  const last = a.end;
  const span = Math.max(1, daysBetween(first, last));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = Math.max(0.6, (hi - lo) * 0.15); lo -= pad; hi += pad;
  const step = Math.max(1, niceStep(hi - lo, 3, [1, 2, 5, 10]));
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const H = 160, top = 12, bottom = 22, left = 36, right = 8;
  const plotH = H - top - bottom, plotW = W - left - right;
  const x = (d) => left + (daysBetween(first, d) / span) * plotW;
  const y = (v) => top + ((hi - v) / (hi - lo)) * plotH;
  const grid = []; for (let v = lo; v <= hi + 1e-6; v += step) grid.push(+v.toFixed(2));
  const predLine = pred.length > 1 ? `<polyline points="${pred.map((p) => `${x(p.date).toFixed(1)},${y(p.lbs).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--sky)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>` : '';
  const wLine = pts.length > 1 ? `<polyline points="${pts.map((p) => `${x(p.date).toFixed(1)},${y(p.lbs).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--lilac)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '';
  const dots = pts.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.lbs).toFixed(1)}" r="4" fill="var(--lilac)" stroke="var(--card)" stroke-width="2"/><circle cx="${x(p.date).toFixed(1)}" cy="${y(p.lbs).toFixed(1)}" r="14" fill="transparent" data-tip="${esc(`${short(p.date)} · ${fmt(p.lbs)} lb on the scale`)}"/>`).join('');
  const lastP = pred[pred.length - 1];
  const predEnd = lastP ? `<circle cx="${x(lastP.date).toFixed(1)}" cy="${y(lastP.lbs).toFixed(1)}" r="14" fill="transparent" data-tip="${esc(`${short(lastP.date)} · ${fmt(lastP.lbs)} lb predicted from your calories`)}"/>` : '';
  const ticks = [first, addDays(first, Math.round(span / 2)), last].map((d, i) => `<text x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}" font-size="9.5" fill="var(--text-3)">${short(d)}</text>`).join('');
  return `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Logged weight and the weight your calories predict">
    ${grid.map((v) => `<line x1="${left}" x2="${W - right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${left - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5" fill="var(--text-3)">${fmt(v)}</text>`).join('')}
    ${predLine}${wLine}${dots}${predEnd}${ticks}
  </svg>`;
}

function weekdayChart(a) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = order.map((i) => a.weekday[i]);
  const target = a.avgTarget || 0;
  const max = Math.max(target, ...rows.map((r) => r.avg || 0)) * 1.12 || 1;
  const H = 140, top = 14, bottom = 22, left = 6, right = 6;
  const plotH = H - top - bottom, plotW = W - left - right, slot = plotW / 7, bw = Math.min(26, slot * 0.55);
  const y = (v) => top + plotH - (v / max) * plotH;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const bars = rows.map((r, i) => {
    const cx = left + slot * i + slot / 2;
    const tip = r.avg == null ? `${names[r.day]} · no full days logged` : `${names[r.day]} · ${Math.round(r.avg).toLocaleString()} kcal on average (${r.n} day${r.n === 1 ? '' : 's'})${target ? ` · ${kcalS(r.avg - target)} vs target` : ''}`;
    const hit = `<rect x="${(cx - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (r.avg == null) return `<text x="${cx.toFixed(1)}" y="${(top + plotH - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--text-4)">–</text><text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-3)">${names[r.day][0]}</text>${hit}`;
    const h = Math.max(2, (r.avg / max) * plotH), over = target && r.avg > target + 50;
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(top + plotH - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${over ? 'var(--wheat)' : 'var(--sky)'}"/>${hit}
      <text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-3)">${names[r.day][0]}</text>`;
  }).join('');
  return `<svg class="ins-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Average calories by day of the week">
    <line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" stroke="var(--text-4)"/>
    ${bars}
    ${target ? `<line x1="${left}" x2="${W - right}" y1="${y(target).toFixed(1)}" y2="${y(target).toFixed(1)}" stroke="var(--text)" stroke-width="1.4" stroke-dasharray="4 3" opacity=".8"/>` : ''}
  </svg>`;
}

function ring(p, color, size = 64, label = '') {
  const r = size / 2 - 5, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, p));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="flex:none">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--fill-2)" stroke-width="7"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" font-size="${size / 4.2}" font-weight="700" fill="var(--text)">${label}</text></svg>`;
}

// One nutrient as a bar against its target (100% tick), colored by how close you are.
function nutrientBar(x) {
  const st = x.thin ? 'none' : x.p >= 0.9 ? 'good' : x.p >= 0.7 ? 'warn' : 'bad';
  const w = Math.min(1, x.p / 1.5);
  return `<a class="ins-nrow" id="ins-n-${x.key}" href="#/nutrient/${x.key}">
    <span class="s14 ellipsis" style="min-width:0">${esc(x.name)}</span>
    <span class="ins-nbar" aria-hidden="true"><span style="width:${(w * 100).toFixed(1)}%;background:${STATUS[st].color};opacity:${x.thin ? 0.5 : 1}"></span><i style="left:${(100 / 1.5).toFixed(1)}%"></i></span>
    <span class="s13 b6" style="text-align:right">${x.thin ? '<span class="muted">?</span>' : pct(x.p)}</span>
  </a>`;
}

/* ---------------- page ---------------- */

export function insightsHTML(range, showAll) {
  const a = analyze(range);
  const head = `<header class="spread" style="padding:18px 20px 0;align-items:flex-end">
    <div class="col" style="gap:2px"><span class="s14 muted">${a.empty ? 'Your diet at a glance' : `${short(a.start)} – ${short(a.end)}`}</span><h1 class="h1">Insights</h1></div>
  </header>
  <div class="screen mt16"><div class="seg ins-range" role="group" aria-label="Period">${RANGES.map(([v, l]) => `<button class="chip" data-act="ins-range" data-v="${v}" aria-pressed="${range === v}">${l}</button>`).join('')}</div></div>`;
  if (a.empty) {
    return head + `<section class="screen mt16"><div class="card" style="padding:28px 22px;text-align:center">
      <div style="display:flex;justify-content:center;margin-bottom:10px">${ring(0, 'var(--lilac)', 72, '')}</div>
      <h2 class="h2" style="margin:0 0 6px">Nothing to analyze yet</h2>
      <p class="s14 muted" style="margin:0;line-height:1.5">Log a few days of meals and your weight, and this page will show where your weight is heading, how you're doing against your goal, and which nutrients to eat more or less of.</p>
      <a class="btn primary mt16" href="#/">Go to diary</a></div></section>`;
  }

  const g = a.goal;
  const out = [];

  /* ---- 1. The verdict ---- */
  const checks = [];
  if (a.judged) {
    const r = a.metDays / a.judged;
    checks.push({ name: 'Calorie goal', st: r >= 0.7 ? 'good' : r >= 0.4 ? 'warn' : 'bad', note: `${a.metDays} of ${a.judged} days on target`, to: 'ins-balance' });
  }
  const prot = a.macro[0];
  if (prot.target) { const r = prot.v / prot.target; checks.push({ name: 'Protein', st: r >= 0.9 ? 'good' : r >= 0.7 ? 'warn' : 'bad', note: `${fmt(prot.v)} of ${fmt(prot.target)} g a day`, to: 'ins-macros' }); }
  const fib = a.nutrients.find((x) => x.key === 'fiber');
  if (fib && !fib.thin) checks.push({ name: 'Fiber', st: fib.p >= 0.9 ? 'good' : fib.p >= 0.6 ? 'warn' : 'bad', note: `${fmt(fib.v)} of ${fmt(fib.target)} g a day`, to: 'ins-n-fiber' });
  const micro = a.nutrients.filter((x) => ['Vitamins', 'Minerals'].includes(x.group) && !x.thin && !x.rare);
  if (micro.length) {
    const low = micro.filter((x) => x.p < 0.7).length;
    checks.push({ name: 'Vitamins & minerals', st: low === 0 ? 'good' : low <= 3 ? 'warn' : 'bad', note: low ? `${low} running low` : `all ${micro.length} at 70%+`, to: 'ins-nutrients' });
  }
  for (const l of a.limits) {
    if (l.cov < 0.4 && !(l.v > 0)) continue;
    const st = l.key === 'sodium' ? (l.v <= 2300 ? 'good' : l.v <= 3000 ? 'warn' : 'bad') : (l.p <= 1 ? 'good' : l.p <= 1.3 ? 'warn' : 'bad');
    checks.push({ name: l.name, st, note: `${fmt(l.v)} ${l.unit} a day${st === 'good' ? '' : ` · limit ${fmt(l.limit)}`}`, to: 'ins-l-' + l.key });
  }
  if (a.omega && !a.omega.thin) {
    const r = a.omega.ratio;
    checks.push({ name: 'Omega-6 : omega-3', st: r <= 4 ? 'good' : r <= 10 ? 'warn' : 'bad', note: `${ratioText(r)}${r > 4 ? ' · aim for 4 : 1 or lower' : ''}`, to: 'ins-omega' });
  }
  if (a.ulHits.length) checks.push({ name: 'Upper limits', st: 'warn', note: `${a.ulHits.length} nutrient${a.ulHits.length === 1 ? '' : 's'} over on some days`, to: 'ins-tip-ul' });
  const bad = checks.filter((c) => c.st === 'bad').length, warn = checks.filter((c) => c.st === 'warn').length;
  const verdict = bad === 0 && warn <= 1
    ? { st: 'good', title: "You're in a good position", sub: warn ? 'One thing to keep an eye on, below.' : 'Your calories and nutrients are on track. Keep it up.' }
    : bad === 0 ? { st: 'warn', title: 'Mostly on track', sub: `${warn} things to tighten up.` }
    : { st: 'bad', title: `${bad} thing${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} attention`, sub: warn ? `And ${warn} more to keep an eye on.` : 'The details and fixes are below.' };
  const good = checks.filter((c) => c.st === 'good').length;
  out.push(`<div class="card ins-card">
    <div class="row" style="gap:16px">
      ${ring(checks.length ? good / checks.length : 0, STATUS[verdict.st].color, 72, `${good}/${checks.length}`)}
      <div class="col" style="gap:4px;min-width:0"><span class="b6" style="font-size:19px;line-height:1.25">${verdict.title}</span><span class="s13 muted" style="line-height:1.4">${verdict.sub} Based on ${a.n} ${a.n === 1 ? 'day' : 'days'} logged${a.partial.length ? `, ${a.partial.length} partly logged left out` : ''}.</span></div>
    </div>
    <div class="ins-checks mt16">${checks.map((c) => `<button class="ins-check" data-act="ins-jump" data-to="${c.to}" aria-label="${esc(c.name)}: ${esc(c.note)}. Show details"><span class="s14 b6">${esc(c.name)}</span><span class="small muted">${esc(c.note)}</span>${badge(c.st)}<span class="ins-chev" aria-hidden="true">›</span></button>`).join('')}</div>
  </div>`);

  /* ---- 2. Weight outlook ---- */
  const wk = a.lbWeek;
  const goalRate = g.rate;
  let outlook;
  if (wk == null) {
    outlook = `<div class="note">${a.hasBmr ? 'Not enough complete days to project yet.' : 'To project your weight, add your age, height and a weight under <a href="#/settings" class="b6" style="color:var(--lilac)">Targets</a> so the app knows what you burn.'}</div>`;
  } else {
    const dir = wk < -0.05 ? 'lose' : wk > 0.05 ? 'gain' : 'hold';
    const color = dir === 'lose' ? 'var(--sky)' : dir === 'gain' ? 'var(--wheat)' : 'var(--lilac)';
    const month = (a.avgBal * 30) / KCAL_PER_LB, q = (a.avgBal * 90) / KCAL_PER_LB;
    const vsGoal = g.kind === 'maintain' ? (Math.abs(wk) <= 0.25 ? 'good' : 'warn')
      : (() => { const r = wk / goalRate; return r >= 0.8 && r <= 1.3 ? 'good' : r >= 0.4 ? 'warn' : 'bad'; })();
    const paceText = g.kind === 'maintain'
      ? (vsGoal === 'good' ? 'Close to maintenance, as planned.' : `You planned to maintain, but you're trending ${dir === 'lose' ? 'down' : 'up'}.`)
      : (() => {
        const r = wk / goalRate;
        if (r <= 0) return `Your goal is to ${g.kind}, but your calories point the other way.`;
        return `That's ${Math.round(r * 100)}% of your ${Math.abs(goalRate)} lb/week goal${r < 0.8 ? ` — about ${Math.round(Math.abs((goalRate - wk) * KCAL_PER_LB / 7))} kcal a day short of the ${g.kind === 'lose' ? 'deficit' : 'surplus'} you need` : r > 1.3 ? ' — faster than planned' : ''}.`;
      })();
    // Goal-pace gauge: where your actual rate sits between 0 and 2× the goal.
    const scaleMax = Math.max(1, Math.abs(goalRate) * 2, Math.abs(wk) * 1.15);
    const pos = (v) => 50 + (v / scaleMax) * 50;
    outlook = `
      <div class="row" style="gap:6px;align-items:baseline"><span style="font-size:40px;font-weight:300;letter-spacing:-.03em;line-height:1;color:${color}">${signed(wk, 1)}</span><span class="s14 muted">lb / week</span></div>
      <p class="s14" style="margin:8px 0 0;line-height:1.45">At your average ${a.avgBal < 0 ? 'deficit' : 'surplus'} of <b class="b6">${Math.abs(Math.round(a.avgBal)).toLocaleString()} kcal</b> a day, you'd ${dir === 'hold' ? 'hold steady' : `${dir} about <b class="b6">${Math.abs(month).toFixed(1)} lb</b> in a month and <b class="b6">${Math.abs(q).toFixed(1)} lb</b> in 3 months`}${a.lastW && dir !== 'hold' ? ` (around ${fmt(a.lastW + q)} lb by ${short(addDays(a.end, 90))})` : ''}.</p>
      ${`<div class="ins-gauge mt16" aria-hidden="true">
        <span class="ins-gauge-zero" style="left:50%"></span>
        ${g.kind !== 'maintain' ? `<span class="ins-gauge-goal" style="left:${pos(goalRate)}%"><em>Goal ${signed(goalRate, 1)}</em></span>` : ''}
        <span class="ins-gauge-dot" style="left:${Math.max(2, Math.min(98, pos(wk)))}%;background:${color}"></span>
      </div>
      <div class="spread small muted" style="margin-top:6px"><span>Losing</span><span>Holding</span><span>Gaining</span></div>`}
      <div class="row mt16" style="gap:10px;align-items:flex-start">${badge(vsGoal, vsGoal === 'good' ? 'On pace' : vsGoal === 'warn' ? 'Off pace' : 'Off track')}<span class="s13" style="line-height:1.45">${paceText}</span></div>`;
  }
  out.push(`<div class="card ins-card" id="ins-outlook"><div class="ins-h"><h2 class="h2">Weight outlook</h2><span class="small muted">${esc(g.text)}</span></div>${outlook}</div>`);

  /* ---- 3. Goal adherence: daily balance ---- */
  if (a.judged) {
    const missTxt = g.kind === 'lose' ? 'deficit' : g.kind === 'gain' ? 'surplus' : 'balance';
    const worst = a.missed.slice(0, 4);
    const avgMiss = a.missed.length ? a.missed.reduce((s, d) => s + Math.abs(d.off), 0) / a.missed.length : 0;
    const weekendMiss = a.missed.filter((d) => [0, 6].includes(new Date(d.date + 'T12:00:00').getDay())).length;
    const lines = [];
    if (a.missed.length) {
      lines.push(`You missed your ${g.kind === 'maintain' ? 'maintenance range' : `${kcalS(g.daily)} kcal ${missTxt}`} on <b class="b6">${a.missed.length} of ${a.judged}</b> days, by ${Math.round(avgMiss).toLocaleString()} kcal on average.`);
      if (weekendMiss >= 2 && weekendMiss / a.missed.length >= 0.5) lines.push(`${weekendMiss} of those were weekends — that's where most of the slip happens.`);
      if (g.kind === 'lose' && a.metDays) lines.push(`On the days you hit it, you were on pace for your ${Math.abs(g.rate)} lb a week.`);
    } else lines.push(`You hit your ${g.kind === 'maintain' ? 'maintenance range' : `${kcalS(g.daily)} kcal ${missTxt}`} on every logged day. Nicely done.`);
    out.push(`<div class="card ins-card ins-chart" id="ins-balance">
      <div class="ins-h"><h2 class="h2">Daily ${a.byBurn ? 'balance' : 'vs target'}</h2><span class="small muted">${a.byBurn ? 'eaten − burned' : 'eaten − target'}</span></div>
      <div class="row" style="gap:18px;margin:2px 0 6px">
        <div class="col"><span class="ins-num">${a.metDays}<span class="s14 muted" style="font-weight:400">/${a.judged}</span></span><span class="small muted">days on goal</span></div>
        <div class="col"><span class="ins-num">${a.avgBal != null ? kcalS(a.avgBal) : kcalS((a.avgEaten || 0) - (a.avgTarget || 0))}</span><span class="small muted">avg kcal ${a.byBurn ? 'a day' : 'vs target'}</span></div>
        <div class="col"><span class="ins-num">${Math.round(a.avgEaten || 0).toLocaleString()}</span><span class="small muted">avg eaten</span></div>
      </div>
      ${balanceChart(a)}
      <div class="ins-legend">${a.byBurn ? '<span><i style="background:var(--sky)"></i>Deficit</span><span><i style="background:var(--lilac)"></i>Maintain</span><span><i style="background:var(--wheat)"></i>Surplus</span>' : ''}${g.kind !== 'maintain' ? `<span><i class="dash"></i>Goal ${kcalS(g.daily)}</span>` : ''}</div>
      <div class="ins-tip s13 muted" aria-live="polite">Tap a bar for that day.</div>
      <p class="s14" style="margin:12px 0 0;line-height:1.5">${lines.join(' ')}</p>
      ${worst.length ? `<div class="list mt12">${worst.map((d) => `<a class="spread ins-li" href="#/day/${d.date}"><span class="s14">${wday(d.date)}, ${short(d.date)}</span><span class="s13 muted">${Math.round(d.eaten).toLocaleString()} eaten · <b class="b6" style="color:var(--text)">${kcalS(d.off)} off goal</b></span></a>`).join('')}</div>` : ''}
    </div>`);
  }

  /* ---- 4. Weight: scale vs. prediction ---- */
  if (a.weights.length) {
    const o = a.observed, p = a.predicted;
    const pChange = p && p.length > 1 ? p[p.length - 1].lbs - p[0].lbs : null;
    let msg = '';
    if (o && a.lbWeek != null) {
      const gap = o.perWeek - a.lbWeek;
      if (Math.abs(gap) <= 0.4) msg = 'Your scale is moving about as your calories predict, so your logging and burn estimate look accurate.';
      else if (gap > 0) msg = `The scale shows ${signed(o.perWeek, 1)} lb/week, but your calories predict ${signed(a.lbWeek, 1)}. Common causes: foods or drinks not logged, portions bigger than entered, or an activity level set higher than it is. Water swings can also hide fat loss for 1–2 weeks.`;
      else msg = `You're losing ${Math.abs(gap).toFixed(1)} lb/week faster than your log predicts — your burn may be higher than estimated, or some portions are logged larger than eaten. Early water loss also does this.`;
    } else msg = a.weights.length < 2 ? 'Log your weight a few times a week to compare the scale with what your calories predict.' : 'Log for at least a week to compare the trend.';
    out.push(`<div class="card ins-card ins-chart" id="ins-weight">
      <div class="ins-h"><h2 class="h2">Weight trend</h2><span class="small muted">${a.weights.length} weigh-in${a.weights.length === 1 ? '' : 's'}</span></div>
      <div class="row" style="gap:18px;margin:2px 0 6px">
        <div class="col"><span class="ins-num">${o ? signed(o.change, 1) + ' lb' : '—'}</span><span class="small muted">on the scale</span></div>
        <div class="col"><span class="ins-num" style="color:var(--sky)">${pChange != null ? signed(pChange, 1) + ' lb' : '—'}</span><span class="small muted">predicted by calories</span></div>
      </div>
      ${weightChart(a)}
      <div class="ins-legend"><span><i style="background:var(--lilac)"></i>Scale</span>${p ? '<span><i class="dash" style="border-color:var(--sky)"></i>Predicted</span>' : ''}</div>
      <div class="ins-tip s13 muted" aria-live="polite">Tap a point for details.</div>
      <p class="s14" style="margin:12px 0 0;line-height:1.5">${msg}</p>
    </div>`);
  }

  /* ---- 5. Macros ---- */
  const mk = a.macro.reduce((s, m) => s + m.kcal, 0) || 1;
  const mcol = { protein: 'var(--lilac)', carbs: 'var(--sky)', fat: 'var(--wheat)' };
  const mname = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
  const macroTips = [];
  if (a.proteinPerKg != null) {
    const ppk = a.proteinPerKg;
    if (g.kind === 'lose' && ppk < 1.2) macroTips.push(`Protein is ${ppk.toFixed(1)} g per kg of body weight. While losing weight, about 1.2–1.6 g/kg (${Math.round(1.2 * a.lastW * 0.4536)}–${Math.round(1.6 * a.lastW * 0.4536)} g a day for you) helps keep muscle and keeps you full.`);
    else if (g.kind === 'gain' && ppk < 1.4) macroTips.push(`Protein is ${ppk.toFixed(1)} g/kg. For building muscle, about 1.4–2.0 g/kg is the usual range.`);
    else if (ppk < 0.8) macroTips.push(`Protein is ${ppk.toFixed(1)} g/kg, under the 0.8 g/kg minimum.`);
    else macroTips.push(`Protein is ${ppk.toFixed(1)} g per kg of body weight — a solid amount${g.kind === 'lose' ? ' for keeping muscle while you lose' : ''}.`);
  }
  if (a.fiberPer1000 != null && a.fiberPer1000 < 14 && a.nutrients.find((x) => x.key === 'fiber')?.cov >= 0.5) macroTips.push(`Fiber is ${a.fiberPer1000.toFixed(1)} g per 1,000 kcal; 14 g is the guideline.`);
  const aminoLow = a.amino.filter((x) => x.cov >= 0.5 && x.p < 0.9);
  if (a.amino.length && !aminoLow.length && a.amino.some((x) => x.cov >= 0.5)) macroTips.push('All essential amino acids are covered.');
  else if (aminoLow.length) macroTips.push(`Low amino acids: ${aminoLow.map((x) => x.name.toLowerCase()).join(', ')}.`);
  out.push(`<div class="card ins-card" id="ins-macros">
    <div class="ins-h"><h2 class="h2">Macros</h2><span class="small muted">daily average</span></div>
    <div class="ins-stack" role="img" aria-label="Calories split: ${a.macro.map((m) => `${mname[m.key]} ${Math.round((m.kcal / mk) * 100)}%`).join(', ')}">${a.macro.map((m) => `<span style="flex:${m.kcal || 0.001};background:${mcol[m.key]}"></span>`).join('')}</div>
    <div class="col mt16" style="gap:14px">${a.macro.map((m) => {
      const p = m.target ? m.v / m.target : null;
      return `<div class="col" style="gap:6px">
        <div class="row" style="gap:8px;align-items:baseline"><span class="dot" style="background:${mcol[m.key]};width:8px;height:8px;align-self:center"></span><span class="s15 b6" style="flex:1">${mname[m.key]} <span class="s13 muted" style="font-weight:400">${Math.round((m.kcal / mk) * 100)}% of kcal</span></span><span class="s14 muted">${fmt(m.v)}${m.target ? ` / ${fmt(m.target)}` : ''} g</span></div>
        ${p != null ? `<span class="bar" style="height:6px" aria-hidden="true"><span style="width:${Math.min(100, p * 100).toFixed(1)}%;background:${mcol[m.key]}"></span></span>` : ''}
      </div>`;
    }).join('')}</div>
    ${macroTips.length ? `<p class="s14" style="margin:14px 0 0;line-height:1.5">${macroTips.join(' ')}</p>` : ''}
  </div>`);

  /* ---- 5b. Omega balance ---- */
  if (a.omega) {
    const o = a.omega, r = o.ratio;
    const st = o.thin ? 'none' : r <= 4 ? 'good' : r <= 10 ? 'warn' : 'bad';
    // Scale from 1:1 to 20:1+, with the 4:1 target zone shaded.
    const max = 20, pos = (v) => (Math.min(max, Math.max(1, v)) - 1) / (max - 1) * 100;
    out.push(`<div class="card ins-card" id="ins-omega">
      <div class="ins-h"><h2 class="h2">Omega-6 : omega-3</h2>${badge(st, st === 'good' ? 'Balanced' : st === 'none' ? 'Not enough data' : st === 'warn' ? 'High' : 'Very high')}</div>
      <div class="row" style="gap:6px;align-items:baseline"><span style="font-size:36px;font-weight:300;letter-spacing:-.03em;line-height:1">${ratioText(r)}</span><span class="s14 muted">average</span></div>
      <div class="ins-ratio mt16" aria-hidden="true">
        <span class="ins-ratio-zone" style="width:${pos(4)}%"></span>
        <span class="ins-gauge-dot" style="left:${Math.max(2, Math.min(98, pos(r)))}%;background:${STATUS[st].color}"></span>
      </div>
      <div class="spread small muted" style="margin-top:6px"><span>1 : 1</span><span>20 : 1+</span></div>
      <div class="ins-legend"><span><i style="background:var(--lilac-t);border:1px dashed var(--text-2)"></i>Target: 4 : 1 or lower</span></div>
      <div class="row mt16" style="gap:18px">
        <div class="col"><span class="ins-num">${fmt(o.n6)} g</span><span class="small muted">omega-6 a day</span></div>
        <div class="col"><span class="ins-num">${fmt(o.n3)} g</span><span class="small muted">omega-3 a day</span></div>
      </div>
      <p class="s14" style="margin:12px 0 0;line-height:1.5">${o.thin ? 'Many of your foods don’t list omega fats, so this ratio is rough.' : r <= 4 ? 'Your omega-6 and omega-3 are in good balance.' : `Omega-6 outweighs omega-3 by ${ratioText(r)}. Most guidance aims for 4 : 1 or lower; typical Western diets run 15 : 1 or more. More fatty fish, chia, flax or walnuts, and fewer seed oils, bring it down.`}${!o.thin && r > 4 ? ' See What to change below.' : ''}</p>
    </div>`);
  }

  /* ---- 5c. Limits ---- */
  const lim = a.limits.filter((l) => l.cov >= 0.4 || l.v > 0);
  if (lim.length) out.push(`<div class="card ins-card" id="ins-limits">
    <div class="ins-h"><h2 class="h2">Limits</h2><span class="small muted">daily average</span></div>
    <div class="col" style="gap:16px">${lim.map((l) => {
      const st = l.cov < 0.4 && !(l.v > 0) ? 'none' : l.key === 'sodium' ? (l.v <= 2300 ? 'good' : l.v <= 3000 ? 'warn' : 'bad') : (l.p <= 1 ? 'good' : l.p <= 1.3 ? 'warn' : 'bad');
      const top = a.contrib(l.key)[0];
      return `<div class="col" id="ins-l-${l.key}" style="gap:6px;scroll-margin-top:16px">
        <div class="spread" style="align-items:baseline"><span class="s15 b6">${l.name}</span><span class="s14 muted">${fmt(l.v)} / ${fmt(l.limit)} ${l.unit}</span></div>
        <span class="ins-nbar" aria-hidden="true"><span style="width:${Math.min(100, (l.p / 1.5) * 100).toFixed(1)}%;background:${STATUS[st].color}"></span><i style="left:${(100 / 1.5).toFixed(1)}%"></i></span>
        <span class="s13 muted" style="line-height:1.4">${st === 'none' ? 'Not listed on most of your foods.' : `Over on ${l.daysOver} of ${a.n} days.`}${top ? ` Biggest source: ${esc(top.food.name)} (${pct(top.share)}).` : ''}${st === 'bad' || st === 'warn' ? ' Tips under What to change.' : ''}</span>
      </div>`;
    }).join('')}</div>
  </div>`);

  /* ---- 6. Nutrient adequacy ---- */
  const list = a.nutrients.filter((x) => x.key !== 'protein').slice().sort((x, y) => (x.thin - y.thin) || x.p - y.p);
  const shown = showAll ? list : list.slice(0, 10);
  const avgCov = list.filter((x) => !x.thin).reduce((s, x, _, arr) => s + Math.min(1, x.p) / arr.length, 0);
  out.push(`<div class="card ins-card" id="ins-nutrients">
    <div class="ins-h"><h2 class="h2">Nutrients</h2><span class="small muted">avg % of your target</span></div>
    <div class="row" style="gap:16px;margin-bottom:14px">
      ${ring(avgCov, avgCov >= 0.9 ? 'var(--lilac)' : avgCov >= 0.7 ? 'var(--wheat)' : 'var(--rose)', 64, pct(avgCov))}
      <div class="col" style="gap:3px"><span class="s15 b6">Nutrient score</span><span class="s13 muted" style="line-height:1.4">${a.gaps.length ? `${a.gaps.length} below 70% of target, ${a.close.length} close.` : a.close.length ? `No real gaps — ${a.close.length} just under target.` : 'Every nutrient is at or near target.'}${a.estShare > 0.25 ? ` About ${pct(a.estShare)} of these values are estimates.` : ''}</span></div>
    </div>
    <div class="ins-nlist">${shown.map(nutrientBar).join('')}</div>
    <div class="ins-legend" style="margin-top:10px"><span><i style="background:var(--rose)"></i>Under 70%</span><span><i style="background:var(--wheat)"></i>70–90%</span><span><i style="background:var(--lilac)"></i>90%+</span><span><i class="tick"></i>Target</span></div>
    ${list.length > 10 ? `<button class="add-link" data-act="ins-all" style="padding-left:0">${showAll ? 'Show fewer' : `Show all ${list.length}`}</button>` : ''}
    ${a.unknown.length ? `<p class="small muted" style="margin:8px 0 0;line-height:1.45">“?” means most of your foods don't list it (${a.unknown.slice(0, 4).map((x) => x.name.toLowerCase()).join(', ')}${a.unknown.length > 4 ? '…' : ''}), so the total may be low only on paper.</p>` : ''}
  </div>`);

  /* ---- 7. What to change ---- */
  const adds = a.gaps.slice(0, 4).concat(a.gaps.length < 2 ? a.close.slice(0, 2 - a.gaps.length) : []);
  const cuts = a.limits.filter((l) => (l.cov >= 0.4 || l.v > 0) && (l.key === 'sodium' ? l.v > 2300 : l.p > 1));
  const tips = [];
  for (const x of adds) {
    const yours = a.richIn(x.key, x.target);
    const short_ = Math.max(0, x.target - x.v);
    tips.push(`<div class="ins-tipcard" id="ins-tip-${x.key}">
      <div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign add" aria-hidden="true">+</span>
      <div class="col" style="gap:4px;min-width:0;flex:1">
        <span class="s15 b6">More ${esc(x.name.toLowerCase())}</span>
        <span class="s13 muted" style="line-height:1.4">${pct(x.p)} of target · about ${fmt(short_, x.unit)} short a day · hit on ${x.daysMet} of ${a.n} days</span>
        ${yours.length ? `<span class="small muted mt8">Best of the foods you already eat</span>${yours.map((f) => `<span class="s13 row" style="gap:6px"><b class="b6 ellipsis" style="min-width:0;flex:1">${esc(f.food.name)}</b><span class="muted" style="flex:none">${fmt(f.v, x.unit)} · ${pct(f.p)}</span></span>`).join('')}` : ''}
        ${INFO[x.key]?.src ? `<span class="s13" style="line-height:1.4;margin-top:4px"><span class="muted">Good sources:</span> ${esc(INFO[x.key].src)}</span>` : ''}
      </div></div></div>`);
  }
  for (const l of cuts) {
    const top = a.contrib(l.key);
    tips.push(`<div class="ins-tipcard" id="ins-tip-${l.key}">
      <div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign cut" aria-hidden="true">−</span>
      <div class="col" style="gap:4px;min-width:0;flex:1">
        <span class="s15 b6">Less ${esc(l.name.toLowerCase())}</span>
        <span class="s13 muted" style="line-height:1.4">${fmt(l.v)} ${l.unit} a day vs a ${fmt(l.limit)} ${l.unit} limit · over on ${l.daysOver} of ${a.n} days. ${l.why}</span>
        ${top.length ? `<span class="small muted mt8">Biggest sources in your diet</span>${top.map((f) => `<span class="s13 row" style="gap:6px"><b class="b6 ellipsis" style="min-width:0;flex:1">${esc(f.food.name)}</b><span class="muted" style="flex:none">${pct(f.share)} of it</span></span>`).join('')}` : ''}
      </div></div></div>`);
  }
  a.ulHits.forEach((u, i) => {
    tips.push(`<div class="ins-tipcard"${i === 0 ? ' id="ins-tip-ul"' : ''}><div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign cut" aria-hidden="true">!</span>
      <div class="col" style="gap:4px"><span class="s15 b6">${esc(u.name)} over the upper limit</span><span class="s13 muted" style="line-height:1.4">Above ${fmt(u.ul, u.unit)} on ${u.days} day${u.days === 1 ? '' : 's'} (up to ${fmt(u.max, u.unit)}). Check supplement doses and fortified foods.</span></div></div></div>`);
  });
  if (a.omega && !a.omega.thin && a.omega.ratio > 4) {
    const top6 = a.contrib('omega6').slice(0, 3);
    const need3 = Math.max(0, a.omega.n6 / 4 - a.omega.n3);
    tips.push(`<div class="ins-tipcard" id="ins-tip-omega"><div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign add" aria-hidden="true">+</span>
      <div class="col" style="gap:4px;min-width:0;flex:1"><span class="s15 b6">Better omega-6 : omega-3 balance</span>
      <span class="s13 muted" style="line-height:1.4">You're at ${ratioText(a.omega.ratio)}. Getting to 4 : 1 takes about ${fmt(need3)} g more omega-3 a day (a 3 oz serving of salmon has about 1.8 g), or less omega-6.</span>
      ${top6.length ? `<span class="small muted mt8">Most of your omega-6 comes from</span>${top6.map((f) => `<span class="s13 row" style="gap:6px"><b class="b6 ellipsis" style="min-width:0;flex:1">${esc(f.food.name)}</b><span class="muted" style="flex:none">${pct(f.share)}</span></span>`).join('')}` : ''}
      <span class="s13" style="line-height:1.4;margin-top:4px"><span class="muted">Omega-3 sources:</span> ${esc(INFO.omega3.src)}</span>
      </div></div></div>`);
  }
  if (a.caffeine) tips.push(`<div class="ins-tipcard"><div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign cut" aria-hidden="true">!</span><div class="col" style="gap:4px"><span class="s15 b6">Caffeine</span><span class="s13 muted" style="line-height:1.4">Over ${a.caffeine.limit} mg on ${a.caffeine.days} day${a.caffeine.days === 1 ? '' : 's'}.</span></div></div></div>`);
  // Calorie advice tied to the goal
  if (a.lbWeek != null && g.kind !== 'maintain') {
    const need = g.daily - a.avgBal; // kcal/day to change
    if ((g.kind === 'lose' && need < -60) || (g.kind === 'gain' && need > 60)) {
      const top = Object.values(a.foodAgg).map((x) => ({ ...x, kcal: ((x.food.per100?.energy?.v || 0) * x.grams) / 100 / a.n })).sort((p, q) => q.kcal - p.kcal).slice(0, 3);
      tips.unshift(`<div class="ins-tipcard"><div class="row" style="gap:10px;align-items:flex-start"><span class="ins-sign ${g.kind === 'lose' ? 'cut' : 'add'}" aria-hidden="true">${g.kind === 'lose' ? '−' : '+'}</span>
        <div class="col" style="gap:4px;min-width:0;flex:1"><span class="s15 b6">${g.kind === 'lose' ? 'Eat' : 'Add'} about ${Math.abs(Math.round(need / 10) * 10)} kcal ${g.kind === 'lose' ? 'less' : 'more'} a day</span>
        <span class="s13 muted" style="line-height:1.4">That closes the gap to ${Math.abs(g.rate)} lb a week.${g.kind === 'lose' ? ' Or add the same amount of activity.' : ''}</span>
        ${g.kind === 'lose' && top.length ? `<span class="small muted mt8">Where your calories come from</span>${top.map((f) => `<span class="s13 row" style="gap:6px"><b class="b6 ellipsis" style="min-width:0;flex:1">${esc(f.food.name)}</b><span class="muted" style="flex:none">${Math.round(f.kcal)} kcal/day</span></span>`).join('')}` : ''}
        </div></div></div>`);
    }
  }
  out.push(`<div class="card ins-card" id="ins-change"><div class="ins-h"><h2 class="h2">What to change</h2><span class="small muted">${tips.length ? `${tips.length} suggestion${tips.length === 1 ? '' : 's'}` : ''}</span></div>
    ${tips.length ? `<div class="col" style="gap:10px">${tips.join('')}</div>` : `<div class="row" style="gap:10px">${badge('good', 'All good')}<span class="s14">No gaps or excesses worth changing. Keep eating the way you are.</span></div>`}
  </div>`);

  /* ---- 8. Patterns ---- */
  const wd = a.weekday.filter((w) => w.avg != null);
  const we = a.weekday.filter((w) => [0, 6].includes(w.day) && w.avg != null), wdy = a.weekday.filter((w) => ![0, 6].includes(w.day) && w.avg != null);
  const avgW = (xs) => xs.reduce((s, w) => s + w.avg * w.n, 0) / (xs.reduce((s, w) => s + w.n, 0) || 1);
  let patt = '';
  if (we.length && wdy.length) {
    const diff = avgW(we) - avgW(wdy);
    patt = Math.abs(diff) < 100 ? 'You eat about the same on weekends as on weekdays.' : `You eat about <b class="b6">${Math.abs(Math.round(diff)).toLocaleString()} kcal ${diff > 0 ? 'more' : 'less'}</b> on weekend days than on weekdays.`;
  }
  const mt = a.meals.reduce((s, m) => s + m.kcal, 0) || 1;
  const maxMeal = Math.max(...a.meals.map((m) => m.kcal), 1);
  if (wd.length >= 2) out.push(`<div class="card ins-card ins-chart" id="ins-patterns">
    <div class="ins-h"><h2 class="h2">Patterns</h2><span class="small muted">avg kcal by day</span></div>
    ${weekdayChart(a)}
    <div class="ins-legend"><span><i style="background:var(--sky)"></i>At or under target</span><span><i style="background:var(--wheat)"></i>Over</span>${a.avgTarget ? `<span><i class="dash"></i>Target ${Math.round(a.avgTarget).toLocaleString()}</span>` : ''}</div>
    <div class="ins-tip s13 muted" aria-live="polite">Tap a day for its average.</div>
    ${patt ? `<p class="s14" style="margin:10px 0 0;line-height:1.5">${patt}</p>` : ''}
    <h3 class="s14 b6" style="margin:18px 0 10px">Calories by meal</h3>
    <div class="col" style="gap:10px">${a.meals.filter((m) => m.kcal > 0).map((m) => `<div class="ins-mrow"><span class="s14 ellipsis">${esc(m.name)}</span><span class="ins-nbar"><span style="width:${((m.kcal / maxMeal) * 100).toFixed(1)}%;background:var(--sky)"></span></span><span class="s13 muted" style="text-align:right">${Math.round(m.kcal)} · ${pct(m.kcal / mt)}</span></div>`).join('')}</div>
  </div>`);

  /* ---- 9. Logging ---- */
  const cells = a.days.slice(-91).map((d) => `<span class="ins-cell ${d.logged ? (d.partial ? 'part' : 'full') : ''}" title="${short(d.date)}"></span>`).join('');
  const topFoods = Object.values(a.foodAgg).sort((p, q) => q.days.size - p.days.size).slice(0, 5);
  out.push(`<div class="card ins-card" id="ins-logging">
    <div class="ins-h"><h2 class="h2">Logging</h2><span class="small muted">${a.logged.length} of ${a.spanDays} days</span></div>
    <div class="ins-cal" aria-label="${a.logged.length} of ${a.spanDays} days logged">${cells}</div>
    <div class="ins-legend" style="margin-top:10px"><span><i style="background:var(--lilac)"></i>Logged</span><span><i style="background:var(--wheat)"></i>Partly logged</span><span><i style="background:var(--fill-2)"></i>Not logged</span></div>
    <p class="s14" style="margin:12px 0 0;line-height:1.5">${a.logged.length / a.spanDays >= 0.85 ? 'Great consistency — these insights are reliable.' : a.logged.length / a.spanDays >= 0.5 ? 'Logging more days will make these insights sharper.' : 'With few logged days, treat these insights as rough.'}${a.partial.length ? ` Days under ${Math.round(Math.max(800, 0.45 * (a.avgTarget || 2000)))} kcal look incomplete and are left out of averages.` : ''}${a.includesToday ? ' Today is included because it\'s the only day logged so far.' : ' Today is left out until it\'s over.'}</p>
    ${topFoods.length ? `<h3 class="s14 b6" style="margin:16px 0 8px">Your staples</h3><div class="list">${topFoods.map((f) => `<a class="spread ins-li" href="#/food/${encodeURIComponent(f.food.id)}"><span class="s14 ellipsis" style="min-width:0">${esc(f.food.name)}</span><span class="s13 muted" style="flex:none">${f.days.size} day${f.days.size === 1 ? '' : 's'}</span></a>`).join('')}</div>` : ''}
  </div>`);

  return head + `<section class="screen col mt16" style="gap:12px;padding-bottom:28px">${out.join('')}
    <p class="small muted" style="margin:4px 4px 0;line-height:1.5">Projections use 3,500 kcal per pound and your logged food, which is never perfect. This is guidance, not medical advice.</p></section>`;
}
