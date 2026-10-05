# Tiago Ismar — Curvas de nível

O monograma reúne as iniciais **T** e **I** em uma construção própria. Três faixas horizontais se curvam e seguem pela haste do T, como curvas de nível. O corte ascendente no I continua esse movimento.

A referência à Ibiapaba está na topografia que constrói as letras. O símbolo não depende de uma ilustração de montanha e permanece legível em uma cor, inclusive em aplicação pequena ou sobre tecido.

## Entregáveis

- `tiago-ismar-symbol.svg` / `.png`: símbolo floresta, fundo transparente.
- `tiago-ismar-symbol-lime.svg` / `.png`: símbolo lima, fundo transparente.
- `tiago-ismar-logo-forest.svg` / `.png`: assinatura horizontal para fundos claros.
- `tiago-ismar-logo-light.svg` / `.png`: assinatura horizontal para fundos escuros.
- `../personal-favicon.svg`: aplicação compacta para a aba do navegador.

Os PNGs do símbolo têm 1200 × 1200 px; as assinaturas têm 2400 × 506 px. Os SVGs são inteiramente vetoriais: tipografia em curvas, vazados transparentes e nenhuma fonte, máscara ou imagem externa.

## Uso

- Floresta: `#13231b`
- Papel: `#eeeee5`
- Lima: `#d5eb64`

Preservar as proporções. Usar a assinatura horizontal a partir de 150 px de largura e o símbolo a partir de 32 px. Evitar contornos extras, sombras ou efeitos de volume. A marca funciona em impressão monocromática.

## Reconstrução

`wordmark-outlines.json` preserva as curvas da assinatura condensada. Não redistribui arquivos de fonte. Para reconstruir os SVGs e o favicon, basta Node.js:

```sh
node assets/brand/build-brand.mjs
```

Para reconstruir também os PNGs transparentes, informar o diretório de pacotes do runtime que contém `sharp`:

```powershell
node assets/brand/build-brand.mjs --sharp-root 'C:/Users/const/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
```
