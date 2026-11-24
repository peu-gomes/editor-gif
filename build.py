#!/usr/bin/env python3
"""Gera dist/editor-gif.html (arquivo único, offline) a partir de src/.

Uso:  python build.py

O CSP da página libera o <script> e o <style> por hash SHA-256; por isso o
hash é recalculado aqui a cada build. Nunca edite o arquivo de dist/ à mão.
"""
import base64, hashlib, pathlib

RAIZ = pathlib.Path(__file__).parent
SRC = RAIZ / "src"


def ler(p):
    return p.read_text(encoding="utf8").replace("\r\n", "\n")


def sha256(texto):
    return "sha256-" + base64.b64encode(hashlib.sha256(texto.encode("utf8")).digest()).decode()


def main():
    versao = ler(RAIZ / "VERSION").strip()
    estilo = ler(SRC / "styles.css")
    ordem = [n for n in ler(SRC / "js" / "ORDEM.txt").split("\n") if n.strip()]
    script = "".join(ler(SRC / "js" / f"{n}.js") for n in ordem)
    csp = ("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; "
           f"script-src '{sha256(script)}'; style-src '{sha256(estilo)}'; "
           "img-src blob: data:; media-src blob:; base-uri 'none'; form-action 'none'\">")
    html = ler(SRC / "index.html").replace("{{VERSION}}", versao)
    for chave, valor in (("{{CSP}}", csp), ("{{STYLE}}", estilo), ("{{SCRIPT}}", script)):
        assert html.count(chave) == 1, chave
        html = html.replace(chave, valor)
    saida = RAIZ / "dist" / "editor-gif.html"
    saida.parent.mkdir(exist_ok=True)
    saida.write_text(html, encoding="utf8", newline="\n")
    print(f"OK: {saida.relative_to(RAIZ)} ({len(html.encode('utf8')) / 1024:.1f} KB, v{versao})")


if __name__ == "__main__":
    main()
