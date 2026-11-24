(() => {
  'use strict';
  const root = document.querySelector('#survey');
  const slug = (new URLSearchParams(location.search).get('s') || '').trim().toLowerCase();
  const doneKey = `pesquisa-respondida:${slug}`;
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const icon = (name) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `/assets/icons/lucide.svg#${name}`);
    svg.append(use);
    return svg;
  };
  const remembered = () => { try { return localStorage.getItem(doneKey) === '1'; } catch { return false; } };
  const remember = (value) => { try { if (value) localStorage.setItem(doneKey, '1'); else localStorage.removeItem(doneKey); } catch { /* private mode */ } };
  let survey = null;

  function message(title, text) {
    const box = el('div', 'done');
    box.append(el('h1', null, title), el('p', null, text));
    root.replaceChildren(box);
    return box;
  }

  function showThanks(text) {
    const box = el('div', 'done');
    const check = el('div', 'check'); check.append(icon('check'));
    box.append(check, el('h1', null, 'Resposta enviada.'), el('p', null, text || 'Obrigado por participar!'));
    const again = el('button', 'secondary', 'Outra pessoa vai responder neste celular');
    again.type = 'button';
    again.addEventListener('click', () => { remember(false); render(); });
    box.append(again);
    root.replaceChildren(box);
    scrollTo({ top: 0 });
    document.title = `Obrigado · ${survey.title}`;
  }

  function optionInput(question, value, label, multi, index) {
    const wrap = el('label', `option${multi ? ' multi' : ''}`);
    const input = el('input');
    input.type = multi ? 'checkbox' : 'radio';
    input.name = question.id;
    input.value = String(value);
    input.id = `${question.id}-${index}`;
    const mark = el('span', 'mark'); mark.append(icon('check'));
    wrap.append(input, mark, el('span', null, label));
    return wrap;
  }

  function questionBlock(question, number, total) {
    const isText = question.type === 'text';
    const block = el(isText ? 'div' : 'fieldset', 'question');
    block.dataset.id = question.id;
    const title = el(isText ? 'label' : 'legend', isText ? 'q-label' : null);
    title.append(el('span', 'q-number', `PERGUNTA ${number} DE ${total}${question.required ? '' : ' · OPCIONAL'}`), document.createTextNode(question.text));
    if (question.type === 'multiple' && question.max < question.options.length) title.append(el('span', 'q-hint', `Marque até ${question.max}.`));
    block.append(title);
    if (question.type === 'single' || question.type === 'multiple') {
      const list = el('div', `options${question.options.length > 5 && question.options.every(o => o.length < 34) ? ' two' : ''}`);
      question.options.forEach((option, index) => list.append(optionInput(question, option, option, question.type === 'multiple', index)));
      block.append(list);
      if (question.type === 'multiple') {
        list.addEventListener('change', () => {
          const checked = list.querySelectorAll('input:checked').length;
          list.querySelectorAll('input').forEach(input => { input.disabled = !input.checked && checked >= question.max; });
        });
      }
    } else if (question.type === 'scale') {
      const list = el('div', 'scale');
      for (let score = 1; score <= 5; score += 1) {
        const option = optionInput(question, score, String(score), false, score);
        option.querySelector('input').setAttribute('aria-label', `${score}${score === 1 && question.min_label ? ` (${question.min_label})` : ''}${score === 5 && question.max_label ? ` (${question.max_label})` : ''}`);
        list.append(option);
      }
      block.append(list);
      if (question.min_label || question.max_label) {
        const labels = el('div', 'scale-labels');
        labels.append(el('span', null, `1 · ${question.min_label}`), el('span', null, `${question.max_label} · 5`));
        block.append(labels);
      }
    } else {
      const area = el('textarea');
      area.name = question.id; area.id = `q-${question.id}`; area.maxLength = 1000; area.rows = 4;
      area.placeholder = 'Escreva aqui, se quiser.';
      title.htmlFor = area.id;
      const count = el('div', 'char-count', '0/1000');
      area.addEventListener('input', () => { count.textContent = `${area.value.length}/1000`; });
      block.append(area, count);
    }
    const error = el('p', 'q-error'); error.hidden = true; error.setAttribute('role', 'alert');
    block.append(error);
    return block;
  }

  function collect(form) {
    const answers = {};
    survey.questions.forEach(question => {
      if (question.type === 'multiple') {
        const values = [...form.querySelectorAll(`input[name="${question.id}"]:checked`)].map(input => input.value);
        if (values.length) answers[question.id] = values;
      } else if (question.type === 'text') {
        const value = form.querySelector(`textarea[name="${question.id}"]`).value.trim();
        if (value) answers[question.id] = value;
      } else {
        const checked = form.querySelector(`input[name="${question.id}"]:checked`);
        if (checked) answers[question.id] = question.type === 'scale' ? Number(checked.value) : checked.value;
      }
    });
    return answers;
  }

  function updateProgress(form, bar, text) {
    const answers = collect(form);
    const total = survey.questions.length;
    const answered = survey.questions.filter(question => question.id in answers).length;
    bar.style.width = `${Math.round((answered / total) * 100)}%`;
    text.textContent = `${answered} de ${total} respondidas`;
  }

  function render() {
    if (remembered()) { showThanks('Você já respondeu esta pesquisa neste aparelho. Obrigado!'); return; }
    if (!survey.open) { message('Pesquisa encerrada.', 'Obrigado pelo interesse. As respostas já foram reunidas.'); return; }
    document.title = `${survey.title} · Tiago Ismar`;
    const hero = el('section', 'survey-hero');
    hero.append(el('p', 'eyebrow', 'PESQUISA ANÔNIMA'), el('h1', null, survey.title));
    if (survey.intro) hero.append(el('p', null, survey.intro));
    const progress = el('div', 'progress');
    const progressText = el('div', 'progress-text'); const label = el('span'); progressText.append(label, el('span', null, `Cerca de ${Math.max(1, Math.round(survey.questions.length / 4))} min`));
    const bar = el('div', 'progress-bar'); const fill = el('span'); bar.append(fill);
    bar.setAttribute('aria-hidden', 'true');
    progress.append(progressText, bar);
    const form = el('form'); form.noValidate = true;
    survey.questions.forEach((question, index) => form.append(questionBlock(question, index + 1, survey.questions.length)));
    const submitRow = el('div', 'submit-row');
    const button = el('button', 'primary', 'Enviar respostas'); button.type = 'submit';
    const formError = el('p', 'form-error'); formError.setAttribute('role', 'alert');
    submitRow.append(button, formError, el('p', 'privacy-note', 'Não guardamos nome, telefone, e-mail nem endereço de internet. Só as respostas entram nos gráficos.'));
    form.append(submitRow);
    form.addEventListener('change', (event) => {
      updateProgress(form, fill, label);
      const block = event.target.closest('.question');
      if (block?.classList.contains('invalid')) { block.classList.remove('invalid'); block.querySelector('.q-error').hidden = true; }
    });
    form.addEventListener('input', () => updateProgress(form, fill, label));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      formError.textContent = '';
      const answers = collect(form);
      let firstMissing = null;
      survey.questions.forEach(question => {
        const block = form.querySelector(`[data-id="${question.id}"]`);
        const error = block.querySelector('.q-error');
        const missing = question.required && !(question.id in answers);
        block.classList.toggle('invalid', missing);
        error.hidden = !missing;
        error.textContent = missing ? 'Responda esta pergunta para enviar.' : '';
        if (missing && !firstMissing) firstMissing = block;
      });
      if (firstMissing) {
        firstMissing.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        firstMissing.querySelector('input, textarea')?.focus({ preventScroll: true });
        formError.textContent = 'Falta responder alguma pergunta.';
        return;
      }
      button.disabled = true; button.textContent = 'Enviando…';
      try {
        const response = await fetch(`/api/public/surveys/${encodeURIComponent(slug)}/responses`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify({ answers }),
        });
        const reply = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(reply.error || 'Não foi possível enviar. Tente novamente.');
        remember(true);
        showThanks(reply.thanks || survey.thanks);
      } catch (error) {
        formError.textContent = error.message === 'Failed to fetch' ? 'Sem conexão. Confira a internet e tente de novo.' : error.message;
        button.disabled = false; button.textContent = 'Enviar respostas';
      }
    });
    root.replaceChildren(hero, progress, form);
    updateProgress(form, fill, label);
  }

  (async () => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) { message('Pesquisa não encontrada.', 'Confira o link ou leia o QR code novamente.'); return; }
    try {
      const response = await fetch(`/api/public/surveys/${encodeURIComponent(slug)}`, { credentials: 'omit' });
      if (response.status === 404) { message('Pesquisa não encontrada.', 'Confira o link ou leia o QR code novamente.'); return; }
      if (!response.ok) throw new Error();
      survey = await response.json();
      render();
    } catch {
      message('Não foi possível abrir.', 'Confira a internet e recarregue a página.');
    }
  })();
})();
