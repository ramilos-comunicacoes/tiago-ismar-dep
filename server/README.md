# Administração do site Tiago Ismar

O serviço mantém conteúdo, contas, sessões e contagens em SQLite, fora da raiz pública. O site continua com HTML/CSS/JS; o painel e as APIs precisam deste serviço em execução. A senha da VPS não é a senha do painel. Não há conta ou senha padrão.

## Ambiente

Python 3.11 ou superior. Instale `server/requirements.txt` em um ambiente virtual exclusivo. Na VPS, execute com o usuário de serviço, sem privilégios de root:

```bash
gunicorn 'server.app:create_app()' --bind 127.0.0.1:4180 --workers 2 --threads 2 --timeout 45
```

Variáveis:

| Variável | Uso |
| --- | --- |
| `TIAGO_DATA_DIR` | Diretório persistente, por exemplo `/var/lib/tiago-admin`; nunca dentro da raiz pública. |
| `TIAGO_SITE_DIR` | Arquivos públicos existentes, por exemplo `/var/www/tiagoismar.com/current`. |
| `TIAGO_ADMIN_DIR` | Arquivos do painel; padrão: pasta `admin` ao lado de `server`. |
| `TIAGO_PUBLIC_ORIGIN` | Origem HTTPS exata, padrão `https://tiagoismar.com`. O painel deve usar este domínio canônico. |
| `TIAGO_TRUST_PROXY` | Use `1` somente atrás do Nginx local, com a porta 4180 limitada ao loopback e um único proxy confiável. |
| `TIAGO_DEV` | `1` permite preview HTTP local. Nunca habilitar em produção. |

O Nginx deve encaminhar `/admin`, `/admin/`, `/api/` e `/media/` para o serviço; deve continuar servindo os arquivos do site. Deve sobrescrever `X-Forwarded-For` com o IP da conexão, definir `X-Forwarded-Proto`, preservar o `Host` canônico e aceitar até 10 MB de corpo. A API só confia em `tiagoismar.com` e `www.tiagoismar.com` em produção. Alterações em Nginx/systemd são uma etapa separada de instalação, não realizadas por este módulo.

## Primeiro acesso e recuperação

Com as mesmas variáveis do serviço, execute:

```bash
python -m server.app init-admin --username tiago
```

A senha é solicitada no terminal sem eco, tem no mínimo 12 caracteres e é salva apenas como hash scrypt. Para recuperar o acesso:

```bash
python -m server.app reset-password --username tiago
```

A recuperação pede confirmação e revoga todas as sessões desse usuário. Usuários adicionais podem ser provisionados com `init-admin`; esta versão oferece o mesmo acesso administrativo a todos eles, sem cadastro público nem recuperação por e-mail.

## Preview e testes

Use um diretório de dados descartável fora do checkout. Em PowerShell:

```powershell
$env:TIAGO_DEV = '1'
$env:TIAGO_DATA_DIR = Join-Path $env:TEMP 'tiago-admin-preview'
python -m server.app init-admin --username tiago
python -m server.app
```

O preview serve site e painel em `http://127.0.0.1:4180` e `/admin`. Em desenvolvimento, cookies não usam `Secure`; em produção, usam `Secure`, `HttpOnly`, `SameSite=Strict`, expiram após oito horas e são revogados ao sair. Execute os testes com `python -m pytest tests/test_admin.py -q`; pytest é dependência apenas de desenvolvimento.

## API utilizada pelo site e painel

Erros retornam `{ "error": "mensagem" }` e HTTP adequado. Todas as mutações administrativas exigem login, `Origin` exata e `X-CSRF-Token`. O login usa uma sessão anônima prévia para proteção contra CSRF. O painel deve renovar seu token a partir das respostas de login/logout.

| Rota | Resposta/ação |
| --- | --- |
| `GET /api/admin/session` | `{authenticated, user: null ou {username}, csrf_token}`; cria sessão anônima se necessário. |
| `POST /api/admin/login` | JSON `{username,password}`; retorna sessão autenticada, com cookie e CSRF rotacionados. |
| `POST /api/admin/logout` | Revoga sessão e retorna nova sessão anônima. |
| `GET /api/admin/content` | Todas as coleções ativas, inclusive rascunhos, e `settings`. |
| `GET /api/public/content` | Somente conteúdos publicados; omite itens de empresas não publicadas/excluídas. |
| `POST /api/admin/<tipo>` | Cria registro, resposta `{item}`, HTTP 201. |
| `PATCH /api/admin/<tipo>/<id>` | Atualiza campos enviados e exige `version` atual; responde `{item}`. Conflitos retornam 409. |
| `DELETE /api/admin/<tipo>/<id>` | Exige JSON `{version}`; responde `{ok:true}`. Remoção lógica, sem apagar dados do banco. |
| `PATCH /api/admin/settings` | Atualiza campos conhecidos, resposta `{settings}`. |
| `POST /api/admin/upload` | Multipart com `file`; resposta `{url}`, HTTP 201. |
| `GET /api/admin/stats` | `{today,total,last_30_days:[{date,views}],by_section:[{section,views}],since}`. |
| `GET /api/admin/export` | Download JSON com os conteúdos ativos e configurações. Não inclui contas, senhas ou sessões. |
| `POST /api/visit` | JSON `{section}`; contagem agregada pública, com origem e limite de frequência. |
| `GET /api/health` | `{ok:true}` após consultar o banco; verificação local de produção exige `Host: tiagoismar.com`. |

Tipos: `companies`, `catalog_items`, `events`, `projects`, `partners`. IDs são atribuídos no servidor. Registros contêm `id`, `version`, `updated_at`; não envie `id`/`updated_at` em mutações. Todos aceitam `title`, `published` booleano e `sort_order` inteiro (padrão 0). A lista de parceiros aceita apenas esses campos e `city`.

Os demais tipos também aceitam `city`, `description` e `image`:

- Empresas: `category`, `whatsapp` (somente números, país e DDD), `url` HTTPS, `is_group` booleano. Pertencer ao Grupo Ramilos é uma informação explicitamente cadastrada; nunca é inferida da lista de parceiros.
- Catálogo: `company_id`, `price_text`, `url` HTTPS. `city` é opcional. A empresa precisa existir e estar publicada antes de um item ser publicado. Excluir a empresa também marca seus itens como excluídos.
- Eventos: `location`, `start_at`, `end_at` opcional, `url` HTTPS. Datas no formato `YYYY-MM-DDTHH:mm`, horário local da Ibiapaba (America/Fortaleza); encerramento não pode anteceder início.
- Projetos: `status` = `idea`, `planning`, `in_progress` ou `completed`; `url` HTTPS.

Settings disponíveis: `site_intro` (até 1500 caracteres), `contact_whatsapp`, `catalog_url` (HTTPS, opcional, até 1200 caracteres), `companies_title` (120), `companies_intro`, `events_intro`, `projects_intro` (600 cada). O catálogo é um link independente do WhatsApp de contato. Os valores são texto simples, não HTML. O frontend deve usar `textContent` para todos os textos fornecidos por usuários.

Imagens devem vir de `/media/<id>.webp` (upload) ou de uma imagem raster existente em `/assets/`. URLs externas de imagens e SVGs enviados são rejeitados. Uploads JPEG/PNG/WebP de até 8 MB são decodificados, limitados em pixels, redimensionados até 2000×2000, regravados como WebP sem metadados e recebem nome aleatório. Rascunhos não expõem a mídia ao público; fotos publicadas são servidas sem cache compartilhado para respeitar a retirada da publicação.

## Dados e visualizações

`server/seed.json` contém os 44 nomes reais da lista original de Tianguá. O seed roda uma única vez; editar o JSON depois não sobrescreve cadastros. Empresas comerciais, catálogos, eventos e projetos começam vazios.

As métricas passam a existir quando o serviço é ativado. `total` e `today` contam carregamentos da página inicial (`inicio`), não visitantes únicos. `by_section` soma visualizações de cada seção. Não há fingerprint, IP bruto ou histórico individual no banco de métricas. Sessões autenticadas de administradores e bots identificáveis não contam. Bloqueios de scripts, recarregamentos e robôs não identificados podem afetar os números. Limites de abuso guardam temporariamente apenas um hash com salt do endereço, expirando em até uma hora.

`content.sqlite3` guarda registros, remoções lógicas, configurações, contas, sessões e auditoria das mutações. `uploads/` guarda fotos. O serviço não fornece restauração de itens excluídos na interface desta primeira versão; uma restauração pode ser feita a partir do banco/backup por um administrador técnico.

## Backup

O botão de exportar conteúdo não substitui um backup completo. Para copiar o banco de forma consistente, usando a mesma configuração do serviço:

```bash
python -m server.app backup --output /caminho/privado/novo-backup.sqlite3
```

O destino deve ser novo e ficar fora da raiz pública. Copie também `TIAGO_DATA_DIR/uploads`. Não publique backups, banco, sessões ou hashes de senha. Antes de atualizar o serviço em produção, mantenha a cópia do banco e as imagens; releases estáticas e dados do painel têm ciclos separados.
