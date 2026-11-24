const help = $('help');
const openHelp = () => help.open ? help.close() : help.showModal();
const click = (id, fn) => $(id).onclick = fn;
click('play', togglePlay); click('prev', () => step(-1)); click('next', () => step(1));
click('del', doDel); click('keep', doKeep); click('before', doBefore); click('after', doAfter);
click('undo', undo); click('redo', redo); click('blur', doBlur); click('unblur', doUnblur); click('exp', doExport);
click('all', markAll); click('none', markNone); click('inv', invert); click('full', fullArea);
click('selB', markBefore); click('selA', markAfter); click('rsel', markRange);
click('recStart', startRecording); click('recAgain', startRecording);
click('recStop', () => stopRecording(false)); click('recCancel', () => stopRecording(true));
for (const id of ['rfrom', 'rto']) $(id).onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); markRange(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); releaseFocus(); }   // sai da caixinha sem limpar a marcação
};
// desenhinhos dos botões de apagar: . frame comum, x sai, k fica, c é o frame atual
(function drawIcons() {
  const NS = 'http://www.w3.org/2000/svg', mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  for (const box of document.querySelectorAll('.ico[data-k]')) {
    const svg = mk('svg', { viewBox: '0 0 62 26', 'aria-hidden': 'true' });
    [...box.dataset.k].forEach((ch, n) => {
      const x = 2 + n * 12;
      svg.appendChild(mk('rect', { x, y: 4, width: 9, height: 18, rx: 2.5, class: ch === 'x' ? 'x' : ch === 'k' ? 'k' : ch === 'c' ? 'c' : 'f' }));
      if (ch === 'x') svg.appendChild(mk('path', { d: `M${x + 1.8} 9.5l5.4 7M${x + 7.2} 9.5l-5.4 7`, class: 'xm' }));
    });
    box.appendChild(svg);
  }
})();
click('tabBlur', () => setTab('blur')); click('tabCut', () => setTab('cut'));
click('helpb', openHelp); click('helpx', () => help.close());
help.addEventListener('click', e => { if (e.target === help) help.close(); });
$('rad').oninput = () => { live = null; redraw(); };
$('zoom').oninput = e => document.documentElement.style.setProperty('--th', e.target.value + 'px');
for (const r of document.querySelectorAll('input[name=scope]')) r.onchange = () => redraw();
window.addEventListener('resize', redraw);

window.addEventListener('keydown', e => {
  const t = e.target, k = e.key, K = k.length === 1 ? k.toLowerCase() : k, ctrl = e.ctrlKey || e.metaKey;
  if (help.open || $('result').open || loading) return;
  if (!ctrl && (t.tagName === 'SELECT' || t.tagName === 'INPUT')) return;   // não atrapalhar menus e controles
  if (K === '?' || k === 'F1') { e.preventDefault(); openHelp(); return; }
  if (ctrl && K === 'o') { e.preventDefault(); $('file').click(); return; }
  if (!g) return;
  if (k === ' ') { if (t.tagName === 'BUTTON') return; e.preventDefault(); togglePlay(); }
  else if (ctrl && K === 's') { e.preventDefault(); doExport(); }
  else if (ctrl && K === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (K === 'y' || (K === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (ctrl && K === 'a') { e.preventDefault(); markAll(); }
  else if (ctrl && K === 'i') { e.preventDefault(); invert(); }
  else if (ctrl) return;
  else if (e.altKey && k.startsWith('Arrow')) {
    e.preventDefault(); const s = e.shiftKey ? 10 : 1;
    nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
  }
  else if (k === 'Delete') { e.preventDefault(); sel.size ? doDel() : removeFrames(new Set([cur])); }
  else if (k === 'Enter') { if (t.tagName === 'BUTTON') return; e.preventDefault(); if (tab === 'blur') doBlur(); }   // na aba "Apagar frames" a área do borrão está escondida: não borra às cegas
  else if (K === 'b') { if (tab === 'blur') doBlur(); }
  else if (K === 'u') { if (tab === 'blur') doUnblur(); }
  else if (K === 'f') fullArea();
  else if (k === '[') doBefore();
  else if (k === ']') doAfter();
  else if (k === '+' || k === '=') setRadius(+$('rad').value + 1);
  else if (k === '-' || k === '_') setRadius(+$('rad').value - 1);
  else if (k === 'Escape') { rect = null; sel = new Set(); refresh(); }
  else if (k === 'ArrowRight') { e.preventDefault(); go(1, e.shiftKey); }
  else if (k === 'ArrowLeft') { e.preventDefault(); go(-1, e.shiftKey); }
  else if (k === 'Home') { e.preventDefault(); go(-1e9, e.shiftKey); }
  else if (k === 'End') { e.preventDefault(); go(1e9, e.shiftKey); }
  else if (k === 'PageUp') { e.preventDefault(); go(-10, e.shiftKey); }
  else if (k === 'PageDown') { e.preventDefault(); go(10, e.shiftKey); }
});

// Depois de clicar com o mouse, o foco NÃO fica no botão/opção: assim Espaço, Enter e as setas do teclado
// valem para o editor (assistir, borrar, mudar de frame...) e não apertam de novo o último botão clicado.
// (Quem usa Tab no teclado continua com o foco normal: o clique feito pelo teclado tem detail = 0.)
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b && e.detail > 0) b.blur();
});
document.addEventListener('change', e => {
  if (e.target.matches('select, input[type=checkbox], input[type=radio], input[type=range]')) e.target.blur();
});
{ const th = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--th'), 10); if (th) $('zoom').value = th; }   // o controle de tamanho dos frames começa no valor que o CSS usa
updateUI();
