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
function liveData() {   // pré-visualização do borrão no frame atual, antes de aplicar (todas as áreas marcadas)
  if (!areas.length || drag || !cur || tab !== 'blur') return null;
  const r = +$('rad').value, key = [cur.i, cur.blurs.length, r, ...areas.map(a => [a.x | 0, a.y | 0, a.w | 0, a.h | 0])].join();
  if (!live || live.key !== key) {
    const d = new ImageData(new Uint8ClampedArray(view(cur).data), g.W, g.H);
    for (const a of areas) GifCore.blurRegion(d.data, g.W, g.H, a.x, a.y, a.w, a.h, r);
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
  if (tab !== 'blur') return;
  for (const a of areas) {   // áreas marcadas: tracejado preto e branco (a ativa também ganha as alças)
    ctx.setLineDash([]); ctx.lineWidth = Math.max(1, 3 * u); ctx.strokeStyle = '#000'; ctx.strokeRect(a.x, a.y, a.w, a.h);
    ctx.lineWidth = Math.max(1, 2 * u); ctx.setLineDash([7 * u, 5 * u]); ctx.strokeStyle = a === rect ? '#fff' : '#cfe0ff'; ctx.strokeRect(a.x, a.y, a.w, a.h);
  }
  if (rect) {
    ctx.setLineDash([]); ctx.strokeStyle = '#1763d9'; ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(1, 2 * u);
    const s = 10 * u;
    for (const [hx, hy] of [[0, 0], [.5, 0], [1, 0], [0, .5], [1, .5], [0, 1], [.5, 1], [1, 1]]) {
      const x = rect.x + rect.w * hx - s / 2, y = rect.y + rect.h * hy - s / 2;
      ctx.fillRect(x, y, s, s); ctx.strokeRect(x, y, s, s);
    }
  }
}
// resolução, fps, frames, duração e tamanho do GIF que está aberto (acompanha as edições)
function infoText() {
  const n = frames.length, ms = frames.reduce((a, f) => a + dur(f), 0);
  const fps = ms ? n / (ms / 1000) : 0, f1 = v => v.toFixed(1).replace('.', ',').replace(/,0$/, '');
  let t = `${g.W} × ${g.H} px · ${f1(fps)} fps · ${fromVideo ? 'convertido' : 'original'}: ${kb(srcBytes.length)}`;   // frames e duração ficam na linha do tempo
  if (savedSize && !dirty) t += ` · salvo: ${kb(savedSize)}`;
  return t;
}
// dica sobre a imagem: só enquanto ainda não há área marcada na aba "Borrar"
function hintText() {
  return tab === 'blur' && !areas.length ? 'Arraste sobre a imagem para marcar o que quer borrar' : '';
}
function updateUI() {
  const has = !!g, n = frames.length, i = frames.indexOf(cur);
  $('welcome').hidden = has; $('editor').hidden = !has; $('edActs').hidden = !has; document.body.classList.toggle('ed', has); $('openAgain').hidden = !has; $('recAgain').hidden = !has;
  $('dirty').hidden = !(has && dirty);
  if (!has) return;
  { const h = hintText(); $('hint').textContent = h; $('hint').hidden = !h; } $('ginfo').textContent = infoText();
  $('undo').disabled = !undoSt.length; $('redo').disabled = !redoSt.length;
  $('prev').disabled = i < 1; $('next').disabled = i >= n - 1;
  const na = areas.length;
  $('blur').disabled = !na; $('blurt').textContent = na > 1 ? `Borrar as ${na} áreas` : 'Borrar esta área';
  $('rinfo').textContent = !na ? 'Nenhuma área marcada' : na === 1 ? `1 área: ${Math.round(areas[0].w)} × ${Math.round(areas[0].h)}` : `${na} áreas marcadas`;
  $('clr').hidden = !na;
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

