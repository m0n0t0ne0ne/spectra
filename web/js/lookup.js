// Names barcodes the food databases don't know (UPCitemdb), fetched through the Android app.

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
