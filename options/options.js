const form = document.querySelector("#add-form");
const domainInput = document.querySelector("#domain");
const subdomainsInput = document.querySelector("#subdomains");
const addError = document.querySelector("#add-error");
const sitesEl = document.querySelector("#sites");
const emptyEl = document.querySelector("#empty");
const widthInput = document.querySelector("#width");
const heightInput = document.querySelector("#height");
const resetSize = document.querySelector("#reset-size");
const modeInputs = document.querySelectorAll('input[name="mode"]');

let sites = [];
let settings = { ...PWT.DEFAULT_SETTINGS };

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const parsed = PWT.parseSiteInput(domainInput.value);
  if (parsed.error) {
    addError.textContent = parsed.error;
    domainInput.focus();
    return;
  }
  if (sites.some((rule) => rule.host === parsed.host)) {
    addError.textContent = parsed.host + " is already saved.";
    domainInput.focus();
    return;
  }
  sites.push({
    host: parsed.host,
    includeSubdomains: subdomainsInput.checked,
    createdAt: Date.now(),
  });
  sites.sort(byHost);
  await PWT.saveSites(sites);
  domainInput.value = "";
  addError.textContent = "Saved " + parsed.host + ".";
  renderSites();
  domainInput.focus();
});

modeInputs.forEach((input) => {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    settings = await PWT.saveSettings({ mode: input.value === "all" ? "all" : "newtab" });
  });
});

widthInput.addEventListener("change", saveSizeFromInputs);
heightInput.addEventListener("change", saveSizeFromInputs);

resetSize.addEventListener("click", async () => {
  settings = await PWT.saveSettings({
    width: PWT.DEFAULT_SETTINGS.width,
    height: PWT.DEFAULT_SETTINGS.height,
    left: null,
    top: null,
  });
  fillSize();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  load();
});

load();

async function load() {
  const data = await PWT.load();
  sites = data.sites.slice().sort(byHost);
  settings = data.settings;
  fillSize();
  fillMode();
  renderSites();
}

function fillSize() {
  if (document.activeElement !== widthInput) widthInput.value = String(settings.width || 980);
  if (document.activeElement !== heightInput) heightInput.value = String(settings.height || 720);
}

function fillMode() {
  const mode = settings.mode === "all" ? "all" : "newtab";
  modeInputs.forEach((input) => {
    input.checked = input.value === mode;
  });
}

async function saveSizeFromInputs() {
  const size = PWT.normalizeSize(widthInput.value, heightInput.value);
  settings = await PWT.saveSettings(size);
  fillSize();
}

function renderSites() {
  sitesEl.replaceChildren();
  emptyEl.hidden = sites.length > 0;
  for (const rule of sites) {
    const row = document.createElement("li");
    row.className = "site-row";

    const host = document.createElement("span");
    host.className = "site-host";
    host.textContent = rule.host;

    const sub = document.createElement("label");
    sub.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = rule.includeSubdomains !== false;
    box.addEventListener("change", async () => {
      rule.includeSubdomains = box.checked;
      await PWT.saveSites(sites);
    });
    sub.append(box, document.createTextNode("Subdomains"));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      sites = sites.filter((item) => item.host !== rule.host);
      await PWT.saveSites(sites);
      renderSites();
    });

    row.append(host, sub, remove);
    sitesEl.append(row);
  }
}

function byHost(a, b) {
  return a.host.localeCompare(b.host);
}
