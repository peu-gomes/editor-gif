(function (root) {
'use strict';

// ---------- Parse ----------
function parseGIF(buf) {
  const sig = String.fromCharCode.apply(null, buf.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Não é um GIF válido');
  const W = buf[6] | (buf[7] << 8), H = buf[8] | (buf[9] << 8), flags = buf[10], bg = buf[11], aspect = buf[12];
  let p = 13, gct = null;
  if (flags & 0x80) { const n = 3 << ((flags & 7) + 1); gct = buf.subarray(p, p + n); p += n; }
  const frames = [], appExts = [];
  let gce = null;
  while (p < buf.length) {
    const b = buf[p];
    if (b === 0x3B) break;
    if (b === 0x21) {
      const label = buf[p + 1], start = p; p += 2;
      if (label === 0xF9) {
        gce = { disposal: (buf[p + 1] >> 2) & 7, transp: (buf[p + 1] & 1) ? buf[p + 4] : -1, delay: buf[p + 2] | (buf[p + 3] << 8) };
      }
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
      p++;
      if (label === 0xFF && frames.length === 0) appExts.push(buf.subarray(start, p));
    } else if (b === 0x2C) {
      const imgStart = p;
      const x = buf[p + 1] | (buf[p + 2] << 8), y = buf[p + 3] | (buf[p + 4] << 8);
      const w = buf[p + 5] | (buf[p + 6] << 8), h = buf[p + 7] | (buf[p + 8] << 8), pk = buf[p + 9];
      p += 10;
      let lct = null;
      if (pk & 0x80) { const n = 3 << ((pk & 7) + 1); lct = buf.subarray(p, p + n); p += n; }
      const minCode = buf[p++];
      const dataStart = p;
      while (p < buf.length && buf[p] !== 0) p += buf[p] + 1;
      p++;
      frames.push({
        x, y, w, h, interlaced: !!(pk & 0x40), lct, minCode, dataStart, imgStart, imgEnd: Math.min(p, buf.length),
        delay: gce ? gce.delay : 0, disposal: gce ? gce.disposal : 0, transp: gce ? gce.transp : -1
      });
      gce = null;
    } else p++;
  }
  if (!frames.length) throw new Error('GIF sem frames');
  return { W, H, gct, bg, flags, aspect, frames, appExts, buf };
}

// ---------- LZW decode ----------
function lzwDecode(minCode, data, npix) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097);
  const out = new Uint8Array(npix);
  let op = 0, bits = 0, acc = 0, old = -1, first = 0;
  for (let i = 0; i < data.length && op < npix; i++) {
    acc |= data[i] << bits; bits += 8;
    while (bits >= size) {
      let code = acc & mask; acc >>= size; bits -= size;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) return out;
      if (old === -1) { out[op++] = code; old = code; first = code; continue; }
      const inCode = code; let sp = 0;
      if (code >= next) { stack[sp++] = first; code = old; }
      while (code >= clear) { stack[sp++] = suffix[code]; code = prefix[code]; }
      first = code; stack[sp++] = code;
      while (sp > 0 && op < npix) out[op++] = stack[--sp];
      if (next < 4096) {
        prefix[next] = old; suffix[next] = first; next++;
        if (next === (1 << size) && size < 12) { size++; mask = (1 << size) - 1; }
      }
      old = inCode;
    }
  }
  return out;
}

function frameIndices(g, f) {
  const buf = g.buf; let p = f.dataStart, total = 0; const chunks = [];
  while (p < buf.length && buf[p] !== 0) { const n = buf[p]; chunks.push(buf.subarray(p + 1, p + 1 + n)); total += n; p += n + 1; }
  const data = new Uint8Array(total); let o = 0;
  for (const c of chunks) { data.set(c, o); o += c.length; }
  let idx = lzwDecode(f.minCode, data, f.w * f.h);
  if (f.interlaced) {
    const out = new Uint8Array(idx.length); let r = 0;
    const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
    for (const [s, st] of passes) for (let y = s; y < f.h; y += st, r++) out.set(idx.subarray(r * f.w, (r + 1) * f.w), y * f.w);
    idx = out;
  }
  return idx;
}

// Retorna um array de RGBA completos (frame já composto) por frame.
function composeFrames(g, onProgress) {
  const { W, H } = g;
  let canvas = new Uint8ClampedArray(W * H * 4), backup = null;
  const snaps = [];
  g.frames.forEach((f, n) => {
    if (f.disposal === 3) backup = canvas.slice();
    const idx = frameIndices(g, f), pal = f.lct || g.gct;
    if (pal) {
      for (let yy = 0; yy < f.h; yy++) {
        const cy = f.y + yy; if (cy >= H) break;
        for (let xx = 0; xx < f.w; xx++) {
          const cx = f.x + xx; if (cx >= W) break;
          const v = idx[yy * f.w + xx];
          if (v === f.transp || v * 3 + 2 >= pal.length) continue;
          const o = (cy * W + cx) * 4;
          canvas[o] = pal[v * 3]; canvas[o + 1] = pal[v * 3 + 1]; canvas[o + 2] = pal[v * 3 + 2]; canvas[o + 3] = 255;
        }
      }
    }
    snaps.push(canvas.slice());
    if (f.disposal === 2) {
      for (let yy = f.y; yy < Math.min(H, f.y + f.h); yy++)
        canvas.fill(0, (yy * W + f.x) * 4, (yy * W + Math.min(W, f.x + f.w)) * 4);
    } else if (f.disposal === 3 && backup) canvas = backup;
    if (onProgress) onProgress(n + 1, g.frames.length);
  });
  return snaps;
}

// Remonta os frames compostos SOB DEMANDA, sem guardar todos na memória.
// Guarda só alguns "pontos de retomada" (estado do quadro antes de desenhar o frame k) e uma pequena lista de frames recentes.
// Assim a memória fica quase fixa, mesmo com milhares de frames.
function makeComposer(g, budgetBytes) {
  const { W, H } = g, N = g.frames.length, fb = W * H * 4;
  const every = Math.max(8, Math.ceil(N * fb / (budgetBytes || 4e8)));   // distância entre pontos de retomada
  const cps = new Map([[0, new Uint8ClampedArray(fb)]]);
  let canvas = new Uint8ClampedArray(fb), next = 0;   // canvas = estado antes de desenhar o frame "next"
  const lru = [];
  function step(want, cb) {
    const f = g.frames[next]; let backup = null, out = null;
    if (f.disposal === 3) backup = canvas.slice();
    drawRaw(canvas, g, f);
    if (cb) cb(canvas);
    if (want) out = canvas.slice();
    if (f.disposal === 2) {
      for (let yy = f.y; yy < Math.min(H, f.y + f.h); yy++)
        canvas.fill(0, (yy * W + f.x) * 4, (yy * W + Math.min(W, f.x + f.w)) * 4);
    } else if (f.disposal === 3 && backup) canvas = backup;
    next++;
    if (next % every === 0 && next < N && !cps.has(next)) cps.set(next, canvas.slice());
    return out;
  }
  // RGBA composto do frame n (não altere o array devolvido)
  function at(n) {
    const hit = lru.findIndex(e => e[0] === n);
    if (hit >= 0) { const e = lru.splice(hit, 1)[0]; lru.push(e); return e[1]; }
    let c = 0; for (const k of cps.keys()) if (k <= n && k > c) c = k;
    if (n < next || c > next) { canvas = cps.get(c).slice(); next = c; }
    while (next < n) step(false);
    const out = step(true);
    lru.push([n, out]); if (lru.length > 6) lru.shift();
    return out;
  }
  // passa por todos os frames em ordem (usado ao abrir): cb(n, rgba) vale só durante a chamada; tick() pode ser assíncrono
  async function scan(cb, tick) {
    canvas = new Uint8ClampedArray(fb); next = 0; lru.length = 0;
    for (let n = 0; n < N; n++) {
      step(false, c => cb(n, c));
      if (tick && n % 6 === 5) await tick(n + 1, N);
    }
  }
  return { at, scan, every, frameBytes: fb };
}

// ---------- Blur ----------
function pass(src, dst, w, h, r, horiz) {
  const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 4 : w * 4, lineStep = horiz ? w * 4 : 4, div = 2 * r + 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(n - 1, Math.max(0, k)) * step + c];
      for (let i = 0; i < n; i++) {
        dst[base + i * step + c] = sum / div;
        sum += src[base + Math.min(n - 1, i + r + 1) * step + c] - src[base + Math.max(0, i - r) * step + c];
      }
    }
  }
}

// retângulo efetivo (inteiro, dentro da imagem) usado pelo borrão
function blurBox(b, W, H) {
  const x0 = Math.max(0, Math.round(b.x)), y0 = Math.max(0, Math.round(b.y));
  const x1 = Math.min(W, Math.round(b.x + b.w)), y1 = Math.min(H, Math.round(b.y + b.h));
  return { x0, y0, x1, y1 };
}

function blurRegion(rgba, W, H, rx, ry, rw, rh, r) {
  const { x0, y0, x1, y1 } = blurBox({ x: rx, y: ry, w: rw, h: rh }, W, H);
  const w = x1 - x0, h = y1 - y0;
  if (w < 1 || h < 1 || r < 1) return;
  const a = new Uint8ClampedArray(w * h * 4), b = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) a.set(rgba.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1) * 4), y * w * 4);
  for (let it = 0; it < 2; it++) { pass(a, b, w, h, r, true); pass(b, a, w, h, r, false); }
  for (let y = 0; y < h; y++) rgba.set(a.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * W + x0) * 4);
}

function applyBlurs(snap, W, H, blurs) {
  const out = snap.slice();
  for (const b of blurs) blurRegion(out, W, H, b.x, b.y, b.w, b.h, b.r);
  return out;
}

// ---------- Quantização (median cut em 15 bits) ----------
function quantizeCore(rgba, maxColors) {
  const n = rgba.length >> 2, hist = new Uint32Array(32768);
  let transp = false;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) { transp = true; continue; }
    hist[((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)]++;
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) keys.push(k);
  if (!keys.length || maxColors < 1) return { pal: new Uint8Array(0), count: 0, idx: new Int16Array(n).fill(-1), transp };
  const comp = (k, ch) => (k >> (10 - 5 * ch)) & 31;
  let boxes = [keys];
  while (boxes.length < maxColors) {
    let bi = -1, best = 0, bch = 0;
    boxes.forEach((bx, i) => {
      if (bx.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 31, mx = 0;
        for (const k of bx) { const v = comp(k, ch); if (v < mn) mn = v; if (v > mx) mx = v; }
        if (mx - mn >= best && mx - mn > 0) { best = mx - mn; bi = i; bch = ch; }
      }
    });
    if (bi < 0) break;
    const bx = boxes[bi].slice().sort((a, b) => comp(a, bch) - comp(b, bch));
    let tot = 0; for (const k of bx) tot += hist[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < bx.length - 1; i++) { acc += hist[bx[i]]; cut = i + 1; if (acc * 2 >= tot) break; }
    boxes.splice(bi, 1, bx.slice(0, cut), bx.slice(cut));
  }
  const pal = new Uint8Array(boxes.length * 3), lut = new Uint8Array(32768);
  boxes.forEach((bx, i) => {
    let r = 0, g = 0, b = 0, t = 0;
    for (const k of bx) { const c = hist[k]; r += comp(k, 0) * c; g += comp(k, 1) * c; b += comp(k, 2) * c; t += c; lut[k] = i; }
    const e = v => { v = Math.round(v / t); return (v << 3) | (v >> 2); };
    pal[i * 3] = e(r); pal[i * 3 + 1] = e(g); pal[i * 3 + 2] = e(b);
  });
  const idx = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    idx[i] = rgba[o + 3] < 128 ? -1 : lut[((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)];
  }
  return { pal, count: boxes.length, idx, transp };
}

function quantize(rgba) {
  let q = exactPalette(rgba, 256);
  if (q) {
    let tr = false;
    for (let i = 0; i < q.idx.length; i++) if (q.idx[i] < 0) { tr = true; break; }
    if (tr && q.count > 255) q = null; else q.transp = tr;
  }
  if (!q) {
    q = quantizeCore(rgba, 256);
    if (q.transp && q.count > 255) q = quantizeCore(rgba, 255);
  }
  let count = q.count, tIdx = -1;
  if (q.transp) tIdx = count++;
  if (count < 1) count = 1;
  let bits = 1; while ((1 << bits) < count) bits++;
  const pal = new Uint8Array((1 << bits) * 3); pal.set(q.pal);
  const idx = new Uint8Array(q.idx.length);
  for (let i = 0; i < idx.length; i++) idx[i] = q.idx[i] < 0 ? tIdx : q.idx[i];
  return { pal, idx, bits, tIdx };
}

// ---------- LZW encode ----------
function lzwEncode(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, next = eoi + 1, dict = new Map();
  const out = []; let acc = 0, bits = 0;
  const put = code => { acc |= code << bits; bits += size; while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; } };
  put(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    put(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > (1 << size) && size < 12) size++; }
    else { put(clear); dict = new Map(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  put(prefix);
  if (next === (1 << size) && size < 12) size++;
  put(eoi);
  if (bits > 0) out.push(acc & 255);
  const res = [minCode];
  for (let i = 0; i < out.length; i += 255) {
    const n = Math.min(255, out.length - i);
    res.push(n);
    for (let j = 0; j < n; j++) res.push(out[i + j]);
  }
  res.push(0);
  return Uint8Array.from(res);
}

// Desenha os pixels de um frame original sobre um canvas RGBA (como o leitor de GIF faz).
function drawRaw(canvas, g, f) {
  const { W, H } = g, idx = frameIndices(g, f), pal = f.lct || g.gct;
  if (!pal) return;
  for (let yy = 0; yy < f.h; yy++) {
    const cy = f.y + yy; if (cy >= H) break;
    for (let xx = 0; xx < f.w; xx++) {
      const cx = f.x + xx; if (cx >= W) break;
      const v = idx[yy * f.w + xx];
      if (v === f.transp || v * 3 + 2 >= pal.length) continue;
      const o = (cy * W + cx) * 4;
      canvas[o] = pal[v * 3]; canvas[o + 1] = pal[v * 3 + 1]; canvas[o + 2] = pal[v * 3 + 2]; canvas[o + 3] = 255;
    }
  }
}

// Diferença entre o que o leitor mostra (sim) e o que deveria mostrar (target).
// types: 0 = não mexe (transparente), 1 = pixel da área borrada, 2 = outro pixel que precisa ser corrigido.
function diffFrame(target, sim, ref, W, H, ownBoxes, tolBlur) {
  const own = new Uint8Array(W * H);
  for (const b of ownBoxes) for (let y = b.y0; y < b.y1; y++) own.fill(1, y * W + b.x0, y * W + b.x1);
  const types = new Uint8Array(W * H);
  let mnx = W, mny = H, mxx = -1, mxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, o = p * 4;
    if (target[o + 3] < 128) continue;                   // não dá para "pintar transparente"
    let t = 0;
    if (sim[o + 3] < 128) t = own[p] ? 1 : 2;
    else if (own[p]) {   // área borrada: compara com o valor exato pedido antes (não com a cor arredondada)
      if (Math.abs(target[o] - ref[o]) + Math.abs(target[o + 1] - ref[o + 1]) + Math.abs(target[o + 2] - ref[o + 2]) > tolBlur) t = 1;
    } else if (target[o] !== sim[o] || target[o + 1] !== sim[o + 1] || target[o + 2] !== sim[o + 2]) t = 2;
    if (t) { types[p] = t; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; }
  }
  if (mxx < 0) { mnx = 0; mny = 0; mxx = 0; mxy = 0; }   // nada a pintar: frame de 1 pixel transparente
  const w = mxx - mnx + 1, h = mxy - mny + 1;
  const rgba = new Uint8ClampedArray(w * h * 4), ct = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (mny + y) * W + mnx + x, t = types[p];
    ct[y * w + x] = t;
    if (t) { const s = p * 4, d = (y * w + x) * 4; rgba[d] = target[s]; rgba[d + 1] = target[s + 1]; rgba[d + 2] = target[s + 2]; rgba[d + 3] = 255; }
  }
  return { rgba, types: ct, x: mnx, y: mny, w, h };
}

// Paleta em duas partes: parte "borrada" (K cores novas) + o resto do frame.
// O resto mantém as cores ORIGINAIS exatas quando cabem; só é reduzido se não couber.
function exactPalette(rgba, maxColors) {
  const map = new Map(), n = rgba.length >> 2, list = [];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    if (!map.has(key)) { if (map.size >= maxColors) return null; map.set(key, map.size); list.push(rgba[o], rgba[o + 1], rgba[o + 2]); }
  }
  const idx = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    idx[i] = rgba[o + 3] < 128 ? -1 : map.get((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
  }
  return { pal: Uint8Array.from(list), count: map.size, idx };
}

// Paleta com as cores exatas mais frequentes; as raras vão para a mais próxima.
function topPalette(rgba, maxColors) {
  const n = rgba.length >> 2, freq = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  // as mais frequentes ficam exatas; uma parte da paleta cobre as cores raras (median cut)
  const tail = Math.min(32, Math.floor(maxColors / 4));
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, maxColors - tail).map(e => e[0]);
  const rare = sorted.slice(maxColors - tail);
  const rr = new Uint8ClampedArray(rare.length * 4);
  rare.forEach(([k], i) => { rr[i * 4] = k >> 16; rr[i * 4 + 1] = (k >> 8) & 255; rr[i * 4 + 2] = k & 255; rr[i * 4 + 3] = 255; });
  const qt = quantizeCore(rr, tail);
  const count = top.length + qt.count;
  const pal = new Uint8Array(count * 3), map = new Map();
  top.forEach((k, i) => { pal[i * 3] = k >> 16; pal[i * 3 + 1] = (k >> 8) & 255; pal[i * 3 + 2] = k & 255; map.set(k, i); });
  pal.set(qt.pal, top.length * 3);
  const idx = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (rgba[o + 3] < 128) { idx[i] = -1; continue; }
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    let v = map.get(key);
    if (v === undefined) {
      let best = 1e9; v = 0;
      for (let j = 0; j < count; j++) {
        const dr = rgba[o] - pal[j * 3], dg = rgba[o + 1] - pal[j * 3 + 1], db = rgba[o + 2] - pal[j * 3 + 2];
        const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
        if (d < best) { best = d; v = j; }
      }
      map.set(key, v);
    }
    idx[i] = v;
  }
  return { pal, count, idx };
}

function encodeDelta(d, K) {
  const n = d.w * d.h, A = new Uint8ClampedArray(n * 4), B = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const t = d.types[i], o = i * 4;
    if (t === 1) { A[o] = d.rgba[o]; A[o + 1] = d.rgba[o + 1]; A[o + 2] = d.rgba[o + 2]; A[o + 3] = d.rgba[o + 3]; }
    else if (t === 2) { B[o] = d.rgba[o]; B[o + 1] = d.rgba[o + 1]; B[o + 2] = d.rgba[o + 2]; B[o + 3] = d.rgba[o + 3]; }
  }
  let hasA = false;
  for (let i = 0; i < n; i++) if (d.types[i] === 1) { hasA = true; break; }
  const MINK = hasA ? 48 : 0;   // sem borrão no frame: a paleta inteira fica para as cores originais
  let qb = exactPalette(B, 255 - MINK);          // cores originais exatas
  let ka;
  if (qb) ka = Math.min(K, 255 - qb.count);      // sobra de paleta vai para o borrão
  else { qb = topPalette(B, 255 - MINK); ka = Math.min(K, MINK); }   // cores mais usadas, exatas
  const qa = quantizeCore(A, ka);
  const count = qa.count + qb.count, tIdx = count;
  let bits = 1; while ((1 << bits) < count + 1) bits++;
  const pal = new Uint8Array((1 << bits) * 3); pal.set(qa.pal, 0); pal.set(qb.pal, qa.count * 3);
  const idx = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = d.types[i];
    const v = t === 1 ? qa.idx[i] : t === 2 ? (qb.idx[i] < 0 ? -1 : qb.idx[i] + qa.count) : -1;
    idx[i] = v < 0 ? tIdx : v;
  }
  return { pal, idx, bits, tIdx, exact: ka };
}

// ---------- Montagem do GIF ----------
// Simula o que o leitor de GIF mostra (sim). Cada frame é copiado intacto do original quando
// isso já produz a imagem certa; senão, grava só os pixels que ficariam diferentes.
// kept: [{ i: índiceOriginal, blurs: [{x,y,w,h,r}] }]; o RGBA composto vem de opts.getSnap(i) (ou de f.snap)
// opts.tick(j, total) é aguardado de tempos em tempos (para mostrar progresso sem travar a tela)
async function buildGIF(g, kept, opts) {
  opts = opts || {};
  const { W, H } = g, parts = [];
  const u16 = v => [v & 255, (v >> 8) & 255];
  const hdr = ['G', 'I', 'F', '8', '9', 'a'].map(c => c.charCodeAt(0));
  hdr.push(...u16(W), ...u16(H), g.gct ? (0x80 | (g.flags & 0x77)) : (g.flags & 0x70), g.bg, g.aspect || 0);
  parts.push(Uint8Array.from(hdr));
  if (g.gct) parts.push(g.gct);
  for (const e of g.appExts) parts.push(e);

  const K = opts.blurColors || 255, tolBlur = opts.blurTol === undefined ? 0 : opts.blurTol;
  const RAW_TOL = 30;   // diferença máxima (soma RGB) aceita para copiar o frame intacto
  let sim = new Uint8ClampedArray(W * H * 4), rawN = 0, reN = 0;
  const ref = new Uint8ClampedArray(W * H * 4);   // valor exato que cada pixel deveria ter

  for (let j = 0; j < kept.length; j++) {
    const f = kept[j];
    if (opts.tick && j % 3 === 2) await opts.tick(j, kept.length);
    const info = g.frames[f.i];
    let delay = info.delay;
    if (opts.mergeDelay) {
      const end = j + 1 < kept.length ? kept[j + 1].i : g.frames.length;
      for (let k = f.i + 1; k < end; k++) delay += g.frames[k].delay;
    }
    delay = Math.min(65535, delay);
    const snap = f.snap || opts.getSnap(f.i);
    const target = f.blurs.length ? applyBlurs(snap, W, H, f.blurs) : snap;

    // 1) tenta copiar o frame original intacto
    if (!f.blurs.length) {
      const trial = sim.slice();
      drawRaw(trial, g, info);
      let ok = true;
      for (let o = 0; o < trial.length; o += 4) {
        if (target[o + 3] < 128 && trial[o + 3] < 128) continue;
        if ((target[o + 3] < 128) !== (trial[o + 3] < 128) ||
            Math.abs(trial[o] - target[o]) + Math.abs(trial[o + 1] - target[o + 1]) + Math.abs(trial[o + 2] - target[o + 2]) > RAW_TOL) { ok = false; break; }
      }
      if (ok) {
        parts.push(Uint8Array.from([0x21, 0xF9, 4, (info.disposal << 2) | (info.transp >= 0 ? 1 : 0), ...u16(delay), info.transp >= 0 ? info.transp : 0, 0]));
        parts.push(g.buf.subarray(info.imgStart, info.imgEnd));
        if (info.disposal === 2) {
          for (let yy = info.y; yy < Math.min(H, info.y + info.h); yy++)
            trial.fill(0, (yy * W + info.x) * 4, (yy * W + Math.min(W, info.x + info.w)) * 4);
          sim = trial;
        } else if (info.disposal !== 3) sim = trial;   // disposal 3: volta ao estado anterior (sim fica como estava)
        ref.set(sim);
        rawN++;
        continue;
      }
    }

    // 2) grava só os pixels que diferem do que o leitor está mostrando
    const own = f.blurs.map(b => blurBox(b, W, H)).filter(b => b.x1 > b.x0 && b.y1 > b.y0);
    const d = diffFrame(target, sim, ref, W, H, own, tolBlur);
    const q = encodeDelta(d, K), minCode = Math.max(2, q.bits);
    parts.push(Uint8Array.from([0x21, 0xF9, 4, (1 << 2) | (q.tIdx >= 0 ? 1 : 0), ...u16(delay), q.tIdx >= 0 ? q.tIdx : 0, 0]));
    parts.push(Uint8Array.from([0x2C, ...u16(d.x), ...u16(d.y), ...u16(d.w), ...u16(d.h), 0x80 | (q.bits - 1)]));
    parts.push(q.pal);
    parts.push(lzwEncode(q.idx, minCode));
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {   // atualiza a simulação com as cores gravadas
      const i = y * d.w + x; if (!d.types[i]) continue;
      const v = q.idx[i], o = ((d.y + y) * W + d.x + x) * 4;
      sim[o] = q.pal[v * 3]; sim[o + 1] = q.pal[v * 3 + 1]; sim[o + 2] = q.pal[v * 3 + 2]; sim[o + 3] = 255;
      const s = ((d.y + y) * W + d.x + x) * 4; ref[o] = target[s]; ref[o + 1] = target[s + 1]; ref[o + 2] = target[s + 2]; ref[o + 3] = 255;
    }
    reN++;
  }
  parts.push(Uint8Array.from([0x3B]));
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, raw: rawN, re: reN };
}

const api = { parseGIF, composeFrames, makeComposer, blurRegion, applyBlurs, quantize, lzwEncode, lzwDecode, frameIndices, buildGIF };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GifCore = api;
})(typeof window !== 'undefined' ? window : globalThis);

