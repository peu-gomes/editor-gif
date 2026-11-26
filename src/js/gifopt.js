// ---------- otimizador de GIF ----------
// Refaz a compressão do GIF inteiro a partir das imagens compostas (o que o leitor mostra em cada frame).
//  - tol 0 = SEM PERDA: cada frame sai idêntico, pixel a pixel (e o resultado é conferido; se algo diferir, fica o original)
//  - tol > 0 = com perda controlada: pixels que mudaram até "tol" (soma |dR|+|dG|+|dB|) contam como "não mudou"
// Técnicas: grava só o retângulo que mudou; frames sem mudança viram duração do anterior; uma paleta exata para o GIF
// inteiro quando cabe (senão, paleta exata por frame); para cada frame testa 3 jeitos de preencher o que não mudou
// (transparente, a cor que já está na tela, ou repetir o vizinho) e fica com o menor; paleta local menor quando
// o frame usa poucas cores (códigos LZW mais curtos).
(function (root) {
'use strict';

// LZW com dicionário em tabela (mais rápido que Map). Limpa o dicionário quando enche.
const TAB = new Int16Array(1 << 20).fill(-1);
function lzw(idx, minCode) {
  const clear = 1 << minCode, eoi = clear + 1; let size = minCode + 1, next = eoi + 1;
  const used = [], out = new Uint8Array(idx.length * 2 + 64); let op = 0, acc = 0, bits = 0;
  const put = c => { acc |= c << bits; bits += size; while (bits >= 8) { out[op++] = acc & 255; acc >>>= 8; bits -= 8; } };
  const reset = () => { for (let i = 0; i < used.length; i++) TAB[used[i]] = -1; used.length = 0; };
  put(clear); let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, v = TAB[key];
    if (v >= 0) { prefix = v; continue; }
    put(prefix);
    if (next < 4096) { TAB[key] = next++; used.push(key); if (next > (1 << size) && size < 12) size++; }
    else { put(clear); reset(); size = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  put(prefix); if (next === (1 << size) && size < 12) size++; put(eoi); if (bits > 0) out[op++] = acc & 255;
  reset();
  const res = new Uint8Array(1 + op + Math.ceil(op / 255) + 1); let r = 0; res[r++] = minCode;
  for (let i = 0; i < op; i += 255) { const n = Math.min(255, op - i); res[r++] = n; res.set(out.subarray(i, i + n), r); r += n; }
  res[r++] = 0; return res.subarray(0, r);
}

// histograma de cores em caixinhas de 6 bits por cor (base da paleta por median cut); clear() limpa só o que foi usado
const NB = 1 << 18, binOf = (r, g, b) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
const cmp3 = [k => (k >> 12) & 63, k => (k >> 6) & 63, k => k & 63];
function hist() {
  const cnt = new Float64Array(NB), sr = new Float64Array(NB), sg = new Float64Array(NB), sb = new Float64Array(NB), keys = [];
  return {
    cnt, sr, sg, sb, keys,
    add(r, g, b) { const k = binOf(r, g, b); if (!cnt[k]) keys.push(k); cnt[k]++; sr[k] += r; sg[k] += g; sb[k] += b; },
    clear() { for (const k of keys) cnt[k] = sr[k] = sg[k] = sb[k] = 0; keys.length = 0; }
  };
}
// paleta por median cut, com as cores médias de verdade (lista [r,g,b,...]; vazia se o histograma estiver vazio)
function medianCut(h, maxC) {
  const { cnt, sr, sg, sb } = h, keys = h.keys.slice();
  if (!keys.length || maxC < 1) return [];
  const mk = ks => {
    const mn = [63, 63, 63], mx = [0, 0, 0]; let tot = 0;
    for (const k of ks) { for (let c = 0; c < 3; c++) { const v = cmp3[c](k); if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; } tot += cnt[k]; }
    let ch = 0, best = -1; for (let c = 0; c < 3; c++) { const r = mx[c] - mn[c]; if (r > best) { best = r; ch = c; } }
    return { ks, ch, tot, score: ks.length < 2 ? -1 : (best + 1) * Math.sqrt(tot) };
  };
  const boxes = [mk(keys)];
  while (boxes.length < maxC) {
    let bi = -1, bs = 0; for (let i = 0; i < boxes.length; i++) if (boxes[i].score > bs) { bs = boxes[i].score; bi = i; }
    if (bi < 0) break;
    const b = boxes[bi], f = cmp3[b.ch], ks = b.ks.slice().sort((x, y) => f(x) - f(y)); let acc = 0, cut = 1;
    for (let i = 0; i < ks.length - 1; i++) { acc += cnt[ks[i]]; cut = i + 1; if (acc * 2 >= b.tot) break; }
    boxes.splice(bi, 1, mk(ks.slice(0, cut)), mk(ks.slice(cut)));
  }
  const pal = [];
  for (const b of boxes) { let r = 0, g = 0, bl = 0, t = 0; for (const k of b.ks) { r += sr[k]; g += sg[k]; bl += sb[k]; t += cnt[k]; } pal.push(Math.round(r / t), Math.round(g / t), Math.round(bl / t)); }
  return pal;
}

// paleta: lista de cores + busca (exata; se não achar, a mais próxima)
function makePal(list) {
  const n = list.length / 3, map = new Map();
  for (let i = 0; i < n; i++) { const k = (list[i * 3] << 16) | (list[i * 3 + 1] << 8) | list[i * 3 + 2]; if (!map.has(k)) map.set(k, i); }
  const exactMap = new Map(map);
  const idx = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b; let v = map.get(key); if (v !== undefined) return v;
    let best = 1e9; v = 0;
    for (let j = 0; j < n; j++) { const dr = r - list[j * 3], dg = g - list[j * 3 + 1], db = b - list[j * 3 + 2], dd = dr * dr * 2 + dg * dg * 4 + db * db * 3; if (dd < best) { best = dd; v = j; if (!dd) break; } }
    map.set(key, v); return v;
  };
  return { list, n, idx, has: key => exactMap.get(key) };
}
const effDelay = d => d < 2 ? 10 : d;   // como os navegadores tocam atraso 0 ou 1

// src: { W, H, N, at(i) -> RGBA composto (Uint8ClampedArray W*H*4, ou Promise dele; lido em ordem), delay(i) -> centésimos, loop: extensão NETSCAPE (bytes) ou null }
// o: { tol, tick(fase, i, n) (pode ser async), cancelled() }
// devolve { bytes, exact (false se algum pixel não pôde sair idêntico), map (frame de entrada -> frame de saída) }
async function encode(src, o) {
  o = o || {};
  const { W, H, N } = src, P = W * H, tol = o.tol || 0, tick = o.tick || (() => {});
  let exact = true;
  const ref = new Uint8ClampedArray(P * 4); let have = false;   // última cor gravada de cada pixel (valor de entrada)
  const changed = (d, q) => !have || (d[q + 3] < 128) !== (ref[q + 3] < 128) ||
    (d[q + 3] >= 128 && Math.abs(d[q] - ref[q]) + Math.abs(d[q + 1] - ref[q + 1]) + Math.abs(d[q + 2] - ref[q + 2]) > tol);

  // ---- passo 1: cores dos pixels que mudam (para a paleta) ----
  const colors = new Map(); let overflow = false;
  const hAll = hist();
  for (let i = 0; i < N; i++) {
    if (o.cancelled && o.cancelled()) throw new Error('CANCELADO');
    const d = await src.at(i);
    for (let q = 0; q < P * 4; q += 4) {
      if (!changed(d, q)) continue;
      ref[q] = d[q]; ref[q + 1] = d[q + 1]; ref[q + 2] = d[q + 2]; ref[q + 3] = d[q + 3];
      if (d[q + 3] < 128) continue;
      if (!overflow) { const key = (d[q] << 16) | (d[q + 1] << 8) | d[q + 2]; if (!colors.has(key)) { colors.set(key, 1); if (colors.size > 255) overflow = true; } }
      hAll.add(d[q], d[q + 1], d[q + 2]);
    }
    have = true;
    if (i % 4 === 3) await tick(1, i + 1, N);
  }
  // sem perda e com mais de 255 cores no total: paleta exata por frame. Senão: uma paleta para o GIF inteiro.
  const local = overflow && tol === 0;
  let gpal = null;
  if (!local) {
    const list = []; if (!overflow) for (const k of colors.keys()) list.push(k >> 16, (k >> 8) & 255, k & 255); else list.push(...medianCut(hAll, 255));
    gpal = makePal(list);
  }
  colors.clear();
  const bitsFor = n => { let b = 1; while ((1 << b) < n) b++; return b; };
  const gBits = local ? 1 : bitsFor(gpal.n + 1), gT = local ? 0 : gpal.n;

  // ---- passo 2: grava ----
  const u16 = x => [x & 255, (x >> 8) & 255], parts = [];
  const gct = new Uint8Array((1 << gBits) * 3); if (gpal) gct.set(gpal.list);
  parts.push(Uint8Array.from([71, 73, 70, 56, 57, 97, ...u16(W), ...u16(H), 0x80 | ((gBits - 1) << 4) | (gBits - 1), 0, 0]), gct);
  parts.push(src.loop || Uint8Array.from([0x21, 0xFF, 11, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 3, 1, 0, 0, 0]));
  ref.fill(0); have = false;
  const disp = new Int32Array(P).fill(-1);   // cor (RGB) que o leitor mostra em cada pixel; -1 = transparente
  const mask = new Uint8Array(P), map = new Int32Array(N);
  let pend = null, written = 0;
  const flush = () => {
    if (!pend) return;
    parts.push(Uint8Array.from([0x21, 0xF9, 4, (1 << 2) | (pend.t >= 0 ? 1 : 0), ...u16(Math.min(65535, pend.delay)), Math.max(0, pend.t), 0]));
    parts.push(Uint8Array.from([0x2C, ...u16(pend.x), ...u16(pend.y), ...u16(pend.w), ...u16(pend.h), pend.lct ? 0x80 | (pend.lbits - 1) : 0]));
    if (pend.lct) parts.push(pend.lct);
    parts.push(pend.data); written++; pend = null;
  };
  for (let i = 0; i < N; i++) {
    if (o.cancelled && o.cancelled()) throw new Error('CANCELADO');
    const d = await src.at(i); let x0 = W, y0 = H, x1 = -1, y1 = -1;
    mask.fill(0);
    for (let y = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, p++) {
      const q = p * 4; if (!changed(d, q)) continue;
      if (d[q + 3] < 128) { exact = false; continue; }   // GIF sem "apagar" não volta a ficar transparente
      mask[p] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) {   // nada mudou: só estica a duração do frame anterior
      if (pend) { pend.delay = effDelay(pend.delay) + effDelay(src.delay(i)); map[i] = written; continue; }
      x0 = y0 = x1 = y1 = 0;   // primeiro frame totalmente transparente: grava 1 pixel transparente
    }
    flush(); map[i] = written;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
    // paleta deste frame
    let pal = gpal, T = gT, bits = gBits;
    if (local) {
      const list = [], seen = new Map(); let over = false;
      for (let y = y0; y <= y1; y++) for (let x = x0, p = y * W + x0; x <= x1; x++, p++) {
        if (!mask[p]) continue; const q = p * 4, key = (d[q] << 16) | (d[q + 1] << 8) | d[q + 2];
        if (!seen.has(key)) { seen.set(key, 1); if (seen.size > 255) { over = true; break; } list.push(d[q], d[q + 1], d[q + 2]); }
      }
      if (over) {   // mais de 255 cores num frame só: reduz este frame (não fica exato)
        exact = false; const hf = hist();
        for (let y = y0; y <= y1; y++) for (let x = x0, p = y * W + x0; x <= x1; x++, p++) {
          if (!mask[p]) continue; const q = p * 4; hf.add(d[q], d[q + 1], d[q + 2]);
        }
        list.length = 0; list.push(...medianCut(hf, 255));
      }
      pal = makePal(list); T = pal.n; bits = bitsFor(pal.n + 1);
    }
    const minCode = Math.max(2, bits);
    // A = o que não mudou fica transparente; B = repete a cor que já está na tela (se existir na paleta);
    // C = como A, mas repete a cor da tela quando ela é igual à do pixel anterior (sequências mais longas)
    const A = new Uint8Array(n), B = new Uint8Array(n), C = new Uint8Array(n);
    let k = 0, lastC = -1, diffB = false, diffC = false;
    for (let y = y0; y <= y1; y++) for (let x = x0, p = y * W + x0; x <= x1; x++, p++, k++) {
      if (mask[p]) { const q = p * 4, v = pal.idx(d[q], d[q + 1], d[q + 2]); A[k] = B[k] = C[k] = v; lastC = v; continue; }
      A[k] = T; const sv = disp[p] >= 0 ? pal.has(disp[p]) : undefined;
      if (sv !== undefined) { B[k] = sv; diffB = true; } else B[k] = T;
      if (sv !== undefined && sv === lastC) { C[k] = sv; diffC = true; } else C[k] = T;
      lastC = C[k];
    }
    let best = A, data = lzw(A, minCode);
    if (diffB) { const db = lzw(B, minCode); if (db.length < data.length) { data = db; best = B; } }
    if (diffC) { const dc = lzw(C, minCode); if (dc.length < data.length) { data = dc; best = C; } }
    // paleta local menor, quando o frame usa poucas cores
    let lct = null, lbits = 0, t = T;
    if (local) { lct = new Uint8Array((1 << bits) * 3); lct.set(pal.list); lbits = bits; }
    else {
      const seenI = new Int16Array(256).fill(-1), used = [];
      let ok = true;
      for (let j = 0; j < n; j++) { const v = best[j]; if (seenI[v] < 0) { seenI[v] = used.length; used.push(v); if (used.length > 128) { ok = false; break; } } }
      const lb = ok ? bitsFor(used.length) : bits;
      if (ok && lb < bits) {
        const m = new Uint8Array(n); for (let j = 0; j < n; j++) m[j] = seenI[best[j]];
        const l = new Uint8Array((1 << lb) * 3);
        used.forEach((v, j) => { if (v < gpal.n) { l[j * 3] = gpal.list[v * 3]; l[j * 3 + 1] = gpal.list[v * 3 + 1]; l[j * 3 + 2] = gpal.list[v * 3 + 2]; } });
        const dl = lzw(m, Math.max(2, lb));
        if (dl.length + l.length < data.length) {
          data = dl; lct = l; lbits = lb;
          // transparente: o índice local de T; se o frame não usa T, um índice livre; se não houver livre, sem transparência
          t = seenI[T] >= 0 ? seenI[T] : used.length < (1 << lb) ? used.length : -1;
        }
      }
    }
    // o que o leitor passa a mostrar
    for (let y = y0; y <= y1; y++) for (let x = x0, p = y * W + x0; x <= x1; x++, p++) {
      if (!mask[p]) continue; const q = p * 4, v = pal.idx(d[q], d[q + 1], d[q + 2]);
      disp[p] = (pal.list[v * 3] << 16) | (pal.list[v * 3 + 1] << 8) | pal.list[v * 3 + 2];
      ref[q] = d[q]; ref[q + 1] = d[q + 1]; ref[q + 2] = d[q + 2]; ref[q + 3] = 255;
    }
    have = true;
    pend = { x: x0, y: y0, w, h, data, lct, lbits, t, delay: src.delay(i) };
    if (i % 4 === 3) await tick(2, i + 1, N);
  }
  flush(); parts.push(Uint8Array.from([0x3B]));
  let tot = 0; for (const p of parts) tot += p.length;
  const bytes = new Uint8Array(tot); let off = 0; for (const p of parts) { bytes.set(p, off); off += p.length; }
  return { bytes, exact, map, written };
}
// confere se o GIF gerado mostra exatamente as mesmas imagens (e durações) que a entrada
async function verify(bytes, src, map, tick) {
  const g = root.GifCore.parseGIF(bytes), c = root.GifCore.makeComposer(g, 1.5e8), P4 = src.W * src.H * 4;
  if (g.W !== src.W || g.H !== src.H) return false;
  for (let i = 0; i < src.N; i++) {
    const a = await src.at(i), b = c.at(map[i]);
    for (let q = 0; q < P4; q += 4) {
      const ta = a[q + 3] < 128, tb = b[q + 3] < 128;
      if (ta !== tb) return false;
      if (!ta && (a[q] !== b[q] || a[q + 1] !== b[q + 1] || a[q + 2] !== b[q + 2])) return false;
    }
    if (tick && i % 4 === 3) await tick(3, i + 1, src.N);
  }
  // duração total igual (como os navegadores tocam)
  let da = 0, db = 0; for (let i = 0; i < src.N; i++) da += effDelay(src.delay(i)); for (const f of g.frames) db += effDelay(f.delay);
  return da === db;
}

// entrada a partir dos bytes de um GIF
function fromBytes(bytes) {
  const g = root.GifCore.parseGIF(bytes), c = root.GifCore.makeComposer(g, 1.5e8);
  return { W: g.W, H: g.H, N: g.frames.length, at: i => c.at(i), delay: i => g.frames[i].delay, loop: g.appExts.find(e => e.length > 13 && String.fromCharCode(...e.subarray(3, 14)) === 'NETSCAPE2.0') || null };
}

// SEM PERDA: devolve os bytes menores entre o original e o otimizado (conferido pixel a pixel)
async function lossless(bytes, o) {
  o = o || {};
  const src = fromBytes(bytes);
  const r = await encode(src, { tol: 0, tick: o.tick, cancelled: o.cancelled });
  if (!r.exact || r.bytes.length >= bytes.length) return { bytes, optimized: false };
  if (!(await verify(r.bytes, fromBytes(bytes), r.map, o.tick))) return { bytes, optimized: false };
  return { bytes: r.bytes, optimized: true };
}

// COM PERDA: comprime com a tolerância tol
async function lossy(bytes, tol, o) {
  o = o || {};
  const r = await encode(fromBytes(bytes), { tol, tick: o.tick, cancelled: o.cancelled });
  return r.bytes.length < bytes.length ? r.bytes : bytes;
}

root.GifOpt = { encode, verify, fromBytes, lossless, lossy, lzw };
})(typeof window !== 'undefined' ? window : globalThis);
