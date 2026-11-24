(() => {
  'use strict';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  const admin = () => window.TiagoAdmin;
  const typeLabels = { single: 'Uma opção', multiple: 'Várias opções', scale: 'Nota de 1 a 5', text: 'Resposta escrita' };
  let surveys = [], editing = null, request = 0;

  const count = (total) => `${total.toLocaleString('pt-BR')} ${total === 1 ? 'resposta' : 'respostas'}`;
  const presentUrl = (survey) => `/admin/apresentar?id=${encodeURIComponent(survey.id)}`;

  async function load() {
    const ticket = ++request;
    $('#surveys-status').textContent = 'Carregando pesquisas…';
    try {
      const result = await admin().api('/api/admin/surveys');
      if (ticket !== request) return;
      surveys = result.surveys;
      render();
    } catch (error) {
      if (ticket === request) $('#surveys-status').textContent = error.message;
    }
  }

  function action(label, className, handler, href) {
    const el = node(href ? 'a' : 'button', label, className);
    if (href) { el.href = href; el.target = '_blank'; el.rel = 'noopener'; }
    else { el.type = 'button'; el.addEventListener('click', handler); }
    return el;
  }

  function render() {
    const list = $('#surveys-list');
    list.replaceChildren();
    $('#surveys-status').textContent = surveys.length ? `${surveys.length} ${surveys.length === 1 ? 'pesquisa' : 'pesquisas'}` : '';
    if (!surveys.length) {
      const empty = node('div', null, 'empty');
      empty.append(node('h2', 'Nenhuma pesquisa ainda'), node('p', 'Crie uma pesquisa anônima, gere o QR code e acompanhe os gráficos.'));
      list.append(empty);
      return;
    }
    surveys.forEach(survey => {
      const card = node('article', null, 'survey-card');
      const head = node('div', null, 'survey-card-head');
      const info = node('div');
      const state = node('span', survey.open ? 'Aberta' : 'Encerrada', `survey-state ${survey.open ? 'open' : 'closed'}`);
      info.append(state, node('h2', survey.title), node('p', `${survey.questions.length} perguntas · ${count(survey.responses)}`, 'muted'));
      const big = node('strong', survey.responses.toLocaleString('pt-BR'), 'survey-count');
      big.setAttribute('aria-hidden', 'true');
      head.append(info, big);
      const link = node('a', survey.link.replace(/^https?:\/\//, ''), 'survey-link');
      link.href = survey.link; link.target = '_blank'; link.rel = 'noopener';
      const actions = node('div', null, 'toolbar-actions');
      actions.append(
        action('Ver gráficos', 'primary', null, presentUrl(survey)),
        action('QR code', 'secondary', () => openQr(survey)),
        action('Editar', 'secondary', () => openEditor(survey)),
        action(survey.open ? 'Encerrar' : 'Reabrir', 'secondary', () => toggle(survey)),
      );
      const more = node('div', null, 'toolbar-actions survey-danger');
      more.append(
        action('Apagar respostas', 'subtle danger', () => clearResponses(survey)),
        action('Excluir pesquisa', 'subtle danger', () => remove(survey)),
      );
      card.append(head, link, actions, more);
      list.append(card);
    });
  }

  async function toggle(survey) {
    try {
      await admin().api(`/api/admin/surveys/${encodeURIComponent(survey.id)}`, { method: 'PATCH', body: { open: !survey.open } });
      admin().notify(survey.open ? 'Pesquisa encerrada. O link agora avisa que ela terminou.' : 'Pesquisa reaberta para respostas.');
      load();
    } catch (error) { admin().notify(error.message, true); }
  }

  function clearResponses(survey) {
    admin().ask('Apagar todas as respostas?', `As ${count(survey.responses)} de “${survey.title}” serão apagadas de vez. Use isto para limpar testes antes da reunião.`, async () => {
      await admin().api(`/api/admin/surveys/${encodeURIComponent(survey.id)}/responses`, { method: 'DELETE' });
      admin().notify('Respostas apagadas.');
      load();
    }, 'Apagar respostas');
  }

  function remove(survey) {
    admin().ask('Excluir esta pesquisa?', `“${survey.title}” deixa de abrir pelo QR code e sai do painel.`, async () => {
      await admin().api(`/api/admin/surveys/${encodeURIComponent(survey.id)}`, { method: 'DELETE' });
      admin().notify('Pesquisa excluída.');
      load();
    });
  }

  function openQr(survey) {
    const base = `/api/admin/surveys/${encodeURIComponent(survey.id)}/qr`;
    $('#survey-qr-title').textContent = survey.title;
    $('#survey-qr-image').src = `${base}.svg?v=${encodeURIComponent(survey.slug)}`;
    $('#survey-qr-png').href = `${base}.png?download=1`;
    $('#survey-qr-svg').href = `${base}.svg?download=1`;
    $('#survey-qr-link').href = survey.link;
    $('#survey-qr-link').textContent = survey.link;
    $('#survey-qr-status').textContent = survey.open ? '' : 'Atenção: a pesquisa está encerrada. Reabra para receber respostas.';
    $('#survey-qr-copy').onclick = async () => {
      try { await navigator.clipboard.writeText(survey.link); $('#survey-qr-status').textContent = 'Link copiado.'; }
      catch { $('#survey-qr-status').textContent = survey.link; }
    };
    $('#survey-qr').showModal();
  }

  function slugify(value) {
    return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }

  function questionEditor(question, index, locked) {
    const box = node('fieldset', null, 'survey-question');
    box.disabled = locked;
    box.dataset.id = question.id || '';
    const legend = node('legend', `Pergunta ${index + 1}`);
    const tools = node('div', null, 'survey-question-tools');
    const up = node('button', null, 'round'); up.type = 'button'; up.setAttribute('aria-label', `Subir pergunta ${index + 1}`);
    up.innerHTML = '<svg aria-hidden="true"><use href="/assets/icons/lucide.svg#arrow-up"></use></svg>';
    const down = node('button', null, 'round'); down.type = 'button'; down.setAttribute('aria-label', `Descer pergunta ${index + 1}`);
    down.innerHTML = '<svg aria-hidden="true"><use href="/assets/icons/lucide.svg#arrow-down"></use></svg>';
    const del = node('button', null, 'round'); del.type = 'button'; del.setAttribute('aria-label', `Remover pergunta ${index + 1}`);
    del.innerHTML = '<svg aria-hidden="true"><use href="/assets/icons/lucide.svg#x"></use></svg>';
    up.addEventListener('click', () => move(index, -1));
    down.addEventListener('click', () => move(index, 1));
    del.addEventListener('click', () => { readQuestions(); editing.questions.splice(index, 1); drawQuestions(); });
    tools.append(up, down, del);
    const text = node('label', 'Texto da pergunta'); const textInput = node('textarea'); textInput.rows = 2; textInput.maxLength = 300; textInput.name = 'text'; textInput.value = question.text || ''; text.append(textInput);
    const type = node('label', 'Tipo de resposta'); const select = node('select'); select.name = 'type';
    Object.entries(typeLabels).forEach(([value, label]) => select.add(new Option(label, value, false, value === question.type)));
    type.append(select);
    const options = node('label', 'Opções (uma por linha)'); const optionsInput = node('textarea'); optionsInput.rows = 5; optionsInput.name = 'options'; optionsInput.value = (question.options || []).join('\n'); options.append(optionsInput);
    const max = node('label', 'Quantas opções a pessoa pode marcar'); const maxInput = node('input'); maxInput.type = 'number'; maxInput.min = 1; maxInput.max = 15; maxInput.name = 'max'; maxInput.value = question.max || 3; max.append(maxInput);
    const minLabel = node('label', 'Rótulo da nota 1'); const minInput = node('input'); minInput.name = 'min_label'; minInput.maxLength = 40; minInput.value = question.min_label || ''; minInput.placeholder = 'Muito ruim'; minLabel.append(minInput);
    const maxLabel = node('label', 'Rótulo da nota 5'); const maxLabelInput = node('input'); maxLabelInput.name = 'max_label'; maxLabelInput.maxLength = 40; maxLabelInput.value = question.max_label || ''; maxLabelInput.placeholder = 'Muito bom'; maxLabel.append(maxLabelInput);
    const required = node('label', null, 'inline-check'); const requiredInput = node('input'); requiredInput.type = 'checkbox'; requiredInput.name = 'required'; requiredInput.checked = question.required !== false; required.append(requiredInput, document.createTextNode(' Obrigatória'));
    const sync = () => {
      const kind = select.value;
      options.hidden = !['single', 'multiple'].includes(kind);
      max.hidden = kind !== 'multiple';
      minLabel.hidden = maxLabel.hidden = kind !== 'scale';
    };
    select.addEventListener('change', sync); sync();
    box.append(legend, tools, text, type, options, max, minLabel, maxLabel, required);
    return box;
  }

  function readQuestions() {
    editing.questions = [...$('#survey-questions').querySelectorAll('.survey-question')].map(box => {
      const value = (name) => box.querySelector(`[name="${name}"]`);
      const question = { type: value('type').value, text: value('text').value.trim(), required: value('required').checked };
      if (box.dataset.id) question.id = box.dataset.id;
      if (['single', 'multiple'].includes(question.type)) question.options = value('options').value.split('\n').map(item => item.trim()).filter(Boolean);
      if (question.type === 'multiple') question.max = Number(value('max').value || 1);
      if (question.type === 'scale') { question.min_label = value('min_label').value.trim(); question.max_label = value('max_label').value.trim(); }
      return question;
    });
    return editing.questions;
  }

  function move(index, step) {
    readQuestions();
    const target = index + step;
    if (target < 0 || target >= editing.questions.length) return;
    [editing.questions[index], editing.questions[target]] = [editing.questions[target], editing.questions[index]];
    drawQuestions();
  }

  function drawQuestions() {
    const locked = Boolean(editing.responses);
    $('#survey-questions').replaceChildren(...editing.questions.map((question, index) => questionEditor(question, index, locked)));
    $('#add-survey-question').hidden = locked;
    $('#survey-locked').hidden = !locked;
  }

  function openEditor(survey) {
    editing = survey ? JSON.parse(JSON.stringify(survey)) : { title: '', slug: '', intro: 'É anônima: não pedimos nome, telefone nem empresa.', thanks: 'Obrigado por participar!', open: true, responses: 0, questions: [{ type: 'single', text: '', options: [], required: true }] };
    $('#survey-editor-title').textContent = survey ? 'Editar pesquisa' : 'Nova pesquisa';
    $('#survey-title').value = editing.title;
    $('#survey-slug').value = editing.slug;
    $('#survey-slug').dataset.touched = survey ? '1' : '';
    $('#survey-intro').value = editing.intro || '';
    $('#survey-thanks').value = editing.thanks || '';
    $('#survey-open').checked = Boolean(editing.open);
    $('#survey-editor-error').textContent = '';
    drawQuestions();
    $('#survey-editor').showModal();
    $('#survey-title').focus();
  }

  async function save(event) {
    event.preventDefault();
    const button = $('#save-survey');
    $('#survey-editor-error').textContent = '';
    const body = {
      title: $('#survey-title').value.trim(), slug: $('#survey-slug').value.trim(),
      intro: $('#survey-intro').value.trim(), thanks: $('#survey-thanks').value.trim(), open: $('#survey-open').checked,
    };
    if (!editing.responses) body.questions = readQuestions();
    button.disabled = true;
    try {
      await admin().api(editing.id ? `/api/admin/surveys/${encodeURIComponent(editing.id)}` : '/api/admin/surveys', { method: editing.id ? 'PATCH' : 'POST', body });
      $('#survey-editor').close();
      admin().notify('Pesquisa salva.');
      load();
    } catch (error) {
      $('#survey-editor-error').textContent = error.message;
    } finally { button.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('#new-survey').addEventListener('click', () => openEditor(null));
    $('#refresh-surveys').addEventListener('click', load);
    $('#close-survey-qr').addEventListener('click', () => $('#survey-qr').close());
    $('#close-survey-editor').addEventListener('click', () => $('#survey-editor').close());
    $('#cancel-survey-editor').addEventListener('click', () => $('#survey-editor').close());
    $('#survey-editor-form').addEventListener('submit', save);
    $('#add-survey-question').addEventListener('click', () => { readQuestions(); editing.questions.push({ type: 'single', text: '', options: [], required: true }); drawQuestions(); $('#survey-questions').lastElementChild?.querySelector('textarea')?.focus(); });
    $('#survey-title').addEventListener('input', () => { if (!$('#survey-slug').dataset.touched) $('#survey-slug').value = slugify($('#survey-title').value); });
    $('#survey-slug').addEventListener('input', () => { $('#survey-slug').dataset.touched = '1'; });
  });

  window.TiagoSurveys = { show: load };
})();
