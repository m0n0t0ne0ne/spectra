// Network calls: Open Food Facts, USDA FoodData Central, and the AI provider (Gemini or Claude).
import { NUTRIENTS, fromGrams, fdcToUnit } from './nutrients.js';
import { store } from './store.js';

const FDC = 'https://api.nal.usda.gov/fdc/v1';

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return res.json();
}

/* ---------------- Open Food Facts ---------------- */

export function isPlaceholderServing(s) {
  return Math.abs((s?.grams || 0) - 100) < 0.01 && (!s.label || /portion|^\s*100\s*(g|grams?)\s*$|^serving$/i.test(s.label));
}

export async function offProduct(code) {
  const fields = 'code,product_name,brands,quantity,serving_size,serving_quantity,nutriments,ingredients_text,ingredients_text_en,image_front_small_url';
  const data = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`);
  if (data.status !== 1 || !data.product) return null;
  const p = data.product;
  const n = p.nutriments || {};
  const per100 = {};
  for (const nu of NUTRIENTS) {
    if (!nu.off) continue;
    const raw = n[`${nu.off}_100g`];
    if (raw == null || raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    let val;
    if (nu.offUnit === 'kcal') val = v;
    else if (nu.offUnit === 'g→IU') val = v * 1e6 * 40; // g of vitamin D → µg → IU
    else val = fromGrams(v, nu.unit);
    per100[nu.key] = { v: val, src: 'label' };
  }
  if (per100.energy == null && n['energy_100g'] != null) per100.energy = { v: Number(n['energy_100g']) / 4.184, src: 'label' };
  let servingG = Number(p.serving_quantity) || null;
  // "1 portion (100 g)" is Open Food Facts' placeholder when nobody entered the label serving. Don't treat it as one.
  if (servingG && isPlaceholderServing({ label: p.serving_size || '', grams: servingG })) servingG = null;
  return {
    name: p.product_name || 'Unnamed product',
    brand: (p.brands || '').split(',')[0].trim(),
    upc: p.code || code,
    ingredients: p.ingredients_text_en || p.ingredients_text || '',
    servings: servingG ? [{ label: p.serving_size || 'Serving', grams: servingG }] : [],
    per100,
    source: { kind: 'label', title: 'Open Food Facts', url: `https://world.openfoodfacts.org/product/${encodeURIComponent(code)}` }
  };
}

/* ---------------- USDA FoodData Central ---------------- */

function fdcKey() { return store.settings().fdcKey || 'DEMO_KEY'; }

// Normalize the two nutrient shapes FDC returns (search results vs. food detail).
export function fdcNutrients(food, src) {
  const byNumber = {};
  for (const fn of food.foodNutrients || []) {
    const number = String(fn.nutrientNumber ?? fn.nutrient?.number ?? '');
    const amount = fn.value ?? fn.amount;
    const unitName = fn.unitName ?? fn.nutrient?.unitName;
    if (!number || amount == null) continue;
    byNumber[number] = { amount: Number(amount), unitName };
  }
  const per100 = {};
  for (const nu of NUTRIENTS) {
    for (const num of nu.fdc || []) {
      const hit = byNumber[num];
      if (hit && Number.isFinite(hit.amount)) { per100[nu.key] = { v: fdcToUnit(hit.amount, hit.unitName, nu.unit), src }; break; }
    }
    if (per100[nu.key] == null && nu.fdcAlt) {
      for (const [num, factor] of Object.entries(nu.fdcAlt)) {
        const hit = byNumber[num];
        if (hit) { per100[nu.key] = { v: hit.amount * factor, src }; break; }
      }
    }
  }
  return { per100, count: Object.keys(byNumber).length };
}

export async function fdcSearch(query, dataTypes = ['Foundation', 'SR Legacy', 'Branded'], pageSize = 25) {
  const params = new URLSearchParams({ api_key: fdcKey(), query, pageSize: String(pageSize) });
  params.set('dataType', dataTypes.join(','));
  const data = await getJSON(`${FDC}/foods/search?${params}`);
  return data.foods || [];
}

export async function fdcFood(fdcId) {
  return getJSON(`${FDC}/food/${fdcId}?api_key=${encodeURIComponent(fdcKey())}`);
}

export async function fdcByUPC(code) {
  const hits = await fdcSearch(code, ['Branded'], 10);
  const strip = (s) => String(s || '').replace(/^0+/, '');
  const hit = hits.find((f) => strip(f.gtinUpc) === strip(code)) || null;
  if (!hit) return null;
  const { per100 } = fdcNutrients(hit, 'label');
  return {
    name: titleCase(hit.description || 'Unnamed product'),
    brand: hit.brandName || hit.brandOwner || '',
    upc: code,
    ingredients: hit.ingredients || '',
    servings: hit.servingSize && /g|ml/i.test(hit.servingSizeUnit || '') ? [{ label: hit.householdServingFullText || 'Serving', grams: Number(hit.servingSize) }] : [],
    per100,
    fdcId: hit.fdcId,
    source: { kind: 'label', title: 'USDA Branded Foods', url: `https://fdc.nal.usda.gov/food-details/${hit.fdcId}/nutrients` }
  };
}

// Full lab profile for a generic food; search results sometimes carry a short nutrient list.
export async function fdcLabProfile(hit) {
  let { per100, count } = fdcNutrients(hit, 'lab');
  if (count < 25 && hit.fdcId) {
    try { ({ per100 } = fdcNutrients(await fdcFood(hit.fdcId), 'lab')); } catch { /* keep the short list */ }
  }
  return per100;
}

export function titleCase(s) {
  return String(s).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/* ---------------- Claude ---------------- */

export function aiProvider() {
  const s = store.settings();
  if (s.provider === 'claude') return s.claudeKey ? 'claude' : null;
  if (s.provider === 'gemini') return s.geminiKey ? 'gemini' : null;
  return s.geminiKey ? 'gemini' : s.claudeKey ? 'claude' : null;
}
export function hasAI() { return !!aiProvider(); }
export function aiName() { return aiProvider() === 'claude' ? 'Claude' : 'Gemini'; }

// Ask whichever AI the user picked. Returns { text, sources:[{url,title}] }.
export function askAI(opts) {
  const p = aiProvider();
  if (p === 'gemini') return gemini(opts);
  if (p === 'claude') return claude(opts);
  throw Object.assign(new Error('Add a Gemini or Claude API key in Targets'), { code: 'no_key' });
}

/* ---------------- Gemini ---------------- */

export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];

// Google answers 429 for three different reasons; only the first is worth waiting for.
//   minute: too many requests or tokens this minute → wait the delay Google gives, retry once
//   day:    this model's daily allowance is used up → try the other model once
//   none:   the feature isn't on this tier ("limit: 0"), e.g. Google Search on a free key → retry without search
export function quotaKind(status, errJSON) {
  if (status !== 429) return null;
  const e = errJSON?.error || {};
  const details = e.details || [];
  const msg = String(e.message || '');
  const violations = details.flatMap((d) => d.violations || []);
  const ids = violations.map((v) => `${v.quotaId || ''} ${v.quotaMetric || ''}`).join(' ');
  const retry = details.find((d) => /RetryInfo/.test(d['@type'] || ''))?.retryDelay;
  const delaySec = retry ? parseFloat(retry) : null;
  const zero = /limit:\s*0\b/i.test(msg) || violations.some((v) => String(v.quotaValue) === '0');
  const search = /search|grounding/i.test(`${msg} ${ids}`);
  const day = /per\s*day|PerDay|daily/i.test(`${msg} ${ids}`);
  return { kind: zero ? 'none' : day ? 'day' : 'minute', search, delaySec, message: msg };
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); }, { once: true });
});

// Plain-language version of Google's reason, keeping Google's own words at the end.
function quotaMessage(q, model) {
  const google = q.message ? ` (Google: “${q.message.split('\n')[0].slice(0, 220)}”)` : '';
  if (q.kind === 'none' && q.search) return `Google doesn’t allow web search on your key’s tier${google}`;
  if (q.kind === 'none') return `${model} isn’t available on your key’s tier${google}`;
  if (q.kind === 'day') return `Today’s Gemini allowance for your key is used up; it resets at midnight Pacific time${google}`;
  return `Gemini is busy for your key this minute; try again in a minute${google}`;
}

// One request, plus at most one justified retry. onWait(seconds) lets the screen say why it's pausing.
// Returns { text, sources, model, searched }.
export async function gemini({ system, prompt, search = false, maxTokens = 2000, signal, onWait, images = [] }) {
  const s = store.settings();
  if (!s.geminiKey) throw Object.assign(new Error('No Gemini API key'), { code: 'no_key' });
  let model = GEMINI_MODELS.includes(s.geminiModel) ? s.geminiModel : GEMINI_MODELS[0];
  let useSearch = search;
  let retried = false, switched = false;
  for (;;) {
    const body = {
      contents: [{ role: 'user', parts: [...images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } })), { text: prompt }] }],
      systemInstruction: { parts: [{ text: system }] },
      // Thinking models count reasoning toward this limit, so leave room. Only tokens actually used count toward quota.
      generationConfig: { maxOutputTokens: Math.max(8192, maxTokens * 3) }
    };
    if (useSearch) body.tools = [{ google_search: {} }];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': s.geminiKey },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      const c = data.candidates?.[0];
      const text = (c?.content?.parts || []).map((p) => p.text || '').join('');
      const sources = (c?.groundingMetadata?.groundingChunks || []).map((g) => g.web).filter((w) => w?.uri).map((w) => ({ url: w.uri, title: w.title || '' }));
      if (!text) throw new Error(c?.finishReason ? `Gemini stopped (${c.finishReason})` : 'Empty reply from Gemini');
      return { text, sources, model, searched: useSearch };
    }
    const raw = await res.text().catch(() => '');
    let errJSON = null;
    try { errJSON = JSON.parse(raw); } catch { /* not JSON */ }
    const q = quotaKind(res.status, errJSON);
    if (q) {
      if (q.kind === 'none' && useSearch) { useSearch = false; continue; } // search not allowed: same request without it
      if (q.kind === 'minute' && !retried) {
        retried = true;
        const wait = Math.min(Math.max(q.delaySec ?? 20, 2), 30);
        onWait?.(Math.round(wait));
        await sleep(wait * 1000, signal);
        continue;
      }
      if ((q.kind === 'day' || q.kind === 'none') && !switched) {
        const other = GEMINI_MODELS.find((m) => m !== model);
        if (other) { switched = true; model = other; continue; }
      }
      throw Object.assign(new Error(quotaMessage(q, model)), { status: 429, code: 'quota', quota: q.kind });
    }
    const msg = errJSON?.error?.message || `Gemini API error ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
}


export async function claude({ system, prompt, search = false, maxTokens = 2000, signal }) {
  const s = store.settings();
  if (!s.claudeKey) throw Object.assign(new Error('No Claude API key'), { code: 'no_key' });
  const messages = [{ role: 'user', content: prompt }];
  const body = { model: s.model || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages };
  if (search) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  let sources = [];
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': s.claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      let msg = `Claude API error ${res.status}`;
      try { msg = JSON.parse(t).error?.message || msg; } catch { /* ignore */ }
      throw Object.assign(new Error(msg), { status: res.status });
    }
    const data = await res.json();
    for (const b of data.content || []) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        sources = sources.concat(b.content.filter((r) => r.url).map((r) => ({ url: r.url, title: r.title })));
      }
    }
    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, sources };
  }
  throw new Error('Claude did not finish');
}

export function parseJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const tagged = text.match(/<json>([\s\S]*?)<\/json>/);
  let raw = (tagged && tagged[1]) || (fenced && fenced[1]);
  if (!raw) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) raw = text.slice(start, end + 1);
  }
  if (!raw) throw new Error('No JSON in reply');
  return JSON.parse(raw);
}
