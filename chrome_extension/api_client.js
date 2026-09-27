/**
 * FocusGuard AI - Extension API Client
 */
const API_BASE_DEFAULT = "http://127.0.0.1:8000/api";

async function getApiBase() {
  const result = await chrome.storage.local.get(["apiBaseUrl"]);
  return result.apiBaseUrl || API_BASE_DEFAULT;
}

async function getAuthToken() {
  const result = await chrome.storage.local.get(["jwtAccessToken"]);
  return result.jwtAccessToken || null;
}

async function setAuthTokens(access, refresh) {
  await chrome.storage.local.set({
    jwtAccessToken: access,
    jwtRefreshToken: refresh
  });
}

async function refreshAuthToken() {
  const result = await chrome.storage.local.get(["jwtRefreshToken"]);
  const refresh = result.jwtRefreshToken;
  if (!refresh) return null;

  const baseUrl = await getApiBase();
  try {
    const res = await fetch(`${baseUrl}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh })
    });
    if (res.ok) {
      const data = await res.json();
      await chrome.storage.local.set({ jwtAccessToken: data.access });
      if (data.refresh) {
        await chrome.storage.local.set({ jwtRefreshToken: data.refresh });
      }
      return data.access;
    }
  } catch (e) {
    console.error("Token refresh error:", e);
  }
  return null;
}

async function authenticatedFetch(endpoint, options = {}) {
  let token = await getAuthToken();
  if (!token) return { ok: false, status: 401, error: "Not logged in" };

  const baseUrl = await getApiBase();
  const url = `${baseUrl}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "X-Client-Type": "chrome-extension",
    ...(options.headers || {})
  };

  try {
    let response = await fetch(url, { ...options, headers });

    // Handle token expiration
    if (response.status === 401) {
      const newToken = await refreshAuthToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
        response = await fetch(url, { ...options, headers });
      }
    }

    return response;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendBrowsingLog(logData) {
  try {
    const res = await authenticatedFetch("/browsing/log/", {
      method: "POST",
      body: JSON.stringify(logData)
    });
    if (!res.ok) {
      return { success: false, status: res.status };
    }
    return { success: true, data: await res.json() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendSwitchLog(switchData) {
  try {
    const res = await authenticatedFetch("/browsing/switch/", {
      method: "POST",
      body: JSON.stringify(switchData)
    });
    if (!res.ok) {
      return { success: false, status: res.status };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchTodayBrowsingSummary() {
  try {
    const res = await authenticatedFetch("/browsing/today/", {
      method: "GET"
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error("Failed to fetch browsing summary", err);
  }
  return null;
}
