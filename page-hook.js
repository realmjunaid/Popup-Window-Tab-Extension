(() => {
  if (window.__pwtHooked) return;
  window.__pwtHooked = true;

  const nativeOpen = window.open.bind(window);

  function config() {
    const root = document.documentElement;
    if (!root) return null;
    const raw = root.getAttribute("data-pwt");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function httpUrl(value) {
    if (value == null || value === "") return "";
    try {
      const url = new URL(String(value), location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch {
      return "";
    }
  }

  window.open = function (url, target, features) {
    const href = httpUrl(url);
    const cfg = config();
    const name = String(target || "").toLowerCase();
    const staysHere = name === "_self" || name === "_parent" || name === "_top";
    if (!href || !cfg || !cfg.enabled || staysHere) {
      return nativeOpen(url, target, features);
    }
    window.dispatchEvent(new CustomEvent("pwt-window-open", { detail: { url: href } }));
    return {
      closed: false,
      opener: window,
      name,
      focus() {},
      blur() {},
      close() {
        this.closed = true;
      },
      postMessage() {},
      location: {
        href,
        assign() {},
        replace() {},
        toString() {
          return href;
        },
      },
    };
  };
})();
