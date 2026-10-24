// Turns pasted nutrition text (from Gemini, a spec sheet, a website) into catalog values.
// Works offline with a line parser; uses the AI provider, when one is set up, for messy text and tables.
import { NUTRIENTS, BY_KEY } from './nutrients.js';
import { askAI, hasAI, parseJSON } from './api.js';

// Extra names people and spec sheets use. Catalog names are added automatically.
const ALIASES = {
  energy: ['calories', 'energy', 'kcal'],
  protein: ['protein', 'total protein'],
  carbs: ['total carbohydrate', 'total carbohydrates', 'carbohydrate', 'carbohydrates', 'carbs', 'total carbs'],
  energy_kj: ['kilojoules', 'kj'],
  ash: ['ash'],
  bhb: ['beta-hydroxybutyrate', 'beta hydroxybutyrate', 'bhb'],
  oxalate: ['oxalates', 'oxalate', 'oxalic acid'],
  phytate: ['phytates', 'phytate', 'phytic acid'],
  fiber_insol: ['insoluble fiber', 'insoluble fibre', 'fiber, insoluble', 'fiber insoluble', 'insoluble'],
  fiber_sol: ['soluble fiber', 'soluble fibre', 'fiber, soluble', 'fiber soluble', 'soluble'],
  allulose: ['allulose', 'psicose'],
  fructose: ['fructose'],
  galactose: ['galactose'],
  glucose: ['glucose', 'dextrose'],
  lactose: ['lactose'],
  maltose: ['maltose'],
  sucrose: ['sucrose'],
  sugar_alcohols: ['sugar alcohols', 'sugar alcohol', 'polyols'],
  phytosterols: ['phytosterols', 'phytosterol', 'plant sterols'],
  cryptoxanthin: ['beta-cryptoxanthin', 'beta cryptoxanthin', 'cryptoxanthin'],
  toco_alpha: ['alpha-tocopherol', 'alpha tocopherol'],
  toco_beta: ['beta-tocopherol', 'beta tocopherol'],
  toco_gamma: ['gamma-tocopherol', 'gamma tocopherol'],
  toco_delta: ['delta-tocopherol', 'delta tocopherol'],
  fiber: ['dietary fiber', 'dietary fibre', 'fiber', 'fibre', 'total fiber'],
  sugars: ['total sugars', 'sugars', 'sugar'],
  added_sugars: ['added sugars', 'includes added sugars', 'added sugar'],
  starch: ['starch'],
  fat: ['total fat', 'fat', 'total lipid'],
  sat_fat: ['saturated fat', 'saturated fatty acids', 'saturated'],
  trans_fat: ['trans fat', 'trans fatty acids', 'trans'],
  mono_fat: ['monounsaturated fat', 'monounsaturated', 'mufa'],
  poly_fat: ['polyunsaturated fat', 'polyunsaturated', 'pufa'],
  omega3: ['omega-3', 'omega 3', 'total omega-3', 'omega-3 fatty acids'],
  omega6: ['omega-6', 'omega 6', 'total omega-6', 'omega-6 fatty acids'],
  ala: ['omega-3 ala', 'omega 3 ala', 'alpha-linolenic acid', 'alpha linolenic acid', 'ala'],
  epa: ['omega-3 epa', 'omega 3 epa', 'eicosapentaenoic acid', 'epa'],
  dha: ['omega-3 dha', 'omega 3 dha', 'docosahexaenoic acid', 'dha'],
  la: ['omega-6 la', 'omega 6 la', 'linoleic acid', 'la'],
  aa: ['omega-6 aa', 'omega 6 aa', 'arachidonic acid'],
  cholesterol: ['cholesterol'],
  water: ['water', 'moisture'],
  caffeine: ['caffeine'],
  alcohol: ['alcohol', 'ethanol'],
  b1: ['thiamine', 'thiamin', 'vitamin b1', 'vit b1', 'b1'],
  b2: ['riboflavin', 'vitamin b2', 'vit b2', 'b2'],
  b3: ['niacin', 'niacinamide', 'vitamin b3', 'vit b3', 'b3'],
  b5: ['pantothenic acid', 'pantothenate', 'vitamin b5', 'b5'],
  b6: ['pyridoxine', 'vitamin b6', 'vit b6', 'b6'],
  b12: ['cobalamin', 'cyanocobalamin', 'methylcobalamin', 'vitamin b12', 'vit b12', 'b12'],
  biotin: ['biotin', 'vitamin b7'],
  choline: ['choline'],
  folate: ['folate', 'folic acid', 'folate dfe', 'vitamin b9'],
  vit_a: ['vitamin a', 'vit a', 'vitamin a rae'],
  retinol: ['retinol'],
  beta_carotene: ['beta-carotene', 'beta carotene'],
  alpha_carotene: ['alpha-carotene', 'alpha carotene'],
  lutein: ['lutein + zeaxanthin', 'lutein and zeaxanthin', 'lutein'],
  lycopene: ['lycopene'],
  vit_c: ['vitamin c', 'vit c', 'ascorbic acid'],
  vit_d: ['vitamin d', 'vitamin d3', 'vitamin d2', 'vit d', 'cholecalciferol'],
  vit_e: ['vitamin e', 'vit e', 'tocopherol'],
  vit_k: ['vitamin k', 'vitamin k1', 'vitamin k2', 'vit k', 'phylloquinone'],
  calcium: ['calcium'], chromium: ['chromium'], copper: ['copper'], fluoride: ['fluoride'], iodine: ['iodine'],
  iron: ['iron'], magnesium: ['magnesium'], manganese: ['manganese'], molybdenum: ['molybdenum'],
  phosphorus: ['phosphorus'], potassium: ['potassium'], selenium: ['selenium'], sodium: ['sodium'], zinc: ['zinc'],
  cystine: ['cystine', 'cysteine', 'l-cysteine', 'cys'],
  histidine: ['histidine'], isoleucine: ['isoleucine'], leucine: ['leucine'], lysine: ['lysine'],
  methionine: ['methionine'], phenylalanine: ['phenylalanine'], threonine: ['threonine'], tryptophan: ['tryptophan'],
  tyrosine: ['tyrosine'], valine: ['valine'], alanine: ['alanine'], arginine: ['arginine'],
  aspartic_acid: ['aspartic acid', 'aspartate', 'asparagine'], glutamic_acid: ['glutamic acid', 'glutamate', 'glutamine'],
  glycine: ['glycine'], proline: ['proline'], serine: ['serine'], hydroxyproline: ['hydroxyproline', 'hydroxy-proline']
};

// Longest names first, so "saturated fat" wins over "fat" and "hydroxyproline" over "proline".
const NAMES = Object.entries(ALIASES)
  .flatMap(([key, names]) => [...names, BY_KEY[key]?.name.toLowerCase()].filter(Boolean).map((n) => ({ key, n })))
  .sort((a, b) => b.n.length - a.n.length);

const UNIT = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(kcal|calories|cal|mcg|µg|μg|ug|mg|g|grams?|milligrams?|micrograms?|iu)\b(?!\s*\/\s*day)/i;

function toCatalog(key, value, unitRaw) {
  const nu = BY_KEY[key];
  let u = unitRaw.toLowerCase();
  if (/^(µg|μg|ug|mcg|micrograms?)$/.test(u)) u = 'µg';
  else if (/^(mg|milligrams?)$/.test(u)) u = 'mg';
  else if (/^(g|grams?)$/.test(u)) u = 'g';
  else if (/^(kcal|cal|calories)$/.test(u)) u = 'kcal';
  else if (u === 'iu') u = 'IU';
  if (u === nu.unit) return value;
  if (nu.unit === 'kcal') return u === 'kcal' ? value : null;
  if (u === 'IU') {
    if (key === 'vit_d') return value; // catalog keeps IU
    if (key === 'vit_a') return value * 0.3; // IU retinol → µg RAE
    if (key === 'vit_e') return value * 0.67; // IU → mg alpha-tocopherol
    return null;
  }
  if (key === 'vit_d' && nu.unit === 'IU') {
    const ug = u === 'µg' ? value : u === 'mg' ? value * 1000 : u === 'g' ? value * 1e6 : null;
    return ug == null ? null : ug * 40;
  }
  const grams = u === 'g' ? value : u === 'mg' ? value / 1000 : u === 'µg' ? value / 1e6 : null;
  if (grams == null) return null;
  return nu.unit === 'g' ? grams : nu.unit === 'mg' ? grams * 1000 : nu.unit === 'µg' ? grams * 1e6 : null;
}

const toNumber = (str) => Number(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(str) ? str.replace(/,/g, '') : String(str).replace(',', '.'));

// Finds what amount the values refer to: "per 100 g", "per serving (11 g)", "serving size 1 scoop (11g)".
// The "Serving size: 1 oz (28.35 g)" line, if the text has one: { label, grams }.
export function servingFromText(text) {
  const line = text.match(/^[\s*_#>-]*(?:analy[sz]ed\s+)?serving size\s*[:\-]?\s*(.+)$/im)?.[1]?.replace(/[*_`]/g, '').trim();
  if (!line) return null;
  const g = line.match(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i);
  const oz = line.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b(?!\s*fl)/i);
  const grams = g ? Number(g[1]) : oz ? Number(oz[1]) * 28.3495 : null;
  if (!(grams > 0)) return null;
  const measure = line.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const label = /\d\s*(g|grams?)\b/i.test(measure) ? measure : `${measure} (${+grams.toFixed(2)} g)`;
  return { label: label.slice(0, 40), grams };
}

export function detectBasis(text) {
  const t = per100Section(text).toLowerCase();
  if (/per\s*100\s*(g|grams)\b/.test(t)) return 100;
  const sv = servingFromText(text);
  if (sv) return sv.grams;
  const m = t.match(/(?:serving size|per serving|serving|scoop|portion|slice|piece|softgel|tablet|capsule|gummy|packet|bar|container|cup|tbsp|tsp|tablespoons?|teaspoons?)s?[^\n\d]{0,30}?\(?\s*(\d+(?:\.\d+)?)\s*(g|grams)\b/)
    || t.match(/per\s+(\d+(?:\.\d+)?)\s*(g|grams)\b/);
  return m ? Number(m[1]) : null;
}

export function firstUrl(text) {
  const m = text.match(/https?:\/\/[^\s)\]>"']+/);
  return m ? m[0].replace(/[.,;]+$/, '') : '';
}

// Offline parser: one nutrient per line, "Name ... number unit".
// Lines marked as coming from a comparable product (or under a "comparable" heading) are flagged,
// so they can be stored as estimates rather than manufacturer data.
const COMPARABLE = /\b(comparable|similar product|reference food|usda|typical|estimated?|est|approx(imate(ly)?)?)\b/i;
const OFFICIAL = /\b(manufacturer|spec sheet|label|official|product data)\b/i;

// A reply with a per-serving list followed by a per-100 g list: keep only the per-100 g part,
// so the two lists aren't mixed up.
export function per100Section(text) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l, n) => n > 0 && /^[\s#*_>-]*per\s*100\s*(g|grams)\b/i.test(l));
  if (i < 0) return text;
  const before = lines.slice(0, i).join('\n');
  return /\d\s*(g|mg|mcg|µg|kcal)\b/i.test(before) ? lines.slice(i).join('\n') : text;
}

const UNTRACKED = /\b(tocotrienols?|stigmasterol|campesterol|beta-sitosterol)\b/;
const LAB = /\b(lab|usda|fooddata|fdc|sr legacy|foundation)\b/i;
const HEADING = /^[\s#*_>-]*(per\b|label\b|nutrition facts|spec|lab\b|lab data|comparable|manufacturer|estimated?\b|usda)/i;

// Returns { nutrients, comparable: [keys estimated], lab: [keys from lab data] }.
// Sections: "Label" / "Spec sheet" / "Manufacturer" → official; "Lab data: USDA ..." → lab; "Comparable" / "Estimated" → estimate.
export function parseLocal(text) {
  text = per100Section(text);
  const out = {};
  const comparable = new Set();
  const lab = new Set();
  let section = 'official';
  let lastKey = null;
  for (const fullLine of text.split(/\r?\n/)) {
    const hasNumber = /\d/.test(fullLine);
    const heading = HEADING.test(fullLine) && !/:\s*[\d.,]+\s*(g|mg|mcg|µg|ug|kcal|iu)\b/i.test(fullLine.replace(/\([^)]*\)/g, ''));
    if (heading || !hasNumber || /^\s*#+\s|^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(fullLine)) {
      if (LAB.test(fullLine)) section = 'lab';
      else if (COMPARABLE.test(fullLine)) section = 'est';
      else if (OFFICIAL.test(fullLine)) section = 'official';
      if (heading) continue;
    }
    const lineFlag = COMPARABLE.test(fullLine) && !LAB.test(fullLine);
    // Also split "Fiber: 4 g (Insoluble: 2.5 g" so the sub-amount in brackets is read too.
    for (const raw of fullLine.split(/[;,](?=\s*[A-Za-z])|\((?=\s*[A-Za-z][A-Za-z +-]*:\s*\d)/)) {
      // Drop "(per 57 g)" style notes so their number isn't read as the amount.
      const line = raw.replace(/\*\*/g, '').replace(/\(\s*(per|for|in)\b[^)]*\)/gi, ' ').replace(/[|•·–—:]/g, ' ').trim();
      if (!line || /from fat|based on a|^serving size|servings per|^product\b|^food item\b|^barcode\b/i.test(line)) continue;
      const lower = line.toLowerCase();
      // Sub-fractions the app doesn't track (kJ, insoluble fiber, single sugars, tocopherols…) would otherwise be read
      // as their parent nutrient, e.g. "Fiber, insoluble: 2 g" as total fiber. Skip them.
      const namePart = (raw.split(':')[0] || '').toLowerCase();
      if (UNTRACKED.test(namePart)) continue;
      // kJ is worked out from kcal, so a kJ amount is skipped rather than read as calories.
      if (/\d\s*kj\b/i.test(line) && !/kcal|calorie/i.test(line)) continue;
      // The nutrient named first in the line wins ("Fiber: 3 g (Insoluble: 2 g" is fiber); ties go to the longer name.
      let hit = null, hitAt = Infinity;
      for (const c of NAMES) {
        const m = new RegExp(`(^|[^a-z0-9])${c.n.replace(/[-+()]/g, (x) => '\\' + x)}([^a-z0-9]|$)`).exec(lower);
        if (!m) continue;
        const at = m.index + m[1].length;
        if (at < hitAt || (at === hitAt && c.n.length > hit.n.length)) { hit = c; hitAt = at; }
      }
      // A bare "Alpha: 0.2 mg" listed under vitamin E is that tocopherol.
      const greek = namePart.replace(/[^a-z]/g, '').match(/^(alpha|beta|gamma|delta)$/);
      if (greek && lastKey && /^(vit_e|toco_)/.test(lastKey)) { hit = { key: 'toco_' + greek[1], n: greek[1] }; hitAt = lower.indexOf(greek[1]); }
      if (!hit) continue;
      lastKey = hit.key;
      const after = line.slice(hitAt + hit.n.length);
      const rawSeg = raw.slice(raw.toLowerCase().indexOf(hit.n) + hit.n.length);
      let m = after.match(UNIT);
      if (!m && hit.key === 'energy') { const n = after.match(/(\d+(?:[.,]\d+)?)/); if (n) m = [n[0], n[1], 'kcal']; }
      if (!m) continue;
      let num = toNumber(m[1]);
      // Estimated if the value itself is marked (~, approx., (est.)); notes in brackets like "(~502 kJ)" don't count.
      let estimated = /~|≈|\bapprox|\bestimat/i.test(rawSeg.replace(/\([^)]*\)|\[[^\]]*\]/g, '')) || /\(\s*est(imated?)?\.?\s*\)/i.test(rawSeg);
      // "139 mg to 147 mg", "60–65 mg": use the middle, as an estimate.
      const range = rawSeg.match(/(\d+(?:[.,]\d+)?)\s*([a-zµμ]+)?\s*(?:to|–|—|-)\s*~?\s*(\d+(?:[.,]\d+)?)\s*([a-zµμ]+)/i);
      if (range && rawSeg.indexOf(range[0]) <= rawSeg.indexOf(m[1]) + m[1].length) {
        const u1 = (range[2] || range[4]).toLowerCase(), u2 = range[4].toLowerCase();
        if (u1 === u2 || !range[2]) { num = (toNumber(range[1]) + toNumber(range[3])) / 2; m = [m[0], String(num), range[4]]; estimated = true; }
      }
      // "<1 g (approx. 0.5 g)" → 0.5; a bare "<0.1 g" → half of it. Both estimates.
      if (/<\s*$/.test(rawSeg.slice(0, rawSeg.indexOf(m[1])))) {
        const ap = rawSeg.match(/approx\.?\s*~?\s*(\d+(?:[.,]\d+)?)\s*([a-zµμ]+)/i);
        if (ap) { num = toNumber(ap[1]); m = [m[0], ap[1], ap[2]]; } else num = num / 2;
        estimated = true;
      }
      const v = toCatalog(hit.key, num, m[2]);
      if (v == null || !Number.isFinite(v) || v < 0) continue;
      // "Vitamin E (alpha-tocopherol)" is both.
      const keys = hit.key === 'vit_e' && /alpha[- ]?tocopherol/.test(lower) ? ['vit_e', 'toco_alpha'] : [hit.key];
      for (const key of keys) {
        if (out[key] != null) continue;
        out[key] = v;
        if (lineFlag || estimated || section === 'est') comparable.add(key);
        else if (section === 'lab') lab.add(key);
      }
    }
  }
  return { nutrients: out, comparable: [...comparable], lab: [...lab] };
}

// AI extraction for tables, paragraphs and mixed units. Returns null when no provider is set up.
export async function parseWithAI(text, food) {
  if (!hasAI()) return null;
  const link = firstUrl(text);
  text = per100Section(text);
  const keyList = NUTRIENTS.filter((n) => !n.derived || ['omega3', 'omega6'].includes(n.key)).map((n) => `${n.key} (${n.unit})`).join(', ');
  const prompt = `Extract nutrient amounts from the text below for the product "${food.brand || ''} ${food.name}".
Convert each to these keys and units: ${keyList}.
Use only numbers stated in the text. Do not estimate or fill gaps. Skip % Daily Value numbers.
basis_grams is the amount of product the values refer to (100 for "per 100 g"; the serving weight in grams for "per serving"). If the text never says, use null.
List in "lab" every key whose value the text says comes from USDA / lab-analyzed data for a generic version of the food.
List in "comparable" every key whose value the text says comes from a comparable or similar product, or an estimate.
Leave label and manufacturer spec-sheet values out of both lists.
Reply with JSON only inside <json></json>: {"basis_grams": number|null, "source_url": "first source link in the text or empty", "nutrients": {"key": number}, "lab": ["key"], "comparable": ["key"]}

Text:
"""
${text.slice(0, 20000)}
"""`;
  const { text: reply } = await askAI({ system: 'You convert nutrition text into structured data exactly as stated. You never invent values.', prompt, maxTokens: 3000 });
  const j = parseJSON(reply);
  const nutrients = {};
  for (const [k, v] of Object.entries(j.nutrients || {})) {
    const n = Number(v);
    if (BY_KEY[k] && Number.isFinite(n) && n >= 0) nutrients[k] = n;
  }
  const comparable = (Array.isArray(j.comparable) ? j.comparable : []).filter((k) => nutrients[k] != null);
  const lab = (Array.isArray(j.lab) ? j.lab : []).filter((k) => nutrients[k] != null && !comparable.includes(k));
  return { basis: j.basis_grams > 0 ? Number(j.basis_grams) : null, url: /^https?:\/\//.test(j.source_url || '') ? j.source_url : link, nutrients, comparable, lab };
}
