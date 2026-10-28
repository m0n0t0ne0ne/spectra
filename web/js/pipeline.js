// What happens after a scan: product info only. No AI.
// 1. Open Food Facts and USDA Branded give the name, brand, ingredients, serving size and the label's values.
// 2. A barcode neither knows: UPCitemdb gives the name and brand.
// Everything else comes from Ask Gemini (the Gemini app) and Paste answer on the food page.
// Every value keeps a `src` tag: label | spec | lab | est.
import { deriveTotals } from './nutrients.js';
import { offProduct, fdcByUPC, fdcLabProfile, titleCase } from './api.js';
import { store } from './store.js';
import { upcItemDb } from './lookup.js';

function fill(target, add) {
  for (const [k, cell] of Object.entries(add || {})) if (target[k] == null) target[k] = cell;
}

/* ---------- the whole chain for a barcode ---------- */

// onStep(stepId, status, detail) — steps: info, nutrients. status: running | found | none | cached
export async function lookupBarcode(code, onStep = () => {}) {
  const id = 'upc:' + code.replace(/^0+/, '');
  const cached = store.food(id);
  // A placeholder you started for an unknown barcode (no nutrients yet) isn't a result: look it up again.
  if (cached && !cached.unidentified && Object.keys(cached.per100 || {}).length) {
    ['info', 'nutrients'].forEach((s) => onStep(s, 'cached', 'Saved earlier'));
    return cached;
  }

  onStep('info', 'running', 'Open Food Facts and USDA');
  let off = null, usda = null, upc = null;
  try { off = await offProduct(code); } catch { /* try USDA */ }
  try { usda = await fdcByUPC(code); } catch { /* ignore */ }
  if (!off && !usda) {
    onStep('info', 'running', 'Not in food databases. Checking UPCitemdb');
    upc = await upcItemDb(code).catch(() => null);
  }
  const base = off || usda || upc;
  if (!base) { onStep('info', 'none', 'Product not found'); throw Object.assign(new Error('Product not found'), { code: 'not_found' }); }

  // USDA's branded serving comes straight from the label, so it goes first.
  const servings = [...(usda?.servings || []), ...(off?.servings || [])].filter((x, i, all) => all.findIndex((y) => Math.abs(y.grams - x.grams) < 0.5) === i);
  const per100 = { ...(off?.per100 || {}) };
  fill(per100, usda?.per100);
  deriveTotals(per100);
  const n = Object.keys(per100).length;
  const infoFrom = [off && 'Open Food Facts', usda && 'USDA', upc && 'UPCitemdb'].filter(Boolean).join(' + ');
  const food = {
    ...(cached || {}),
    id, name: base.name || cached?.name || '', brand: base.brand || usda?.brand || cached?.brand || '', upc: code,
    ingredients: off?.ingredients || usda?.ingredients || '',
    servings: servings.length ? servings : cached?.servings || [], per100, createdAt: cached?.createdAt || Date.now(),
    sources: [
      { kind: 'label', title: `Product info: ${infoFrom}`, url: off?.source?.url || usda?.source?.url || (upc ? `https://www.upcitemdb.com/upc/${code}` : ''), count: 0, note: 'Name, brand, ingredients and serving size' },
      n ? { kind: 'label', title: 'Label values from the databases', count: n, note: 'Use Ask Gemini on this food for the nutrients labels leave out' } : null
    ].filter(Boolean)
  };
  delete food.unidentified;
  onStep('info', 'found', [food.brand, food.name].filter(Boolean).join(' ') || 'Found');
  onStep('nutrients', n ? 'found' : 'none', n ? `${n} label values` : 'No label values. Use Ask Gemini on the next screen');
  return store.saveFood(food);
}

// A food picked from search results.
export async function foodFromSearchHit(hit, onStep) {
  if (hit.dataType === 'Branded' && hit.gtinUpc) return lookupBarcode(hit.gtinUpc, onStep);
  const id = 'fdc:' + hit.fdcId;
  const cached = store.food(id);
  if (cached) return cached;
  const per100 = deriveTotals(await fdcLabProfile(hit));
  const food = {
    id, name: titleCase(hit.description), brand: hit.dataType === 'Branded' ? (hit.brandName || hit.brandOwner || '') : '',
    servings: hit.servingSize && /g/i.test(hit.servingSizeUnit || '') ? [{ label: hit.householdServingFullText || 'Serving', grams: Number(hit.servingSize) }] : [],
    per100, createdAt: Date.now(),
    sources: [{ kind: 'lab', title: hit.dataType === 'Branded' ? 'USDA Branded Foods' : `USDA ${hit.dataType}`, url: `https://fdc.nal.usda.gov/food-details/${hit.fdcId}/nutrients`, count: Object.keys(per100).length }]
  };
  if (hit.dataType === 'Branded') Object.values(food.per100).forEach((c) => (c.src = 'label'));
  return store.saveFood(food);
}
