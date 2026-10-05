# Workflow deste site

- Ao concluir cada alteração, validar o site no desktop e no celular, revisar o diff e verificar os arquivos/referências. Depois fazer commit e push para `main` no GitHub; somente após confirmar o push, publicar esse mesmo SHA em produção. Essa sequência foi solicitada pelo usuário.
- Repositório: `ramilos-comunicacoes/tiago-ismar-dep`. Produção: `https://tiagoismar.com`, VPS Hostinger `1764760`, IP `187.77.60.248`, Ubuntu 24.04. O acesso existente é pelo console web autenticado da Hostinger; não guardar senhas, tokens ou chaves no repositório.
- Nginx já usa `/var/www/tiagoismar.com/current`, um symlink para uma release em `/var/www/tiagoismar.com/releases`. Executar o script revisado `scripts/deploy-release.py --commit SHA_COMPLETO` com Python 3 na VPS. Ele baixa o commit fixado, publica somente arquivos estáticos, valida referências e troca o symlink atomicamente. Releases existentes nunca são sobrescritas ou apagadas.
- O script registra a release anterior e o comando de rollback em `/var/www/tiagoismar.com/previous-release.txt`, fora da raiz pública. Confirmar o destino atual antes de um rollback. Conservar a release anterior.
- Após publicar, verificar HTTPS, página, recursos e versão no domínio real. Só informar sucesso depois da verificação. Se GitHub ou produção falhar, explicar exatamente qual etapa falta; não afirmar publicação sem evidência.
- Não alterar SSH, Docker, Nginx, SSL, DNS, firewall ou outros aplicativos sem nova autorização específica. Publicar arquivos estáticos não requer reiniciar ou recarregar Nginx.

## Prioridade mobile

- O celular é a experiência principal. Escrever os estilos base para telas pequenas e ampliar com `min-width`; evitar correções sucessivas de um layout desktop.
- Validar 320, 390 e 430 px, tablet e desktop. Incluir celular em orientação horizontal, títulos, menu, galeria, diálogo e rodapé. Não aceitar texto cortado, sobreposição ou rolagem lateral da página; a galeria pode rolar dentro de seu próprio contêiner.
- Textos de leitura com pelo menos 15 px no celular, controles com área de toque mínima de 44 × 44 px, margens seguras e respeito às áreas reservadas do dispositivo. Menu precisa permanecer rolável em telas baixas.
- Animações devem acompanhar a rolagem nativa, funcionar por toque e respeitar `prefers-reduced-motion`. Não recolocar botão para pausar animações: o usuário pediu sua remoção.
- Manter fotos reais fornecidas pelo usuário. Não substituir o rosto por retratos gerados.
- Ocultar visualmente as barras de rolagem, preservando rolagem nativa por toque, mouse e teclado. Não usar `overflow:hidden` na página para esconder a barra.
