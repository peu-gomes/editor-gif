// ---------- áreas do borrão (criar, mover, redimensionar; várias de uma vez) ----------
// areas = todas as áreas marcadas; rect = a área ativa (a que tem as alças e é movida pelo teclado)
const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * g.W / r.width, y: (e.clientY - r.top) * g.H / r.height }; };
function hitOne(a, p, touch) {
  // borda pega até 10 px da tela por dentro, mas só 5 px por fora (assim dá para desenhar outra área bem ao lado)
  const s = g.W / cv.getBoundingClientRect().width, t = (touch ? 20 : 10) * s, o = (touch ? 12 : 5) * s, { x, y, w, h } = a;
  if (!(p.x > x - o && p.x < x + w + o && p.y > y - o && p.y < y + h + o)) return null;
  let m = '';
  if (Math.abs(p.y - y) < t) m += 'n'; else if (Math.abs(p.y - (y + h)) < t) m += 's';
  if (Math.abs(p.x - x) < t) m += 'w'; else if (Math.abs(p.x - (x + w)) < t) m += 'e';
  if (m) return m;
  return (p.x > x && p.x < x + w && p.y > y && p.y < y + h) ? 'move' : null;
}
// a área ativa tem prioridade (bordas e alças); nas outras, clicar dentro escolhe e move
function hit(p, touch) {
  if (rect) { const m = hitOne(rect, p, touch); if (m) return { a: rect, m }; }
  for (let k = areas.length - 1; k >= 0; k--) if (areas[k] !== rect && hitOne(areas[k], p, false) === 'move') return { a: areas[k], m: 'move' };
  return null;
}
function dropArea(a) { areas = areas.filter(x => x !== a); if (rect === a) rect = areas[areas.length - 1] || null; live = null; }
function clearAreas() { areas = []; rect = null; live = null; }
const CUR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' };
cv.addEventListener('pointerdown', e => {
  if (!g || tab !== 'blur' || e.button !== 0) return;
  if (playing) togglePlay();
  cv.setPointerCapture(e.pointerId);
  const p = pos(e), h = hit(p, e.pointerType === 'touch');
  if (h) { rect = h.a; drag = { m: h.m, start: p, orig: { ...rect } }; }
  else { rect = { x: p.x, y: p.y, w: 0, h: 0 }; areas.push(rect); drag = { m: 'new', start: p }; }
  live = null; redraw();
});
cv.addEventListener('pointermove', e => {
  if (!g || tab !== 'blur') return; const p = pos(e);
  if (!drag) { const h = hit(p, e.pointerType === 'touch'); cv.style.cursor = (h && CUR[h.m]) || 'crosshair'; return; }
  const d = drag;
  if (d.m === 'new') {
    const x = clamp(Math.min(d.start.x, p.x), 0, g.W), y = clamp(Math.min(d.start.y, p.y), 0, g.H);
    Object.assign(rect, { x, y, w: clamp(Math.max(d.start.x, p.x), 0, g.W) - x, h: clamp(Math.max(d.start.y, p.y), 0, g.H) - y });
  } else if (d.m === 'move') {
    Object.assign(rect, { x: clamp(d.orig.x + p.x - d.start.x, 0, g.W - d.orig.w), y: clamp(d.orig.y + p.y - d.start.y, 0, g.H - d.orig.h) });
  } else {
    let l = d.orig.x, t = d.orig.y, r = l + d.orig.w, b = t + d.orig.h;
    if (d.m.includes('w')) l = Math.min(clamp(p.x, 0, g.W), r - 4);
    if (d.m.includes('e')) r = Math.max(clamp(p.x, 0, g.W), l + 4);
    if (d.m.includes('n')) t = Math.min(clamp(p.y, 0, g.H), b - 4);
    if (d.m.includes('s')) b = Math.max(clamp(p.y, 0, g.H), t + 4);
    Object.assign(rect, { x: l, y: t, w: r - l, h: b - t });
  }
  live = null; redraw();
});
const endDrag = () => { if (!drag) return; drag = null; if (rect && (rect.w < 3 || rect.h < 3)) dropArea(rect); live = null; redraw(); };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

// ---------- zoom da visualização ----------
// zoomFit = a imagem inteira cabe na área (nunca aumenta além de 100%); senão, zoom fixo e a área rola.
const stage = $('stage'), ZSTEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
let zoom = 1, zoomFit = true;
const narrow = matchMedia('(max-width: 900px)');
function fitScale() {
  const cs = getComputedStyle(stage), pw = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), ph = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  cv.style.width = cv.style.height = '0px';   // mede a área sem a imagem (sem barras de rolagem)
  const w = stage.clientWidth - pw, h = narrow.matches ? innerHeight * 0.6 : stage.clientHeight - ph;
  return Math.max(0.05, Math.min(1, w / g.W, h / g.H));
}
function curZoom() { return zoomFit ? fitScale() : zoom; }
function applyZoom() {
  if (!g) return;
  const z = zoomFit ? fitScale() : zoom;
  cv.style.width = g.W * z + 'px'; cv.style.height = g.H * z + 'px';
  cv.classList.toggle('px', z >= 2);   // de perto, mostra os pixels de verdade (para marcar com precisão)
  stage.classList.toggle('zoomed', stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1);
  $('zlv').textContent = Math.round(z * 100) + '%';
  $('zfit').disabled = zoomFit; $('z100').disabled = !zoomFit && zoom === 1;
  $('zin').disabled = z >= ZSTEPS[ZSTEPS.length - 1]; $('zout').disabled = z <= ZSTEPS[0];
  redraw();
}
// muda o zoom mantendo parado o ponto da imagem sob (cx, cy); sem ponto, usa o centro da área
function setZoom(z, cx, cy) {
  if (!g) return;
  const sr = stage.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const r = cv.getBoundingClientRect(), fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
  zoom = clamp(z, ZSTEPS[0], ZSTEPS[ZSTEPS.length - 1]); zoomFit = false;
  applyZoom();
  const r2 = cv.getBoundingClientRect();
  stage.scrollLeft += r2.left + fx * r2.width - cx; stage.scrollTop += r2.top + fy * r2.height - cy;
}
function zoomStep(dir, cx, cy) {
  const z = curZoom(), next = dir > 0 ? ZSTEPS.find(s => s > z + 1e-3) : [...ZSTEPS].reverse().find(s => s < z - 1e-3);
  if (next) setZoom(next, cx, cy);
}
function zoomToFit() { zoomFit = true; applyZoom(); }
$('zin').onclick = () => zoomStep(1); $('zout').onclick = () => zoomStep(-1); $('zfit').onclick = zoomToFit; $('z100').onclick = () => setZoom(1);
stage.addEventListener('wheel', e => {   // Ctrl + roda = zoom no ponto do mouse; só a roda = rola a imagem ampliada
  if (!g || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
}, { passive: false });
// arrastar para mover a imagem ampliada: botão do meio, ou botão esquerdo fora da imagem / na aba "Apagar frames"
let pan = null;
stage.addEventListener('pointerdown', e => {
  if (!g || !stage.classList.contains('zoomed')) return;
  if (!(e.button === 1 || (e.button === 0 && (e.target !== cv || tab !== 'blur')))) return;
  e.preventDefault(); stage.setPointerCapture(e.pointerId);
  pan = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.classList.add('panning');
});
stage.addEventListener('pointermove', e => { if (pan) { stage.scrollLeft = pan.l - (e.clientX - pan.x); stage.scrollTop = pan.t - (e.clientY - pan.y); } });
const endPan = () => { pan = null; stage.classList.remove('panning'); };
stage.addEventListener('pointerup', endPan); stage.addEventListener('pointercancel', endPan);
new ResizeObserver(() => { if (g && zoomFit) applyZoom(); }).observe(stage);
