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
    settings: { title: 'Textos e contato', description: 'A apresentação do site, do seu jeito.' },
    rsvps: { title: 'Confirmações', description: 'Veja quem confirmou presença nos eventos do site.' },
  };
  const projectLabels = { idea: 'Ideia', planning: 'Em planejamento', in_progress: 'Em andamento', completed: 'Concluído' };
  const confirmationDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' });
  let csrf = '', data = {}, stats = {}, currentView = 'overview', editing = null, editorDirty = false, uploadBusy = false, deleting = false;
  let confirmationsRequest = null;
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
  function showLogin() { $('#boot').hidden = true; $('#admin-view').hidden = true; $('#login-view').hidden = false; if ($('#editor').open) $('#editor').close(); if ($('#confirm-dialog').open) $('#confirm-dialog').close(); clearConfirmations(); data = {}; }
  async function loadData() { data = await api('/api/admin/content'); }
  async function showAdmin() {
    await loadData();
    stats = await api('/api/admin/stats');
    $('#boot').hidden = true; $('#login-view').hidden = true; $('#admin-view').hidden = false;
    renderView(currentView);
  }
  function showEmpty(parent, title, description) { const el = node('div', null, 'empty'); el.append(node('h2', title), node('p', description)); parent.append(el); }
  function safeImage(value) { if (!value) return ''; try { const u = new URL(value, location.origin); return u.origin === location.origin && /^\/(assets|media)\//.test(u.pathname) ? u.href : u.protocol === 'https:' ? u.href : ''; } catch { return ''; } }
  function renderView(view) {
    currentView = view;
    $$('#admin-nav button').forEach(button => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $('#overview-panel').hidden = view !== 'overview'; $('#records-panel').hidden = !kinds[view]; $('#settings-panel').hidden = view !== 'settings'; $('#add-item').hidden = !kinds[view];
    $('#rsvps-panel').hidden = view !== 'rsvps';
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
    if (event.registration_slug && (data.events || []).some(item => item.id === event.id && item.published)) {
      const link = node('a', 'Abrir formulário', 'secondary');
      link.href = `/#inscricao=${encodeURIComponent(event.registration_slug)}`;
      link.target = '_blank';
      link.rel = 'noopener';
      head.append(link);
    }
    group.append(head);
    if (!registrations.length) {
      group.append(node('p', 'Ainda não há confirmações para este evento.', 'muted'));
      return group;
    }
    const list = node('ul', null, 'rsvp-attendees');
    registrations.forEach(registration => {
      const row = node('li');
      const identity = node('div');
      identity.append(node('strong', registration.name), node('span', registration.enterprise));
      row.append(identity);
      const date = new Date(registration.created_at);
      if (Number.isFinite(date.getTime())) {
        const time = node('time', confirmationDate.format(date));
        time.dateTime = date.toISOString();
        row.append(time);
      }
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
      const { events } = await api('/api/admin/rsvps', { signal: request.signal });
      if (request.signal.aborted) return;
      status.textContent = '';
      if (!events.length) {
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
    const backup = node('a', 'Baixar cópia do conteúdo', 'secondary'); backup.href = '/api/admin/export'; summary.append(backup);
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
      const edit = node('button', 'Editar', 'secondary'); edit.type = 'button'; edit.setAttribute('aria-label', `Editar ${item.title}`); edit.addEventListener('click', () => openEditor(item)); card.append(copy, edit); list.append(card);
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
    fields.append(field('title', currentView === 'partners' || currentView === 'companies' ? 'Nome do empreendimento' : 'Título', values.title, { required: true, wide: true, max: 160 }));
    if (currentView === 'catalog_items') fields.append(field('company_id', 'Empresa', values.company_id || (data.companies || [])[0]?.id, { required: true, choices: (data.companies || []).map(company => [company.id, company.title]), wide: true }));
    else fields.append(field('city', 'Cidade', values.city || 'Tianguá', { required: true, max: 100, wide: currentView === 'partners' }));
    if (currentView === 'companies') { fields.append(field('category', 'Categoria', values.category, { max: 100, placeholder: 'Ex.: hospedagem, gastronomia' }), field('whatsapp', 'WhatsApp da empresa', values.whatsapp, { type: 'tel', max: 20, note: 'Código do país, DDD e número.' })); }
    if (currentView === 'events') addEventFields(fields, values);
    if (currentView === 'projects') fields.append(field('status', 'Etapa do projeto', values.status || 'idea', { choices: Object.entries(projectLabels) }));
    if (currentView === 'catalog_items') fields.append(field('price_text', 'Preço ou condição', values.price_text, { max: 100, placeholder: 'Ex.: R$ 120 ou Sob consulta', wide: true }));
    if (currentView !== 'partners') { fields.append(field('description', 'Descrição', values.description, { multiline: true, wide: true })); fields.append(field('url', currentView === 'events' ? 'Link de inscrição ou informações' : 'Site ou link para saber mais', values.url, { type: 'url', wide: true, max: 1200, placeholder: 'https://' })); fields.append(imageField(values)); }
    if (currentView === 'companies') fields.append(checkbox('is_group', 'Faz parte do Grupo Ramilos', values.is_group, 'Marque apenas para empresas que pertencem ao grupo.'));
    fields.append(field('sort_order', 'Ordem de exibição', values.sort_order || 0, { type: 'number', note: 'Números menores aparecem primeiro.' }));
    fields.append(checkbox('published', 'Publicar no site', values.published, 'Desmarcado, o cadastro fica salvo como rascunho, visível apenas aqui.'));
    $('#editor').showModal(); $('#editor').scrollTop = 0; $('#edit-title').focus({ preventScroll: true });
  }
  function closeEditor() { if (uploadBusy) return; if (editorDirty && !window.confirm('Sair sem salvar as alterações deste cadastro?')) return; $('#editor').close(); }
  function fillSettings() { const values = data.settings || {}; $$('input[name],textarea[name]', $('#settings-form')).forEach(input => { input.value = values[input.name] || ''; }); }
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
  $('#delete-item').addEventListener('click', () => { if (!editing) return; $('#confirm-text').textContent = `“${editing.title}” deixará de aparecer no painel e no site. ${currentView === 'companies' ? 'Os itens do catálogo desta empresa também serão excluídos.' : ''}`; $('#confirm-dialog').showModal(); });
  $('#cancel-delete').addEventListener('click', () => $('#confirm-dialog').close());
  $('#confirm-delete').addEventListener('click', async () => { if (deleting || !editing) return; deleting = true; $('#confirm-delete').disabled = true; try { await api(`/api/admin/${currentView}/${encodeURIComponent(editing.id)}`, { method: 'DELETE', body: { version: editing.version } }); $('#confirm-dialog').close(); $('#editor').close(); editorDirty = false; await loadData(); renderView(currentView); notify('Cadastro excluído.'); } catch (error) { $('#confirm-dialog').close(); $('#editor-error').textContent = error.message; } finally { deleting = false; $('#confirm-delete').disabled = false; } });
  $('#settings-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = $('button[type=submit]', event.target); button.disabled = true; const payload = Object.fromEntries(new FormData(event.target)); payload.contact_whatsapp = payload.contact_whatsapp.replace(/\D/g, ''); try { const result = await api('/api/admin/settings', { method: 'PATCH', body: payload }); data.settings = result.settings; notify('Textos e contato atualizados.'); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } });
  window.addEventListener('beforeunload', event => { if ($('#editor').open && editorDirty) { event.preventDefault(); event.returnValue = ''; } });
  (async () => { try { const session = await api('/api/admin/session'); if (session.authenticated) await showAdmin(); else showLogin(); } catch { showLogin(); $('#login-error').textContent = 'O painel ainda não está disponível. Confira se o serviço de administração foi instalado no servidor.'; } })();
})();
