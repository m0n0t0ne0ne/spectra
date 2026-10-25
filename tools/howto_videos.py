"""Records the how-to clips on the website from the real app, driven by Playwright.

Each clip runs the web app at phone size with demo data, shows where it taps (a mint ring) and a caption for
each step, and is saved to docs/howto/<name>.mp4 with a poster image. Re-run after UI changes:

    pip install playwright && python3 tools/howto_videos.py      (needs ffmpeg)
"""
import datetime, sys, functools, http.server, json, pathlib, shutil, socketserver, subprocess, tempfile, threading
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'howto'
DEMO = (ROOT / 'tools' / 'demo-data.js').read_text()
W, H = 390, 844

# A sample answer in the format Spectra asks Gemini for (a generic bar, not a real product).
GEMINI_ANSWER = """Product: Chocolate Peanut Butter Protein Bar
Serving size: 1 bar (60 g)
Calories: 230 kcal
Total Fat: 9 g
Saturated Fat: 3.5 g
Trans Fat: 0 g
Cholesterol: 5 mg
Sodium: 210 mg
Total Carbohydrate: 23 g
Dietary Fiber: 9 g
Total Sugars: 2 g
Added Sugars: 1 g
Protein: 20 g
Vitamin D: 0 mcg
Calcium: 160 mg
Iron: 2 mg
Potassium: 190 mg
Magnesium: 60 mg (est.)
Zinc: 1.5 mg (est.)
Phosphorus: 210 mg (est.)
Selenium: 6 mcg (est.)
Copper: 0.3 mg (est.)
Manganese: 0.5 mg (est.)
Vitamin E: 1.2 mg (est.)
Leucine: 1.9 g (est.)
Omega-3 (ALA): unavailable"""

# Runs before the app: demo data once, the Android bridge (storage + clipboard), and the tap/caption overlay.
INIT = """
(() => {
  if (!localStorage.getItem('nt.log')) { __DEMO__ }
  window.AndroidBridge = {
    storeRead: (k) => localStorage.getItem(k), storeWrite: (k, v) => { localStorage.setItem(k, v); return true; },
    storeInfo: () => JSON.stringify({ free: 48.2e9, total: 128e9 }), appVersion: () => '1.0',
    saveFile: () => true, scanBarcode: () => {}, pickFile: () => {}, shareToGemini: () => true,
    readClipboard: () => __ANSWER__
  };
  const css = `
    #hx-layer{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:Manrope,system-ui,sans-serif}
    .hx-tap{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #8FD3B6;background:rgba(143,211,182,.28);animation:hxtap .7s ease-out forwards}
    @keyframes hxtap{0%{transform:scale(.55);opacity:1}60%{transform:scale(1.05);opacity:1}100%{transform:scale(1.35);opacity:0}}
    .hx-finger{position:absolute;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #8FD3B6;background:rgba(143,211,182,.35);display:none}
    .hx-cap{position:absolute;left:14px;right:14px;display:flex;gap:10px;align-items:center;padding:11px 14px;border-radius:18px;background:rgba(10,13,11,.94);border:1px solid rgba(143,211,182,.35);color:#E8ECE9;font-size:15px;font-weight:600;line-height:1.3;box-shadow:0 10px 30px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s}
    .hx-cap.on{opacity:1;transform:none}
    .hx-cap b{flex:none;width:26px;height:26px;border-radius:13px;background:#8FD3B6;color:#12201A;display:flex;align-items:center;justify-content:center;font-size:13px}
    .hx-scene{position:absolute;inset:0;background:rgba(10,13,11,.93);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center;color:#E8ECE9;opacity:0;transition:opacity .3s}
    .hx-scene.on{opacity:1}
    .hx-scene .t{font-size:22px;font-weight:700;letter-spacing:-.01em}
    .hx-scene .s{font-size:15.5px;color:#A3ABA6;line-height:1.5;max-width:300px}
    .hx-scene .i{width:64px;height:64px;border-radius:20px;background:rgba(143,211,182,.16);display:flex;align-items:center;justify-content:center;color:#8FD3B6;font-size:30px}`;
  const boot = () => {
    if (document.getElementById('hx-layer')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const layer = document.createElement('div'); layer.id = 'hx-layer';
    layer.innerHTML = '<div class="hx-finger"></div><div class="hx-cap"><b></b><span></span></div><div class="hx-scene"><div class="i"></div><div class="t"></div><div class="s"></div></div>';
    document.body.appendChild(layer);
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
  window.__hx = {
    tap(x, y) { const d = document.createElement('div'); d.className = 'hx-tap'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.getElementById('hx-layer').appendChild(d); setTimeout(() => d.remove(), 800); },
    finger(x, y, on) { const f = document.querySelector('.hx-finger'); f.style.display = on ? 'block' : 'none'; if (on) { f.style.left = x + 'px'; f.style.top = y + 'px'; } },
    caption(n, text, where) {
      const c = document.querySelector('.hx-cap');
      if (!text) { c.classList.remove('on'); return; }
      c.querySelector('b').textContent = n; c.querySelector('span').textContent = text;
      c.style.top = where === 'top' ? '14px' : ''; c.style.bottom = where === 'top' ? '' : '104px';
      c.classList.add('on');
    },
    scene(icon, title, sub) {
      const s = document.querySelector('.hx-scene');
      if (!title) { s.classList.remove('on'); return; }
      s.querySelector('.i').textContent = icon; s.querySelector('.t').textContent = title; s.querySelector('.s').textContent = sub || '';
      s.classList.add('on');
    }
  };
})();
"""


class Clip:
    """Small helpers so each script reads like the steps a person takes."""
    def __init__(self, pg):
        self.pg = pg
        self.n = 0

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def cap(self, text, where='bottom', hold=1100):
        self.n += 1
        self.pg.evaluate('([n,t,w]) => __hx.caption(n,t,w)', [str(self.n), text, where])
        self.wait(hold)

    def nocap(self):
        self.pg.evaluate('() => __hx.caption()')

    def center(self, sel):
        loc = self.pg.locator(sel).first
        loc.scroll_into_view_if_needed()
        self.wait(250)
        b = loc.bounding_box()
        return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

    def tap(self, sel, after=700):
        print('   tap', sel)
        x, y = self.center(sel)
        self.pg.evaluate('([x,y]) => __hx.tap(x,y)', [x, y])
        self.wait(260)
        self.pg.mouse.click(x, y)
        self.wait(after)

    def type(self, sel, text, after=500):
        self.tap(sel, after=200)
        self.pg.keyboard.type(text, delay=70)
        self.wait(after)

    def scroll_to(self, sel, offset=-120):
        self.pg.evaluate("""([s,o]) => { const el = document.querySelector(s);
          window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + o, behavior: 'smooth' }); }""", [sel, offset])
        self.wait(700)

    def swipe(self, sel, dx, dy=0, steps=14, hold=0):
        x, y = self.center(sel)
        x -= 60
        self.pg.evaluate('([x,y]) => __hx.finger(x,y,true)', [x, y])
        self.pg.mouse.move(x, y); self.pg.mouse.down()
        if hold:
            self.wait(hold)
        for i in range(1, steps + 1):
            px, py = x + dx * i / steps, y + dy * i / steps
            self.pg.mouse.move(px, py)
            self.pg.evaluate('([x,y]) => __hx.finger(x,y,true)', [px, py])
            self.wait(28)
        self.pg.mouse.up()
        self.pg.evaluate('() => __hx.finger(0,0,false)')
        self.wait(600)


def add_food(c, base, day):
    c.pg.goto(base + f'#/day/{day}'); c.wait(900)
    c.scroll_to('.card.meal:nth-of-type(2)', -90)
    c.cap('Tap + on a meal')
    c.tap('[data-swipe=lunch] .add-btn', after=900)
    c.cap('Search your foods, USDA or a barcode number', 'top')
    c.type('#add-q', 'greek', after=900)
    c.cap('Tap a food to open it', 'top')
    c.tap('#main a[href*="food/yogurt"]', after=1000)
    c.cap('Set the amount: − / + or type it')
    c.tap('[data-act=qty][data-d="1"]', after=900)
    c.cap('Or switch units: servings, g, oz, Baking')
    c.tap('button[data-act=unit]:text-is("g")', after=1000)
    c.tap('[data-act=unit] >> nth=0', after=700)
    c.cap('Tap Add to Lunch')
    c.tap('[data-act=save-entry]', after=1100)
    c.scroll_to('[data-swipe=lunch]', -90)
    c.cap('It’s in your diary, with every nutrient', hold=2200)


def gemini(c, base, day):
    c.pg.goto(base + f'#/scan?date={day}&meal=snacks'); c.wait(900)
    c.cap('Type the product’s name', 'top')
    c.type('#add-q', 'Chocolate Peanut Butter Protein Bar', after=300)
    c.pg.keyboard.press('Enter'); c.wait(1300)
    c.cap('Not in any database? Tap ✦ Ask Gemini', 'top')
    c.tap('[data-act=add-ask]', after=800)
    c.nocap()
    c.pg.evaluate("() => __hx.scene('✦', 'Gemini opens with the question ready', 'Send it, then copy Gemini’s answer (or tap Share → Spectra).')")
    c.wait(3200)
    c.pg.evaluate('() => __hx.scene()'); c.wait(500)
    c.cap('Back in Spectra, tap Paste nutrient info')
    c.tap('[data-act=paste-open]', after=900)
    c.cap('Tap Paste to bring in Gemini’s answer', 'top')
    c.tap('[data-act=paste-clip]', after=1200)
    c.cap('Tap Read nutrients', 'top')
    c.tap('[data-act=paste-read]', after=1600)
    c.cap('Check what was found: est. marks estimates', 'top', hold=1600)
    c.pg.evaluate("() => { const s = document.querySelector('.scrim .sheet'); s && s.scrollBy({ top: 420, behavior: 'smooth' }); }"); c.wait(1100)
    c.cap('Tap Fill to save them to this food', 'top')
    c.tap('[data-act=paste-apply]', after=1300)
    c.cap('The label serving (1 bar) is ready. Tap Add')
    c.tap('[data-act=save-entry]', after=1100)
    c.scroll_to('[data-swipe=snacks]', -90)
    c.cap('Logged, with every nutrient Gemini found', hold=2200)


def edit_serving(c, base, day):
    c.pg.goto(base + f'#/day/{day}'); c.wait(900)
    c.scroll_to('[data-swipe=breakfast]', -90)
    c.cap('Tap a food you logged')
    c.tap('[data-head^="e:"] .entry-row', after=1000)
    c.cap('Change the amount: numbers update as you go')
    c.tap('[data-act=qty][data-d="1"]', after=700)
    c.tap('[data-act=qty][data-d="1"]', after=900)
    c.cap('“Was …” shows what’s logged. Nothing is saved yet', 'bottom', hold=1600)
    c.cap('Tap Save to keep it, or Back to discard', 'bottom')
    c.tap('.save-pill', after=1200)
    c.cap('Set the label’s serving size: tap Edit serving')
    c.tap('[data-act=serving-edit]', after=900)
    c.cap('Enter the amount and pick its unit')
    c.pg.fill('#sv-amt', ''); c.type('#sv-amt', '1', after=300)
    if c.pg.locator('#sv-baking').is_hidden():
        c.tap('[data-act=sv-baking]', after=600)
    c.tap('[data-act=sv-unit][data-u=cup]', after=700)
    c.cap('Add its weight from the label')
    c.pg.fill('#sv-grams', ''); c.type('#sv-grams', '80', after=500)
    c.tap('[data-act=serving-save]', after=1300)
    c.cap('“1 cup (80 g)” is now a unit you can tap', hold=1600)
    c.cap('Tap Save to log 1 cup')
    c.tap('.save-pill', after=1200)
    c.cap('Saved. Calories and nutrients follow the new amount', hold=2000)


def swipes(c, base, day):
    c.pg.goto(base + f'#/day/{day}'); c.wait(900)
    c.scroll_to('[data-swipe=breakfast]', -90)
    c.cap('Swipe a meal to the right')
    c.swipe('[data-swipe=breakfast]', 120)
    c.cap('Tap ⋯ for its menu')
    c.tap('[data-act=meal-menu][data-meal=breakfast]', after=1000)
    c.cap('Move meals, rename, add or delete them', hold=1500)
    c.tap('[data-act=meal-move][data-meal=breakfast][data-dir="1"]', after=1100)
    c.cap('Breakfast moved below Lunch', hold=1300)
    c.tap('[data-act=meal-menu][data-meal=breakfast]', after=700)
    c.swipe('[data-swipe=breakfast]', -120)
    c.scroll_to('[data-swipe=lunch]', -90)
    c.cap('Swipe a food to the right')
    c.swipe('[data-head^="e:"] [data-swipe]', 120)
    c.tap('[data-head^="e:"].open [data-act=entry-menu]', after=1000)
    c.cap('Copy it to tomorrow, add it again, or remove it', hold=1600)
    c.tap('[data-act=entry-copy]', after=1300)
    c.cap('Long-press a food, then drag to reorder')
    c.swipe('.entry-list .entry-row >> nth=0', 0, 120, steps=16, hold=650)
    c.cap('Your order is saved', hold=1800)


CLIPS = [
    ('add-food', 'Add a food', add_food, 9),
    ('gemini', 'Ask Gemini, paste and save', gemini, 23),
    ('edit-serving', 'Edit a portion and serving size', edit_serving, 6),
    ('swipes', 'Swipe menus and reordering', swipes, 6),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(type('Q', (http.server.SimpleHTTPRequestHandler,), {'log_message': lambda *a: None}), directory=str(ROOT / 'web')))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/'
    init = INIT.replace('__DEMO__', DEMO).replace('__ANSWER__', json.dumps(GEMINI_ANSWER))
    noon = datetime.datetime.now().replace(hour=13, minute=5, second=0, microsecond=0)
    today = noon.date().isoformat()
    with sync_playwright() as p:
        b = p.chromium.launch()
        only = sys.argv[1:]
        for name, _title, script, poster_at in CLIPS:
            if only and name not in only:
                continue
            tmp = pathlib.Path(tempfile.mkdtemp())
            ctx = b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=2,
                                record_video_dir=str(tmp), record_video_size={'width': W, 'height': H})
            ctx.route('**/*', lambda r: r.continue_() if '127.0.0.1' in r.request.url else
                      r.fulfill(status=200, content_type='application/json', body='{"foods":[],"totalHits":0}') if 'api.nal.usda.gov' in r.request.url else r.abort())
            ctx.add_init_script(init)
            pg = ctx.new_page()
            pg.clock.set_fixed_time(noon)
            t0 = datetime.datetime.now()
            pg.goto(base); pg.wait_for_timeout(1200)
            lead = (datetime.datetime.now() - t0).total_seconds()
            script(Clip(pg), base, today)
            pg.wait_for_timeout(400)
            video = pg.video.path()
            ctx.close()
            mp4 = OUT / f'{name}.mp4'
            # Drop the loading second, encode small H.264 that plays everywhere, and grab a poster.
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{lead + 0.4:.2f}', '-i', video, '-vf', f'crop={W}:{H}:0:0,fps=30',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(mp4)], check=True)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{lead + 0.4:.2f}', '-i', video, '-vf', f'crop={W}:{H}:0:0,fps=30',
                            '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', '-an', str(OUT / f'{name}.webm')], check=True)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', str(poster_at), '-i', str(mp4), '-frames:v', '1', '-q:v', '3', str(OUT / f'{name}.jpg')], check=True)
            shutil.rmtree(tmp, ignore_errors=True)
            print('saved', mp4.name, f'{mp4.stat().st_size // 1024} KB')
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
