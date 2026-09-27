importScripts("classifiers/url_classifier.js", "api_client.js");

let activeTabId = null;
let currentDomain = null;
let currentUrl = null;
let currentTitle = null;
let currentChannel = null;
let currentCategory = null;
let tabStartTime = Date.now();
let isUserIdle = false;
let trackingEnabled = false;

async function refreshTrackingFlag() {
  const r = await chrome.storage.local.get([
    "jwtAccessToken",
    "manuallyDisconnected",
    "trackingEnabled",
    "extensionLinked"
  ]);
  trackingEnabled = !!r.jwtAccessToken
    && r.manuallyDisconnected !== true
    && r.trackingEnabled !== false
    && r.extensionLinked === true;
  return trackingEnabled;
}

async function sendExtensionHeartbeat() {
  if (!(await refreshTrackingFlag())) return;
  try {
    await authenticatedFetch("/auth/extension/heartbeat/", { method: "POST" });
  } catch (e) {}
}

async function clearExtensionServerStatus() {
  try {
    const token = await getAuthToken();
    if (!token) return;
    await authenticatedFetch("/auth/extension/status/clear/", { method: "POST" });
  } catch (e) {}
}

async function broadcastToTabs(message) {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(
      tabs.map((tab) => {
        if (!tab.id) return Promise.resolve();
        return chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      })
    );
  } catch (e) {}
}

async function hardStopTracking() {
  trackingEnabled = false;
  isSessionActive = false;
  currentDomain = null;
  currentUrl = null;
  currentTitle = null;
  currentChannel = null;
  await chrome.storage.local.set({
    trackingEnabled: false,
    isSessionActive: false
  });
  await clearExtensionServerStatus();
  await broadcastToTabs({ type: "TRACKING_DISABLED" });
}

refreshTrackingFlag().then((on) => {
  if (on) sendExtensionHeartbeat();
}).catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes.jwtAccessToken
    || changes.manuallyDisconnected
    || changes.trackingEnabled
    || changes.extensionLinked
  ) {
    refreshTrackingFlag().then((on) => {
      if (on) sendExtensionHeartbeat();
      else clearExtensionServerStatus();
    });
  }
});

// Keep dashboard "Connected" only while the collector is actually linked
setInterval(() => {
  if (trackingEnabled) sendExtensionHeartbeat();
}, 20000);

function isInternalOrSystemUrl(url, domain) {
  if (!url || !domain) return true;
  if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("chrome-extension://") || url.startsWith("about:")) return true;
  return false;
}

function initActiveTab() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url) {
        activeTabId = tabs[0].id;
        currentUrl = tabs[0].url;
        currentDomain = extractDomain(tabs[0].url);
        currentTitle = tabs[0].title;
        tabStartTime = Date.now();
      }
    });
  } catch (e) {}
}
initActiveTab();

function recordCurrentTabDuration() {
  if (!trackingEnabled) return null;

  if (isInternalOrSystemUrl(currentUrl, currentDomain)) {
    return null;
  }

  const durationSecs = Math.round((Date.now() - tabStartTime) / 1000);
  if (durationSecs < 1) return null;

  const classification = classifyDomain(currentDomain, currentTitle, currentUrl, currentChannel);
  currentCategory = classification.category;

  const logEntry = {
    url: (currentUrl || "").slice(0, 1024),
    domain: currentDomain,
    page_title: (currentTitle || currentDomain || "").slice(0, 512),
    visited_at: new Date(tabStartTime).toISOString(),
    time_spent_secs: durationSecs,
    category: classification.category,
    productivity_label: classification.productivity_label,
    confidence_score: classification.confidence_score
  };

  sendBrowsingLog(logEntry).catch(e => console.error("Telemetry send failed:", e));

  return {
    domain: currentDomain,
    title: currentTitle || currentDomain,
    category: classification.category
  };
}

function sendSwitchEvent(fromInfo, toUrl, toTitle) {
  if (!trackingEnabled) return;
  const toDomain = extractDomain(toUrl);
  if (!fromInfo || isInternalOrSystemUrl(toUrl, toDomain)) return;
  if (!toDomain || toDomain === fromInfo.domain) return;

  const toClassification = classifyDomain(toDomain, toTitle, toUrl, "");

  const switchData = {
    from_domain: fromInfo.domain,
    from_title: (fromInfo.title || "").slice(0, 512),
    from_category: fromInfo.category,
    to_domain: toDomain,
    to_title: (toTitle || toDomain || "").slice(0, 512),
    to_category: toClassification.category,
    switched_at: new Date().toISOString()
  };

  sendSwitchLog(switchData).catch(e => console.error("Switch event send failed:", e));
}

let isSessionActive = false;
let customBlockedDomains = [];

async function checkActiveSessionStatus() {
  if (!trackingEnabled) {
    isSessionActive = false;
    return false;
  }
  try {
    const res = await authenticatedFetch("/focus/active/");
    if (res.ok) {
      const data = await res.json();
      if (data.on_break) {
        isSessionActive = false;
        await chrome.storage.local.set({ isSessionActive: false, onBreak: true });
        return false;
      }
      isSessionActive = !!data.active;
      await chrome.storage.local.set({ isSessionActive, onBreak: false });
      return isSessionActive;
    }
  } catch (e) {}
  const stored = await chrome.storage.local.get(["isSessionActive", "onBreak"]);
  if (stored.onBreak) {
    isSessionActive = false;
    return false;
  }
  isSessionActive = !!stored.isSessionActive;
  return isSessionActive;
}

async function checkCustomBlocklist() {
  if (!trackingEnabled) return customBlockedDomains;
  try {
    const res = await authenticatedFetch("/focus/blocklist/");
    if (res.ok) {
      const data = await res.json();
      customBlockedDomains = (data.blocked_domains || []).map(d => d.toLowerCase());
      await chrome.storage.local.set({ customBlockedDomains });
      return customBlockedDomains;
    }
  } catch (e) {}
  const stored = await chrome.storage.local.get(["customBlockedDomains"]);
  customBlockedDomains = stored.customBlockedDomains || [];
  return customBlockedDomains;
}

checkActiveSessionStatus().catch(() => {});
checkCustomBlocklist().catch(() => {});
setInterval(() => { if (trackingEnabled) checkActiveSessionStatus(); }, 15000);
setInterval(() => { if (trackingEnabled) checkCustomBlocklist(); }, 30000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TRACKING_DISABLED") {
    hardStopTracking().finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "CLEAR_SERVER_STATUS") {
    clearExtensionServerStatus().finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "TRACKING_ENABLED") {
    refreshTrackingFlag().then((on) => {
      if (on) {
        sendExtensionHeartbeat();
        checkActiveSessionStatus();
        checkCustomBlocklist();
        broadcastToTabs({ type: "TRACKING_ENABLED" });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "SYNC_AUTH_TOKEN" && message.token) {
    chrome.storage.local.get(["manuallyDisconnected", "extensionLinked", "trackingEnabled"]).then((stored) => {
      if (
        stored.manuallyDisconnected
        || stored.extensionLinked !== true
        || stored.trackingEnabled === false
      ) {
        return;
      }
      chrome.storage.local.set({
        jwtAccessToken: message.token,
        jwtRefreshToken: message.refresh || "",
        trackingEnabled: true
      });
      refreshTrackingFlag().then(() => {
        sendExtensionHeartbeat();
        checkCustomBlocklist().catch(() => {});
      });
      console.log("FocusGuard: Auto-synced auth token from Web App!");
    });
    return;
  }

  if (message.type === "SET_SESSION_STATUS") {
    if (!trackingEnabled) return;
    if (message.onBreak) {
      isSessionActive = false;
      chrome.storage.local.set({ isSessionActive: false, onBreak: true });
      return;
    }
    isSessionActive = !!message.active;
    chrome.storage.local.set({ isSessionActive, onBreak: false });
    return;
  }

  if (message.type === "CHECK_SHIELD_STATUS") {
    if (!trackingEnabled) {
      sendResponse({ shouldBlock: false, reason: "Extension disconnected" });
      return;
    }
    chrome.storage.local.get(["onBreak"]).then(async (stored) => {
      if (stored.onBreak) {
        sendResponse({ shouldBlock: false, reason: "User is on break" });
        return;
      }
      const active = await checkActiveSessionStatus();
      if (!active) {
        sendResponse({ shouldBlock: false, reason: "No active focus session" });
        return;
      }
      const domain = extractDomain(message.url);
      if (!domain || isInternalOrSystemUrl(message.url, domain)) {
        sendResponse({ shouldBlock: false, reason: "Internal or system URL" });
        return;
      }
      if (!customBlockedDomains.length) {
        await checkCustomBlocklist();
      }
      const isCustomBlocked = customBlockedDomains.some(d => domain.includes(d) || d.includes(domain));
      const classification = classifyDomain(domain, message.title || "", message.url, message.channel || "");
      if (isCustomBlocked || classification.productivity_label === "DISTRACTING") {
        sendResponse({
          shouldBlock: true,
          domain: domain,
          title: message.title,
          category: classification.category || "Blocked",
          reason: "Distracting content or user-blocked site during active focus session"
        });
      } else {
        sendResponse({ shouldBlock: false, category: classification.category });
      }
    }).catch(err => {
      sendResponse({ shouldBlock: false, error: err.message });
    });
    return true;
  }

  if (message.type === "YOUTUBE_NAVIGATED" && message.data) {
    if (!trackingEnabled) return;
    const fromInfo = recordCurrentTabDuration();
    tabStartTime = Date.now();
    const prevUrl = currentUrl;
    currentUrl = message.data.url;
    currentDomain = "youtube.com";
    currentTitle = message.data.title;
    currentChannel = message.data.channel;

    if (fromInfo && message.data.url !== prevUrl) {
      sendSwitchEvent(fromInfo, message.data.url, message.data.title);
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (!trackingEnabled) {
    activeTabId = activeInfo.tabId;
    tabStartTime = Date.now();
    return;
  }
  const fromInfo = recordCurrentTabDuration();

  activeTabId = activeInfo.tabId;
  tabStartTime = Date.now();

  try {
    const tab = await chrome.tabs.get(activeTabId);
    if (tab && tab.url) {
      if (fromInfo) {
        sendSwitchEvent(fromInfo, tab.url, tab.title);
      }
      currentUrl = tab.url;
      currentDomain = extractDomain(tab.url);
      currentTitle = tab.title;
    }
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!trackingEnabled) return;
  if (tabId === activeTabId && changeInfo.url) {
    const fromInfo = recordCurrentTabDuration();
    tabStartTime = Date.now();

    if (fromInfo) {
      sendSwitchEvent(fromInfo, changeInfo.url, tab.title);
    }

    currentUrl = changeInfo.url;
    currentDomain = extractDomain(changeInfo.url);
    currentTitle = tab.title;
  }
});

try {
  chrome.idle.setDetectionInterval(600);
} catch (e) {}

chrome.idle.onStateChanged.addListener((state) => {
  if (!trackingEnabled) return;
  if (state === "idle" || state === "locked") {
    isUserIdle = true;
    recordCurrentTabDuration();
  } else if (state === "active") {
    isUserIdle = false;
    tabStartTime = Date.now();
  }
});

setInterval(async () => {
  if (!trackingEnabled || !activeTabId || isUserIdle) return;
  try {
    const tab = await chrome.tabs.get(activeTabId);
    if (tab && tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://")) {
      currentUrl = tab.url;
      currentDomain = extractDomain(tab.url);
      currentTitle = tab.title;
      recordCurrentTabDuration();
      tabStartTime = Date.now();
    }
  } catch (e) {}
}, 5000);
