# Editor de GIF

Editor de GIF offline em um único arquivo HTML: borrar dados pessoais, apagar frames, converter vídeo em GIF e gravar a tela.

**Para usar:** abra `dist/editor-gif.html` no Chrome.

## Desenvolvimento

O código fica em `src/`; o arquivo final é gerado por:

```
python build.py
```

- `src/index.html`: esqueleto da página (com `{{CSP}}`, `{{STYLE}}`, `{{SCRIPT}}`, `{{VERSION}}`)
- `src/styles.css`: estilos
- `src/js/`: módulos, juntados na ordem de `src/js/ORDEM.txt` (scripts simples, sem `import`)
- `VERSION`: número da versão

O CSP da página libera script e estilo por hash SHA-256, recalculado pelo `build.py`.
**Nunca edite `dist/` à mão:** o navegador bloquearia o código.
