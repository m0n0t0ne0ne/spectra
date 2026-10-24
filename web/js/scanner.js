// Camera barcode scanning: native BarcodeDetector where available (Android Chrome),
// otherwise the ZXing library (bundled in vendor/, Apache-2.0), loaded on demand (iPhone Safari).
const ZXING_URL = './vendor/zxing-0.20.0.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

let stream = null, timer = null, zxReader = null, stopped = true;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the scanner library'));
    document.head.appendChild(s);
  });
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch { return null; }
}

// Starts scanning into <video>. Calls onCode(code) once, then stops.
export async function startScanner(video, onCode, onError) {
  stopScanner();
  stopped = false;
  if (!navigator.mediaDevices?.getUserMedia) { onError(new Error('This browser can’t open the camera. Type the code instead.')); return; }
  const detector = await nativeDetector();
  const done = (code) => {
    if (stopped) return;
    const clean = String(code).replace(/\D/g, '');
    if (clean.length < 6) return;
    if (navigator.vibrate) navigator.vibrate(40);
    stopScanner();
    onCode(clean);
  };
  try {
    if (detector) {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play();
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) return done(codes[0].rawValue);
        } catch { /* frame not ready */ }
        timer = setTimeout(tick, 220);
      };
      tick();
    } else {
      await loadScript(ZXING_URL);
      if (stopped) return;
      const ZX = window.ZXing;
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8, ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128]);
      zxReader = new ZX.BrowserMultiFormatReader(hints, 250);
      video.setAttribute('playsinline', '');
      await zxReader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result) => {
        if (result) done(result.getText());
      });
    }
  } catch (e) {
    stopScanner();
    const msg = e?.name === 'NotAllowedError' ? 'Camera permission was declined. Allow it in your browser settings, or type the code.' : (e?.message || 'Camera unavailable');
    onError(new Error(msg));
  }
}

export function stopScanner() {
  stopped = true;
  clearTimeout(timer); timer = null;
  try { zxReader?.reset(); } catch { /* ignore */ }
  zxReader = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

// Decode a still photo (fallback when live video isn't possible).
export async function decodeImageFile(file) {
  const detector = await nativeDetector();
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (detector) {
      const codes = await detector.detect(img);
      if (codes[0]) return codes[0].rawValue.replace(/\D/g, '');
    }
    await loadScript(ZXING_URL);
    const reader = new window.ZXing.BrowserMultiFormatReader();
    const r = await reader.decodeFromImageElement(img);
    return r.getText().replace(/\D/g, '');
  } finally {
    URL.revokeObjectURL(url);
  }
}
