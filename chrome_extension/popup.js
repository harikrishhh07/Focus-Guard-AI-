document.addEventListener("DOMContentLoaded", async () => {
  const token = await getAuthToken();
  const loginSec = document.getElementById("loginSection");
  const statsSec = document.getElementById("statsSection");
  const authStatus = document.getElementById("authStatus");
  const stored = await chrome.storage.local.get([
    "manuallyDisconnected",
    "trackingEnabled",
    "extensionLinked"
  ]);

  const showConnected = !!token
    && stored.manuallyDisconnected !== true
    && stored.trackingEnabled !== false
    && stored.extensionLinked === true;

  async function clearServerHeartbeat() {
    try {
      if (token) {
        await authenticatedFetch("/auth/extension/status/clear/", { method: "POST" });
      } else {
        chrome.runtime.sendMessage({ type: "CLEAR_SERVER_STATUS" }).catch(() => {});
      }
    } catch (e) {}
  }

  if (!showConnected) {
    loginSec.classList.remove("hidden");
    statsSec.classList.add("hidden");
    authStatus.textContent = "Offline";
    authStatus.className = "status-pill offline";

    await chrome.storage.local.set({
      trackingEnabled: false,
      manuallyDisconnected: true,
      extensionLinked: false,
      isSessionActive: false
    });
    chrome.runtime.sendMessage({ type: "TRACKING_DISABLED" }).catch(() => {});
    await clearServerHeartbeat();
  } else {
    loginSec.classList.add("hidden");
    statsSec.classList.remove("hidden");
    authStatus.textContent = "Live";
    authStatus.className = "status-pill online";

    try {
      await authenticatedFetch("/auth/extension/heartbeat/", { method: "POST" });
    } catch (e) {}

    try {
      const summary = await fetchTodayBrowsingSummary();
      const countEl = document.getElementById("todaySyncCount");
      if (countEl && summary) {
        const mins = Math.round((summary.total_time_secs || 0) / 60);
        countEl.textContent = mins > 0 ? `${mins}m tracked today` : "Connected & ready";
      }
    } catch (e) {}
  }

  document.getElementById("loginBtn").addEventListener("click", async () => {
    const user = document.getElementById("usernameInput").value.trim();
    const pass = document.getElementById("passwordInput").value.trim();
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";

    const baseUrl = await getApiBase();

    try {
      const res = await fetch(`${baseUrl}/auth/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass })
      });
      if (res.ok) {
        const data = await res.json();
        await setAuthTokens(data.access, data.refresh);
        await chrome.storage.local.set({
          trackingEnabled: true,
          manuallyDisconnected: false,
          extensionLinked: true
        });
        try {
          await authenticatedFetch("/auth/extension/heartbeat/", { method: "POST" });
        } catch (e) {}
        chrome.runtime.sendMessage({ type: "TRACKING_ENABLED" }).catch(() => {});
        location.reload();
      } else {
        errEl.textContent = "Invalid username or password";
      }
    } catch (e) {
      errEl.textContent = "Cannot reach FocusGuard App (is the server running?)";
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    const btn = document.getElementById("logoutBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Disconnecting…";
    }

    // 1) Tell server to drop Connected flag + end extension session link
    try {
      await authenticatedFetch("/auth/extension/disconnect/", { method: "POST" });
    } catch (e) {}

    // 2) Hard-stop all local collection BEFORE clearing tokens
    await chrome.storage.local.set({
      trackingEnabled: false,
      manuallyDisconnected: true,
      extensionLinked: false,
      isSessionActive: false
    });

    try {
      await chrome.runtime.sendMessage({ type: "TRACKING_DISABLED" });
    } catch (e) {}

    // 3) Wipe credentials last
    await chrome.storage.local.remove(["jwtAccessToken", "jwtRefreshToken"]);
    location.reload();
  });

  document.getElementById("openAppBtn").addEventListener("click", async () => {
    const baseUrl = await getApiBase();
    const appUrl = baseUrl.replace(/\/api\/?$/, "/");
    chrome.tabs.create({ url: appUrl });
  });
});
