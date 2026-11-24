(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const node = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  const id = new URLSearchParams(location.search).get('id') || '';
  const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium', timeZone: 'America/Fortaleza' });
  const percent = (part, whole) => whole ? Math.round((part / whole) * 100) : 0;
  const plural = (total, one, many) => `${total.toLocaleString('pt-BR')} ${total === 1 ? one : many}`;
  let slides = false, current = 0, lastSignature = '', timer = null;

  function bars(question) {
    const list = node('ol', null, 'rows');
    const base = question.answered;
    const top = Math.max(0, ...question.options.map(option => option.count));
    question.options
      .map((option, index) => ({ ...option, index }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .forEach(option => {
        const row = node('li', null, `row${top > 0 && option.count === top ? ' top' : ''}`);
        const value = node('span', `${percent(option.count, base)}%`, 'value');
        value.append(node('small', plural(option.count, 'voto', 'votos')));
        const track = node('div', null, 'track'); const fill = node('div', null, 'fill');
        track.append(fill);
        row.append(node('span', option.label, 'label'), value, track);
        requestAnimationFrame(() => { fill.style.width = `${percent(option.count, base)}%`; });
        list.append(row);
      });
    return list;
  }

  function scale(question) {
    const wrap = node('div', null, 'scale-wrap');
    const average = node('div', null, 'average');
    average.append(node('strong', question.average == null ? '–' : question.average.toLocaleString('pt-BR', { minimumFractionDigits: 1 })), node('span', 'MÉDIA DE 1 A 5'));
    const columns = node('div', null, 'columns');
    const top = Math.max(1, ...question.options.map(option => option.count));
    question.options.forEach(option => {
      const column = node('div', null, 'column');
      const bar = node('div', null, 'bar-v');
      column.append(node('span', `${option.count} · ${percent(option.count, question.answered)}%`, 'count'), bar, node('span', option.label, 'score'));
      column.setAttribute('aria-label', `Nota ${option.label}: ${plural(option.count, 'voto', 'votos')}`);
      requestAnimationFrame(() => { bar.style.height = `${(option.count / top) * 78}%`; });
      columns.append(column);
    });
    wrap.append(average, columns);
    if (question.min_label || question.max_label) {
      const labels = node('div', null, 'scale-labels');
      labels.append(node('span', `1 = ${question.min_label}`), node('span', `5 = ${question.max_label}`));
      wrap.append(labels);
    }
    return wrap;
  }

  function texts(question) {
    if (!question.answers.length) return node('p', 'Nenhuma resposta escrita ainda.', 'empty');
    const list = node('ul', null, 'texts');
    question.answers.forEach(answer => list.append(node('li', answer)));
    return list;
  }

  function chart(question, index, count) {
    const card = node('article', null, 'chart');
    card.append(node('p', `PERGUNTA ${index + 1} DE ${count}`, 'num'), node('h2', question.text));
    const meta = question.type === 'multiple'
      ? `${plural(question.answered, 'pessoa respondeu', 'pessoas responderam')} · cada uma podia marcar até ${question.max} · % sobre quem respondeu`
      : question.type === 'text' ? `${plural(question.answers.length, 'resposta escrita', 'respostas escritas')}, em ordem aleatória`
        : plural(question.answered, 'pessoa respondeu', 'pessoas responderam');
    card.append(node('p', meta, 'meta'));
    if (!question.answered && question.type !== 'text') card.append(node('p', 'Ainda sem respostas.', 'empty'));
    else card.append(question.type === 'scale' ? scale(question) : question.type === 'text' ? texts(question) : bars(question));
    return card;
  }

  function showSlide() {
    const cards = [...document.querySelectorAll('.chart')];
    if (!cards.length) return;
    current = Math.max(0, Math.min(current, cards.length - 1));
    cards.forEach((card, index) => card.classList.toggle('current', index === current));
    $('#slide-pos').textContent = `${current + 1} / ${cards.length}`;
  }

  function render(result) {
    document.title = `${result.survey.title} · Resultados`;
    $('#title').textContent = result.survey.title;
    $('#total').textContent = result.total.toLocaleString('pt-BR');
    $('#total-label').textContent = result.total === 1 ? 'resposta' : 'respostas';
    $('#qr-total').textContent = result.total.toLocaleString('pt-BR');
    $('#qr-total-label').textContent = result.total === 1 ? 'resposta até agora' : 'respostas até agora';
    $('#qr-link').textContent = result.survey.link.replace(/^https?:\/\//, '');
    if (!$('#qr-image').src) $('#qr-image').src = `/api/admin/surveys/${encodeURIComponent(id)}/qr.svg`;
    $('#updated').textContent = `${result.survey.open ? 'Recebendo respostas' : 'Pesquisa encerrada'} · atualizado às ${time.format(new Date())}`;
    const signature = JSON.stringify(result.questions);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const charts = $('#charts');
    charts.replaceChildren(...result.questions.map((question, index) => chart(question, index, result.questions.length)));
    if (slides) showSlide();
  }

  async function load() {
    try {
      const response = await fetch(`/api/admin/surveys/${encodeURIComponent(id)}/results`, { credentials: 'same-origin' });
      const reply = await response.json().catch(() => ({}));
      if (response.status === 401) return notice('Entre no painel para ver os resultados.', true);
      if (!response.ok) return notice(reply.error || 'Não foi possível carregar os resultados.');
      render(reply);
    } catch {
      $('#updated').textContent = 'Sem conexão. Tentando de novo…';
    }
  }

  function notice(text, login = false) {
    clearInterval(timer);
    const box = node('div', null, 'notice');
    box.append(node('p', text));
    if (login) { const link = node('a', 'Abrir o painel'); link.href = '/admin/'; box.append(link); }
    $('#results').replaceChildren(box);
  }

  $('#mode').addEventListener('click', () => {
    slides = !slides;
    $('#mode').setAttribute('aria-pressed', String(slides));
    $('#charts').classList.toggle('slides', slides);
    $('#slide-nav').hidden = !slides;
    if (slides) showSlide();
  });
  $('#prev').addEventListener('click', () => { current -= 1; showSlide(); });
  $('#next').addEventListener('click', () => { current += 1; showSlide(); });
  document.addEventListener('keydown', (event) => {
    if (!$('#qr-overlay').hidden) { if (event.key === 'Escape') $('#close-qr').click(); return; }
    if (!slides) return;
    if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); current += 1; showSlide(); }
    if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); current -= 1; showSlide(); }
  });
  $('#show-qr').addEventListener('click', () => { $('#qr-overlay').hidden = false; $('#close-qr').focus(); });
  $('#close-qr').addEventListener('click', () => { $('#qr-overlay').hidden = true; $('#show-qr').focus(); });
  $('#fullscreen').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
  $('#print').addEventListener('click', () => window.print());
  $('#edit').href = `/admin/?pesquisa=${encodeURIComponent(id)}`;
  $('#reset').addEventListener('click', async () => {
    if (!confirm('Zerar todas as respostas desta pesquisa? Elas serão apagadas de vez.')) return;
    const button = $('#reset');
    button.disabled = true;
    try {
      const session = await (await fetch('/api/admin/session', { credentials: 'same-origin' })).json();
      const response = await fetch(`/api/admin/surveys/${encodeURIComponent(id)}/responses`, {
        method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': session.csrf_token || '' },
      });
      const reply = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(reply.error || 'Não foi possível zerar.');
      lastSignature = '';
      await load();
      $('#updated').textContent = `Respostas zeradas · ${time.format(new Date())}`;
    } catch (error) { alert(error.message); }
    finally { button.disabled = false; }
  });

  if (!/^[a-f0-9]{24}$/.test(id)) notice('Pesquisa não encontrada. Abra pelo painel.');
  else { load(); timer = setInterval(load, 8000); }
})();
