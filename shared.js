if (!globalThis.PWT) {
  globalThis.PWT = (() => {
    const DEFAULT_SETTINGS = {
      mode: "newtab",
      width: 980,
      height: 720,
      left: null,
      top: null,
    };

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function stripWww(host) {
      return String(host || "")
        .trim()
        .toLowerCase()
        .replace(/\.$/, "")
        .replace(/^www\./, "");
    }

    function parseSiteInput(raw) {
      let value = String(raw || "").trim();
      if (!value) return { error: "Enter a domain, like example.com." };
      value = value.replace(/^\*\./, "");
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;

      let url;
      try {
        url = new URL(value);
      } catch {
        return { error: "That doesn't look like a domain." };
      }

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { error: "Only http and https sites can be saved." };
      }

      const host = stripWww(url.hostname);
      if (!host || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
        return { error: "That doesn't look like a domain." };
      }
      if (!/^[a-z0-9.-]+$/.test(host)) {
        return { error: "That doesn't look like a domain." };
      }
      return { host };
    }

    function hostMatches(rule, hostname) {
      const page = stripWww(hostname);
      const saved = stripWww(rule.host);
      if (!page || !saved) return false;
      if (page === saved) return true;
      return rule.includeSubdomains !== false && page.endsWith("." + saved);
    }

    function findRule(sites, hostname) {
      const matches = (sites || []).filter((rule) => hostMatches(rule, hostname));
      matches.sort((a, b) => stripWww(b.host).length - stripWww(a.host).length);
      return matches[0] || null;
    }

    function normalizeSize(width, height) {
      const w = Math.round(Number(width));
      const h = Math.round(Number(height));
      if (!Number.isFinite(w) || !Number.isFinite(h)) {
        return { width: DEFAULT_SETTINGS.width, height: DEFAULT_SETTINGS.height };
      }
      return {
        width: clamp(w, 240, 2400),
        height: clamp(h, 180, 1600),
      };
    }

    async function load() {
      const data = await chrome.storage.local.get({
        sites: [],
        settings: DEFAULT_SETTINGS,
      });
      return {
        sites: Array.isArray(data.sites) ? data.sites : [],
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      };
    }

    async function saveSites(sites) {
      await chrome.storage.local.set({ sites });
    }

    async function saveSettings(partial) {
      const { settings } = await load();
      const next = { ...settings, ...partial };
      await chrome.storage.local.set({ settings: next });
      return next;
    }

    return {
      DEFAULT_SETTINGS,
      stripWww,
      parseSiteInput,
      hostMatches,
      findRule,
      normalizeSize,
      load,
      saveSites,
      saveSettings,
    };
  })();
}
