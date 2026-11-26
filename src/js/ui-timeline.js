// ---------- linha do tempo ----------
// Chrome e Firefox tocam atraso 0 ou 1 (centésimos de s) a 100 ms; a prévia e o total seguem isso
function dur(f) { const d = g.frames[f.i].delay; return d <= 1 ? 100 : d * 10; }
// "Em quais frames aplicar" acompanha a marcação: nada marcado = todos; 1 marcado = só o atual; 2 ou mais = só os marcados.
// (A pessoa pode trocar à mão; volta a acompanhar quando a marcação muda.)
let built = [], lastSel = new Set();
function autoScope() {
  const v = sel.size >= 2 ? 'marked' : sel.size === 1 ? 'cur' : 'all';
  document.querySelector(`input[name=scope][value=${v}]`).checked = true;
}
function selChanged() {
  if (lastSel.size !== sel.size) return true;
  for (const f of sel) if (!lastSel.has(f)) return true;
  return false;
}
function refresh(scroll) {
  // só mexe nos elementos da linha do tempo quando a lista de frames mudou (arrastar a marcação fica leve mesmo com milhares de frames)
  let same = built.length === frames.length;
  for (let i = 0; same && i < frames.length; i++) if (built[i] !== frames[i]) same = false;
  if (!same) { strip.textContent = ''; for (const f of frames) strip.appendChild(f.cell); built = frames.slice(); }
  if (selChanged()) { lastSel = new Set(sel); autoScope(); }
  frames.forEach((f, n) => {
    const cn = 'cell' + (sel.has(f) ? ' sel' : '') + (f === cur ? ' cur' : '') + (f.blurs.length ? ' bl' : '');
    if (f.cell.className !== cn) f.cell.className = cn;
    const al = `Frame ${n + 1}${sel.has(f) ? ', marcado' : ''}`;
    if (f.al !== al) { f.al = al; f.cell.setAttribute('aria-label', al); }
    if (f.nn !== n + 1) { f.nn = n + 1; f.num.textContent = n + 1; }
  });
  if (g) {
    const total = frames.reduce((a, f) => a + dur(f), 0), nb = frames.filter(f => f.blurs.length).length;
    $('tinfo').innerHTML = '';
    const b = document.createElement('b'); b.textContent = `${pl(frames.length, 'frame', 'frames')} · ${fmt(total)}`;
    const s = document.createElement('span'); s.className = 'dim'; s.textContent = '';   // frames com borrão: faixa laranja na miniatura
    $('tinfo').append(b, s);
    $('fi').textContent = `Frame ${frames.indexOf(cur) + 1} de ${frames.length} · ${dur(cur)} ms`;
  }
  if (scroll && cur) cur.cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  live = null; draw();
}
function makeCell(f, W, H) {
  const c = document.createElement('div'); f.cell = c; c._f = f; c.tabIndex = -1;
  const th = document.createElement('canvas'); th.height = 90; th.width = Math.max(1, Math.round(90 * W / H)); f.th = th;
  f.num = document.createElement('i'); const bar = document.createElement('b');
  const ck = document.createElement('span'); ck.className = 'ck'; ck.textContent = '✓'; ck.title = 'Marcar / desmarcar este frame';
  c.append(th, bar, ck, f.num);
}
function range(a, b) { const i = frames.indexOf(a), j = frames.indexOf(b); return frames.slice(Math.min(i, j), Math.max(i, j) + 1); }
function pick(f, e, mode) {
  if (e.shiftKey || mode === 'range') { if (anchor && frames.includes(anchor)) sel = new Set(range(anchor, f)); else { sel = new Set([f]); anchor = f; } }
  else if (e.ctrlKey || e.metaKey || mode === 'multi') { sel.has(f) ? sel.delete(f) : sel.add(f); anchor = f; }
  else { sel = new Set([f]); anchor = f; }
  cur = f;
}
const clickMode = () => $('multi').checked ? 'multi' : 'one';
// Arrastar para marcar vários frames: a marcação vai do frame onde o mouse foi apertado até o que estiver sob o mouse.
// Encostando na ponta da linha do tempo ela rola sozinha (mais rápido quanto mais perto da borda, e ainda mais
// se o mouse sair da área), e a marcação continua acompanhando. Roda do mouse durante o arrasto também vale.
let dragPx = 0, dragRaf = 0, dragOver = null, edgeT = 0;
function dragLoop() {
  dragRaf = 0; if (!tdrag) return;
  const tl = $('tl'), r = tl.getBoundingClientRect(), edge = Math.min(90, r.width / 4);
  const left = dragPx < r.left + edge ? (r.left + edge - dragPx) / edge : 0;
  const right = dragPx > r.right - edge ? (dragPx - (r.right - edge)) / edge : 0;
  // quanto mais perto da borda, mais rápido; e fica até 4 vezes mais rápido conforme o mouse continua parado na borda (GIFs longos)
  if (left || right) edgeT = edgeT || performance.now(); else edgeT = 0;
  const speed = t => Math.round((4 + 36 * Math.min(1, t) ** 2) * (1 + Math.min(3, (performance.now() - edgeT) / 700)));
  if (left) tl.scrollLeft -= speed(left); else if (right) tl.scrollLeft += speed(right);
  // procura o frame sob o mouse na altura do meio da linha do tempo (assim o mouse pode sair da faixa para cima/baixo)
  const el = document.elementFromPoint(clamp(dragPx, r.left + 3, r.right - 3), r.top + r.height / 2);
  const c = el && el.closest('.cell');
  if (c && c._f !== dragOver) { dragOver = c._f; sel = new Set(range(tdrag, c._f)); cur = c._f; refresh(); }
  dragRaf = requestAnimationFrame(dragLoop);
}
strip.addEventListener('mousedown', e => {
  const c = e.target.closest('.cell'); if (!c || e.button !== 0) return;
  if (playing) togglePlay();
  releaseFocus();   // o clique abaixo não tira o foco de "De/até" sozinho (preventDefault): sem isso Shift+setas iriam para a caixinha
  const onBox = !!e.target.closest('.ck');   // caixinha do canto: marca/desmarca só este frame
  const mode = onBox ? 'multi' : clickMode(), f = c._f;
  pick(f, e, mode);
  tdrag = (!onBox && mode === 'one' && !e.shiftKey && !e.ctrlKey && !e.metaKey) ? f : null;
  if (tdrag) { dragPx = e.clientX; dragOver = f; if (!dragRaf) dragRaf = requestAnimationFrame(dragLoop); }
  suppressClick = true; refresh(); e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!tdrag) return;
  if (!(e.buttons & 1)) { tdrag = null; return; }   // soltou o botão fora da janela
  dragPx = e.clientX;
});
window.addEventListener('mouseup', () => { tdrag = null; setTimeout(() => suppressClick = false, 0); });
strip.addEventListener('click', e => {   // toque (celular)
  if (suppressClick) { suppressClick = false; return; }
  const c = e.target.closest('.cell'); if (!c) return;
  pick(c._f, e, e.target.closest('.ck') ? 'multi' : clickMode()); refresh();
});

// tira o foco de campo de texto/número/menu, para os atalhos do teclado (setas, Shift+setas, Del...) voltarem a valer no editor
function releaseFocus() { const a = document.activeElement; if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) a.blur(); }
// barra "Marcar:" (embaixo, junto da linha do tempo): vale nas duas abas
function markSet(list, msg) { sel = new Set(list); anchor = list[0] || anchor; refresh(true); if (msg) say(msg); }
function markBefore() {
  const i = frames.indexOf(cur); if (i < 1) { say('Não há frames antes do atual.', 'err'); return; }
  markSet(frames.slice(0, i), `${pl(i, 'frame marcado', 'frames marcados')}: tudo antes do frame atual (nº ${i + 1}).`);
}
function markAfter() {
  const i = frames.indexOf(cur), n = frames.length - i - 1; if (i < 0 || n < 1) { say('Não há frames depois do atual.', 'err'); return; }
  markSet(frames.slice(i + 1), `${pl(n, 'frame marcado', 'frames marcados')}: tudo depois do frame atual (nº ${i + 1}).`);
}
function markRange() {
  if (!g) return; const n = frames.length;
  const a = parseInt($('rfrom').value, 10), b = parseInt($('rto').value, 10);
  if (!(a >= 1 && b >= 1)) { say('Escreva os dois números: de qual frame até qual frame.', 'err'); return; }
  const lo = clamp(Math.min(a, b), 1, n), hi = clamp(Math.max(a, b), 1, n);
  $('rfrom').value = lo; $('rto').value = hi;
  cur = frames[hi - 1];   // o atual fica no fim do intervalo (e a âncora no começo): Shift+→ aumenta, Shift+← diminui
  releaseFocus();   // depois de marcar, as setas e Shift+setas já funcionam no editor
  markSet(frames.slice(lo - 1, hi), `${pl(hi - lo + 1, 'frame marcado', 'frames marcados')}: do ${lo} ao ${hi}.`);
}
$('tl').addEventListener('wheel', e => {   // roda do mouse rola a linha do tempo
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { $('tl').scrollLeft += e.deltaY; e.preventDefault(); }
}, { passive: false });

