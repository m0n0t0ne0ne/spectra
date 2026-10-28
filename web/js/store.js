// Settings, saved foods, the diary, weights and workouts. Everything stays on the device.
import { NUTRIENTS, BY_KEY } from './nutrients.js';
import { driFor, MACRO_KEYS, lifeStageCalories } from './nutrient-info.js';

const K = { settings: 'nt.settings', foods: 'nt.foods', log: 'nt.log', weights: 'nt.weights', activities: 'nt.activities' };

// In the Android app, data lives in files in the app's private storage (no size cap beyond free space).
// In a browser it falls back to localStorage. Raw JSON strings are kept in memory so reads stay fast.
const bridge = typeof window !== 'undefined' ? window.AndroidBridge : null;
const NATIVE_STORE = !!(bridge && typeof bridge.storeRead === 'function' && typeof bridge.storeWrite === 'function');
const mem = {};
function rawGet(key) {
  if (!NATIVE_STORE) { try { return localStorage.getItem(key); } catch { return null; } }
  if (key in mem) return mem[key];
  let s = null;
  try {
    if (NATIVE_STORE) {
      s = bridge.storeRead(key) || null;
      // First run after the update: move what's in localStorage into the file, then free the old copy.
      if (s == null) {
        const old = localStorage.getItem(key);
        if (old != null && bridge.storeWrite(key, old)) { s = old; localStorage.removeItem(key); }
      }
    } else s = localStorage.getItem(key);
  } catch { s = null; }
  mem[key] = s;
  return s;
}
function read(key, fallback) {
  try { const raw = rawGet(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function write(key, value) {
  const str = JSON.stringify(value);
  let ok = false;
  try { ok = NATIVE_STORE ? !!bridge.storeWrite(key, str) : (localStorage.setItem(key, str), true); } catch { ok = false; }
  if (ok) { if (NATIVE_STORE) mem[key] = str; }
  else if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nt-storage-error', { detail: key }));
  return ok;
}

// Bytes each part of your data takes, and the phone's free space when known.
export function storageUsage() {
  const enc = new TextEncoder();
  const size = (k) => { const r = rawGet(k); return r ? enc.encode(r).length : 0; };
  let info = null;
  if (NATIVE_STORE && typeof bridge.storeInfo === 'function') { try { info = JSON.parse(bridge.storeInfo()); } catch { info = null; } }
  const log = read(K.log, {});
  return {
    native: NATIVE_STORE,
    foods: size(K.foods), log: size(K.log), other: size(K.weights) + size(K.activities) + size(K.settings),
    foodCount: Object.keys(read(K.foods, {})).length,
    dayCount: Object.values(log).filter((l) => l.length).length,
    free: info?.free ?? null, total: info?.total ?? null,
    // localStorage in a browser is capped at about 5 MB
    cap: NATIVE_STORE ? null : 5 * 1024 * 1024
  };
}

// A range is null (everything), {from, to}, or a test function on the date.
const inRange = (d, r) => !r || (typeof r === 'function' ? r(d) : d >= r.from && d <= r.to);
const pick = (obj, r) => Object.fromEntries(Object.entries(obj || {}).filter(([d]) => inRange(d, r)));

// A backup of everything, or only the days in range (with the foods those days use).
// parts limits what's included: 'diary' (log + foods it uses), 'body' (weights + workouts). Default: both.
export function exportData(range = null, parts = ['diary', 'body']) {
  const s = store.settings();
  const log = parts.includes('diary') ? pick(store.log(), range) : {};
  const allFoods = store.foods();
  const used = new Set(Object.values(log).flat().map((e) => e.foodId));
  const foods = range || !parts.includes('diary') ? Object.fromEntries(Object.entries(allFoods).filter(([id]) => used.has(id))) : allFoods;
  return {
    app: 'spectra', version: 2, exportedAt: new Date().toISOString(), range: typeof range === 'function' ? null : range,
    settings: range ? { meals: store.meals() } : { ...s, claudeKey: undefined, geminiKey: undefined, braveKey: undefined, fdcKey: undefined },
    foods, log,
    weights: parts.includes('body') ? pick(store.weights(), range) : {},
    activities: parts.includes('body') ? pick(read(K.activities, {}), range) : {}
  };
}

/* ---------------- managing stored data ---------------- */

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

// Diary, weights and workouts by month, and every saved food with how often it's used.
export function dataBreakdown() {
  const log = store.log(), weights = store.weights(), acts = read(K.activities, {}), foods = store.foods();
  const months = (obj, fn) => {
    const out = {};
    for (const [d, v] of Object.entries(obj || {})) { const m = d.slice(0, 7); fn((out[m] = out[m] || { month: m, days: 0, entries: 0, weighins: 0, workouts: 0, bytes: 0 }), d, v); }
    return out;
  };
  const diary = months(log, (o, d, list) => { if (list.length) { o.days++; o.entries += list.length; } o.bytes += bytes(list) + d.length + 4; });
  const body = months(weights, (o, d, v) => { o.weighins++; o.bytes += bytes(v) + d.length + 4; });
  for (const [d, list] of Object.entries(acts)) {
    const m = d.slice(0, 7), o = (body[m] = body[m] || { month: m, days: 0, entries: 0, weighins: 0, workouts: 0, bytes: 0 });
    o.workouts += list.length; o.bytes += bytes(list) + d.length + 4;
  }
  const use = {};
  for (const [d, list] of Object.entries(log)) for (const e of list) { const u = (use[e.foodId] = use[e.foodId] || { uses: 0, days: new Set(), last: '' }); u.uses++; u.days.add(d); if (d > u.last) u.last = d; }
  const foodList = Object.values(foods).map((f) => ({ id: f.id, name: f.name, brand: f.brand || '', bytes: bytes(f), uses: use[f.id]?.uses || 0, days: use[f.id]?.days.size || 0, last: use[f.id]?.last || '' }));
  const sort = (o) => Object.values(o).sort((a, b) => b.month.localeCompare(a.month));
  return { diary: sort(diary).filter((m) => m.days || m.bytes), body: sort(body), foods: foodList };
}

// Delete diary days (and their order) for the months given. Foods stay saved.
export function deleteDiaryMonths(months) {
  const set = new Set(months), log = store.log();
  let days = 0;
  for (const d of Object.keys(log)) if (set.has(d.slice(0, 7))) { if (log[d].length) days++; delete log[d]; }
  write(K.log, log);
  return days;
}
export function deleteBodyMonths(months) {
  const set = new Set(months), w = store.weights(), a = read(K.activities, {});
  let n = 0;
  for (const d of Object.keys(w)) if (set.has(d.slice(0, 7))) { delete w[d]; n++; }
  for (const d of Object.keys(a)) if (set.has(d.slice(0, 7))) { n += a[d].length; delete a[d]; }
  write(K.weights, w); write(K.activities, a);
  return n;
}
// Only foods no diary entry uses can be deleted, so no entry ever loses its nutrients.
export function deleteFoods(ids) {
  const used = new Set(Object.values(store.log()).flat().map((e) => e.foodId));
  const all = store.foods();
  let n = 0;
  for (const id of ids) if (!used.has(id) && all[id]) { delete all[id]; n++; }
  write(K.foods, all);
  return n;
}

// What importing would do, without changing anything.
export function importPreview(data, range, mode) {
  const log = store.log();
  const days = Object.keys(data.log || {}).filter((d) => (data.log[d] || []).length && inRange(d, range)).sort();
  const clash = days.filter((d) => (log[d] || []).length);
  return {
    days: days.length, from: days[0] || null, to: days[days.length - 1] || null,
    add: days.length - clash.length, clash: clash.length,
    changed: mode === 'replace' ? days.length : days.length - clash.length
  };
}

export function importData(data, range, mode) {
  const replace = mode === 'replace';
  const log = store.log(), foods = store.foods(), weights = store.weights(), acts = read(K.activities, {});
  const meals = store.meals();
  const usedMeals = new Set();
  let days = 0;
  for (const [d, list] of Object.entries(data.log || {})) {
    if (!list?.length || !inRange(d, range)) continue;
    if ((log[d] || []).length && !replace) continue;
    log[d] = list.map((e) => ({ ...e }));
    list.forEach((e) => usedMeals.add(e.meal));
    days++;
  }
  // Foods those days use; foods you already have stay as they are.
  const need = new Set(Object.values(data.log || {}).flat().map((e) => e.foodId));
  for (const [id, f] of Object.entries(data.foods || {})) if (!foods[id] && need.has(id)) foods[id] = f;
  for (const [d, v] of Object.entries(data.weights || {})) if (inRange(d, range) && (replace || weights[d] == null)) weights[d] = v;
  for (const [d, v] of Object.entries(data.activities || {})) if (inRange(d, range) && (replace || !(acts[d] || []).length)) acts[d] = v;
  // Meals that only exist in the backup come back too, so imported entries have somewhere to show.
  const backupMeals = data.settings?.meals || [];
  for (const k of usedMeals) {
    if (meals.some((m) => m.key === k)) continue;
    const name = backupMeals.find((m) => m.key === k)?.name || ({ breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' }[k]) || 'Meal';
    meals.push({ key: k, name });
  }
  const ok = write(K.foods, foods) && write(K.log, log) && write(K.weights, weights) && write(K.activities, acts);
  store.saveMeals(meals);
  return { ok, days };
}

const DEFAULT_MEALS = [
  { key: 'breakfast', name: 'Breakfast' }, { key: 'lunch', name: 'Lunch' },
  { key: 'snacks', name: 'Snacks' }, { key: 'dinner', name: 'Dinner' }
];
const DEFAULT_SETTINGS ={ claudeKey: '', model: 'claude-sonnet-5-5', fdcKey: '', targets: {}, name: '' };

export const store = {
  settings() { return { ...DEFAULT_SETTINGS, ...read(K.settings, {}) }; },
  saveSettings(patch) { const s = { ...this.settings(), ...patch }; write(K.settings, s); return s; },

  // Macros use the targets you set. Everything else uses the Dietary Reference Intakes for your
  // age and sex, unless you've switched on a custom target for that nutrient.
  target(key) {
    if (key === 'energy') { const auto = autoEnergyTarget(); if (auto != null) return auto; }
    const s = this.settings();
    const t = s.targets[key];
    const hasCustom = t != null && t !== '';
    if (MACRO_KEYS.includes(key)) return hasCustom ? Number(t) : BY_KEY[key]?.target ?? null;
    if (s.customOn?.[key] && hasCustom) return Number(t);
    const d = this.dri(key);
    return d ? d.value : BY_KEY[key]?.target ?? null;
  },
  dri(key) {
    const p = this.profile();
    return driFor(key, { ...p, age: p.age || 30, weightLbs: this.weightOn(todayISO())?.lbs ?? null });
  },
  customOn(key) { return !!this.settings().customOn?.[key]; },
  setCustomOn(key, on) {
    const s = this.settings();
    const customOn = { ...(s.customOn || {}) };
    if (on) customOn[key] = true; else delete customOn[key];
    const patch = { customOn };
    if (on && (s.targets[key] == null || s.targets[key] === '')) patch.targets = { ...s.targets, [key]: this.dri(key)?.value ?? BY_KEY[key]?.target ?? '' };
    this.saveSettings(patch);
  },
  setTarget(key, value) {
    const s = this.settings();
    const targets = { ...s.targets };
    if (value === '' || value == null) delete targets[key]; else targets[key] = Number(value);
    this.saveSettings({ targets });
  },

  foods() { return read(K.foods, {}); },
  food(id) { return this.foods()[id] || null; },
  saveFood(food) { const all = this.foods(); all[food.id] = { ...food, savedAt: Date.now() }; write(K.foods, all); return all[food.id]; },
  recentFoods(limit = 20) {
    return Object.values(this.foods()).sort((a, b) => (b.usedAt || b.savedAt || 0) - (a.usedAt || a.savedAt || 0)).slice(0, limit);
  },

  log() { return read(K.log, {}); },
  day(date) { return (this.log()[date] || []).slice().sort((a, b) => a.ts - b.ts); },
  addEntry(date, entry) {
    const log = this.log();
    const e = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...entry };
    // In a meal you've rearranged, new foods go to the bottom.
    const orders = (log[date] || []).filter((x) => x.meal === e.meal && x.order != null).map((x) => x.order);
    if (orders.length) e.order = Math.max(...orders) + 1; else delete e.order;
    (log[date] = log[date] || []).push(e);
    write(K.log, log);
    const f = this.food(entry.foodId);
    if (f) this.saveFood({ ...f, usedAt: Date.now() });
    return e;
  },
  updateEntry(date, id, patch) {
    const log = this.log();
    log[date] = (log[date] || []).map((e) => (e.id === id ? { ...e, ...patch } : e));
    write(K.log, log);
  },
  removeEntry(date, id) {
    const log = this.log();
    log[date] = (log[date] || []).filter((e) => e.id !== id);
    write(K.log, log);
  },
  // Save the order you dragged a meal's foods into.
  reorderMeal(date, meal, ids) {
    const log = this.log();
    (log[date] || []).forEach((e) => { if (e.meal === meal) { const i = ids.indexOf(e.id); if (i >= 0) e.order = i; } });
    write(K.log, log);
  },
  copyMeal(fromDate, meal, toDate) {
    const items = sortMeal(this.day(fromDate).filter((e) => e.meal === meal));
    const dayShift = new Date(toDate + 'T00:00:00').getTime() - new Date(fromDate + 'T00:00:00').getTime();
    items.forEach((e) => this.addEntry(toDate, { foodId: e.foodId, grams: e.grams, unit: e.unit, qty: e.qty, meal: e.meal, ts: e.ts + dayShift }));
    return items.length;
  },
  clearMeal(date, meal) {
    const log = this.log();
    log[date] = (log[date] || []).filter((e) => e.meal !== meal);
    write(K.log, log);
  },

  // ---- profile, weight and activities ----
  // Meals in the order the diary shows them. Defaults to the classic four; you can add, rename, reorder, delete.
  meals() {
    const m = this.settings().meals;
    return Array.isArray(m) && m.length ? m : DEFAULT_MEALS.map((x) => ({ ...x }));
  },
  saveMeals(list) { this.saveSettings({ meals: list.map((m) => ({ key: m.key, name: m.name })) }); },
  addMeal(name, afterKey = null) {
    const list = this.meals();
    const base = 'm_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16);
    let key = base, n = 2;
    while (list.some((m) => m.key === key)) key = base + n++;
    const i = afterKey ? list.findIndex((m) => m.key === afterKey) : -1;
    list.splice(i >= 0 ? i + 1 : list.length, 0, { key, name });
    this.saveMeals(list);
    return key;
  },
  renameMeal(key, name) { this.saveMeals(this.meals().map((m) => (m.key === key ? { ...m, name } : m))); },
  moveMeal(key, dir) {
    const list = this.meals();
    const i = list.findIndex((m) => m.key === key), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.saveMeals(list);
  },
  // How many foods are logged in a meal, across every day.
  mealUsage(key) {
    let entries = 0, days = 0;
    for (const list of Object.values(this.log())) { const n = list.filter((e) => e.meal === key).length; entries += n; if (n) days++; }
    return { entries, days };
  },
  // Delete a meal; foods logged in it move to another meal so no history is lost.
  deleteMeal(key, moveTo) {
    const list = this.meals().filter((m) => m.key !== key);
    if (!list.length) return false;
    const all = this.log();
    for (const d of Object.keys(all)) all[d] = all[d].map((e) => (e.meal === key ? { ...e, meal: moveTo, order: undefined } : e));
    write(K.log, all);
    this.saveMeals(list);
    return true;
  },

  profile() { return { sex: 'male', age: '', heightIn: '', activity: 'sedentary', tef: false, goal: 'maintain', rateLb: 0.5, autoTarget: false, stage: 'none', trimester: 1, months: 1, diet: 'omnivore', smoker: false, ...(this.settings().profile || {}) }; },
  saveProfile(patch) { return this.saveSettings({ profile: { ...this.profile(), ...patch } }); },
  weights() { return read(K.weights, {}); },
  setWeight(date, lbs) { const w = this.weights(); if (lbs === '' || lbs == null || !(Number(lbs) > 0)) delete w[date]; else w[date] = Number(lbs); write(K.weights, w); },
  // Most recent weight on or before a date.
  // Your weight on a date: the latest weigh-in on or before it. Days before your first weigh-in use that
  // first weigh-in, so calories burned can still be estimated for them.
  weightOn(date) {
    const w = this.weights();
    const keys = Object.keys(w).sort();
    const d = keys.filter((k) => k <= date).pop() ?? keys[0];
    return d ? { date: d, lbs: w[d] } : null;
  },
  activities(date) { return (read(K.activities, {})[date] || []).slice().sort((a, b) => a.ts - b.ts); },
  saveActivity(date, a) {
    const all = read(K.activities, {});
    const list = all[date] || [];
    const item = { ...a, id: a.id || 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) };
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    all[date] = list; write(K.activities, all);
    return item;
  },
  removeActivity(date, id) { const all = read(K.activities, {}); all[date] = (all[date] || []).filter((x) => x.id !== id); write(K.activities, all); },

  allActivities() { return read(K.activities, {}); }
};

// A meal's foods in your order: dragged order first, otherwise the time they were logged.
export function sortMeal(items) {
  return items.slice().sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.ts - b.ts);
}

// Totals for a list of entries. Returns { key: { v, est } } where est is the estimated share of v.
export function totals(entries) {
  const out = {};
  for (const e of entries) {
    const f = store.food(e.foodId);
    if (!f) continue;
    const k = e.grams / 100;
    for (const [key, cell] of Object.entries(f.per100 || {})) {
      if (cell?.v == null || key === 'energy_kj') continue;
      const t = (out[key] = out[key] || { v: 0, est: 0, foods: [] });
      const add = cell.v * k;
      t.v += add;
      if (cell.src === 'est') t.est += add;
      if (add > 0) t.foods.push({ name: f.name, v: add });
    }
  }
  // kJ always follows calories.
  if (out.energy) out.energy_kj = { v: out.energy.v * 4.184, est: out.energy.est * 4.184, foods: out.energy.foods.map((f) => ({ name: f.name, v: f.v * 4.184 })) };
  for (const t of Object.values(out)) {
    t.estShare = t.v > 0 ? t.est / t.v : 0;
    t.foods.sort((a, b) => b.v - a.v);
  }
  return out;
}

// Share of nutrient targets met (limits excluded), like a nutrition score.
export function coverage(tot) {
  const keys = NUTRIENTS.filter((n) => !n.limit && store.target(n.key));
  if (!keys.length) return 0;
  const sum = keys.reduce((a, n) => a + Math.min(1, (tot[n.key]?.v || 0) / store.target(n.key)), 0);
  return sum / keys.length;
}

export function todayISO(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

/* ---------------- energy expenditure ---------------- */

export const ACTIVITY_LEVELS = {
  sedentary: { name: 'Sedentary', sub: 'Desk job, little walking', f: 0.2 },
  light: { name: 'Lightly active', sub: 'On your feet some of the day', f: 0.375 },
  moderate: { name: 'Moderately active', sub: 'On your feet most of the day', f: 0.55 },
  very: { name: 'Very active', sub: 'Physical job', f: 0.725 }
};

// Mifflin-St Jeor resting metabolic rate. Needs age, height and a logged weight.
export function bmrFor(date = todayISO()) {
  const p = store.profile();
  const w = store.weightOn(date);
  const age = Number(p.age), hIn = Number(p.heightIn);
  if (!w || !(age > 0) || !(hIn > 0)) return null;
  const kg = w.lbs * 0.45359237, cm = hIn * 2.54;
  return 10 * kg + 6.25 * cm - 5 * age + (p.sex === 'female' ? -161 : 5);
}

// Everything burned in a day: BMR + baseline activity level + logged activities (+ digestion if enabled).
export function dayEnergy(date, consumedKcal = 0) {
  const p = store.profile();
  const bmr = bmrFor(date);
  const acts = store.activities(date).reduce((a, x) => a + (Number(x.kcal) || 0), 0);
  if (bmr == null) return { ready: false, activities: acts };
  const baseline = bmr * (ACTIVITY_LEVELS[p.activity]?.f ?? 0.2);
  const tef = p.tef ? consumedKcal * 0.1 : 0;
  const burned = bmr + baseline + acts + tef;
  return { ready: true, bmr, baseline, activities: acts, tef, burned, balance: consumedKcal - burned };
}

// Today's calorie target: your target plus the calories from workouts you logged that day,
// so exercising raises what you can eat and the deficit or surplus you planned stays the same.
export function energyTargetFor(date = todayISO()) {
  const base = store.target('energy') || 0;
  const activities = store.activities(date).reduce((a, x) => a + (Number(x.kcal) || 0), 0);
  const adds = store.settings().workoutsInTarget !== false;
  return { base, activities: adds ? activities : 0, total: base + (adds ? activities : 0), adds };
}

// Energy target from the weight goal: maintenance (BMR + baseline) adjusted 500 kcal per lb/week.
export function autoEnergyTarget(date = todayISO()) {
  const p = store.profile();
  if (!p.autoTarget) return null;
  const bmr = bmrFor(date);
  if (bmr == null) return null;
  const maint = bmr * (1 + (ACTIVITY_LEVELS[p.activity]?.f ?? 0.2)) + lifeStageCalories(p);
  const adj = p.goal === 'lose' ? -500 * Number(p.rateLb || 0) : p.goal === 'gain' ? 500 * Number(p.rateLb || 0) : 0;
  return Math.round(maint + adj);
}

// Calories for an activity from its MET value: MET × kg × hours.
export const ACTIVITY_TYPES = [
  { name: 'Walking', met: 3.5 }, { name: 'Brisk walking', met: 4.8 }, { name: 'Running', met: 9.8 },
  { name: 'Cycling', met: 7.5 }, { name: 'Strength training', met: 5.0 }, { name: 'HIIT', met: 8.0 },
  { name: 'Swimming', met: 7.0 }, { name: 'Hiking', met: 6.0 }, { name: 'Yoga', met: 2.5 },
  { name: 'Pilates', met: 3.0 }, { name: 'Elliptical', met: 5.0 }, { name: 'Rowing', met: 7.0 },
  { name: 'Sports', met: 7.0 }, { name: 'Dancing', met: 5.0 }, { name: 'Other', met: null }
];
export function activityKcal(met, minutes, date = todayISO()) {
  const w = store.weightOn(date);
  if (!met || !w || !(minutes > 0)) return null;
  return Math.round(met * w.lbs * 0.45359237 * (minutes / 60));
}
