// ---------- gravação por captura direta ----------
// Cada frame aceito guarda quando chegou (t) e o retângulo que mudou em relação ao anterior, comprimido sem perda (deflate).
// A tela parada não gera frames novos (o navegador nem entrega), então 10 s parados custam quase nada.
const deflate = u8 => new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
const inflate = buf => new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(b => new Uint8Array(b));
function startCapture(r, track) {
  const fps = Math.min(15, +$('cvFps').value), maxW = +$('cvW').value, minGap = 1000 / fps * 0.9;
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const cap = { list: [], W: 0, H: 0, mem: 0, endT: 0, err: null, done: null };
  cap.done = (async () => {
    let cx = null, prev = null, lastT = -1e9;
    try {
      for (;;) {
        const { value: vf, done } = await reader.read();
        if (done) break;
        const t = performance.now();
        if (r.stopped) { vf.close(); break; }
        if (t - lastT < minGap) { vf.close(); continue; }   // acima do fps escolhido: pula
        lastT = t;
        if (!cx) {   // tamanho fixo pela primeira imagem (largura máxima das Opções para vídeos; nunca aumenta)
          const vw = vf.displayWidth, vh = vf.displayHeight;
          cap.W = Math.min(vw, maxW); cap.H = Math.max(1, Math.round(vh * cap.W / vw));
          if (cap.W * cap.H * 4 > 150e6) { vf.close(); throw new Error('GIF_GRANDE'); }
          const c = new OffscreenCanvas(cap.W, cap.H); cx = c.getContext('2d', { willReadFrequently: true });
          cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
          prev = new Uint8ClampedArray(cap.W * cap.H * 4);
        }
        cx.drawImage(vf, 0, 0, cap.W, cap.H); vf.close();
        const { W, H } = cap, d = cx.getImageData(0, 0, W, H).data, first = !cap.list.length;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        if (first) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
        else for (let y = 0, q = 0; y < H; y++) for (let x = 0; x < W; x++, q += 4) {
          if (d[q] === prev[q] && d[q + 1] === prev[q + 1] && d[q + 2] === prev[q + 2]) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) continue;   // nada mudou: o frame anterior só fica mais tempo na tela
        const w = x1 - x0 + 1, h = y1 - y0 + 1, crop = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) { const a = ((y0 + y) * W + x0) * 4; crop.set(d.subarray(a, a + w * 4), y * w * 4); prev.set(d.subarray(a, a + w * 4), a); }
        cap.list.push({ t, x: x0, y: y0, w, h, data: deflate(crop).then(b => { cap.mem += b.byteLength; return b; }) });
      }
    } catch (err) { cap.err = err; }
    try { reader.releaseLock(); } catch (e) { /* já liberado */ }
  })();
  return cap;
}
// frames da captura, remontados em ordem (para o otimizador); durações em centésimos pelo relógio da captura
function captureSource(cap) {
  const { W, H, list } = cap, N = list.length, t0 = list[0].t;
  const end = Math.max(cap.endT, list[N - 1].t + 20), cs = t => Math.round((t - t0) / 10);
  const delays = list.map((f, i) => Math.max(2, cs(i + 1 < N ? list[i + 1].t : end) - cs(f.t)));
  let img = null, last = -1;
  const at = async i => {
    if (i < last) { img = null; last = -1; }   // voltou para trás (segunda passada): remonta do começo
    if (!img) img = new Uint8ClampedArray(W * H * 4);
    while (last < i) {
      const f = list[++last], px = await inflate(await f.data);
      for (let y = 0; y < f.h; y++) img.set(px.subarray(y * f.w * 4, (y + 1) * f.w * 4), ((f.y + y) * W + f.x) * 4);
    }
    return img;
  };
  return { W, H, N, at, delay: i => delays[i], loop: null };
}
async function finishCapture(r, secs) {
  const cap = r.cap;
  await cap.done;
  if (!cap.err && (!cap.list.length || secs < 0.5)) { showResult('A gravação ficou muito curta', ['Não deu para aproveitar. Grave por pelo menos 1 segundo.', 'Nenhum arquivo foi criado.'], 'warn'); return; }
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const name = `gravacao-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.gif`;
  if (document.hidden) {   // terminou com outra aba na frente: o navegador deixa uma aba escondida lenta, então espera a pessoa voltar
    recWait = true; document.title = '⏸ Gravação pronta · volte para esta aba';
    say('A gravação está pronta. Volte para esta aba para transformá-la em GIF.', 'ok');
    try { window.focus(); } catch (e) { /* o navegador não deixa uma aba puxar o foco sozinha */ }
    await new Promise(res => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); res(); } }; document.addEventListener('visibilitychange', f); });
    recWait = false; document.title = baseTitle;
  }
  const keep = !dirty || confirm('A gravação terminou.\n\nVocê tem alterações que ainda não foram salvas no editor. Abrir a gravação agora e perder essas alterações?\n\n(Se escolher Cancelar, a gravação é baixada como GIF e o editor continua como está.)');
  let bytes = null, erro = cap.err, desistiu = false;
  if (!erro) await work('Transformando a gravação em GIF…', async () => {
    try {
      const res = await GifOpt.encode(captureSource(cap), { tol: 0, quantize: true, cancelled: () => cancelled,
        tick: async (ph, i, n) => { progress((ph - 1 + i / n) / 2, `Frame ${i} de ${n}`); await sleep(0); } });
      bytes = res.bytes;
      if (!keep) return;
      if ((await openBytes(bytes, name, true)) === false) { desistiu = true; return false; }
      say(`Pronto! A gravação virou GIF (${g.W} × ${g.H}, ${pl(frames.length, 'frame', 'frames')}, ${kb(bytes.length)}). Ela ainda não foi salva: clique em Salvar GIF.`, 'ok');
    } catch (err) { if (err.message === 'CANCELADO') desistiu = true; else erro = err; return false; }
  }, 'Gravação pronta!', { cancel: true });
  if (bytes && (!keep || desistiu || erro)) {   // não abriu no editor: baixa o GIF para a gravação não ser perdida
    saveGif(bytes, name);
    showResult(keep ? 'A gravação não abriu no editor' : 'Gravação salva como GIF', [
      `“${name}” foi baixado (${kb(bytes.length)}), sem passar pelo editor.` + (keep ? '' : ' As alterações do editor continuam como estavam.'),
      ...(erro ? ['Motivo: ' + errMsg(erro)] : [])], keep ? 'warn' : 'ok');
  } else if (erro) showResult('Não consegui transformar a gravação em GIF', [errMsg(erro), 'Nenhum arquivo foi criado.'], 'err');
  else if (desistiu) say('Gravação descartada. Nenhum arquivo foi criado.');
  else if (r.auto && !$('result').open) showResult('Gravação encerrada no limite de tempo', [`A gravação chegou a ${mmss(recMaxS)} e foi encerrada sozinha. Tudo o que foi gravado até aí está no editor.`], 'warn');
}
