const toggle = document.querySelector("#toggle");
const siteName = document.querySelector("#site-name");
const status = document.querySelector("#status");
const sizeNote = document.querySelector("#size-note");
const count = document.querySelector("#count");
const settingsButton = document.querySelector("#settings");

let current = null;
let reloadHint = false;
let busy = false;

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

toggle.addEventListener("click", async () => {
  if (!current || busy) return;
  const snapshot = current;
  busy = true;
  toggle.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { sites } = await PWT.load();

    if (snapshot.rule) {
      await PWT.saveSites(sites.filter((rule) => rule.host !== snapshot.rule.host));
      reloadHint = false;
    } else {
      const host = PWT.stripWww(snapshot.hostname);
      if (!sites.some((rule) => rule.host === host)) {
        sites.push({ host, includeSubdomains: true, createdAt: Date.now() });
        await PWT.saveSites(sites);
      }
      reloadHint = !(await ensureListening(tab.id));
    }
  } finally {
    busy = false;
    await render();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && !busy) render();
});

render();

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { sites, settings } = await PWT.load();
  const size = PWT.normalizeSize(settings.width, settings.height);
  count.textContent = sites.length === 1 ? "1 site saved" : sites.length + " sites saved";
  sizeNote.textContent =
    "Drag any edge, corner, or the brass grip. Next window: " + size.width + " × " + size.height + ".";

  const url = readableUrl(tab && tab.url);
  if (!url) {
    current = null;
    siteName.textContent = "No website in this tab";
    status.textContent = "Open a website, then come back to enable it.";
    toggle.disabled = true;
    toggle.dataset.state = "off";
    toggle.textContent = "Enable this site for popup window";
    toggle.setAttribute("aria-pressed", "false");
    return;
  }

  const rule = PWT.findRule(sites, url.hostname);
  current = { hostname: url.hostname, rule, tabId: tab.id };
  siteName.textContent = url.hostname;
  toggle.disabled = false;

  if (!rule) {
    reloadHint = false;
    status.textContent =
      "Links still open as tabs. This saves " + PWT.stripWww(url.hostname) + " and its subdomains.";
    toggle.dataset.state = "off";
    toggle.textContent = "Enable this site for popup window";
    toggle.setAttribute("aria-pressed", "false");
    return;
  }

  toggle.dataset.state = "on";
  toggle.setAttribute("aria-pressed", "true");
  toggle.textContent =
    rule.host === PWT.stripWww(url.hostname) ? "Disable this site" : "Disable " + rule.host;

  if (reloadHint) {
    status.textContent = "Saved. Reload this page so links open in a popup window.";
    return;
  }

  if (settings.mode === "all") {
    status.textContent = "Every link opens in a popup window, and this page stays put.";
    return;
  }

  status.textContent = rule.host === PWT.stripWww(url.hostname)
    ? "Links that would open a new tab open in a popup window instead."
    : "Enabled by " + rule.host + ". New-tab links open in a popup window instead.";
}

function readableUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

async function ensureListening(tabId) {
  if (await ping(tabId)) return true;
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
    return false;
  }
  return ping(tabId);
}

async function ping(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: "refresh" });
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}
