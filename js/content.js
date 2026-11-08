(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dialog = document.querySelector('#content-dialog');
  const detail = dialog?.querySelector('[data-content-detail]');
  const projectStatus = { idea: 'Ideia', planning: 'Em planejamento', in_progress: 'Em andamento', completed: 'Concluído' };
  const collections = new Map();
  const catalog = [];
  let opener;
  let activeRegistration = '';
  // Display only the brand panel from the owner's unchanged WhatsApp captures.
  // Replacing an image in the CMS with a normal upload removes this presentation.
  const catalogLogos = new Map([
    ['/assets/companies/ramilos-comunicacoes-catalog.jpeg', '#000000'],
    ['/assets/companies/ramilos-metalurgica-catalog.jpeg', '#125b7c'],
    ['/assets/companies/pousadas-ramilos-catalog.jpeg', '#ffcb00'],
    ['/assets/companies/lava-jato-ramilos-catalog.jpeg', '#125b7c'],
    ['/assets/companies/ramilos-engenharia-catalog.jpeg', '#125b7c'],
  ]);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `./assets/icons/lucide.svg?v=1#${name}`);
    svg.append(use);
    return svg;
  }
  function publicURL(value, image = false) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value, location.origin);
      if (url.username || url.password) return '';
      if (image && url.origin === location.origin) return /^\/(assets|media)\//.test(url.pathname) ? url.href : '';
      if (url.protocol === 'https:') return url.href;
    } catch (_) { /* Invalid content is omitted rather than inserted as markup. */ }
    return '';
  }
  function imageNode(value, title, className = '') {
    const src = publicURL(value, true);
    if (!src) return null;
    const url = new URL(src);
    if (url.origin === location.origin && catalogLogos.has(url.pathname)) {
      const namespace = 'http://www.w3.org/2000/svg';
      const frame = document.createElementNS(namespace, 'svg');
      frame.setAttribute('class', `${className} catalog-source-logo`.trim());
      frame.setAttribute('viewBox', '0 0 738 706');
      frame.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      frame.setAttribute('focusable', 'false');
      if (title) { frame.setAttribute('role', 'img'); frame.setAttribute('aria-label', title); }
      else frame.setAttribute('aria-hidden', 'true');
      frame.style.backgroundColor = catalogLogos.get(url.pathname);
      // The nested viewport clips the phone controls even in letterboxed layouts.
      const crop = document.createElementNS(namespace, 'svg');
      crop.setAttribute('width', '738'); crop.setAttribute('height', '706');
      crop.setAttribute('viewBox', '0 194 738 706'); crop.setAttribute('overflow', 'hidden');
      const original = document.createElementNS(namespace, 'image');
      original.setAttribute('href', src);
      original.setAttribute('width', '738'); original.setAttribute('height', '1600');
      crop.append(original); frame.append(crop);
      return frame;
    }
    const image = element('img', className);
    image.src = src;
    image.alt = title || '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    return image;
  }
  function eventDate(value) {
    if (!value || typeof value !== 'string') return null;
    const timestamp = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}-03:00`;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function formatDate(value, withTime = false) {
    const date = eventDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
  }
  function ordered(items, kind) {
    const result = items.filter((item) => item && typeof item.title === 'string' && item.published !== false);
    return result.sort((a, b) => {
      if (kind === 'events') {
        const first = eventDate(a.start_at)?.getTime() || Infinity;
        const second = eventDate(b.start_at)?.getTime() || Infinity;
        const firstPast = (eventDate(a.end_at)?.getTime() || first) < Date.now();
        const secondPast = (eventDate(b.end_at)?.getTime() || second) < Date.now();
        if (firstPast !== secondPast) return firstPast ? 1 : -1;
        if (first !== second) return firstPast ? second - first : first - second;
      }
      return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || a.title.localeCompare(b.title, 'pt-BR');
    });
  }
  function recordMeta(record, kind) {
    if (kind === 'events') return [formatDate(record.start_at), record.city].filter(Boolean).join(' · ');
    if (kind === 'projects') return [projectStatus[record.status], record.city].filter(Boolean).join(' · ');
    return [record.category, record.city].filter(Boolean).join(' · ');
  }
  function link(label, value) {
    const href = publicURL(value);
    if (!href) return null;
    const anchor = element('a', '', label);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.append(icon('arrow-up-right'));
    return anchor;
  }
  function fact(list, name, value) {
    if (!value) return;
    const group = element('div');
    group.append(element('dt', '', name), element('dd', '', value));
    list.append(group);
  }

  function registrationForm(slug) {
    const form = element('form', 'event-rsvp');
    form.method = 'post';
    form.action = `/api/public/events/${encodeURIComponent(slug)}/rsvp`;
    const fields = element('div', 'event-rsvp-fields');
    for (const [name, label, autocomplete] of [
      ['name', 'Seu nome', 'name'],
      ['enterprise', 'Nome do empreendimento', 'organization'],
    ]) {
      const field = element('label', 'event-rsvp-field', label);
      const input = element('input');
      input.name = name;
      input.required = true;
      input.maxLength = 120;
      input.autocomplete = autocomplete;
      field.append(input);
      fields.append(field);
    }
    const submit = element('button', 'event-rsvp-submit', 'Confirmar presença');
    submit.type = 'submit';
    submit.append(icon('arrow-right'));
    const status = element('p', 'event-rsvp-status');
    status.setAttribute('role', 'status');
    form.append(
      fields,
      submit,
      element('p', 'event-rsvp-note', 'Seus dados serão usados pela organização para a lista de presença.'),
      status,
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const values = new FormData(form);
      const name = values.get('name').trim();
      const enterprise = values.get('enterprise').trim();
      if (!name || !enterprise) {
        status.textContent = 'Preencha seu nome e o nome do empreendimento.';
        return;
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      submit.disabled = true;
      status.textContent = 'Confirmando sua presença…';
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name, enterprise }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          status.textContent = response.status < 500 && result.error
            ? result.error : 'Não foi possível confirmar agora. Tente novamente.';
          return;
        }
        const success = element('div', 'event-rsvp-success');
        const heading = element('h3', '', 'Presença confirmada!');
        heading.tabIndex = -1;
        success.append(icon('check'), heading, element('p', '', 'Seu nome foi incluído na lista. Até o encontro!'));
        form.replaceWith(success);
        heading.focus();
      } catch (_) {
        status.textContent = 'Não foi possível confirmar agora. Tente novamente.';
      } finally {
        window.clearTimeout(timeout);
        submit.disabled = false;
      }
    });
    return form;
  }

  function presentDetails(trigger) {
    opener = trigger;
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector('[data-content-close]').focus({ preventScroll: true });
  }

  function showDetails(record, kind, trigger) {
    if (!dialog || !detail) return;
    activeRegistration = kind === 'events' ? record.registration_slug || '' : '';
    dialog.classList.toggle('is-registration', Boolean(activeRegistration));
    detail.replaceChildren();
    const cover = activeRegistration ? null : imageNode(record.image, record.title, 'content-detail-cover');
    if (cover) detail.append(cover);
    const eyebrow = activeRegistration ? 'Confirmação de presença' : recordMeta(record, kind);
    detail.append(element('p', 'content-detail-eyebrow', eyebrow));
    const title = element('h2', '', record.title);
    title.id = 'content-dialog-title';
    detail.append(title);
    if (record.description) detail.append(element('p', 'content-detail-description', record.description));
    const facts = element('dl', 'content-detail-facts');
    if (kind === 'events') {
      fact(facts, 'Quando', formatDate(record.start_at, true));
      fact(facts, 'Até', formatDate(record.end_at, true));
      fact(facts, 'Onde', record.location);
      if (!activeRegistration) fact(facts, 'Cidade', record.city);
    }
    if (kind === 'projects') fact(facts, 'Andamento', projectStatus[record.status]);
    if (kind === 'companies' && record.is_group) fact(facts, 'Empresa', 'Grupo Ramilos');
    if (facts.childElementCount) detail.append(facts);
    if (activeRegistration) detail.append(registrationForm(activeRegistration));
    const actions = element('div', 'content-detail-actions');
    const destination = publicURL(record.url);
    const instagram = destination && ['instagram.com', 'www.instagram.com'].includes(new URL(destination).hostname);
    const external = link(instagram ? 'Ver no Instagram' : kind === 'events' ? 'Saiba mais sobre o evento' : 'Saiba mais', destination);
    if (external) actions.append(external);
    const phone = typeof record.whatsapp === 'string' ? record.whatsapp.replace(/\D/g, '') : '';
    if (kind === 'companies' && /^\d{10,15}$/.test(phone)) {
      const whatsapp = link('Fale com a empresa', `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Conheci ${record.title} pelo site do Tiago Ismar e gostaria de saber mais.`)}`);
      if (whatsapp) actions.append(whatsapp);
    }
    if (actions.childElementCount) detail.append(actions);
    if (kind === 'companies') {
      const items = ordered(catalog.filter((item) => String(item.company_id) === String(record.id)), 'catalog_items');
      if (items.length) {
        detail.append(element('h3', 'catalog-title', 'Explore o catálogo'));
        const grid = element('div', 'catalog-grid');
        items.forEach((item) => {
          const article = element('article', 'catalog-item');
          const image = imageNode(item.image, item.title);
          if (image) article.append(image);
          article.append(element('h4', '', item.title));
          if (item.description) article.append(element('p', '', item.description));
          if (item.price_text) article.append(element('p', 'catalog-price', item.price_text));
          const itemLink = link('Ver mais', item.url);
          if (itemLink) article.append(itemLink);
          grid.append(article);
        });
        detail.append(grid);
      }
    }
    presentDetails(trigger);
  }

  function registrationHash() {
    return location.hash.match(/^#inscricao=([a-z0-9]+(?:-[a-z0-9]+)*)$/)?.[1] || '';
  }

  function registrationNotice(slug, heading, message) {
    activeRegistration = slug;
    dialog.classList.add('is-registration');
    const title = element('h2', '', heading);
    title.id = 'content-dialog-title';
    detail.replaceChildren(title, element('p', 'content-detail-description', message));
  }

  function openRegistrationFromHash() {
    const slug = registrationHash();
    if (!slug) {
      if (activeRegistration && dialog?.open) dialog.close();
      return;
    }
    if (!dialog || !detail || (dialog.open && activeRegistration === slug)) return;
    const events = collections.get('events');
    if (!events) return;
    document.querySelector('#eventos').scrollIntoView({ behavior: 'instant' });
    const index = events.items.findIndex((event) => event.registration_slug === slug);
    if (index >= 0) {
      const trigger = events.track.querySelectorAll('.content-card:not([data-clone]) button')[index];
      showDetails(events.items[index], 'events', trigger);
      return;
    }
    registrationNotice(slug, 'Inscrição indisponível', 'Confira os encontros disponíveis na agenda.');
    presentDetails();
  }

  dialog?.querySelector('[data-content-close]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog?.addEventListener('close', () => {
    if (activeRegistration && registrationHash() === activeRegistration) {
      history.replaceState(history.state, '', '#eventos');
    }
    activeRegistration = '';
    opener?.focus({ preventScroll: true });
    opener = null;
  });
  window.addEventListener('hashchange', openRegistrationFromHash);

  function card(record, kind, cloned = false) {
    const article = element('article', 'content-card');
    const button = element('button');
    button.type = 'button';
    const registration = kind === 'events' && record.registration_slug;
    button.setAttribute('aria-label', registration ? `Confirmar presença: ${record.title}` : `Conheça ${record.title}`);
    const art = element('div', `content-card-art${kind === 'events' ? ' is-poster' : ''}`);
    const image = imageNode(record.image, '');
    if (image) art.append(image);
    else art.append(element('span', 'content-card-placeholder', kind === 'events' ? 'Encontros' : kind === 'projects' ? 'Ibiapaba' : record.category || 'De perto'));
    const arrow = element('span', 'content-card-arrow');
    arrow.append(icon('arrow-up-right'));
    art.append(arrow);
    const copy = element('div', 'content-card-copy');
    copy.append(element('span', 'content-card-meta', recordMeta(record, kind)), element('h3', '', record.title));
    if (kind === 'companies' && record.is_group) copy.append(element('span', 'content-card-detail', 'Grupo Ramilos'));
    const eventEnd = eventDate(record.end_at) || eventDate(record.start_at);
    if (kind === 'events' && eventEnd && eventEnd < new Date()) copy.append(element('span', 'content-card-detail', 'Já aconteceu'));
    if (registration) {
      const cta = element('span', 'event-card-rsvp', 'Confirmar presença');
      cta.append(icon('arrow-right'));
      copy.append(cta);
    }
    button.append(art, copy);
    if (cloned) {
      article.setAttribute('aria-hidden', 'true');
      article.dataset.clone = 'true';
      button.tabIndex = -1;
    }
    button.addEventListener('click', () => {
      const collection = collections.get(kind);
      const original = cloned ? collection?.track.querySelectorAll('.content-card:not([data-clone]) button')[collection.items.indexOf(record)] : button;
      if (cloned && collection && original) {
        const origin = collection.track.children[0].offsetLeft;
        collection.track.scrollTo({ left: original.closest('.content-card').offsetLeft - origin, behavior: 'instant' });
      }
      if (registration) history.replaceState(history.state, '', `#inscricao=${registration}`);
      showDetails(record, kind, original || button);
    });
    article.append(button);
    return article;
  }
  function renderCollection(section, items) {
    const kind = section.dataset.collection;
    const track = section.querySelector('[data-content-track]');
    const controls = section.querySelector('[data-content-controls]');
    const previous = section.querySelector('[data-content-prev]');
    const next = section.querySelector('[data-content-next]');
    const entries = ordered(items, kind);
    track.replaceChildren(...entries.map((record) => card(record, kind)));
    track.hidden = !entries.length;
    controls.hidden = entries.length < 2;
    section.querySelector('[data-content-empty]').hidden = Boolean(entries.length);
    previous.replaceChildren(icon('arrow-left'));
    next.replaceChildren(icon('arrow-right'));
    previous.disabled = next.disabled = entries.length < 2;
    const state = { track, items: entries, visible: false, hover: false, pointer: false, enabled: true, until: 0, settling: 0 };
    collections.set(kind, state);
    if (entries.length < 2) return;
    track.append(...entries.map((record) => card(record, kind, true)));
    function updateCapacity() {
      const first = track.children[0];
      const last = track.children[entries.length - 1];
      const style = getComputedStyle(track);
      const width = track.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      state.enabled = last.offsetLeft + last.offsetWidth - first.offsetLeft > width + 2;
      [...track.children].slice(entries.length).forEach((entry) => { entry.hidden = !state.enabled; });
      controls.hidden = !state.enabled;
      previous.disabled = next.disabled = !state.enabled;
      if (!state.enabled) track.scrollTo({ left: 0, behavior: 'instant' });
    }
    updateCapacity();
    if ('ResizeObserver' in window) new ResizeObserver(updateCapacity).observe(track);
    else window.addEventListener('resize', updateCapacity);
    function span() { return track.children[entries.length].offsetLeft - track.children[0].offsetLeft; }
    function normalize() {
      if (!state.enabled) return;
      const distance = span();
      if (distance && track.scrollLeft >= distance - 1) track.scrollTo({ left: Math.max(0, track.scrollLeft - distance), behavior: 'instant' });
    }
    function move(direction, manual = false) {
      if (!state.enabled) return;
      if (manual) state.until = Date.now() + 8000;
      normalize();
      const distance = span();
      const first = track.children[0].offsetLeft;
      let position = track.scrollLeft;
      if (direction < 0 && position <= 2) {
        position = distance;
        track.scrollTo({ left: distance, behavior: 'instant' });
      }
      const positions = [...track.children].map((entry) => entry.offsetLeft - first);
      const target = direction > 0 ? positions.find((value) => value > position + 3) : positions.filter((value) => value < position - 3).pop();
      requestAnimationFrame(() => track.scrollTo({ left: target ?? 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' }));
    }
    previous.addEventListener('click', () => move(-1, true));
    next.addEventListener('click', () => move(1, true));
    track.addEventListener('keydown', (event) => {
      if (event.target !== track || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1, true);
    });
    section.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') state.hover = true; });
    section.addEventListener('pointerleave', () => { state.hover = false; });
    track.addEventListener('pointerdown', () => { state.pointer = true; state.until = Date.now() + 8000; });
    window.addEventListener('pointerup', () => { state.pointer = false; });
    track.addEventListener('pointercancel', () => { state.pointer = false; });
    track.addEventListener('wheel', () => { state.until = Date.now() + 8000; }, { passive: true });
    track.addEventListener('scroll', () => {
      clearTimeout(state.settling);
      state.settling = setTimeout(() => { if (!state.pointer) normalize(); }, 180);
    }, { passive: true });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(([entry]) => { state.visible = entry.isIntersecting; }, { threshold: .15 });
      observer.observe(track);
    } else state.visible = true;
    window.setInterval(() => {
      if (!state.enabled || !state.visible || state.hover || state.pointer || document.hidden || reducedMotion.matches || dialog?.open || document.querySelector('#photo-dialog')?.open || Date.now() < state.until || section.contains(document.activeElement)) return;
      move(1);
    }, 5500);
  }
  function renderPartners(items) {
    const list = document.querySelector('#partner-list');
    const city = document.querySelector('#partner-city');
    if (!list || !city) return;
    const entries = ordered(items, 'partners').sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    list.replaceChildren(...entries.map((entry) => {
      const li = element('li', '', entry.title);
      li.dataset.city = entry.city || '';
      return li;
    }));
    const cities = [...new Set(entries.map((entry) => entry.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const previousCity = city.value;
    city.replaceChildren(new Option('Todas as cidades', ''), ...cities.map((name) => new Option(name, name)));
    city.value = cities.includes(previousCity) ? previousCity : '';
    document.querySelector('.partner-city-field').hidden = cities.length < 2;
    document.dispatchEvent(new Event('partners:updated'));
  }
  function applySettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    if (typeof settings.site_intro === 'string' && settings.site_intro.trim()) document.querySelector('.intro-lead').textContent = settings.site_intro;
    const editable = { companies_title: '#companies-title', companies_intro: '#empresas .content-heading>p', events_intro: '#eventos .content-heading>p', projects_intro: '#projetos .content-heading>p' };
    Object.entries(editable).forEach(([key, selector]) => {
      if (typeof settings[key] === 'string' && settings[key].trim()) document.querySelector(selector).textContent = settings[key];
    });
    const catalogLink = link('Catálogo no WhatsApp', settings.catalog_url);
    if (catalogLink) {
      catalogLink.className = 'content-catalog-link';
      document.querySelector('#empresas .content-heading>p').append(catalogLink);
    }
    const phone = typeof settings.contact_whatsapp === 'string' ? settings.contact_whatsapp.replace(/\D/g, '') : '';
    if (/^\d{10,15}$/.test(phone)) {
      document.querySelector('.partner-form').action = `https://wa.me/${phone}`;
      const fallback = document.querySelector('.partner-fallback');
      const url = new URL(fallback.href);
      url.pathname = `/${phone}`;
      fallback.href = url.href;
    }
  }
  function startStatistics() {
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl) return;
    const visited = new Set();
    function record(section) {
      if (visited.has(section)) return;
      visited.add(section);
      try {
        if (sessionStorage.getItem(`tiago-view:${section}`)) return;
        sessionStorage.setItem(`tiago-view:${section}`, '1');
      } catch (_) { /* Storage can be disabled; in-memory de-duplication remains. */ }
      // The existing admin session lets the server exclude the owner's own visits.
      fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section }), keepalive: true, credentials: 'same-origin' }).catch(() => {});
    }
    record('inicio');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.filter((entry) => entry.isIntersecting).forEach((entry) => { record(entry.target.id); observer.unobserve(entry.target); });
      }, { threshold: .01 });
      document.querySelectorAll('main>section[id]').forEach((section) => observer.observe(section));
    }
  }
  const retry = document.querySelector('#content-retry');
  const partnerStatus = document.querySelector('#partner-status');
  const emptyMessages = [...document.querySelectorAll('[data-content-empty] p')].map((node) => ({ node, text: node.textContent }));
  let loading = false;
  function loadContent() {
    if (loading) return;
    loading = true;
    const retrying = document.activeElement === retry;
    if (retry) retry.hidden = true;
    if (partnerStatus) partnerStatus.textContent = 'Carregando lista…';
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    fetch('/api/public/content', { headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal, cache: 'no-store' })
    .then((response) => { if (!response.ok) throw new Error('Content unavailable'); return response.json(); })
    .then((data) => {
      if (!data || typeof data !== 'object' || !Array.isArray(data.partners)) throw new Error('Invalid content');
      emptyMessages.forEach(({ node, text }) => { node.textContent = text; });
      if (Array.isArray(data.catalog_items)) catalog.push(...data.catalog_items);
      document.querySelectorAll('[data-collection]').forEach((section) => renderCollection(section, Array.isArray(data[section.dataset.collection]) ? data[section.dataset.collection] : []));
      renderPartners(data.partners);
      if (retrying) document.querySelector('#partner-search')?.focus({ preventScroll: true });
      applySettings(data.settings);
      if (activeRegistration && !detail.querySelector('.event-rsvp, .event-rsvp-success')) activeRegistration = '';
      openRegistrationFromHash();
      startStatistics();
    }).catch(() => {
      // A failed request never restores a stale public snapshot of edited or removed partners.
      document.querySelector('#partner-list')?.replaceChildren();
      if (partnerStatus) partnerStatus.textContent = 'Não foi possível carregar a lista agora. Tente novamente.';
      if (retry) retry.hidden = false;
      if (retrying) retry?.focus({ preventScroll: true });
      document.querySelectorAll('[data-content-empty] p').forEach((message) => {
        message.textContent = 'Este conteúdo está indisponível no momento. Tente novamente em instantes.';
      });
      const slug = registrationHash();
      if (slug && dialog && detail) {
        registrationNotice(slug, 'Não foi possível abrir a inscrição', 'Tente carregar o formulário novamente.');
        const retryRegistration = element('button', 'event-rsvp-submit event-rsvp-retry', 'Tentar novamente');
        retryRegistration.type = 'button';
        retryRegistration.addEventListener('click', loadContent);
        detail.append(retryRegistration);
        presentDetails();
      }
    }).finally(() => { window.clearTimeout(timeout); loading = false; });
  }
  retry?.addEventListener('click', loadContent);
  loadContent();
})();
