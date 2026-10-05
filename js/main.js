(() => {
  'use strict';

  const body = document.body;
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealElements = [...document.querySelectorAll('[data-reveal]')];
  const parallaxElements = [...document.querySelectorAll('[data-parallax]')];
  const scrollScenes = [...document.querySelectorAll('[data-scroll-scene]')];
  const visibleParallax = new Set();
  const visibleScenes = new Set();
  const parallaxOffsets = new WeakMap();
  let motionPaused = reducedMotion.matches;
  let framePending = false;

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('#main-nav');
  const menuBackground = [document.querySelector('main'), document.querySelector('.site-footer')].filter(Boolean);
  const initialInertStates = new Map();
  let activeNavigation;
  const navigationItems = navigation ? [...navigation.querySelectorAll('a[href^="#"]')].map((link) => ({
    link,
    section: document.getElementById(link.getAttribute('href').slice(1)),
  })).filter((item) => item.section) : [];

  function focusSection(section) {
    if (!section) return;
    const hadTabIndex = section.hasAttribute('tabindex');
    if (!hadTabIndex) section.setAttribute('tabindex', '-1');
    section.focus({ preventScroll: true });
    if (!hadTabIndex) section.addEventListener('blur', () => section.removeAttribute('tabindex'), { once: true });
  }

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
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (!link) return;
      const wasOpen = body.classList.contains('menu-open');
      closeMenu();
      if (wasOpen) focusSection(navigationItems.find((item) => item.link === link)?.section);
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
          .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
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

    window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
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

    const sceneObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('is-inview', entry.isIntersecting);
        if (entry.isIntersecting) {
          visibleScenes.add(entry.target);
        } else {
          visibleScenes.delete(entry.target);
          if (!motionPaused) {
            const progress = entry.boundingClientRect.bottom <= 0 ? 1 : 0;
            entry.target.style.setProperty('--scene-progress', String(progress));
            entry.target.style.setProperty('--scene-travel', String(progress * 2 - 1));
          }
        }
      }
      requestFrame();
    }, { rootMargin: '0px', threshold: 0 });
    scrollScenes.forEach((scene) => sceneObserver.observe(scene));
  } else {
    revealElements.forEach((element) => element.classList.add('is-visible'));
    parallaxElements.forEach((element) => visibleParallax.add(element));
    scrollScenes.forEach((scene) => visibleScenes.add(scene));
  }

  function setMotionState(paused) {
    motionPaused = paused;
    body.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-enabled', !paused);
    if (paused) {
      revealObserver?.disconnect();
      revealElements.forEach((element) => element.classList.add('is-visible'));
      parallaxElements.forEach((element) => {
        element.style.setProperty('--parallax-y', '0px');
        parallaxOffsets.set(element, 0);
      });
      scrollScenes.forEach((scene) => {
        scene.style.setProperty('--scene-progress', '0.5');
        scene.style.setProperty('--scene-travel', '0');
      });
      track?.scrollTo({ left: track.scrollLeft, behavior: 'instant' });
    } else {
      revealElements.forEach((element) => {
        if (!element.classList.contains('is-visible')) revealObserver?.observe(element);
      });
    }
    requestFrame();
  }

  reducedMotion.addEventListener('change', (event) => {
    setMotionState(event.matches);
  });

  const track = document.querySelector('.landscape-track');
  const cards = track ? [...track.querySelectorAll('.landscape-card')] : [];
  const previousButton = document.querySelector('[data-gallery-prev]');
  const nextButton = document.querySelector('[data-gallery-next]');
  const currentIndicator = document.querySelector('[data-gallery-current]');
  const totalIndicator = document.querySelector('[data-gallery-total]');
  const formatIndex = (value) => String(value).padStart(2, '0');
  let activeGalleryIndex = -1;

  if (totalIndicator) totalIndicator.textContent = formatIndex(cards.length);

  function cardPositions() {
    if (!track || !cards.length) return [];
    const firstLeft = cards[0].offsetLeft;
    return cards.map((card) => card.offsetLeft - firstLeft);
  }

  function galleryIndex(scrollLeft, maximumScroll, positions) {
    let closestIndex = 0;
    positions.forEach((position, index) => {
      if (Math.abs(position - scrollLeft) < Math.abs(positions[closestIndex] - scrollLeft)) {
        closestIndex = index;
      }
    });
    // A final card may stop before its left edge reaches the viewport edge.
    if (maximumScroll > 2 && scrollLeft >= maximumScroll - 2) closestIndex = cards.length - 1;
    return closestIndex;
  }

  function updateGallery() {
    if (!track || !cards.length) return;
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const closestIndex = galleryIndex(track.scrollLeft, maximumScroll, cardPositions());
    if (closestIndex !== activeGalleryIndex) {
      cards.forEach((card, index) => {
        const isCurrent = index === closestIndex;
        card.classList.toggle('is-current', isCurrent);
        card.setAttribute('data-active', String(isCurrent));
      });
      if (currentIndicator) currentIndicator.textContent = formatIndex(closestIndex + 1);
      activeGalleryIndex = closestIndex;
    }
    if (previousButton) previousButton.disabled = track.scrollLeft <= 2;
    if (nextButton) nextButton.disabled = track.scrollLeft >= maximumScroll - 2;
  }

  function moveGallery(direction, { focusCard = false } = {}) {
    if (!track || !cards.length) return;
    const positions = cardPositions();
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const nextPosition = direction > 0
      ? positions.find((position) => position > track.scrollLeft + 4)
      : [...positions].reverse().find((position) => position < track.scrollLeft - 4);
    const destination = Math.max(0, Math.min(nextPosition ?? (direction > 0 ? maximumScroll : 0), maximumScroll));

    if (focusCard) {
      const index = galleryIndex(destination, maximumScroll, positions);
      cards[index]?.querySelector('button')?.focus({ preventScroll: true });
    }
    track.scrollTo({
      left: destination,
      behavior: motionPaused ? 'instant' : 'smooth',
    });
    requestFrame();
  }

  previousButton?.addEventListener('click', () => moveGallery(-1));
  nextButton?.addEventListener('click', () => moveGallery(1));
  track?.addEventListener('scroll', requestFrame, { passive: true });
  track?.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    moveGallery(event.key === 'ArrowRight' ? 1 : -1, { focusCard: event.target !== track });
  });

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

    const navigationLine = Math.max(100, window.innerHeight * 0.3);
    let currentNavigation = null;
    for (const item of navigationItems) {
      if (item.section.getBoundingClientRect().top <= navigationLine) currentNavigation = item;
    }
    if (currentNavigation !== activeNavigation) {
      for (const item of navigationItems) {
        const isCurrent = item === currentNavigation;
        item.link.classList.toggle('is-active', isCurrent);
        if (isCurrent) item.link.setAttribute('aria-current', 'location');
        else item.link.removeAttribute('aria-current');
      }
      activeNavigation = currentNavigation;
    }

    if (!motionPaused) {
      for (const scene of visibleScenes) {
        // Scene sections stay untransformed; only their children consume these variables.
        const section = scene.closest('section') || scene;
        const bounds = section.getBoundingClientRect();
        if (!('IntersectionObserver' in window)) {
          scene.classList.toggle('is-inview', bounds.bottom > 0 && bounds.top < window.innerHeight);
        }
        const progress = Math.max(0, Math.min(1, (window.innerHeight - bounds.top) / (window.innerHeight + bounds.height)));
        scene.style.setProperty('--scene-progress', progress.toFixed(4));
        scene.style.setProperty('--scene-travel', (progress * 2 - 1).toFixed(4));
      }
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
