// Nutrient catalog: one entry per tracked nutrient.
// fdc: USDA FoodData Central nutrient numbers (first match wins).
// off: Open Food Facts nutriment key (values there are per 100 g, in grams unless noted).
// target: default daily target (null = tracked, no target). limit: going over is flagged.

export const GROUPS = ['General', 'Carbohydrates', 'Lipids', 'Protein', 'Vitamins', 'Minerals'];

export const NUTRIENTS = [
  // General
  { key: 'energy', name: 'Energy', unit: 'kcal', group: 'General', target: 1692, limit: true, fdc: ['208'], off: 'energy-kcal', offUnit: 'kcal' },
  { key: 'energy_kj', name: 'Energy (kJ)', unit: 'kJ', group: 'General', target: null, derived: true },
  { key: 'water', name: 'Water', unit: 'g', group: 'General', target: 3700, fdc: ['255'] },
  { key: 'caffeine', name: 'Caffeine', unit: 'mg', group: 'General', target: null, fdc: ['262'], off: 'caffeine' },
  { key: 'alcohol', name: 'Alcohol', unit: 'g', group: 'General', target: null, fdc: ['221'], off: 'alcohol', offUnit: 'g' },
  { key: 'ash', name: 'Ash', unit: 'g', group: 'General', target: null, fdc: ['207'] },
  { key: 'bhb', name: 'Beta-hydroxybutyrate', unit: 'g', group: 'General', target: null, fdc: [] },
  { key: 'oxalate', name: 'Oxalate', unit: 'mg', group: 'General', target: null, fdc: [] },
  { key: 'phytate', name: 'Phytate', unit: 'mg', group: 'General', target: null, fdc: [] },

  // Carbohydrates
  { key: 'carbs', name: 'Carbs', unit: 'g', group: 'Carbohydrates', target: 100, fdc: ['205'], off: 'carbohydrates' },
  { key: 'fiber', name: 'Fiber', unit: 'g', group: 'Carbohydrates', target: 38, fdc: ['291'], off: 'fiber' },
  { key: 'fiber_insol', name: 'Insoluble fiber', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['297'], off: 'insoluble-fiber' },
  { key: 'fiber_sol', name: 'Soluble fiber', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['295'], off: 'soluble-fiber' },
  { key: 'starch', name: 'Starch', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['209'], off: 'starch' },
  { key: 'sugars', name: 'Sugars', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['269'], off: 'sugars' },
  { key: 'allulose', name: 'Allulose', unit: 'g', group: 'Carbohydrates', target: null, fdc: [] },
  { key: 'fructose', name: 'Fructose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['212'], off: 'fructose' },
  { key: 'galactose', name: 'Galactose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['287'], off: 'galactose' },
  { key: 'glucose', name: 'Glucose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['211'], off: 'glucose' },
  { key: 'lactose', name: 'Lactose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['213'], off: 'lactose' },
  { key: 'maltose', name: 'Maltose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['214'], off: 'maltose' },
  { key: 'sucrose', name: 'Sucrose', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['210'], off: 'sucrose' },
  { key: 'added_sugars', name: 'Added sugars', unit: 'g', group: 'Carbohydrates', target: 50, limit: true, fdc: ['539'], off: 'added-sugars' },
  { key: 'sugar_alcohols', name: 'Sugar alcohols', unit: 'g', group: 'Carbohydrates', target: null, fdc: ['299'], off: 'polyols' },

  // Lipids
  { key: 'fat', name: 'Fat', unit: 'g', group: 'Lipids', target: 74, limit: true, fdc: ['204'], off: 'fat' },
  { key: 'sat_fat', name: 'Saturated fat', unit: 'g', group: 'Lipids', target: null, fdc: ['606'], off: 'saturated-fat' },
  { key: 'mono_fat', name: 'Monounsaturated fat', unit: 'g', group: 'Lipids', target: null, fdc: ['645'], off: 'monounsaturated-fat' },
  { key: 'poly_fat', name: 'Polyunsaturated fat', unit: 'g', group: 'Lipids', target: null, fdc: ['646'], off: 'polyunsaturated-fat' },
  { key: 'trans_fat', name: 'Trans fat', unit: 'g', group: 'Lipids', target: null, fdc: ['605'], off: 'trans-fat' },
  { key: 'omega3', name: 'Omega-3', unit: 'g', group: 'Lipids', target: 1.6, derived: true, off: 'omega-3-fat' },
  { key: 'ala', name: 'Omega-3 (ALA)', unit: 'g', group: 'Lipids', target: null, fdc: ['851', '619'], off: 'alpha-linolenic-acid', fatty: true },
  { key: 'epa', name: 'Omega-3 (EPA)', unit: 'g', group: 'Lipids', target: null, fdc: ['629'], off: 'eicosapentaenoic-acid', fatty: true },
  { key: 'dha', name: 'Omega-3 (DHA)', unit: 'g', group: 'Lipids', target: null, fdc: ['621'], off: 'docosahexaenoic-acid', fatty: true },
  { key: 'omega6', name: 'Omega-6', unit: 'g', group: 'Lipids', target: 17, derived: true, off: 'omega-6-fat' },
  { key: 'la', name: 'Omega-6 (LA)', unit: 'g', group: 'Lipids', target: null, fdc: ['675', '618'], off: 'linoleic-acid', fatty: true },
  { key: 'aa', name: 'Omega-6 (AA)', unit: 'g', group: 'Lipids', target: null, fdc: ['620'], off: 'arachidonic-acid', fatty: true },
  { key: 'cholesterol', name: 'Cholesterol', unit: 'mg', group: 'Lipids', target: null, fdc: ['601'], off: 'cholesterol' },
  { key: 'phytosterols', name: 'Phytosterols', unit: 'mg', group: 'Lipids', target: null, fdc: ['636'] },

  // Protein
  { key: 'protein', name: 'Protein', unit: 'g', group: 'Protein', target: 150, fdc: ['203'], off: 'proteins' },
  { key: 'cystine', name: 'Cystine', unit: 'g', group: 'Protein', target: 0.6, fdc: ['507'], amino: true },
  { key: 'histidine', name: 'Histidine', unit: 'g', group: 'Protein', target: 0.9, fdc: ['512'], amino: true },
  { key: 'isoleucine', name: 'Isoleucine', unit: 'g', group: 'Protein', target: 1.2, fdc: ['503'], amino: true },
  { key: 'leucine', name: 'Leucine', unit: 'g', group: 'Protein', target: 2.6, fdc: ['504'], amino: true },
  { key: 'lysine', name: 'Lysine', unit: 'g', group: 'Protein', target: 2.3, fdc: ['505'], amino: true },
  { key: 'methionine', name: 'Methionine', unit: 'g', group: 'Protein', target: 0.6, fdc: ['506'], amino: true },
  { key: 'phenylalanine', name: 'Phenylalanine', unit: 'g', group: 'Protein', target: 1.0, fdc: ['508'], amino: true },
  { key: 'threonine', name: 'Threonine', unit: 'g', group: 'Protein', target: 1.2, fdc: ['502'], amino: true },
  { key: 'tryptophan', name: 'Tryptophan', unit: 'g', group: 'Protein', target: 0.3, fdc: ['501'], amino: true },
  { key: 'tyrosine', name: 'Tyrosine', unit: 'g', group: 'Protein', target: 1.0, fdc: ['509'], amino: true },
  { key: 'valine', name: 'Valine', unit: 'g', group: 'Protein', target: 1.5, fdc: ['510'], amino: true },
  { key: 'alanine', name: 'Alanine', unit: 'g', group: 'Protein', target: null, fdc: ['513'], amino: true },
  { key: 'arginine', name: 'Arginine', unit: 'g', group: 'Protein', target: null, fdc: ['511'], amino: true },
  { key: 'aspartic_acid', name: 'Aspartic acid', unit: 'g', group: 'Protein', target: null, fdc: ['514'], amino: true },
  { key: 'glutamic_acid', name: 'Glutamic acid', unit: 'g', group: 'Protein', target: null, fdc: ['515'], amino: true },
  { key: 'glycine', name: 'Glycine', unit: 'g', group: 'Protein', target: null, fdc: ['516'], amino: true },
  { key: 'proline', name: 'Proline', unit: 'g', group: 'Protein', target: null, fdc: ['517'], amino: true },
  { key: 'serine', name: 'Serine', unit: 'g', group: 'Protein', target: null, fdc: ['518'], amino: true },
  { key: 'hydroxyproline', name: 'Hydroxyproline', unit: 'g', group: 'Protein', target: null, fdc: ['521'], amino: true },

  // Vitamins
  { key: 'b1', name: 'B1 (Thiamine)', unit: 'mg', group: 'Vitamins', target: 1.2, fdc: ['404'], off: 'vitamin-b1' },
  { key: 'b2', name: 'B2 (Riboflavin)', unit: 'mg', group: 'Vitamins', target: 1.3, fdc: ['405'], off: 'vitamin-b2' },
  { key: 'b3', name: 'B3 (Niacin)', unit: 'mg', group: 'Vitamins', target: 16, fdc: ['406'], off: 'vitamin-pp' },
  { key: 'b5', name: 'B5 (Pantothenic acid)', unit: 'mg', group: 'Vitamins', target: 5, fdc: ['410'], off: 'pantothenic-acid' },
  { key: 'b6', name: 'B6 (Pyridoxine)', unit: 'mg', group: 'Vitamins', target: 1.3, fdc: ['415'], off: 'vitamin-b6' },
  { key: 'b12', name: 'B12 (Cobalamin)', unit: 'µg', group: 'Vitamins', target: 2.4, fdc: ['418'], off: 'vitamin-b12' },
  { key: 'biotin', name: 'Biotin', unit: 'µg', group: 'Vitamins', target: 30, fdc: [], off: 'biotin' },
  { key: 'choline', name: 'Choline', unit: 'mg', group: 'Vitamins', target: 550, fdc: ['421'], off: 'choline' },
  { key: 'folate', name: 'Folate', unit: 'µg', group: 'Vitamins', target: 400, fdc: ['435', '417'], off: 'vitamin-b9' },
  { key: 'vit_a', name: 'Vitamin A', unit: 'µg', group: 'Vitamins', target: 900, fdc: ['320'], off: 'vitamin-a' },
  { key: 'retinol', name: 'Retinol', unit: 'µg', group: 'Vitamins', target: 3000, limit: true, fdc: ['319'] },
  { key: 'beta_carotene', name: 'Beta-carotene', unit: 'µg', group: 'Vitamins', target: null, fdc: ['321'], off: 'beta-carotene' },
  { key: 'alpha_carotene', name: 'Alpha-carotene', unit: 'µg', group: 'Vitamins', target: null, fdc: ['322'] },
  { key: 'lutein', name: 'Lutein + zeaxanthin', unit: 'µg', group: 'Vitamins', target: null, fdc: ['338'] },
  { key: 'lycopene', name: 'Lycopene', unit: 'µg', group: 'Vitamins', target: null, fdc: ['337'] },
  { key: 'cryptoxanthin', name: 'Beta-cryptoxanthin', unit: 'µg', group: 'Vitamins', target: null, fdc: ['334'] },
  { key: 'vit_c', name: 'Vitamin C', unit: 'mg', group: 'Vitamins', target: 90, fdc: ['401'], off: 'vitamin-c' },
  { key: 'vit_d', name: 'Vitamin D', unit: 'IU', group: 'Vitamins', target: 600, fdc: ['324'], fdcAlt: { '328': 40 }, off: 'vitamin-d', offUnit: 'g→IU' },
  { key: 'vit_e', name: 'Vitamin E', unit: 'mg', group: 'Vitamins', target: 15, fdc: ['323'], off: 'vitamin-e' },
  { key: 'toco_alpha', name: 'Alpha-tocopherol', unit: 'mg', group: 'Vitamins', target: null, fdc: ['323'] },
  { key: 'toco_beta', name: 'Beta-tocopherol', unit: 'mg', group: 'Vitamins', target: null, fdc: ['341'] },
  { key: 'toco_gamma', name: 'Gamma-tocopherol', unit: 'mg', group: 'Vitamins', target: null, fdc: ['342'] },
  { key: 'toco_delta', name: 'Delta-tocopherol', unit: 'mg', group: 'Vitamins', target: null, fdc: ['343'] },
  { key: 'vit_k', name: 'Vitamin K', unit: 'µg', group: 'Vitamins', target: 120, fdc: ['430'], off: 'vitamin-k' },

  // Minerals
  { key: 'calcium', name: 'Calcium', unit: 'mg', group: 'Minerals', target: 1000, fdc: ['301'], off: 'calcium' },
  { key: 'chromium', name: 'Chromium', unit: 'µg', group: 'Minerals', target: 35, fdc: [], off: 'chromium' },
  { key: 'copper', name: 'Copper', unit: 'mg', group: 'Minerals', target: 0.9, fdc: ['312'], off: 'copper' },
  { key: 'fluoride', name: 'Fluoride', unit: 'µg', group: 'Minerals', target: 4000, fdc: ['313'], off: 'fluoride' },
  { key: 'iodine', name: 'Iodine', unit: 'µg', group: 'Minerals', target: 150, fdc: ['314'], off: 'iodine' },
  { key: 'iron', name: 'Iron', unit: 'mg', group: 'Minerals', target: 8, fdc: ['303'], off: 'iron' },
  { key: 'magnesium', name: 'Magnesium', unit: 'mg', group: 'Minerals', target: 420, fdc: ['304'], off: 'magnesium' },
  { key: 'manganese', name: 'Manganese', unit: 'mg', group: 'Minerals', target: 2.3, fdc: ['315'], off: 'manganese' },
  { key: 'molybdenum', name: 'Molybdenum', unit: 'µg', group: 'Minerals', target: 45, fdc: [], off: 'molybdenum' },
  { key: 'phosphorus', name: 'Phosphorus', unit: 'mg', group: 'Minerals', target: 700, fdc: ['305'], off: 'phosphorus' },
  { key: 'potassium', name: 'Potassium', unit: 'mg', group: 'Minerals', target: 3400, fdc: ['306'], off: 'potassium' },
  { key: 'selenium', name: 'Selenium', unit: 'µg', group: 'Minerals', target: 55, fdc: ['317'], off: 'selenium' },
  { key: 'sodium', name: 'Sodium', unit: 'mg', group: 'Minerals', target: 1500, limit: true, fdc: ['307'], off: 'sodium' },
  { key: 'zinc', name: 'Zinc', unit: 'mg', group: 'Minerals', target: 11, fdc: ['309'], off: 'zinc' }
];

export const BY_KEY = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n]));

// Nutrients that USDA's lab databases rarely or never carry: only labels, spec sheets or estimates fill them.
export const RARELY_MEASURED = ['iodine', 'chromium', 'molybdenum', 'biotin', 'oxalate', 'phytate', 'phytosterols', 'fiber_sol', 'fiber_insol'];

// Convert a value from grams into the catalog unit.
export function fromGrams(value, unit) {
  switch (unit) {
    case 'g': return value;
    case 'mg': return value * 1000;
    case 'µg': return value * 1e6;
    default: return value;
  }
}

// Convert an FDC amount (with its unit name) into the catalog unit.
export function fdcToUnit(amount, unitName, unit) {
  const u = String(unitName || '').toUpperCase();
  let grams;
  if (u === 'G') grams = amount;
  else if (u === 'MG') grams = amount / 1000;
  else if (u === 'UG' || u === 'µG' || u === 'MCG') grams = amount / 1e6;
  else return amount; // KCAL, IU: already in the catalog unit
  return fromGrams(grams, unit);
}

// Fill derived totals (omega-3, omega-6) from their parts when missing.
export function deriveTotals(per100) {
  const val = (k) => per100[k]?.v;
  const srcOf = (keys) => {
    const s = keys.map((k) => per100[k]?.src).filter(Boolean);
    return s.includes('est') ? 'est' : (s[0] || 'est');
  };
  if (per100.omega3 == null) {
    const parts = ['ala', 'epa', 'dha'].filter((k) => val(k) != null);
    if (parts.length) per100.omega3 = { v: parts.reduce((a, k) => a + val(k), 0), src: srcOf(parts) };
  }
  if (per100.omega6 == null) {
    const parts = ['la', 'aa'].filter((k) => val(k) != null);
    if (parts.length) per100.omega6 = { v: parts.reduce((a, k) => a + val(k), 0), src: srcOf(parts) };
  }
  if (val('energy') != null) per100.energy_kj = { v: val('energy') * 4.184, src: per100.energy.src };
  return per100;
}

export function fmt(v, unit) {
  if (v == null || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  let s;
  if (a >= 1000) s = Math.round(v).toLocaleString();
  else if (a >= 100) s = Math.round(v).toString();
  else if (a >= 10) s = v.toFixed(1).replace(/\.0$/, '');
  else if (a >= 1) s = v.toFixed(1).replace(/\.0$/, '');
  else if (a === 0) s = '0';
  else if (a >= 0.01) s = v.toFixed(2).replace(/0$/, '');
  else s = String(+v.toPrecision(2)); // tiny amounts keep their digits (0.004), never shown as 0
  return unit ? s + ' ' + unit : s;
}
