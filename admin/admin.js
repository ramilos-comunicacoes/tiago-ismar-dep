(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const kinds = {
    companies: { title: 'Empresas', single: 'empresa', description: 'Cada negócio com o seu espaço, sua história e seus contatos.' },
    catalog_items: { title: 'Catálogos', single: 'item do catálogo', description: 'Produtos e serviços organizados por empresa.' },
    events: { title: 'Eventos da Ibiapaba', single: 'evento', description: 'Uma agenda para aproximar as pessoas da nossa serra.' },
    projects: { title: 'Projetos para a Ibiapaba', single: 'projeto', description: 'Ideias, iniciativas e os próximos passos de cada projeto.' },
    partners: { title: 'Parceiros por cidade', single: 'parceiro', description: 'As listas do trade turístico, organizadas por município.' },
  };
  const pages = {
    overview: { title: 'Visão geral', description: 'Um olhar sobre o seu site.' },
    settings: { title: 'Configurações', description: 'Gerencie as inscrições da capela, os textos e os contatos do site.' },
    rsvps: { title: 'Confirmações', description: 'Inscrições nos projetos e presenças nos eventos.' },
    surveys: { title: 'Pesquisas', description: 'Formulários anônimos com QR code e gráficos das respostas.' },
  };
  const projectLabels = { idea: 'Ideia', planning: 'Em planejamento', in_progress: 'Em andamento', completed: 'Concluído' };
  const confirmationDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });
  let csrf = '', data = {}, stats = {}, currentView = new URLSearchParams(location.search).has('pesquisa') ? 'surveys' : 'overview', editing = null, editorDirty = false, uploadBusy = false, deleting = false;
  let confirmationsRequest = null;
  let projectSignupsRequest = null;
  let latestConfirmations = null;
  let currentProjectSignups = null;
  const signupDialog = $('#project-signups');
  const rsvpDialog = $('#rsvp-dialog');
  const signupDialogEl = $('#signup-dialog');
  let currentRsvpTarget = null;
  let currentSignupTarget = null;
  let onConfirmAction = null;
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf);
    if (options.body && !(options.body instanceof FormData)) { headers.set('Content-Type', 'application/json'); options.body = JSON.stringify(options.body); }
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.endsWith('/login')) { csrf = ''; showLogin(); $('#login-error').textContent = 'Sua sessão terminou. Entre novamente para continuar.'; }
      throw new Error(payload.error || 'Não foi possível concluir. Tente novamente.');
    }
    if (payload.csrf_token) csrf = payload.csrf_token;
    return payload;
  }
  function notify(text, error = false) { const el = $('#app-status'); el.textContent = text; el.classList.toggle('error', error); }
  function showLogin() { $('#boot').hidden = true; $('#admin-view').hidden = true; $('#login-view').hidden = false; if ($('#editor').open) $('#editor').close(); if ($('#confirm-dialog').open) $('#confirm-dialog').close(); if (signupDialog.open) signupDialog.close(); if (rsvpDialog?.open) rsvpDialog.close(); if (signupDialogEl?.open) signupDialogEl.close(); clearConfirmations(); data = {}; }
  window.TiagoAdmin = { api: (...args) => api(...args), notify: (...args) => notify(...args), ask: (...args) => askConfirmation(...args) };
  async function loadData() { data = await api('/api/admin/content'); }
  async function showAdmin() {
    await loadData();
    stats = await api('/api/admin/stats');
    $('#boot').hidden = true; $('#login-view').hidden = true; $('#admin-view').hidden = false;
    renderView(currentView);
    openLinkedSignups();
  }
  function showEmpty(parent, title, description) { const el = node('div', null, 'empty'); el.append(node('h2', title), node('p', description)); parent.append(el); }
  function safeImage(value) { if (!value) return ''; try { const u = new URL(value, location.origin); return u.origin === location.origin && /^\/(assets|media)\//.test(u.pathname) ? u.href : u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }
  function renderView(view) {
    currentView = view;
    $$('#admin-nav button').forEach(button => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('#overview-panel').hidden = view !== 'overview'; $('#records-panel').hidden = !kinds[view]; $('#settings-panel').hidden = view !== 'settings'; $('#add-item').hidden = !kinds[view];
    $('#rsvps-panel').hidden = view !== 'rsvps';
    $('#surveys-panel').hidden = view !== 'surveys';
    const page = kinds[view] || pages[view];
    $('#view-title').textContent = page.title;
    $('#view-description').textContent = page.description;
    if (view !== 'rsvps') clearConfirmations();
    notify('');
    if (kinds[view]) {
      $('#add-item').firstChild.textContent = `Adicionar ${kinds[view].single} `;
      $('#record-search').value = ''; $('#record-state').value = 'all';
      const cityFilter = $('#record-city'); cityFilter.replaceChildren(new Option('Todas as cidades', ''));
      [...new Set((data[view] || []).map(item => item.city).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR')).forEach(city => cityFilter.add(new Option(city, city)));
      $('#city-filter-label').hidden = view === 'catalog_items';
      renderRecords();
    } else if (view === 'overview') renderOverview();
    else if (view === 'rsvps') loadConfirmations();
    else if (view === 'surveys') window.TiagoSurveys?.show();
    else fillSettings();
  }
  function clearConfirmations() {
    confirmationsRequest?.abort();
    confirmationsRequest = null;
    $('#rsvps-list').replaceChildren();
    $('#rsvps-status').textContent = '';
  }
  function confirmationCount(total) {
    return `${total.toLocaleString('pt-BR')} ${total === 1 ? 'presença confirmada' : 'presenças confirmadas'}`;
  }
  function askConfirmation(title, message, action, confirmLabel = 'Excluir') {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = message;
    $('#confirm-delete').textContent = confirmLabel;
    onConfirmAction = action;
    if (!$('#confirm-dialog').open) $('#confirm-dialog').showModal();
  }
  function signupRow(signup, fallbackProjectId) {
    const pId = signup.project_id || fallbackProjectId || signupDialog.dataset.projectId;
    const row = node('li', null, 'rsvp-attendee-item'), identity = node('div', null, 'rsvp-attendee-info');
    identity.append(node('strong', signup.name), node('span', `Nome na capela: ${signup.tribute_name}`));
    const time = node('time', confirmationDate.format(new Date(signup.created_at)));
    time.dateTime = signup.created_at;
    const actions = node('div', null, 'rsvp-item-actions');
    const editBtn = node('button', 'Editar', 'subtle rsvp-action-btn');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openSignupEditor(signup, pId));
    const deleteBtn = node('button', 'Excluir', 'subtle danger rsvp-action-btn');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', () => deleteSignup(signup, pId));
    actions.append(editBtn, deleteBtn);
    row.append(identity, time, actions);
    return row;
  }
  function openSignupEditor(signup, projectId) {
    currentSignupTarget = { mode: signup ? 'edit' : 'create', projectId, submissionId: signup?.submission_id, signup };
    $('#signup-dialog-kicker').textContent = signup ? 'EDITAR INSCRIÇÃO' : 'NOVA INSCRIÇÃO';
    $('#signup-dialog-title').textContent = signup ? 'Editar inscrito' : 'Nova inscrição';
    $('#signup-name').value = signup?.name || '';
    $('#signup-tribute').value = signup?.tribute_name || '';
    $('#signup-dialog-error').textContent = '';
    $('#save-signup-dialog').disabled = false;
    if (!signupDialogEl.open) signupDialogEl.showModal();
    $('#signup-name').focus();
  }
  function deleteSignup(signup, projectId) {
    askConfirmation('Excluir inscrição?', `A inscrição de “${signup.name}” (Homenagem: “${signup.tribute_name}”) será removida do projeto.`, async () => {
      await api(`/api/admin/projects/${encodeURIComponent(projectId)}/signups/${encodeURIComponent(signup.submission_id)}`, { method: 'DELETE' });
      notify('Inscrição excluída com sucesso.');
      if (signupDialog.open) loadProjectSignups();
      if (!$('#rsvps-panel').hidden) loadConfirmations();
      await loadData();
      if (currentView === 'projects') renderView('projects');
    });
  }
  function openRsvpEditor(registration, eventId) {
    currentRsvpTarget = { mode: registration ? 'edit' : 'create', eventId, participantKey: registration?.participant_key, registration };
    $('#rsvp-dialog-kicker').textContent = registration ? 'EDITAR CONFIRMAÇÃO' : 'NOVA CONFIRMAÇÃO';
    $('#rsvp-dialog-title').textContent = registration ? 'Editar presença' : 'Confirmar presença';
    $('#rsvp-name').value = registration?.name || '';
    $('#rsvp-enterprise').value = registration?.enterprise || '';
    $('#rsvp-phone').value = registration?.owner_phone || '';
    $('#rsvp-dialog-error').textContent = '';
    $('#save-rsvp-dialog').disabled = false;
    if (!rsvpDialog.open) rsvpDialog.showModal();
    $('#rsvp-name').focus();
  }
  function deleteRsvp(registration, eventId) {
    askConfirmation('Excluir confirmação?', `A confirmação de “${registration.name}” (${registration.enterprise}) será removida deste evento.`, async () => {
      await api(`/api/admin/events/${encodeURIComponent(eventId)}/rsvps/${encodeURIComponent(registration.participant_key)}`, { method: 'DELETE' });
      notify('Confirmação excluída com sucesso.');
      loadConfirmations();
    });
  }
  function openLinkedSignups() {
    if ($('#admin-view').hidden) return;
    const id = location.hash.match(/^#inscritos\/([a-f0-9]{24})$/)?.[1];
    if (!id) {
      if (signupDialog.open) signupDialog.close();
      return;
    }
    const project = data.projects.find(item => item.id === id);
    renderView('projects');
    if (!project) {
      if (signupDialog.open) signupDialog.close();
      notify('O projeto deste link não está disponível.', true);
      return;
    }
    openProjectSignups(project);
  }
  function openProjectSignups(project) {
    signupDialog.dataset.projectId = project.id;
    $('#signups-title').textContent = project.title;
    history.replaceState(history.state, '', `#inscritos/${project.id}`);
    if (!signupDialog.open) signupDialog.showModal();
    signupDialog.scrollTop = 0;
    loadProjectSignups();
  }
  async function loadProjectSignups() {
    projectSignupsRequest?.abort();
    const request = new AbortController();
    projectSignupsRequest = request;
    const list = $('#project-signup-list'), status = $('#project-signup-status'), refresh = $('#refresh-signups');
    list.replaceChildren();
    status.textContent = 'Carregando inscrições…';
    refresh.disabled = true;
    try {
      const { signups, limit } = await api(`/api/admin/projects/${encodeURIComponent(signupDialog.dataset.projectId)}/signups`, { signal: request.signal });
      if (request.signal.aborted || !signupDialog.open) return;
      currentProjectSignups = {
        signups,
        limit,
        projectTitle: $('#signups-title').textContent || 'Projeto'
      };
      list.replaceChildren(...signups.map(signup => signupRow(signup, signupDialog.dataset.projectId)));
      status.textContent = signups.length ? `${signups.length} ${signups.length === 1 ? 'pessoa inscrita' : 'pessoas inscritas'}` : 'Ninguém preencheu o formulário deste projeto ainda.';
      if (limit === null) status.textContent = `${signups.length} ${signups.length === 1 ? 'nome inscrito' : 'nomes inscritos'} · Sem limite de nomes`;
      if (limit) {
        const remaining = Math.max(0, limit - signups.length);
        const count = signups.length > limit ? `${signups.length} nomes inscritos · Limite de ${limit}` : `${signups.length} de ${limit} ${limit === 1 ? 'nome' : 'nomes'}`;
        status.textContent = `${count} · ${remaining === 0 ? 'Lista completa' : remaining === 1 ? 'Resta 1 vaga' : `Restam ${remaining} vagas`}`;
      }
    } catch {
      if (!request.signal.aborted && signupDialog.open) status.textContent = 'Não foi possível carregar os inscritos. Toque em Atualizar lista para tentar novamente.';
    } finally {
      if (projectSignupsRequest === request) refresh.disabled = false;
    }
  }
  $('#close-signups').addEventListener('click', () => signupDialog.close());
  $('#refresh-signups').addEventListener('click', loadProjectSignups);
  signupDialog.addEventListener('close', () => {
    if (signupDialog.open) return;
    projectSignupsRequest?.abort();
    projectSignupsRequest = null;
    $('#project-signup-list').replaceChildren();
    $('#project-signup-status').textContent = '';
    if (location.hash === `#inscritos/${signupDialog.dataset.projectId}`) history.replaceState(history.state, '', location.pathname + location.search);
    delete signupDialog.dataset.projectId;
    currentProjectSignups = null;
  });
  window.addEventListener('hashchange', openLinkedSignups);

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatPhone(phone) {
    if (!phone) return '—';
    const parts = typeof phone === 'string' && phone.match(/^(\+55)?([1-9]\d)(\d{4,5})(\d{4})$/);
    if (!parts) return phone;
    const [, country, area, prefix, suffix] = parts;
    return `${country ? country + ' ' : ''}(${area}) ${prefix}-${suffix}`;
  }
  function formatReportDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return confirmationDate.format(d);
  }
  function printPdfReport(report) {
    const win = window.open('', '_blank');
    if (!win) {
      notify('A janela do relatório foi bloqueada pelo navegador. Permita pop-ups para gerar o PDF.', true);
      return;
    }
    const now = new Date();
    const emittedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(now);
    const metaHtml = (report.meta || []).map(item => `
      <div class="report-meta-item">
        <dt>${escapeHtml(item.label)}</dt>
        <dd>${escapeHtml(item.value)}</dd>
      </div>
    `).join('');
    const sectionsHtml = (report.sections || []).map(section => {
      const heading = section.heading ? `<h2 class="section-title">${escapeHtml(section.heading)}</h2>` : '';
      const note = section.note ? `<p class="section-note">${escapeHtml(section.note)}</p>` : '';
      if (!section.rows || !section.rows.length) {
        return `
          <div class="report-section">
            ${heading}
            ${note}
            <div class="empty-state">Nenhum registro encontrado para esta seção.</div>
          </div>
        `;
      }
      const ths = (section.columns || []).map(col => `<th>${escapeHtml(col)}</th>`).join('');
      const trs = section.rows.map(row => {
        const tds = row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `
        <div class="report-section">
          ${heading}
          ${note}
          <table class="report-table">
            <thead><tr>${ths}</tr></thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
      `;
    }).join('');

    const docHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)} · Relatório Tiago Ismar</title>
  <style>
    :root {
      --forest: #13231b;
      --lime: #536f1c;
      --ink: #172a20;
      --muted: #57695c;
      --line: #d8dfd2;
      --surface: #f9faf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--ink);
      background: #eef2e7;
      font-size: 13px;
      line-height: 1.5;
    }
    .report-toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 24px;
      background: var(--forest);
      color: #eeeee5;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
    }
    .report-toolbar-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
    }
    .report-toolbar-info strong { color: #d5eb64; font-size: 14px; }
    .report-toolbar-tip { font-size: 12px; opacity: 0.85; }
    .report-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 18px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      text-decoration: none;
    }
    .btn-primary { background: #d5eb64; color: #13231b; }
    .btn-primary:hover { background: #e3f48f; }
    .btn-secondary { background: #263e2e; color: #eeeee5; }
    .btn-secondary:hover { background: #33503b; }
    .report-container {
      max-width: 900px;
      margin: 28px auto 60px;
      background: #ffffff;
      padding: 36px 44px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      border: 1px solid var(--line);
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 20px;
      border-bottom: 2px solid var(--forest);
      margin-bottom: 24px;
    }
    .report-brand-name {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: var(--forest);
      text-transform: uppercase;
      line-height: 1;
    }
    .report-brand-sub {
      font-size: 11px;
      letter-spacing: 0.14em;
      color: var(--muted);
      margin-top: 5px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .report-header-right { text-align: right; }
    .report-kicker {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.12em;
      color: var(--lime);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .report-title {
      font-size: 22px;
      font-weight: 700;
      color: var(--forest);
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .report-subtitle {
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 16px;
    }
    .report-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 24px;
    }
    .report-meta-item dt {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--muted);
      letter-spacing: 0.05em;
    }
    .report-meta-item dd {
      font-size: 14px;
      font-weight: 700;
      color: var(--ink);
      margin-top: 2px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--forest);
      margin: 24px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
    }
    .section-note {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      font-size: 12px;
    }
    table.report-table th, table.report-table td {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }
    table.report-table thead th {
      background: #eef2e7;
      color: var(--forest);
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid #ccd6c2;
    }
    table.report-table tbody tr:nth-child(even) {
      background: #fbfcf8;
    }
    table.report-table tr {
      page-break-inside: avoid;
    }
    .empty-state {
      padding: 24px;
      text-align: center;
      color: var(--muted);
      font-style: italic;
      background: var(--surface);
      border-radius: 6px;
      margin-bottom: 20px;
    }
    .report-footer {
      margin-top: 36px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: var(--muted);
    }
    @media print {
      body {
        background: #ffffff !important;
        color: #111111 !important;
        font-size: 11pt !important;
      }
      .report-toolbar {
        display: none !important;
      }
      .report-container {
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        box-shadow: none !important;
      }
      table.report-table thead {
        display: table-header-group;
      }
      table.report-table tr {
        page-break-inside: avoid;
      }
      @page {
        size: A4 portrait;
        margin: 15mm 12mm;
      }
    }
  </style>
</head>
<body>
  <div class="report-toolbar">
    <div class="report-toolbar-info">
      <strong>Relatório em PDF · Prévia de Impressão</strong>
      <span class="report-toolbar-tip">Para salvar em arquivo: na tela de impressão, selecione o destino <strong>“Salvar como PDF”</strong>.</span>
    </div>
    <div class="report-toolbar-actions">
      <button type="button" class="btn btn-primary" onclick="window.print()">Salvar como PDF / Imprimir</button>
      <button type="button" class="btn btn-secondary" onclick="window.close()">Fechar</button>
    </div>
  </div>
  <div class="report-container">
    <header class="report-header">
      <div>
        <div class="report-brand-name">Tiago Ismar</div>
        <div class="report-brand-sub">Da Ibiapaba. De perto. · Painel Administrativo</div>
      </div>
      <div class="report-header-right">
        <div class="report-kicker">${escapeHtml(report.kicker || 'RELATÓRIO OFICIAL')}</div>
        <div class="report-date">Emitido em ${escapeHtml(emittedAt)}</div>
      </div>
    </header>
    <main>
      <h1 class="report-title">${escapeHtml(report.title)}</h1>
      ${report.subtitle ? `<p class="report-subtitle">${escapeHtml(report.subtitle)}</p>` : ''}
      ${report.meta && report.meta.length ? `<dl class="report-meta-grid">${metaHtml}</dl>` : ''}
      ${sectionsHtml}
    </main>
    <footer class="report-footer">
      <span>tiagoismar.com · Painel de Gestão</span>
      <span>${escapeHtml(report.footerNote || 'Documento confidencial gerado para controle interno.')}</span>
    </footer>
  </div>
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        try { window.print(); } catch (e) {}
      }, 350);
    });
  <\/script>
</body>
</html>`;

    win.document.open();
    win.document.write(docHtml);
    win.document.close();
  }

  function exportEventRsvpsPdf(event) {
    const registrations = event.registrations || [];
    const rows = registrations.map((r, i) => [
      String(i + 1),
      r.name || '—',
      r.enterprise || '—',
      formatPhone(r.owner_phone),
      formatReportDate(r.created_at)
    ]);
    printPdfReport({
      title: event.title,
      kicker: 'LISTA DE PRESENÇAS · EVENTO',
      subtitle: 'Relatório oficial de confirmações de presença registradas para este evento.',
      meta: [
        { label: 'Total Confirmado', value: `${registrations.length} ${registrations.length === 1 ? 'participante' : 'participantes'}` },
        { label: 'Evento', value: event.title },
        { label: 'Situação', value: event.published ? 'Publicado no site' : 'Rascunho' }
      ],
      sections: [
        {
          columns: ['#', 'Nome do Participante', 'Empreendimento / Empresa', 'Telefone', 'Data da Confirmação'],
          rows
        }
      ],
      footerNote: 'Controle de presenças para recepção e credenciamento do evento.'
    });
  }

  function exportChapelSignupsPdf(signups, title) {
    const list = signups || [];
    const rows = list.map((s, i) => [
      String(i + 1),
      s.tribute_name || '—',
      s.name || '—',
      formatReportDate(s.created_at)
    ]);
    printPdfReport({
      title: title || 'Capela de Nossa Senhora de Fátima',
      kicker: 'CAMINHO DA FÉ · PROJETO',
      subtitle: 'Lista oficial de benfeitores e homenagens registradas para a capela.',
      meta: [
        { label: 'Total de Homenagens', value: `${list.length} ${list.length === 1 ? 'nome registrado' : 'nomes registrados'}` },
        { label: 'Contribuição Prevista', value: 'R$ 1.000,00 por benfeitor' },
        { label: 'Conferência', value: 'Via comprovante Pix / WhatsApp' }
      ],
      sections: [
        {
          columns: ['#', 'Nome na Homenagem (Capela)', 'Benfeitor / Inscrito por', 'Data da Inscrição'],
          rows
        }
      ],
      footerNote: 'Lista destinada à conferência de comprovantes e confecção das homenagens.'
    });
  }

  function exportAllRsvpsPdf() {
    if (!latestConfirmations) {
      notify('Carregue as confirmações antes de exportar o relatório.', true);
      return;
    }
    const { events = [], chapel_signups = [] } = latestConfirmations;
    const totalRsvps = events.reduce((sum, ev) => sum + (ev.registrations || []).length, 0);
    const sections = [];

    if (chapel_signups.length) {
      sections.push({
        heading: `Capela de Nossa Senhora de Fátima (${chapel_signups.length} ${chapel_signups.length === 1 ? 'inscrição' : 'inscrições'})`,
        note: 'Homenagens registradas no projeto Caminho da Fé.',
        columns: ['#', 'Nome na Homenagem', 'Benfeitor / Inscrito por', 'Data da Inscrição'],
        rows: chapel_signups.map((s, i) => [String(i + 1), s.tribute_name || '—', s.name || '—', formatReportDate(s.created_at)])
      });
    }

    events.forEach(ev => {
      const regs = ev.registrations || [];
      sections.push({
        heading: `${ev.title} (${regs.length} ${regs.length === 1 ? 'presença' : 'presenças'})`,
        note: ev.city ? `Cidade: ${ev.city}` : '',
        columns: ['#', 'Nome do Participante', 'Empreendimento', 'Telefone', 'Data'],
        rows: regs.map((r, i) => [String(i + 1), r.name || '—', r.enterprise || '—', formatPhone(r.owner_phone), formatReportDate(r.created_at)])
      });
    });

    if (!sections.length) {
      sections.push({
        heading: 'Sem confirmações',
        columns: ['#', 'Participante', 'Empreendimento', 'Telefone', 'Data'],
        rows: []
      });
    }

    printPdfReport({
      title: 'Relatório Geral de Confirmações e Inscrições',
      kicker: 'RELATÓRIO CONSOLIDADO',
      subtitle: 'Visão consolidada de todas as presenças em eventos e inscrições em projetos.',
      meta: [
        { label: 'Eventos Listados', value: `${events.length} ${events.length === 1 ? 'evento' : 'eventos'}` },
        { label: 'Presenças em Eventos', value: `${totalRsvps} ${totalRsvps === 1 ? 'confirmada' : 'confirmadas'}` },
        { label: 'Inscrições em Projetos', value: `${chapel_signups.length} ${chapel_signups.length === 1 ? 'registrada' : 'registradas'}` }
      ],
      sections,
      footerNote: 'Relatório consolidado gerado pelo Painel Administrativo de Tiago Ismar.'
    });
  }

  function exportProjectModalSignupsPdf() {
    if (!currentProjectSignups) {
      notify('Nenhuma lista de projeto carregada para exportação.', true);
      return;
    }
    const { signups = [], limit, projectTitle } = currentProjectSignups;
    const limitInfo = limit === null ? 'Sem limite' : (limit ? `Limite de ${limit} nomes` : 'Sem limite');
    printPdfReport({
      title: projectTitle || 'Inscrições no Projeto',
      kicker: 'RELATÓRIO DE INSCRIÇÕES',
      subtitle: 'Lista nominal de inscritos registrados neste projeto.',
      meta: [
        { label: 'Total de Inscritos', value: `${signups.length} ${signups.length === 1 ? 'inscrito' : 'inscritos'}` },
        { label: 'Capacidade', value: limitInfo },
        { label: 'Situação', value: limit && signups.length >= limit ? 'Vagas esgotadas' : 'Inscrições abertas' }
      ],
      sections: [
        {
          columns: ['#', 'Nome na Homenagem (Capela)', 'Nome de Quem Inscreveu', 'Data da Inscrição'],
          rows: signups.map((s, i) => [String(i + 1), s.tribute_name || '—', s.name || '—', formatReportDate(s.created_at)])
        }
      ],
      footerNote: 'Relatório oficial gerado para controle interno e execução das homenagens.'
    });
  }

  function exportOverviewPdf() {
    const totalPublished = Object.keys(kinds).reduce((sum, kind) => sum + (data[kind] || []).filter(item => item.published).length, 0);
    const companies = data.companies || [];
    const events = data.events || [];
    const projects = data.projects || [];

    const sections = [
      {
        heading: `Empresas Cadastradas (${companies.length})`,
        columns: ['#', 'Nome da Empresa', 'Cidade', 'Situação'],
        rows: companies.map((c, i) => [String(i + 1), c.title || '—', c.city || '—', c.published ? 'Publicada' : 'Rascunho'])
      },
      {
        heading: `Eventos da Agenda (${events.length})`,
        columns: ['#', 'Título do Evento', 'Cidade', 'Situação'],
        rows: events.map((e, i) => [String(i + 1), e.title || '—', e.city || '—', e.published ? 'Publicado' : 'Rascunho'])
      },
      {
        heading: `Projetos (${projects.length})`,
        columns: ['#', 'Título do Projeto', 'Formulário', 'Situação'],
        rows: projects.map((p, i) => [String(i + 1), p.title || '—', p.participation_form || 'Nenhum', p.published ? 'Publicado' : 'Rascunho'])
      }
    ];

    printPdfReport({
      title: 'Relatório Executivo do Painel',
      kicker: 'RESUMO GERAL DO CONTEÚDO',
      subtitle: 'Panorama dos conteúdos publicados e estrutura administrativa do site.',
      meta: [
        { label: 'Acessos Hoje', value: Number(stats.today || 0).toLocaleString('pt-BR') },
        { label: 'Acessos Registrados', value: Number(stats.total || 0).toLocaleString('pt-BR') },
        { label: 'Conteúdos Publicados', value: `${totalPublished} itens` }
      ],
      sections,
      footerNote: 'Documento gerado pelo Painel Administrativo de Tiago Ismar (tiagoismar.com).'
    });
  }

  async function exportIndividualEventPdf(item) {
    let registrations = [];
    try {
      const res = await api('/api/admin/rsvps');
      const found = (res.events || []).find(ev => ev.id === item.id || (item.registration_slug && ev.slug === item.registration_slug));
      if (found && found.registrations) registrations = found.registrations;
    } catch {
      if (latestConfirmations && latestConfirmations.events) {
        const found = latestConfirmations.events.find(ev => ev.id === item.id || (item.registration_slug && ev.slug === item.registration_slug));
        if (found && found.registrations) registrations = found.registrations;
      }
    }
    const rows = registrations.map((r, i) => [
      String(i + 1),
      r.name || '—',
      r.enterprise || '—',
      formatPhone(r.owner_phone),
      formatReportDate(r.created_at)
    ]);
    const eventDate = item.start_at ? item.start_at.slice(0, 10).split('-').reverse().join('/') + (item.start_at.length > 10 ? ' às ' + item.start_at.slice(11, 16) : '') : 'A definir';
    printPdfReport({
      title: item.title,
      kicker: 'DOSSIÊ DO EVENTO · RELATÓRIO INDIVIDUAL',
      subtitle: item.description || 'Relatório oficial do evento com detalhamento e lista de confirmações de presença.',
      meta: [
        { label: 'Cidade', value: item.city || 'Ibiapaba' },
        { label: 'Data / Horário', value: eventDate },
        { label: 'Local', value: item.location || 'A definir' },
        { label: 'Situação', value: item.published ? 'Publicado no site' : 'Rascunho' },
        { label: 'Confirmações de Presença', value: `${registrations.length} ${registrations.length === 1 ? 'participante' : 'participantes'}` }
      ],
      sections: [
        {
          heading: 'Participantes Confirmados',
          note: registrations.length ? 'Lista nominal de participantes que confirmaram presença através do formulário oficial.' : 'Nenhuma confirmação de presença registrada até o momento.',
          columns: ['#', 'Nome do Participante', 'Empreendimento / Empresa', 'Telefone', 'Data da Confirmação'],
          rows
        }
      ],
      footerNote: 'Dossiê individual do evento gerado pelo Painel Administrativo de Tiago Ismar.'
    });
  }

  async function exportIndividualProjectPdf(item) {
    let signups = [];
    let limit = null;
    if (item.participation_form || item.signup_count > 0) {
      try {
        const res = await api(`/api/admin/projects/${encodeURIComponent(item.id)}/signups`);
        signups = res.signups || [];
        limit = res.limit;
      } catch {
        // ignora se endpoint falhar
      }
    }
    const limitInfo = limit === null ? 'Sem limite' : (limit ? `Limite de ${limit} nomes` : 'Sem limite');
    const rows = signups.map((s, i) => [
      String(i + 1),
      s.tribute_name || '—',
      s.name || '—',
      formatReportDate(s.created_at)
    ]);
    const sections = [];
    if (item.description) {
      sections.push({
        heading: 'Apresentação do Projeto',
        note: item.description,
        columns: ['Característica', 'Informação'],
        rows: [
          ['Etapa / Status', projectLabels[item.status] || item.status || 'Em andamento'],
          ['Cidade de Atuação', item.city || 'Ibiapaba'],
          ['Formulário Ativo', item.participation_form ? 'Sim (Benfeitores / Inscrições)' : 'Não'],
          ['Situação no Site', item.published ? 'Publicado' : 'Rascunho']
        ]
      });
    }
    sections.push({
      heading: item.participation_form ? 'Lista de Inscritos e Benfeitores' : 'Inscrições',
      note: signups.length ? 'Relação nominal de pessoas inscritas ou homenagens registradas no projeto.' : 'Nenhuma inscrição registrada para este projeto até o momento.',
      columns: ['#', 'Nome na Homenagem / Registro', 'Inscrito por / Benfeitor', 'Data da Inscrição'],
      rows
    });
    printPdfReport({
      title: item.title,
      kicker: 'PROJETO · RELATÓRIO INDIVIDUAL',
      subtitle: `Dossiê executivo e relação nominal de inscritos do projeto ${item.title}.`,
      meta: [
        { label: 'Cidade', value: item.city || 'Ibiapaba' },
        { label: 'Etapa', value: projectLabels[item.status] || item.status || '—' },
        { label: 'Total de Inscritos', value: `${signups.length} ${signups.length === 1 ? 'inscrito' : 'inscritos'}` },
        { label: 'Capacidade', value: limitInfo },
        { label: 'Situação', value: item.published ? 'Publicado' : 'Rascunho' }
      ],
      sections,
      footerNote: 'Relatório individual de projeto gerado pelo Painel Administrativo de Tiago Ismar.'
    });
  }

  function exportIndividualCompanyPdf(item) {
    const catalog = (data.catalog_items || []).filter(ci => ci.company_id === item.id);
    const rows = catalog.map((c, i) => [
      String(i + 1),
      c.title || '—',
      c.price_text || 'Sob consulta',
      c.description || '—',
      c.published ? 'Publicado' : 'Rascunho'
    ]);
    const sections = [];
    if (item.description) {
      sections.push({
        heading: 'Perfil da Empresa',
        note: item.description,
        columns: ['Campo', 'Detalhe'],
        rows: [
          ['Categoria', item.category || 'Não informada'],
          ['Cidade', item.city || 'Ibiapaba'],
          ['WhatsApp', formatPhone(item.whatsapp)],
          ['Grupo Ramilos', item.is_group ? 'Sim' : 'Não'],
          ['Situação', item.published ? 'Publicada no site' : 'Rascunho']
        ]
      });
    }
    sections.push({
      heading: `Catálogo de Produtos e Serviços (${catalog.length})`,
      note: catalog.length ? 'Itens disponíveis no catálogo da empresa.' : 'Nenhum item cadastrado no catálogo desta empresa.',
      columns: ['#', 'Item / Produto / Serviço', 'Preço / Condição', 'Descrição', 'Situação'],
      rows
    });
    printPdfReport({
      title: item.title,
      kicker: 'EMPRESA DA IBIAPABA · DOSSIÊ INDIVIDUAL',
      subtitle: item.description || `Ficha completa da empresa com produtos, serviços e contatos.`,
      meta: [
        { label: 'Cidade', value: item.city || 'Ibiapaba' },
        { label: 'Categoria', value: item.category || 'Geral' },
        { label: 'WhatsApp', value: formatPhone(item.whatsapp) },
        { label: 'Itens no Catálogo', value: `${catalog.length} ${catalog.length === 1 ? 'item' : 'itens'}` },
        { label: 'Situação', value: item.published ? 'Publicada' : 'Rascunho' }
      ],
      sections,
      footerNote: 'Dossiê individual de empresa gerado pelo Painel Administrativo de Tiago Ismar.'
    });
  }

  function exportGenericItemPdf(item, kind) {
    const kindInfo = kinds[kind] || { title: 'Cadastro', single: 'item' };
    const company = kind === 'catalog_items' ? (data.companies || []).find(c => c.id === item.company_id)?.title : '';
    const rows = [
      ['Título / Nome', item.title || '—'],
      ['Cidade', item.city || '—'],
      ['Situação', item.published ? 'Publicado' : 'Rascunho'],
      item.category ? ['Categoria', item.category] : null,
      company ? ['Empresa Associada', company] : null,
      item.price_text ? ['Preço / Condição', item.price_text] : null,
      item.whatsapp ? ['WhatsApp', formatPhone(item.whatsapp)] : null,
      item.url ? ['Link / URL', item.url] : null,
      item.description ? ['Descrição', item.description] : null
    ].filter(Boolean);
    printPdfReport({
      title: item.title,
      kicker: `${(kindInfo.single || 'item').toUpperCase()} · RELATÓRIO INDIVIDUAL`,
      subtitle: 'Detalhamento individual do cadastro registrado no painel.',
      meta: [
        { label: 'Tipo', value: kindInfo.title || 'Cadastro' },
        { label: 'Cidade', value: item.city || 'Ibiapaba' },
        { label: 'Situação', value: item.published ? 'Publicado' : 'Rascunho' }
      ],
      sections: [
        {
          heading: 'Informações do Cadastro',
          columns: ['Campo', 'Conteúdo'],
          rows
        }
      ],
      footerNote: 'Relatório individual emitido pelo Painel Administrativo de Tiago Ismar.'
    });
  }

  async function exportIndividualRecordPdf(item, kind) {
    if (!item) return;
    if (kind === 'events') return await exportIndividualEventPdf(item);
    if (kind === 'projects') return await exportIndividualProjectPdf(item);
    if (kind === 'companies') return exportIndividualCompanyPdf(item);
    return exportGenericItemPdf(item, kind);
  }
  function renderOwnerPhone(phone) {
    const parts = typeof phone === 'string' && phone.match(/^(\+55)?([1-9]\d)(\d{4,5})(\d{4})$/);
    if (!parts) return node('span', 'Telefone do proprietário não informado');
    const [, country, area, prefix, suffix] = parts;
    const number = `${country ? country + ' ' : ''}(${area}) ${prefix}-${suffix}`;
    const link = node('a', null, 'rsvp-owner-phone');
    link.href = `tel:+55${area}${prefix}${suffix}`;
    link.append(node('span', 'Telefone do proprietário'), node('strong', number));
    return link;
  }
  function renderConfirmationEvent(event) {
    const group = node('section', null, 'panel rsvp-group');
    const head = node('div', null, 'rsvp-group-heading');
    const info = node('div');
    const registrations = event.registrations;
    const title = node('h2', event.title);
    title.id = `rsvp-event-${event.id}`;
    group.setAttribute('aria-labelledby', title.id);
    info.append(title, node('p', confirmationCount(registrations.length), 'muted'));
    head.append(info);
    const headActions = node('div', null, 'rsvp-group-actions');
    const pdfBtn = node('button', 'Exportar PDF', 'secondary');
    pdfBtn.type = 'button';
    pdfBtn.addEventListener('click', () => exportEventRsvpsPdf(event));
    const addBtn = node('button', 'Adicionar presença', 'secondary');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => openRsvpEditor(null, event.id));
    headActions.append(pdfBtn, addBtn);
    if (event.registration_slug && (data.events || []).some(item => item.id === event.id && item.published)) {
      const link = node('a', 'Abrir formulário', 'subtle');
      link.href = `/#inscricao=${encodeURIComponent(event.registration_slug)}`;
      link.target = '_blank';
      link.rel = 'noopener';
      headActions.append(link);
    }
    head.append(headActions);
    group.append(head);
    if (!registrations.length) {
      group.append(node('p', 'Ainda não há confirmações para este evento.', 'muted'));
      return group;
    }
    const list = node('ul', null, 'rsvp-attendees');
    registrations.forEach(registration => {
      const row = node('li', null, 'rsvp-attendee-item');
      const identity = node('div', null, 'rsvp-attendee-info');
      identity.append(
        node('strong', registration.name),
        node('span', registration.enterprise),
        renderOwnerPhone(registration.owner_phone),
      );
      row.append(identity);
      const date = new Date(registration.created_at);
      if (Number.isFinite(date.getTime())) {
        const time = node('time', confirmationDate.format(date));
        time.dateTime = date.toISOString();
        row.append(time);
      }
      const actions = node('div', null, 'rsvp-item-actions');
      const editBtn = node('button', 'Editar', 'subtle rsvp-action-btn');
      editBtn.type = 'button';
      editBtn.addEventListener('click', () => openRsvpEditor(registration, event.id));
      const deleteBtn = node('button', 'Excluir', 'subtle danger rsvp-action-btn');
      deleteBtn.type = 'button';
      deleteBtn.addEventListener('click', () => deleteRsvp(registration, event.id));
      actions.append(editBtn, deleteBtn);
      row.append(actions);
      list.append(row);
    });
    group.append(list);
    return group;
  }
  async function loadConfirmations() {
    clearConfirmations();
    const request = new AbortController();
    confirmationsRequest = request;
    const list = $('#rsvps-list'), status = $('#rsvps-status'), button = $('#refresh-rsvps');
    button.disabled = true;
    status.classList.remove('error');
    status.textContent = 'Carregando confirmações…';
    try {
      const { events, chapel_signups = [] } = await api('/api/admin/rsvps', { signal: request.signal });
      if (request.signal.aborted) return;
      latestConfirmations = { events, chapel_signups };
      status.textContent = '';
      const chapel = (data.projects || []).find(project => project.participation_form === 'capela-de-fatima');
      if (chapel || chapel_signups.length) {
        const group = node('section', null, 'panel rsvp-group');
        const head = node('div', null, 'rsvp-group-heading');
        const info = node('div');
        info.append(
          node('h2', chapel?.title || 'Capela de Nossa Senhora de Fátima'),
          node('p', `${chapel_signups.length} ${chapel_signups.length === 1 ? 'inscrição' : 'inscrições'} · Philippe confere os comprovantes pelo WhatsApp.`, 'muted')
        );
        head.append(info);
        const headActions = node('div', null, 'rsvp-group-actions');
        const pdfBtn = node('button', 'Exportar PDF', 'secondary');
        pdfBtn.type = 'button';
        pdfBtn.addEventListener('click', () => exportChapelSignupsPdf(chapel_signups, chapel?.title));
        headActions.append(pdfBtn);
        if (chapel) {
          const addBtn = node('button', 'Nova inscrição', 'secondary');
          addBtn.type = 'button';
          addBtn.addEventListener('click', () => openSignupEditor(null, chapel.id));
          headActions.append(addBtn);
        }
        head.append(headActions);
        const signups = node('ul', null, 'rsvp-attendees');
        signups.append(...chapel_signups.map(signup => signupRow(signup, chapel?.id)));
        group.append(signups);
        list.append(group);
      }
      if (!events.length && !list.childElementCount) {
        showEmpty(list, 'Nenhum evento com confirmações', 'Ative o formulário de presença no cadastro de um evento.');
        return;
      }
      for (const event of events) list.append(renderConfirmationEvent(event));
      status.textContent = confirmationCount(events.reduce((sum, event) => sum + event.registrations.length, 0));
    } catch {
      if (!request.signal.aborted) {
        list.replaceChildren();
        status.classList.add('error');
        status.textContent = 'Não foi possível carregar as confirmações. Atualize a lista para tentar de novo.';
      }
    } finally {
      if (confirmationsRequest === request) {
        confirmationsRequest = null;
        button.disabled = false;
      }
    }
  }
  function renderOverview() {
    const panel = $('#overview-panel'); panel.replaceChildren();
    const metrics = node('div', null, 'metrics');
    const totalRecords = Object.keys(kinds).reduce((sum, kind) => sum + (data[kind] || []).filter(item => item.published).length, 0);
    [['Aberturas do site hoje', stats.today || 0, 'Uma contagem por aba'], ['Aberturas registradas', stats.total || 0, 'Desde a ativação das estatísticas'], ['Conteúdos publicados', totalRecords, 'Disponíveis no site']].forEach(([title, value, note]) => { const card = node('div', null, 'metric'); card.append(node('p', title), node('strong', Number(value).toLocaleString('pt-BR')), node('small', note)); metrics.append(card); });
    panel.append(metrics);
    const grid = node('div', null, 'dashboard-grid'), history = node('section', null, 'panel'), summary = node('section', null, 'panel');
    history.append(node('h2', 'O movimento por aqui'), node('p', 'Aberturas do site nos últimos 30 dias.', 'muted'));
    const days = stats.last_30_days || [], maximum = Math.max(1, ...days.map(day => day.views));
    const chart = node('div', null, 'chart'); chart.setAttribute('role', 'img'); chart.setAttribute('aria-label', `Visualizações nos últimos 30 dias: ${days.reduce((sum, day) => sum + day.views, 0)}.`);
    days.forEach(day => { const col = node('div', null, 'chart-column'); col.title = `${day.date}: ${day.views} visualizações`; const meter = node('meter'); meter.min = 0; meter.max = maximum; meter.value = day.views; meter.setAttribute('aria-label', col.title); col.append(meter); chart.append(col); });
    history.append(chart); const labels = node('div', null, 'chart-labels'); labels.append(node('span', 'Há 30 dias'), node('span', 'Hoje')); history.append(labels);
    history.append(node('p', 'Contagem agregada, uma vez por aba. Não representa visitantes únicos. Sem histórico anterior à ativação.', 'stats-note'));
    summary.append(node('h2', 'Seu conteúdo')); const list = node('div', null, 'content-summary');
    Object.entries(kinds).forEach(([kind, config]) => { const button = node('button'); button.type = 'button'; const items = data[kind] || []; button.append(node('span', config.title), node('strong', String(items.length))); button.addEventListener('click', () => renderView(kind)); list.append(button); }); summary.append(list);
    const summaryActions = node('div', null, 'toolbar-actions');
    summaryActions.style.marginTop = '18px';
    const pdfReport = node('button', 'Relatório Geral (PDF)', 'secondary');
    pdfReport.type = 'button';
    pdfReport.addEventListener('click', exportOverviewPdf);
    const backup = node('a', 'Baixar cópia do conteúdo', 'secondary');
    backup.href = '/api/admin/export';
    summaryActions.append(pdfReport, backup);
    summary.append(summaryActions);
    grid.append(history, summary); panel.append(grid);
    if (stats.by_section?.length) { const sections = node('section', null, 'panel'); sections.append(node('h2', 'O que desperta interesse')); const labelsBySection = { inicio: 'Início', empresas: 'Empresas', eventos: 'Eventos', projetos: 'Projetos', parceiros: 'Parceiros', olhares: 'Outros olhares', tiago: 'O Tiago', serra: 'A serra', contato: 'Contato' }; stats.by_section.forEach(item => { const row = node('div', null, 'section-stat'); row.append(node('span', labelsBySection[item.section] || item.section), node('strong', Number(item.views).toLocaleString('pt-BR'))); sections.append(row); }); panel.append(sections); }
  }
  function renderRecords() {
    const list = $('#record-list'); list.replaceChildren();
    const terms = normalize($('#record-search').value).split(/\s+/).filter(Boolean), state = $('#record-state').value, city = $('#record-city').value;
    const items = (data[currentView] || []).filter(item => terms.every(term => normalize(`${item.title} ${item.city} ${item.category || ''}`).includes(term)) && (state === 'all' || Boolean(item.published) === (state === 'published')) && (!city || item.city === city));
    $('#record-count').textContent = `${items.length} ${items.length === 1 ? 'cadastro' : 'cadastros'}`;
    if (!items.length) { showEmpty(list, 'Espaço para o próximo passo.', (data[currentView] || []).length ? 'Nenhum cadastro corresponde a esses filtros.' : `Comece adicionando ${currentView === 'catalog_items' ? 'os produtos e serviços das empresas' : `um ${kinds[currentView].single}`}. Você pode salvar como rascunho antes de publicar.`); return; }
    items.slice().sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0) || a.title.localeCompare(b.title, 'pt-BR')).forEach(item => {
      const card = node('article', null, 'record'); const image = safeImage(item.image);
      if (image) { const img = node('img', null, 'record-image'); img.src = image; img.alt = ''; img.loading = 'lazy'; card.append(img); }
      const copy = node('div', null, 'record-copy'); copy.append(node('h3', item.title));
      const company = currentView === 'catalog_items' ? (data.companies || []).find(company => company.id === item.company_id)?.title : '';
      const detail = [item.city, company, currentView === 'projects' ? projectLabels[item.status] : '', currentView === 'events' && item.start_at ? item.start_at.slice(0,10).split('-').reverse().join('/') : ''].filter(Boolean).join(' · ');
      if (detail) copy.append(node('p', detail)); copy.append(node('span', item.published ? 'Publicado' : 'Rascunho', `badge${item.published ? ' live' : ''}`));
      const actions = node('div', null, 'record-actions');
      const edit = node('button', 'Editar', 'secondary'); edit.type = 'button'; edit.setAttribute('aria-label', `Editar ${item.title}`); edit.addEventListener('click', () => openEditor(item));
      actions.append(edit);
      if (currentView === 'events' || currentView === 'projects' || currentView === 'companies') {
        const exportBtn = node('button', 'Exportar PDF', 'secondary');
        exportBtn.type = 'button';
        exportBtn.setAttribute('aria-label', `Exportar PDF de ${item.title}`);
        exportBtn.addEventListener('click', () => exportIndividualRecordPdf(item, currentView));
        actions.append(exportBtn);
      }
      if (currentView === 'projects' && (item.participation_form || item.signup_count > 0)) {
        card.classList.add('has-signups');
        const signups = node('button', 'Ver inscritos', 'secondary signup-trigger');
        signups.type = 'button';
        signups.setAttribute('aria-haspopup', 'dialog');
        signups.setAttribute('aria-label', `Ver inscritos de ${item.title}`);
        signups.addEventListener('click', () => openProjectSignups(item));
        actions.append(signups);
      }
      card.append(copy, actions);
      list.append(card);
    });
  }
  function field(name, label, value = '', options = {}) {
    const wrapper = node('div', null, `field${options.wide ? ' wide' : ''}`), caption = node('label', label); caption.htmlFor = `edit-${name}`;
    let input;
    if (options.choices) { input = node('select'); options.choices.forEach(([v,l]) => input.add(new Option(l,v))); }
    else if (options.multiline) { input = node('textarea'); input.rows = 4; }
    else { input = node('input'); input.type = options.type || 'text'; }
    input.id = `edit-${name}`; input.name = name; input.value = value ?? ''; input.required = Boolean(options.required); if (!options.choices) input.maxLength = options.max || (options.multiline ? 5000 : 200);
    if (options.type === 'number') { input.min = '0'; input.max = '9999'; input.step = '1'; }
    if (name === 'city') input.setAttribute('list', 'city-options');
    if (options.placeholder) input.placeholder = options.placeholder;
    wrapper.append(caption, input);
    if (options.note) {
      const note = node('p', options.note, 'field-note');
      note.id = `edit-${name}-note`;
      input.setAttribute('aria-describedby', note.id);
      wrapper.append(note);
    }
    return wrapper;
  }
  function addEventFields(fields, values) {
    const location = field('location', 'Local do evento', values.location, { max: 250 });
    const start = field('start_at', 'Começa em', values.start_at, { type: 'datetime-local', note: 'Horário do Ceará. Com o formulário de presença ativo, a data pode ficar em aberto.' });
    const end = field('end_at', 'Termina em', values.end_at, { type: 'datetime-local' });
    const registration = field('registration_slug', 'Endereço do formulário de presença', values.registration_slug, {
      wide: true, max: 80, placeholder: 'reuniao-trade-tiangua',
      note: 'Preencha para ativar as confirmações ao publicar. Use letras minúsculas, números e hífens. Mantenha o endereço se já compartilhou o link.',
    });
    const slug = $('input', registration);
    slug.pattern = '[a-z0-9]+(?:-[a-z0-9]+)*';
    slug.autocapitalize = 'none';
    slug.spellcheck = false;
    function updateRequiredFields() {
      const hasRegistration = Boolean(slug.value.trim());
      $('input', location).required = !hasRegistration;
      $('input', start).required = !hasRegistration || Boolean($('input', end).value);
    }
    slug.addEventListener('input', updateRequiredFields);
    $('input', end).addEventListener('input', updateRequiredFields);
    updateRequiredFields();
    fields.append(location, start, end, registration);
  }
  function checkbox(name, label, checked, note) { const wrapper = node('div', null, 'field wide switch-field'), input = node('input'), labelEl = node('label', label); input.type = 'checkbox'; input.name = name; input.id = `edit-${name}`; input.checked = Boolean(checked); labelEl.htmlFor = input.id; if (note) labelEl.append(node('p', note)); wrapper.append(input, labelEl); return wrapper; }
  function imageField(item) {
    const wrapper = node('div', null, 'field wide upload-row'), title = node('label', 'Imagem de capa'); title.htmlFor = 'edit-upload';
    const value = node('input'); value.type = 'hidden'; value.name = 'image'; value.value = item.image || '';
    const preview = node('img', null, 'upload-preview'); preview.alt = 'Prévia da imagem de capa'; preview.hidden = !safeImage(item.image); if (!preview.hidden) preview.src = safeImage(item.image);
    const upload = node('input'); upload.type = 'file'; upload.accept = 'image/jpeg,image/png,image/webp'; upload.id = 'edit-upload';
    const note = node('p', 'JPG, PNG ou WebP. Até 8 MB.', 'field-note'), remove = node('button', 'Remover imagem', 'subtle'); remove.type = 'button'; remove.hidden = !value.value;
    remove.addEventListener('click', () => { value.value = ''; preview.hidden = true; preview.removeAttribute('src'); remove.hidden = true; upload.value = ''; editorDirty = true; });
    upload.addEventListener('change', async () => {
      const file = upload.files[0]; if (!file) return; $('#editor-error').textContent = '';
      if (file.size > 8 * 1024 * 1024) { $('#editor-error').textContent = 'Escolha uma imagem de até 8 MB.'; upload.value = ''; return; }
      uploadBusy = true; $('#save-item').disabled = true; upload.disabled = true; note.textContent = 'Preparando sua imagem…';
      try { const body = new FormData(); body.append('file', file); const result = await api('/api/admin/upload', { method: 'POST', body }); value.value = result.url; preview.src = safeImage(result.url); preview.hidden = false; remove.hidden = false; editorDirty = true; note.textContent = 'Imagem pronta. Salve o cadastro para utilizá-la.'; }
      catch (error) { $('#editor-error').textContent = error.message; note.textContent = 'A imagem não foi enviada.'; }
      finally { uploadBusy = false; $('#save-item').disabled = false; upload.disabled = false; }
    }); wrapper.append(title, preview, upload, value, note, remove); return wrapper;
  }
  function openEditor(item = null) {
    if (currentView === 'catalog_items' && !(data.companies || []).length) { notify('Cadastre uma empresa antes de adicionar produtos ou serviços.', true); return; }
    editing = item ? { ...item } : null; editorDirty = false;
    const values = item || {}, fields = $('#editor-fields'); fields.replaceChildren(); $('#editor-error').textContent = '';
    $('#editor-title').textContent = `${item ? 'Editar' : 'Adicionar'} ${kinds[currentView].single}`;
    $('#delete-item').hidden = !item;
    const exportEditorBtn = $('#export-editor-item');
    if (exportEditorBtn) exportEditorBtn.hidden = !item;
    fields.append(field('title', currentView === 'partners' || currentView === 'companies' ? 'Nome do empreendimento' : 'Título', values.title, { required: true, wide: true, max: 160 }));
    if (currentView === 'catalog_items') fields.append(field('company_id', 'Empresa', values.company_id || (data.companies || [])[0]?.id, { required: true, choices: (data.companies || []).map(company => [company.id, company.title]), wide: true }));
    else fields.append(field('city', 'Cidade', values.city || 'Tianguá', { required: true, max: 100, wide: currentView === 'partners' }));
    if (currentView === 'companies') { fields.append(field('category', 'Categoria', values.category, { max: 100, placeholder: 'Ex.: hospedagem, gastronomia' }), field('whatsapp', 'WhatsApp da empresa', values.whatsapp, { type: 'tel', max: 20, note: 'Código do país, DDD e número.' })); }
    if (currentView === 'events') addEventFields(fields, values);
    if (currentView === 'projects') fields.append(field('status', 'Etapa do projeto', values.status || 'idea', { choices: Object.entries(projectLabels) }),
      field('participation_form', 'Formulário de participação', values.participation_form, { wide: true, choices: [['', 'Sem formulário'], ['capela-de-fatima', 'Benfeitores da Capela de Nossa Senhora de Fátima']] }));
    if (currentView === 'catalog_items') fields.append(field('price_text', 'Preço ou condição', values.price_text, { max: 100, placeholder: 'Ex.: R$ 120 ou Sob consulta', wide: true }));
    if (currentView !== 'partners') { fields.append(field('description', 'Descrição', values.description, { multiline: true, wide: true })); fields.append(field('url', currentView === 'events' ? 'Link de inscrição ou informações' : 'Site ou link para saber mais', values.url, { type: 'url', wide: true, max: 1200, placeholder: 'https://' })); fields.append(imageField(values)); }
    if (currentView === 'companies') fields.append(checkbox('is_group', 'Faz parte do Grupo Ramilos', values.is_group, 'Marque apenas para empresas que pertencem ao grupo.'));
    fields.append(field('sort_order', 'Ordem de exibição', values.sort_order || 0, { type: 'number', note: 'Números menores aparecem primeiro.' }));
    fields.append(checkbox('published', 'Publicar no site', values.published, 'Desmarcado, o cadastro fica salvo como rascunho, visível apenas aqui.'));
    $('#editor').showModal(); $('#editor').scrollTop = 0; $('#edit-title').focus({ preventScroll: true });
  }
  function closeEditor() { if (uploadBusy) return; if (editorDirty && !window.confirm('Sair sem salvar as alterações deste cadastro?')) return; $('#editor').close(); }
  function updateLimitField() {
    const limited = $('#chapel-limit-mode').value === 'limited';
    $('#chapel-limit-field').hidden = !limited;
    $('#chapel-limit-value').disabled = !limited;
  }
  function fillSettings() {
    const values = data.settings;
    $$('input[name],textarea[name]', $('#settings-form')).forEach(input => { input.value = values[input.name] || ''; });
    $('#chapel-limit-mode').value = values.chapel_name_limit === '' ? 'unlimited' : 'limited';
    $('#chapel-limit-value').value = values.chapel_name_limit;
    $('#chapel-limit-status').textContent = '';
    updateLimitField();
  }
  $('#chapel-limit-mode').addEventListener('change', updateLimitField);
  $('#chapel-limit-form').addEventListener('input', () => { $('#chapel-limit-status').textContent = ''; });
  $('#chapel-limit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = $('#chapel-limit-mode'), input = $('#chapel-limit-value'), status = $('#chapel-limit-status');
    const submit = $('button[type=submit]', event.target);
    if (submit.disabled) return;
    const value = mode.value === 'limited' ? String(input.valueAsNumber) : '';
    submit.disabled = mode.disabled = input.disabled = true;
    status.textContent = 'Salvando…';
    try {
      const result = await api('/api/admin/settings', { method: 'PATCH', body: { chapel_name_limit: value } });
      data.settings = result.settings;
      status.textContent = value ? `Limite de ${value} ${value === '1' ? 'nome' : 'nomes'} salvo.` : 'Inscrições abertas sem limite de nomes.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = mode.disabled = false;
      updateLimitField();
    }
  });
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type=submit]', event.target); button.disabled = true; $('#login-error').textContent = '';
    try { await api('/api/admin/session'); await api('/api/admin/login', { method: 'POST', body: { username: $('#username').value.trim(), password: $('#password').value } }); $('#password').value = ''; await showAdmin(); }
    catch (error) { $('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#show-password').addEventListener('click', () => { const visible = $('#password').type === 'password'; $('#password').type = visible ? 'text' : 'password'; $('#show-password').textContent = visible ? 'Ocultar' : 'Mostrar'; $('#show-password').setAttribute('aria-pressed', String(visible)); });
  $('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST', body: {} }); showLogin(); } catch (error) { notify(error.message, true); } });
  $('#admin-nav').addEventListener('click', (event) => { const button = event.target.closest('[data-view]'); if (button) renderView(button.dataset.view); });
  $('#refresh-rsvps').addEventListener('click', loadConfirmations);
  $('#export-all-rsvps-pdf')?.addEventListener('click', exportAllRsvpsPdf);
  $('#export-signups-pdf')?.addEventListener('click', exportProjectModalSignupsPdf);
  $('#export-editor-item')?.addEventListener('click', () => {
    if (editing) exportIndividualRecordPdf(editing, currentView);
  });
  $('#add-item').addEventListener('click', () => openEditor());
  ['record-search', 'record-state', 'record-city'].forEach(id => $(`#${id}`).addEventListener(id === 'record-search' ? 'input' : 'change', renderRecords));
  $('#editor-form').addEventListener('input', () => { editorDirty = true; });
  $('#close-editor').addEventListener('click', closeEditor);
  $('#editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  $('#editor-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (uploadBusy) return;
    const button = $('#save-item'); button.disabled = true; $('#editor-error').textContent = '';
    const payload = {};
    $$('input[name],textarea[name],select[name]', event.target).forEach(input => { payload[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value || 0) : input.value.trim(); });
    if (payload.whatsapp) payload.whatsapp = payload.whatsapp.replace(/\D/g, '');
    if (editing) payload.version = editing.version;
    try { await api(`/api/admin/${currentView}${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, { method: editing ? 'PATCH' : 'POST', body: payload }); editorDirty = false; $('#editor').close(); await loadData(); renderView(currentView); notify(payload.published ? 'Cadastro salvo e publicado no site.' : 'Rascunho salvo. Você pode continuar depois.'); }
    catch (error) { $('#editor-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#close-rsvp-dialog').addEventListener('click', () => rsvpDialog.close());
  $('#cancel-rsvp-dialog').addEventListener('click', () => rsvpDialog.close());
  $('#rsvp-dialog-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentRsvpTarget) return;
    const saveBtn = $('#save-rsvp-dialog');
    saveBtn.disabled = true;
    $('#rsvp-dialog-error').textContent = '';
    const body = {
      name: $('#rsvp-name').value.trim(),
      enterprise: $('#rsvp-enterprise').value.trim(),
      owner_phone: $('#rsvp-phone').value.trim(),
    };
    try {
      if (currentRsvpTarget.mode === 'create') {
        await api(`/api/admin/events/${encodeURIComponent(currentRsvpTarget.eventId)}/rsvps`, { method: 'POST', body });
        notify('Presença adicionada com sucesso.');
      } else {
        await api(`/api/admin/events/${encodeURIComponent(currentRsvpTarget.eventId)}/rsvps/${encodeURIComponent(currentRsvpTarget.participantKey)}`, { method: 'PATCH', body });
        notify('Confirmação atualizada com sucesso.');
      }
      rsvpDialog.close();
      loadConfirmations();
    } catch (err) {
      $('#rsvp-dialog-error').textContent = err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });

  $('#close-signup-dialog').addEventListener('click', () => signupDialogEl.close());
  $('#cancel-signup-dialog').addEventListener('click', () => signupDialogEl.close());
  $('#signup-dialog-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentSignupTarget) return;
    const saveBtn = $('#save-signup-dialog');
    saveBtn.disabled = true;
    $('#signup-dialog-error').textContent = '';
    const body = {
      name: $('#signup-name').value.trim(),
      tribute_name: $('#signup-tribute').value.trim(),
    };
    try {
      if (currentSignupTarget.mode === 'create') {
        await api(`/api/admin/projects/${encodeURIComponent(currentSignupTarget.projectId)}/signups`, { method: 'POST', body });
        notify('Inscrição adicionada com sucesso.');
      } else {
        await api(`/api/admin/projects/${encodeURIComponent(currentSignupTarget.projectId)}/signups/${encodeURIComponent(currentSignupTarget.submissionId)}`, { method: 'PATCH', body });
        notify('Inscrição atualizada com sucesso.');
      }
      signupDialogEl.close();
      if (signupDialog.open) loadProjectSignups();
      if (!$('#rsvps-panel').hidden) loadConfirmations();
      await loadData();
      if (currentView === 'projects') renderView('projects');
    } catch (err) {
      $('#signup-dialog-error').textContent = err.message;
    } finally {
      saveBtn.disabled = false;
    }
  });

  $('#add-project-signup').addEventListener('click', () => {
    if (!signupDialog.dataset.projectId) return;
    openSignupEditor(null, signupDialog.dataset.projectId);
  });

  $('#delete-item').addEventListener('click', () => {
    if (!editing) return;
    onConfirmAction = null;
    $('#confirm-title').textContent = 'Excluir este cadastro?';
    $('#confirm-text').textContent = `“${editing.title}” deixará de aparecer no painel e no site. ${currentView === 'companies' ? 'Os itens do catálogo desta empresa também serão excluídos.' : ''}`;
    $('#confirm-delete').textContent = 'Excluir';
    $('#confirm-dialog').showModal();
  });
  $('#cancel-delete').addEventListener('click', () => {
    onConfirmAction = null;
    $('#confirm-dialog').close();
  });
  $('#confirm-dialog').addEventListener('close', () => {
    onConfirmAction = null;
    $('#confirm-delete').textContent = 'Excluir';
  });
  $('#confirm-delete').addEventListener('click', async () => {
    if (deleting) return;
    deleting = true;
    $('#confirm-delete').disabled = true;
    try {
      if (onConfirmAction) {
        await onConfirmAction();
        $('#confirm-dialog').close();
      } else if (editing) {
        await api(`/api/admin/${currentView}/${encodeURIComponent(editing.id)}`, { method: 'DELETE', body: { version: editing.version } });
        $('#confirm-dialog').close();
        $('#editor').close();
        editorDirty = false;
        await loadData();
        renderView(currentView);
        notify('Cadastro excluído.');
      }
    } catch (error) {
      $('#confirm-dialog').close();
      if ($('#editor').open) $('#editor-error').textContent = error.message;
      else notify(error.message, true);
    } finally {
      deleting = false;
      $('#confirm-delete').disabled = false;
      onConfirmAction = null;
    }
  });
  $('#settings-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = $('button[type=submit]', event.target); button.disabled = true; const payload = Object.fromEntries(new FormData(event.target)); payload.contact_whatsapp = payload.contact_whatsapp.replace(/\D/g, ''); try { const result = await api('/api/admin/settings', { method: 'PATCH', body: payload }); data.settings = result.settings; notify('Textos e contato atualizados.'); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } });
  window.addEventListener('beforeunload', event => { if ($('#editor').open && editorDirty) { event.preventDefault(); event.returnValue = ''; } });
  (async () => { try { const session = await api('/api/admin/session'); if (session.authenticated) await showAdmin(); else showLogin(); } catch { showLogin(); $('#login-error').textContent = 'O painel ainda não está disponível. Confira se o serviço de administração foi instalado no servidor.'; } })();
})();
