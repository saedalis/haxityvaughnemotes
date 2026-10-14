(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  console.log("[VLE] content script running on", location.href);
  let emotes = new Map();
  let chatSelector = "";
  let emoteSize = 32;
  let acEnabled = true;
  let observer = null;

  // Default scope: the text body of a Vaughn Live chat message. Override in Options if the site changes.
  const FALLBACK_SCOPE = '.vs_chatv9_msg_body';
  const MULTI_FALLBACK_SCOPE = '.vs_chatv9_msg_body_multi';

  const SKIP = [
    "textarea",
    "input",
    "script",
    "style",
    "[contenteditable]",
    "[contenteditable] *",
    ".vle-emote",
    '[onclick*="insertVmojiTrigger"]',
    '[onclick*="insertVmojiTrigger"] *'
  ].join(", ");

  function load() {
    ext.runtime.sendMessage({ type: "getEmotes" }).then((res) => {
      if (!res) { console.warn("[VLE] no response from background (service worker error?)"); return; }
      emotes = new Map(Object.entries(res.emotes || {}));
      chatSelector = res.chatSelector || "";
      acEnabled = res.autocomplete !== false;
      emoteSize = Math.max(8, parseInt(res.emoteSize, 10) || 32);
      const scope = chatSelector || `${FALLBACK_SCOPE}, ${MULTI_FALLBACK_SCOPE}`;
      // Per-source breakdown. "used" = emotes still active after name collisions; "fetched" = what the API returned.
      const ORDER = ["7TV set", "7TV channel", "BTTV channel", "FFZ channel", "7TV global", "BTTV global", "FFZ global"];
      const used = {};
      for (const e of emotes.values()) used[e.src || "unknown"] = (used[e.src || "unknown"] || 0) + 1;
      const fetched = res.fetched || {};
      const rows = ORDER.concat(Object.keys(used).filter((k) => !ORDER.includes(k)))
        .map((src) => ({ source: src, fetched: fetched[src] || 0, used: used[src] || 0 }));
      console.log("[VLE] loaded", emotes.size, "unique emotes; scope =", scope,
        "; matching elements now =", document.querySelectorAll(scope).length);
      console.log("[VLE] by source: " + rows.map((r) =>
        r.fetched === r.used ? `${r.source} ${r.used}` : `${r.source} ${r.used}/${r.fetched}`).join(" | "));
      console.table(rows);
      const sx = res.settings || {};
      console.log("[VLE] settings in use: twitchId =", JSON.stringify(sx.twitchId),
        "| ffzChannel =", JSON.stringify(sx.ffzChannel), "| 7TV set =", JSON.stringify(sx.sevenTvSetId),
        "| globals =", sx.useGlobals);
      if (res.requests) console.table(res.requests); // every API request and its result
      start();
      // Process messages already on screen.
      document.querySelectorAll(scope).forEach(processNode);
    }).catch((err) => console.warn("[VLE] could not reach background script", err));
  }

  function inScope(el) {
    return !!el.closest(chatSelector || `${FALLBACK_SCOPE}, ${MULTI_FALLBACK_SCOPE}`);
  }

  function makeImg(name, e) {
    const img = document.createElement("img");
    img.src = e.url;
    img.alt = name;
    img.title = name;
    img.className = "vle-emote";
    img.draggable = false;
    img.style.cssText = `height:${emoteSize}px;width:auto;vertical-align:middle;margin:0 1px;`;
    return img;
  }

  function processTextNode(tn) {
    const parent = tn.parentElement;
    if (!parent || parent.closest(SKIP) || !inScope(parent)) return;

    const text = tn.textContent;
    if (!text || !text.trim()) return;
    const parts = text.split(/(\s+)/);
    if (!parts.some((p) => emotes.has(p))) return;

    const frag = document.createDocumentFragment();
    let lastWrapper = null; // the most recent non-zero-width emote wrapper

    for (const p of parts) {
      const e = emotes.get(p);
      if (!e) {
        // Whitespace between a base emote and an overlay shouldn't break the stack.
        if (!/^\s+$/.test(p)) lastWrapper = null;
        frag.appendChild(document.createTextNode(p));
        continue;
      }
      const img = makeImg(p, e);
      if (e.zw && lastWrapper) {
        img.style.cssText += "position:absolute;left:0;bottom:0;margin:0;";
        lastWrapper.appendChild(img);
      } else {
        const wrap = document.createElement("span");
        wrap.className = "vle-emote";
        wrap.style.cssText = "position:relative;display:inline-block;";
        wrap.appendChild(img);
        frag.appendChild(wrap);
        if (!e.zw) lastWrapper = wrap;
      }
    }
    tn.replaceWith(frag);
    //console.log("[VLE] replaced emotes in:", text);
  }

  function processNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return processTextNode(node);
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.closest && node.closest(".vle-emote, .vle-popup")) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  function start() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) processNode(n);
        if (m.type === "characterData") processTextNode(m.target);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }


  // ---------------- Emote autocomplete ----------------
  let popup = null, items = [], sel = 0, activeEl = null, trigLen = 0, isOpen = false;

  const isEditable = (el) =>
    !!el && (el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && /^(text|search)$/i.test(el.type)) ||
      el.isContentEditable);

  function textBeforeCaret(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      if (el.selectionStart !== el.selectionEnd) return null;
      return el.value.slice(0, el.selectionStart);
    }
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return null;
    const n = s.anchorNode;
    if (!n || n.nodeType !== Node.TEXT_NODE || !el.contains(n)) return null;
    return n.textContent.slice(0, s.anchorOffset);
  }

  function findMatches(q) {
    q = q.toLowerCase();
    const starts = [], contains = [];
    for (const [name, e] of emotes) {
      const l = name.toLowerCase();
      if (l.startsWith(q)) starts.push([name, e]);
      else if (l.includes(q)) contains.push([name, e]);
    }
    const cmp = (a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]);
    return starts.sort(cmp).concat(contains.sort(cmp)).slice(0, 10);
  }

  function hide() {
    isOpen = false;
    items = [];
    if (popup) popup.style.display = "none";
  }

  function highlight() {
    if (!popup) return;
    [...popup.children].forEach((row, i) => {
      row.style.background = i === sel ? "#3a3a3a" : "transparent";
    });
    const cur = popup.children[sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function render() {
    if (!popup) {
      popup = document.createElement("div");
      popup.className = "vle-popup";
      popup.style.cssText =
        "position:fixed;z-index:2147483647;background:#1c1c1c;color:#fff;border:1px solid #444;" +
        "border-radius:6px;padding:4px;font:13px system-ui,sans-serif;min-width:180px;" +
        "box-shadow:0 4px 16px rgba(0,0,0,.5);overflow:auto;";
      popup.addEventListener("mousedown", (e) => e.preventDefault()); // keep input focus
      document.body.appendChild(popup);
    }
    popup.textContent = "";
    items.forEach(([name, e], i) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;";
      const img = document.createElement("img");
      img.src = e.url;
      img.alt = name;
      img.style.cssText = "height:32px;width:auto;max-width:64px;object-fit:contain;";
      const label = document.createElement("span");
      label.textContent = name;
      row.append(img, label);
      row.addEventListener("click", () => { sel = i; accept(); });
      popup.appendChild(row);
    });
    const r = activeEl.getBoundingClientRect();
    popup.style.left = Math.max(4, Math.min(r.left, innerWidth - 260)) + "px";
    popup.style.top = "auto";
    popup.style.bottom = innerHeight - r.top + 6 + "px";
    popup.style.maxHeight = Math.max(80, r.top - 12) + "px";
    popup.style.display = "block";
    isOpen = true;
    highlight();
  }

  function update(el) {
    if (!acEnabled || !isEditable(el)) return hide();
    const before = textBeforeCaret(el);
    const m = before && before.match(/(?:^|\s):([A-Za-z0-9_]+)$/);
    if (!m) return hide();
    const found = findMatches(m[1]);
    if (!found.length) return hide();
    items = found;
    activeEl = el;
    trigLen = m[1].length + 1; // letters + the colon
    sel = 0;
    render();
  }

  function accept() {
    if (!isOpen || !items[sel]) return;
    const name = items[sel][0], el = activeEl, len = trigLen;
    hide();
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const end = el.selectionStart;
      el.setRangeText(name + " ", end - len, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true })); // updates the site's char counter
    } else {
      const s = getSelection(), n = s.anchorNode, off = s.anchorOffset;
      const r = document.createRange();
      r.setStart(n, off - len);
      r.setEnd(n, off);
      s.removeAllRanges();
      s.addRange(r);
      document.execCommand("insertText", false, name + " ");
    }
  }

  document.addEventListener("input", (e) => update(e.target), true);
  document.addEventListener("click", (e) => {
    if (isEditable(e.target)) update(e.target);
    else if (!(popup && popup.contains(e.target))) hide();
  }, true);
  document.addEventListener("focusout", () => hide(), true);
  document.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) update(e.target);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!isOpen || e.target !== activeEl) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === "ArrowDown") { stop(); sel = (sel + 1) % items.length; highlight(); }
    else if (e.key === "ArrowUp") { stop(); sel = (sel - 1 + items.length) % items.length; highlight(); }
    else if (e.key === "Tab") { stop(); accept(); }
    else if (e.key === "Escape") { stop(); hide(); }
    else if (e.key === "Enter") { hide(); } // let the site send the message
  }, true);

  // Reload emotes if settings change.
  ext.storage.onChanged.addListener((_c, area) => {
    if (area === "sync") load();
  });

  load();
})();
