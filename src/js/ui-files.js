// ---------- arquivo ----------
const isGif = f => f && (f.type === 'image/gif' || /\.gif$/i.test(f.name));
const isVideo = f => f && (/^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(f.name));
const baseName = n => n.replace(/\.[^.]+$/, '') || 'gif';
const fmtEta = s => s < 90 ? Math.max(5, Math.round(s / 5) * 5) + ' s' : Math.round(s / 60) + ' min';
function errMsg(err) {
  const m = (err && err.message) || '';
  return m === 'GIF_GRANDE' ? 'A imagem do GIF é grande demais para editar neste computador.'
    : m === 'CANCELADO' ? 'Conversão cancelada.'
    : m === 'Não é um GIF válido' || m === 'GIF sem frames' ? 'O arquivo não é um GIF válido (ou está corrompido).'
    : m === 'VIDEO_ERRO' || m === 'META_TEMPO' || m === 'SEM_VIDEO' ? 'O navegador não conseguiu abrir esse vídeo. O formato ou o codec talvez não seja aceito (MP4 com H.264 e WebM costumam funcionar).'
    : m === 'SEEK_TEMPO' ? 'O vídeo travou ao ler os frames. Tente de novo ou use um vídeo menor.'
    : (err && err.name === 'RangeError') || /memory|allocation/i.test(m) ? 'A memória do computador acabou. Feche outras abas e tente de novo, ou use um vídeo/GIF menor.'
    : 'Erro inesperado: ' + m;
}
// janela com o resultado (para o que a pessoa não pode deixar de ver)
function showResult(title, lines, kind) {
  $('resT').textContent = title; $('resT').className = kind || '';
  const b = $('resB'); b.textContent = '';
  for (const l of lines) { const p = document.createElement('p'); p.textContent = l; b.appendChild(p); }
  const d = $('result'); if (!d.open) d.showModal();
}
$('resOk').onclick = () => $('result').close();
// abre um GIF (já em bytes) no editor. Devolve false se a pessoa desistiu. Só troca o GIF aberto se tudo der certo.
// A memória fica quase fixa: os frames são remontados só quando precisam aparecer (ver makeComposer em gifcore.js).
async function openBytes(bytes, name, isConv) {
  const ng = GifCore.parseGIF(bytes), W = ng.W, H = ng.H;
  if (W * H * 4 > 150e6) throw new Error('GIF_GRANDE');
  if (ng.frames.length > 3000 && !confirm('Este GIF é muito longo (' + pl(ng.frames.length, 'frame', 'frames') + ').\nAbrir pode levar alguns minutos.\n\nQuer continuar?')) return false;
  const c = GifCore.makeComposer(ng), list = ng.frames.map((_, i) => ({ i, blurs: [], view: null }));
  list.forEach(f => makeCell(f, W, H));
  tmp.width = W; tmp.height = H;
  await c.scan((n, rgba) => {   // uma passada por todos os frames, só para criar as miniaturas
    tctx.putImageData(new ImageData(rgba, W, H), 0, 0);
    const th = list[n].th; th.getContext('2d').drawImage(tmp, 0, 0, th.width, th.height);
  }, async (d, t) => { progress(d / t, `Preparando ${d} de ${t} frames`); await sleep(0); });
  playing && togglePlay(); savedSize = 0;
  srcBytes = bytes; g = ng; comp = c; srcName = baseName(name); fromVideo = !!isConv;
  cv.width = W; cv.height = H;
  frames = list; undoSt = []; redoSt = []; sel = new Set(); cur = frames[0]; anchor = cur; areas = []; rect = null; live = null; zoomFit = true; dirty = !!isConv;
  lastSel = new Set(); autoScope(); $('rfrom').value = $('rto').value = '';
  setTab('blur');
  refresh(true); applyZoom(); $('stage').scrollTo(0, 0);
  return true;
}
async function loadGif(file) {
  if (dirty && !confirm('Você tem alterações que ainda não foram salvas.\n\nAbrir outro arquivo e perder essas alterações?')) return;
  let erro = null, desistiu = false;
  await work('Abrindo o seu GIF…', async () => {
    try {
      const r = await openBytes(new Uint8Array(await file.arrayBuffer()), file.name, false);
      if (r === false) { desistiu = true; return false; }
      say(`Pronto! “${file.name}” foi aberto (${g.W} × ${g.H}, ${pl(frames.length, 'frame', 'frames')}, ${kb(srcBytes.length)}).`, 'ok');
    } catch (err) { erro = err; return false; }
  }, 'GIF aberto!');
  if (erro) showResult('Não consegui abrir o GIF', [errMsg(erro), 'O arquivo original não foi alterado.'], 'err');
  else if (desistiu) say('Abertura cancelada. O GIF não foi aberto.');
}
// opções da conversão (largura e fps vêm da tela inicial); prefix aparece antes do "frame x de y" (lote)
function convOpts(prefix) {
  return {
    maxW: +$('cvW').value, fps: +$('cvFps').value, tol: 0,   // qualidade máxima: o arquivo só é diminuído ao salvar
    cancelled: () => cancelled,
    confirmFrames: (n, s) => confirm('Este vídeo é longo (' + Math.round(s / 60 * 10) / 10 + ' min, ' + n + ' frames).\nA conversão pode demorar bastante e o GIF pode ficar grande.\n\nQuer continuar?'),
    onProgress: p => {
      $('busyt').textContent = (prefix || '') + (p.phase === 'cores' ? 'Analisando as cores do vídeo…' : 'Convertendo o vídeo em GIF…');
      progress(p.i / p.n, p.phase === 'cores' ? `Analisando ${p.i} de ${p.n}` : `Frame ${p.i} de ${p.n}` + (p.eta > 4 ? ` · faltam cerca de ${fmtEta(p.eta)}` : ''));
    }
  };
}
async function loadVideo(file, noAsk) {   // noAsk: quem chama já tratou as alterações não salvas (gravação de tela)
  if (dirty && !noAsk && !confirm('Você tem alterações que ainda não foram salvas.\n\nAbrir outro arquivo e perder essas alterações?')) return;
  let out = null;   // o que mostrar na janela de resultado, se não abriu no editor
  await work('Convertendo o vídeo em GIF…', async () => {
    let r;
    try { r = await VideoGif.convert(file, convOpts()); }
    catch (err) {
      out = err.message === 'CANCELADO' ? { cancel: true }
        : { title: 'Não foi possível converter o vídeo', lines: [errMsg(err), 'Nenhum arquivo foi baixado.'], kind: 'err' };
      return false;
    }
    const nm = baseName(file.name) + '.gif', info = `${r.w} × ${r.h}, ${pl(r.n, 'frame', 'frames')}, ${kb(r.bytes.length)}`;
    let why = '';
    try { if ((await openBytes(r.bytes, file.name, true)) === false) why = 'você escolheu não abrir no editor.'; }
    catch (e) { why = errMsg(e); }
    if (!why) { say(`Pronto! O vídeo virou GIF (${info}; o vídeo tinha ${kb(file.size)}). Ele ainda não foi salvo: clique em Salvar GIF.`, 'ok'); return; }
    saveGif(r.bytes, nm);   // não abriu no editor: baixa direto para a conversão não ser perdida
    out = { title: 'O GIF foi criado, mas não abriu no editor', kind: 'warn', lines: [
      'Motivo: ' + why,
      `O GIF foi baixado mesmo assim: “${nm}” (${info}). Procure na pasta de downloads.`,
      'O vídeo original não foi alterado.'] };
  }, 'Vídeo convertido!', { cancel: true });
  if (out && out.cancel) say('Conversão cancelada. Nenhum arquivo foi baixado.');
  else if (out) showResult(out.title, out.lines, out.kind);
}
// vários vídeos: converte um por um e baixa cada GIF (sem abrir no editor)
async function convertBatch(vids) {
  if (dirty && !confirm('Você tem alterações que ainda não foram salvas no editor.\n\nA conversão em lote não usa o editor, então elas continuam como estão.\n\nQuer continuar?')) return;
  let ok = 0, parou = false; const linhas = [];
  await work(`Convertendo ${vids.length} vídeos…`, async () => {
    for (let i = 0; i < vids.length; i++) {
      if (cancelled) break;
      try {
        const r = await VideoGif.convert(vids[i], convOpts(`Vídeo ${i + 1} de ${vids.length}: `)), nm = baseName(vids[i].name) + '.gif';
        let out = await optimizeLossless(r.bytes), extra = '';   // em lote não dá para perguntar: comprime sozinho se passar do limite
        if (out.length > LIMIT) { const c = await compressToFit(out); out = c.bytes; extra = c.fits ? `, comprimido no nível ${c.level} para caber em ${LIMIT_TXT}` : `, comprimido ao máximo e ainda acima de ${LIMIT_TXT}`; }
        saveGif(out, nm); ok++; linhas.push(`✓ ${vids[i].name} → ${nm} (${kb(out.length)}${extra})`);
        await sleep(300);
      } catch (err) { if (err.message === 'CANCELADO') break; linhas.push(`✗ ${vids[i].name}: ${errMsg(err)}`); }
    }
    parou = cancelled;
    if (!ok) return false;
  }, 'Conversão concluída!', { cancel: true });
  const resumo = ok ? `${ok} de ${vids.length} GIFs foram baixados (pasta de downloads).` : 'Nenhum arquivo foi baixado.';
  showResult(parou ? 'Conversão cancelada' : ok === vids.length ? 'Vídeos convertidos' : 'A conversão terminou com problemas', [resumo, ...linhas],
    ok === vids.length && !parou ? 'ok' : ok ? 'warn' : 'err');
}
function loadFiles(list) {
  const files = [...list]; if (!files.length || loading || rec || recWait) return;   // gravando: ignora arquivos soltos
  const gifs = files.filter(isGif), vids = files.filter(f => !isGif(f) && isVideo(f));
  if (files.length === 1) {
    if (gifs.length) return loadGif(files[0]);
    if (vids.length) return loadVideo(files[0]);
    showResult('Esse arquivo não pode ser aberto', [`“${files[0].name}” não é um GIF nem um vídeo.`, 'Use arquivos .gif, .mp4 ou .webm.'], 'err'); return;
  }
  if (!gifs.length && vids.length === files.length) return convertBatch(vids);
  showResult('Escolha os arquivos de outro jeito', ['Para editar, escolha um GIF por vez.', 'Para converter vários vídeos de uma vez, escolha só vídeos.'], 'warn');
}
