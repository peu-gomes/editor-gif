// ---------- ações ----------
function scopeFrames() {
  if (!g) return [];
  const v = document.querySelector('input[name=scope]:checked').value;
  return v === 'all' ? frames.slice() : v === 'marked' ? frames.filter(f => sel.has(f)) : (cur ? [cur] : []);
}
function setTab(t) {
  tab = t;
  for (const [k, id] of [['blur', 'Blur'], ['cut', 'Cut']]) {
    const on = k === t; $('tab' + id).setAttribute('aria-selected', on); $('tab' + id).classList.toggle('on', on); $('panel' + id).hidden = !on;
  }
  cv.style.cursor = t === 'blur' ? 'crosshair' : 'default'; live = null; redraw();
}
const snapshot = () => frames.map(f => [f, f.blurs.slice()]);
function pushHist() { undoSt.push(snapshot()); redoSt = []; if (undoSt.length > 50) undoSt.shift(); dirty = true; }
const sameBlurs = (x, y) => x.length === y.length && x.every((b, i) => b === y[i]);
async function restore(h) {
  const changed = [];
  frames = h.map(([f, b]) => { if (!sameBlurs(f.blurs, b)) { f.blurs = b; f.view = null; changed.push(f); } return f; });
  changed.sort((p, q) => p.i - q.i);   // em ordem, para o remontador de frames trabalhar sem voltar atrás
  for (let k = 0; k < changed.length; k++) {
    thumb(changed[k]);
    if (k % 3 === 2) { progress((k + 1) / changed.length, `${k + 1} de ${changed.length} frames`); await sleep(8); }
  }
  for (const f of [...sel]) if (!frames.includes(f)) sel.delete(f);
  if (!frames.includes(cur)) cur = frames[0] || null;
  if (!frames.includes(anchor)) anchor = cur;
  refresh(true);
}
async function undo() {
  if (loading || !undoSt.length) return;
  await work('Desfazendo…', async () => { const h = undoSt.pop(); redoSt.push(snapshot()); dirty = true; await restore(h); }, 'Desfeito!');
  say('Desfeito. Voltei um passo.');
}
async function redo() {
  if (loading || !redoSt.length) return;
  await work('Refazendo…', async () => { const h = redoSt.pop(); undoSt.push(snapshot()); dirty = true; await restore(h); }, 'Refeito!');
  say('Refeito.');
}
async function doBlur() {
  if (!g || loading) return;
  if (!rect) { setTab('blur'); say('Primeiro desenhe um retângulo sobre a imagem, em cima do dado que quer borrar.', 'err'); return; }
  const t = scopeFrames(), rc = { ...rect }, r = +$('rad').value;
  if (!t.length) { say('Nenhum frame escolhido para borrar.', 'err'); return; }
  await work(`Borrando os dados em ${pl(t.length, 'frame', 'frames')}…`, async () => {
    pushHist();
    for (let i = 0; i < t.length; i++) {
      const f = t[i]; f.blurs.push({ ...rc, r }); f.view = null; thumb(f);
      if (i % 3 === 2 || i === t.length - 1) { progress((i + 1) / t.length, `${i + 1} de ${t.length} frames`); await sleep(8); }
    }
    if (!$('keeprect').checked) rect = null;
    refresh();
  }, 'Dados borrados!');
  say(`Pronto! Os dados foram borrados em ${pl(t.length, 'frame', 'frames')}. Errou? Clique em Desfazer.`, 'ok');
}
async function doUnblur() {
  if (loading) return;
  const t = scopeFrames().filter(f => f.blurs.length);
  if (!t.length) { say('Esses frames não têm borrão.'); return; }
  await work(`Tirando o borrão de ${pl(t.length, 'frame', 'frames')}…`, async () => {
    pushHist();
    for (let i = 0; i < t.length; i++) {
      const f = t[i]; f.blurs = []; f.view = null; thumb(f);
      if (i % 3 === 2 || i === t.length - 1) { progress((i + 1) / t.length, `${i + 1} de ${t.length} frames`); await sleep(8); }
    }
    refresh();
  }, 'Borrão removido!');
  say(`Borrão removido de ${pl(t.length, 'frame', 'frames')}.`, 'ok');
}
async function removeFrames(t) {
  if (!g || loading) return;
  if (!t.size) { say('Não há frames para apagar. Marque os frames na linha do tempo.', 'err'); return; }
  if (t.size >= frames.length) { say('Não dá para apagar todos os frames: o GIF precisa ficar com pelo menos um.', 'err'); return; }
  await work(`Apagando ${pl(t.size, 'frame', 'frames')}…`, () => {
    pushHist();
    const first = frames.findIndex(f => t.has(f));   // onde o corte acontece
    frames = frames.filter(f => !t.has(f)); sel = new Set();
    // se o frame atual foi apagado, fica no ponto do corte: o frame que ocupou o lugar do primeiro apagado
    // (ex.: apagar os frames 2, 3 e 4 => o editor fica no frame 2, que agora é o antigo 5)
    if (t.has(cur)) cur = frames[Math.min(first, frames.length - 1)];
    anchor = cur; refresh(true);
  }, pl(t.size, 'frame apagado!', 'frames apagados!'));
  say(`${pl(t.size, 'frame apagado', 'frames apagados')}. Errou? Clique em Desfazer.`, 'ok');
}
const doDel = () => removeFrames(new Set(sel.size ? frames.filter(f => sel.has(f)) : []));
const doBefore = () => removeFrames(new Set(frames.slice(0, frames.indexOf(cur))));
const doAfter = () => removeFrames(new Set(frames.slice(frames.indexOf(cur) + 1)));
const doKeep = () => { if (!sel.size) { say('Marque os frames que você quer manter.', 'err'); return; } removeFrames(new Set(frames.filter(f => !sel.has(f)))); };
function go(d, extend) {   // teclado: muda o frame atual (e a marcação)
  if (!cur) return; const f = frames[clamp(frames.indexOf(cur) + d, 0, frames.length - 1)];
  if (extend) sel = new Set(range(anchor || cur, f)); else { sel = new Set([f]); anchor = f; }
  cur = f; refresh(true);
}
function step(d) {   // botões Anterior/Próximo: muda só o frame atual
  if (!cur) return; if (playing) togglePlay();
  cur = frames[clamp(frames.indexOf(cur) + d, 0, frames.length - 1)]; refresh(true);
}
function togglePlay() {
  if (playing) { clearTimeout(playing); playing = null; $('play').textContent = '▶ Assistir'; return; }
  if (!frames.length) return;
  $('play').textContent = '■ Parar';
  const stepFn = () => {
    cur = frames[(frames.indexOf(cur) + 1) % frames.length];
    document.querySelectorAll('.cell.cur').forEach(c => c.classList.remove('cur')); cur.cell.classList.add('cur');
    cur.cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('fi').textContent = `Frame ${frames.indexOf(cur) + 1} de ${frames.length} · ${dur(cur)} ms`; draw();
    playing = setTimeout(stepFn, dur(cur) / +$('spd').value);
  };
  playing = setTimeout(stepFn, 0);
}
function saveGif(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// ---------- tamanho do arquivo ----------
// Ao salvar: o GIF é sempre otimizado SEM PERDA (conferido pixel a pixel). Se passar de LIMIT, a pessoa escolhe se comprime.
const LIMIT = 2.9 * 1048576, LIMIT_TXT = '2,9 MB';
const TOLS = [6, 12, 18, 24, 36, 48, 64];   // níveis de compressão com perda, do mais leve ao mais forte
// mostra o andamento do otimizador (fases 1 e 2 = gravar, 3 = conferir)
const optTick = (label) => async (ph, i, n) => {
  $('busyt').textContent = ph === 3 ? 'Conferindo se ficou idêntico…' : label;
  progress((ph - 1 + i / n) / 3, `Frame ${i} de ${n}`);
  await sleep(0);
};
async function optimizeLossless(bytes) {
  const r = await GifOpt.lossless(bytes, { tick: optTick('Diminuindo o arquivo sem perder qualidade…'), cancelled: () => cancelled });
  return r.bytes;
}
// procura a compressão mais leve que faz o GIF caber em LIMIT (busca binária nos níveis). Devolve { bytes, level, fits }
async function compressToFit(bytes) {
  let lo = 0, hi = TOLS.length - 1, best = null, smallest = null, tries = 0;
  const tryLevel = async k => {
    tries++;
    const out = await GifOpt.lossy(bytes, TOLS[k], {
      cancelled: () => cancelled,
      tick: async (ph, i, n) => { $('busyt').textContent = `Comprimindo (tentativa ${tries})…`; progress((ph - 1 + i / n) / 2, `Nível ${k + 1} de ${TOLS.length} · frame ${i} de ${n}`); await sleep(0); }
    });
    if (!smallest || out.length < smallest.bytes.length) smallest = { bytes: out, level: k + 1 };
    return out;
  };
  let k = 3;   // começa no meio
  while (lo <= hi) {
    const out = await tryLevel(k);
    if (out.length <= LIMIT) { best = { bytes: out, level: k + 1 }; hi = k - 1; } else lo = k + 1;
    k = Math.floor((lo + hi) / 2);
  }
  return best ? { ...best, fits: true } : { ...smallest, fits: false };
}
// pergunta o que fazer com um GIF maior que o limite: 'comp', 'keep' ou 'no'
function askBig(title, lines, canCompress, keepLabel) {
  $('bigT').textContent = title;
  const b = $('bigB'); b.textContent = '';
  for (const l of lines) { const p = document.createElement('p'); p.textContent = l; b.appendChild(p); }
  $('bigComp').hidden = !canCompress; $('bigKeep').textContent = keepLabel;
  const d = $('big'); d.returnValue = '';
  return new Promise(res => {
    const done = v => { d.onclose = null; if (d.open) d.close(); res(v); };
    $('bigComp').onclick = () => done('comp'); $('bigKeep').onclick = () => done('keep'); $('bigNo').onclick = () => done('no');
    d.onclose = () => res('no');   // Esc
    d.showModal();
  });
}
const mb = n => (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
async function doExport() {
  if (!g || loading) return;
  if (playing) togglePlay();
  const name = srcName + (fromVideo ? '' : '-editado') + '.gif';
  let bytes = null, erro = null;
  const ok = await work('Salvando o seu GIF…', async () => {
    try {
      const q = $('qual').value.split(',');
      const r = await GifCore.buildGIF(g, frames, {
        mergeDelay: $('merge').checked, blurColors: +q[0], blurTol: +q[1], getSnap: i => comp.at(i),
        tick: async (j, t) => { progress(j / t, `Montando: frame ${j} de ${t}`); await sleep(0); }
      });
      if (cancelled) return false;
      bytes = await optimizeLossless(r.bytes);
    } catch (err) { if (err.message !== 'CANCELADO') erro = err; return false; }
  }, null, { cancel: true });
  if (erro) { say('Não consegui salvar o GIF. (' + erro.message + ')', 'err'); draw(); return; }
  if (!ok) { say('Salvamento cancelado. Nada foi salvo.'); draw(); return; }
  let note = '';
  if (bytes.length > LIMIT) {
    const a = await askBig(`O GIF ficou com ${mb(bytes.length)}`, [
      `Isso passa do limite de ${LIMIT_TXT}. Ele já foi diminuído ao máximo sem perder qualidade.`,
      `Posso comprimir só o necessário para caber em ${LIMIT_TXT}. Isso perde um pouco de qualidade: cores parecidas se juntam e mudanças muito pequenas entre frames são ignoradas.`,
      'Outra saída sem perda é apagar frames que não fazem falta.'], true, `Salvar assim mesmo (${mb(bytes.length)})`);
    if (a === 'no') { say('Nada foi salvo. O GIF continua aberto no editor.'); draw(); return; }
    if (a === 'comp') {
      let res = null, e2 = null;
      const ok2 = await work('Comprimindo…', async () => {
        try { res = await compressToFit(bytes); } catch (err) { if (err.message !== 'CANCELADO') e2 = err; return false; }
      }, null, { cancel: true });
      if (e2) { say('Não consegui comprimir o GIF. (' + e2.message + ')', 'err'); draw(); return; }
      if (!ok2) { say('Compressão cancelada. Nada foi salvo.'); draw(); return; }
      if (!res.fits) {
        const a2 = await askBig(`Mesmo comprimindo, ficou com ${mb(res.bytes.length)}`, [
          `Não deu para caber em ${LIMIT_TXT} sem estragar a imagem.`,
          'Para diminuir mais: apague frames que não fazem falta, ou converta de novo com largura menor ou menos frames por segundo (Opções para vídeos, na tela inicial).'],
          false, `Salvar o comprimido (${mb(res.bytes.length)})`);
        if (a2 !== 'keep') { say('Nada foi salvo. O GIF continua aberto no editor.'); draw(); return; }
      }
      note = ` Comprimido no nível ${res.level} de ${TOLS.length}.`;
      bytes = res.bytes;
    }
  }
  saveGif(bytes, name); dirty = false; savedSize = bytes.length; refresh();
  say(`Pronto! Salvei “${name}” (${kb(srcBytes.length)} → ${kb(bytes.length)}).${note} Procure na pasta de downloads.`, 'ok');
  draw();
}
function nudge(dx, dy) { if (!rect) return; rect = { ...rect, x: clamp(rect.x + dx, 0, g.W - rect.w), y: clamp(rect.y + dy, 0, g.H - rect.h) }; live = null; redraw(); }
function setRadius(v) { v = clamp(v, 1, 40); $('rad').value = v; live = null; redraw(); }
function markAll() { sel = new Set(frames); refresh(); }
function markNone() { sel = new Set(); refresh(); }
function invert() { sel = new Set(frames.filter(f => !sel.has(f))); refresh(); }
function fullArea() { if (!g) return; setTab('blur'); rect = { x: 0, y: 0, w: g.W, h: g.H }; live = null; redraw(); }

