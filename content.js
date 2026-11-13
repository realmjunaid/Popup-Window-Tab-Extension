if (!globalThis.__pwtContent) {
  globalThis.__pwtContent = true;

  const state = { enabled: false, mode: "newtab", host: "", viewer: false };
  let published = "";
  let suppressUrl = "";
  let suppressUntil = 0;

  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseDown, true);
  document.addEventListener("click", onActivate, true);
  document.addEventListener("auxclick", onActivate, true);
  window.addEventListener("pwt-window-open", onWindowOpen);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.sites || changes.settings)) refresh();
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "arm-resize") refresh();
    if (!msg || (msg.type !== "ping" && msg.type !== "refresh")) return;
    const reply = () => {
      if (inTopFrame()) sendResponse({ ok: true, enabled: state.enabled });
    };
    if (msg.type === "ping") {
      reply();
      return;
    }
    refresh().then(reply);
    return inTopFrame();
  });

  boot();

  function boot() {
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      return;
    }
    watchAttribute();
    refresh();
  }

  function inTopFrame() {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  }

  async function refresh() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      const config = await chrome.runtime.sendMessage({ type: "get-config" });
      state.enabled = Boolean(config && config.enabled);
      state.mode = config && config.mode === "all" ? "all" : "newtab";
      state.host = (config && config.host) || "";
      state.viewer = Boolean(config && config.viewer);
    } catch {
      state.enabled = false;
    }
    publish();
  }

  function publish() {
    const root = document.documentElement;
    if (!root) return;
    published = JSON.stringify({ enabled: state.enabled, mode: state.mode });
    if (root.getAttribute("data-pwt") !== published) {
      root.setAttribute("data-pwt", published);
    }
  }

  function watchAttribute() {
    const root = document.documentElement;
    if (!root || root.dataset.pwtWatch === "1") return;
    root.dataset.pwtWatch = "1";
    new MutationObserver(() => {
      if (published && root.getAttribute("data-pwt") !== published) {
        root.setAttribute("data-pwt", published);
      }
    }).observe(root, { attributes: true, attributeFilter: ["data-pwt"] });
  }

  function onMouseDown(event) {
    if (event.button !== 1) return;
    const anchor = anchorFrom(event);
    if (!anchor || !wantsPopup(anchor, event)) return;
    event.preventDefault();
  }

  function onActivate(event) {
    if (event.type === "click" && event.button !== 0) return;
    if (event.type === "auxclick" && event.button !== 1) return;
    const anchor = anchorFrom(event);
    if (!anchor || !wantsPopup(anchor, event)) return;
    const href = linkHref(anchor);
    if (!href || recentlyHandled(href)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    markHandled(href);
    openPopup(href);
  }

  function onWindowOpen(event) {
    const href = event.detail && event.detail.url;
    if (!href || !state.enabled || recentlyHandled(href)) return;
    markHandled(href);
    openPopup(href);
  }

  function wantsPopup(anchor, event) {
    if (!state.enabled || event.altKey || event.defaultPrevented) return false;
    if (anchor.hasAttribute && anchor.hasAttribute("download")) return false;
    if (anchor.closest && anchor.closest("[contenteditable='true']")) return false;
    const href = linkHref(anchor);
    if (!href) return false;
    let url;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (isHashOnly(url)) return false;
    if (state.viewer && !opensNewContext(anchor, event)) return false;
    if (state.mode === "all") return true;
    return opensNewContext(anchor, event);
  }

  function opensNewContext(anchor, event) {
    if (event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey) return true;
    const target = effectiveTarget(anchor);
    return target !== "" && target !== "_self" && target !== "_parent" && target !== "_top";
  }

  function effectiveTarget(anchor) {
    if (typeof anchor.target === "string" && anchor.target) return anchor.target.toLowerCase();
    return String((anchor.getAttribute && anchor.getAttribute("target")) || "").toLowerCase();
  }

  function isHashOnly(url) {
    try {
      const here = new URL(location.href);
      return (
        url.origin === here.origin &&
        url.pathname === here.pathname &&
        url.search === here.search &&
        url.hash !== here.hash
      );
    } catch {
      return false;
    }
  }

  function anchorFrom(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node && node.nodeType === 1 && node.localName === "a" && hasHref(node)) return node;
    }
    const target = event.target;
    if (target && target.nodeType === 1 && typeof target.closest === "function") {
      return target.closest("a[href]");
    }
    return null;
  }

  function hasHref(node) {
    if (node.hasAttribute && node.hasAttribute("href")) return true;
    return typeof node.href === "string" && node.href !== "";
  }

  function linkHref(anchor) {
    try {
      if (typeof anchor.href === "string" && anchor.href) return new URL(anchor.href, location.href).href;
      if (anchor.href && typeof anchor.href.baseVal === "string") {
        return new URL(anchor.href.baseVal, location.href).href;
      }
      const attr = anchor.getAttribute && anchor.getAttribute("href");
      if (!attr || attr.startsWith("javascript:")) return "";
      return new URL(attr, location.href).href;
    } catch {
      return "";
    }
  }

  function recentlyHandled(url) {
    return url === suppressUrl && Date.now() < suppressUntil;
  }

  function markHandled(url) {
    suppressUrl = url;
    suppressUntil = Date.now() + 700;
  }

  function openPopup(url) {
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      const sent = chrome.runtime.sendMessage({ type: "open-popup", url });
      if (sent && typeof sent.then === "function") sent.then(() => {}, () => {});
    } catch {
      // The extension was reloaded while this page stayed open.
    }
  }
}
