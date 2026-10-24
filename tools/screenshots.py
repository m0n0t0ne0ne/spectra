"""Renders the store/website screenshots from the web app with demo data.
Usage: python3 tools/screenshots.py   (needs: pip install playwright && playwright install chromium)"""
import threading, http.server, socketserver, functools, pathlib, datetime
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'screenshots'
DEMO = (ROOT / 'tools' / 'demo-data.js').read_text()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'web')))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/'

def shot(pg, name, hash_=None, scroll_to=None, offset=-12, wait=450, before=None):
    if hash_ is not None:
        pg.goto(base + hash_); pg.wait_for_timeout(wait)
    if before: before(pg); pg.wait_for_timeout(350)
    if scroll_to:
        pg.evaluate("([sel, off]) => { const el = document.querySelector(sel); window.scrollTo(0, el.getBoundingClientRect().top + scrollY + off); }", [scroll_to, offset])
        pg.wait_for_timeout(250)
    pg.screenshot(path=str(OUT / f'{name}.png'))
    print('saved', name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    ctx.route('**/*', lambda r: r.continue_() if '127.0.0.1' in r.request.url else r.abort())
    # Render as the Android app does: storage through the app bridge (backed by localStorage here).
    ctx.add_init_script("""window.AndroidBridge = {
      storeRead: (k) => localStorage.getItem(k), storeWrite: (k, v) => { localStorage.setItem(k, v); return true; },
      storeInfo: () => JSON.stringify({ free: 48.2e9, total: 128e9 }), appVersion: () => '1.0.0',
      saveFile: () => true, readClipboard: () => '', scanBarcode: () => {}, pickFile: () => {}, shareToGemini: () => true };""")
    pg = ctx.new_page()
    noon = datetime.datetime.now().replace(hour=13, minute=5, second=0, microsecond=0)
    pg.clock.set_fixed_time(noon)
    pg.goto(base); pg.evaluate(DEMO); pg.reload(); pg.wait_for_timeout(400)
    today = pg.evaluate("new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10)")
    yday = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() - 1); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); })()")
    shot(pg, '01-diary', f'#/day/{yday}')
    shot(pg, '02-meals', None, scroll_to='.card.meal', offset=-70)
    pg.evaluate("window.scrollTo(0,0)")
    shot(pg, '03-trend', f'#/day/{yday}', before=lambda pg: (pg.tap('[data-act=sum-tab][data-i="3"]'), pg.tap('[data-act=trend-range][data-v=month]')))
    shot(pg, '04-add-food', f'#/scan?date={today}&meal=lunch')
    sday, eid = pg.evaluate("(() => { const l = JSON.parse(localStorage.getItem('nt.log')); const d = Object.keys(l).sort().reverse().find(k => l[k].some(e => e.foodId === 'salmon')); return [d, l[d].find(e => e.foodId === 'salmon').id]; })()")
    shot(pg, '05-food', f'#/food/salmon?date={sday}&entry={eid}')
    shot(pg, '06-food-nutrients', None, scroll_to='#sec-nutrients', offset=-90)
    shot(pg, '07-report', f'#/report/{yday}')
    shot(pg, '08-insights', '#/insights')
    shot(pg, '09-insights-balance', None, scroll_to='#ins-balance')
    shot(pg, '10-insights-weight', None, scroll_to='#ins-weight')
    shot(pg, '11-insights-nutrients', None, scroll_to='#ins-nutrients')
    shot(pg, '12-insights-change', None, scroll_to='#ins-change')
    shot(pg, '13-targets', '#/settings')
    shot(pg, '14-storage', None, scroll_to='.dm-cat', offset=-150)
    shot(pg, '15-data-diary', '#/data/diary', before=lambda pg: pg.tap('[data-act=dm-pick][data-v=all]'))
    shot(pg, '16-meal-menu', f'#/day/{yday}', before=lambda pg: pg.evaluate("document.querySelector('[data-act=meal-menu][data-meal=dinner]').click()"), scroll_to='.card.meal:last-of-type', offset=-60)
    b.close()
srv.shutdown()
