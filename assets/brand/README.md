# Tiago Ismar — T da Ibiapaba

O topo da chapada desenha a barra do T e desce à direita como uma escarpa. A haste da inicial termina em diagonal, acompanhando o relevo. Uma segunda encosta aparece do outro lado do vale transparente.

É um desenho original inspirado na Ibiapaba, não um símbolo oficial da região, representação cartográfica ou reprodução de uma fotografia. O nome Tiago Ismar permanece na assinatura horizontal.

## Referências de forma

- Panorâmica de Ubajara já utilizada no site, em `assets/cidades/ubajara.webp`: observação do topo longo, escarpa e vale, sem traçado da fotografia.
- [Plano de Manejo do Parque Nacional de Ubajara — ICMBio](https://www.gov.br/icmbio/pt-br/assuntos/biodiversidade/unidade-de-conservacao/unidades-de-biomas/caatinga/lista-de-ucs/parna-de-ubajara/arquivos/plano-de-manejo-parna-ubajara.pdf): contexto da chapada, escarpas e paisagens serranas.

## Entregáveis

- `tiago-ismar-symbol.svg` / `.png`: símbolo floresta, fundo transparente.
- `tiago-ismar-symbol-lime.svg` / `.png`: símbolo lima, fundo transparente.
- `tiago-ismar-logo-forest.svg` / `.png`: assinatura horizontal para fundos claros.
- `tiago-ismar-logo-light.svg` / `.png`: assinatura horizontal para fundos escuros.
- `../personal-favicon.svg`: aplicação compacta para a aba do navegador.

Os PNGs do símbolo têm 1200 × 1200 px; as assinaturas têm 2400 × 506 px. O fundo e o vale são transparentes. Os SVGs usam curvas vetoriais, sem fontes, máscaras, imagens externas ou filtros.

## Uso

- Floresta: `#13231b`
- Papel: `#eeeee5`
- Lima: `#d5eb64`

Preservar as proporções e o espaço entre as duas formas. Preferir o símbolo com 24 px ou mais; a silhueta simplificada permite uso compacto no favicon. A assinatura horizontal é indicada a partir de 150 px de largura. A marca funciona em uma única tinta; evitar sombras, volume e linhas adicionais no vale.

Os viewBoxes permanecem `0 0 588 124` para a assinatura e `0 0 120 120` para o símbolo, preservando a integração no site.

## Reconstrução

`wordmark-outlines.json` preserva as curvas do nome. Para reconstruir os SVGs e o favicon:

```sh
node assets/brand/build-brand.mjs
```

Para exportar também os PNGs transparentes:

```powershell
node assets/brand/build-brand.mjs --sharp-root 'C:/Users/const/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
```
