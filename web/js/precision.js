// Labels are rounded summaries (FDA 21 CFR 101.9): calories to 5 or 10, macros to 1 g or 0.5 g, and any
// vitamin or mineral under 2% of the Daily Value can be printed as 0. Lab and spec-sheet data keep full
// precision. When a precise value rounds to what the label prints, it's the same fact with more digits,
// so we keep the precise one. When it doesn't, the product differs from the reference and the label wins.

// FDA Daily Values (2016 rule), in this app's units.
const DV = {
  b1: 1.2, b2: 1.3, b3: 16, b5: 5, b6: 1.7, b12: 2.4, biotin: 30, choline: 550, folate: 400,
  vit_a: 900, vit_c: 90, vit_d: 800 /* IU = 20 µg */, vit_e: 15, vit_k: 120,
  calcium: 1300, chromium: 35, copper: 0.9, iodine: 150, iron: 18, magnesium: 420, manganese: 2.3,
  molybdenum: 45, phosphorus: 1250, potassium: 4700, selenium: 55, zinc: 11
};

const GRAM_MACROS = ['carbs', 'fiber', 'fiber_sol', 'fiber_insol', 'sugars', 'added_sugars', 'sugar_alcohols', 'allulose', 'protein'];
const FATS = ['fat', 'sat_fat', 'trans_fat', 'mono_fat', 'poly_fat'];

// Smallest step the printed number shows: "0.8" → 0.1, "21" → 1, "20" → 10.
function stepOf(p) {
  const s = String(+p.toFixed(6));
  if (s.includes('.')) return Math.pow(10, -s.split('.')[1].length);
  return p >= 10 && p % 10 === 0 ? 10 : 1;
}

// Could `precise` have been printed as `printed` under the label rounding rules?
export function roundsTo(key, printed, precise) {
  const p = Number(printed), x = Number(precise);
  if (!Number.isFinite(p) || !Number.isFinite(x) || x < 0) return false;
  const eps = 1e-9;
  const near = (step) => Math.abs(x - p) <= step / 2 + eps;
  if (key === 'energy') return p === 0 ? x < 5 : near(p <= 50 ? 5 : 10);
  if (FATS.includes(key)) return p === 0 ? x < 0.5 : near(p < 5 ? 0.5 : 1);
  if (key === 'cholesterol') return p === 0 ? x < 2 : p <= 5 ? x < 5 + eps : near(5);
  if (key === 'sodium') return p === 0 ? x < 5 : near(p <= 140 ? 5 : 10);
  if (GRAM_MACROS.includes(key)) return p === 0 ? x < 1 : near(1);
  const dv = DV[key];
  if (key === 'potassium') return p === 0 ? x < 0.02 * dv : near(p <= 140 ? 5 : 10) || Math.abs(x - p) <= dvTolerance(p, dv);
  if (dv) {
    if (p === 0) return x < 0.02 * dv;
    return near(stepOf(p)) || Math.abs(x - p) <= dvTolerance(p, dv);
  }
  // Not a label nutrient with a Daily Value: only the printed digits count.
  return p === 0 ? x === 0 : near(stepOf(p));
}

// %DV is printed in 2% steps under 10%, 5% steps up to 50%, then 10% steps; allow half a step either way.
function dvTolerance(p, dv) {
  const pct = (p / dv) * 100;
  return dv * (pct < 10 ? 0.01 : pct <= 50 ? 0.025 : 0.05);
}

/**
 * Merge per-serving values from the label, the manufacturer's spec sheet, USDA lab data and estimates.
 * Returns { values: {key: {v, src, refined?}}, refined: [keys whose label value was replaced by a precise one] }.
 * scaleGroups: amino acids follow the final protein, fatty acids the final fat (lab values only).
 */
export function mergePrecise({ label = {}, spec = {}, lab = {}, est = {} }, { keys, amino = [], fatty = [] }) {
  const num = (o, k) => (o[k] != null && Number.isFinite(Number(o[k])) && Number(o[k]) >= 0 ? Number(o[k]) : null);
  const values = {};
  const refined = [];
  for (const k of keys) {
    const L = num(label, k), S = num(spec, k), B = num(lab, k), E = num(est, k);
    if (L != null) {
      if (S != null && roundsTo(k, L, S)) { values[k] = { v: S, src: 'spec' }; if (S !== L) refined.push(k); }
      else if (B != null && roundsTo(k, L, B)) { values[k] = { v: B, src: 'lab' }; if (B !== L) refined.push(k); }
      // No measured value, but a rounded-away amount is still an amount: a precise estimate that rounds to the
      // printed number beats a hard 0, so small amounts add up across the day.
      else if (E != null && E !== L && roundsTo(k, L, E) && (S == null || !roundsTo(k, L, S)) && (B == null || !roundsTo(k, L, B))) { values[k] = { v: E, src: 'est' }; refined.push(k); }
      else values[k] = { v: L, src: 'label' };
    } else if (S != null) values[k] = { v: S, src: 'spec' };
    else if (B != null) values[k] = { v: B, src: 'lab' };
    else if (E != null) values[k] = { v: E, src: 'est' };
  }
  // Lab amino acids describe the reference food's protein; match them to this product's protein (same for fats).
  const rescale = (group, totalKey) => {
    const final = values[totalKey]?.v, ref = num(lab, totalKey);
    if (!(final > 0) || !(ref > 0)) return;
    const r = Math.min(3, Math.max(1 / 3, final / ref));
    for (const k of group) if (num(label, k) == null && values[k]?.src === 'lab' && values[k].v === num(lab, k)) values[k].v *= r;
  };
  rescale(amino, 'protein');
  rescale(fatty, 'fat');
  return { values, refined };
}
