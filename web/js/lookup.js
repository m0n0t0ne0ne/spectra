// Finds a product's own pages without using Gemini's web search: UPCitemdb names unknown barcodes, Brave or
// DuckDuckGo finds the brand's and retailers' pages, and the app fetches them. Only the nutrition-related text is
// kept, so the one Gemini request that reads it stays small.
import { store } from './store.js';

/* ---------- fetching other sites ---------- */

// The Android app fetches pages for us (web views can't read other sites). In a browser, try a normal fetch;
// most sites block that, so callers treat null as "no page".
const pending = new Map();
let seq = 0;
if (typeof window !== 'undefined') {
  window.__onFetchText = (id, status, finalUrl, text) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(status >= 200 && status < 300 ? { status, url: finalUrl, text } : null);
  };
}

export function fetchText(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const bridge = typeof window !== 'undefined' ? window.AndroidBridge : null;
  if (bridge && typeof bridge.fetchText === 'function') {
    return new Promise((resolve) => {
      const id = 'f' + (++seq);
      const timer = setTimeout(() => { pending.delete(id); resolve(null); }, timeoutMs);
      pending.set(id, { resolve, timer });
      try { bridge.fetchText(id, url, JSON.stringify(headers)); } catch { clearTimeout(timer); pending.delete(id); resolve(null); }
    });
  }
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), timeoutMs);
  return fetch(url, { headers, signal: ctl?.signal }).then(async (r) => (r.ok ? { status: r.status, url: r.url || url, text: await r.text() } : null))
    .catch(() => null).finally(() => clearTimeout(timer));
}

/* ---------- unknown barcodes: name and brand ---------- */

// UPCitemdb's free trial: about 100 lookups a day, no key. Names the product; rarely has nutrition.
export async function upcItemDb(code) {
  const r = await fetchText(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
  if (!r) return null;
  try {
    const item = JSON.parse(r.text).items?.[0];
    if (!item?.title) return null;
    return { name: item.title.trim(), brand: (item.brand || '').trim(), description: (item.description || '').slice(0, 600) };
  } catch { return null; }
}

/* ---------- web search ---------- */

const SKIP_HOSTS = /(^|\.)(youtube|facebook|instagram|pinterest|tiktok|reddit|twitter|x|linkedin|amazon|ebay|walmart|quora|wikipedia)\.[a-z.]+$/i;

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Brave Search API when you've added a key (more reliable); DuckDuckGo's results page otherwise.
export async function webSearch(query, count = 8) {
  const key = store.settings().braveKey;
  let results = [];
  if (key) {
    const r = await fetchText(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
      { headers: { Accept: 'application/json', 'X-Subscription-Token': key } });
    try { results = (JSON.parse(r?.text || '{}').web?.results || []).map((x) => ({ url: x.url, title: x.title || '', snippet: (x.description || '').replace(/<[^>]+>/g, '') })); } catch { results = []; }
    if (results.length) return { engine: 'Brave', results };
  }
  const r = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  results = r ? parseDuckDuckGo(r.text) : [];
  return { engine: 'DuckDuckGo', results };
}

// Result links on DuckDuckGo's HTML page point through a redirect (…/l/?uddg=<real url>).
export function parseDuckDuckGo(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js|[?&]ad_domain=/.test(href)) continue;
    const snippet = html.slice(m.index, m.index + 3000).match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '';
    out.push({ url: href, title: textOf(m[2]), snippet: textOf(snippet) });
  }
  return out;
}

// Brand's own site first, then pages that look like nutrition pages; skip social, video and sites that block apps.
export function rankResults(results, brand) {
  const words = String(brand || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  const seen = new Set();
  return results.filter((r) => {
    const h = hostOf(r.url);
    if (!h || SKIP_HOSTS.test(h) || seen.has(r.url) || /\.pdf($|\?)/i.test(r.url)) return false;
    seen.add(r.url);
    return true;
  }).map((r) => {
    const h = hostOf(r.url).replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (words.some((w) => h.includes(w))) score += 5;
    if (/nutrition|supplement facts|ingredients/i.test(`${r.title} ${r.snippet}`)) score += 2;
    if (/\d+\s*(mg|mcg|g)\b/i.test(r.snippet)) score += 1;
    return { ...r, score };
  }).sort((a, b) => b.score - a.score);
}

/* ---------- page text ---------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mu: 'µ', micro: 'µ', ndash: '–', mdash: '—', deg: '°', reg: '®', trade: '™', copy: '©' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const textOf = (html) => decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const NUTRI = /\b(nutrition|supplement facts|serving size|servings? per|calories|energy|kcal|total fat|saturated|trans fat|cholesterol|sodium|carbohydrate|fiber|fibre|sugars?|protein|vitamin|calcium|iron|potassium|magnesium|zinc|selenium|copper|manganese|phosphorus|iodine|chromium|molybdenum|biotin|folate|niacin|thiamin|riboflavin|choline|omega|amino|leucine|isoleucine|valine|lysine|glutamine|caffeine|% ?dv|daily value|ingredients)\b/i;

// The parts of a page that describe nutrition: structured data first, then lines with nutrient words or amounts.
export function nutritionText(html, max = 2600) {
  const parts = [];
  // schema.org NutritionInformation, used by many brand and retailer pages
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = m[1];
    const nut = j.match(/"nutrition"\s*:\s*\{[^{}]*\}/i);
    if (nut) parts.push(nut[0].replace(/"@type"\s*:\s*"[^"]*",?/g, '').replace(/[{}"]/g, ' ').replace(/\s+/g, ' '));
    const name = j.match(/"name"\s*:\s*"([^"]{3,120})"/);
    if (name && !parts.some((p) => p.startsWith('Product name'))) parts.unshift(`Product name: ${name[1]}`);
  }
  const body = String(html)
    .replace(/<(script|style|noscript|svg|template|iframe|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td|\/th|\/dt|\/dd|\/section|\/table)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const lines = decodeEntities(body).split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && l.length < 400);
  const keep = new Set();
  lines.forEach((l, i) => {
    if (NUTRI.test(l) || /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|kcal|iu)\b/i.test(l)) { keep.add(i); if (i + 1 < lines.length) keep.add(i + 1); }
  });
  let out = parts.join('\n');
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (out.length + lines[i].length + 1 > max) break;
    if (!out.endsWith(lines[i])) out += (out ? '\n' : '') + lines[i];
  }
  return out.slice(0, max).trim();
}

// Search, fetch up to `pages` pages in parallel, and return the useful text of each.
export async function productPages(query, brand, { pages = 3, maxTotal = 6000, onProgress } = {}) {
  onProgress?.('Searching the web');
  const { engine, results } = await webSearch(query);
  const ranked = rankResults(results, brand).slice(0, pages + 2);
  if (!ranked.length) return { engine, pages: [] };
  onProgress?.(`Reading ${Math.min(pages, ranked.length)} pages`);
  const fetched = await Promise.all(ranked.map((r) => fetchText(r.url).then((p) => (p ? { ...r, url: p.url, text: nutritionText(p.text) } : null))));
  const good = fetched.filter((p) => p && p.text.length > 120 && NUTRI.test(p.text)).slice(0, pages);
  // Share the character budget between the pages, keeping each one's most useful part.
  const each = Math.floor(maxTotal / Math.max(1, good.length));
  return { engine, pages: good.map((p) => ({ url: p.url, title: p.title, text: p.text.slice(0, each) })), results: ranked };
}
