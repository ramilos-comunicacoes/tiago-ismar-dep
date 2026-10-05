# Tiago Ismar — Horizonte aberto · v4

A marca parte de um **T maiúsculo** de barra reta e haste vertical. Dentro da barra, um recorte transparente desenha a subida da encosta, um pequeno platô, o vale e um segundo relevo. A paisagem é uma interpretação abstrata da serra, sem representar um ponto geográfico específico.

A letra mantém sua estrutura e a linha de serra tem curvas assimétricas. O símbolo utiliza dois contornos preenchidos, sem moldura, seta, escudo ou efeitos de volume. As versões clara e escura foram inspecionadas em 16, 24 e 32 px; a aplicação de 24 px ou mais preserva melhor a leitura do recorte.

## Entregáveis

- `tiago-ismar-symbol.svg` / `.png`: símbolo floresta, fundo transparente.
- `tiago-ismar-symbol-lime.svg` / `.png`: símbolo lima, fundo transparente.
- `tiago-ismar-logo-forest.svg` / `.png`: assinatura horizontal para fundos claros.
- `tiago-ismar-logo-light.svg` / `.png`: assinatura horizontal para fundos escuros.
- `../personal-favicon.svg`: aplicação compacta para a aba do navegador.

Os PNGs do símbolo têm 1200 × 1200 px; as assinaturas têm 2400 × 506 px. O fundo e o recorte da serra são transparentes. Os SVGs mantêm a tipografia em curvas e não carregam fontes, máscaras ou imagens externas.

## Uso

- Floresta: `#13231b`
- Papel: `#eeeee5`
- Lima: `#d5eb64`

Preservar as proporções. Usar a assinatura horizontal a partir de 150 px de largura. Preferir o símbolo com pelo menos 24 px, reservando 16 px para aplicações compactas como favicon. Evitar contornos extras, sombras ou efeitos de volume. A marca também pode ser aplicada em uma única tinta.

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
