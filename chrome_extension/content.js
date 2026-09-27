// FocusGuard content script — Focus Shield + web-app status sync
let lastUserInteraction = Date.now();
let trackingActive = false;
let shieldTimer = null;

function markActive() {
  if (!trackingActive) return;
  lastUserInteraction = Date.now();
}

window.addEventListener("mousemove", markActive, { passive: true });
window.addEventListener("keydown", markActive, { passive: true });
window.addEventListener("scroll", markActive, { passive: true });
window.addEventListener("click", markActive, { passive: true });

function isExtensionLinked(stored) {
  return !!stored.jwtAccessToken
    && stored.manuallyDisconnected !== true
    && stored.trackingEnabled !== false
    && stored.extensionLinked === true;
}

async function refreshTrackingActive() {
  try {
    const stored = await chrome.storage.local.get([
      "manuallyDisconnected",
      "jwtAccessToken",
      "trackingEnabled",
      "extensionLinked"
    ]);
    trackingActive = isExtensionLinked(stored);
  } catch (e) {
    trackingActive = false;
  }
  return trackingActive;
}

function stopAllDetection() {
  trackingActive = false;
  removeShieldOverlay();
  if (shieldTimer) {
    clearInterval(shieldTimer);
    shieldTimer = null;
  }
}

function startShieldPolling() {
  if (shieldTimer) return;
  evaluateFocusShield();
  shieldTimer = setInterval(evaluateFocusShield, 4000);
}

// ── Web app status attribute (dashboard Connected / Disconnected) ──
if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
  function publishExtensionStatus(connected) {
    try {
      document.documentElement.setAttribute(
        "data-focusguard-extension",
        connected ? "connected" : "disconnected"
      );
      window.dispatchEvent(new CustomEvent(
        connected ? "focusguard-extension-ready" : "focusguard-extension-disconnected"
      ));
    } catch (e) {}
  }

  function syncAuthAndSessionFromPage() {
    try {
      chrome.storage.local.get(
        ["manuallyDisconnected", "jwtAccessToken", "trackingEnabled", "extensionLinked"],
        (stored) => {
          const connected = isExtensionLinked(stored);
          trackingActive = connected;
          publishExtensionStatus(connected);

          if (!connected) {
            stopAllDetection();
            return;
          }

          const token = localStorage.getItem("focusguard_access_token") || localStorage.getItem("fg_token");
          const refresh = localStorage.getItem("focusguard_refresh_token") || localStorage.getItem("fg_refresh");
          if (token) {
            chrome.runtime.sendMessage({
              type: "SYNC_AUTH_TOKEN",
              token: token,
              refresh: refresh || ""
            }).catch(() => {});
          }

          const activeVal = localStorage.getItem("focusguard_session_active");
          const onBreak = localStorage.getItem("focusguard_on_break") === "true";
          chrome.runtime.sendMessage({
            type: "SET_SESSION_STATUS",
            active: activeVal === "true" && !onBreak,
            onBreak: onBreak
          }).catch(() => {});
        }
      );
    } catch (e) {
      publishExtensionStatus(false);
      stopAllDetection();
    }
  }

  publishExtensionStatus(false);
  syncAuthAndSessionFromPage();
  setInterval(syncAuthAndSessionFromPage, 2000);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
      changes.jwtAccessToken
      || changes.manuallyDisconnected
      || changes.trackingEnabled
      || changes.extensionLinked
    ) {
      syncAuthAndSessionFromPage();
    }
  });
}

// ═══════════════════════════════════════════════════════
// FOCUS SHIELD OVERLAY — black theme
// ═══════════════════════════════════════════════════════
const SHIELD_OVERLAY_ID = "focusguard-shield-root";

function removeShieldOverlay() {
  const existing = document.getElementById(SHIELD_OVERLAY_ID);
  if (existing) existing.remove();
}

function injectShieldOverlay(info) {
  if (!trackingActive) return;
  if (document.getElementById(SHIELD_OVERLAY_ID)) return;

  const hostname = window.location.hostname;
  const category = (info.category || "Distraction").toString().toUpperCase();
  const overlay = document.createElement("div");
  overlay.id = SHIELD_OVERLAY_ID;
  overlay.innerHTML = `
    <style>
      #${SHIELD_OVERLAY_ID} {
        position: fixed !important;
        inset: 0 !important;
        background:
          radial-gradient(ellipse 70% 50% at 50% 40%, rgba(40,40,40,0.45) 0%, transparent 60%),
          #000000 !important;
        backdrop-filter: blur(14px) !important;
        -webkit-backdrop-filter: blur(14px) !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        color: #f5f5f5 !important;
        box-sizing: border-box !important;
        animation: fgShieldFadeIn 0.28s ease !important;
      }
      @keyframes fgShieldFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .fg-shield-card {
        background: #0a0a0a !important;
        border: 1px solid #1f1f1f !important;
        box-shadow: 0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04) !important;
        border-radius: 18px !important;
        padding: 40px 36px !important;
        max-width: 440px !important;
        width: 92% !important;
        text-align: center !important;
        box-sizing: border-box !important;
      }
      .fg-shield-icon-wrap {
        width: 56px !important;
        height: 56px !important;
        margin: 0 auto 18px !important;
        background: #141414 !important;
        border: 1px solid #2a2a2a !important;
        border-radius: 14px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .fg-shield-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: #1a0808 !important;
        border: 1px solid #3d1515 !important;
        color: #f87171 !important;
        padding: 5px 12px !important;
        border-radius: 999px !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        letter-spacing: 0.6px !important;
        text-transform: uppercase !important;
        margin-bottom: 16px !important;
      }
      .fg-shield-title {
        font-size: 24px !important;
        font-weight: 800 !important;
        color: #ffffff !important;
        margin: 0 0 10px 0 !important;
        line-height: 1.2 !important;
        letter-spacing: -0.5px !important;
      }
      .fg-shield-desc {
        font-size: 13.5px !important;
        line-height: 1.65 !important;
        color: #a3a3a3 !important;
        margin: 0 0 28px 0 !important;
      }
      .fg-shield-domain {
        color: #e5e5e5 !important;
        font-weight: 700 !important;
        background: #171717 !important;
        border: 1px solid #2a2a2a !important;
        padding: 2px 8px !important;
        border-radius: 6px !important;
      }
      .fg-shield-cat {
        color: #737373 !important;
        font-weight: 600 !important;
        letter-spacing: 0.3px !important;
      }
      .fg-shield-actions {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }
      .fg-shield-btn-primary {
        background: #ffffff !important;
        color: #0a0a0a !important;
        border: none !important;
        padding: 13px 18px !important;
        border-radius: 10px !important;
        font-size: 13.5px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        font-family: inherit !important;
        transition: background 0.15s ease, transform 0.15s ease !important;
      }
      .fg-shield-btn-primary:hover {
        background: #e5e5e5 !important;
        transform: translateY(-1px) !important;
      }
      .fg-shield-btn-secondary {
        background: transparent !important;
        color: #a3a3a3 !important;
        border: 1px solid #262626 !important;
        padding: 12px 18px !important;
        border-radius: 10px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        font-family: inherit !important;
        transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease !important;
      }
      .fg-shield-btn-secondary:hover {
        background: #111111 !important;
        border-color: #404040 !important;
        color: #e5e5e5 !important;
      }
    </style>
    <div class="fg-shield-card">
      <div class="fg-shield-icon-wrap">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f5f5f5" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <circle cx="12" cy="11" r="3"/>
        </svg>
      </div>
      <div class="fg-shield-badge">Focus Shield Active</div>
      <h2 class="fg-shield-title">Deep Focus In Progress</h2>
      <p class="fg-shield-desc">
        Access to <span class="fg-shield-domain">${hostname}</span>
        <span class="fg-shield-cat">(${category})</span> is shielded to keep your attention uninterrupted.
      </p>
      <div class="fg-shield-actions">
        <button class="fg-shield-btn-primary" id="fgReturnHomeBtn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/></svg>
          Return to FocusGuard Dashboard
        </button>
        <button class="fg-shield-btn-secondary" id="fgEmergencyBreakBtn">
          Take 2-Minute Emergency Override
        </button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlay);

  document.getElementById("fgReturnHomeBtn")?.addEventListener("click", () => {
    window.location.href = "http://127.0.0.1:8000/";
  });

  document.getElementById("fgEmergencyBreakBtn")?.addEventListener("click", () => {
    const snoozeUntil = Date.now() + 2 * 60 * 1000;
    try {
      sessionStorage.setItem("fg_shield_snooze_" + hostname, String(snoozeUntil));
    } catch (e) {}
    removeShieldOverlay();
  });
}

function evaluateFocusShield() {
  if (!trackingActive) {
    removeShieldOverlay();
    return;
  }

  const hostname = window.location.hostname;
  if (hostname === "127.0.0.1" || hostname === "localhost") return;

  const snoozeUntil = sessionStorage.getItem("fg_shield_snooze_" + hostname);
  if (snoozeUntil && Date.now() < parseInt(snoozeUntil, 10)) {
    return;
  }

  let title = document.title;
  let channel = "";
  if (hostname.includes("youtube.com")) {
    const ytm = getYouTubeMetadata();
    if (ytm) {
      title = ytm.title;
      channel = ytm.channel;
    }
  }

  chrome.runtime.sendMessage({
    type: "CHECK_SHIELD_STATUS",
    url: window.location.href,
    title: title,
    channel: channel
  }, (res) => {
    if (chrome.runtime.lastError) return;
    if (!trackingActive) {
      removeShieldOverlay();
      return;
    }
    if (res && res.shouldBlock) {
      injectShieldOverlay(res);
    } else {
      removeShieldOverlay();
    }
  });
}

function getYouTubeMetadata() {
  if (!window.location.hostname.includes("youtube.com")) return null;

  let title = document.title;
  const titleElem = document.querySelector("h1.ytd-watch-metadata yt-formatted-string") || document.querySelector("#title h1");
  if (titleElem && titleElem.textContent) {
    title = titleElem.textContent.trim();
  }

  let channel = "";
  const channelElem = document.querySelector("#channel-name a") || document.querySelector("ytd-channel-name a");
  if (channelElem && channelElem.textContent) {
    channel = channelElem.textContent.trim();
  }

  return {
    url: window.location.href,
    title: title,
    channel: channel
  };
}

function emitYouTubeNav() {
  if (!trackingActive) return;
  const meta = getYouTubeMetadata();
  if (!meta) return;
  chrome.runtime.sendMessage({
    type: "YOUTUBE_NAVIGATED",
    data: meta
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRACKING_DISABLED" || message.type === "FORCE_DISCONNECT") {
    stopAllDetection();
    if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
      try {
        document.documentElement.setAttribute("data-focusguard-extension", "disconnected");
        window.dispatchEvent(new CustomEvent("focusguard-extension-disconnected"));
      } catch (e) {}
    }
  }
  if (message.type === "TRACKING_ENABLED") {
    refreshTrackingActive().then((on) => {
      if (on) startShieldPolling();
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.jwtAccessToken
    || changes.manuallyDisconnected
    || changes.trackingEnabled
    || changes.extensionLinked
  ) {
    refreshTrackingActive().then((on) => {
      if (!on) stopAllDetection();
      else startShieldPolling();
    });
  }
});

window.addEventListener("yt-navigate-finish", () => {
  setTimeout(() => {
    emitYouTubeNav();
    evaluateFocusShield();
  }, 1000);
});

refreshTrackingActive().then((on) => {
  if (on) {
    startShieldPolling();
    if (window.location.hostname.includes("youtube.com")) {
      setTimeout(() => {
        emitYouTubeNav();
        evaluateFocusShield();
      }, 1500);
    }
  } else {
    stopAllDetection();
  }
});
