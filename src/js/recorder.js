// ---------- gravar a tela ----------
// Usa o próprio navegador (getDisplayMedia + MediaRecorder): nada para instalar e nada sai do computador.
// Grava em WebM (Chrome/Chromium e Firefox, inclusive no Linux) e entrega ao mesmo caminho do vídeo:
// vira GIF (com as "Opções para vídeos") e abre no editor. Se algo falhar, a gravação é baixada como vídeo.
let rec = null, recMaxS = 300, recCount = 3;
const baseTitle = document.title;
const recSupported = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
// Qual formato gravar. H.264 primeiro: é o que gravadores externos usam, dá GIF bem menor (o VP9 em tempo real deixa "ruído" nos frames
// parados, que o conversor conta como mudança) e converte mais rápido. Sem H.264 (Chromium/Firefox no Linux), cai para VP9/VP8 com bitrate alto.
// "play" é um tipo equivalente só para saber se o navegador consegue TOCAR o que gravou (canPlayType de webm+h264 responde vazio mesmo tocando).
const REC_TYPES = [
  { rec: 'video/webm;codecs=h264', play: 'video/mp4;codecs="avc1.42E01E"', bps: 12e6 },
  { rec: 'video/mp4;codecs=avc1', play: 'video/mp4;codecs="avc1.42E01E"', bps: 12e6 },
  { rec: 'video/webm;codecs=vp9', play: 'video/webm;codecs=vp9', bps: 20e6 },
  { rec: 'video/webm;codecs=vp8', play: 'video/webm;codecs=vp8', bps: 20e6 },
  { rec: 'video/webm', play: 'video/webm', bps: 20e6 }];
const recPick = () => { const v = document.createElement('video'); return REC_TYPES.find(t => MediaRecorder.isTypeSupported(t.rec) && v.canPlayType(t.play)) || null; };
let recWait = false;   // gravação pronta, esperando a pessoa voltar para esta aba
const mmss = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function recUI(text, running) {   // barra de gravação (some quando text é vazio)
  $('recbar').hidden = !text; if (text) $('rect').textContent = text;
  $('recStop').hidden = !running; $('recStart').disabled = $('recAgain').disabled = !!text;
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function recErr(err) {
  const n = (err && err.name) || '';
  return n === 'NotFoundError' ? 'O navegador não encontrou nenhuma tela para gravar.'
    : n === 'NotReadableError' ? 'O sistema não deixou o navegador ler a tela (outro programa pode estar usando ou bloqueando).'
    : n === 'NotSupportedError' || n === 'TypeError' ? 'Este navegador não consegue gravar a tela desse jeito.'
    : 'Erro inesperado: ' + ((err && err.message) || n);
}
async function startRecording() {
  if (rec || loading || recWait) return;
  if (!recSupported() || !recPick()) {
    showResult('Este navegador não consegue gravar a tela', [
      'Use o Google Chrome ou o Chromium (ou o Firefox) em uma versão recente, abrindo o arquivo do editor direto do computador.',
      'No Linux com Wayland, o sistema mostra uma janela própria para escolher a tela: ela precisa do serviço xdg-desktop-portal com PipeWire.'], 'err');
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, cursor: 'always' }, audio: false }); }
  catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) say('Gravação cancelada: nenhuma tela foi escolhida (ou o sistema não permitiu).');
    else showResult('Não consegui começar a gravar', [recErr(err), 'Nenhum arquivo foi criado.'], 'err');
    return;
  }
  const r = rec = { stream, type: '', mr: null, chunks: [], t0: 0, timer: 0, stopped: false, discard: false, auto: false };
  stream.getVideoTracks()[0].addEventListener('ended', () => stopRecording(false));   // botão "Parar compartilhamento" do navegador
  for (let n = recCount; n > 0; n--) {   // tempo para ir até a janela que vai gravar
    recUI(`A gravação começa em ${n}… vá para a janela que quer gravar`, false);
    await sleep(1000); if (r.stopped) return;
  }
  try {
    const pick = recPick(); r.type = pick.rec;
    r.mr = new MediaRecorder(stream, { mimeType: pick.rec, videoBitsPerSecond: pick.bps });
    r.mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
    r.mr.onstop = () => finishRecording(r);
    r.mr.onerror = () => stopRecording(true);
    r.mr.start(1000);
  } catch (err) { r.stopped = true; r.discard = true; finishRecording(r); showResult('Não consegui começar a gravar', [recErr(err), 'Nenhum arquivo foi criado.'], 'err'); return; }
  r.t0 = performance.now();
  const tick = () => {
    const s = (performance.now() - r.t0) / 1000, t = `Gravando ${mmss(s)} de ${mmss(recMaxS)}`;
    recUI(t, true); document.title = '● ' + t + ' · ' + baseTitle;
    if (s >= recMaxS) stopRecording(false, true);
  };
  tick(); r.timer = setInterval(tick, 250);
}
function stopRecording(discard, auto) {
  const r = rec; if (!r || r.stopped) return;
  r.stopped = true; r.discard = !!discard; r.auto = !!auto; clearInterval(r.timer);
  if (r.mr && r.mr.state !== 'inactive') r.mr.stop();   // o resto acontece em finishRecording (onstop)
  else finishRecording(r);
}
async function finishRecording(r) {
  if (rec !== r) return; rec = null;
  r.stream.getTracks().forEach(t => t.stop()); recUI(''); document.title = baseTitle;
  const secs = r.t0 ? (performance.now() - r.t0) / 1000 : 0;
  if (r.discard) { say('Gravação descartada. Nenhum arquivo foi criado.'); return; }
  if (!r.t0) { say('Gravação cancelada antes de começar. Nenhum arquivo foi criado.'); return; }   // parou durante a contagem
  if (!r.chunks.length || secs < 0.5) { showResult('A gravação ficou muito curta', ['Não deu para aproveitar. Grave por pelo menos 1 segundo.', 'Nenhum arquivo foi criado.'], 'warn'); return; }
  const d = new Date(), p2 = n => String(n).padStart(2, '0');
  const mime = /mp4/.test(r.type) ? 'video/mp4' : 'video/webm';
  const name = `gravacao-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
  const blob = new Blob(r.chunks, { type: mime }), file = new File([blob], name, { type: mime });
  if (document.hidden) {   // terminou com outra aba na frente: o navegador deixa uma aba escondida lenta, então espera a pessoa voltar
    recWait = true; document.title = '⏸ Gravação pronta · volte para esta aba';
    say('A gravação está pronta. Volte para esta aba para transformá-la em GIF.', 'ok');
    try { window.focus(); } catch (e) { /* o navegador não deixa uma aba puxar o foco sozinha */ }
    await new Promise(res => { const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); res(); } }; document.addEventListener('visibilitychange', f); });
    recWait = false; document.title = baseTitle;
  }
  if (dirty && !confirm('A gravação terminou.\n\nVocê tem alterações que ainda não foram salvas no editor. Abrir a gravação agora e perder essas alterações?\n\n(Se escolher Cancelar, a gravação é baixada como vídeo e o editor continua como está.)')) {
    saveBlob(blob, name);
    showResult('Gravação salva como vídeo', [`“${name}” foi baixado (${kb(blob.size)}). As alterações do editor continuam como estavam.`, 'Para transformar em GIF depois, escolha esse arquivo no editor.'], 'ok');
    return;
  }
  await loadVideo(file, true);
  const opened = !!g && srcName === baseName(name);
  if (!opened && !cancelled) {   // não virou GIF (e a pessoa não cancelou): guarda o vídeo para a gravação não ser perdida
    saveBlob(blob, name);
    const note = `A gravação foi baixada como vídeo (“${name}”, ${kb(blob.size)}) para você não perder.`;
    if ($('result').open) {
      for (const q of [...$('resB').querySelectorAll('p')]) if (/Nenhum arquivo foi baixado/.test(q.textContent)) q.remove();
      const q = document.createElement('p'); q.textContent = note; $('resB').appendChild(q);
    } else showResult('A gravação não virou GIF', [note], 'warn');
  } else if (opened && r.auto && !$('result').open) {
    showResult('Gravação encerrada no limite de tempo', [`A gravação chegou a ${mmss(recMaxS)} e foi encerrada sozinha. Tudo o que foi gravado até aí está no editor.`], 'warn');
  }
}
