const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), strip = $('strip');
let g = null, comp = null, srcBytes = null, srcName = 'gif', frames = [], sel = new Set(), cur = null, anchor = null;
let rect = null, drag = null, live = null, undoSt = [], redoSt = [], playing = null, tdrag = null;
let suppressClick = false, msgT = 0, loading = false, dirty = false, tab = 'blur', cancelled = false, fromVideo = false;
const tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');

const pl = (n, s, p) => n + ' ' + (n === 1 ? s : p);
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const fmt = ms => (ms / 1000).toFixed(2).replace('.', ',') + ' s';
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// mensagem no rodapé: kind = 'ok' (verde, fica), 'err' (vermelho, fica) ou nada (some depois de um tempo)
function say(t, kind) {
  const m = $('msg'); m.textContent = t; m.className = kind || ''; m.style.opacity = 1; clearTimeout(msgT);
  const w = $('wmsg'); w.textContent = t; w.className = kind || ''; w.hidden = !t;   // na tela inicial não há rodapé
  if (!kind) msgT = setTimeout(() => { m.style.opacity = .5; }, 6000);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// tela de espera: aparece sempre que algo está sendo feito e mostra "Pronto!" no fim
function busy(t, done) {
  const b = $('busy'); b.hidden = !t; b.classList.toggle('done', !!done);
  if (t) $('busyt').textContent = t;
  if (!done) progress(null);
  if (!t) $('busycancel').hidden = true;
}
function progress(p, txt) {
  $('busybar').hidden = p == null;
  if (p != null) $('busyfill').style.width = Math.round(p * 100) + '%';
  $('busyn').textContent = txt || '';
}
// executa fn() com a tela de espera (mínimo 0,4 s, para dar tempo de perceber). fn devolve false se não concluiu.
async function work(label, fn, doneLabel, opts) {
  if (loading) return false;
  loading = true; cancelled = false; busy(label);
  const cb = $('busycancel'); cb.hidden = !(opts && opts.cancel); cb.disabled = false;
  const t0 = performance.now(); await sleep(40);
  let res;
  try { res = await fn(); } catch (err) { busy(''); loading = false; throw err; }
  if (res === false) { busy(''); loading = false; return false; }
  const rest = 400 - (performance.now() - t0); if (rest > 0) await sleep(rest);
  if (doneLabel) { busy(doneLabel, true); await sleep(500); }
  busy(''); loading = false; return true;
}
$('busycancel').onclick = () => { cancelled = true; $('busycancel').disabled = true; $('busyt').textContent = 'Cancelando…'; };

