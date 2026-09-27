/**
 * FocusGuard AI — Production Application Controller
 * No demo data · Real-time · Premium UX
 */

'use strict';

/* ═══════════════════════════════════════════════════════
   CONFIG
   ═══════════════════════════════════════════════════════ */
const API = '/api';
const POLL_MS = 5000;

/* ═══════════════════════════════════════════════════════
   STATE
   ═══════════════════════════════════════════════════════ */
const state = {
  token: null,
  refresh: null,
  username: '',
  activeTab: 'dashboard',
  pollTimer: null,
  activeSessionId: null,
  chartCategory: null,
  chartDonut: null,
  lastSwitchCount: 0,
  liveSession: null,
  liveProdSecs: 0,
  liveDistSecs: 0,
  liveActiveApp: null,
  liveSwitches: 0,
  activityFilter: 'all',
};

/** Combined browsing + desktop rows for Activity & Apps table */
let currentActivityItems = [];

/* ═══════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ═══════════════════════════════════════════════════════ */
function toast(msg, type = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-dot"></span><span>${msg}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

/* ═══════════════════════════════════════════════════════
   AUTH
   ═══════════════════════════════════════════════════════ */
function loadToken() {
  state.token = localStorage.getItem('fg_token');
  state.refresh = localStorage.getItem('fg_refresh');
  state.username = localStorage.getItem('fg_user') || '';
}

function consumeGoogleRedirectTokens() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  const access = params.get('google_access');
  if (!access) return false;

  saveToken(access, params.get('google_user') || 'Google User', params.get('google_refresh') || '');
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return true;
}

function saveToken(token, username, refresh = '') {
  state.token = token;
  state.username = username;
  localStorage.setItem('fg_token', token);
  localStorage.setItem('fg_user', username);
  localStorage.setItem('focusguard_access_token', token);
  if (refresh) {
    state.refresh = refresh;
    localStorage.setItem('fg_refresh', refresh);
    localStorage.setItem('focusguard_refresh_token', refresh);
  }
}

window.handleGoogleCallback = async function(response) {
  if (!response || !response.credential) {
    toast('Google Login failed: No credential received', 'error');
    return;
  }
  try {
    const res = await fetch('/api/auth/google/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });
    const data = await res.json();
    if (res.ok && data.access) {
      saveToken(data.access, data.username, data.refresh || '');
      hideLogin();
      initApp();
      switchTab('dashboard');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      toast(`Signed in successfully as ${data.username || 'User'}`, 'success');
    } else {
      toast(data.detail || data.error || 'Google login failed', 'error');
    }
  } catch (e) {
    console.error('Google Auth Error:', e);
    toast('Connection error during Google Sign In', 'error');
  }
};

function clearToken() {
  state.token = null;
  state.refresh = null;
  state.username = '';
  localStorage.removeItem('fg_token');
  localStorage.removeItem('fg_refresh');
  localStorage.removeItem('fg_user');
  localStorage.removeItem('focusguard_access_token');
  localStorage.removeItem('focusguard_refresh_token');
  localStorage.removeItem('focusguard_session_active');
  document.documentElement.classList.remove('logged-in');
}

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  let res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401 && state.refresh) {
    try {
      const refreshRes = await fetch(`${API}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: state.refresh })
      });
      if (refreshRes.ok) {
        const d = await refreshRes.json();
        saveToken(d.access, state.username, d.refresh || state.refresh);
        headers['Authorization'] = `Bearer ${state.token}`;
        res = await fetch(API + path, { ...opts, headers });
        return res;
      }
    } catch {}
    signOut();
    throw new Error('Unauthorized');
  } else if (res.status === 401) {
    signOut();
    throw new Error('Unauthorized');
  }
  return res;
}

/* ═══════════════════════════════════════════════════════
   AUTH & LANDING PAGE PORTAL
   ═══════════════════════════════════════════════════════ */
function showLogin() {
  document.documentElement.classList.remove('logged-in');
  const lp = qs('#landingPage');
  const shell = qs('#appShell');
  if (lp) lp.style.display = 'block';
  if (shell) shell.style.display = 'none';
  showAuthTab('login');
}

function hideLogin() {
  document.documentElement.classList.add('logged-in');
  const lp = qs('#landingPage');
  const shell = qs('#appShell');
  if (lp) lp.style.display = 'none';
  if (shell) shell.style.display = 'flex';
}

function showAuthTab(tab) {
  const tabLogin = qs('#tabBtnLogin');
  const tabReg = qs('#tabBtnRegister');
  const formLogin = qs('#authLoginForm');
  const formReg = qs('#authRegisterForm');

  if (tab === 'register') {
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabReg) tabReg.classList.add('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formReg) formReg.style.display = 'flex';
  } else {
    if (tabReg) tabReg.classList.remove('active');
    if (tabLogin) tabLogin.classList.add('active');
    if (formReg) formReg.style.display = 'none';
    if (formLogin) formLogin.style.display = 'flex';
  }
}

function scrollToAuth() {
  const el = qs('#auth');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

/* ─── Password Visibility Eye Toggle ─── */
function initPasswordToggles() {
  qsa('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = qs(`#${targetId}`);
      if (!input) return;

      const eyeOpen = btn.querySelector('.eye-open');
      const eyeClosed = btn.querySelector('.eye-closed');

      if (input.type === 'password') {
        input.type = 'text';
        if (eyeOpen) eyeOpen.classList.add('hidden');
        if (eyeClosed) eyeClosed.classList.remove('hidden');
      } else {
        input.type = 'password';
        if (eyeOpen) eyeOpen.classList.remove('hidden');
        if (eyeClosed) eyeClosed.classList.add('hidden');
      }
    });
  });
}

qs('#loginBtn')?.addEventListener('click', doLogin);
qs('#loginUsername')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
qs('#loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const username = val('loginUsername').trim();
  const password = val('loginPassword');
  const errEl = qs('#authError');

  if (errEl) {
    errEl.textContent = '';
    errEl.classList.remove('show');
  }

  if (!username || !password) {
    showAuthError('Please enter your username and password.');
    return;
  }

  const btn = qs('#loginBtn');
  btn.textContent = 'Signing in…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      const d = await res.json();
      saveToken(d.access, username, d.refresh);
      hideLogin();
      initApp();
      toast('Signed in successfully', 'success');
    } else {
      showAuthError('Invalid username or password. Please try again.');
    }
  } catch {
    showAuthError('Cannot reach server. Make sure Django is running on port 8000.');
  } finally {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Sign In to FocusGuard`;
    btn.disabled = false;
  }
}

function showAuthError(msg) {
  const el = qs('#authError');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

qs('#registerBtn')?.addEventListener('click', doRegister);
qs('#regPasswordConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

async function doRegister() {
  const username = val('regUsername').trim();
  const firstName = val('regFirstName').trim();
  const lastName = val('regLastName').trim();
  const email = val('regEmail').trim();
  const password = val('regPassword');
  const passwordConfirm = val('regPasswordConfirm');

  const errEl = qs('#regError');
  const succEl = qs('#regSuccess');
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  if (succEl) { succEl.textContent = ''; succEl.classList.remove('show'); }

  if (!username) {
    showRegError('Username is required.');
    return;
  }
  if (!password || password.length < 6) {
    showRegError('Password must be at least 6 characters long.');
    return;
  }
  if (password !== passwordConfirm) {
    showRegError('Passwords do not match. Please verify.');
    return;
  }

  const btn = qs('#registerBtn');
  btn.textContent = 'Creating Account…';
  btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        password,
        first_name: firstName,
        last_name: lastName
      })
    });

    if (res.status === 201) {
      if (succEl) {
        succEl.textContent = '✓ Account created! Signing in automatically…';
        succEl.classList.add('show');
      }

      // Auto login
      const loginRes = await fetch(`${API}/auth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (loginRes.ok) {
        const d = await loginRes.json();
        saveToken(d.access, username, d.refresh);
        setTimeout(() => {
          hideLogin();
          initApp();
          toast(`Welcome to FocusGuard AI, ${firstName || username}!`, 'success');
        }, 800);
      } else {
        showAuthTab('login');
        showAuthError('Account created! Please enter your credentials to sign in.');
      }
    } else {
      const err = await res.json();
      const msg = err.username ? `Username: ${err.username[0]}` :
                  err.email ? `Email: ${err.email[0]}` :
                  err.password ? `Password: ${err.password[0]}` :
                  'Registration failed. Please check your details.';
      showRegError(msg);
    }
  } catch (e) {
    showRegError('Cannot connect to server. Please try again.');
  } finally {
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>Create Free Account`;
    btn.disabled = false;
  }
}

function showRegError(msg) {
  const el = qs('#regError');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}

function signOut() {
  clearToken();
  stopPoll();
  showLogin();
  toast('Signed out');
}

qs('#logoutBtn')?.addEventListener('click', () => signOut());

/* ═══════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════ */
const TAB_TITLES = {
  dashboard: 'Dashboard',
  switches:  'Context Switches',
  telemetry: 'Activity & Apps',
  system:    'Desktop Apps',
  analytics: 'Analytics',
  focus:     'Focus Session',
  blocker:   'Focus Shield',
  break:     'Break',
  goals:     'Goals',
  achievements: 'Badges & Streaks',
  reports:   'Reports',
  profile:   'Profile',
};

qsa('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function openMobileMenu() {
  qs('.sidebar')?.classList.add('open');
  qs('#sidebarBackdrop')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  qs('.sidebar')?.classList.remove('open');
  qs('#sidebarBackdrop')?.classList.remove('show');
  document.body.style.overflow = '';
}

qs('#menuToggleBtn')?.addEventListener('click', openMobileMenu);
qs('#sidebarCloseBtn')?.addEventListener('click', closeMobileMenu);
qs('#sidebarBackdrop')?.addEventListener('click', closeMobileMenu);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeMobileMenu();
    closeAIReportModal();
  }
});

function switchTab(tab) {
  if (tab === 'browsing' || tab === 'websites') tab = 'telemetry';
  state.activeTab = tab;
  closeMobileMenu();

  qsa('.nav-item').forEach(el => el.classList.remove('active'));
  qsa('.tab-pane').forEach(el => el.classList.remove('active'));

  const navEl = qs(`.nav-item[data-tab="${tab}"]`);
  const paneEl = qs(`#tab-${tab}`);
  if (navEl) navEl.classList.add('active');
  if (paneEl) paneEl.classList.add('active');

  const titles = (window.FG_I18N && window.FG_I18N.getTabTitles) ? window.FG_I18N.getTabTitles() : TAB_TITLES;
  setEl('pageTitle', titles[tab] || TAB_TITLES[tab] || tab);

  // Load data for specific tabs
  if (tab === 'dashboard') fetchDashboard();
  if (tab === 'switches') fetchSwitches();
  if (tab === 'telemetry') {
    fetchTelemetry();
    fetchSystemData();
  }
  if (tab === 'blocker') {
    loadBlocklist();
    setTimeout(() => animateShieldEntrance(), 30);
  }
  if (tab === 'break') refreshBreakUI();
  if (tab === 'analytics') {
    fetchDashboard();
    loadTrends(currentTrendsDays || 7);
  }
  if (tab === 'goals') fetchGoals();
  if (tab === 'achievements') fetchGamificationData();
  if (tab === 'reports') {
    setEl('reportUserName', state.username || 'User');
    setEl('reportUserMeta', `@${state.username || 'user'}`);
    const dateInput = qs('#reportDateInput');
    const today = new Date().toISOString().slice(0, 10);
    if (dateInput && !dateInput.value) dateInput.value = today;
    loadDateReport(dateInput?.value || today);
  }
  if (tab === 'profile') {
    fetchProfile();
    fetchGamificationData().then(() => renderProfileRecordAndBadges());
  }

  // Presentation-only: refresh scroll reveals / magnetic CTAs after tab change
  if (typeof window.fgRefreshUIInteractions === 'function') {
    requestAnimationFrame(() => window.fgRefreshUIInteractions());
  }
}

/* ═══════════════════════════════════════════════════════
   EXTENSION CONNECTION STATUS
   ═══════════════════════════════════════════════════════ */
function resolveExtensionConnected(apiConnected) {
  const attr = document.documentElement.getAttribute('data-focusguard-extension');
  // Content-script attribute is the only live source of truth.
  // Never trust API heartbeat alone — it can stay warm after the popup goes Offline.
  if (attr === 'connected') return true;
  if (attr === 'disconnected') return false;
  return false;
}

let _extServerClearAt = 0;
async function clearStaleExtensionHeartbeat() {
  const now = Date.now();
  if (now - _extServerClearAt < 8000) return;
  _extServerClearAt = now;
  try {
    if (!state.token) return;
    await apiFetch('/auth/extension/status/clear/', { method: 'POST' });
  } catch (e) {}
}

function updateExtensionStatusUI(connected, dashData) {
  const d = dashData || state.lastDashboardData || {};
  const card = qs('#extStatusCard');
  const extValEl = qs('#extVal');
  const pill = qs('#extStatusPill');

  if (extValEl) {
    const txt = connected ? 'Connected' : 'Disconnected';
    if (extValEl.textContent !== txt) extValEl.textContent = txt;
    extValEl.style.color = connected ? 'var(--color-success)' : 'var(--color-danger)';
  }

  if (pill) {
    pill.textContent = connected ? 'LIVE' : 'OFF';
    pill.className = `ext-status-pill ${connected ? 'on' : 'off'}`;
  }

  if (card) {
    card.classList.toggle('ext-connected', connected);
    card.classList.toggle('ext-disconnected', !connected);
  }

  let extMetaText = 'Extension offline · Connect from the popup';
  if (connected) {
    extMetaText = d.is_session_active
      ? 'Live · Tracking browser tabs'
      : 'Synced · Ready to track browsing';
  }
  setEl('extMeta', extMetaText);

  // Wipe stale server heartbeat whenever the live popup/content-script says offline
  if (!connected) clearStaleExtensionHeartbeat();
}

async function fetchDashboard() {
  try {
    const res = await apiFetch('/dashboard/summary/');
    if (!res.ok) return;
    const d = await res.json();
    renderDashboard(d);
    updateLastUpdated();
    fetchGamificationData();
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Dashboard error:', err);
  }
}

async function fetchLiveVisionStatus() {
  try {
    const res = await apiFetch('/system/attention/live/');
    if (!res.ok) return;
    const d = await res.json();
    updateLiveVisionUI(d);
  } catch (e) {
    // silent catch
  }
}

function updateLiveVisionUI(d) {
  if (!d) return;

  const badge = qs('#visionStateBadge');
  const icon = qs('#visionStatusIcon');
  const title = qs('#visionStatusTitle');
  const meta = qs('#visionStatusMeta');
  const scoreEl = qs('#visionScoreVal');
  const countEl = qs('#visionPhoneCount');
  const awayEl = qs('#visionAwayTime');

  if (!badge || !title) return;

  if (!d.is_active) {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'STANDBY';
    title.textContent = 'Smart Vision on Standby';
    title.style.color = 'var(--text-900)';
    meta.textContent = 'Camera tracking activates automatically when you start a focus session.';
    if (icon) {
      icon.style.background = 'var(--text-400)';
      icon.style.boxShadow = 'none';
    }
    if (countEl) countEl.textContent = '0 times';
    if (awayEl) awayEl.textContent = '0s';
    if (scoreEl) scoreEl.textContent = '—';
    return;
  }

  if (countEl) countEl.textContent = `${d.phone_distraction_count || 0} times`;
  if (awayEl) {
    const awayMins = Math.round((d.away_secs || 0) / 60);
    awayEl.textContent = awayMins > 0 ? `${awayMins}m` : `${d.away_secs || 0}s`;
  }
  if (scoreEl) {
    if (d.attention_score !== null && d.attention_score !== undefined) {
      scoreEl.textContent = `${Math.round(d.attention_score)}%`;
    } else {
      scoreEl.textContent = '—';
    }
  }

  const state = d.state || 'FOCUSED';
  if (state === 'LOOKING_AT_PHONE') {
    badge.className = 'badge badge-warning';
    badge.textContent = 'PHONE DISTRACTION';
    title.textContent = 'Distracted: Looking Down at Phone';
    title.style.color = 'var(--color-warning, #f59e0b)';
    meta.textContent = 'Head pitched down scrolling phone/lap. Switch back to your work!';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.35)';
    }
  } else if (state === 'LOOKING_AWAY') {
    badge.className = 'badge badge-danger';
    badge.textContent = 'LOOKING AWAY';
    title.textContent = 'Attention Drift: Looking Away';
    title.style.color = 'var(--color-danger, #ef4444)';
    meta.textContent = 'Head turned sideways away from computer screen.';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.35)';
    }
  } else if (state === 'USER_ABSENT') {
    badge.className = 'badge badge-neutral';
    badge.textContent = 'AWAY';
    title.textContent = 'User Away from Desk';
    title.style.color = 'var(--text-700)';
    meta.textContent = 'No face detected in webcam view.';
    if (icon) {
      icon.style.background = 'var(--text-400)';
      icon.style.boxShadow = 'none';
    }
  } else {
    badge.className = 'badge badge-success';
    badge.textContent = 'FOCUSED';
    title.textContent = 'User Focused on Screen';
    title.style.color = 'var(--text-900)';
    meta.textContent = 'Head and gaze oriented toward display. Great focus!';
    if (icon) {
      icon.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      icon.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.25)';
    }
  }
}


function formatDuration(totalSecs) {
  const s = Math.max(0, Math.round(totalSecs || 0));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const remSecs = s % 60;
  if (mins < 60) {
    return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function updateRingsVisualizer(prodSecs = 0, pScore = null) {
  try {
    const targetSecs = 5.5 * 3600;
    const effectiveScore = pScore !== null && pScore !== undefined ? Math.max(0, Math.min(100, pScore)) : 88;
    const focusRatio = Math.min(1.0, (prodSecs || 0) / targetSecs);

    const outerRatio = prodSecs > 0 ? Math.max(0.06, focusRatio) : 0.06;
    const middleRatio = Math.max(0.06, effectiveScore / 100);
    const innerRatio = 0.83;

    const deepFocusDash = Math.round(440 * (1 - outerRatio));
    const velocityDash = Math.round(327 * (1 - middleRatio));
    const recoveryDash = Math.round(213 * (1 - innerRatio));

    const ring1 = document.getElementById('ringDeepFocus');
    const ring2 = document.getElementById('ringVelocity');
    const ring3 = document.getElementById('ringRecovery');
    const centerPct = document.getElementById('ringCenterPct');
    const deepLabel = document.getElementById('ringDeepFocusLabel');
    const velLabel = document.getElementById('ringVelocityLabel');
    const recLabel = document.getElementById('ringRecoveryLabel');

    if (ring1) ring1.style.strokeDashoffset = deepFocusDash;
    if (ring2) ring2.style.strokeDashoffset = velocityDash;
    if (ring3) ring3.style.strokeDashoffset = recoveryDash;
    // Presentation-only: count-up when GSAP available; value unchanged
    if (centerPct) {
      const next = `${effectiveScore}%`;
      if (typeof gsap !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const prev = parseInt(centerPct.textContent, 10);
        const from = Number.isFinite(prev) ? prev : 0;
        if (Math.abs(from - effectiveScore) >= 1) {
          if (centerPct._fgCountTween) centerPct._fgCountTween.kill();
          const obj = { v: from };
          centerPct._fgCountTween = gsap.to(obj, {
            v: effectiveScore,
            duration: 0.85,
            ease: 'power2.out',
            onUpdate: () => { centerPct.textContent = `${Math.round(obj.v)}%`; },
            onComplete: () => { centerPct.textContent = next; }
          });
        } else {
          centerPct.textContent = next;
        }
      } else {
        centerPct.textContent = next;
      }
    }
    if (deepLabel) deepLabel.textContent = `${formatDuration(prodSecs || 0)} / 5h 30m`;
    if (velLabel) velLabel.textContent = `${effectiveScore} / 100 Score`;
    if (recLabel) recLabel.textContent = `${Math.min(6, Math.max(1, Math.round((prodSecs || 0) / 1800)))} / 6 Stand Resets`;
  } catch(e) {
    console.error('Ring visualizer error:', e);
  }
}

function renderDashboard(d) {
  const isActive = !!(d.is_session_active && d.active_focus_session);

  if (isActive) {
    state.liveSession = d.active_focus_session;
    state.liveActiveApp = d.active_app;
    state.liveProdSecs = Math.max(state.liveProdSecs || 0, d.productive_secs ?? d.active_focus_session.productive_secs ?? 0);
    state.liveDistSecs = Math.max(state.liveDistSecs || 0, d.distracted_secs ?? d.active_focus_session.distracted_secs ?? 0);
    state.liveSwitches = d.total_switches ?? d.active_focus_session.switches ?? 0;

    // Use switch-penalized score from server (already accounts for NEUTRAL app time)
    const pScore = d.productivity_score !== null && d.productivity_score !== undefined
      ? Math.round(d.productivity_score)
      : (state.liveDistSecs === 0 ? 100 : Math.round((state.liveProdSecs / Math.max(1, state.liveProdSecs + state.liveDistSecs)) * 100));
    const rawPct = d.raw_productive_pct !== null && d.raw_productive_pct !== undefined
      ? Math.round(d.raw_productive_pct) : pScore;
    const sw = state.liveSwitches || 0;
    const swPenalty = Math.min(30, Math.round(sw * 1.5));

    setEl('prodVal', formatDuration(state.liveProdSecs));
    setEl('prodMeta', `Active Session · ${rawPct}% productive ratio`);

    setEl('distVal', state.liveDistSecs > 0 ? formatDuration(state.liveDistSecs) : '0s');
    setEl('distMeta', state.liveDistSecs > 0 ? `${formatDuration(state.liveDistSecs)} off-task` : 'No distracting apps detected');

    setEl('switchVal', sw);
    setEl('switchMeta', sw === 0 ? 'Zero switches · Deep focus' : `${sw} context switch${sw !== 1 ? 'es' : ''} in session`);

    setEl('scoreVal', `${pScore}%`);
    const scoreLabel = pScore >= 70 ? 'High Focus' : pScore >= 40 ? 'Moderate' : 'Needs Focus';
    setEl('scoreMeta', sw > 0 ? `${rawPct}% productive · −${swPenalty}pts (${sw} switches) · ${scoreLabel}` : `${rawPct}% productive · ${scoreLabel}`);

    updateRingsVisualizer(state.liveProdSecs, pScore);

  } else {
    state.liveSession = null;
    const prodS = d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600);
    const distS = d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600);
    const totS = prodS + distS;
    const sw = d.total_switches ?? 0;
    // productivity_score is already switch-penalized from backend
    const hasData = d.total_secs > 0 && d.productivity_score !== null && d.productivity_score !== undefined;
    const pScore = hasData ? Math.round(d.productivity_score) : null;
    const rawPct = hasData && d.raw_productive_pct !== null && d.raw_productive_pct !== undefined
      ? Math.round(d.raw_productive_pct) : pScore;
    const swPenalty = hasData ? Math.min(30, Math.round(sw * 1.5)) : 0;

    setEl('prodVal', prodS > 0 ? formatDuration(prodS) : '—');
    setEl('prodMeta', prodS > 0 && rawPct !== null ? `${rawPct}% productive ratio today` : 'Ready to track');

    // Show 0s when there IS productive time but no distracting apps — not —
    setEl('distVal', distS > 0 ? formatDuration(distS) : (prodS > 0 ? '0s' : '—'));
    setEl('distMeta', distS > 0 ? `${formatDuration(distS)} total distracted time` : (prodS > 0 ? 'No distracting apps detected' : 'Total distraction time'));

    setEl('switchVal', sw > 0 ? sw : '—');
    setEl('switchMeta', sw === 0 ? 'No switches recorded yet' : `${sw} context change${sw !== 1 ? 's' : ''} today`);

    if (pScore !== null) {
      setEl('scoreVal', `${pScore}%`);
      const scoreLabel = pScore >= 70 ? 'High Focus' : pScore >= 40 ? 'Moderate' : 'Needs Focus';
      if (sw > 0 && swPenalty > 0) {
        setEl('scoreMeta', `${rawPct}% productive · −${swPenalty}pts (${sw} switches) · ${scoreLabel}`);
      } else {
        setEl('scoreMeta', `${rawPct}% productive · ${scoreLabel}`);
      }
    } else {
      setEl('scoreVal', '—');
      setEl('scoreMeta', 'Focus & productivity rating');
    }

    updateRingsVisualizer(prodS, pScore !== null ? pScore : 88);
  }

  // Badge on sidebar
  const totalSw = d.total_switches ?? 0;
  if (totalSw !== state.lastSwitchCount) {
    state.lastSwitchCount = totalSw;
    const badge = qs('#switchBadge');
    if (totalSw > 0) { badge.textContent = totalSw > 99 ? '99+' : totalSw; badge.classList.add('show'); }
    else badge.classList.remove('show');
  }

  state.lastDashboardData = d;

  // Sync break tool if server says we're on break
  if (d.on_break && d.break && d.break.ends_at) {
    const endsAt = Math.round(Number(d.break.ends_at) * 1000);
    if (endsAt > Date.now() && !isBreakActive()) {
      breakEndsAtMs = endsAt;
      breakTotalSecs = d.break.remaining_secs || Math.ceil((endsAt - Date.now()) / 1000);
      localStorage.setItem('focusguard_break_ends_at', String(endsAt));
      localStorage.setItem('focusguard_break_total_secs', String(
        (d.break.duration_mins || 5) * 60
      ));
      syncBreakLocalFlags(true);
      refreshBreakUI();
    }
  }

  // Live Focus Session Banner Controller
  if (d.on_break) {
    updateDashSessionUI(null);
    const badge = qs('#dashSessionBadge');
    const title = qs('#dashSessionTitle');
    const meta = qs('#dashSessionMeta');
    if (badge) {
      badge.textContent = 'ON BREAK';
      badge.className = 'badge badge-productive';
    }
    if (title) title.textContent = 'Break in progress';
    if (meta) meta.textContent = 'Focus Session & Focus Shield are paused until the break ends.';
    const startBtn = qs('#dashStartSessionBtn');
    const endBtn = qs('#dashEndSessionBtn');
    if (startBtn) startBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'none';
  } else {
    updateDashSessionUI(d.active_focus_session);
  }

  // Today's Isolated Focus Sessions List
  renderTodayFocusSessions(d.today_sessions || []);

  // Extension status — prefer live content-script attribute over stale API cache
  updateExtensionStatusUI(resolveExtensionConnected(d.extension_connected), d);

  // Charts are rendered in the dedicated Analytics tab.
  renderCategoryChart(d.category_breakdown || {});
  renderDonut(d.productive_pct || 0, d.distracting_pct || 0);

  // Top sites (browsing)
  const siteItems = (d.top_sites || []).map(s => ({
    type: 'browsing',
    title: s.page_title || s.domain,
    domain: s.domain,
    detail: s.domain,
    category: s.category,
    productivity_label: s.productivity_label,
    total_secs: s.total_secs || s.time_spent_secs || 0
  }));
  renderSitesTable('topSitesBody', siteItems);
  const count = siteItems.length;
  const siteCountEl = qs('#siteCount');
  if (siteCountEl) {
    if (count > 0) {
      const sTxt = `${count} sites`;
      if (siteCountEl.textContent !== sTxt) siteCountEl.textContent = sTxt;
      if (siteCountEl.style.display !== 'inline-flex') siteCountEl.style.display = 'inline-flex';
    } else if (siteCountEl.style.display !== 'none') {
      siteCountEl.style.display = 'none';
    }
  }

  // Top desktop apps
  const appTbody = qs('#dashTopAppsBody');
  if (appTbody) {
    const apps = d.top_apps || [];
    const jsonApps = JSON.stringify(apps);
    if (appTbody.dataset.lastJson !== jsonApps) {
      appTbody.dataset.lastJson = jsonApps;
      const appCountEl = qs('#appCount');
      if (apps.length > 0) {
        if (appCountEl) { appCountEl.textContent = `${apps.length} apps`; appCountEl.style.display = 'inline-flex'; }
        appTbody.innerHTML = apps.map(app => {
          const label = app.productivity_label || 'NEUTRAL';
          const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
          const durStr = formatDuration(app.total_secs || 0);
          return `
            <tr>
              <td class="td-primary">${htmlEsc(app.app_name || app.process_name)}</td>
              <td><span class="category-tag">${app.category || '—'}</span></td>
              <td><span class="badge ${bc}">${label}</span></td>
              <td style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-700);">${durStr}</td>
            </tr>
          `;
        }).join('');
      } else {
        if (appCountEl) appCountEl.style.display = 'none';
        appTbody.innerHTML = emptyRow(4, '🖥️', 'No desktop apps tracked yet today', 'Start a focus session to track your active applications.');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   CONTEXT SWITCHES
   ═══════════════════════════════════════════════════════ */
async function fetchSwitches() {
  try {
    const [resB, resS] = await Promise.all([
      apiFetch('/browsing/switches/today/').catch(() => null),
      apiFetch('/system/today/').catch(() => null)
    ]);
    const bData = (resB && resB.ok) ? await resB.json() : {};
    const sData = (resS && resS.ok) ? await resS.json() : {};
    renderSwitches(bData, sData);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Switches error:', err);
  }
}

function renderSwitches(bData = {}, sData = {}) {
  // bData from /browsing/switches/today/ already combines browser + system switches
  const total = bData.total_switches !== undefined ? bData.total_switches : ((bData.browser_switches || 0) + (sData.total_switches || 0));
  setEl('swTotalVal', total);

  // Fragmentation
  let label = 'None', pct = 0, color = 'var(--color-success)';
  if (total >= 80) { label = 'Very High'; pct = 100; color = 'var(--color-rose)'; }
  else if (total >= 50) { label = 'High'; pct = 75; color = 'var(--color-danger)'; }
  else if (total >= 25) { label = 'Moderate'; pct = 45; color = 'var(--color-warning)'; }
  else if (total >= 10) { label = 'Low'; pct = 20; color = 'var(--color-success)'; }
  else if (total > 0) { label = 'Minimal'; pct = 8; color = 'var(--color-teal)'; }

  const fragEl = qs('#swFragVal');
  if (fragEl) {
    fragEl.textContent = label;
    fragEl.style.color = color;
  }
  const fragBar = qs('#swFragBar');
  if (fragBar) {
    fragBar.style.width = pct + '%';
    fragBar.style.background = color;
  }

  // Combine top transitions cleanly
  let combinedTransitions = [];
  if (bData.top_transitions && bData.top_transitions.length > 0) {
    combinedTransitions = bData.top_transitions.map(t => ({
      from: t.from_domain || 'Web Page',
      to: t.to_domain || 'Web Page',
      from_cat: t.from_category || '—',
      to_cat: t.to_category || '—',
      count: t.count || 1,
      type: t.source === 'system' ? 'app' : 'web'
    }));
  } else if (sData.top_transitions) {
    combinedTransitions = sData.top_transitions.map(t => ({
      from: t.from_app || 'App',
      to: t.to_app || 'App',
      from_cat: t.from_category || '—',
      to_cat: t.to_category || '—',
      count: t.count || 1,
      type: 'app'
    }));
  }
  combinedTransitions.sort((a, b) => b.count - a.count);

  const top = combinedTransitions[0];
  if (top) {
    setEl('swTopVal', `${top.from} → ${top.to}`);
    setEl('swTopCount', `Repeated ${top.count} times (${top.type === 'app' ? 'Desktop App' : 'Web Tab'})`);
  } else {
    setEl('swTopVal', 'No data yet');
    setEl('swTopCount', 'Switch apps or tabs to start tracking');
  }

  // Transitions table
  const tbody = qs('#transitionsBody');
  if (tbody) {
    const tJson = JSON.stringify(combinedTransitions);
    if (tbody.dataset.lastJson !== tJson) {
      tbody.dataset.lastJson = tJson;
      if (combinedTransitions.length > 0) {
        tbody.innerHTML = combinedTransitions.slice(0, 10).map(t => `
          <tr>
            <td>
              <span class="domain-chip">
                ${t.type === 'web' ? faviconImg(t.from) : '🖥️ '}${htmlEsc(t.from)}
              </span>
            </td>
            <td style="text-align:center;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </td>
            <td>
              <span class="domain-chip">
                ${t.type === 'web' ? faviconImg(t.to) : '🖥️ '}${htmlEsc(t.to)}
              </span>
            </td>
            <td>
              <span class="category-tag">${htmlEsc(t.from_cat)}</span>
              <span style="margin: 0 3px; color: var(--text-300);">→</span>
              <span class="category-tag">${htmlEsc(t.to_cat)}</span>
            </td>
            <td><strong style="color:var(--text-900);">${t.count}</strong></td>
          </tr>
        `).join('');
      } else {
        tbody.innerHTML = emptyRow(5, '🔄', 'No switch data yet', 'Switch between apps and browser tabs to populate transition logs.');
      }
    }
  }

  // Combine recent switches cleanly
  let combinedRecent = [];
  if (bData.recent_switches && bData.recent_switches.length > 0) {
    combinedRecent = bData.recent_switches.map(s => ({
      from: s.from_domain || 'Web Page',
      to: s.to_domain || 'Web Page',
      time: s.switched_at,
      type: s.source === 'system' ? 'app' : 'web'
    }));
  } else if (sData.recent_switches) {
    combinedRecent = sData.recent_switches.map(s => ({
      from: s.from_app || 'App',
      to: s.to_app || 'App',
      time: s.switched_at,
      type: 'app'
    }));
  }
  combinedRecent.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

  const timeline = qs('#switchTimeline');
  if (timeline) {
    const sJson = JSON.stringify(combinedRecent);
    if (timeline.dataset.lastJson !== sJson) {
      timeline.dataset.lastJson = sJson;
      if (combinedRecent.length > 0) {
        timeline.innerHTML = combinedRecent.slice(0, 25).map((s, i) => {
          const t = s.time ? new Date(s.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          const isLast = i === combinedRecent.length - 1;
          const isApp = s.type === 'app';
          return `
            <div class="timeline-item">
              <div class="timeline-dot-col">
                <div class="timeline-dot" style="${isApp ? 'background:var(--brand-500);' : ''}"></div>
                ${!isLast ? '<div class="timeline-line"></div>' : ''}
              </div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <div class="timeline-main">
                    <span class="domain-chip" style="max-width:140px;" title="${htmlEsc(s.from)}">
                      ${isApp ? '🖥️ ' : faviconImg(s.from)}${htmlEsc(s.from)}
                    </span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <span class="domain-chip" style="max-width:140px;" title="${htmlEsc(s.to)}">
                      ${isApp ? '🖥️ ' : faviconImg(s.to)}${htmlEsc(s.to)}
                    </span>
                  </div>
                  <span class="timeline-time">${t}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        timeline.innerHTML = `
          <div class="empty">
            <div class="empty-icon">🕒</div>
            <div class="empty-title">No recent switches</div>
            <div class="empty-desc">Live events will appear here as you switch between desktop applications and browser tabs.</div>
          </div>`;
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   TELEMETRY
   ═══════════════════════════════════════════════════════ */
async function fetchTelemetry() {
  let combinedItems = [];
  try {
    const [resBrowsingToday, resSummary, resSystem] = await Promise.all([
      apiFetch('/browsing/today/').catch(() => null),
      apiFetch('/dashboard/summary/').catch(() => null),
      apiFetch('/system/today/').catch(() => null)
    ]);

    let summaryData = null;
    if (resSummary && resSummary.ok) {
      try { summaryData = await resSummary.json(); } catch (_) { summaryData = null; }
    }

    let systemData = null;
    if (resSystem && resSystem.ok) {
      try { systemData = await resSystem.json(); } catch (_) { systemData = null; }
    }

    let webItems = [];
    if (resBrowsingToday && resBrowsingToday.ok) {
      const d = await resBrowsingToday.json();
      webItems = (d.top_sites || []).map(s => ({
        type: 'browsing',
        title: s.domain,
        domain: s.domain,
        detail: s.domain,
        category: s.category,
        productivity_label: s.productivity_label,
        total_secs: s.total_secs || 0
      }));
    }
    if (webItems.length === 0 && summaryData) {
      webItems = (summaryData.top_sites || []).map(s => ({
        type: 'browsing',
        title: s.page_title || s.domain,
        domain: s.domain,
        detail: s.domain,
        category: s.category,
        productivity_label: s.productivity_label,
        total_secs: s.total_secs || s.time_spent_secs || 0
      }));
    }

    let desktopItems = (systemData?.top_apps || []).map(app => ({
      type: 'desktop',
      title: app.app_name || app.process_name,
      process_name: app.process_name,
      detail: app.process_name || app.app_name,
      category: app.category,
      productivity_label: app.productivity_label,
      total_secs: app.total_secs || 0
    }));
    if (desktopItems.length === 0 && summaryData) {
      desktopItems = (summaryData.top_apps || []).map(app => ({
        type: 'desktop',
        title: app.app_name || app.process_name,
        process_name: app.process_name,
        detail: app.process_name || app.app_name,
        category: app.category,
        productivity_label: app.productivity_label,
        total_secs: app.total_secs || 0
      }));
    }

    combinedItems = [...webItems, ...desktopItems]
      .filter(item => item && (item.title || item.domain || item.process_name));
    combinedItems.sort((a, b) => (b.total_secs || 0) - (a.total_secs || 0));

  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Telemetry error:', err);
  }

  currentActivityItems = Array.isArray(combinedItems) ? combinedItems : [];
  filterAndRenderActivityTable();
}

function filterAndRenderActivityTable() {
  const filter = state.activityFilter || 'all';
  let filtered = currentActivityItems;
  if (filter === 'browsing') {
    filtered = currentActivityItems.filter(x => x.type === 'browsing');
  } else if (filter === 'desktop') {
    filtered = currentActivityItems.filter(x => x.type === 'desktop');
  }
  renderSitesTable('telemetryBody', filtered);
}

/* ═══════════════════════════════════════════════════════
   SYSTEM APP MONITOR
   ═══════════════════════════════════════════════════════ */
async function fetchSystemData() {
  try {
    const res = await apiFetch('/system/today/');
    if (!res.ok) return;
    const d = await res.json();
    renderSystemData(d);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('System monitor error:', err);
  }
}

function renderSystemData(d) {
  // Active app card
  const active = d.active_app;
  const activeNameEl = qs('#activeAppName');
  const activeTitleEl = qs('#activeAppTitle');
  const activeCatEl = qs('#activeAppCategory');
  const activeTierEl = qs('#activeAppTier');

  if (active && active.app_name) {
    if (activeNameEl && activeNameEl.textContent !== active.app_name) activeNameEl.textContent = active.app_name;
    const tit = active.window_title || active.process_name || '';
    if (activeTitleEl && activeTitleEl.textContent !== tit) activeTitleEl.textContent = tit;
    const cat = active.category || '';
    if (activeCatEl && activeCatEl.textContent !== cat) activeCatEl.textContent = cat;
    if (activeTierEl) {
      const tier = active.productivity_label || 'NEUTRAL';
      const bc = tier === 'PRODUCTIVE' ? 'badge-productive' : tier === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
      const tierHtml = `<span class="badge ${bc}">${tier}</span>`;
      if (activeTierEl.innerHTML !== tierHtml) activeTierEl.innerHTML = tierHtml;
    }
  } else {
    if (activeNameEl && activeNameEl.textContent !== 'No App Active') activeNameEl.textContent = 'No App Active';
    const sub = 'Check that the Desktop Agent uses the same account as this dashboard';
    if (activeTitleEl && activeTitleEl.textContent !== sub) activeTitleEl.textContent = sub;
    if (activeCatEl && activeCatEl.textContent !== '') activeCatEl.textContent = '';
    const offHtml = '<span class="badge badge-neutral">STANDBY</span>';
    if (activeTierEl && activeTierEl.innerHTML !== offHtml) activeTierEl.innerHTML = offHtml;
  }

  // Stat cards
  const prodSecs = d.productive_secs || 0;
  setEl('sysProdVal', prodSecs > 0 ? formatDuration(prodSecs) : '0s');
  setEl('sysProdMeta', `${d.productive_pct || 0}% of desktop time`);

  const sw = d.total_switches ?? 0;
  setEl('sysSwitchVal', sw);

  const totalSecs = d.total_secs || 0;
  setEl('sysTimeVal', totalSecs > 0 ? formatDuration(totalSecs) : '0s');

  // Top apps table
  const tbody = qs('#sysAppsBody');
  const apps = d.top_apps || [];
  if (tbody) {
    const aJson = JSON.stringify(apps);
    if (tbody.dataset.lastJson !== aJson) {
      tbody.dataset.lastJson = aJson;
      if (apps.length === 0) {
        tbody.innerHTML = emptyRow(4, '🖥️', 'No desktop app activity recorded today', 'Start a focus session to track your active applications.');
      } else {
        tbody.innerHTML = apps.map(app => {
          const label = app.productivity_label || 'NEUTRAL';
          const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
          const durStr = formatDuration(app.total_secs || 0);
          return `
            <tr>
              <td class="td-primary">${htmlEsc(app.app_name || app.process_name)}</td>
              <td><span class="category-tag">${app.category || '—'}</span></td>
              <td><span class="badge ${bc}">${label}</span></td>
              <td style="font-variant-numeric:tabular-nums;font-weight:600;color:var(--text-700);">${durStr}</td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  // Keep Activity & App History in sync with desktop apps even if fetchTelemetry raced
  const desktopItems = apps.map(app => ({
    type: 'desktop',
    title: app.app_name || app.process_name,
    process_name: app.process_name,
    detail: app.process_name || app.app_name,
    category: app.category,
    productivity_label: app.productivity_label,
    total_secs: app.total_secs || 0
  }));
  const browsingOnly = (currentActivityItems || []).filter(x => x.type === 'browsing');
  if (desktopItems.length > 0 || browsingOnly.length > 0) {
    currentActivityItems = [...browsingOnly, ...desktopItems];
    currentActivityItems.sort((a, b) => (b.total_secs || 0) - (a.total_secs || 0));
    filterAndRenderActivityTable();
  }

  // App Switch Timeline
  const timeline = qs('#sysTimeline');
  if (timeline) {
    const switches = d.recent_switches || [];
    const swJson = JSON.stringify(switches);
    if (timeline.dataset.lastJson !== swJson) {
      timeline.dataset.lastJson = swJson;
      if (switches.length === 0) {
        timeline.innerHTML = `
          <div class="empty">
            <div class="empty-icon">⏳</div>
            <div class="empty-title">No switches recorded yet</div>
            <div class="empty-desc">Switch between applications and events appear here in real-time.</div>
          </div>`;
      } else {
        timeline.innerHTML = switches.map((s, i) => {
          const t = s.switched_at ? new Date(s.switched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          const isLast = i === switches.length - 1;
          return `
            <div class="timeline-item">
              <div class="timeline-dot-col">
                <div class="timeline-dot"></div>
                ${!isLast ? '<div class="timeline-line"></div>' : ''}
              </div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <div class="timeline-main">
                    <span class="domain-chip" style="font-weight:600;">${htmlEsc(s.from_app || 'App')}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-300)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    <span class="domain-chip" style="font-weight:600;">${htmlEsc(s.to_app || 'App')}</span>
                  </div>
                  <span class="timeline-time">${t}</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════
   SITES & APPS TABLE
   ═══════════════════════════════════════════════════════ */
function renderSitesTable(bodyId, items) {
  const tbody = qs(`#${bodyId}`);
  if (!tbody) return;

  const jsonStr = JSON.stringify(items || []);
  if (tbody.dataset.lastJson === jsonStr) return;
  tbody.dataset.lastJson = jsonStr;

  if (!items || !items.length) {
    tbody.innerHTML = emptyRow(6, '📊', 'No activity recorded yet today', 'Connect the Chrome Extension or run the Desktop Agent. Activity will appear here automatically.');
    return;
  }

  tbody.innerHTML = items.map(item => {
    const isDesktop = item.type === 'desktop';
    const label = item.productivity_label || 'NEUTRAL';
    const bc = label === 'PRODUCTIVE' ? 'badge-productive' : label === 'DISTRACTING' ? 'badge-distracting' : 'badge-neutral';
    const title = item.title || item.name || '—';
    const detail = item.detail || item.domain || item.process_name || '—';
    const durStr = formatDuration(item.total_secs || 0);

    const typeTag = isDesktop
      ? '<span class="badge badge-neutral" style="background:rgba(99, 102, 241, 0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3); font-weight:700;">🖥️ Desktop App</span>'
      : '<span class="badge badge-neutral" style="background:rgba(16, 185, 129, 0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); font-weight:700;">🌐 Browsing Website</span>';

    const iconOrFavicon = isDesktop
      ? '<span style="margin-right:6px;">🖥️</span>'
      : faviconImg(item.domain);

    return `
      <tr>
        <td>${typeTag}</td>
        <td class="td-primary" title="${htmlEsc(title)}">${iconOrFavicon}${htmlEsc(title)}</td>
        <td class="td-domain" title="${htmlEsc(detail)}">${htmlEsc(detail)}</td>
        <td><span class="category-tag">${htmlEsc(item.category || '—')}</span></td>
        <td><span class="badge ${bc}">${label}</span></td>
        <td style="font-variant-numeric:tabular-nums; font-weight:600; color:var(--text-700);">${durStr}</td>
      </tr>
    `;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   CHARTS
   ═══════════════════════════════════════════════════════ */
const CAT_COLORS = {
  PRODUCTIVE:   '#A6FF00', DEVELOPMENT:  '#00F0FF', EDUCATION:    '#5CE1FF',
  CREATIVE:     '#FA114F', COMMUNICATION:'#FF6B8A', FINANCE:      '#A6FF00',
  SYSTEM:       '#8E8E93', NEWS_READING: '#AEAEB2', ENTERTAINMENT:'#FA114F',
  SOCIAL_MEDIA: '#FF4D78', GAMING:       '#C40D3E', SHOPPING:     '#00F0FF'
};

const FITNESS_CHART = {
  coral: '#FA114F',
  lime: '#A6FF00',
  cyan: '#00F0FF',
  ink: '#0A0A0C',
  muted: '#8E8E93',
  grid: 'rgba(255,255,255,0.06)',
  tooltipBg: 'rgba(20, 20, 22, 0.96)',
  font: "'Plus Jakarta Sans', 'Hanken Grotesk', system-ui, sans-serif",
};

const CAT_EMOJIS = {
  PRODUCTIVE:'🎯',DEVELOPMENT:'💻',EDUCATION:'📚',CREATIVE:'🎨',COMMUNICATION:'💬',
  FINANCE:'💰',SYSTEM:'⚙️',NEWS_READING:'📰',ENTERTAINMENT:'🎬',SOCIAL_MEDIA:'📱',
  GAMING:'🎮',SHOPPING:'🛒'
};

function renderCategoryChart(breakdown) {
  const canvases = [qs('#categoryChart'), qs('#analyticsCategoryChart')].filter(Boolean);
  const emptyEl = qs('#categoryChartEmpty');
  const wrapEl = qs('#categoryChartWrap');
  const analyticsEmpty = qs('#analyticsCategoryChartEmpty');
  const analyticsWrap = qs('#analyticsCategoryChartWrap');
  if (!canvases.length) return;

  const entries = Object.entries(breakdown || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const animateCharts = state.activeTab === 'analytics';

  if (!entries.length) {
    if (emptyEl && emptyEl.style.display !== 'flex') emptyEl.style.display = 'flex';
    if (wrapEl && wrapEl.style.display !== 'none') wrapEl.style.display = 'none';
    if (analyticsEmpty) analyticsEmpty.style.display = 'flex';
    if (analyticsWrap) analyticsWrap.style.opacity = '0';
    return;
  }

  if (emptyEl && emptyEl.style.display !== 'none') emptyEl.style.display = 'none';
  if (wrapEl && wrapEl.style.display !== 'block') wrapEl.style.display = 'block';
  if (analyticsEmpty) analyticsEmpty.style.display = 'none';
  if (analyticsWrap) analyticsWrap.style.opacity = '1';

  const newLabels = entries.map(([k]) => `${CAT_EMOJIS[k] || ''} ${k}`);
  const newData = entries.map(([, v]) => v);
  const fitnessCycle = [FITNESS_CHART.coral, FITNESS_CHART.lime, FITNESS_CHART.cyan, '#FF6B8A', '#7DFF6B', '#5CE1FF'];
  const newBg = entries.map(([k], i) => (CAT_COLORS[k] || fitnessCycle[i % fitnessCycle.length]));
  const newHover = newBg.map((c) => c);

  canvases.forEach((ctx, idx) => {
    const chartKey = idx === 0 ? 'chartCategory' : 'chartCategoryAnalytics';
    const isAnalyticsCanvas = ctx.id === 'analyticsCategoryChart';
    if (state[chartKey]) {
      const curLabels = state[chartKey].data.labels || [];
      const curData = state[chartKey].data.datasets[0].data || [];
      if (JSON.stringify(curLabels) === JSON.stringify(newLabels) &&
          JSON.stringify(curData) === JSON.stringify(newData)) {
        return;
      }
      state[chartKey].data.labels = newLabels;
      state[chartKey].data.datasets[0].data = newData;
      state[chartKey].data.datasets[0].backgroundColor = newBg;
      state[chartKey].data.datasets[0].hoverBackgroundColor = newHover;
      state[chartKey].update(animateCharts && isAnalyticsCanvas ? undefined : 'none');
      return;
    }

    state[chartKey] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: newLabels,
        datasets: [{
          label: 'Minutes',
          data: newData,
          backgroundColor: newBg,
          hoverBackgroundColor: newHover,
          borderRadius: 999,
          borderSkipped: false,
          maxBarThickness: 28,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: isAnalyticsCanvas ? {
          duration: 1100,
          easing: 'easeOutQuart',
          delay: (c) => (c.dataIndex || 0) * 70,
        } : false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: FITNESS_CHART.tooltipBg,
            titleColor: '#F7F2F3',
            bodyColor: FITNESS_CHART.muted,
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 14,
            titleFont: { family: FITNESS_CHART.font, weight: '700' },
            bodyFont: { family: FITNESS_CHART.font },
            callbacks: { label: tip => ` ${tip.raw} min` }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: FITNESS_CHART.muted, font: { size: 10, family: FITNESS_CHART.font, weight: '600' } }
          },
          y: {
            grid: { color: FITNESS_CHART.grid, drawBorder: false },
            border: { display: false },
            ticks: { color: FITNESS_CHART.muted, font: { size: 11, family: FITNESS_CHART.font } }
          }
        }
      }
    });
  });
}

function renderDonut(prodPct, distPct) {
  const canvases = [qs('#donutChart'), qs('#analyticsDonutChart')].filter(Boolean);
  if (!canvases.length) return;

  const neutralPct = Math.max(0, Math.round(100 - prodPct - distPct));
  const newData = prodPct + distPct + neutralPct > 0
    ? [prodPct, distPct, neutralPct]
    : [1, 0, 0];
  const newBg = prodPct + distPct > 0
    ? [FITNESS_CHART.lime, FITNESS_CHART.coral, '#2A2A2E']
    : ['#2A2A2E', FITNESS_CHART.coral, '#2A2A2E'];

  const centerPct = qs('#analyticsDonutPct');
  if (centerPct) {
    const focused = Math.round(prodPct || 0);
    if (typeof gsap !== 'undefined') {
      const obj = { v: parseInt(centerPct.textContent, 10) || 0 };
      gsap.to(obj, {
        v: focused,
        duration: 1,
        ease: 'power2.out',
        onUpdate: () => { centerPct.textContent = `${Math.round(obj.v)}%`; }
      });
    } else {
      centerPct.textContent = `${focused}%`;
    }
  }

  canvases.forEach((ctx) => {
    const chartKey = ctx.id === 'analyticsDonutChart' ? 'chartDonutAnalytics' : 'chartDonut';
    const isAnalyticsCanvas = ctx.id === 'analyticsDonutChart';
    if (state[chartKey]) {
      const curData = state[chartKey].data.datasets[0].data || [];
      if (JSON.stringify(curData) === JSON.stringify(newData)) {
        return;
      }
      state[chartKey].data.datasets[0].data = newData;
      state[chartKey].data.datasets[0].backgroundColor = newBg;
      state[chartKey].update(isAnalyticsCanvas && state.activeTab === 'analytics' ? undefined : 'none');
      return;
    }

    state[chartKey] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Productive', 'Distracting', 'Neutral'],
        datasets: [{
          data: newData,
          backgroundColor: newBg,
          borderWidth: 0,
          hoverOffset: 6,
          spacing: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: isAnalyticsCanvas ? {
          animateRotate: true,
          animateScale: true,
          duration: 1200,
          easing: 'easeOutCubic',
        } : false,
        cutout: '78%',
        plugins: {
          legend: {
            display: !isAnalyticsCanvas,
            position: 'bottom',
            labels: {
              color: FITNESS_CHART.muted,
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 999,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { family: FITNESS_CHART.font, size: 12, weight: '600' },
              padding: 16,
            }
          },
          tooltip: {
            backgroundColor: FITNESS_CHART.tooltipBg,
            titleColor: '#F7F2F3',
            bodyColor: FITNESS_CHART.muted,
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            padding: 12,
            cornerRadius: 14,
            callbacks: { label: tip => ` ${tip.raw}%` }
          }
        }
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════
   FOCUS SESSIONS (OPEN-ENDED · NO ARBITRARY TIMERS)
   ═══════════════════════════════════════════════════════ */
async function startFocusSession() {
  if (isBreakActive()) {
    toast('Finish your break first — Focus Session is paused during breaks.', 'warning');
    switchTab('break');
    return;
  }
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> Starting...`;
  }
  try {
    const res = await apiFetch('/focus/start/', {
      method: 'POST',
      body: JSON.stringify({
        session_type: 'DEEP_WORK',
        planned_duration_mins: 0
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.activeSessionId = data.id;
      state.liveProdSecs = 0;
      state.liveDistSecs = 0;
      state.liveNeutSecs = 0;
      state.liveSwitches = 0;
      localStorage.setItem('focusguard_session_active', 'true');
      lastBreakReminderMinute = 0;
      playChime('start');
      setEl('prodVal', '0s');
      setEl('distVal', '0s');
      setEl('scoreVal', '—');
      setEl('switchVal', '0');

      // INSTANT ZERO-LATENCY TOGGLE: switch directly to Stop Session
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
        startBtn.style.display = 'none';
      }
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
        endBtn.style.display = 'inline-flex';
      }
      updateDashSessionUI(data);

      toast('🚀 Focus session started! Tracking attention & activity in real time.', 'success');
      fetchDashboard();
    } else {
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
      }
      toast('Failed to start focus session', 'danger');
    }
  } catch (e) {
    console.error('Error starting focus session:', e);
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
    }
    toast('Error starting focus session', 'danger');
  }
}

async function endFocusSession() {
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');
  if (endBtn) {
    endBtn.disabled = true;
    endBtn.innerHTML = `<span style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;"></span> Stopping...`;
  }
  try {
    const res = await apiFetch('/focus/end/', {
      method: 'POST',
      body: JSON.stringify({ status: 'COMPLETED' })
    });
    if (res.ok) {
      state.activeSessionId = null;
      state.liveSession = null;
      state.liveProdSecs = 0;
      state.liveDistSecs = 0;
      state.liveNeutSecs = 0;
      state.liveSwitches = 0;
      localStorage.setItem('focusguard_session_active', 'false');
      playChime('end');
      closeBreakReminderModal();

      // INSTANT ZERO-LATENCY TOGGLE: switch directly to Start Session
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
        endBtn.style.display = 'none';
      }
      if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Session`;
        startBtn.style.display = 'inline-flex';
      }
      updateDashSessionUI(null);

      toast('🎉 Focus session completed and logged!', 'success');
      fetchDashboard();
      fetchGamificationData();
    } else {
      if (endBtn) {
        endBtn.disabled = false;
        endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
      }
      toast('Failed to end focus session', 'danger');
    }
  } catch (e) {
    console.error('Error ending focus session:', e);
    if (endBtn) {
      endBtn.disabled = false;
      endBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg> Stop Session`;
    }
    toast('Error ending focus session', 'danger');
  }
}

// Event listeners for tab-focus buttons
qs('#startTimerBtn')?.addEventListener('click', startFocusSession);
qs('#endTimerBtn')?.addEventListener('click', endFocusSession);
function pauseIcon() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}

/* ═══════════════════════════════════════════════════════
   GOALS CRUD
   ═══════════════════════════════════════════════════════ */
function showGoalCreatePanel(show) {
  const panel = qs('#goalCreatePanel');
  if (!panel) return;
  panel.style.display = show ? 'block' : 'none';
  if (show && typeof gsap !== 'undefined') {
    gsap.fromTo(panel, { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    qs('#goalTitleInput')?.focus();
  }
}

async function fetchGoals() {
  try {
    const res = await apiFetch('/auth/goals/');
    if (!res.ok) return;
    const goals = await res.json();
    renderGoals(goals);
    animateGoalsEntrance();
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error(err);
  }
}

function animateGoalsEntrance() {
  if (typeof gsap === 'undefined') return;
  const hero = qs('#goalsHero');
  const cards = qsa('#goalsList .goal-card');
  if (hero) gsap.fromTo(hero, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
  if (cards.length) {
    gsap.fromTo(cards, { opacity: 0, y: 20, scale: 0.97 }, {
      opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.06, ease: 'power3.out', delay: 0.08
    });
  }
}

let goalDurationUnit = 'mins';

function formatGoalDuration(hours) {
  const h = Number(hours) || 0;
  const totalMins = Math.round(h * 60);
  if (totalMins < 60) return `${totalMins}m`;
  if (totalMins % 60 === 0) return `${totalMins / 60}h`;
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${mins}m`;
}

function syncGoalUnitUI() {
  const minsBtn = qs('#goalUnitMins');
  const hoursBtn = qs('#goalUnitHours');
  const hint = qs('#goalDurationHint');
  const input = qs('#goalDurationInput');
  minsBtn?.classList.toggle('active', goalDurationUnit === 'mins');
  hoursBtn?.classList.toggle('active', goalDurationUnit === 'hours');
  if (hint) {
    hint.textContent = goalDurationUnit === 'mins'
      ? 'Example: 90 minutes of deep focus'
      : 'Example: 2 hours of deep focus';
  }
  if (input) {
    input.max = goalDurationUnit === 'mins' ? '10000' : '500';
    input.step = goalDurationUnit === 'mins' ? '5' : '0.5';
    if (!input.value) input.value = goalDurationUnit === 'mins' ? '90' : '2';
  }
}

function setGoalDurationUnit(unit) {
  if (unit !== 'mins' && unit !== 'hours') return;
  const input = qs('#goalDurationInput');
  const prev = goalDurationUnit;
  if (prev === unit) return;
  const val = parseFloat(input?.value || '0') || 0;
  goalDurationUnit = unit;
  if (input && val > 0) {
    input.value = unit === 'mins'
      ? String(Math.max(1, Math.round(val * 60)))
      : String(Math.max(0.5, Math.round((val / 60) * 10) / 10));
  }
  syncGoalUnitUI();
}

function renderGoals(goals) {
  const container = qs('#goalsList');
  if (!container) return;
  if (!goals.length) {
    container.innerHTML = `<div class="goals-empty empty" style="grid-column:1/-1;">
      <div class="empty-icon">◎</div>
      <div class="empty-title">No goals yet</div>
      <div class="empty-desc">Create a target in minutes or hours and track your focus progress.</div>
    </div>`;
    return;
  }

  container.innerHTML = goals.map(g => {
    const pct = g.target_focus_hours > 0
      ? Math.min(100, Math.round((g.current_focus_hours / g.target_focus_hours) * 100))
      : 0;
    const done = pct >= 100;
    const progressLabel = `${formatGoalDuration(g.current_focus_hours)} / ${formatGoalDuration(g.target_focus_hours)}`;
    return `
      <article class="goal-card ${done ? 'is-complete' : ''}">
        <div class="goal-card-ring" style="--goal-pct:${pct}"></div>
        <div class="goal-card-body">
          <div class="goal-card-header">
            <div>
              <div class="goal-name">${htmlEsc(g.title)}</div>
              <div class="goal-desc">${htmlEsc(g.description || 'Focus duration target')}</div>
            </div>
            <span class="goal-pct-badge">${pct}%</span>
          </div>
          <div class="goal-progress">
            <div class="goal-bar-wrap"><div class="goal-bar" style="width:${pct}%"></div></div>
            <div class="goal-meta">
              <span>${progressLabel}</span>
              ${g.target_date ? `<span>Due ${g.target_date}</span>` : '<span>No due date</span>'}
            </div>
          </div>
          <div class="goal-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-danger" onclick="deleteGoal(${g.id})">Delete</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function submitNewGoal() {
  const title = (qs('#goalTitleInput')?.value || '').trim();
  const raw = parseFloat(qs('#goalDurationInput')?.value || '0') || 0;
  if (!title) {
    toast('Enter a goal title', 'warning');
    return;
  }
  if (raw <= 0) {
    toast('Enter a target duration', 'warning');
    return;
  }
  const hours = goalDurationUnit === 'mins' ? (raw / 60) : raw;
  try {
    const res = await apiFetch('/auth/goals/', {
      method: 'POST',
      body: JSON.stringify({ title, target_focus_hours: hours, status: 'ACTIVE' })
    });
    if (res.ok) {
      toast('Goal created', 'success');
      showGoalCreatePanel(false);
      if (qs('#goalTitleInput')) qs('#goalTitleInput').value = '';
      if (qs('#goalDurationInput')) qs('#goalDurationInput').value = goalDurationUnit === 'mins' ? '90' : '2';
      fetchGoals();
    } else {
      toast('Could not create goal', 'danger');
    }
  } catch (e) {
    console.error(e);
    toast('Error creating goal', 'danger');
  }
}

qs('#addGoalBtn')?.addEventListener('click', () => {
  showGoalCreatePanel(true);
  syncGoalUnitUI();
});
qs('#cancelGoalCreateBtn')?.addEventListener('click', () => showGoalCreatePanel(false));
qs('#cancelGoalCreateBtn2')?.addEventListener('click', () => showGoalCreatePanel(false));
qs('#submitGoalBtn')?.addEventListener('click', submitNewGoal);
qs('#goalTitleInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNewGoal();
});
qs('#goalUnitMins')?.addEventListener('click', () => setGoalDurationUnit('mins'));
qs('#goalUnitHours')?.addEventListener('click', () => setGoalDurationUnit('hours'));
syncGoalUnitUI();

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  try {
    await apiFetch(`/auth/goals/${id}/`, { method: 'DELETE' });
    toast('Goal deleted');
    fetchGoals();
  } catch (e) { console.error(e); }
}

/* ═══════════════════════════════════════════════════════
   PROFILE CRUD
   ═══════════════════════════════════════════════════════ */
async function fetchProfile() {
  try {
    const res = await apiFetch('/auth/profile/');
    if (!res.ok) return;
    const p = await res.json();
    const first = p.first_name || p.user?.first_name || '';
    const last = p.last_name || p.user?.last_name || '';
    const username = p.username || p.user?.username || state.username || '';
    const display = p.display_name || `${first} ${last}`.trim() || username;

    const firstEl = qs('#profFirstName');
    const lastEl = qs('#profLastName');
    if (firstEl) firstEl.value = first;
    if (lastEl) lastEl.value = last;
    setEl('profDisplayName', display);
    setEl('profUsername', username ? `@${username}` : '');

    const avatar = qs('#profAvatar');
    if (avatar) {
      const initials = ((first[0] || '') + (last[0] || '') || (username[0] || '?')).toUpperCase();
      avatar.textContent = initials;
    }
  } catch (e) { console.error(e); }
}

function renderProfileRecordAndBadges() {
  const data = currentGamificationData;
  if (!data) return;

  const streak = data.streaks?.current_streak ?? 0;
  const best = data.streaks?.longest_streak ?? 0;
  const days = data.streaks?.total_active_days ?? 0;
  const unlocked = (data.badges || []).filter(b => b.unlocked);

  setEl('profRecStreak', `${streak}d`);
  setEl('profRecBest', `${best}d`);
  setEl('profRecDays', String(days));
  setEl('profRecBadges', String(unlocked.length));

  const container = qs('#profBadgesOwned');
  if (!container) return;
  if (unlocked.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🏅</div>
        <div class="empty-title">No awards yet</div>
        <div class="empty-desc">Complete focus sessions to earn your first medal.</div>
      </div>`;
    return;
  }
  container.innerHTML = unlocked.map(b => {
    const artwork = getBadgeArtwork(b.id, b.tier, b.icon);
    return `
    <div class="fitness-award-card unlocked mini tier-${(b.tier || 'bronze').toLowerCase()}">
      <div class="fitness-medal">${artwork}</div>
      <div class="fitness-award-meta">
        <div class="badge-name">${htmlEsc(b.name || b.title)}</div>
        <div class="badge-desc">${htmlEsc(b.description || '')}</div>
        <span class="fitness-tier-pill">${htmlEsc(b.tier || 'Earned')}</span>
      </div>
    </div>`;
  }).join('');
}

qs('#saveProfileBtn')?.addEventListener('click', async () => {
  try {
    const res = await apiFetch('/auth/profile/', {
      method: 'PATCH',
      body: JSON.stringify({
        first_name: val('profFirstName'),
        last_name: val('profLastName')
      })
    });
    const msgEl = qs('#profileMsg');
    if (res.ok) {
      if (msgEl) {
        msgEl.textContent = '✓ Name saved.';
        msgEl.className = 'form-hint form-success';
      }
      toast('Profile saved', 'success');
      await fetchProfile();
    } else if (msgEl) {
      msgEl.textContent = 'Failed to save. Please try again.';
      msgEl.className = 'form-hint form-error';
    }
    if (msgEl) setTimeout(() => { msgEl.textContent = ''; }, 4000);
  } catch (e) { console.error(e); }
});

/* ═══════════════════════════════════════════════════════
   AI ATTENTION ANALYSIS REPORT MODAL
   ═══════════════════════════════════════════════════════ */
function openAIReportModal(insightData, dashboardData, isLoading = false) {
  const modal = qs('#aiReportModal');
  if (!modal) return;
  modal.classList.add('is-open');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  const d = dashboardData || state.lastDashboardData || {};
  const ins = insightData || d.ai_insight || {};
  const verdictCard = qs('#aiModalVerdictCard');

  if (isLoading) {
    if (verdictCard) verdictCard.className = 'ai-verdict analyzing';
    const vBadge = qs('#aiModalVerdictBadge');
    if (vBadge) {
      vBadge.textContent = 'ANALYZING';
      vBadge.className = 'ai-verdict-badge';
    }
    setEl('aiModalScoreDisplay', 'Computing…');
    setEl('aiModalVerdictReason', 'Analyzing your daily activity, browsing patterns, and focus habits…');
    setEl('aiModalNarrative', 'Please wait while FocusGuard AI evaluates your focus sessions and activity…');
    const recsGrid = qs('#aiModalRecsGrid');
    if (recsGrid) recsGrid.innerHTML = '<div class="ai-rec skeleton">Gathering recommendations…</div>';
    return;
  }

  const prodS = d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600);
  const distS = d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600);
  const prodFormatted = d.productive_formatted || formatDuration(prodS);
  const distFormatted = d.distracted_formatted || formatDuration(distS);

  const pScore = Math.round(d.productivity_score ?? (distS === 0 ? 100 : Math.round((prodS / (prodS + distS)) * 100)));
  const fScore = Math.round(d.focus_score ?? pScore);
  const isProd = distS === 0 || pScore >= 55.0;
  const noData = prodS === 0 && distS === 0;

  if (verdictCard) {
    verdictCard.className = `ai-verdict ${noData ? 'neutral' : (isProd ? 'productive' : 'distracted')}`;
  }
  const verdictBadge = qs('#aiModalVerdictBadge');
  if (verdictBadge) {
    verdictBadge.textContent = noData ? 'NO DATA' : (isProd ? 'PRODUCTIVE' : 'HIGH DISTRACTIONS');
    verdictBadge.className = 'ai-verdict-badge';
  }
  setEl('aiModalScoreDisplay', `Productivity: ${pScore}%`);
  const reason = qs('#aiModalVerdictReason');
  if (reason) {
    if (noData) {
      reason.textContent = 'No activity recorded yet today. Start a session to begin tracking your deep work in real time.';
    } else {
      reason.textContent = isProd
        ? `Great focus today! You dedicated ${prodFormatted} to productive tasks with minimal distractions.`
        : `Frequent distractions detected. You spent ${distFormatted} on non-work apps and websites.`;
    }
  }

  setEl('aiModalProdTime', prodFormatted);
  setEl('aiModalDistTime', distFormatted);
  setEl('aiModalSwitches', d.total_switches || 0);
  setEl('aiModalFocusIndex', `${fScore}/100`);

  const distWrap = qs('#aiModalDistractorWrap');
  const distList = qs('#aiModalDistractorsList');
  const distractors = ins.top_distractors || [];
  if (distractors.length > 0 && distWrap && distList) {
    distWrap.style.display = 'block';
    distList.innerHTML = distractors.map(x => `
      <span class="ai-chip danger">${htmlEsc(x.name)} · ${x.duration_mins}m</span>
    `).join('');
  } else if (distWrap) {
    distWrap.style.display = 'none';
  }

  setEl('aiModalNarrative', ins.insights_text || 'Focus analysis generated based on your activity and session records.');

  const recsGrid = qs('#aiModalRecsGrid');
  const recs = ins.recommendations || [];
  if (recsGrid) {
    recsGrid.innerHTML = recs.length
      ? recs.map(r => `
          <div class="ai-rec">
            <div class="ai-rec-title">${htmlEsc(r.title || 'Tip')}</div>
            <div class="ai-rec-body">${htmlEsc(r.detail || r.text || '')}</div>
          </div>
        `).join('')
      : '<div class="ai-rec"><div class="ai-rec-body">Keep sessions short, silence notifications, and review your shield list after each block.</div></div>';
  }

  setEl('aiModalTimestamp', ins.generated_at
    ? `Generated at ${new Date(ins.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Personalized focus evaluation');
}

function closeAIReportModal() {
  const modal = qs('#aiReportModal');
  if (modal) {
    modal.classList.remove('is-open');
    modal.style.display = 'none';
  }
  document.body.style.overflow = '';
}

qs('#closeAiModalBtn')?.addEventListener('click', closeAIReportModal);
qs('#aiModalOkBtn')?.addEventListener('click', closeAIReportModal);
qs('#aiReportModal')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAIReportModal();
});

// AI Analysis Button handler
qs('#aiAnalysisBtn')?.addEventListener('click', async () => {
  const btn = qs('#aiAnalysisBtn');
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></svg> Analyzing…`;
  btn.disabled = true;

  // Immediately display modal in loading state
  openAIReportModal(null, state.lastDashboardData, true);

  try {
    const res = await apiFetch('/ai/generate-insight/', { method: 'POST' });
    if (res.ok) {
      const insight = await res.json();
      await fetchDashboard();
      openAIReportModal(insight, state.lastDashboardData, false);
      toast('AI Analysis complete!', 'success');
    } else {
      await fetchDashboard();
      openAIReportModal(null, state.lastDashboardData, false);
    }
  } catch (e) {
    console.error('AI error:', e);
    await fetchDashboard();
    openAIReportModal(null, state.lastDashboardData, false);
  } finally {
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>AI Analysis`;
    btn.disabled = false;
  }
});

/* ═══════════════════════════════════════════════════════
   DATE-WISE REPORT GENERATION & DATA DELETION
   ═══════════════════════════════════════════════════════ */
async function loadDateReport(dateStr) {
  const placeholder = qs('#dateReportPlaceholder');
  const content = qs('#dateReportContent');
  if (!dateStr) return;

  try {
    const res = await apiFetch(`/dashboard/report/?date=${dateStr}`);
    if (!res.ok) {
      toast('Could not load report for selected date', 'danger');
      return;
    }
    const d = await res.json();

    if (placeholder) placeholder.style.display = 'none';
    if (content) content.style.display = 'flex';

    const userName = d.user_name || state.username || 'User';
    const userMeta = `@${d.username || state.username || 'user'}${d.email ? ' · ' + d.email : ''}`;
    const genAt = d.generated_at_display || new Date().toLocaleString();
    setEl('reportUserName', userName);
    setEl('reportUserMeta', userMeta);
    setEl('reportGeneratedAt', `Generated ${genAt}`);
    setEl('reportPreviewUser', `${userName} · @${d.username || state.username || 'user'}`);
    setEl('reportPreviewGenerated', `Generated ${genAt}`);

    // Verdict Banner
    const isProd = d.verdict === 'PRODUCTIVE' || d.verdict === 'HIGHLY PRODUCTIVE';
    const isDist = d.verdict === 'DISTRACTED';
    const banner = qs('#dateReportVerdictBanner');
    const badge = qs('#dateReportVerdictBadge');

    if (banner) {
      banner.classList.toggle('is-prod', isProd);
      banner.classList.toggle('is-dist', isDist);
    }
    if (badge) {
      badge.textContent = d.verdict_badge || d.verdict;
      badge.className = `badge ${isProd ? 'badge-productive' : isDist ? 'badge-distracting' : 'badge-neutral'}`;
    }
    setEl('dateReportDateLabel', `Report for ${d.date}`);
    setEl('dateReportVerdictReason', d.verdict_reason || '');

    // 4 Metrics
    setEl('dateReportProdHours', d.productive_formatted || formatDuration(d.productive_secs ?? Math.round((d.productive_hours || 0) * 3600)));
    setEl('dateReportDistHours', d.distracted_formatted || formatDuration(d.distracted_secs ?? Math.round((d.distracted_hours || 0) * 3600)));
    setEl('dateReportSwitches', d.total_switches);
    setEl('dateReportScore', d.productivity_score !== null && d.productivity_score !== undefined ? `${Math.round(d.productivity_score)}%` : '—');

    // Separate Sessions on this date
    const sessionList = qs('#dateReportSessionsList');
    const sessionBadge = qs('#dateReportSessionCount');
    const sessions = d.sessions || [];
    if (sessionBadge) sessionBadge.textContent = `${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`;

    if (sessionList) {
      if (sessions.length === 0) {
        sessionList.innerHTML = `<div style="font-size:12px; color:var(--text-400); padding:8px 0;">No focus sessions logged on this date.</div>`;
      } else {
        sessionList.innerHTML = sessions.map((s, idx) => {
          const startTime = new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const endTime = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active';
          const pScore = Math.round(s.productivity_score ?? 100);
          return `
            <div class="fitness-report-row">
              <div>
                <strong>Session #${idx + 1}</strong>
                <span class="fitness-report-row-meta">${htmlEsc(s.session_type || 'Deep Work')} · ${startTime} – ${endTime} · ${s.actual_duration_mins || 1}m</span>
              </div>
              <div class="fitness-report-row-aside">
                <span>${s.switches_count || 0} switches</span>
                <span class="fitness-score-pill ${pScore >= 70 ? 'good' : pScore >= 40 ? 'mid' : 'low'}">${pScore}%</span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Top Apps
    const appsList = qs('#dateReportAppsList');
    if (appsList) {
      const apps = d.top_apps || [];
      if (apps.length === 0) {
        appsList.innerHTML = `<div class="fitness-report-empty">No desktop app activity on this date.</div>`;
      } else {
        appsList.innerHTML = apps.map(a => `
          <div class="fitness-report-item">
            <span>${htmlEsc(a.app_name)}</span>
            <span class="fitness-report-item-val">${Math.round(a.total_secs / 60)}m</span>
          </div>
        `).join('');
      }
    }

    // Top Sites
    const sitesList = qs('#dateReportSitesList');
    if (sitesList) {
      const sites = d.top_sites || [];
      if (sites.length === 0) {
        sitesList.innerHTML = `<div class="fitness-report-empty">No browser activity on this date.</div>`;
      } else {
        sitesList.innerHTML = sites.map(s => `
          <div class="fitness-report-item">
            <span>${htmlEsc(s.domain)}</span>
            <span class="fitness-report-item-val">${Math.round(s.total_secs / 60)}m</span>
          </div>
        `).join('');
      }
    }

  } catch (e) {
    console.error('Error loading date report:', e);
    toast('Error generating date report', 'danger');
  }
}

async function deleteDateData(dateStr) {
  if (!dateStr) return;
  const confirmed = confirm(`⚠️ Are you sure you want to permanently delete all activity and focus sessions recorded on ${dateStr}?\n\nThis action cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/dashboard/report/?date=${dateStr}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      toast(`Deleted ${data.deleted?.total || 0} records for ${dateStr}`, 'success');
      await loadDateReport(dateStr);
      await fetchDashboard();
    } else {
      toast('Failed to delete data for date', 'danger');
    }
  } catch (e) {
    console.error('Error deleting date data:', e);
    toast('Error deleting date data', 'danger');
  }
}

// Wire Date Report buttons
const reportDateInput = qs('#reportDateInput');
if (reportDateInput) {
  reportDateInput.value = new Date().toISOString().slice(0, 10);
}

qs('#btnGenDateReport')?.addEventListener('click', () => {
  const dateVal = qs('#reportDateInput')?.value;
  if (!dateVal) { toast('Please choose a date', 'danger'); return; }
  loadDateReport(dateVal);
});

qs('#btnDownloadPdfReport')?.addEventListener('click', () => {
  const dateVal = qs('#reportDateInput')?.value;
  if (!dateVal) { toast('Please choose a date', 'danger'); return; }
  downloadPdfReport(dateVal);
});

async function downloadPdfReport(dateStr) {
  try {
    toast('Generating PDF…', 'success');
    const res = await apiFetch(`/dashboard/report/pdf/?date=${encodeURIComponent(dateStr)}`);
    if (!res.ok) {
      toast('Failed to generate PDF report', 'danger');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `focusguard-report-${dateStr}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('PDF downloaded', 'success');
  } catch (e) {
    console.error('PDF download error:', e);
    toast('Error downloading PDF', 'danger');
  }
}

/* ═══════════════════════════════════════════════════════
   TODAY'S SEPARATE FOCUS SESSIONS RENDERER
   ═══════════════════════════════════════════════════════ */
function renderTodayFocusSessions(sessions) {
  const container = qs('#focusTodaySessionsList');
  const countBadge = qs('#focusSessionsCountBadge');
  if (!container) return;

  const countStr = `${sessions.length} Session${sessions.length !== 1 ? 's' : ''}`;
  if (countBadge && countBadge.textContent !== countStr) {
    countBadge.textContent = countStr;
  }

  const json = JSON.stringify(sessions);
  if (container.dataset.lastJson === json) return;
  container.dataset.lastJson = json;

  if (!sessions || sessions.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⏱️</div>
        <div class="empty-title">No completed sessions yet today</div>
        <div class="empty-desc">Click "Start Session" above to begin your first deep work block.</div>
      </div>`;
    return;
  }

  container.innerHTML = sessions.map((s, idx) => {
    const sNum = idx + 1;
    const startTime = new Date(s.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = s.end_time ? new Date(s.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In progress';
    const prodMin = Math.round((s.productive_secs || 0) / 60);
    const distMin = Math.round((s.distracted_secs || 0) / 60);
    const score = Math.round(s.productivity_score ?? 100);
    const badgeClass = score >= 70 ? 'badge-productive' : score >= 40 ? 'badge-neutral' : 'badge-danger';
    const isCompleted = s.status === 'COMPLETED';

    return `
      <div class="card" style="padding:16px 20px; border:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; background:var(--surface-0); border-radius:var(--r-md);">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="width:40px; height:40px; border-radius:var(--r-md); background:var(--surface-2); display:flex; align-items:center; justify-content:center; font-weight:800; color:var(--brand-600); font-size:15px;">
            #${sNum}
          </div>
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-weight:700; font-size:14px; color:var(--text-900);">${htmlEsc(s.session_type || 'Deep Work')}</span>
              <span class="badge ${badgeClass}" style="font-size:10px;">${score}% PRODUCTIVE</span>
              <span class="badge ${isCompleted ? 'badge-productive' : 'badge-neutral'}" style="font-size:10px;">${s.status}</span>
            </div>
            <div style="font-size:12px; color:var(--text-500); margin-top:3px;">
              ⏱️ ${startTime} – ${endTime} · <strong>${s.actual_duration_mins || 1} mins</strong>
            </div>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:16px; font-size:12px;">
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Productive</div>
            <div style="font-weight:700; color:var(--color-success);">${prodMin}m</div>
          </div>
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Distracted</div>
            <div style="font-weight:700; color:var(--color-danger);">${distMin}m</div>
          </div>
          <div>
            <div style="color:var(--text-400); font-size:10px; text-transform:uppercase;">Switches</div>
            <div style="font-weight:700; color:var(--brand-600);">${s.switches_count || 0}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD & TAB SESSION CONTROLLER (NO TIMERS)
   ═══════════════════════════════════════════════════════ */
let dashTimerInterval = null;

function updateDashSessionUI(activeSession) {
  const badge = qs('#dashSessionBadge');
  const title = qs('#dashSessionTitle');
  const meta = qs('#dashSessionMeta');
  const elapsedDisplay = qs('#dashElapsedDisplay');
  const startBtn = qs('#dashStartSessionBtn');
  const endBtn = qs('#dashEndSessionBtn');

  // Focus Session tab controls (primary after dashboard banner removal)
  const focusBadge = qs('#focusSessionStatusBadge');
  const focusDisplay = qs('#timerDisplay');
  const focusLabel = qs('#timerLabel');
  const startTimerBtn = qs('#startTimerBtn');
  const endTimerBtn = qs('#endTimerBtn');

  if (activeSession && activeSession.id) {
    state.activeSessionId = activeSession.id;
    const startTime = new Date(activeSession.start_time).getTime();
    state.activeSessionStartTime = startTime;

    if (badge && badge.textContent !== 'SESSION ACTIVE') {
      badge.textContent = 'SESSION ACTIVE';
      badge.className = 'badge badge-productive';
    }
    const expectedTitle = `Active Session: <span style="color:var(--brand-600);">${htmlEsc(activeSession.session_type || 'Deep Work')}</span>`;
    if (title && title.innerHTML !== expectedTitle) {
      title.innerHTML = expectedTitle;
    }
    
    if (elapsedDisplay) elapsedDisplay.style.display = 'inline-block';
    if (startBtn) startBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'inline-flex';

    if (focusBadge && focusBadge.textContent !== 'SESSION ACTIVE') {
      focusBadge.textContent = 'SESSION ACTIVE';
      focusBadge.className = 'fitness-focus-badge badge badge-productive is-active';
    }
    if (focusLabel && focusLabel.textContent !== 'Session actively tracking · No timer limits') {
      focusLabel.textContent = 'Session actively tracking · No timer limits';
    }
    if (startTimerBtn) startTimerBtn.style.display = 'none';
    if (endTimerBtn) endTimerBtn.style.display = 'inline-flex';

    if (!dashTimerInterval) {
      function tick() {
        if (isBreakActive()) return;

        const sBtn = qs('#dashStartSessionBtn');
        const eBtn = qs('#dashEndSessionBtn');
        if (sBtn && sBtn.style.display !== 'none') sBtn.style.display = 'none';
        if (eBtn && eBtn.style.display !== 'inline-flex') eBtn.style.display = 'inline-flex';
        const stBtn = qs('#startTimerBtn');
        const etBtn = qs('#endTimerBtn');
        if (stBtn && stBtn.style.display !== 'none') stBtn.style.display = 'none';
        if (etBtn && etBtn.style.display !== 'inline-flex') etBtn.style.display = 'inline-flex';

        const start = state.activeSessionStartTime || startTime;
        const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
        const elapsedMins = Math.floor(elapsed / 60);
        checkBreakReminder(elapsedMins);

        const hours = Math.floor(elapsed / 3600);
        const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
        const s = (elapsed % 60).toString().padStart(2, '0');
        const timeStr = hours > 0 ? `${hours}:${m}:${s}` : `${m}:${s}`;

        const elapsedDisp = qs('#dashElapsedDisplay');
        if (elapsedDisp) {
          const str = `Elapsed: ${timeStr}`;
          if (elapsedDisp.textContent !== str) elapsedDisp.textContent = str;
        }
        const focusDisp = qs('#timerDisplay');
        if (focusDisp && focusDisp.textContent !== timeStr) {
          focusDisp.textContent = timeStr;
        }
        updateFocusRing(elapsed);

        const currentTier = state.liveActiveApp?.productivity_label || 'PRODUCTIVE';
        if (currentTier === 'DISTRACTING') {
          state.liveDistSecs = (state.liveDistSecs || 0) + 1;
          checkAndPlayDistractionChime(state.liveActiveApp?.app_name || 'Distraction');
        } else if (currentTier === 'NEUTRAL') {
          state.liveNeutSecs = (state.liveNeutSecs || 0) + 1;
        } else {
          state.liveProdSecs = (state.liveProdSecs || 0) + 1;
        }

        const prodFormatted = formatDuration(state.liveProdSecs);
        const distFormatted = state.liveDistSecs > 0 ? formatDuration(state.liveDistSecs) : '0s';
        const liveTot = state.liveProdSecs + state.liveDistSecs + (state.liveNeutSecs || 0);
        const rawLivePct = liveTot > 0 ? Math.round((state.liveProdSecs / liveTot) * 100) : 100;
        const sw = state.liveSwitches || (state.liveSession?.switches) || 0;
        const swPenalty = Math.min(30, Math.round(sw * 1.5));
        const liveScore = Math.max(0, rawLivePct - swPenalty);

        setEl('prodVal', prodFormatted);
        setEl('distVal', distFormatted);
        setEl('scoreVal', `${liveScore}%`);
        const lbl = liveScore >= 70 ? 'High Focus' : liveScore >= 40 ? 'Moderate' : 'Needs Focus';
        setEl('scoreMeta', sw > 0 ? `${rawLivePct}% productive · −${swPenalty}pts (${sw} switches) · ${lbl}` : `${rawLivePct}% productive · ${lbl}`);

        const metaEl = qs('#dashSessionMeta');
        if (metaEl) {
          const startFormatted = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const newMeta = `Session in progress · Started at ${startFormatted} · ${Math.floor(elapsed / 60)}m elapsed · Current session: ${sw} switches · ${liveScore}% productive`;
          if (metaEl.textContent !== newMeta) metaEl.textContent = newMeta;
        }
      }
      tick();
      dashTimerInterval = setInterval(tick, 1000);
    }

  } else {
    if (dashTimerInterval) { clearInterval(dashTimerInterval); dashTimerInterval = null; }
    state.activeSessionId = null;
    state.activeSessionStartTime = null;
    if (badge && badge.textContent !== 'IDLE') { badge.textContent = 'IDLE'; badge.className = 'badge badge-neutral'; }
    if (title && title.textContent !== 'No Active Session') title.textContent = 'No Active Session';
    const idleMeta = 'Start a session to actively shield your attention, track context switches, and record your productivity score.';
    if (meta && meta.textContent !== idleMeta) meta.textContent = idleMeta;
    if (elapsedDisplay) elapsedDisplay.style.display = 'none';
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (endBtn) endBtn.style.display = 'none';

    if (focusBadge && focusBadge.textContent !== 'IDLE') { focusBadge.textContent = 'IDLE'; focusBadge.className = 'fitness-focus-badge badge badge-neutral'; }
    if (focusDisplay && focusDisplay.textContent !== '00:00') focusDisplay.textContent = '00:00';
    if (focusLabel && focusLabel.textContent !== 'Ready to start session') focusLabel.textContent = 'Ready to start session';
    if (startTimerBtn) startTimerBtn.style.display = 'inline-flex';
    if (endTimerBtn) endTimerBtn.style.display = 'none';
    updateFocusRing(0);

    updateLiveVisionUI({ is_active: false });
  }
}

function updateFocusRing(elapsedSecs) {
  const ring = qs('#focusRingProgress');
  if (!ring) return;
  const circumference = 2 * Math.PI * 94;
  const progress = Math.min(1, Math.max(0, elapsedSecs / 3600));
  ring.style.strokeDasharray = `${circumference}`;
  ring.style.strokeDashoffset = `${circumference * (1 - progress)}`;
}

// Single Button click handlers for Start Session and Stop Session
qs('#dashStartSessionBtn')?.addEventListener('click', startFocusSession);
qs('#dashEndSessionBtn')?.addEventListener('click', endFocusSession);

/* ═══════════════════════════════════════════════════════
   LIVE POLLING
   ═══════════════════════════════════════════════════════ */
function startPoll() {
  stopPoll();
  state.pollTimer = setInterval(() => {
    const tab = state.activeTab;
    if (tab === 'dashboard') fetchDashboard();
    else if (tab === 'switches') fetchSwitches();
    else if (tab === 'telemetry') {
      fetchTelemetry();
      fetchSystemData();
    }
    else if (tab === 'analytics') {
      fetchDashboard();
      loadTrends(currentTrendsDays || 7);
    }
  }, POLL_MS);
}

function stopPoll() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

function updateLastUpdated() {
  const el = qs('#lastUpdated');
  if (el) {
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (el.textContent !== t) el.textContent = t;
  }
}

/* ═══════════════════════════════════════════════════════
   SOUND NOTIFICATIONS (Feature 2: Web Audio API)
   ═══════════════════════════════════════════════════════ */
let audioCtx = null;
let isSoundMuted = localStorage.getItem('fg_sound_muted') === 'true';

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playChime(type = 'start') {
  if (isSoundMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    
    if (type === 'start') {
      // Uplifting ascending major triad (C5 -> E5 -> G5)
      const freqs = [523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0, now + idx * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.36);
      });
    } else if (type === 'end') {
      // Celebratory completion chime (G4 -> C5 -> E5 -> G5)
      const freqs = [392.00, 523.25, 659.25, 783.99];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.14);
        gain.gain.setValueAtTime(0, now + idx * 0.14);
        gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.14 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.52);
      });
    } else if (type === 'distraction') {
      // Soft polite distraction warning (two descending low notes)
      const freqs = [440, 349.23];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15);
        gain.gain.setValueAtTime(0, now + idx * 0.15);
        gain.gain.linearRampToValueAtTime(0.14, now + idx * 0.15 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.15 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.15);
        osc.stop(now + idx * 0.15 + 0.3);
      });
    } else if (type === 'break') {
      // Calming resonant meditation bell chime (warm 432Hz with harmonic)
      [432, 864].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = idx === 0 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(idx === 0 ? 0.22 : 0.08, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.85);
      });
    }
  } catch (e) {
    console.debug('Web Audio error or waiting for gesture:', e);
  }
}

function updateSoundToggleUI() {
  const iconOn = qs('#soundIconOn');
  const iconOff = qs('#soundIconOff');
  const btn = qs('#soundToggleBtn');
  if (iconOn && iconOff) {
    if (isSoundMuted) {
      iconOn.style.display = 'none';
      iconOff.style.display = 'block';
      if (btn) btn.title = 'Audio Chimes: Muted (Click to un-mute)';
    } else {
      iconOn.style.display = 'block';
      iconOff.style.display = 'none';
      if (btn) btn.title = 'Audio Chimes: Active (Click to mute)';
    }
  }
}

function toggleSoundMute() {
  isSoundMuted = !isSoundMuted;
  localStorage.setItem('fg_sound_muted', isSoundMuted ? 'true' : 'false');
  updateSoundToggleUI();
  if (!isSoundMuted) {
    playChime('start');
    toast('🔊 Audio chimes enabled', 'info');
  } else {
    toast('🔇 Audio chimes muted', 'info');
  }
}

let lastDistractionChimeTime = 0;
function checkAndPlayDistractionChime(label) {
  const now = Date.now();
  if (now - lastDistractionChimeTime > 25000) {
    lastDistractionChimeTime = now;
    playChime('distraction');
    toast(`⚠️ Focus alert: ${label} is distracting during your session`, 'warning');
  }
}

/* ═══════════════════════════════════════════════════════
   BREAK & HYDRATION REMINDERS (Feature 5)
   ═══════════════════════════════════════════════════════ */
let lastBreakReminderMinute = 0;
let breakCountdownInterval = null;

function checkBreakReminder(elapsedMins) {
  if (isBreakActive()) return;
  if (elapsedMins >= 50 && (elapsedMins - lastBreakReminderMinute) >= 50) {
    lastBreakReminderMinute = Math.floor(elapsedMins / 50) * 50;
    showBreakReminderModal(elapsedMins);
  }
}

function showBreakReminderModal(elapsedMins) {
  const modal = qs('#breakReminderModal');
  if (!modal) return;
  setEl('breakMinsElapsed', `${elapsedMins} minutes`);
  modal.style.display = 'flex';
  playChime('break');

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  } else if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('FocusGuard AI — Rest & Refresh Reminder', {
        body: `You've achieved ${elapsedMins} minutes of continuous deep work! Rest your eyes and hydrate.`,
        icon: '/static/favicon.ico'
      });
    } catch (e) {}
  }
}

function closeBreakReminderModal() {
  const modal = qs('#breakReminderModal');
  if (modal) modal.style.display = 'none';
  if (breakCountdownInterval) {
    clearInterval(breakCountdownInterval);
    breakCountdownInterval = null;
  }
  setEl('breakCountdownClock', '05:00');
  const btn = qs('#startBreakTimerBtn');
  if (btn) btn.textContent = 'Start 5-Minute Rest Timer';
}

function startBreakCountdown(totalSeconds = 300) {
  // Legacy modal helper — route into the Break tool instead
  setBreakDurationMins(Math.max(1, Math.round(totalSeconds / 60)));
  closeBreakReminderModal();
  switchTab('break');
  startBreakSession();
}

/* ═══════════════════════════════════════════════════════
   BREAK TOOL (Tools → Break)
   ═══════════════════════════════════════════════════════ */
const BREAK_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60];
let breakSelectedMins = 5;
let breakTimerInterval = null;
let breakEndsAtMs = 0;
let breakTotalSecs = 0;
let breakHadSessionBefore = false;

function isBreakActive() {
  if (breakEndsAtMs && Date.now() < breakEndsAtMs) return true;
  const stored = parseInt(localStorage.getItem('focusguard_break_ends_at') || '0', 10);
  return stored > Date.now();
}

function syncBreakLocalFlags(onBreak) {
  if (onBreak) {
    localStorage.setItem('focusguard_on_break', 'true');
    localStorage.setItem('focusguard_session_active', 'false');
  } else {
    localStorage.removeItem('focusguard_on_break');
    localStorage.removeItem('focusguard_break_ends_at');
    localStorage.removeItem('focusguard_break_total_secs');
  }
}

function setBreakDurationMins(mins) {
  mins = Math.max(1, Math.min(90, parseInt(mins, 10) || 5));
  breakSelectedMins = mins;
  setEl('breakSelectedMins', String(mins));
  const custom = qs('#breakCustomMins');
  if (custom && String(custom.value) !== String(mins)) custom.value = String(mins);

  const deg = (mins / 60) * 360;
  const face = qs('#breakClockFace .break-clock-face');
  if (face) {
    face.style.setProperty('--break-arc', `${deg}deg`);
    face.style.setProperty('--hand-deg', `${deg}deg`);
  }
  const hand = qs('#breakClockHand');
  if (hand) hand.style.setProperty('--hand-deg', `${deg}deg`);

  qsa('.break-clock-mark').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mins, 10) === mins);
  });
  qsa('.break-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.mins, 10) === mins);
  });
}

function formatBreakClock(totalSecs) {
  const s = Math.max(0, totalSecs);
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function showBreakPickerUI() {
  const picker = qs('#breakPickerPanel');
  const running = qs('#breakRunningPanel');
  if (picker) picker.style.display = '';
  if (running) running.style.display = 'none';
  const pill = qs('#breakStatusPill');
  if (pill) {
    pill.textContent = 'Ready';
    pill.classList.remove('live');
  }
}

function showBreakRunningUI() {
  const picker = qs('#breakPickerPanel');
  const running = qs('#breakRunningPanel');
  if (picker) picker.style.display = 'none';
  if (running) running.style.display = 'flex';
  const pill = qs('#breakStatusPill');
  if (pill) {
    pill.textContent = 'On Break';
    pill.classList.add('live');
  }
}

function tickBreakTimer() {
  const remaining = Math.max(0, Math.ceil((breakEndsAtMs - Date.now()) / 1000));
  setEl('breakLiveClock', formatBreakClock(remaining));
  const fill = qs('#breakProgressFill');
  if (fill && breakTotalSecs > 0) {
    fill.style.width = `${Math.max(0, Math.min(100, (remaining / breakTotalSecs) * 100))}%`;
  }
  setEl('breakLiveMeta', 'Focus Session & Focus Shield paused');

  if (remaining <= 0) {
    finishBreakSession({ auto: true });
  }
}

async function startBreakSession() {
  if (isBreakActive()) {
    toast('A break is already running', 'warning');
    refreshBreakUI();
    return;
  }

  const mins = breakSelectedMins || 5;
  breakHadSessionBefore = !!state.activeSessionId
    || localStorage.getItem('focusguard_session_active') === 'true';

  try {
    const res = await apiFetch('/focus/break/start/', {
      method: 'POST',
      body: JSON.stringify({ duration_mins: mins })
    });
    if (!res.ok) {
      toast('Could not start break', 'danger');
      return;
    }
    const data = await res.json();
    const endsAt = data.ends_at
      ? Math.round(Number(data.ends_at) * 1000)
      : Date.now() + mins * 60 * 1000;

    breakEndsAtMs = endsAt;
    breakTotalSecs = mins * 60;
    localStorage.setItem('focusguard_break_ends_at', String(endsAt));
    localStorage.setItem('focusguard_break_total_secs', String(breakTotalSecs));
    syncBreakLocalFlags(true);

    // Pause live focus UI / shield immediately
    if (dashTimerInterval) {
      clearInterval(dashTimerInterval);
      dashTimerInterval = null;
    }
    closeBreakReminderModal();

    showBreakRunningUI();
    if (breakTimerInterval) clearInterval(breakTimerInterval);
    tickBreakTimer();
    breakTimerInterval = setInterval(tickBreakTimer, 250);

    playChime('break');
    toast(`Break started — ${mins} min. Focus & Shield paused.`, 'success');
  } catch (e) {
    console.error('startBreakSession', e);
    toast('Error starting break', 'danger');
  }
}

async function finishBreakSession({ auto = false, early = false } = {}) {
  if (breakTimerInterval) {
    clearInterval(breakTimerInterval);
    breakTimerInterval = null;
  }
  breakEndsAtMs = 0;
  breakTotalSecs = 0;
  syncBreakLocalFlags(false);

  try {
    await apiFetch('/focus/break/end/', { method: 'POST' });
  } catch (e) {}

  // Restore session-active flag if a focus session is still open on the server
  try {
    const res = await apiFetch('/focus/active/');
    if (res.ok) {
      const data = await res.json();
      if (data.active && data.session) {
        localStorage.setItem('focusguard_session_active', 'true');
        updateDashSessionUI(data.session);
      } else {
        localStorage.setItem('focusguard_session_active', 'false');
        updateDashSessionUI(null);
      }
    }
  } catch (e) {
    localStorage.setItem('focusguard_session_active', breakHadSessionBefore ? 'true' : 'false');
  }

  showBreakPickerUI();
  setBreakDurationMins(breakSelectedMins || 5);

  if (auto) {
    playChime('start');
    toast('Break over — time to return to work.', 'success');
    showReturnToWorkNotification();
  } else if (early) {
    toast('Break ended early', 'success');
  }

  switchTab('dashboard');
  fetchDashboard();
}

function showReturnToWorkNotification() {
  // OS / browser notification (same pattern as break reminder / focus alerts)
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((perm) => {
        if (perm === 'granted') fireReturnToWorkOSNotify();
      });
    } else if (Notification.permission === 'granted') {
      fireReturnToWorkOSNotify();
    }
  }

  const modal = qs('#returnToWorkModal');
  if (modal) modal.style.display = 'flex';
}

function fireReturnToWorkOSNotify() {
  try {
    const n = new Notification('FocusGuard AI — Return to Work', {
      body: 'Your break is over. Time to get back to focus — Focus Session & Shield are ready.',
      icon: '/static/favicon.ico',
      tag: 'focusguard-return-to-work',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      closeReturnToWorkModal();
      switchTab('dashboard');
      n.close();
    };
  } catch (e) {}
}

function closeReturnToWorkModal() {
  const modal = qs('#returnToWorkModal');
  if (modal) modal.style.display = 'none';
}

function refreshBreakUI() {
  const storedEnd = parseInt(localStorage.getItem('focusguard_break_ends_at') || '0', 10);
  if (storedEnd > Date.now()) {
    breakEndsAtMs = storedEnd;
    breakTotalSecs = parseInt(localStorage.getItem('focusguard_break_total_secs') || '0', 10)
      || Math.max(1, Math.ceil((storedEnd - Date.now()) / 1000));
    syncBreakLocalFlags(true);
    showBreakRunningUI();
    if (breakTimerInterval) clearInterval(breakTimerInterval);
    tickBreakTimer();
    breakTimerInterval = setInterval(tickBreakTimer, 250);
  } else {
    if (storedEnd) syncBreakLocalFlags(false);
    showBreakPickerUI();
    setBreakDurationMins(breakSelectedMins || 5);
  }
}

async function restoreBreakFromServer() {
  try {
    const res = await apiFetch('/focus/break/status/');
    if (!res.ok) return;
    const data = await res.json();
    if (data.on_break && data.ends_at) {
      const endsAt = Math.round(Number(data.ends_at) * 1000);
      if (endsAt > Date.now()) {
        breakEndsAtMs = endsAt;
        breakTotalSecs = data.remaining_secs
          || Math.max(1, Math.ceil((endsAt - Date.now()) / 1000));
        localStorage.setItem('focusguard_break_ends_at', String(endsAt));
        localStorage.setItem('focusguard_break_total_secs', String(
          (data.duration_mins || 5) * 60
        ));
        syncBreakLocalFlags(true);
        refreshBreakUI();
        return;
      }
    }
    if (localStorage.getItem('focusguard_on_break') === 'true') {
      syncBreakLocalFlags(false);
      showBreakPickerUI();
    }
  } catch (e) {}
}

function initBreakTool() {
  setBreakDurationMins(5);

  qsa('.break-clock-mark, .break-preset').forEach(btn => {
    btn.addEventListener('click', () => setBreakDurationMins(btn.dataset.mins));
  });

  qs('#breakCustomMins')?.addEventListener('input', (e) => {
    setBreakDurationMins(e.target.value);
  });

  qs('#takeBreakBtn')?.addEventListener('click', () => startBreakSession());
  qs('#endBreakEarlyBtn')?.addEventListener('click', () => finishBreakSession({ early: true }));

  qs('#returnToWorkBtn')?.addEventListener('click', () => {
    closeReturnToWorkModal();
    switchTab('dashboard');
    if (!state.activeSessionId && !isBreakActive()) {
      // Prompt gently — user can start from dashboard
      toast('Ready when you are — start a Focus Session from the dashboard.', 'success');
    }
  });
  qs('#dismissReturnToWorkBtn')?.addEventListener('click', closeReturnToWorkModal);

  // Resume running break after refresh
  refreshBreakUI();
  restoreBreakFromServer();
}

/* ═══════════════════════════════════════════════════════
   WEEKLY & MONTHLY TRENDS (Analytics)
   ═══════════════════════════════════════════════════════ */
let chartTrends = null;
let currentTrendsDays = 7;
let analyticsGsapRan = false;

function setTrendsRangeButtons(days) {
  const b7 = qs('#btnTrends7');
  const b30 = qs('#btnTrends30');
  if (!b7 || !b30) return;
  b7.classList.toggle('active', days === 7);
  b30.classList.toggle('active', days === 30);
}

function animateAnalyticsEntrance() {
  if (typeof gsap === 'undefined') return;
  const hero = qs('#analyticsHero');
  const metrics = qsa('#analyticsMetrics .analytics-metric-card');
  const charts = qsa('#analyticsChartsGrid .analytics-chart-card, #analyticsTrends');

  gsap.killTweensOf([hero, ...metrics, ...charts].filter(Boolean));

  if (hero) {
    gsap.fromTo(hero,
      { opacity: 0, y: 18 },
      { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }
    );
  }
  if (metrics.length) {
    gsap.fromTo(metrics,
      { opacity: 0, y: 22, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.07, ease: 'power3.out', delay: 0.08 }
    );
  }
  if (charts.length) {
    gsap.fromTo(charts,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out', delay: 0.16 }
    );
  }
  analyticsGsapRan = true;

  // Replay Chart.js draw animations on analytics canvases
  requestAnimationFrame(() => {
    try {
      state.chartCategoryAnalytics?.update();
      state.chartDonutAnalytics?.update();
      chartTrends?.update();
    } catch (e) {}
  });
}

async function loadTrends(days = 7) {
  currentTrendsDays = days;
  setTrendsRangeButtons(days);

  try {
    const res = await apiFetch(`/dashboard/trends/?days=${days}`);
    if (!res.ok) return;
    const data = await res.json();
    renderTrends(data);
    if (state.activeTab === 'analytics') animateAnalyticsEntrance();
  } catch (err) {
    console.error('Failed to load trends:', err);
  }
}

function renderTrends(data) {
  const points = data.daily_points || [];

  const avgScore = data.avg_productivity_score ?? data.average_score;
  setEl('trendsAvgScore', (avgScore !== null && avgScore !== undefined) ? `${avgScore}%` : '—');

  const delta = data.delta_vs_prior ?? 0;
  const deltaBadge = qs('#trendsDeltaBadge');
  if (deltaBadge) {
    if (avgScore === null || avgScore === undefined) {
      deltaBadge.textContent = 'No data';
      deltaBadge.className = 'badge badge-neutral';
    } else if (delta > 0) {
      deltaBadge.textContent = `+${delta}% vs prior`;
      deltaBadge.className = 'badge badge-productive';
    } else if (delta < 0) {
      deltaBadge.textContent = `${delta}% vs prior`;
      deltaBadge.className = 'badge badge-danger';
    } else {
      deltaBadge.textContent = `Equal vs prior`;
      deltaBadge.className = 'badge badge-neutral';
    }
  }

  const totalProdSecs = data.total_productive_secs ?? points.reduce((acc, p) => acc + (p.productive_secs ?? Math.round((p.productive_hours || 0) * 3600)), 0);
  const totalDistSecs = data.total_distracted_secs ?? points.reduce((acc, p) => acc + (p.distracted_secs ?? Math.round((p.distracted_hours || 0) * 3600)), 0);
  const totalSwitches = data.total_switches ?? points.reduce((acc, p) => acc + (p.switches ?? p.switches_count ?? 0), 0);

  setEl('trendsTotalProd', formatDuration(totalProdSecs));
  setEl('trendsTotalDist', formatDuration(totalDistSecs));
  setEl('trendsTotalSwitches', totalSwitches.toLocaleString());

  if (typeof gsap !== 'undefined') {
    qsa('#analyticsMetrics .analytics-metric-value, #analyticsMetrics .analytics-metric-value-row').forEach((el) => {
      gsap.fromTo(el, { opacity: 0.35 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
    });
  }

  const canvas = qs('#trendsChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = points.map(p => {
    const d = new Date(p.date + 'T00:00:00');
    return d.toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
  });

  const prodHours = points.map(p => p.productive_hours ?? +(((p.productive_secs || 0) / 3600).toFixed(2)));
  const distHours = points.map(p => p.distracted_hours ?? +(((p.distracted_secs || 0) / 3600).toFixed(2)));
  const scoreData = points.map(p => p.productivity_score);

  if (chartTrends) {
    chartTrends.destroy();
    chartTrends = null;
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(250, 17, 79, 0.32)');
  gradient.addColorStop(1, 'rgba(250, 17, 79, 0)');

  chartTrends = new Chart(ctx, {
    data: {
      labels: labels,
      datasets: [
        {
          type: 'line',
          label: 'Productivity Score (%)',
          data: scoreData,
          borderColor: FITNESS_CHART.coral,
          backgroundColor: gradient,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: FITNESS_CHART.coral,
          pointBorderColor: '#0A0A0C',
          pointBorderWidth: 2,
          fill: true,
          yAxisID: 'yScore',
          tension: 0.4,
          spanGaps: true
        },
        {
          type: 'bar',
          label: 'Productive Hours',
          data: prodHours,
          backgroundColor: FITNESS_CHART.lime,
          hoverBackgroundColor: '#c8ff4d',
          borderRadius: 999,
          borderSkipped: false,
          barPercentage: 0.62,
          categoryPercentage: 0.7,
          maxBarThickness: 18,
          yAxisID: 'yHours'
        },
        {
          type: 'bar',
          label: 'Distracted Hours',
          data: distHours,
          backgroundColor: 'rgba(250, 17, 79, 0.55)',
          hoverBackgroundColor: FITNESS_CHART.coral,
          borderRadius: 999,
          borderSkipped: false,
          barPercentage: 0.62,
          categoryPercentage: 0.7,
          maxBarThickness: 18,
          yAxisID: 'yHours'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: {
        duration: 1300,
        easing: 'easeOutQuart',
        delay: (c) => {
          if (c.type === 'data' && c.datasetIndex === 0) return (c.dataIndex || 0) * 40;
          if (c.type === 'data') return 200 + (c.dataIndex || 0) * 35;
          return 0;
        }
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'circle',
            color: FITNESS_CHART.muted,
            font: { family: FITNESS_CHART.font, size: 11, weight: '600' },
            padding: 16
          }
        },
        tooltip: {
          backgroundColor: FITNESS_CHART.tooltipBg,
          titleColor: '#F7F2F3',
          bodyColor: FITNESS_CHART.muted,
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          padding: 12,
          boxPadding: 4,
          cornerRadius: 14,
          usePointStyle: true,
          titleFont: { family: FITNESS_CHART.font, weight: '700' },
          bodyFont: { family: FITNESS_CHART.font },
          callbacks: {
            label: (tip) => {
              if (tip.parsed.y === null || tip.parsed.y === undefined) return null;
              if (tip.dataset.yAxisID === 'yScore') {
                return ` Score: ${tip.parsed.y}%`;
              }
              return ` ${tip.dataset.label}: ${tip.parsed.y} hrs`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: FITNESS_CHART.muted, font: { family: FITNESS_CHART.font, size: 11, weight: '600' } }
        },
        yHours: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          title: {
            display: true,
            text: 'Hours',
            color: FITNESS_CHART.muted,
            font: { family: FITNESS_CHART.font, size: 11, weight: '600' }
          },
          grid: { color: FITNESS_CHART.grid },
          border: { display: false },
          ticks: { color: FITNESS_CHART.muted, font: { family: FITNESS_CHART.font } }
        },
        yScore: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 100,
          title: {
            display: true,
            text: 'Score %',
            color: FITNESS_CHART.muted,
            font: { family: FITNESS_CHART.font, size: 11, weight: '600' }
          },
          grid: { drawOnChartArea: false },
          border: { display: false },
          ticks: { color: FITNESS_CHART.muted, font: { family: FITNESS_CHART.font } }
        }
      }
    }
  });
}

// Wire Event Listeners for Sound, Break Reminders, and Trends
qs('#soundToggleBtn')?.addEventListener('click', toggleSoundMute);
qs('#btnTrends7')?.addEventListener('click', () => loadTrends(7));
qs('#btnTrends30')?.addEventListener('click', () => loadTrends(30));
qs('#startBreakTimerBtn')?.addEventListener('click', () => startBreakCountdown(300));
qs('#dismissBreakBtn')?.addEventListener('click', closeBreakReminderModal);

/* ═══════════════════════════════════════════════════════
   BLOCKLIST MANAGER (Custom Apps & Websites)
   ═══════════════════════════════════════════════════════ */
let blocklistState = {
  activeTab: 'apps',
  apps: [],
  domains: []
};

const DEFAULT_BLOCKLIST_APPS = [
  'discord.exe', 'slack.exe', 'teams.exe', 'zoom.exe',
  'spotify.exe', 'steam.exe', 'epicgameslauncher.exe',
  'telegram.exe', 'whatsapp.exe', 'imessage.exe',
  'fortniteclient-win64-shipping.exe', 'robloxplayerbeta.exe',
  'primevideo.exe', 'hulu.exe'
];

const DEFAULT_BLOCKLIST_DOMAINS = [
  'youtube.com', 'youtu.be', 'reddit.com', 'instagram.com',
  'tiktok.com', 'facebook.com', 'twitter.com', 'x.com',
  'netflix.com', 'twitch.tv', 'pinterest.com', 'snapchat.com',
  'primevideo.com', 'hulu.com', 'disneyplus.com', '9gag.com'
];

async function loadBlocklist() {
  try {
    const res = await apiFetch('/focus/blocklist/');
    if (res.ok) {
      const data = await res.json();
      blocklistState.apps = data.blocked_apps || [...DEFAULT_BLOCKLIST_APPS];
      blocklistState.domains = data.blocked_domains || [...DEFAULT_BLOCKLIST_DOMAINS];
      renderBlocklistUI();
      return;
    }
  } catch (e) {}
  blocklistState.apps = [...DEFAULT_BLOCKLIST_APPS];
  blocklistState.domains = [...DEFAULT_BLOCKLIST_DOMAINS];
  renderBlocklistUI();
}

function renderBlocklistUI() {
  setEl('blockedAppsCount', blocklistState.apps.length);
  setEl('blockedDomainsCount', blocklistState.domains.length);
  setEl('shieldAppsStat', String(blocklistState.apps.length));
  setEl('shieldDomainsStat', String(blocklistState.domains.length));
  setEl('shieldAppsBadge', `${blocklistState.apps.length} apps`);
  setEl('shieldDomainsBadge', `${blocklistState.domains.length} sites`);

  const sessionOn = !!(state.liveSession || state.activeSessionId) && !isBreakActive();
  setEl('shieldModeStat', sessionOn ? 'Armed' : 'Idle');
  setEl('shieldRingsCenter', sessionOn ? 'Armed' : 'Idle');
  const statusBadge = qs('#appBlockerStatusBadge');
  if (statusBadge) {
    statusBadge.textContent = sessionOn ? 'Armed' : 'Ready';
    statusBadge.className = `fs-status-pill ${sessionOn ? 'armed' : ''}`;
  }

  // Apple Fitness–style ring fill based on blocklist size / armed state
  const appsRing = qs('.fs-ring-apps');
  const sitesRing = qs('.fs-ring-sites');
  const modeRing = qs('.fs-ring-mode');
  const appsCirc = 415;
  const sitesCirc = 314;
  const modeCirc = 214;
  const appsPct = Math.min(1, (blocklistState.apps.length || 0) / 20);
  const sitesPct = Math.min(1, (blocklistState.domains.length || 0) / 20);
  if (appsRing) appsRing.style.strokeDashoffset = String(Math.round(appsCirc * (1 - Math.max(0.08, appsPct))));
  if (sitesRing) sitesRing.style.strokeDashoffset = String(Math.round(sitesCirc * (1 - Math.max(0.08, sitesPct))));
  if (modeRing) modeRing.style.strokeDashoffset = String(sessionOn ? Math.round(modeCirc * 0.12) : Math.round(modeCirc * 0.78));
  qs('#shieldActivityRings')?.classList.toggle('is-armed', sessionOn);

  const chipHtml = (items, icon, emptyMsg, removable) => {
    if (!items.length) return `<div class="empty-inline">${emptyMsg}</div>`;
    return items.map((item, idx) => `
      <div class="shield-chip">
        <span>${icon} ${htmlEsc(item)}</span>
        ${removable ? `<button type="button" onclick="${removable}(${idx})" title="Remove">✕</button>` : ''}
      </div>
    `).join('');
  };

  const appsContainer = qs('#blockedAppsContainer');
  if (appsContainer) {
    appsContainer.innerHTML = chipHtml(blocklistState.apps, '🖥️', 'No desktop apps blocked.', 'removeBlockedApp');
  }
  const domainsContainer = qs('#blockedDomainsContainer');
  if (domainsContainer) {
    domainsContainer.innerHTML = chipHtml(blocklistState.domains, '🌐', 'No websites blocked.', 'removeBlockedDomain');
  }

  const appsPreview = qs('#shieldAppsPreview');
  if (appsPreview) {
    appsPreview.innerHTML = chipHtml(blocklistState.apps, '🖥️', 'No apps blocked yet. Open the blocklist to add some.', null);
  }
  const domainsPreview = qs('#shieldDomainsPreview');
  if (domainsPreview) {
    domainsPreview.innerHTML = chipHtml(blocklistState.domains, '🌐', 'No websites blocked yet.', null);
  }

  if (typeof gsap !== 'undefined' && state.activeTab === 'blocker') {
    const chips = qsa('#shieldAppsPreview .shield-chip, #shieldDomainsPreview .shield-chip');
    if (chips.length) {
      gsap.fromTo(chips, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out' });
    }
  }
}

function animateShieldEntrance() {
  if (typeof gsap === 'undefined') return;
  const parts = [qs('#shieldHero'), qs('#shieldPanels'), qs('#shieldHowto')].filter(Boolean);
  gsap.fromTo(parts, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power3.out' });
}

function openBlocklistModal() {
  const modal = qs('#blocklistModal');
  if (modal) {
    modal.style.display = 'flex';
    loadBlocklist();
  }
}

function closeBlocklistModal() {
  const modal = qs('#blocklistModal');
  if (modal) modal.style.display = 'none';
}

function switchBlocklistTab(tab) {
  blocklistState.activeTab = tab;
  const btnApps = qs('#tabBtnBlockApps');
  const btnDomains = qs('#tabBtnBlockDomains');
  const paneApps = qs('#blocklistPaneApps');
  const paneDomains = qs('#blocklistPaneDomains');

  if (tab === 'apps') {
    btnApps?.classList.add('active');
    btnDomains?.classList.remove('active');
    if (paneApps) paneApps.style.display = 'flex';
    if (paneDomains) paneDomains.style.display = 'none';
  } else {
    btnDomains?.classList.add('active');
    btnApps?.classList.remove('active');
    if (paneApps) paneApps.style.display = 'none';
    if (paneDomains) paneDomains.style.display = 'flex';
  }
}

function addBlockedApp() {
  const input = qs('#newBlockedAppInput');
  let val = (input?.value || '').trim();
  if (!val) return;
  // Keep user-entered name as-is (Windows .exe or macOS app name)
  const key = val.toLowerCase();
  if (!blocklistState.apps.map(a => a.toLowerCase()).includes(key)) {
    blocklistState.apps.push(val);
    renderBlocklistUI();
    toast(`Added ${val} to blocked apps`, 'info');
  } else {
    toast(`${val} is already in the blocked list`, 'warning');
  }
  if (input) input.value = '';
}

function removeBlockedApp(idx) {
  if (idx >= 0 && idx < blocklistState.apps.length) {
    const removed = blocklistState.apps.splice(idx, 1)[0];
    renderBlocklistUI();
    toast(`Removed ${removed} from blocked apps`, 'info');
  }
}

function addBlockedDomain() {
  const input = qs('#newBlockedDomainInput');
  let val = (input?.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!val) return;
  if (!blocklistState.domains.includes(val)) {
    blocklistState.domains.push(val);
    renderBlocklistUI();
    toast(`Added ${val} to blocked websites`, 'info');
  } else {
    toast(`${val} is already in the blocked list`, 'warning');
  }
  if (input) input.value = '';
}

function removeBlockedDomain(idx) {
  if (idx >= 0 && idx < blocklistState.domains.length) {
    const removed = blocklistState.domains.splice(idx, 1)[0];
    renderBlocklistUI();
    toast(`Removed ${removed} from blocked websites`, 'info');
  }
}

async function saveBlocklist() {
  try {
    const res = await apiFetch('/focus/blocklist/', {
      method: 'POST',
      body: JSON.stringify({
        blocked_apps: blocklistState.apps,
        blocked_domains: blocklistState.domains
      })
    });
    if (res.ok) {
      toast('✅ Focus Shield blocklist saved and applied!', 'success');
      closeBlocklistModal();
    } else {
      toast('Failed to save blocklist', 'danger');
    }
  } catch (e) {
    console.error('Save blocklist error:', e);
    toast('Error saving blocklist', 'danger');
  }
}

function resetBlocklistDefaults() {
  blocklistState.apps = [...DEFAULT_BLOCKLIST_APPS];
  blocklistState.domains = [...DEFAULT_BLOCKLIST_DOMAINS];
  renderBlocklistUI();
  toast('Reset blocklist to defaults. Click "Save & Apply" to confirm.', 'info');
}

// Wire Event Listeners for Blocklist Manager
qs('#btnOpenBlocklistModal')?.addEventListener('click', openBlocklistModal);
qs('#testBlockerShieldBtn')?.addEventListener('click', () => {
  const armed = !!(state.liveSession || state.activeSessionId) && !isBreakActive();
  toast(armed
    ? 'Focus Shield is armed — blocking is active for this session.'
    : 'Focus Shield is ready — it arms when you start a focus session.', 'success');
});
qs('#closeBlocklistModalBtn')?.addEventListener('click', closeBlocklistModal);
qs('#btnCancelBlocklist')?.addEventListener('click', closeBlocklistModal);
qs('#tabBtnBlockApps')?.addEventListener('click', () => switchBlocklistTab('apps'));
qs('#tabBtnBlockDomains')?.addEventListener('click', () => switchBlocklistTab('domains'));
qs('#btnAddBlockedApp')?.addEventListener('click', addBlockedApp);
qs('#newBlockedAppInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockedApp(); });
qs('#btnAddBlockedDomain')?.addEventListener('click', addBlockedDomain);
qs('#newBlockedDomainInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBlockedDomain(); });
qs('#btnSaveBlocklist')?.addEventListener('click', saveBlocklist);
qs('#btnResetBlocklistDefaults')?.addEventListener('click', resetBlocklistDefaults);

/* ═══════════════════════════════════════════════════════
   GAMIFICATION: STREAKS, ACTIVITY HEATMAP & BADGES
   ═══════════════════════════════════════════════════════ */
let currentGamificationData = null;
let currentBadgeFilter = 'all';

async function fetchGamificationData() {
  try {
    const res = await apiFetch('/dashboard/gamification/');
    if (!res.ok) return;
    const data = await res.json();
    currentGamificationData = data;
    renderGamification(data);
  } catch (err) {
    if (err.message !== 'Unauthorized') console.error('Gamification fetch error:', err);
  }
}

function renderGamification(data) {
  if (!data) return;

  // 1. Topbar Flame Streak Pill
  const topbarCount = qs('#topbarStreakCount');
  if (topbarCount) {
    topbarCount.textContent = data.streaks?.current_streak ?? 0;
  }

  // 2. Hero Streak Stats
  const heroDays = qs('#streakHeroDays');
  if (heroDays) {
    heroDays.textContent = String(data.streaks?.current_streak ?? 0);
  }

  const heroSub = qs('#streakHeroMotivation') || qs('#streakHeroSub');
  if (heroSub) {
    const s = data.streaks;
    if (s?.is_active_today) {
      heroSub.textContent = "Active today — your streak is protected. Keep the chain going.";
    } else if ((s?.current_streak ?? 0) > 0) {
      heroSub.textContent = `Streak at risk — log focus today to keep your ${s.current_streak}-day chain.`;
    } else {
      heroSub.textContent = "Complete a focus sprint today to light your streak.";
    }
  }

  setEl('streakBestStat', `${data.streaks?.longest_streak ?? 0}d`);
  setEl('streakTotalDaysStat', `${data.streaks?.total_active_days ?? 0}`);

  const totalBadges = data.badges?.length ?? 0;
  const unlockedBadges = data.badges?.filter(b => b.unlocked).length ?? 0;
  setEl('streakBadgesStat', `${unlockedBadges}/${totalBadges}`);
  setEl('countUnlockedBadges', String(unlockedBadges));

  // 3. Activity Contribution Heatmap (14 weeks x 7 days)
  renderActivityHeatmap(data.heatmap);

  // 4. Badges Showcase
  renderBadgesShowcase();
  // 5. Keep Profile tab record/badges in sync
  renderProfileRecordAndBadges();

  animateAchievementsEntrance();
}

function animateAchievementsEntrance() {
  if (typeof gsap === 'undefined') return;
  const parts = [
    qs('#achStreakHero'),
    qs('#achHeatmapCard'),
    qs('#achBadgesCard'),
  ].filter(Boolean);
  if (!parts.length) return;
  gsap.fromTo(parts,
    { opacity: 0, y: 22 },
    { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power3.out' }
  );
}

function renderActivityHeatmap(heatmapDays) {
  const container = qs('#activityHeatmapContainer');
  if (!container || !heatmapDays || !heatmapDays.length) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const weeksCount = Math.ceil(heatmapDays.length / 7);
  let weeksHtml = '';

  let totalActiveDays = 0;
  let totalProductiveMins = 0;
  let totalSessions = 0;

  for (let w = 0; w < weeksCount; w++) {
    const weekSlice = heatmapDays.slice(w * 7, (w + 1) * 7);
    let cellsHtml = '';
    for (const day of weekSlice) {
      if (day.level > 0 || day.sessions_count > 0 || day.productive_mins > 0) {
        totalActiveDays++;
        totalProductiveMins += (day.productive_mins || 0);
        totalSessions += (day.sessions_count || 0);
      }
      const isToday = (day.date === todayStr) ? 'is-today' : '';
      const isFuture = day.is_future ? 'is-future' : '';
      const levelClass = `level-${day.level}`;
      const title = day.is_future
        ? `${day.date} (Upcoming)`
        : `${day.date} (${day.day_of_week}): ${day.productive_mins}m focus · ${day.sessions_count} session${day.sessions_count === 1 ? '' : 's'}`;
      cellsHtml += `<div class="heatmap-cell ${levelClass} ${isToday} ${isFuture}" title="${title}" data-date="${day.date}"></div>`;
    }
    weeksHtml += `<div class="heatmap-week">${cellsHtml}</div>`;
  }

  const weekdayLabelsHtml = `
    <div style="display:flex; flex-direction:column; gap:4px; margin-right:8px; font-size:10px; font-weight:600; color:var(--text-400); justify-content:space-between; height:118px; padding-top:2px;">
      <span>Mon</span>
      <span>Wed</span>
      <span>Fri</span>
    </div>
  `;

  const totalHours = (totalProductiveMins / 60).toFixed(1);
  const summaryHtml = `
    <div style="margin-top:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; font-size:12px; color:var(--text-500); border-top:1px solid var(--border-200); padding-top:10px;">
      <div>
        <strong style="color:var(--text-800);">${totalActiveDays} active day${totalActiveDays === 1 ? '' : 's'}</strong> in the last 14 weeks · <strong style="color:var(--brand-600);">${totalHours}h</strong> total focused time · <strong style="color:var(--color-success);">${totalSessions} sessions</strong> recorded
      </div>
      <div style="font-size:11px; color:var(--text-400);">
        Hover over any cell to inspect focus intensity
      </div>
    </div>
  `;

  container.innerHTML = `
    <div style="display:flex; align-items:center;">
      ${weekdayLabelsHtml}
      <div class="heatmap-grid">${weeksHtml}</div>
    </div>
    ${summaryHtml}
  `;
}

function setBadgesFilter(filter) {
  currentBadgeFilter = filter;
  qsa('.ach-filter-btn').forEach(btn => btn.classList.remove('active'));
  const map = {
    all: qs('#filterBadgeAll'),
    unlocked: qs('#filterBadgeUnlocked'),
    locked: qs('#filterBadgeLocked'),
  };
  map[filter]?.classList.add('active');
  // legacy class support
  qs('#filterBadgeAll')?.classList.toggle('active', filter === 'all');
  qs('#filterBadgeUnlocked')?.classList.toggle('active', filter === 'unlocked');
  qs('#filterBadgeLocked')?.classList.toggle('active', filter === 'locked');
  renderBadgesShowcase();
}

function getBadgeArtwork(badgeId, tier, emoji) {
  const artworks = {
    first_sprint: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_fs_ring" x1="8" y1="8" x2="56" y2="56">
            <stop offset="0%" stop-color="#67e8f9"/><stop offset="50%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#164e63"/>
          </linearGradient>
          <radialGradient id="n_fs_core" cx="50%" cy="42%" r="55%">
            <stop offset="0%" stop-color="#ecfeff"/><stop offset="55%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#0e7490"/>
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#n_fs_ring)"/>
        <circle cx="32" cy="32" r="23" fill="#042f2e"/>
        <circle cx="32" cy="32" r="16" fill="url(#n_fs_core)"/>
        <path d="M32 18 L36 30 L48 30 L38 38 L42 50 L32 42 L22 50 L26 38 L16 30 L28 30 Z" fill="#ecfeff" opacity="0.95"/>
        <circle cx="32" cy="32" r="3" fill="#083344"/>
      </svg>`,

    streak_3: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_s3_bg" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fdba74"/><stop offset="100%" stop-color="#c2410c"/>
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#n_s3_bg)"/>
        <rect x="10" y="10" width="44" height="44" rx="12" fill="#1c0a04"/>
        <circle cx="18" cy="32" r="6" fill="#fb923c"/>
        <circle cx="32" cy="32" r="7.5" fill="#fdba74"/>
        <circle cx="46" cy="32" r="6" fill="#fb923c"/>
        <path d="M18 32 H46" stroke="#fff7ed" stroke-width="2.5" stroke-linecap="round" opacity="0.7"/>
        <circle cx="32" cy="32" r="2.5" fill="#7c2d12"/>
      </svg>`,

    streak_7: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_s7_metal" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#e2e8f0"/><stop offset="45%" stop-color="#64748b"/><stop offset="100%" stop-color="#1e293b"/>
          </linearGradient>
          <linearGradient id="n_s7_orbit" x1="12" y1="12" x2="52" y2="52">
            <stop offset="0%" stop-color="#7dd3fc"/><stop offset="100%" stop-color="#0284c7"/>
          </linearGradient>
        </defs>
        <polygon points="32,4 58,18 58,46 32,60 6,46 6,18" fill="url(#n_s7_metal)"/>
        <polygon points="32,9 53,20 53,44 32,55 11,44 11,20" fill="#0b1220"/>
        <ellipse cx="32" cy="32" rx="16" ry="10" stroke="url(#n_s7_orbit)" stroke-width="2.2" fill="none"/>
        <circle cx="32" cy="32" r="5" fill="#38bdf8"/>
        <circle cx="48" cy="28" r="3" fill="#e0f2fe"/>
        <circle cx="16" cy="36" r="2.2" fill="#7dd3fc"/>
      </svg>`,

    streak_30: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_s30_gold" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fef08a"/><stop offset="40%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#92400e"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#n_s30_gold)"/>
        <circle cx="32" cy="32" r="22" fill="#292524"/>
        <path d="M14 40 L24 22 L32 34 L40 18 L50 40 Z" fill="#fbbf24"/>
        <path d="M14 40 H50" stroke="#fef3c7" stroke-width="2"/>
        <circle cx="32" cy="14" r="3" fill="#fef9c3"/>
        <text x="32" y="48" text-anchor="middle" font-size="9" font-weight="800" fill="#fde68a" font-family="system-ui,sans-serif">30</text>
      </svg>`,

    zero_drift: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_zd_rim" x1="8" y1="4" x2="56" y2="60">
            <stop offset="0%" stop-color="#a7f3d0"/><stop offset="100%" stop-color="#047857"/>
          </linearGradient>
        </defs>
        <path d="M32 5 L54 14 V31 C54 44 44 54 32 58 C20 54 10 44 10 31 V14 Z" fill="url(#n_zd_rim)"/>
        <path d="M32 10 L49 17 V31 C49 41 41 50 32 53 C23 50 15 41 15 31 V17 Z" fill="#022c22"/>
        <circle cx="32" cy="30" r="11" stroke="#34d399" stroke-width="2.5" fill="none"/>
        <path d="M26 30 L30 34 L39 24" stroke="#ecfdf5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`,

    deep_diver: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="n_dd_sea" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stop-color="#38bdf8"/><stop offset="55%" stop-color="#1d4ed8"/><stop offset="100%" stop-color="#020617"/>
          </radialGradient>
          <linearGradient id="n_dd_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#fde047"/><stop offset="100%" stop-color="#b45309"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="34" r="24" fill="url(#n_dd_rim)"/>
        <circle cx="32" cy="34" r="19" fill="url(#n_dd_sea)"/>
        <path d="M20 28 Q32 22 44 28" stroke="#7dd3fc" stroke-width="1.6" fill="none" opacity="0.7"/>
        <path d="M18 36 Q32 30 46 36" stroke="#93c5fd" stroke-width="1.6" fill="none" opacity="0.55"/>
        <path d="M22 44 Q32 38 42 44" stroke="#60a5fa" stroke-width="1.4" fill="none" opacity="0.4"/>
        <circle cx="32" cy="40" r="3.5" fill="#fef08a"/>
        <rect x="29" y="6" width="6" height="8" rx="2" fill="url(#n_dd_rim)"/>
      </svg>`,

    early_bird: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_eb_sky" x1="32" y1="8" x2="32" y2="48">
            <stop offset="0%" stop-color="#fda4af"/><stop offset="45%" stop-color="#fdba74"/><stop offset="100%" stop-color="#fef08a"/>
          </linearGradient>
          <linearGradient id="n_eb_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#ffedd5"/><stop offset="100%" stop-color="#9a3412"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#n_eb_rim)"/>
        <circle cx="32" cy="32" r="23" fill="#1c0a04"/>
        <path d="M11 36 C14 20 24 12 32 12 C40 12 50 20 53 36 Z" fill="url(#n_eb_sky)"/>
        <circle cx="32" cy="30" r="8" fill="#fef08a"/>
        <path d="M12 42 L26 34 L32 42 L40 30 L52 42 Z" fill="#78350f"/>
        <path d="M12 42 H52" stroke="#fbbf24" stroke-width="1.5"/>
      </svg>`,

    night_owl: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_no_rim" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#c4b5fd"/><stop offset="55%" stop-color="#6d28d9"/><stop offset="100%" stop-color="#1e1b4b"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#n_no_rim)"/>
        <circle cx="32" cy="32" r="23" fill="#0b0618"/>
        <path d="M40 14 C28 15 20 25 22 37 C24 47 34 52 44 48 C36 48 30 41 31 32 C32 22 37 16 44 15 C43 14 41 14 40 14 Z" fill="#fde68a"/>
        <circle cx="24" cy="34" r="7" fill="#312e81"/>
        <circle cx="21.5" cy="33" r="2" fill="#fde047"/>
        <circle cx="26.5" cy="33" r="2" fill="#fde047"/>
        <circle cx="16" cy="18" r="1.2" fill="#fff"/>
        <circle cx="48" cy="22" r="1" fill="#e9d5ff"/>
        <circle cx="50" cy="40" r="1.4" fill="#fff"/>
      </svg>`,

    century_club: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_cc_plat" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#f8fafc"/><stop offset="40%" stop-color="#94a3b8"/><stop offset="100%" stop-color="#334155"/>
          </linearGradient>
          <linearGradient id="n_cc_gem" x1="32" y1="12" x2="32" y2="28">
            <stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#0ea5e9"/>
          </linearGradient>
        </defs>
        <rect x="8" y="8" width="48" height="48" rx="14" fill="url(#n_cc_plat)"/>
        <rect x="12" y="12" width="40" height="40" rx="10" fill="#0f172a"/>
        <polygon points="32,14 40,20 32,28 24,20" fill="url(#n_cc_gem)"/>
        <text x="32" y="44" text-anchor="middle" font-size="14" font-weight="900" fill="#f1f5f9" font-family="system-ui,sans-serif">100</text>
        <text x="32" y="52" text-anchor="middle" font-size="6" font-weight="700" fill="#38bdf8" font-family="system-ui,sans-serif" letter-spacing="1">MINS</text>
      </svg>`,

    grandmaster: `
      <svg viewBox="0 0 64 64" width="88" height="88" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="n_gm_arc" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stop-color="#67e8f9"/><stop offset="35%" stop-color="#818cf8"/><stop offset="70%" stop-color="#e879f9"/><stop offset="100%" stop-color="#fb7185"/>
          </linearGradient>
          <linearGradient id="n_gm_crown" x1="32" y1="16" x2="32" y2="46">
            <stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#38bdf8"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" stroke="url(#n_gm_arc)" stroke-width="4" fill="#030712"/>
        <circle cx="32" cy="32" r="20" stroke="#38bdf8" stroke-width="1.2" stroke-dasharray="3 3" opacity="0.7" fill="none"/>
        <path d="M16 42 L18 24 L26 34 L32 16 L38 34 L46 24 L48 42 Z" fill="url(#n_gm_crown)"/>
        <rect x="16" y="42" width="32" height="4" rx="1.5" fill="#67e8f9"/>
        <circle cx="32" cy="16" r="2.5" fill="#fff"/>
      </svg>`,
  };

  return artworks[badgeId] || `<span style="font-size:40px;">${emoji || '🏆'}</span>`;
}

function renderBadgesShowcase() {
  const container = qs('#badgesGridContainer');
  if (!container || !currentGamificationData) return;

  const allBadges = currentGamificationData.badges || [];
  const unlockedCount = allBadges.filter(b => b.unlocked).length;
  setEl('countUnlockedBadges', String(unlockedCount));

  const filtered = allBadges.filter(b => {
    if (currentBadgeFilter === 'unlocked') return b.unlocked;
    if (currentBadgeFilter === 'locked') return !b.unlocked;
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `<div class="empty" style="grid-column: 1 / -1;">
      <div class="empty-icon">🏅</div>
      <div class="empty-title">No awards in this view</div>
      <div class="empty-desc">Complete more focus sessions to earn Fitness-style medals.</div>
    </div>`;
    return;
  }

  const tierAccent = {
    bronze: 'coral',
    silver: 'cyan',
    gold: 'lime',
    diamond: 'tri',
  };

  container.innerHTML = filtered.map(b => {
    const statusClass = b.unlocked ? 'unlocked' : 'locked';
    const tier = (b.tier || 'bronze').toLowerCase();
    const tierClass = `tier-${tier}`;
    const accent = tierAccent[tier] || 'coral';
    const artworkSvg = getBadgeArtwork(b.id, b.tier, b.icon);
    const pct = Math.max(0, Math.min(100, Number(b.progress_pct) || 0));

    let footerHtml = '';
    if (b.unlocked) {
      footerHtml = `
        <div class="fitness-award-footer earned">
          <span class="fitness-check" aria-hidden="true">✓</span>
          <span>Earned · ${htmlEsc(b.progress_label)}</span>
        </div>
      `;
    } else {
      footerHtml = `
        <div class="fitness-award-footer">
          <div class="fitness-rings-bar accent-${accent}" aria-hidden="true">
            <span class="ring-track coral"><i style="width:${pct}%"></i></span>
            <span class="ring-track lime"><i style="width:${Math.max(0, pct - 8)}%"></i></span>
            <span class="ring-track cyan"><i style="width:${Math.max(0, pct - 16)}%"></i></span>
          </div>
          <div class="badge-progress-meta">
            <span>${htmlEsc(b.progress_label)}</span>
            <span>${pct}%</span>
          </div>
        </div>
      `;
    }

    return `
      <article class="badge-card emblem-card fitness-award-card ${statusClass} ${tierClass}">
        <div class="fitness-medal-stage">
          <div class="fitness-medal-glow"></div>
          <div class="badge-icon-wrap emblem-orb fitness-medal">${artworkSvg}</div>
          ${b.unlocked ? '' : '<div class="fitness-lock" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>'}
        </div>
        <div class="fitness-award-body">
          <span class="fitness-tier-pill ${tier}">${htmlEsc(b.tier || 'Award')}</span>
          <h3 class="badge-name">${htmlEsc(b.name || b.title)}</h3>
          <p class="badge-desc">${htmlEsc(b.description)}</p>
          ${footerHtml}
        </div>
      </article>
    `;
  }).join('');

  if (typeof gsap !== 'undefined') {
    const cards = container.querySelectorAll('.fitness-award-card');
    gsap.fromTo(cards,
      { opacity: 0, y: 18, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, stagger: 0.05, ease: 'power2.out' }
    );
  }
}

// Wire Gamification Event Listeners
qs('#topbarStreakWidget')?.addEventListener('click', () => switchTab('achievements'));
qs('#filterBadgeAll')?.addEventListener('click', () => setBadgesFilter('all'));
qs('#filterBadgeUnlocked')?.addEventListener('click', () => setBadgesFilter('unlocked'));
qs('#filterBadgeLocked')?.addEventListener('click', () => setBadgesFilter('locked'));

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */
function initApp() {
  hideLogin();
  moveAnalyticsPanels();
  updateSoundToggleUI();

  qsa('.activity-filter-btn').forEach(btn => {
    btn.onclick = () => {
      qsa('.activity-filter-btn').forEach(b => {
        b.classList.remove('active', 'btn-primary');
        b.classList.add('btn-secondary');
      });
      btn.classList.add('active', 'btn-primary');
      btn.classList.remove('btn-secondary');
      state.activityFilter = btn.dataset.filter || 'all';
      filterAndRenderActivityTable();
    };
  });

  const u = state.username || 'User';
  setEl('userAvatar', u.charAt(0).toUpperCase());
  setEl('sidebarUsername', u);
  try {
    switchTab('dashboard');
    fetchSwitches();
    fetchSystemData();
    fetchTelemetry();
    loadTrends(7);
  } catch (e) {
    console.error('Error switching tab or prefetching data:', e);
  }
  try {
    fetchGamificationData();
  } catch (e) {
    console.error('Gamification fetch error:', e);
  }
  try {
    startPoll();
  } catch (e) {
    console.error('Polling start error:', e);
  }

  try {
    initBreakTool();
  } catch (e) {
    console.error('Break tool init error:', e);
  }

  window.addEventListener('focusguard-extension-ready', () => {
    updateExtensionStatusUI(true);
  });
  window.addEventListener('focusguard-extension-disconnected', () => {
    updateExtensionStatusUI(false);
    clearStaleExtensionHeartbeat();
  });

  // Reflect connect/disconnect if page attribute flips
  const extAttrObserver = new MutationObserver(() => {
    const attr = document.documentElement.getAttribute('data-focusguard-extension');
    if (attr === 'disconnected') {
      updateExtensionStatusUI(false);
      clearStaleExtensionHeartbeat();
    } else if (attr === 'connected') {
      updateExtensionStatusUI(true);
    }
  });
  extAttrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-focusguard-extension'] });

  // Initial sync from current attribute (don't wait for next poll)
  updateExtensionStatusUI(resolveExtensionConnected(false));
  if (!resolveExtensionConnected(false)) clearStaleExtensionHeartbeat();

  if (typeof window.fgRefreshUIInteractions === 'function') {
    window.fgRefreshUIInteractions();
  }
}

function moveAnalyticsPanels() {
  const destination = qs('#analyticsContent');
  const trends = qs('#analyticsTrends');
  if (!destination) return;
  if (trends && trends.parentElement !== destination) destination.appendChild(trends);
}

document.addEventListener('DOMContentLoaded', () => {
  initPasswordToggles();
  consumeGoogleRedirectTokens();
  loadToken();
  if (state.token) {
    hideLogin();
    initApp();
  } else {
    showLogin();
  }
});

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function val(id) { return (qs(`#${id}`) || {}).value || ''; }
function setEl(id, text) {
  const el = qs(`#${id}`);
  if (el) {
    const s = String(text ?? '');
    if (el.textContent !== s) {
      el.textContent = s;
    }
  }
}
function htmlEsc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function faviconImg(domain) {
  if (!domain) return '';
  return `<img class="domain-favicon" src="https://www.google.com/s2/favicons?sz=16&domain=${encodeURIComponent(domain)}" alt="" onerror="this.style.display='none'">`;
}

function emptyRow(cols, icon, title, desc) {
  return `<tr><td colspan="${cols}"><div class="empty">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
  </div></td></tr>`;
}

window.showAuthTab = showAuthTab;
window.scrollToAuth = scrollToAuth;
window.switchTab = switchTab;
window.deleteGoal = deleteGoal;
window.startFocusSession = startFocusSession;
window.endFocusSession = endFocusSession;
window.openAIReportModal = openAIReportModal;
window.loadDateReport = loadDateReport;
window.deleteDateData = deleteDateData;
window.loadTrends = loadTrends;
window.playChime = playChime;
window.toggleSoundMute = toggleSoundMute;
window.showBreakReminderModal = showBreakReminderModal;
window.closeBreakReminderModal = closeBreakReminderModal;
window.openBlocklistModal = openBlocklistModal;
window.closeBlocklistModal = closeBlocklistModal;
window.removeBlockedApp = removeBlockedApp;
window.removeBlockedDomain = removeBlockedDomain;
window.fetchGamificationData = fetchGamificationData;
window.setBadgesFilter = setBadgesFilter;

