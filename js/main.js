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
    syncGalleryPlayback();
    requestFrame();
  }

  reducedMotion.addEventListener('change', (event) => {
    setMotionState(event.matches);
  });

  const track = document.querySelector('.landscape-track');
  const cards = track ? [...track.querySelectorAll('.landscape-card')] : [];
  const galleryRegion = track?.closest('.gallery-section') || track;
  const previousButton = document.querySelector('[data-gallery-prev]');
  const nextButton = document.querySelector('[data-gallery-next]');
  const currentIndicator = document.querySelector('[data-gallery-current]');
  const totalIndicator = document.querySelector('[data-gallery-total]');
  const formatIndex = (value) => String(value).padStart(2, '0');
  const galleryInterval = 4200;
  const interactionDelay = 6000;
  const cloneCards = [];
  let activeGalleryIndex = -1;
  let galleryVisible = false;
  let galleryHovered = false;
  let galleryInputMode = 'pointer';
  let galleryWindowFocused = true;
  let galleryPointerActive = false;
  let galleryTransitioning = false;
  let galleryResumeAt = 0;
  let galleryAutoTimer;
  let gallerySettleTimer;
  let pendingGalleryMove = null;
  let galleryWidth = track?.clientWidth || 0;
  let cachedGalleryWidth = -1;
  let cachedGalleryPositions = [];

  if (totalIndicator) totalIndicator.textContent = formatIndex(cards.length);

  // A second identical sequence provides a forward wrap without an animated rewind.
  // Its images reuse the same lazy-loaded URLs; only the originals enter the tab order.
  if (track && cards.length > 1) {
    const fragment = document.createDocumentFragment();
    cards.forEach((card, index) => {
      const clone = card.cloneNode(true);
      clone.classList.add('is-clone');
      clone.classList.remove('is-current');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('data-active', 'false');
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
      clone.querySelectorAll('[data-photo]').forEach((element) => element.removeAttribute('data-photo'));
      clone.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((element) => {
        element.setAttribute('tabindex', '-1');
      });
      clone.querySelectorAll('img').forEach((image) => { image.loading = 'lazy'; });
      const cloneButton = clone.querySelector('button');
      // A pointer can open a visible duplicate, but focus and dialog ownership stay on the original.
      cloneButton?.addEventListener('pointerdown', (event) => event.preventDefault());
      cloneButton?.addEventListener('click', (event) => {
        event.preventDefault();
        rememberGalleryInteraction();
        normalizeGallery();
        cards[index].querySelector('[data-photo]')?.click();
      });
      cloneCards.push(clone);
      fragment.append(clone);
    });
    track.append(fragment);
  }
  const renderedCards = [...cards, ...cloneCards];

  function cardPositions() {
    if (!track || !cards.length) return [];
    if (cachedGalleryWidth !== track.clientWidth) {
      cachedGalleryWidth = track.clientWidth;
      const firstLeft = cards[0].offsetLeft;
      cachedGalleryPositions = renderedCards.map((card) => card.offsetLeft - firstLeft);
    }
    return cachedGalleryPositions;
  }

  function galleryIndex(scrollLeft, positions) {
    const span = positions[cards.length] || 0;
    const logicalPosition = span ? ((scrollLeft % span) + span) % span : scrollLeft;
    let closestIndex = 0;
    let distance = span ? Math.min(logicalPosition, span - logicalPosition) : Math.abs(logicalPosition);
    positions.slice(0, cards.length).forEach((position, index) => {
      const candidateDistance = Math.abs(position - logicalPosition);
      if (candidateDistance < distance) {
        closestIndex = index;
        distance = candidateDistance;
      }
    });
    return closestIndex;
  }

  function normalizeGallery() {
    if (!track) return 0;
    let position = track.scrollLeft;
    if (!cloneCards.length) return position;
    const span = cardPositions()[cards.length];
    if (span && position >= span - 1) {
      position = Math.max(0, position - span);
      track.scrollTo({ left: position, behavior: 'instant' });
    }
    return position;
  }

  function clearGalleryAutoTimer() {
    window.clearTimeout(galleryAutoTimer);
    galleryAutoTimer = undefined;
  }

  function clearGallerySettleTimer() {
    window.clearTimeout(gallerySettleTimer);
    gallerySettleTimer = undefined;
  }

  function hasGalleryKeyboardFocus() {
    const focused = document.activeElement;
    return galleryInputMode === 'keyboard' && focused instanceof Element
      && focused !== galleryRegion && Boolean(galleryRegion?.contains(focused))
      && focused.matches('a[href], button, input, select, textarea, [tabindex]');
  }

  function canGalleryPlay() {
    return cards.length > 1 && galleryVisible && !document.hidden && galleryWindowFocused && !motionPaused
      && !galleryHovered && !hasGalleryKeyboardFocus() && !galleryPointerActive && !photoDialog?.open;
  }

  function syncGalleryPlayback() {
    clearGalleryAutoTimer();
    if (!canGalleryPlay()) {
      if (!galleryVisible || document.hidden || motionPaused) {
        clearGallerySettleTimer();
        if (galleryTransitioning && track) {
          track.scrollTo({ left: track.scrollLeft, behavior: 'instant' });
          galleryTransitioning = false;
        }
        normalizeGallery();
      }
      return;
    }
    if (galleryTransitioning) return;
    const delay = Math.max(galleryInterval, galleryResumeAt - Date.now());
    galleryAutoTimer = window.setTimeout(() => {
      galleryAutoTimer = undefined;
      if (canGalleryPlay()) moveGallery(1, { automatic: true });
    }, delay);
  }

  function rememberGalleryInteraction() {
    galleryResumeAt = Date.now() + interactionDelay;
    syncGalleryPlayback();
  }

  function finishGalleryMotion() {
    clearGallerySettleTimer();
    if (galleryPointerActive || pendingGalleryMove) return;
    galleryTransitioning = false;
    normalizeGallery();
    requestFrame();
    syncGalleryPlayback();
  }

  function scheduleGallerySettle() {
    clearGallerySettleTimer();
    if (!galleryVisible || document.hidden) return;
    gallerySettleTimer = window.setTimeout(finishGalleryMotion, 180);
  }

  function setGalleryVisibility(visible) {
    if (galleryVisible === visible) return;
    galleryVisible = visible;
    syncGalleryPlayback();
  }

  function updateGallery() {
    if (!track || !cards.length) return;
    if (!('IntersectionObserver' in window)) {
      const bounds = track.getBoundingClientRect();
      setGalleryVisibility(bounds.bottom > 0 && bounds.top < window.innerHeight);
    }
    const positions = cardPositions();
    if (Math.abs(track.clientWidth - galleryWidth) > 1) {
      galleryWidth = track.clientWidth;
      clearGallerySettleTimer();
      galleryTransitioning = false;
      track.scrollTo({ left: positions[Math.max(0, activeGalleryIndex)], behavior: 'instant' });
      syncGalleryPlayback();
    }
    const closestIndex = galleryIndex(track.scrollLeft, positions);
    if (closestIndex !== activeGalleryIndex) {
      renderedCards.forEach((card, index) => {
        const isCurrent = index % cards.length === closestIndex;
        card.classList.toggle('is-current', isCurrent);
        card.setAttribute('data-active', String(isCurrent));
      });
      if (currentIndicator) currentIndicator.textContent = formatIndex(closestIndex + 1);
      activeGalleryIndex = closestIndex;
    }
    if (previousButton) previousButton.disabled = cards.length < 2;
    if (nextButton) nextButton.disabled = cards.length < 2;
  }

  function moveGallery(direction, { focusCard = false, automatic = false } = {}) {
    if (!track || cards.length < 2) return;
    if (!automatic) rememberGalleryInteraction();
    clearGalleryAutoTimer();
    clearGallerySettleTimer();
    pendingGalleryMove = null;
    const beforeNormalization = track.scrollLeft;
    let origin = normalizeGallery();
    let jumped = Math.abs(origin - beforeNormalization) > 1;
    const positions = cardPositions();
    const span = positions[cards.length];
    if (direction < 0 && origin <= 2 && span) {
      origin = span;
      jumped = true;
      track.scrollTo({ left: origin, behavior: 'instant' });
    }
    const maximumScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const nextPosition = direction > 0
      ? positions.find((position) => position > origin + 4)
      : [...positions].reverse().find((position) => position < origin - 4);
    const destination = Math.max(0, Math.min(nextPosition ?? (direction > 0 ? maximumScroll : 0), maximumScroll));

    const performMove = () => {
      if (focusCard) {
        const index = galleryIndex(destination, positions);
        cards[index]?.querySelector('button')?.focus({ preventScroll: true });
      }
      galleryTransitioning = !motionPaused;
      track.scrollTo({
        left: destination,
        behavior: motionPaused ? 'instant' : 'smooth',
      });
      if (motionPaused) finishGalleryMotion();
      else scheduleGallerySettle();
    };
    if (jumped) {
      // Let the instant jump settle before starting a smooth move from its new origin.
      galleryTransitioning = true;
      pendingGalleryMove = performMove;
    } else {
      performMove();
    }
    requestFrame();
  }

  previousButton?.addEventListener('click', () => moveGallery(-1));
  nextButton?.addEventListener('click', () => moveGallery(1));
  track?.addEventListener('scroll', () => {
    requestFrame();
    if (galleryVisible && !document.hidden) {
      galleryTransitioning = true;
      clearGalleryAutoTimer();
      scheduleGallerySettle();
    }
  }, { passive: true });
  // Debounce actual scroll activity instead of scrollend: an instant seam jump can
  // dispatch a delayed scrollend while the following smooth move is already starting.
  track?.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    moveGallery(event.key === 'ArrowRight' ? 1 : -1, { focusCard: event.target !== track });
  });
  track?.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return;
    galleryHovered = true;
    syncGalleryPlayback();
  });
  track?.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse') return;
    galleryHovered = false;
    rememberGalleryInteraction();
  });
  galleryRegion?.addEventListener('pointerdown', () => {
    galleryPointerActive = true;
    rememberGalleryInteraction();
  }, { passive: true });
  const releaseGalleryPointer = () => {
    if (!galleryPointerActive) return;
    galleryPointerActive = false;
    rememberGalleryInteraction();
    scheduleGallerySettle();
  };
  window.addEventListener('pointerup', releaseGalleryPointer, { passive: true });
  window.addEventListener('pointercancel', releaseGalleryPointer, { passive: true });
  // Browser focus can remain on a touched button. Only keyboard focus holds playback.
  document.addEventListener('keydown', (event) => {
    if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return;
    galleryInputMode = 'keyboard';
    if (hasGalleryKeyboardFocus()) syncGalleryPlayback();
  });
  document.addEventListener('pointerdown', () => {
    const wasKeyboardFocused = hasGalleryKeyboardFocus();
    galleryInputMode = 'pointer';
    if (wasKeyboardFocused) rememberGalleryInteraction();
  }, { capture: true, passive: true });
  galleryRegion?.addEventListener('focusin', syncGalleryPlayback);
  galleryRegion?.addEventListener('focusout', () => {
    window.queueMicrotask(() => {
      rememberGalleryInteraction();
    });
  });
  track?.addEventListener('wheel', rememberGalleryInteraction, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) galleryPointerActive = false;
    galleryHovered = !document.hidden && window.matchMedia('(hover: hover)').matches
      && Boolean(track?.matches(':hover'));
    syncGalleryPlayback();
  });
  window.addEventListener('blur', () => {
    galleryWindowFocused = false;
    galleryPointerActive = false;
    clearGalleryAutoTimer();
  });
  window.addEventListener('focus', () => {
    galleryWindowFocused = true;
    rememberGalleryInteraction();
  });
  if (track && 'IntersectionObserver' in window) {
    const galleryObserver = new IntersectionObserver((entries) => {
      setGalleryVisibility(entries[0].isIntersecting && entries[0].intersectionRatio >= 0.15);
    }, { threshold: [0, 0.15] });
    galleryObserver.observe(track);
  }

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
        syncGalleryPlayback();
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
      rememberGalleryInteraction();
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
    if (pendingGalleryMove) {
      const performMove = pendingGalleryMove;
      pendingGalleryMove = null;
      performMove();
    }
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
