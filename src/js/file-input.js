$('file').onchange = e => { const l = [...e.target.files]; e.target.value = ''; loadFiles(l); };
$('pick').onclick = () => $('file').click();
$('openAgain').onclick = () => $('file').click();
window.addEventListener('dragover', e => { e.preventDefault(); $('welcome').classList.add('drop'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) $('welcome').classList.remove('drop'); });
window.addEventListener('drop', e => {
  e.preventDefault(); $('welcome').classList.remove('drop');
  const files = [...e.dataTransfer.files];
  files.length ? loadFiles(files) : showResult('Nenhum arquivo recebido', ['Solte um arquivo GIF ou um vídeo (MP4, WebM).'], 'err');
});
window.addEventListener('beforeunload', e => { if (dirty || recWait) { e.preventDefault(); e.returnValue = ''; } });

