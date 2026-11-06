# Instalação do painel na VPS existente

O site estático continua em `/var/www/tiagoismar.com/current`. O painel usa um serviço próprio em `127.0.0.1:4180`, com código em `/opt/tiago-admin` e banco/imagens em `/var/lib/tiago-admin`. O diretório de dados nunca fica dentro de uma release pública. O Nginx encaminha somente `/admin/`, `/api/` e `/media/` ao serviço.

**Este documento prepara uma instalação; não comprova que ela foi executada.** O `AGENTS.md` exige nova autorização específica para instalar/ativar o serviço e editar/recarregar o Nginx. Apresentar os arquivos e comandos para revisão antes dessa etapa. Não modificar SSH, Docker, DNS, SSL, firewall nem outros aplicativos. A porta 4180 permanece exclusivamente no loopback; não precisa ser aberta no firewall.

## Ordem de publicação

1. Concluir testes desktop/mobile, autenticação, conteúdo e revisão de diff.
2. Fazer commit/push em `main`; confirmar o SHA completo com `git ls-remote origin refs/heads/main`.
3. Obter a autorização específica para a instalação descrita abaixo.
4. Preparar backend e painel com **esse mesmo SHA**. Criar o primeiro acesso, ativar o serviço e revisar a integração Nginx.
5. Publicar a parte estática usando `scripts/deploy-release.py --commit SHA_COMPLETO`, já revisado. O publicador estático não publica `server/`, banco, `admin/` ou este material de operação.
6. Reiniciar somente `tiago-admin` após a troca da release estática e verificar novamente a saúde. O processo resolve o destino de `TIAGO_SITE_DIR` ao iniciar; esse reinício permite validar imagens contra a release nova. Não é necessária outra recarga de Nginx.
7. Verificar o domínio HTTPS, painel, dados, imagens e versão. Só então informar conclusão.

O painel não tem senha padrão. A conta do painel é independente de `root`/SSH. Senhas são digitadas interativamente no console por `getpass`; nunca entram em argumentos de comando, Git, arquivos de configuração ou mensagens.

## Conferência inicial, somente leitura

No console da VPS:

```bash
python3 --version
readlink -f /var/www/tiagoismar.com/current
ss -ltnp '( sport = :4180 )'
getent passwd tiago-admin
```

Se a porta estiver ocupada, identificar o processo e parar a instalação; não encerrar outro aplicativo. Se a conta já existir, conferir a finalidade e as permissões antes de reutilizar. Ler a configuração efetiva do vhost de `tiagoismar.com` para localizar o arquivo correto e verificar conflitos de `location`. Não adivinhar o nome do arquivo Nginx.

Conferir também se `/opt/tiago-admin/current` já existe, inclusive como link quebrado, se a unidade `tiago-admin.service` já está instalada e se `/var/lib/tiago-admin` contém dados. Nesse caso, inspecionar o estado antes de decidir entre completar uma instalação parcial e realizar uma atualização; não repetir automaticamente os passos de primeira instalação.

## Preparar diretórios e dependências — após autorização

Ubuntu 24.04 fornece Python 3.12. O preparador exige Python 3.11+ e suporte a `venv`. Se `python3-venv` não estiver instalado, instalar apenas esse pacote após a autorização; não executar atualização geral do servidor.

Para a primeira instalação, se a conta `tiago-admin` ainda não existir:

```bash
useradd --system --user-group --home-dir /var/lib/tiago-admin --create-home --shell /usr/sbin/nologin tiago-admin
install -d -o root -g root -m 0755 /opt/tiago-admin /opt/tiago-admin/releases
install -d -o tiago-admin -g tiago-admin -m 0750 /var/lib/tiago-admin
```

Executar o preparador revisado, obtido do mesmo commit já confirmado no GitHub:

```bash
python3 scripts/prepare-admin-release.py --commit SHA_COMPLETO_CONFIRMADO_NO_GITHUB
```

O script baixa o arquivo do SHA fixado, recusa caminhos inseguros/links, extrai apenas arquivos selecionados do CMS e cria um `venv` por release. As dependências são instaladas nesse ambiente, com `pip check`; nada é instalado no Python global. A release recebe `release.json` com o SHA e hashes dos arquivos e `installed-requirements.txt` com as versões resolvidas.

O resultado esperado é `PREPARED`, **não `DEPLOYED`**. Não troca `current`, não cria usuário, não inicia serviços e não edita o Nginx. Releases existentes nunca são sobrescritas ou apagadas. Se houver falha, inspecionar a pasta parcial; não executar exclusão automática. A preparação pode baixar pacotes do PyPI e deve ser feita apenas após a autorização da instalação.

## Primeiro acesso e ativação — após autorização

Substituir o valor abaixo pelo SHA completo confirmado. A expansão usa os primeiros 12 caracteres somente para o nome da pasta; o preparador valida e registra os 40 caracteres.

```bash
TIAGO_SHA=SHA_COMPLETO_CONFIRMADO_NO_GITHUB
TIAGO_RELEASE="/opt/tiago-admin/releases/git-${TIAGO_SHA:0:12}"
cat "$TIAGO_RELEASE/release.json"
```

Conferir `commit`, arquivos e `state=prepared_not_activated`. Não prosseguir com pasta parcial ou um SHA diferente.

Criar a conta do painel com a senha digitada no terminal:

```bash
cd "$TIAGO_RELEASE"
runuser -u tiago-admin -- env TIAGO_DATA_DIR=/var/lib/tiago-admin TIAGO_SITE_DIR=/var/www/tiagoismar.com/current TIAGO_ADMIN_DIR="$TIAGO_RELEASE/admin" "$TIAGO_RELEASE/venv/bin/python" -m server.app init-admin
```

Para a **primeira instalação**, o seguinte comando só funciona se `current` ainda não existir:

```bash
ln -s -- "$TIAGO_RELEASE" /opt/tiago-admin/current
install -o root -g root -m 0644 "$TIAGO_RELEASE/deploy/tiago-admin.service" /etc/systemd/system/tiago-admin.service
systemctl daemon-reload
systemctl enable --now tiago-admin.service
systemctl status tiago-admin.service --no-pager
curl -fsS -H 'Host: tiagoismar.com' http://127.0.0.1:4180/api/public/content
```

Se o serviço não iniciar, verificar `journalctl -u tiago-admin.service -n 60 --no-pager` e resolver antes de alterar Nginx. Não iniciar Flask em modo de desenvolvimento na VPS. O serviço usa Gunicorn, usuário dedicado, código sem permissão de escrita e armazenamento persistente isolado.

No vhost HTTPS **existente**, revisar e incluir o conteúdo de `deploy/nginx-admin.conf.example`. Fazer uma cópia do arquivo de configuração original em local privado antes da edição. O exemplo não substitui `server`, `listen`, certificados, redirecionamentos ou a raiz estática. O limite de requisição de 10 MB acomoda a imagem de até 8 MB e seu envelope multipart.

Após a edição autorizada, executar:

```bash
nginx -t
```

**Somente se o teste passar**, recarregar Nginx com `systemctl reload nginx`. Se falhar, corrigir ou restaurar o arquivo original e testar novamente; não recarregar configuração inválida.

## Verificação funcional no domínio

- `https://tiagoismar.com/admin/` mostra login, sem link público para o painel; isso complementa a autenticação e não a substitui.
- Sem login, `/api/admin/content` recusa acesso. Login válido cria cookie `Secure`, `HttpOnly`, `SameSite`; logout revoga a sessão.
- Um rascunho salvo pelo painel não aparece no conteúdo público. Publicar/editar um registro aparece no site; listar, editar e excluir exige sessão e CSRF válidos.
- O formulário de parceiros e os 44 nomes originais de Tianguá continuam disponíveis, com filtro por cidade quando houver novas cidades.
- Upload válido funciona, imagens aparecem em HTTPS; arquivos não permitidos são recusados.
- Conferir 320/390/430 px, tablet, notebook e 600 × 390 px; menu, formulário e diálogos sem rolagem lateral da página.
- Estatísticas começam na ativação. São visualizações agregadas, não visitantes únicos e não histórico retroativo.
- Conferir o SHA de `release.json` e comparar os arquivos estáticos públicos com os blobs do mesmo SHA no GitHub.

## Atualizações e rollback

Antes de atualizar, fazer o backup consistente abaixo. Preparar uma nova release com outro SHA completo; nunca modificar uma release existente. Registrar o destino atual do painel em `/opt/tiago-admin/previous-release.txt` e confirmar que ele é uma pasta válida dentro de `/opt/tiago-admin/releases`.

Após verificar a compatibilidade do esquema SQLite e com autorização para reiniciar **apenas o serviço novo**, trocar o link com um nome temporário novo:

```bash
readlink -f /opt/tiago-admin/current
readlink -f /opt/tiago-admin/current > /opt/tiago-admin/previous-release.txt
ln -s -- "$TIAGO_RELEASE" "/opt/tiago-admin/.current-$TIAGO_SHA"
mv -Tf -- "/opt/tiago-admin/.current-$TIAGO_SHA" /opt/tiago-admin/current
systemctl restart tiago-admin.service
```

Se o arquivo temporário já existir, parar e inspecionar. Não repetir a sequência automaticamente. Publicar a parte estática do mesmo SHA depois de confirmar que a API está saudável. Reiniciar novamente somente `tiago-admin` após essa publicação, para resolver a nova raiz estática, e repetir a verificação de saúde. O publicador estático registra sua própria versão anterior em `/var/www/tiagoismar.com/previous-release.txt`.

Um rollback precisa conferir **os dois destinos atuais** antes de trocar links. Ler o registro anterior do painel e o registro anterior estático, validar que as pastas ainda existem e confirmar a compatibilidade da API com o frontend. Trocar o link do painel para a release anterior por operação atômica, reiniciar somente `tiago-admin`, executar o rollback estático registrado e verificar HTTPS novamente. Conservar ambas as releases.

Rollback de código não reverte migrações do banco. Não restaurar um banco antigo por cima dos cadastros atuais automaticamente. Se uma migração futura for incompatível, parar e planejar a restauração do backup consistente com autorização, explicitando a possível perda de alterações posteriores ao backup.

## Backup consistente do banco e das imagens

O banco `content.sqlite3` inclui conteúdo, usuários, sessões e métricas; uploads ficam em `uploads/`. Proteger o backup como dados privados. Não copiar apenas o arquivo principal SQLite enquanto o serviço está escrevendo, pois o modo WAL pode conter transações recentes.

Para um snapshot simples e consistente, em uma janela de manutenção autorizada, parar **somente `tiago-admin`**, copiar a pasta inteira e iniciar novamente. O site estático permanece servido; o painel/API ficam indisponíveis durante a cópia. Usar um diretório novo por backup:

```bash
install -d -o root -g root -m 0700 /var/backups/tiago-admin
TIAGO_BACKUP=$(mktemp -d "/var/backups/tiago-admin/$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
systemctl stop tiago-admin.service
cp -a -- /var/lib/tiago-admin "$TIAGO_BACKUP/data"
systemctl start tiago-admin.service
systemctl is-active tiago-admin.service
```

Confirmar que a cópia terminou sem erro e validar o banco da cópia com `PRAGMA integrity_check` antes de considerar o backup concluído. Se a cópia falhar, reiniciar o serviço e relatar a falha; não substituir o backup anterior. Preservar também os SHAs e destinos `current` do painel e do site junto ao backup. O comando `python -m server.app backup --output CAMINHO_NOVO` usa a API de backup SQLite, mas sozinho não inclui os uploads; para uma cópia coerente dos dois, manter as gravações interrompidas até concluir ambos.

Para recuperar acesso, usar o comando `reset-password` da CLI, executado como `tiago-admin` com os mesmos diretórios. Ele pede a nova senha de forma oculta e revoga as sessões existentes desse usuário. Não há cadastro público ou redefinição de senha via URL.
