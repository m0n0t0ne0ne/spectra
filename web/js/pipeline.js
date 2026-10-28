// What happens after a scan:
// 1. Product info: the barcode databases (Open Food Facts, USDA Branded) give the name, brand, ingredients and
//    serving size only. If neither knows the barcode, the AI identifies it from the web.
// 2. Nutrients: one AI pass (Gemini or Claude, with web search) collects, per label serving, the printed label,
//    the manufacturer's spec sheet, USDA lab data for a generic version and estimates, kept separate.
//    precision.js merges them: a precise spec or lab value replaces the label's when it rounds to what the label
//    prints (e.g. calcium printed as 0 mg because it's under 2% DV); otherwise the label stands.
// Every value keeps a `src` tag: label | spec | lab | est.
// Without an AI key, the databases' own label values are used instead.
//
// Two ways to do step 2 (Targets → Data sources → Lookup method):
// - "pages" (default): the app finds the product's own pages itself (UPCitemdb, Brave or DuckDuckGo, then fetches
//   2–3 pages) and sends their nutrition text to the AI with the Ask Gemini prompt. One request, no AI web search,
//   so it works on free Gemini keys.
// - "classic": the 1.0.1 behavior. The AI does its own web search (identify + fill).
import { NUTRIENTS, BY_KEY, RARELY_MEASURED, deriveTotals } from './nutrients.js';
import { offProduct, fdcByUPC, fdcLabProfile, askAI, aiName, parseJSON, hasAI, titleCase } from './api.js';
import { store } from './store.js';
import { mergePrecise } from './precision.js';
import { upcItemDb, productPages } from './lookup.js';
import { geminiNutrientPrompt } from './prompts.js';
import { parseLocal, servingFromText } from './paste.js';

const KEY_LIST = NUTRIENTS.filter((n) => !n.derived).map((n) => `${n.key} (${n.unit})`).join(', ');
const MAX_PER_100 = { g: 100, mg: 100000, 'µg': 1e8, IU: 1e7, kcal: 950 };

function clean(per100Raw, src) {
  const out = {};
  for (const [k, raw] of Object.entries(per100Raw || {})) {
    const nu = BY_KEY[k];
    const v = Number(raw);
    if (!nu || nu.derived || !Number.isFinite(v) || v < 0 || v > (MAX_PER_100[nu.unit] ?? Infinity)) continue;
    out[k] = { v, src };
  }
  return out;
}

function fill(target, add) {
  let n = 0;
  for (const [k, cell] of Object.entries(add)) {
    if (target[k] == null) { target[k] = cell; n++; }
  }
  return n;
}

/* ---------- product not in any database: identify it from the web ---------- */

async function identify(code, signal) {
  const digits = code.replace(/\D/g, '');
  const forms = [...new Set([digits, digits.replace(/^0+/, ''), digits.length === 12 ? '0' + digits : null, digits.length === 13 && digits[0] === '0' ? digits.slice(1) : null].filter(Boolean))];
  const prompt = `Identify the packaged food, drink or supplement with this barcode. Search each form of the number: ${forms.join(', ')}.
Barcode lookup sites and retailer listings (grocery stores, Amazon, Instacart and similar) are fine for working out WHICH product it is. The first 6–7 digits are the company prefix, which can tell you the brand (store brands are often made for the retailer).
Then find its Nutrition Facts and ingredient list, preferably from the brand's own site; a retailer listing that shows the label is acceptable if the brand doesn't publish it.
Convert label values to these keys and units: ${KEY_LIST}.
Reply with JSON only inside <json></json>:
{"found": true|false, "name": "...", "brand": "...", "serving_label": "e.g. 1 scoop", "serving_grams": number, "basis_grams": grams the label values refer to (usually the serving size), "nutrients": {"key": value}, "ingredients": "...", "source_url": "...", "source_title": "...", "reason": "if not found, one short sentence on what you tried"}
If you can't confirm which product it is, reply <json>{"found": false, "reason": "..."}</json>.`;
  const { text, sources } = await askAI({ system: 'You identify packaged foods from barcodes and report their labels. You never invent values.', prompt, search: true, maxTokens: 3000, signal });
  const j = parseJSON(text);
  if (!j.found) return { notFound: true, reason: j.reason || '' };
  if (!/^https?:\/\//.test(j.source_url || '') && sources[0]) { j.source_url = sources[0].url; j.source_title ||= sources[0].title; }
  const nutrients = j.nutrients || {};
  const hasValues = Object.values(nutrients).some((v) => Number.isFinite(Number(v)));
  // Values usually refer to one serving; fall back to the serving size, then 100 g.
  const basis = j.basis_grams > 0 ? j.basis_grams : j.serving_grams > 0 ? j.serving_grams : 100;
  if (!j.name && !hasValues) return { notFound: true, reason: j.reason || '' };
  const scale = 100 / basis;
  const scaled = {};
  for (const [k, v] of Object.entries(nutrients)) if (Number.isFinite(Number(v))) scaled[k] = Number(v) * scale;
  return {
    name: j.name || 'Unnamed product', brand: j.brand || '', upc: code, ingredients: j.ingredients || '',
    servings: j.serving_grams > 0 ? [{ label: j.serving_label || 'Serving', grams: j.serving_grams }] : [],
    per100: clean(scaled, 'label'),
    source: { kind: 'label', title: j.source_title || 'Label found on the web', url: /^https?:\/\//.test(j.source_url || '') ? j.source_url : '', note: `Found by ${aiName()}${hasValues ? '' : '. No nutrition values were published'}` }
  };
}


/* ---------- nutrients: one AI pass for the whole profile ---------- */

const AI_KEYS = NUTRIENTS.filter((n) => !n.derived).map((n) => `${n.key} (${n.unit === 'µg' ? 'mcg' : n.unit})`).join(', ');

async function fillWithAI(food, signal) {
  const serving = food.servings?.[0];
  const prompt = `Product: ${[food.brand, food.name].filter(Boolean).join(' ')}
Barcode: ${food.upc || 'N/A'}
Serving size: ${serving ? `${serving.label}${/\d\s*g\b/i.test(serving.label) ? '' : ` (${+serving.grams.toFixed(2)} g)`}` : 'unknown. Use the serving size printed on the Nutrition Facts label'}${food.ingredients ? `\nIngredients: ${food.ingredients.slice(0, 1500)}` : ''}

Task: collect nutrient data for ONE label serving of this exact product, from up to four sources, kept separate. All amounts are for the serving, never per 100 g. Vitamin D in IU. Full precision: never round any value, keep every decimal.
1. "label": this product's Nutrition Facts panel (the brand's site, or a retailer listing that shows the panel). Every value exactly as printed, including zeros.
2. "spec": the manufacturer's spec sheet, product data sheet or nutrition analysis for this exact product and flavor, if one is published. Values as stated.
3. "lab": the closest generic version of this food in USDA FoodData Central (Foundation or SR Legacy, lab-analyzed). Give EVERY nutrient USDA lists for it, including the macros the label also shows, as USDA value × serving grams ÷ 100. Do not round, do not adjust to the label.
4. "est": careful precise estimates from the ingredients for (a) keys that none of the three sources above has, and (b) every key the label prints as 0 or "less than" that spec and lab don't cover. Labels round small amounts down to 0; give the real small amount (e.g. 0.09), never a rounded 0, unless the food truly has none.

Keys and units: ${AI_KEYS}.

Reply with JSON only inside <json></json>:
{"serving_label": "household measure as printed, e.g. 1 slice", "serving_grams": number, "label_source_url": "...", "spec_source_url": "", "lab_reference": "USDA food name (FDC ID number)", "label": {"key": number}, "spec": {"key": number}, "lab": {"key": number}, "est": {"key": number}}`;
  const { text, sources } = await askAI({ system: 'You compile nutrition data from primary sources: package labels, manufacturer documents and USDA lab data. You copy numbers exactly and never invent label values.', prompt, search: true, maxTokens: 7000, signal });
  const j = parseJSON(text);
  const grams = j.serving_grams > 0 ? Number(j.serving_grams) : serving?.grams;
  if (!(grams > 0)) throw new Error('No serving size to work from');
  const keys = NUTRIENTS.filter((n) => !n.derived).map((n) => n.key);
  const { values, refined } = mergePrecise(
    { label: j.label || {}, spec: j.spec || {}, lab: j.lab || {}, est: j.est || {} },
    { keys, amino: NUTRIENTS.filter((n) => n.amino).map((n) => n.key), fatty: ['sat_fat', 'mono_fat', 'poly_fat', ...NUTRIENTS.filter((n) => n.fatty).map((n) => n.key)] }
  );
  const per100 = {};
  const counts = { label: 0, spec: 0, lab: 0, est: 0 };
  for (const [k, { v: perServing, src }] of Object.entries(values)) {
    const nu = BY_KEY[k];
    const v = perServing * 100 / grams;
    if (!Number.isFinite(v) || v < 0 || v > (MAX_PER_100[nu.unit] ?? Infinity)) continue;
    per100[k] = { v, src };
    counts[src]++;
  }
  if (!Object.keys(per100).length) throw new Error('No nutrients in the reply');
  const url = (u) => (/^https?:\/\//.test(u || '') ? u : '');
  const fdcId = String(j.lab_reference || '').match(/FDC\s*ID\D*(\d+)/i)?.[1];
  const refinedNames = refined.map((k) => BY_KEY[k].name.replace(/ \(.*\)$/, '').toLowerCase());
  const srcs = [
    { kind: 'label', title: 'Nutrition label', url: url(j.label_source_url) || sources[0]?.url || '', count: counts.label, note: `Found by ${aiName()}` },
    counts.spec ? { kind: 'spec', title: 'Manufacturer spec sheet', url: url(j.spec_source_url), count: counts.spec, note: `Found by ${aiName()}` } : null,
    counts.lab ? { kind: 'lab', title: j.lab_reference ? `USDA: ${j.lab_reference}` : 'USDA lab data', url: fdcId ? `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients` : '', count: counts.lab, note: `Amino acids matched to this product’s protein, fatty acids to its fat.` } : null,
    refined.length ? { kind: 'lab', title: 'Precise values instead of label rounding', count: refined.length, note: `The label rounds these; the precise value rounds to the same printed number, so it’s kept: ${refinedNames.join(', ')}.` } : null,
    counts.est ? { kind: 'est', title: 'Estimated', count: counts.est, note: `No published data; estimated by ${aiName()} from the ingredients` } : null
  ].filter(Boolean);
  const servingOut = j.serving_grams > 0 ? { label: String(j.serving_label || 'Serving').slice(0, 40), grams: Number(j.serving_grams) } : null;
  return { per100, sources: srcs, serving: servingOut, total: Object.keys(per100).length };
}

/* ---------- nutrients from the product's own pages: one AI request, no AI web search ---------- */

export const lookupMode = () => (store.settings().lookupMode === 'classic' ? 'classic' : 'pages');

const PAGE_SYSTEM = 'You compile nutrition data for one exact product from source text you are given. You have no web access. You copy printed numbers exactly and mark anything you infer with (est.).';

async function fillFromPages(food, { signal, onProgress, onWait } = {}) {
  const named = [food.brand, food.name].filter(Boolean).join(' ');
  const query = named ? `${named} nutrition facts` : `${food.upc} nutrition facts`;
  let pages = [], engine = '';
  try { ({ pages, engine } = await productPages(query, food.brand, { onProgress })); } catch { pages = []; }
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });

  const serving = food.servings?.[0];
  const labelLines = serving ? Object.entries(food.per100 || {}).filter(([k, c]) => BY_KEY[k] && c?.v != null)
    .map(([k, c]) => `${BY_KEY[k].name}: ${+(c.v * serving.grams / 100).toFixed(4)} ${BY_KEY[k].unit === 'µg' ? 'mcg' : BY_KEY[k].unit}`) : [];
  const prompt = `${geminiNutrientPrompt(food)}

Sources: you have no web access. Use the text below, which the app fetched for you.
- Barcode-database label values are the printed Nutrition Facts: use them exactly, without (est.).
- Values these pages state for this exact product and flavor (label panel, supplement facts, spec sheet): use them exactly, without (est.).
- Everything else: your best estimate from the ingredients and typical data for this kind of food, marked (est.).
- Ignore any page that describes a different product, flavor or size.${food.unidentified || !food.name ? '\n- Identify the product from the pages, and start with the Product and Serving size lines.' : ''}
${labelLines.length ? `\nBarcode-database label values (one serving, ${serving.label}):\n${labelLines.join('\n')}\n` : ''}${food.ingredients ? `\nIngredients: ${food.ingredients.slice(0, 1200)}\n` : ''}
${pages.length ? pages.map((p, i) => `--- Page ${i + 1}: ${p.title || ''} (${p.url})\n${p.text}`).join('\n\n') : '--- No product pages could be fetched. Use the label values above and estimates.'}`;

  onProgress?.(`${aiName()} is reading ${pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : 'the label'}`);
  const { text } = await askAI({ system: PAGE_SYSTEM, prompt, search: false, maxTokens: 4000, signal, onWait });

  const parsed = parseLocal(text);
  const sv = servingFromText(text) || (serving && serving.grams > 0 ? serving : null);
  if (!sv) throw new Error('No serving size to work from');
  const productLine = text.match(/^[\s*_#-]*product\s*:\s*(.+)$/im)?.[1]?.replace(/[*_#]/g, '').trim() || '';
  const est = new Set(parsed.comparable), lab = new Set(parsed.lab);
  const spec = {}, labV = {}, estV = {};
  for (const [k, v] of Object.entries(parsed.nutrients)) (est.has(k) ? estV : lab.has(k) ? labV : spec)[k] = v;
  const label = {};
  if (serving && Math.abs(serving.grams - sv.grams) < 0.5) for (const [k, c] of Object.entries(food.per100 || {})) if (c?.v != null) label[k] = c.v * sv.grams / 100;
  // The AI repeats the database label values it was given; those stay "label", not page data.
  for (const k of Object.keys(spec)) if (label[k] != null && Math.abs(spec[k] - label[k]) <= 1e-6 * Math.max(1, label[k])) delete spec[k];
  const keys = NUTRIENTS.filter((n) => !n.derived).map((n) => n.key);
  const { values } = mergePrecise({ label, spec, lab: labV, est: estV }, { keys });
  const per100 = {};
  const counts = { label: 0, spec: 0, lab: 0, est: 0 };
  for (const [k, { v: perServing, src }] of Object.entries(values)) {
    const v = perServing * 100 / sv.grams;
    if (!Number.isFinite(v) || v < 0 || v > (MAX_PER_100[BY_KEY[k].unit] ?? Infinity)) continue;
    per100[k] = { v, src };
    counts[src]++;
  }
  if (!Object.keys(per100).length) throw new Error('No nutrients in the reply');
  const srcs = [
    counts.label ? { kind: 'label', title: 'Nutrition label', count: counts.label, note: 'From the barcode databases' } : null,
    counts.spec ? { kind: 'spec', title: pages.length ? 'Brand and retailer pages' : 'Product data', url: pages[0]?.url || '', count: counts.spec,
      note: pages.length ? `Read by ${aiName()} from ${pages.map((p) => p.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).join(', ')} (found with ${engine})` : `From ${aiName()}` } : null,
    counts.lab ? { kind: 'lab', title: 'Lab data', count: counts.lab, note: `As stated in the sources` } : null,
    counts.est ? { kind: 'est', title: 'Estimated', count: counts.est, note: `Not published for this product; estimated by ${aiName()} from the ingredients and typical data` } : null
  ].filter(Boolean);
  // "Product: Brand – Name"
  const [pb, pn] = productLine.includes('–') || productLine.includes(' - ') ? productLine.split(/\s+[–-]\s+/, 2) : ['', productLine];
  return { per100, sources: srcs, serving: sv, total: Object.keys(per100).length, name: (pn || '').trim(), brand: (pb || '').trim(), pages };
}

/* ---------- the whole chain for a barcode ---------- */

// onStep(stepId, status, detail) — steps: info, nutrients. status: running | found | none | skipped | error | cached
export async function lookupBarcode(code, onStep = () => {}, { signal } = {}) {
  const id = 'upc:' + code.replace(/^0+/, '');
  const cached = store.food(id);
  // A placeholder you started for an unknown barcode (no nutrients yet) isn't a result: look it up again.
  const empty = cached && (cached.unidentified || !Object.keys(cached.per100 || {}).length);
  if (cached && !empty) {
    ['info', 'nutrients'].forEach((s) => onStep(s, 'cached', 'Saved earlier'));
    return cached;
  }

  // 1. Product info from the barcode databases: name, brand, ingredients, serving size.
  onStep('info', 'running', 'Open Food Facts and USDA');
  let off = null, usda = null;
  try { off = await offProduct(code); } catch { /* try USDA */ }
  try { usda = await fdcByUPC(code); } catch { /* ignore */ }
  let base = off || usda;
  let why = '';
  const pagesMode = lookupMode() === 'pages';
  if (!base && pagesMode) {
    // Free name lookup first; the page-reading step can still identify the product from its barcode.
    onStep('info', 'running', 'Not in food databases. Checking UPCitemdb');
    const u = await upcItemDb(code).catch(() => null);
    if (u) base = { name: u.name, brand: u.brand, servings: [], source: { url: `https://www.upcitemdb.com/upc/${code}` } };
    else if (hasAI()) base = { name: '', brand: '', servings: [], unidentified: true };
  }
  if (!base && !pagesMode && hasAI()) {
    onStep('info', 'running', `Not in food databases. ${aiName()} is searching the web`);
    try {
      const hit = await identify(code, signal);
      if (hit?.notFound) why = `${aiName()} searched the web but couldn’t identify it.${hit.reason ? ' ' + hit.reason : ''}`;
      else base = hit;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      why = `${aiName()} search failed: ${e.message}`;
    }
  }
  if (!base) { onStep('info', 'none', why ? 'Not found on the web either' : 'Product not found'); throw Object.assign(new Error('Product not found'), { code: 'not_found', detail: why }); }

  // USDA's branded serving comes straight from the label, so it goes first.
  let servings = [...(usda?.servings || []), ...(off?.servings || [])].filter((x, i, all) => all.findIndex((y) => Math.abs(y.grams - x.grams) < 0.5) === i);
  if (!servings.length) servings = base.servings || [];
  const food = {
    id, name: base.name, brand: base.brand || usda?.brand || '', upc: code, ...(base.unidentified ? { unidentified: true } : {}),
    ingredients: base.ingredients || usda?.ingredients || off?.ingredients || '',
    servings, per100: {}, sources: [], createdAt: Date.now()
  };
  const infoFrom = [off && 'Open Food Facts', usda && 'USDA', !off && !usda && (pagesMode ? (base.unidentified ? 'the web' : 'UPCitemdb') : aiName())].filter(Boolean).join(' + ');
  food.sources.push({ kind: 'label', title: `Product info: ${infoFrom}`, url: off?.source?.url || usda?.source?.url || base.source?.url || '', count: 0, note: 'Name, brand, ingredients and serving size' });
  onStep('info', base.unidentified ? 'running' : 'found', base.unidentified ? 'Identifying it from the web' : servings[0] ? `Serving ${servings[0].label}${/\d\s*g\b/i.test(servings[0].label) ? '' : ` (${+servings[0].grams.toFixed(1)} g)`}` : 'No serving size yet');

  // Fallback when there's no AI: the databases' own label values.
  const dbLabel = () => {
    const per100 = { ...(off?.per100 || {}) };
    if (usda) fill(per100, usda.per100);
    if (!off && !usda && base.per100) Object.assign(per100, base.per100);
    return per100;
  };

  // 2. Nutrients: one AI pass.
  if (!hasAI()) {
    food.per100 = dbLabel();
    food.sources.push({ kind: 'label', title: 'Label values from the databases', count: Object.keys(food.per100).length, note: 'Add a Gemini key in Targets to fill every nutrient' });
    onStep('nutrients', 'skipped', 'Add a Gemini or Claude key in Targets');
  } else {
    onStep('nutrients', 'running', pagesMode ? 'Finding the product’s pages' : `${aiName()} is reading the label and filling every nutrient`);
    if (pagesMode) food.per100 = dbLabel();
    try {
      const r = pagesMode
        ? await fillFromPages(food, { signal, onProgress: (d) => onStep('nutrients', 'running', d), onWait: (sec) => onStep('nutrients', 'running', `Waiting ${sec} s: Gemini asked to slow down`) })
        : await fillWithAI(food, signal);
      if (pagesMode && food.unidentified) {
        if (!r.name) throw Object.assign(new Error('Couldn’t identify this product from the web'), { code: 'not_identified' });
        food.name = r.name; food.brand = r.brand || food.brand; delete food.unidentified;
        onStep('info', 'found', `${[food.brand, food.name].filter(Boolean).join(' ')}`);
      }
      food.per100 = r.per100;
      food.sources.push(...r.sources);
      if (r.serving && !food.servings.some((x) => Math.abs(x.grams - r.serving.grams) < 0.5)) food.servings.unshift(r.serving);
      onStep('nutrients', 'found', `${r.total} nutrients`);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // Nothing to save for a product we couldn't even name: report it as not found, with the reason.
      if (food.unidentified) { onStep('info', 'none', 'Not found on the web either'); throw Object.assign(new Error('Product not found'), { code: 'not_found', detail: e.message }); }
      food.per100 = dbLabel();
      food.sources.push({ kind: 'label', title: 'Label values from the databases', count: Object.keys(food.per100).length, note: `${aiName()} couldn’t fill the other nutrients: ${e.message.replace(/\.+$/, '')}. Scan it again later, or use Ask Gemini on this food.` });
      onStep('nutrients', 'error', e.message);
    }
  }

  deriveTotals(food.per100);
  return store.saveFood(food);
}

// Estimates nutrients USDA rarely measures (iodine, chromium, molybdenum, biotin) for a generic food.
async function estimateRare(name, per100) {
  const missing = RARELY_MEASURED.filter((k) => per100[k] == null);
  if (!missing.length || !hasAI()) return { count: 0 };
  try {
    const { text } = await askAI({
      system: 'You are a food scientist. Give typical values from published food composition data.',
      prompt: `Typical amounts per 100 g of "${name}" for: ${missing.map((k) => `${k} (${BY_KEY[k].unit})`).join(', ')}.
Base them on published composition data (USDA, national food tables, research). Omit any without a reasonable basis.
Reply with JSON only inside <json></json>: {"values": {"key": number}, "basis": "one short sentence naming the data used"}`,
      maxTokens: 800
    });
    const j = parseJSON(text);
    let count = 0;
    for (const k of missing) {
      const v = Number(j.values?.[k]);
      if (Number.isFinite(v) && v >= 0 && v < 1e6) { per100[k] = { v, src: 'est' }; count++; }
    }
    return { count, note: `${j.basis || 'Typical published values'}. Estimated by ${aiName()}.` };
  } catch { return { count: 0 }; }
}

// A food picked from search results.
export async function foodFromSearchHit(hit, onStep) {
  if (hit.dataType === 'Branded' && hit.gtinUpc) return lookupBarcode(hit.gtinUpc, onStep);
  const id = 'fdc:' + hit.fdcId;
  const cached = store.food(id);
  if (cached) return cached;
  const per100 = deriveTotals(await fdcLabProfile(hit));
  // USDA lab data rarely covers iodine, chromium, molybdenum and biotin; estimate those so they aren't blank.
  const extra = await estimateRare(titleCase(hit.description), per100);
  const food = {
    id, name: titleCase(hit.description), brand: hit.dataType === 'Branded' ? (hit.brandName || hit.brandOwner || '') : '',
    servings: hit.servingSize && /g/i.test(hit.servingSizeUnit || '') ? [{ label: hit.householdServingFullText || 'Serving', grams: Number(hit.servingSize) }] : [],
    per100, createdAt: Date.now(),
    sources: [{ kind: 'lab', title: hit.dataType === 'Branded' ? 'USDA Branded Foods' : `USDA ${hit.dataType}`, url: `https://fdc.nal.usda.gov/food-details/${hit.fdcId}/nutrients`, count: Object.keys(per100).length - extra.count }]
  };
  if (extra.count) food.sources.push({ kind: 'est', title: 'Estimated trace nutrients', count: extra.count, note: extra.note });
  if (hit.dataType === 'Branded') Object.values(food.per100).forEach((c) => (c.src = 'label'));
  return store.saveFood(food);
}
