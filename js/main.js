(() => {
  'use strict';

  const body = document.body;
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionButton = document.querySelector('[data-motion-toggle]');
  const motionLabel = document.querySelector('[data-motion-label]');
  const revealElements = [...document.querySelectorAll('[data-reveal]')];
  const parallaxElements = [...document.querySelectorAll('[data-parallax]')];
  const visibleParallax = new Set();
  const parallaxOffsets = new WeakMap();
  let motionPaused = reducedMotion.matches;
  let motionOverridden = false;
  let framePending = false;

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-nav');
  const menuBackground = [document.querySelector('main'), document.querySelector('.site-footer'), motionButton].filter(Boolean);
  const initialInertStates = new Map();

  function closeMenu({ returnFocus = false } = {}) {
    body.classList.remove('menu-open');
    navigation?.classList.remove('is-open');
    menuButton?.setAttribute('aria-expanded', 'false');
    initialInertStates.forEach((wasInert, element) => { element.inert = wasInert; });
    initialInertStates.clear();
    if (returnFocus) menuButton?.focus();
  }

  if (menuButton && navigation) {
    menuButton.setAttribute('aria-controls', navigation.id);
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.addEventListener('click', () => {
      const isOpen = !body.classList.contains('menu-open');
      if (!isOpen) {
        closeMenu();
        return;
      }
      body.classList.add('menu-open');
      navigation.classList.add('is-open');
      menuButton.setAttribute('aria-expanded', 'true');
      menuBackground.forEach((element) => {
        initialInertStates.set(element, element.inert);
        element.inert = true;
      });
    });

    navigation.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a')) closeMenu();
    });

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Node)) return;
      if (!navigation.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (!body.classList.contains('menu-open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu({ returnFocus: true });
      } else if (event.key === 'Tab') {
        const focusable = [...(header || navigation).querySelectorAll('a[href], button:not([disabled])')]
          .filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const outsideMenu = !focusable.includes(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outsideMenu)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || outsideMenu)) {
          event.preventDefault();
          first?.focus();
        }
      }
    });

    window.matchMedia('(min-width: 960px)').addEventListener('change', (event) => {
      if (event.matches) closeMenu();
    });
  }

  // Reveal once. Without JavaScript, the page keeps its normal visible state.
  let revealObserver;
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });

    const parallaxObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleParallax.add(entry.target);
        else visibleParallax.delete(entry.target);
      }
      requestFrame();
    }, { rootMargin: '100px 0px' });

    parallaxElements.forEach((element) => parallaxObserver.observe(element));
  } else {
    revealElements.forEach((element) => element.classList.add('is-visible'));
    parallaxElements.forEach((element) => visibleParallax.add(element));
  }

  function setMotionState(paused) {
    motionPaused = paused;
    body.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-enabled', !paused);
    motionButton?.setAttribute('aria-pressed', String(paused));
    if (motionLabel) motionLabel.textContent = paused ? 'Ativar movimento' : 'Pausar movimento';

    if (paused) {
      revealObserver?.disconnect();
      revealElements.forEach((element) => element.classList.add('is-visible'));
      parallaxElements.forEach((element) => {
        element.style.setProperty('--parallax-y', '0px');
        parallaxOffsets.set(element, 0);
      });
      track?.scrollTo({ left: track.scrollLeft, behavior: 'instant' });
    } else {
      revealElements.forEach((element) => {
        if (!element.classList.contains('is-visible')) revealObserver?.observe(element);
      });
    }
    requestFrame();
  }

  motionButton?.addEventListener('click', () => {
    motionOverridden = true;
    setMotionState(!motionPaused);
  });

  reducedMotion.addEventListener('change', (event) => {
    if (!motionOverridden) setMotionState(event.matches);
  });

  const track = document.querySelector('.landscape-track');
  const cards = track ? [...track.querySelectorAll('.landscape-card')] : [];
  const previousButton = document.querySelector('[data-gallery-prev]');
  const nextButton = document.querySelector('[data-gallery-next]');
  const currentIndicator = document.querySelector('[data-gallery-current]');
  const totalIndicator = document.querySelector('[data-gallery-total]');
  const formatIndex = (value) => String(value).padStart(2, '0');

  if (totalIndicator) totalIndicator.textContent = formatIndex(cards.length);

  function cardPositions() {
    if (!track || !cards.length) return [];
    const firstLeft = cards[0].getBoundingClientRect().left;
    return cards.map((card) => card.getBoundingClientRect().left - firstLeft);
  }

  function updateGallery() {
    if (!track || !cards.length) return;
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const positions = cardPositions();
    let closestIndex = 0;

    positions.forEach((position, index) => {
      if (Math.abs(position - track.scrollLeft) < Math.abs(positions[closestIndex] - track.scrollLeft)) {
        closestIndex = index;
      }
    });

    // A final card may stop before its left edge reaches the viewport edge.
    if (maximumScroll > 2 && track.scrollLeft >= maximumScroll - 2) closestIndex = cards.length - 1;
    if (currentIndicator) currentIndicator.textContent = formatIndex(closestIndex + 1);
    if (previousButton) previousButton.disabled = track.scrollLeft <= 2;
    if (nextButton) nextButton.disabled = track.scrollLeft >= maximumScroll - 2;
  }

  function moveGallery(direction) {
    if (!track || !cards.length) return;
    const positions = cardPositions();
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const nextPosition = direction > 0
      ? positions.find((position) => position > track.scrollLeft + 4)
      : [...positions].reverse().find((position) => position < track.scrollLeft - 4);
    const destination = nextPosition ?? (direction > 0 ? maximumScroll : 0);

    track.scrollTo({
      left: Math.max(0, Math.min(destination, maximumScroll)),
      behavior: motionPaused ? 'instant' : 'smooth',
    });
    requestFrame();
  }

  previousButton?.addEventListener('click', () => moveGallery(-1));
  nextButton?.addEventListener('click', () => moveGallery(1));
  track?.addEventListener('scroll', requestFrame, { passive: true });

  // Native dialog supplies keyboard focus containment and Escape dismissal.
  const photoDialog = document.querySelector('#photo-dialog');
  const dialogImage = photoDialog?.querySelector('[data-dialog-image]');
  const dialogCaption = photoDialog?.querySelector('[data-dialog-caption]');
  const dialogClose = photoDialog?.querySelector('[data-dialog-close]');
  let photoTrigger = null;

  if (photoDialog && dialogImage && typeof photoDialog.showModal === 'function') {
    document.querySelectorAll('[data-photo]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        const source = trigger.getAttribute('data-photo');
        if (!source) return;
        event.preventDefault();
        photoTrigger = trigger;
        const caption = trigger.getAttribute('data-caption') || '';
        dialogImage.src = source;
        dialogImage.alt = trigger.getAttribute('data-photo-alt') || trigger.querySelector('img')?.alt || caption;
        if (dialogCaption) dialogCaption.textContent = caption;
        closeMenu();
        if (!photoDialog.open) photoDialog.showModal();
        body.classList.add('photo-open');
        dialogClose?.focus({ preventScroll: true });
      });
    });

    dialogClose?.addEventListener('click', () => photoDialog.close());
    photoDialog.addEventListener('click', (event) => {
      if (event.target !== photoDialog) return;
      const bounds = photoDialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) photoDialog.close();
    });
    photoDialog.addEventListener('close', () => {
      body.classList.remove('photo-open');
      if (photoTrigger?.isConnected) photoTrigger.focus({ preventScroll: true });
      photoTrigger = null;
    });
  }

  // All scroll and resize work shares a single frame; no permanent animation loop.
  function requestFrame() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(updateFrame);
  }

  function updateFrame() {
    framePending = false;
    const scrollTop = Math.max(0, window.scrollY);
    const scrollRange = Math.max(0, root.scrollHeight - window.innerHeight);
    root.style.setProperty('--scroll-progress', String(scrollRange ? Math.min(1, scrollTop / scrollRange) : 0));
    header?.classList.toggle('is-scrolled', scrollTop > 30);

    if (!motionPaused) {
      const viewportCenter = window.innerHeight / 2;
      for (const element of visibleParallax) {
        const factor = Number.parseFloat(element.getAttribute('data-parallax'));
        if (!Number.isFinite(factor)) continue;
        const bounds = element.getBoundingClientRect();
        // Measure the untransformed position, avoiding drift between repeated frames.
        const center = bounds.top - (parallaxOffsets.get(element) || 0) + bounds.height / 2;
        const offset = Number(Math.max(-80, Math.min(80, (viewportCenter - center) * factor)).toFixed(2));
        element.style.setProperty('--parallax-y', `${offset}px`);
        parallaxOffsets.set(element, offset);
      }
    }
    updateGallery();
  }

  const year = document.querySelector('#year');
  if (year) year.textContent = String(new Date().getFullYear());

  window.addEventListener('scroll', requestFrame, { passive: true });
  window.addEventListener('resize', requestFrame, { passive: true });
  window.addEventListener('load', requestFrame, { once: true });
  document.addEventListener('focusin', (event) => {
    // Keyboard navigation must never focus an element that is waiting to reveal.
    if (event.target instanceof Element) {
      event.target.closest('[data-reveal]')?.classList.add('is-visible');
    }
  });

  body.classList.add('js-ready');
  setMotionState(motionPaused);
  window.requestAnimationFrame(() => body.classList.add('is-loaded'));
})();
