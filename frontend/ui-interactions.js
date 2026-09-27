/* =========================================================
   Focus Guard AI — UI Interaction Enhancements
   Presentation-only layer. Does not change app logic/data.
   ========================================================= */

(function () {
  'use strict';

  const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');
  const COARSE = window.matchMedia('(hover: none), (pointer: coarse)');
  const NARROW = window.matchMedia('(max-width: 768px)');

  function canUseFancyMotion() {
    return !REDUCE.matches;
  }

  function canUseCursor() {
    return canUseFancyMotion() && !COARSE.matches && !NARROW.matches;
  }

  /* ─── Glowing circle cursor ─── */
  let cursorDot = null;
  let cursorRing = null;
  let cursorGlow = null;
  let cursorEnabled = false;
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let dotX = mouseX;
  let dotY = mouseY;
  let ringX = mouseX;
  let ringY = mouseY;
  let glowX = mouseX;
  let glowY = mouseY;
  let rafId = 0;
  let hoveringInteractive = false;

  const INTERACTIVE_SEL =
    'a, button, .btn, .nav-item, .card, .card-hover, .stat-card, .metric-card, .goal-card, .badge-card, .fitness-award-card, .heatmap-cell, .auth-tab, .activity-filter-btn, [role="button"], input[type="submit"], input[type="button"], label, .shield-chip, [id^="filterBadge"], .analytics-metric-card, .analytics-range-btn, .ach-filter-btn, .live-chip, .topbar-streak-pill, .apple-stat-tile, .fs-meter, .report-metric, .fs-filter-btn';

  function ensureCursorEls() {
    if (cursorDot) return;
    cursorGlow = document.createElement('div');
    cursorGlow.className = 'fg-cursor-glow';
    cursorGlow.setAttribute('aria-hidden', 'true');
    cursorRing = document.createElement('div');
    cursorRing.className = 'fg-cursor-ring';
    cursorRing.setAttribute('aria-hidden', 'true');
    cursorDot = document.createElement('div');
    cursorDot.className = 'fg-cursor';
    cursorDot.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursorGlow);
    document.body.appendChild(cursorRing);
    document.body.appendChild(cursorDot);
  }

  function setCursorVisible(on) {
    if (!cursorDot) return;
    cursorDot.classList.toggle('is-visible', on);
    cursorRing.classList.toggle('is-visible', on);
    cursorGlow.classList.toggle('is-visible', on);
  }

  function setHoverState(on) {
    hoveringInteractive = !!on;
    cursorDot?.classList.toggle('is-hover', hoveringInteractive);
    cursorRing?.classList.toggle('is-hover', hoveringInteractive);
    cursorGlow?.classList.toggle('is-hover', hoveringInteractive);
  }

  function cursorLoop() {
    if (!cursorEnabled) return;
    const lerpDot = 0.42;
    const lerpRing = 0.22;
    const lerpGlow = 0.14;
    dotX += (mouseX - dotX) * lerpDot;
    dotY += (mouseY - dotY) * lerpDot;
    ringX += (mouseX - ringX) * lerpRing;
    ringY += (mouseY - ringY) * lerpRing;
    glowX += (mouseX - glowX) * lerpGlow;
    glowY += (mouseY - glowY) * lerpGlow;
    cursorDot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;
    cursorRing.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
    cursorGlow.style.transform = `translate3d(${glowX}px, ${glowY}px, 0) translate(-50%, -50%)`;
    rafId = requestAnimationFrame(cursorLoop);
  }

  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!cursorDot.classList.contains('is-visible')) setCursorVisible(true);
    const hit = e.target && e.target.closest && e.target.closest(INTERACTIVE_SEL);
    if (!!hit !== hoveringInteractive) setHoverState(!!hit);
  }

  function onMouseOver(e) {
    const hit = e.target.closest && e.target.closest(INTERACTIVE_SEL);
    setHoverState(!!hit);
  }

  function onMouseDown() {
    cursorDot?.classList.add('is-down');
    cursorRing?.classList.add('is-down');
  }
  function onMouseUp() {
    cursorDot?.classList.remove('is-down');
    cursorRing?.classList.remove('is-down');
  }
  function onMouseLeaveDoc() {
    setCursorVisible(false);
  }

  function enableCursor() {
    if (cursorEnabled || !canUseCursor()) return;
    ensureCursorEls();
    cursorEnabled = true;
    document.body.classList.add('has-fg-cursor');
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseover', onMouseOver, { passive: true });
    document.addEventListener('mousedown', onMouseDown, { passive: true });
    document.addEventListener('mouseup', onMouseUp, { passive: true });
    document.documentElement.addEventListener('mouseleave', onMouseLeaveDoc, { passive: true });
    rafId = requestAnimationFrame(cursorLoop);
  }

  function disableCursor() {
    if (!cursorEnabled && !document.body.classList.contains('has-fg-cursor')) {
      cursorDot?.remove();
      cursorRing?.remove();
      cursorGlow?.remove();
      cursorDot = cursorRing = cursorGlow = null;
      return;
    }
    cursorEnabled = false;
    cancelAnimationFrame(rafId);
    document.body.classList.remove('has-fg-cursor');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseover', onMouseOver);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.documentElement.removeEventListener('mouseleave', onMouseLeaveDoc);
    setCursorVisible(false);
    cursorDot?.remove();
    cursorRing?.remove();
    cursorGlow?.remove();
    cursorDot = cursorRing = cursorGlow = null;
  }

  function syncCursorMode() {
    if (canUseCursor()) enableCursor();
    else disableCursor();
  }

  /* ─── Magnetic buttons (primary CTAs only) ─── */
  const MAGNETIC_SEL = [
    '#dashStartSessionBtn',
    '#startTimerBtn',
    '#loginBtn',
    '#registerBtn',
    '.btn-primary.btn-lg',
    '#btnSaveBlocklist',
  ].join(',');

  function bindMagnetic(el) {
    if (!el || el.dataset.fgMagnetic === '1') return;
    el.dataset.fgMagnetic = '1';
    el.classList.add('btn-magnetic');

    const strength = 10;
    const ease = 0.18;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let active = false;
    let frame = 0;

    function tick() {
      tx += (cx - tx) * ease;
      ty += (cy - ty) * ease;
      el.style.setProperty('--fg-mx', `${tx.toFixed(2)}px`);
      el.style.setProperty('--fg-my', `${ty.toFixed(2)}px`);
      if (active || Math.abs(tx) > 0.05 || Math.abs(ty) > 0.05) {
        frame = requestAnimationFrame(tick);
      } else {
        el.style.setProperty('--fg-mx', '0px');
        el.style.setProperty('--fg-my', '0px');
        frame = 0;
      }
    }

    el.addEventListener('pointermove', (e) => {
      if (!canUseFancyMotion() || COARSE.matches) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      cx = Math.max(-strength, Math.min(strength, dx * 0.22));
      cy = Math.max(-strength, Math.min(strength, dy * 0.22));
      active = true;
      if (!frame) frame = requestAnimationFrame(tick);
    });

    el.addEventListener('pointerleave', () => {
      active = false;
      cx = 0;
      cy = 0;
      if (!frame) frame = requestAnimationFrame(tick);
    });
  }

  function initMagnetic() {
    document.querySelectorAll(MAGNETIC_SEL).forEach(bindMagnetic);
  }

  /* ─── Scroll / tab reveal ─── */
  let revealObserver = null;

  function markRevealTargets(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
      '.stat-card, .card, .goal-card, .badge-card, .metric-card, .analytics-metric-card, .chart-card, .session-banner, .timer-card, .feature-card, .shield-panel, .analytics-chart-card'
    );
    nodes.forEach((el, i) => {
      if (el.dataset.fgRevealInit === '1') return;
      // Skip nested cards inside already-revealing parents to avoid double fade
      if (el.parentElement?.closest('.fg-reveal')) return;
      el.dataset.fgRevealInit = '1';
      el.classList.add('fg-reveal');
      el.style.setProperty('--fg-delay', `${Math.min(i % 6, 5) * 40}ms`);
      if (revealObserver) revealObserver.observe(el);
    });
  }

  function initReveal() {
    if (!canUseFancyMotion()) {
      document.querySelectorAll('.fg-reveal').forEach((el) => el.classList.add('is-inview'));
      return;
    }
    if (revealObserver) revealObserver.disconnect();
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    markRevealTargets(document);
  }

  function refreshRevealForActiveTab() {
    const pane = document.querySelector('.tab-pane.active');
    if (!pane) return;
    pane.querySelectorAll('.fg-reveal').forEach((el) => {
      el.classList.remove('is-inview');
      if (revealObserver) revealObserver.observe(el);
    });
    markRevealTargets(pane);
    // Immediately reveal above-the-fold items
    requestAnimationFrame(() => {
      pane.querySelectorAll('.fg-reveal').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.92 && r.bottom > 0) {
          el.classList.add('is-inview');
          revealObserver?.unobserve(el);
        }
      });
    });
  }

  /* ─── Number / percent presentation animations ─── */
  function parseCountable(text) {
    const t = String(text ?? '').trim();
    if (!t || t === '—' || t === '-' || t === '…') return null;
    const m = t.match(/^(-?\d+(?:\.\d+)?)(%)?$/);
    if (!m) return null;
    return { value: parseFloat(m[1]), suffix: m[2] || '', raw: t };
  }

  function observeStatNodes() {
    const targets = [
      '#scoreVal',
      '#switchVal',
      '#streakCount',
    ]
      .map((s) => document.querySelector(s))
      .filter(Boolean);

    targets.forEach((el) => {
      if (el.dataset.fgCountObs === '1') return;
      el.dataset.fgCountObs = '1';
      let last = el.textContent;
      let locked = false;
      const mo = new MutationObserver(() => {
        if (locked) return;
        const destination = el.textContent;
        if (destination === last) return;

        const parsed = parseCountable(destination);
        if (!parsed || !canUseFancyMotion() || typeof gsap === 'undefined') {
          last = destination;
          return;
        }

        const fromParsed = parseCountable(last);
        const from = fromParsed ? fromParsed.value : 0;
        if (Math.abs(from - parsed.value) < 0.5) {
          last = destination;
          return;
        }

        locked = true;
        const startFrom = from;
        last = destination;
        const obj = { v: startFrom };
        gsap.killTweensOf(obj);
        el.textContent = `${Math.round(startFrom)}${parsed.suffix}`;
        gsap.to(obj, {
          v: parsed.value,
          duration: 0.55,
          ease: 'power2.out',
          onUpdate: () => {
            el.textContent = `${Math.round(obj.v)}${parsed.suffix}`;
          },
          onComplete: () => {
            el.textContent = destination;
            last = destination;
            locked = false;
          },
        });
      });
      mo.observe(el, { characterData: true, childList: true, subtree: true });
    });
  }

  /* ─── Focus timer visual polish (no logic changes) ─── */
  function syncTimerVisualState() {
    const badge =
      document.querySelector('#focusSessionStatusBadge') ||
      document.querySelector('#dashSessionBadge');
    const active =
      badge && /SESSION ACTIVE/i.test(badge.textContent || '');
    document.querySelectorAll('.timer-ring-wrap').forEach((wrap) => {
      wrap.classList.toggle('fg-timer-active', !!active);
    });
    const banner = document.querySelector('#dashSessionCard');
    if (banner) banner.classList.toggle('fg-session-live', !!active);
  }

  function observeSessionBadge() {
    const badges = [
      document.querySelector('#focusSessionStatusBadge'),
      document.querySelector('#dashSessionBadge'),
    ].filter(Boolean);
    badges.forEach((badge) => {
      if (badge.dataset.fgBadgeObs === '1') return;
      badge.dataset.fgBadgeObs = '1';
      const mo = new MutationObserver(syncTimerVisualState);
      mo.observe(badge, { characterData: true, childList: true, subtree: true });
    });
    syncTimerVisualState();
  }

  /* ─── Page / tab entrance via GSAP (lightweight) ─── */
  function animatePageEntrance() {
    if (!canUseFancyMotion() || typeof gsap === 'undefined') return;
    const shell = document.querySelector('#appShell');
    if (!shell || shell.dataset.fgEntered === '1') return;
    const loggedIn = document.documentElement.classList.contains('logged-in');
    const inlineHidden = shell.style.display === 'none' && !loggedIn;
    if (inlineHidden) return;
    shell.dataset.fgEntered = '1';
    const parts = [
      shell.querySelector('.sidebar'),
      shell.querySelector('.topbar'),
      shell.querySelector('.content'),
    ].filter(Boolean);
    if (!parts.length) return;
    gsap.fromTo(
      parts,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.55, stagger: 0.06, ease: 'power3.out' }
    );
  }

  function onNavClick() {
    // After tab class updates, refresh reveals
    requestAnimationFrame(() => {
      setTimeout(() => {
        refreshRevealForActiveTab();
        initMagnetic();
        observeStatNodes();
        observeSessionBadge();
        if (canUseFancyMotion() && typeof gsap !== 'undefined') {
          const pane = document.querySelector('.tab-pane.active');
          if (!pane) return;
          const hero = pane.querySelector('.page-hero, .session-banner, .timer-card, .analytics-hero');
          if (hero) {
            gsap.fromTo(
              hero,
              { opacity: 0.7, y: 8 },
              { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
            );
          }
        }
      }, 20);
    });
  }

  function bindNavEnhancements() {
    document.querySelectorAll('.nav-item[data-tab]').forEach((btn) => {
      if (btn.dataset.fgNavEnh === '1') return;
      btn.dataset.fgNavEnh = '1';
      btn.addEventListener('click', onNavClick);
    });
  }

  /* ─── Click ripple-free press feedback on icons ─── */
  function bindIconPress() {
    document.addEventListener(
      'click',
      (e) => {
        const icon = e.target.closest?.(
          '.stat-icon, .nav-icon-wrap, .material-symbols-outlined, .btn-icon'
        );
        if (!icon || !canUseFancyMotion()) return;
        icon.animate(
          [
            { transform: 'scale(1)' },
            { transform: 'scale(0.9)' },
            { transform: 'scale(1)' },
          ],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
      },
      true
    );
  }

  /* ─── Progress bar presentation: ensure CSS class on known fills ─── */
  function enhanceProgressBars() {
    document
      .querySelectorAll('.progress-bar > span, .progress-fill, .goal-progress-bar > div, .signal-meter span')
      .forEach((el) => {
        el.style.transition = el.style.transition || 'width 0.8s cubic-bezier(0.22, 1, 0.36, 1)';
      });
  }

  /* ─── Public init ─── */
  function initUIInteractions() {
    syncCursorMode();
    initMagnetic();
    initReveal();
    observeStatNodes();
    observeSessionBadge();
    bindNavEnhancements();
    bindIconPress();
    enhanceProgressBars();
    animatePageEntrance();
    refreshRevealForActiveTab();

    // Re-bind when auth succeeds / shell appears
    const shell = document.querySelector('#appShell');
    if (shell) {
      const mo = new MutationObserver(() => {
        if (shell.style.display !== 'none' || document.documentElement.classList.contains('logged-in')) {
          animatePageEntrance();
          initMagnetic();
          markRevealTargets(shell);
          observeStatNodes();
          observeSessionBadge();
        }
      });
      mo.observe(shell, { attributes: true, attributeFilter: ['style', 'class'] });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    }

    REDUCE.addEventListener?.('change', () => {
      syncCursorMode();
      if (REDUCE.matches) {
        document.querySelectorAll('.fg-reveal').forEach((el) => el.classList.add('is-inview'));
      }
    });
    COARSE.addEventListener?.('change', syncCursorMode);
    NARROW.addEventListener?.('change', syncCursorMode);

    // Periodic light rebind for dynamically injected CTAs (goals, modals)
    setInterval(() => {
      initMagnetic();
      markRevealTargets(document.querySelector('.tab-pane.active') || document);
    }, 4000);
  }

  window.initUIInteractions = initUIInteractions;
  window.fgRefreshUIInteractions = function () {
    initMagnetic();
    observeStatNodes();
    observeSessionBadge();
    refreshRevealForActiveTab();
    syncTimerVisualState();
    animatePageEntrance();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUIInteractions);
  } else {
    initUIInteractions();
  }
})();
