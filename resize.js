if (!globalThis.__pwtResize) {
  globalThis.__pwtResize = true;

  const EDGES = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
  let drag = null;

  if (isTop()) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "arm-resize") install();
    });
    askRole();
    setTimeout(askRole, 600);
  }

  function isTop() {
    try {
      return window.top === window;
    } catch {
      return false;
    }
  }

  function askRole() {
    if (!chrome.runtime || !chrome.runtime.id) return;
    try {
      chrome.runtime.sendMessage({ type: "window-role" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.popup) return;
        install();
      });
    } catch {
      // Extension context is gone.
    }
  }

  function install() {
    const root = document.documentElement;
    if (!root || document.getElementById("pwt-resize")) return;
    ensureStyle();

    const frame = document.createElement("div");
    frame.id = "pwt-resize";
    frame.setAttribute("aria-hidden", "true");

    for (const edge of EDGES) {
      const handle = document.createElement("div");
      handle.dataset.edge = edge;
      handle.addEventListener("pointerdown", onDown);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
      frame.append(handle);
    }

    root.append(frame);
  }

  function ensureStyle() {
    if (document.getElementById("pwt-resize-style")) return;
    const style = document.createElement("style");
    style.id = "pwt-resize-style";
    style.textContent = `
      #pwt-resize {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        user-select: none !important;
      }
      #pwt-resize [data-edge] {
        position: absolute !important;
        pointer-events: auto !important;
        touch-action: none !important;
        background: transparent !important;
      }
      #pwt-resize [data-edge="n"],
      #pwt-resize [data-edge="s"] {
        left: 12px !important;
        right: 12px !important;
        height: 8px !important;
        cursor: ns-resize !important;
      }
      #pwt-resize [data-edge="n"] { top: 0 !important; }
      #pwt-resize [data-edge="s"] { bottom: 0 !important; }
      #pwt-resize [data-edge="e"],
      #pwt-resize [data-edge="w"] {
        top: 12px !important;
        bottom: 12px !important;
        width: 8px !important;
        cursor: ew-resize !important;
      }
      #pwt-resize [data-edge="e"] { right: 0 !important; }
      #pwt-resize [data-edge="w"] { left: 0 !important; }
      #pwt-resize [data-edge="nw"],
      #pwt-resize [data-edge="ne"],
      #pwt-resize [data-edge="sw"],
      #pwt-resize [data-edge="se"] {
        width: 16px !important;
        height: 16px !important;
      }
      #pwt-resize [data-edge="nw"] { top: 0 !important; left: 0 !important; cursor: nwse-resize !important; }
      #pwt-resize [data-edge="se"] { right: 0 !important; bottom: 0 !important; cursor: nwse-resize !important; }
      #pwt-resize [data-edge="ne"] { top: 0 !important; right: 0 !important; cursor: nesw-resize !important; }
      #pwt-resize [data-edge="sw"] { bottom: 0 !important; left: 0 !important; cursor: nesw-resize !important; }
      #pwt-resize [data-edge]::after {
        content: "" !important;
        position: absolute !important;
        background: #c4a15a !important;
        opacity: 0.72 !important;
      }
      #pwt-resize [data-edge="n"]::after,
      #pwt-resize [data-edge="s"]::after {
        left: 0 !important;
        right: 0 !important;
        height: 3px !important;
      }
      #pwt-resize [data-edge="n"]::after { top: 0 !important; }
      #pwt-resize [data-edge="s"]::after { bottom: 0 !important; }
      #pwt-resize [data-edge="e"]::after,
      #pwt-resize [data-edge="w"]::after {
        top: 0 !important;
        bottom: 0 !important;
        width: 3px !important;
      }
      #pwt-resize [data-edge="e"]::after { right: 0 !important; }
      #pwt-resize [data-edge="w"]::after { left: 0 !important; }
      #pwt-resize [data-edge="nw"]::after,
      #pwt-resize [data-edge="ne"]::after,
      #pwt-resize [data-edge="sw"]::after,
      #pwt-resize [data-edge="se"]::after {
        inset: 2px !important;
      }
      #pwt-resize [data-edge="se"]::after { opacity: 1 !important; }
      #pwt-resize [data-edge]:hover::after { opacity: 1 !important; }
      @media print {
        #pwt-resize { display: none !important; }
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function onDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const edge = event.currentTarget.dataset.edge;
    event.currentTarget.setPointerCapture(event.pointerId);
    const pending = {
      edge,
      originX: event.screenX,
      originY: event.screenY,
      ready: false,
    };
    drag = pending;
    chrome.runtime.sendMessage({ type: "get-bounds" }, (bounds) => {
      if (drag !== pending) return;
      if (chrome.runtime.lastError || !bounds || !bounds.ok) {
        drag = null;
        return;
      }
      pending.ready = true;
      pending.left = bounds.left;
      pending.top = bounds.top;
      pending.width = bounds.width;
      pending.height = bounds.height;
    });
  }

  function onMove(event) {
    if (!drag || !drag.ready || event.currentTarget.dataset.edge !== drag.edge) return;
    event.preventDefault();
    const next = resizeByEdge(drag, event.screenX - drag.originX, event.screenY - drag.originY);
    try {
      chrome.runtime.sendMessage({ type: "set-bounds", bounds: next });
    } catch {
      drag = null;
    }
  }

  function onUp(event) {
    if (event.currentTarget.dataset.edge !== (drag && drag.edge)) return;
    drag = null;
  }

  function resizeByEdge(start, dx, dy) {
    let left = start.left;
    let top = start.top;
    let width = start.width;
    let height = start.height;
    const edge = start.edge;

    if (edge.includes("e")) width += dx;
    if (edge.includes("s")) height += dy;
    if (edge.includes("w")) {
      width -= dx;
      left += dx;
    }
    if (edge.includes("n")) {
      height -= dy;
      top += dy;
    }

    if (width < 240) {
      if (edge.includes("w")) left -= 240 - width;
      width = 240;
    }
    if (height < 180) {
      if (edge.includes("n")) top -= 180 - height;
      height = 180;
    }
    if (width > 2400) {
      if (edge.includes("w")) left += width - 2400;
      width = 2400;
    }
    if (height > 1600) {
      if (edge.includes("n")) top += height - 1600;
      height = 1600;
    }

    return {
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height),
    };
  }
}
