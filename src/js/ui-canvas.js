// ---------- retângulo do borrão (criar, mover, redimensionar) ----------
const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * g.W / r.width, y: (e.clientY - r.top) * g.H / r.height }; };
function hit(p, touch) {
  if (!rect) return null;
  const t = (touch ? 22 : 12) * g.W / cv.getBoundingClientRect().width, { x, y, w, h } = rect;
  if (!(p.x > x - t && p.x < x + w + t && p.y > y - t && p.y < y + h + t)) return null;
  let m = '';
  if (Math.abs(p.y - y) < t) m += 'n'; else if (Math.abs(p.y - (y + h)) < t) m += 's';
  if (Math.abs(p.x - x) < t) m += 'w'; else if (Math.abs(p.x - (x + w)) < t) m += 'e';
  if (m) return m;
  return (p.x > x && p.x < x + w && p.y > y && p.y < y + h) ? 'move' : null;
}
const CUR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' };
cv.addEventListener('pointerdown', e => {
  if (!g || tab !== 'blur') return;
  if (playing) togglePlay();
  cv.setPointerCapture(e.pointerId);
  const p = pos(e), m = hit(p, e.pointerType === 'touch');
  drag = m ? { m, start: p, orig: { ...rect } } : { m: 'new', start: p };
  if (!m) rect = null;
  live = null;
});
cv.addEventListener('pointermove', e => {
  if (!g || tab !== 'blur') return; const p = pos(e);
  if (!drag) { cv.style.cursor = CUR[hit(p, e.pointerType === 'touch')] || 'crosshair'; return; }
  const d = drag;
  if (d.m === 'new') {
    const x = clamp(Math.min(d.start.x, p.x), 0, g.W), y = clamp(Math.min(d.start.y, p.y), 0, g.H);
    rect = { x, y, w: clamp(Math.max(d.start.x, p.x), 0, g.W) - x, h: clamp(Math.max(d.start.y, p.y), 0, g.H) - y };
  } else if (d.m === 'move') {
    rect = { ...d.orig, x: clamp(d.orig.x + p.x - d.start.x, 0, g.W - d.orig.w), y: clamp(d.orig.y + p.y - d.start.y, 0, g.H - d.orig.h) };
  } else {
    let l = d.orig.x, t = d.orig.y, r = l + d.orig.w, b = t + d.orig.h;
    if (d.m.includes('w')) l = Math.min(clamp(p.x, 0, g.W), r - 4);
    if (d.m.includes('e')) r = Math.max(clamp(p.x, 0, g.W), l + 4);
    if (d.m.includes('n')) t = Math.min(clamp(p.y, 0, g.H), b - 4);
    if (d.m.includes('s')) b = Math.max(clamp(p.y, 0, g.H), t + 4);
    rect = { x: l, y: t, w: r - l, h: b - t };
  }
  redraw();
});
const endDrag = () => { if (!drag) return; drag = null; if (rect && (rect.w < 3 || rect.h < 3)) rect = null; live = null; redraw(); };
cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

