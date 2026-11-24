// ---------- imagem ----------
const viewQ = [];   // frames com imagem borrada em cache (no máximo 4)
function view(f) {
  const s = comp.at(f.i);
  if (!f.blurs.length) return new ImageData(s, g.W, g.H);
  if (!f.view) {
    f.view = new ImageData(GifCore.applyBlurs(s, g.W, g.H, f.blurs), g.W, g.H);
    viewQ.push(f); if (viewQ.length > 4) { const o = viewQ.shift(); if (o !== f) o.view = null; }
  }
  return f.view;
}
function thumb(f) {
  tctx.putImageData(view(f), 0, 0);
  f.th.getContext('2d').drawImage(tmp, 0, 0, f.th.width, f.th.height);
}
function liveData() {   // pré-visualização do borrão no frame atual, antes de aplicar
  if (!rect || drag || !cur || tab !== 'blur') return null;
  const r = +$('rad').value, key = [cur.i, cur.blurs.length, rect.x | 0, rect.y | 0, rect.w | 0, rect.h | 0, r].join();
  if (!live || live.key !== key) {
    const d = new ImageData(new Uint8ClampedArray(view(cur).data), g.W, g.H);
    GifCore.blurRegion(d.data, g.W, g.H, rect.x, rect.y, rect.w, rect.h, r);
    live = { key, data: d };
  }
  return live.data;
}
let pending = 0;
function redraw() { if (!pending) pending = requestAnimationFrame(() => { pending = 0; draw(); }); }
function draw() {
  updateUI();
  if (!cur) return;
  ctx.putImageData(liveData() || view(cur), 0, 0);
  const u = g.W / cv.getBoundingClientRect().width || 1;
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.strokeStyle = 'rgba(245,147,20,.95)';   // contorno laranja = já borrado neste frame
  for (const b of cur.blurs) ctx.strokeRect(b.x, b.y, b.w, b.h);
  if (rect && tab === 'blur') {
    ctx.lineWidth = Math.max(1, 3 * u); ctx.strokeStyle = '#000'; ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.lineWidth = Math.max(1, 2 * u); ctx.setLineDash([7 * u, 5 * u]); ctx.strokeStyle = '#fff'; ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]); ctx.strokeStyle = '#1763d9'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(1, 2 * u);
    const s = 12 * u;
    for (const [hx, hy] of [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]]) {
      const x = rect.x + rect.w * hx - s / 2, y = rect.y + rect.h * hy - s / 2;
      ctx.fillRect(x, y, s, s); ctx.strokeRect(x, y, s, s);
    }
  }
}
function hintText() {
  if (tab === 'blur') {
    if (!rect) return 'Arraste sobre a imagem para marcar o dado que você quer borrar (CNPJ, CPF, nome…).';
    return 'Área marcada. Para ajustar, arraste as bordas. Depois clique em “Borrar esta área”.';
  }
  return 'Marque os frames na linha do tempo: clique na caixinha ○ de cada um, arraste sobre eles ou use Shift + clique.';
}
function updateUI() {
  const has = !!g, n = frames.length, i = frames.indexOf(cur);
  $('welcome').hidden = has; $('editor').hidden = !has; $('bottom').hidden = !has; $('openAgain').hidden = !has; $('recAgain').hidden = !has;
  $('dirty').hidden = !(has && dirty);
  if (!has) return;
  $('hint').textContent = hintText();
  $('undo').disabled = !undoSt.length; $('redo').disabled = !redoSt.length;
  $('prev').disabled = i < 1; $('next').disabled = i >= n - 1;
  $('blur').disabled = !rect; $('rinfo').textContent = rect ? `Área: ${Math.round(rect.w)} × ${Math.round(rect.h)}` : 'Nenhuma área marcada';
  $('del').disabled = !sel.size; $('delt').textContent = sel.size ? `Apagar ${pl(sel.size, 'frame marcado', 'frames marcados')}` : 'Apagar os frames marcados';
  $('selB').disabled = i < 1; $('selA').disabled = i < 0 || i >= n - 1;
  $('rfrom').max = $('rto').max = n; $('rsel').disabled = !n;
  $('keep').disabled = n < 2 || !sel.size || sel.size >= n;
  $('before').disabled = n < 2 || i < 1; $('after').disabled = n < 2 || i >= n - 1;
  $('none').disabled = !sel.size; $('all').disabled = sel.size === n;
  $('selinfo').textContent = sel.size ? `${pl(sel.size, 'frame marcado', 'frames marcados')} de ${n}.` : 'Nenhum frame marcado ainda.';
  $('sAll').textContent = `Todos os frames (${n})`;
  $('sMarked').textContent = sel.size ? `Só os frames marcados (${sel.size})` : 'Só os frames marcados (0)';
  $('sCur').textContent = `Só o frame atual (nº ${i + 1})`;
  $('rMarked').disabled = !sel.size;
  if (!sel.size && $('rMarked').checked) document.querySelector('input[name=scope][value=all]').checked = true;
  $('unblur').disabled = !scopeFrames().some(f => f.blurs.length);
}

