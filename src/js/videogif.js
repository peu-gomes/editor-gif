// Converte vídeo (MP4, WebM...) em GIF, tudo dentro do navegador.
// Mesma ideia do ffmpeg:  fps=15,scale=1280:-1, palettegen=stats_mode=diff, paletteuse=dither=none, diff_mode=rectangle
//  - largura = menor entre a do vídeo e 1280 (nunca aumenta); fps = no máximo 15 (frames repetidos viram um só, com mais duração)
//  - UMA paleta de até 255 cores para o GIF inteiro (+1 cor transparente), feita dando mais peso ao que muda no vídeo
//  - cada frame grava só o retângulo que mudou em relação ao anterior (o resto fica transparente) => arquivo bem menor
(function (root) {
'use strict';
const NB = 1 << 18;                                               // 6 bits por cor => 262144 "caixinhas" de cor
const binOf = (r, g, b) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
const comp = [k => (k >> 12) & 63, k => (k >> 6) & 63, k => k & 63];

// espera um evento do <video> (ou dá erro por tempo/erro de leitura)
function once(el, ev, ms, why) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { done(); rej(new Error(why)); }, ms);
    const ok = () => { done(); res(); }, bad = () => { done(); rej(new Error('VIDEO_ERRO')); };
    function done() { clearTimeout(t); el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }
    el.addEventListener(ev, ok); el.addEventListener('error', bad);
  });
}
async function seek(v, t) {
  if (Math.abs(v.currentTime - t) < 0.0005) return;
  const p = once(v, 'seeked', 10000, 'SEEK_TEMPO'); v.currentTime = t; await p;
}
async function openVideo(file) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const url = URL.createObjectURL(file);
  const meta = once(v, 'loadeddata', 20000, 'META_TEMPO');
  v.src = url;
  try { await meta; } catch (e) { URL.revokeObjectURL(url); throw e; }
  if (!v.videoWidth || !v.videoHeight) { URL.revokeObjectURL(url); throw new Error('SEM_VIDEO'); }
  if (!isFinite(v.duration)) {                                   // alguns WebM de gravadores de tela não trazem a duração
    try { const p = once(v, 'timeupdate', 10000, 'META_TEMPO'); v.currentTime = 1e101; await p; await seek(v, 0); } catch (e) { /* tratado abaixo */ }
  }
  if (!isFinite(v.duration) || v.duration <= 0) { URL.revokeObjectURL(url); throw new Error('SEM_VIDEO'); }
  return { v, url };
}

// paleta por "median cut", com as cores de verdade (médias) e dando mais peso a quem mais aparece
function makePalette(cnt, sr, sg, sb, maxColors) {
  const keys = []; for (let k = 0; k < NB; k++) if (cnt[k] > 0) keys.push(k);
  if (!keys.length) return Uint8Array.from([0, 0, 0]);
  const mk = ks => {
    const mn = [63, 63, 63], mx = [0, 0, 0]; let tot = 0;
    for (const k of ks) { for (let c = 0; c < 3; c++) { const v = comp[c](k); if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; } tot += cnt[k]; }
    let ch = 0, best = -1; for (let c = 0; c < 3; c++) { const r = mx[c] - mn[c]; if (r > best) { best = r; ch = c; } }
    return { ks, ch, tot, score: ks.length < 2 ? -1 : (best + 1) * Math.sqrt(tot) };
  };
  const boxes = [mk(keys)];
  while (boxes.length < maxColors) {
    let bi = -1, bs = 0;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].score > bs) { bs = boxes[i].score; bi = i; }
    if (bi < 0) break;
    const b = boxes[bi], f = comp[b.ch], ks = b.ks.slice().sort((x, y) => f(x) - f(y));
    let acc = 0, cut = 1;
    for (let i = 0; i < ks.length - 1; i++) { acc += cnt[ks[i]]; cut = i + 1; if (acc * 2 >= b.tot) break; }
    boxes.splice(bi, 1, mk(ks.slice(0, cut)), mk(ks.slice(cut)));
  }
  const pal = new Uint8Array(boxes.length * 3);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, t = 0;
    for (const k of b.ks) { r += sr[k]; g += sg[k]; bl += sb[k]; t += cnt[k]; }
    pal[i * 3] = Math.round(r / t); pal[i * 3 + 1] = Math.round(g / t); pal[i * 3 + 2] = Math.round(bl / t);
  });
  return pal;
}

async function convert(file, opts) {
  const o = Object.assign({ maxW: 1280, fps: 15, tol: 12 }, opts || {});
  const prog = o.onProgress || (() => {}), cancelled = o.cancelled || (() => false);
  const { v, url } = await openVideo(file);
  try {
    const dur = v.duration, vw = v.videoWidth, vh = v.videoHeight;
    const W = Math.min(vw, o.maxW), H = Math.max(1, Math.round(vh * W / vw));    // nunca aumenta a imagem
    const N = Math.max(1, Math.floor(dur * o.fps + 1e-6));                        // quantos frames serão lidos
    if (o.confirmFrames && N > 1500 && !(await o.confirmFrames(N, dur))) throw new Error('CANCELADO');
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    const grab = async i => {
      await seek(v, Math.min(i / o.fps, Math.max(0, dur - 0.01)));
      cx.drawImage(v, 0, 0, W, H);
      return cx.getImageData(0, 0, W, H).data;
    };

    // ---- 1) paleta única: amostra ~24 frames e conta cores (frames seguintes contam só o que mudou) ----
    const K = Math.min(N, 24), cnt = new Float64Array(NB), sr = new Float64Array(NB), sg = new Float64Array(NB), sb = new Float64Array(NB);
    let prevS = null;
    for (let k = 0; k < K; k++) {
      if (cancelled()) throw new Error('CANCELADO');
      prog({ phase: 'cores', i: k + 1, n: K });
      const d = await grab(K === 1 ? 0 : Math.round(k * (N - 1) / (K - 1)));
      for (let p = 0, n = W * H; p < n; p++) {
        const q = p * 4, r = d[q], g = d[q + 1], b = d[q + 2];
        if (prevS && Math.abs(r - prevS[q]) + Math.abs(g - prevS[q + 1]) + Math.abs(b - prevS[q + 2]) <= 12) continue;
        const bin = binOf(r, g, b); cnt[bin]++; sr[bin] += r; sg[bin] += g; sb[bin] += b;
      }
      prevS = d;
    }
    prevS = null;
    const pal = makePalette(cnt, sr, sg, sb, 255), nCol = pal.length / 3, T = nCol;   // T = cor transparente
    let bits = 1; while ((1 << bits) < nCol + 1) bits++;
    const minCode = Math.max(2, bits);
    const gct = new Uint8Array((1 << bits) * 3); gct.set(pal);
    const pr = new Uint8Array(256), pg = new Uint8Array(256), pb = new Uint8Array(256);
    for (let i = 0; i < nCol; i++) { pr[i] = pal[i * 3]; pg[i] = pal[i * 3 + 1]; pb[i] = pal[i * 3 + 2]; }
    const map = new Int16Array(NB).fill(-1);
    const nearest = (r, g, b) => {
      let best = 1e9, bi = 0;
      for (let i = 0; i < nCol; i++) {
        const dr = r - pr[i], dg = g - pg[i], db = b - pb[i], dd = dr * dr * 2 + dg * dg * 4 + db * db * 3;
        if (dd < best) { best = dd; bi = i; if (!dd) break; }
      }
      return bi;
    };

    // ---- 2) converte: cada frame grava só o retângulo que mudou ----
    const u16 = x => [x & 255, (x >> 8) & 255], parts = [];
    parts.push(Uint8Array.from([71, 73, 70, 56, 57, 97, ...u16(W), ...u16(H), 0x80 | 0x70 | (bits - 1), 0, 0]));
    parts.push(gct);
    parts.push(Uint8Array.from([0x21, 0xFF, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0]));   // repete sempre
    const prev = new Uint8Array(W * H), cur = new Uint8Array(W * H), chg = new Uint8Array(W * H);
    let pend = null, written = 0, have = false;
    const flush = () => {
      if (!pend) return;
      const dl = Math.min(65535, Math.max(1, pend.delay));
      parts.push(Uint8Array.from([0x21, 0xF9, 4, 0x05, ...u16(dl), T, 0]));          // sem apagar o anterior + cor transparente
      parts.push(Uint8Array.from([0x2C, ...u16(pend.x), ...u16(pend.y), ...u16(pend.w), ...u16(pend.h), 0]));
      parts.push(root.GifCore.lzwEncode(pend.idx, minCode));
      written++; pend = null;
    };
    const t0 = performance.now(), tol = o.tol;
    for (let i = 0; i < N; i++) {
      if (cancelled()) throw new Error('CANCELADO');
      const el = (performance.now() - t0) / 1000;
      prog({ phase: 'frames', i: i + 1, n: N, eta: i >= 3 ? el / i * (N - i) : null });
      const d = await grab(i);
      const dcs = Math.round((i + 1) * 100 / o.fps) - Math.round(i * 100 / o.fps);      // duração em centésimos de segundo
      chg.fill(0);
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x, q = p * 4, r = d[q], g = d[q + 1], b = d[q + 2];
        if (have) { const pi = prev[p]; if (Math.abs(r - pr[pi]) + Math.abs(g - pg[pi]) + Math.abs(b - pb[pi]) <= tol) continue; }
        const bin = binOf(r, g, b); let m = map[bin]; if (m < 0) m = map[bin] = nearest(r, g, b);
        if (have && m === prev[p]) continue;
        cur[p] = m; chg[p] = 1;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) { if (pend) pend.delay += dcs; continue; }                            // nada mudou: só estica o frame anterior
      flush();
      const w = x1 - x0 + 1, h = y1 - y0 + 1, idx = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = (y0 + y) * W + x0 + x;
        if (chg[p]) { idx[y * w + x] = cur[p]; prev[p] = cur[p]; } else idx[y * w + x] = T;
      }
      pend = { x: x0, y: y0, w, h, idx, delay: dcs }; have = true;
    }
    flush();
    parts.push(Uint8Array.from([0x3B]));
    let total = 0; for (const p of parts) total += p.length;
    const bytes = new Uint8Array(total); let off = 0; for (const p of parts) { bytes.set(p, off); off += p.length; }
    return { bytes, w: W, h: H, n: written, read: N, seconds: dur, colors: nCol, srcW: vw, srcH: vh };
  } finally {
    URL.revokeObjectURL(url); v.removeAttribute('src'); v.load();
  }
}

root.VideoGif = { convert };
})(typeof window !== 'undefined' ? window : globalThis);

