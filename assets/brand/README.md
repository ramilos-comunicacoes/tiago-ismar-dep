# Tiago Ismar — T e serra em movimento

A letra **T** é a própria marca. Sua barra superior forma uma serra ondulante, desenhada em um único contorno fluido. A haste central mantém a leitura imediata da inicial, enquanto a linha da serra traz a referência ao território.

A solução tem poucos elementos, terminações suaves e não depende de detalhes pequenos. Foi conferida em 16 e 24 px, em uma cor e em fundo escuro.

## Entregáveis

- `tiago-ismar-symbol.svg` / `.png`: símbolo floresta, fundo transparente.
- `tiago-ismar-symbol-lime.svg` / `.png`: símbolo lima, fundo transparente.
- `tiago-ismar-logo-forest.svg` / `.png`: assinatura horizontal para fundos claros.
- `tiago-ismar-logo-light.svg` / `.png`: assinatura horizontal para fundos escuros.
- `../personal-favicon.svg`: aplicação compacta para a aba do navegador.

Os PNGs do símbolo têm 1200 × 1200 px; as assinaturas têm 2400 × 506 px. O símbolo usa um único contorno vetorial. Os SVGs mantêm a tipografia em curvas e não carregam fontes, máscaras ou imagens externas.

## Uso

- Floresta: `#13231b`
- Papel: `#eeeee5`
- Lima: `#d5eb64`

Preservar as proporções. Usar a assinatura horizontal a partir de 150 px de largura. O símbolo funciona a partir de 16 px; preferir 24 px ou mais quando houver espaço. Evitar contornos extras, sombras ou efeitos de volume. A marca funciona em impressão monocromática.

A assinatura mantém o viewBox `0 0 588 124` e o símbolo mantém `0 0 120 120` para preservar a integração existente.

## Reconstrução

`wordmark-outlines.json` preserva as curvas da assinatura condensada. Não redistribui arquivos de fonte. Para reconstruir os SVGs e o favicon, basta Node.js:

```sh
node assets/brand/build-brand.mjs
```

Para reconstruir também os PNGs transparentes, informar o diretório de pacotes do runtime que contém `sharp`:

```powershell
node assets/brand/build-brand.mjs --sharp-root 'C:/Users/const/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
```
