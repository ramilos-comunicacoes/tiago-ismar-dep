# Tiago Ismar — Serra e caminho

Uma chapada de topo horizontal representa a Serra da Ibiapaba. O recorte transparente desenha um caminho que atravessa a marca. Dois patamares no contorno sugerem a escarpa, com uma silhueta simples que continua legível em tamanhos pequenos.

A assinatura usa letras condensadas e firmes, alinhadas à direção editorial do site. A tipografia foi convertida em curvas: os SVGs entregues não carregam fontes ou recursos externos.

## Arquivos

- `tiago-ismar-symbol.svg`: símbolo monocromático verde floresta, fundo transparente.
- `tiago-ismar-symbol-lime.svg`: símbolo monocromático lima, fundo transparente.
- `tiago-ismar-logo-forest.svg`: assinatura horizontal monocromática para fundos claros.
- `tiago-ismar-logo-light.svg`: símbolo lima e assinatura clara para fundos escuros.
- `../personal-favicon.svg`: aplicação compacta do símbolo para a aba do navegador.

## Cores

- Floresta: `#13231b`
- Papel: `#eeeee5`
- Lima: `#d5eb64`

Preservar as proporções, sem contorno adicional, sombras ou efeitos de volume. Usar a assinatura horizontal a partir de 150 px de largura e o símbolo isolado a partir de 24 px. Deixar uma margem livre mínima equivalente à largura do caminho na base.

## Fonte vetorial e reconstrução

`wordmark-outlines.json` preserva as curvas da assinatura, derivadas da fonte local Bahnschrift SemiBold SemiConden. Não distribui o arquivo da fonte. `build-brand.mjs` reconstrói os SVGs e o favicon usando apenas Node.js:

```sh
node assets/brand/build-brand.mjs
```

Não é necessário instalar pacotes ou fontes para reconstruir os entregáveis.
