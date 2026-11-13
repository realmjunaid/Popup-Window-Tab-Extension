importScripts("shared.js");

const TRACK_KEY = "popupWindowIds";
const rememberTimers = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return;
  if (msg.type === "get-config") {
    resolveConfig(sender.tab && sender.tab.url, sender.tab && sender.tab.windowId).then(sendResponse);
    return true;
  }
  if (msg.type === "open-popup") {
    openPopup(msg.url, sender).then(sendResponse);
    return true;
  }
  if (msg.type === "window-role") {
    isTrackedWindow(sender.tab && sender.tab.windowId).then((popup) => sendResponse({ popup }));
    return true;
  }
  if (msg.type === "get-bounds") {
    boundsOf(sender).then(sendResponse);
    return true;
  }
  if (msg.type === "set-bounds") {
    resizeTracked(sender, msg.bounds).then(sendResponse);
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  injectOpenTabs().catch(() => {});
  updateBadge().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge().catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateBadge(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url || info.status === "loading") updateBadge(tabId).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.sites || changes.settings)) {
    updateBadge().catch(() => {});
  }
});

chrome.windows.onBoundsChanged.addListener((win) => {
  rememberSoon(win.id);
});

chrome.windows.onFocusChanged.addListener(() => {
  rememberTracked().catch(() => {});
});

chrome.windows.onRemoved.addListener((id) => {
  forgetWindow(id).catch(() => {});
});

updateBadge().catch(() => {});

async function getTracked() {
  const data = await chrome.storage.session.get({ [TRACK_KEY]: [] });
  const ids = Array.isArray(data[TRACK_KEY]) ? data[TRACK_KEY] : [];
  const windows = await chrome.windows.getAll();
  const live = new Set(windows.map((win) => win.id));
  const next = ids.filter((id) => live.has(id));
  if (next.length !== ids.length) await chrome.storage.session.set({ [TRACK_KEY]: next });
  return next;
}

async function trackWindow(id) {
  const ids = await getTracked();
  if (!ids.includes(id)) {
    ids.push(id);
    await chrome.storage.session.set({ [TRACK_KEY]: ids });
  }
}

async function forgetWindow(id) {
  const data = await chrome.storage.session.get({ [TRACK_KEY]: [] });
  const ids = Array.isArray(data[TRACK_KEY]) ? data[TRACK_KEY] : [];
  if (!ids.includes(id)) return;
  await chrome.storage.session.set({ [TRACK_KEY]: ids.filter((item) => item !== id) });
}

async function resolveConfig(tabUrl, windowId) {
  const { sites, settings } = await PWT.load();
  const mode = settings.mode === "all" ? "all" : "newtab";
  const viewer = await isTrackedWindow(windowId);
  let hostname = "";
  try {
    hostname = new URL(tabUrl).hostname;
  } catch {
    return { enabled: false, mode, host: "", viewer };
  }
  const rule = PWT.findRule(sites, hostname);
  return {
    enabled: Boolean(rule),
    mode,
    host: rule ? rule.host : "",
    viewer,
  };
}

async function isTrackedWindow(windowId) {
  if (windowId == null) return false;
  const tracked = await getTracked();
  return tracked.includes(windowId);
}

async function openPopup(rawUrl, sender) {
  const tabUrl = sender.tab && sender.tab.url;
  const config = await resolveConfig(tabUrl);
  if (!config.enabled) return { ok: false, error: "not-enabled" };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "bad-url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "bad-url" };
  }

  const href = url.href;
  const tracked = await getTracked();
  const openWindows = await chrome.windows.getAll({ populate: true });
  const existing = openWindows.find(
    (win) => tracked.includes(win.id) && (win.tabs || []).some((tab) => tab.url === href)
  );
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true, state: "normal" });
    const tab = (existing.tabs || []).find((item) => item.url === href);
    if (tab && tab.id != null) armResize(tab.id);
    return { ok: true, focused: true };
  }

  const { settings } = await PWT.load();
  const size = PWT.normalizeSize(settings.width, settings.height);
  let parent = null;
  try {
    parent = sender.tab && sender.tab.windowId
      ? await chrome.windows.get(sender.tab.windowId)
      : await chrome.windows.getLastFocused();
  } catch {
    parent = null;
  }
  const bounds = placeWindow(size, settings, parent);

  try {
    const created = await chrome.windows.create({
      url: href,
      type: "popup",
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
      focused: true,
    });
    if (created && created.id != null) {
      await trackWindow(created.id);
      const tabId = await createdTabId(created);
      if (tabId != null) armResize(tabId);
    }
    return { ok: true };
  } catch {
    await chrome.tabs.create({ url: href, openerTabId: sender.tab && sender.tab.id });
    return { ok: false, fallback: "tab" };
  }
}

async function createdTabId(created) {
  if (created.tabs && created.tabs[0] && created.tabs[0].id != null) return created.tabs[0].id;
  const tabs = await chrome.tabs.query({ windowId: created.id });
  return tabs[0] ? tabs[0].id : null;
}

function armResize(tabId) {
  const send = () => {
    try {
      const sent = chrome.tabs.sendMessage(tabId, { type: "arm-resize" });
      if (sent && typeof sent.then === "function") sent.then(() => {}, () => {});
    } catch {
      // The page may still be starting.
    }
  };
  send();
  setTimeout(send, 350);
  setTimeout(send, 1200);
}

async function boundsOf(sender) {
  const windowId = sender.tab && sender.tab.windowId;
  if (!(await isTrackedWindow(windowId))) return { ok: false };
  try {
    const win = await chrome.windows.get(windowId);
    return { ok: true, left: win.left, top: win.top, width: win.width, height: win.height };
  } catch {
    return { ok: false };
  }
}

const resizeQueue = new Map();

async function resizeTracked(sender, bounds) {
  const windowId = sender.tab && sender.tab.windowId;
  if (!(await isTrackedWindow(windowId))) return { ok: false };
  const next = sanitizeBounds(bounds);
  if (!next) return { ok: false };
  return enqueueResize(windowId, next);
}

function sanitizeBounds(bounds) {
  if (!bounds) return null;
  const width = Math.round(Number(bounds.width));
  const height = Math.round(Number(bounds.height));
  const left = Math.round(Number(bounds.left));
  const top = Math.round(Number(bounds.top));
  if (![width, height, left, top].every(Number.isFinite)) return null;
  return {
    width: Math.min(2400, Math.max(240, width)),
    height: Math.min(1600, Math.max(180, height)),
    left,
    top,
  };
}

function enqueueResize(windowId, bounds) {
  const state = resizeQueue.get(windowId) || { inflight: false, queued: null };
  resizeQueue.set(windowId, state);
  state.queued = bounds;
  if (state.inflight) return Promise.resolve({ ok: true });
  return drainResize(windowId);
}

async function drainResize(windowId) {
  const state = resizeQueue.get(windowId);
  if (!state || state.inflight) return { ok: true };
  state.inflight = true;
  let last = { ok: true };
  while (state.queued) {
    const bounds = state.queued;
    state.queued = null;
    try {
      await chrome.windows.update(windowId, bounds);
      last = { ok: true };
    } catch {
      last = { ok: false };
    }
  }
  state.inflight = false;
  return last;
}

function placeWindow(size, settings, parent) {
  if (Number.isFinite(settings.left) && Number.isFinite(settings.top)) {
    return {
      width: size.width,
      height: size.height,
      left: Math.round(settings.left),
      top: Math.round(settings.top),
    };
  }
  const baseLeft = parent && Number.isFinite(parent.left) ? parent.left : 80;
  const baseTop = parent && Number.isFinite(parent.top) ? parent.top : 40;
  const parentWidth = parent && parent.width ? parent.width : 1280;
  const parentHeight = parent && parent.height ? parent.height : 800;
  return {
    width: size.width,
    height: size.height,
    left: Math.round(baseLeft + (parentWidth - size.width) / 2),
    top: Math.round(baseTop + Math.max(24, (parentHeight - size.height) / 2)),
  };
}

function rememberSoon(id) {
  clearTimeout(rememberTimers.get(id));
  rememberTimers.set(
    id,
    setTimeout(() => {
      rememberTimers.delete(id);
      remember(id).catch(() => {});
    }, 250)
  );
}

async function rememberTracked() {
  const ids = await getTracked();
  await Promise.all(ids.map((id) => remember(id)));
}

async function remember(id) {
  const ids = await getTracked();
  if (!ids.includes(id)) return;
  let win;
  try {
    win = await chrome.windows.get(id);
  } catch {
    return;
  }
  if (!win || win.type !== "popup" || win.state !== "normal") return;
  const size = PWT.normalizeSize(win.width, win.height);
  if (!Number.isFinite(win.left) || !Number.isFinite(win.top)) return;
  const { settings } = await PWT.load();
  if (
    settings.width === size.width &&
    settings.height === size.height &&
    settings.left === Math.round(win.left) &&
    settings.top === Math.round(win.top)
  ) {
    return;
  }
  await PWT.saveSettings({
    width: size.width,
    height: size.height,
    left: Math.round(win.left),
    top: Math.round(win.top),
  });
}

async function updateBadge(tabId) {
  let tab = null;
  try {
    if (tabId) {
      tab = await chrome.tabs.get(tabId);
    } else {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = tabs[0] || null;
    }
  } catch {
    return;
  }
  if (!tab || tab.id == null) return;

  const config = await resolveConfig(tab.url);
  const title = config.enabled
    ? "Popup Window Tab — " + config.host + " is on"
    : "Popup Window Tab";
  await chrome.action.setTitle({ tabId: tab.id, title });
  if (!config.enabled) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#2C3A42" });
  try {
    await chrome.action.setBadgeTextColor({ tabId: tab.id, color: "#F3E6C4" });
  } catch {
    // Chrome before badge text color.
  }
}

async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(tabs.map((tab) => injectTab(tab.id)));
}

async function injectTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["shared.js", "content.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["page-hook.js"],
      world: "MAIN",
    });
  } catch {
    // Discarded tabs and restricted pages cannot be injected.
  }
}
