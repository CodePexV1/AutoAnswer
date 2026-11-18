// AutoAnswer - content script
// Double-click a question -> find its container -> ask the AI -> fill in the answer.
(() => {
  if (window.__autoAnswerLoaded) return;
  window.__autoAnswerLoaded = true;

  const UI_ATTR = 'data-autoanswer-ui';
  const MAX_ELEMENTS = 80;
  const MAX_TEXT = 6000;
  const IS_TOP = window === window.top;

  let enabled = false;
  let stealth = true; // hidden mode: nothing is drawn on the page
  let busy = false;

  chrome.storage.local.get({ enabled: false, stealth: true }, (s) => { enabled = !!s.enabled; stealth = !!s.stealth; });
  chrome.storage.onChanged.addListener((c) => {
    if (c.enabled) enabled = !!c.enabled.newValue;
    if (c.stealth) stealth = !!c.stealth.newValue;
  });

  // The popup shows the last result (the only feedback in hidden mode).
  function report(ok, text) {
    try { chrome.storage.local.set({ lastResult: { ok, text: String(text).slice(0, 600), at: Date.now() } }); } catch (_) {}
  }

  // ---------------------------------------------------------------- utils
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isUI = (el) => !!(el && el.closest && el.closest(`[${UI_ATTR}]`));

  function textOf(el) {
    if (!el) return '';
    return norm(el.innerText !== undefined ? el.innerText : el.textContent);
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return true;
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, error: 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, error: 'EXTENSION_RELOADED' });
      }
    });
  }

  // ------------------------------------------------- frame offset (iframes)
  // The screenshot is of the whole tab, so elements inside iframes need the
  // iframe's offset in the top window. Each frame's content script answers
  // its child frames.
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.__autoanswer !== 'offset?') return;
    let frame = null;
    for (const f of document.querySelectorAll('iframe, frame')) if (f.contentWindow === e.source) { frame = f; break; }
    if (!frame) return;
    getFrameOffset().then((o) => {
      const r = frame.getBoundingClientRect();
      const cs = getComputedStyle(frame);
      e.source.postMessage({
        __autoanswer: 'offset!', id: d.id,
        x: o.x + r.left + frame.clientLeft + parseFloat(cs.paddingLeft || 0),
        y: o.y + r.top + frame.clientTop + parseFloat(cs.paddingTop || 0)
      }, '*');
    });
  });

  function getFrameOffset() {
    if (IS_TOP) return Promise.resolve({ x: 0, y: 0 });
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (v) => { window.removeEventListener('message', h); resolve(v); };
      const h = (e) => {
        if (e.data && e.data.__autoanswer === 'offset!' && e.data.id === id) done({ x: e.data.x, y: e.data.y });
      };
      window.addEventListener('message', h);
      try { window.parent.postMessage({ __autoanswer: 'offset?', id }, '*'); } catch (_) {}
      setTimeout(() => done({ x: 0, y: 0 }), 800);
    });
  }

  // ---------------------------------------------------------------- toast
  let toastHost = null;
  let toastTimer = null;
  function toast(text, kind = 'info', ms = 0) {
    if (stealth) return;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.setAttribute(UI_ATTR, '');
      toastHost.style.cssText = 'position:fixed;z-index:2147483647;bottom:18px;left:50%;transform:translateX(-50%);pointer-events:none;';
      const root = toastHost.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .t{font:500 14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;direction:rtl;max-width:min(560px,90vw);
           padding:10px 16px;border-radius:12px;color:#fff;background:#1f2937;box-shadow:0 8px 24px rgba(0,0,0,.25);
           white-space:pre-wrap;word-break:break-word;display:flex;gap:8px;align-items:flex-start}
        .t.ok{background:#15803d}.t.err{background:#b91c1c}
        .s{width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;
           animation:r .8s linear infinite;flex:none;margin-top:3px}
        @keyframes r{to{transform:rotate(360deg)}}</style><div class="t"></div>`;
      (document.body || document.documentElement).appendChild(toastHost);
    }
    const box = toastHost.shadowRoot.querySelector('.t');
    box.className = 't ' + kind;
    box.innerHTML = '';
    if (kind === 'info') { const s = document.createElement('span'); s.className = 's'; box.appendChild(s); }
    const span = document.createElement('span');
    span.setAttribute('dir', 'auto');
    span.textContent = text;
    box.appendChild(span);
    toastHost.style.display = '';
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => { if (toastHost) toastHost.style.display = 'none'; }, ms);
  }
  function hideToast() { if (toastHost) toastHost.style.display = 'none'; }

  // ------------------------------------------------- element classification
  const TEXT_INPUT_SEL = 'input:not([type]),input[type=text],input[type=number],input[type=email],input[type=search],' +
    'input[type=tel],input[type=url],input[type=date],input[type=time],input[type=datetime-local],input[type=month],textarea';
  const CHOICE_SEL = 'input[type=radio],input[type=checkbox],[role=radio],[role=checkbox],[role=switch],[role=menuitemradio],[role=menuitemcheckbox]';
  const DROPDOWN_SEL = 'select,[role=listbox],[role=combobox]';
  const DRAG_SEL = '[draggable=true],.ui-draggable,[class*=draggable],[class*=drag-item],[class*=dragItem],[class*=drag_item],' +
    '[class*=sortable-item],[data-draggable],[data-drag],[cdkdrag],[data-rbd-draggable-id],[data-rfd-draggable-id]';
  const DROP_SEL = '.ui-droppable,[aria-dropeffect]:not([aria-dropeffect=none]),[class*=droppable],[class*=drop-zone],[class*=dropzone],' +
    '[class*=dropZone],[class*=drop_zone],[class*=drop-target],[class*=dropTarget],[class*=drop-area],[class*=dropArea],[class*=slot],' +
    '[class*=blank],[class*=bucket],[data-drop],[data-droppable],[cdkdroplist],[data-rbd-droppable-id],[data-rfd-droppable-id]';
  const AVOID_CLICK_RE = /^(submit|send|next|continue|finish|done|check|clear|reset|back|previous|שלח|שליחה|הגש|הגשה|הבא|המשך|סיום|סיים|בדיקה|בדוק|נקה|ניקוי|הקודם|חזור)/i;

  function labelOf(el) {
    const parts = [];
    const aria = el.getAttribute('aria-label');
    if (aria) parts.push(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) { const t = document.getElementById(id); if (t) parts.push(textOf(t)); }
    if (!parts.length && el.labels && el.labels.length) parts.push(textOf(el.labels[0]));
    if (!parts.length) { const l = el.closest('label'); if (l) parts.push(textOf(l)); }
    if (!parts.length && el.dataset && el.dataset.value) parts.push(el.dataset.value);
    if (!parts.length && !el.matches('input,textarea,select')) {
      const t = textOf(el);
      if (t) parts.push(t);
    }
    if (!parts.length && el.matches('input[type=radio],input[type=checkbox]')) {
      const sib = el.nextSibling;
      const t = sib ? norm(sib.textContent) : '';
      if (t) parts.push(t); else if (el.parentElement) parts.push(textOf(el.parentElement));
    }
    if (!parts.length) {
      for (const a of ['placeholder', 'title', 'alt', 'name']) {
        const v = el.getAttribute(a);
        if (v) { parts.push(v); break; }
      }
    }
    if (!parts.length && el.querySelector) {
      const img = el.querySelector('img[alt]');
      if (img) parts.push('[image: ' + img.alt + ']');
      else if (el.matches('img') && el.alt) parts.push('[image: ' + el.alt + ']');
      else if (el.matches('img,svg,canvas') || el.querySelector('img,svg,canvas')) parts.push('[image]');
    }
    return norm(parts.join(' ')).slice(0, 200);
  }

  function isChecked(el) {
    if (el.matches('input')) return el.checked;
    return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
  }

  function dropdownOptions(el) {
    if (el.matches('select')) return [...el.options].map((o) => norm(o.textContent)).filter(Boolean);
    const opts = [...el.querySelectorAll('[role=option]')]
      .map((o) => norm(o.getAttribute('data-value') || o.getAttribute('aria-label') || o.textContent))
      .filter(Boolean);
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (!opts.length && ctl) {
      const pop = document.getElementById(ctl);
      if (pop) pop.querySelectorAll('[role=option]').forEach((o) => opts.push(norm(o.textContent)));
    }
    return [...new Set(opts)];
  }

  // Native radios/checkboxes are often visually hidden behind a styled label.
  function isVisibleOrProxy(el) {
    if (isVisible(el)) return true;
    if (!el.matches || !el.matches('input[type=radio],input[type=checkbox]')) return false;
    return !!((el.labels && el.labels[0] && isVisible(el.labels[0])) || isVisible(el.parentElement));
  }

  // Collect the interactive elements inside root (in document order).
  function collect(root, { onlyViewport = false, clickables = false } = {}) {
    const out = [];
    const seen = new Set();
    const add = (el, kind) => {
      if (seen.has(el) || isUI(el) || !isVisibleOrProxy(el)) return;
      if (onlyViewport && !inViewport(proxyFor(el))) return;
      seen.add(el);
      out.push({ el, kind });
    };
    const q = (sel) => (root.matches && root.matches(sel) ? [root] : []).concat([...root.querySelectorAll(sel)]);

    q(DROPDOWN_SEL).forEach((el) => {
      if (el.matches('[role=combobox]') && el.querySelector('input,textarea')) return;
      if (el.matches('[role=listbox]') && el.parentElement && el.parentElement.closest('[role=listbox],[role=combobox]')) return;
      add(el, 'dropdown');
    });
    const inDropdown = (el) => out.some((o) => o.kind === 'dropdown' && o.el !== el && o.el.contains(el));

    q(TEXT_INPUT_SEL).forEach((el) => { if (!el.disabled && !el.readOnly && !inDropdown(el)) add(el, 'text'); });
    q('[contenteditable=""],[contenteditable=true],[role=textbox]').forEach((el) => {
      if (el.matches(TEXT_INPUT_SEL) || el.querySelector(TEXT_INPUT_SEL)) return;
      if (el.parentElement && el.parentElement.closest('[contenteditable=""],[contenteditable=true]')) return;
      add(el, 'text');
    });
    q(CHOICE_SEL).forEach((el) => {
      if (inDropdown(el)) return;
      add(el, el.matches('input[type=checkbox],[role=checkbox],[role=switch],[role=menuitemcheckbox]') ? 'checkbox' : 'radio');
    });

    // Draggables: explicit markers + anything styled with a grab/move cursor. Keep the outermost match.
    const drags = q(DRAG_SEL).filter((el) => el !== document.body && !seen.has(el));
    const all = root.querySelectorAll('*');
    if (all.length < 3000) {
      for (const el of all) {
        if (seen.has(el) || isUI(el) || drags.includes(el)) continue;
        const cur = getComputedStyle(el).cursor;
        if (!/grab|move/.test(cur)) continue;
        if (el.parentElement && /grab|move/.test(getComputedStyle(el.parentElement).cursor)) continue;
        drags.push(el);
      }
    }
    drags.filter((el) => !drags.some((o) => o !== el && o.contains(el))).forEach((el) => add(el, 'drag'));
    // Drop zones: keep the innermost match that isn't itself (inside) a draggable.
    const drops = q(DROP_SEL).filter((el) => !seen.has(el) && !drags.some((d) => d.contains(el)));
    drops.filter((el) => !drops.some((o) => o !== el && el.contains(o))).forEach((el) => add(el, 'drop'));

    if (clickables) {
      let n = 0;
      const all = root.querySelectorAll('*');
      for (let i = 0; i < all.length && i < 4000 && n < 40; i++) {
        const el = all[i];
        if (seen.has(el) || isUI(el) || /^(HTML|BODY|LABEL|OPTION|SCRIPT|STYLE)$/.test(el.tagName)) continue;
        if (out.some((o) => o.el.contains(el) || el.contains(o.el) || (o.el.labels && [...o.el.labels].some((l) => l.contains(el))))) continue;
        if (el.closest('label')) continue;
        const isBtn = el.matches('button,[role=button],[onclick],[role=tab],[role=gridcell],[role=option]');
        if (!isBtn && getComputedStyle(el).cursor !== 'pointer') continue;
        if (!isVisible(el) || (onlyViewport && !inViewport(el))) continue;
        const r = el.getBoundingClientRect();
        if (r.width > innerWidth * 0.8 && r.height > innerHeight * 0.5) continue;
        if (!isBtn && el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
        if (el.matches('a[href]:not([href^="#"]):not([href^="javascript"])')) continue;
        if (AVOID_CLICK_RE.test(labelOf(el)) || el.matches('[type=submit]')) continue;
        add(el, 'click');
        n++;
      }
    }
    return out.slice(0, MAX_ELEMENTS);
  }

  // ----------------------------------------------------- question container
  function hasMedia(root) {
    for (const el of root.querySelectorAll('img,canvas,svg,video,picture,[style*="background-image"]')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 40 && r.height >= 40 && isVisible(el)) return true;
    }
    return false;
  }

  function summarize(items) {
    const c = { text: 0, choice: 0, dropdown: 0, drag: 0, drop: 0 };
    for (const { kind } of items) {
      if (kind === 'radio' || kind === 'checkbox') c.choice++;
      else if (c[kind] !== undefined) c[kind]++;
    }
    return c;
  }

  // Clickable pictures (picture-choice questions).
  function pictureChoices(root) {
    let n = 0;
    for (const el of root.querySelectorAll('img,canvas,svg,[role=img]')) {
      if (el.parentElement && el.parentElement.closest('svg')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 30 || !isVisible(el)) continue;
      const clickable = getComputedStyle(el).cursor === 'pointer' || el.closest('button,[role=button],[onclick],a,label,[role=radio],[role=option]');
      if (clickable) n++;
    }
    return n;
  }

  const isQuestion = (c) => c.choice >= 2 || c.text >= 1 || c.dropdown >= 1 || (c.drag >= 1 && (c.drop >= 1 || c.drag >= 2));
  const tooBig = (el) => el.getBoundingClientRect().height > innerHeight * 2.5;

  function findContainer(target) {
    // Google Forms: each question is a [role=listitem].
    const gf = target.closest('[role=listitem]');
    if (gf && /(^|\.)docs\.google\.com$/.test(location.hostname) &&
        gf.querySelector('[role=heading],input,textarea,[role=radio],[role=checkbox],[role=listbox]')) {
      return { root: gf, page: false };
    }

    // Selected text (more than one word) -> start from its common ancestor.
    let start = target;
    const sel = window.getSelection();
    if (sel && sel.rangeCount && norm(sel.toString()).length > 12) {
      const n = sel.getRangeAt(0).commonAncestorContainer;
      start = n.nodeType === 1 ? n : n.parentElement;
    }

    let el = start;
    while (el && el !== document.body && el !== document.documentElement) {
      if (tooBig(el)) break;
      const items = collect(el);
      const c = summarize(items);
      const pics = items.length && isQuestion(c) ? 0 : pictureChoices(el);
      if (items.length || pics >= 2) {
        const hasQuestionText = textOf(el).length > 3 || hasMedia(el);
        if (hasQuestionText && (isQuestion(c) || pics >= 2)) {
          // Drag tasks: keep expanding while it adds more drag/drop items.
          if (c.drag) {
            let best = c.drag + c.drop;
            for (let p = el.parentElement; p && p !== document.body && !tooBig(p); p = p.parentElement) {
              const pc = summarize(collect(p));
              if (pc.drag + pc.drop > best) { el = p; best = pc.drag + pc.drop; }
            }
          }
          return { root: el, page: false };
        }
      }
      el = el.parentElement;
    }
    // Nothing that looks like a question -> the visible page (screenshot mode).
    return { root: document.body, page: true };
  }

  // ------------------------------------------------------------ marks overlay
  // Hidden native inputs are represented by their visible label.
  function proxyFor(el) {
    if (isVisible(el)) return el;
    if (el.labels && el.labels[0] && isVisible(el.labels[0])) return el.labels[0];
    return el.parentElement || el;
  }

  function drawMarks(items) {
    const layer = document.createElement('div');
    layer.setAttribute(UI_ATTR, '');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const colors = { drag: '#ea580c', drop: '#2563eb', click: '#9333ea', text: '#0891b2', dropdown: '#0891b2', radio: '#db2777', checkbox: '#db2777' };
    items.forEach((it, i) => {
      const r = proxyFor(it.el).getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const color = colors[it.kind] || '#dc2626';
      const box = document.createElement('div');
      box.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
        `outline:2px solid ${color};outline-offset:1px;border-radius:3px;`;
      const tag = document.createElement('div');
      tag.textContent = String(i + 1);
      tag.style.cssText = `position:fixed;left:${Math.max(0, r.left - 4)}px;top:${Math.max(0, r.top - 14)}px;background:${color};` +
        'color:#fff;font:bold 12px/16px Arial,sans-serif;padding:0 4px;border-radius:8px;min-width:12px;text-align:center;' +
        'box-shadow:0 0 0 1.5px #fff;';
      layer.appendChild(box);
      layer.appendChild(tag);
    });
    (document.body || document.documentElement).appendChild(layer);
    return () => layer.remove();
  }

  function describe(items, toImg) {
    return items.map((it, i) => {
      const el = it.el;
      const parts = [`#${i + 1} [${it.kind}]`];
      const label = labelOf(el);
      if (it.kind === 'text') {
        const v = el.value !== undefined ? el.value : textOf(el);
        parts.push(`label="${label}"`);
        if (v) parts.push(`current="${String(v).slice(0, 80)}"`);
      } else if (it.kind === 'dropdown') {
        parts.push(`label="${label.slice(0, 80)}"`, `options=${JSON.stringify(dropdownOptions(el).slice(0, 40))}`);
      } else if (it.kind === 'radio' || it.kind === 'checkbox') {
        const group = el.name ? ` group="${el.name}"` : '';
        parts.push(`"${label}"${group}`, isChecked(el) ? '(selected)' : '');
      } else {
        parts.push(`"${label}"`);
      }
      if (toImg) {
        const r = proxyFor(el).getBoundingClientRect();
        const p = toImg(r.left + r.width / 2, r.top + r.height / 2);
        parts.push(`at(${p.x},${p.y})`);
      }
      return parts.filter(Boolean).join(' ');
    }).join('\n');
  }

  // ---------------------------------------------------------------- prompt
  const SYSTEM = `You are an expert tutor who solves school assignments and quiz/form questions in any subject and language (very often Hebrew).
You get the text of ONE question (or a section of a page), a numbered list of the interactive elements that belong to it, and sometimes a screenshot where those same elements are outlined and tagged with their numbers.
Work out the correct answer, then return the UI actions that enter it.

Reply with ONLY a JSON object, no markdown:
{"answer": "<short human readable answer, in the question's language>", "actions": [ ... ]}

Action types:
- {"type":"fill","id":N,"text":"..."}            type text into a text field (#N is [text])
- {"type":"select","id":N,"option":"..."}        pick an option of a [dropdown]; option must be copied exactly from its options list
- {"type":"check","id":N}                         select a [radio] / [checkbox] option
- {"type":"uncheck","id":N}                       un-select a [checkbox]
- {"type":"click","id":N}                         click element #N (e.g. a picture answer, a word to choose)
- {"type":"drag","from":N,"to":M}                 drag element #N onto element #M
- {"type":"drag_xy","from":N,"x":X,"y":Y}         drag element #N to a point in the screenshot (pixels) when the target has no number
- {"type":"click_xy","x":X,"y":Y}                 click a point in the screenshot when the target has no number

Rules:
- Answer EVERY sub-question / blank / field in the given section.
- Multiple choice: check exactly the correct option(s). Checkbox questions may have several correct options.
- Open questions: write a correct, complete, natural answer like a good student would, in the language of the question. Keep it concise unless the question asks for detail. Numeric answers: just the number (with units only if asked).
- Matching / drag-and-drop / ordering: one drag action per item, in a sensible order. Use the screenshot to understand what goes where.
- Never click submit / send / next / check buttons.
- If you cannot determine anything to do, return "actions": [] and explain in "answer".`;

  function buildUserPrompt({ question, list, page, shot, marked }) {
    return [
      `Page: ${document.title || location.hostname}`,
      page ? 'Scope: the visible part of the page (no single question was identified). Solve what is visible.' : 'Scope: a single question block.',
      shot ? (marked
        ? `A screenshot (${shot.width}x${shot.height}px) is attached; numbered tags in it match the element list, at(x,y) are screenshot pixel coordinates.`
        : `A screenshot (${shot.width}x${shot.height}px) is attached (no tags drawn on it); at(x,y) is each listed element's center in screenshot pixel coordinates.`) : '',
      '',
      'QUESTION / SECTION TEXT:',
      question || '(no text - see screenshot)',
      '',
      'INTERACTIVE ELEMENTS:',
      list || '(none detected - use click_xy / drag_xy with screenshot coordinates)'
    ].join('\n');
  }

  function parseReply(reply) {
    let t = String(reply || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    try {
      const j = JSON.parse(t);
      if (!Array.isArray(j.actions)) j.actions = [];
      return j;
    } catch (_) {
      return { answer: String(reply || '').slice(0, 500), actions: [] };
    }
  }

  // ---------------------------------------------------------------- actions
  function pointer(type, el, x, y, extra = {}) {
    const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
    const pressed = extra.pressed !== undefined ? extra.pressed : /down|move/.test(type);
    delete extra.pressed;
    el.dispatchEvent(new Ctor(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x + (window.screenX || 0), screenY: y + (window.screenY || 0),
      button: 0, buttons: pressed ? 1 : 0,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra
    }));
  }

  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function ensureInView(el) {
    if (!inViewport(el)) el.scrollIntoView({ block: 'center', inline: 'center' });
  }

  function fullClick(el) {
    const { x, y } = center(el);
    pointer('pointerover', el, x, y, { pressed: false });
    pointer('mouseover', el, x, y, { pressed: false });
    pointer('pointerdown', el, x, y);
    pointer('mousedown', el, x, y);
    if (el.focus) try { el.focus({ preventScroll: true }); } catch (_) {}
    pointer('pointerup', el, x, y, { pressed: false });
    pointer('mouseup', el, x, y, { pressed: false });
    pointer('click', el, x, y, { pressed: false, detail: 1 });
  }

  async function clickAndVerify(el, wantChecked) {
    ensureInView(proxyFor(el));
    if (isChecked(el) === wantChecked) return true;
    el.click();
    await sleep(120);
    if (isChecked(el) === wantChecked) return true;
    // Some widgets only react to mousedown/mouseup.
    const target = proxyFor(el);
    const { x, y } = center(target);
    pointer('pointerdown', target, x, y); pointer('mousedown', target, x, y);
    pointer('pointerup', target, x, y, { pressed: false }); pointer('mouseup', target, x, y, { pressed: false });
    await sleep(150);
    return isChecked(el) === wantChecked;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fillText(el, text) {
    ensureInView(el);
    text = String(text ?? '');
    el.focus();
    if (el.value === undefined) { // contenteditable / role=textbox
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      if (!document.execCommand('insertText', false, text)) el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    if (/^(date|time|datetime-local|month|number)$/.test(el.type)) {
      setNativeValue(el, text);
    } else {
      try { el.select(); } catch (_) {}
      // insertText behaves like real typing (works with React / Google Forms).
      const ok = document.execCommand('insertText', false, text);
      if (!ok || el.value !== text) setNativeValue(el, text);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    return true;
  }

  function similarity(a, b) {
    a = norm(a).toLowerCase(); b = norm(b).toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.6 * Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.2;
    return 0;
  }

  async function selectOption(el, option) {
    ensureInView(el);
    if (el.matches('select')) {
      let best = null; let bestScore = 0;
      for (const o of el.options) {
        const s = Math.max(similarity(o.textContent, option), similarity(o.value, option));
        if (s > bestScore) { best = o; bestScore = s; }
      }
      if (!best) return false;
      setNativeValue(el, best.value);
      return true;
    }
    // ARIA listbox (Google Forms dropdown etc.): open it, then click the option.
    fullClick(el);
    await sleep(450);
    const pools = [];
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctl && document.getElementById(ctl)) pools.push(document.getElementById(ctl));
    pools.push(el, document);
    let best = null; let bestScore = 0;
    for (const pool of pools) {
      for (const o of pool.querySelectorAll('[role=option]')) {
        if (!isVisible(o)) continue;
        const s = Math.max(similarity(o.getAttribute('data-value'), option), similarity(o.textContent, option), similarity(o.getAttribute('aria-label'), option));
        if (s > bestScore) { best = o; bestScore = s; }
      }
      if (best) break;
    }
    if (!best) return false;
    fullClick(best);
    await sleep(350);
    return true;
  }

  async function dragTo(src, dest) {
    ensureInView(src);
    await sleep(60);
    const s = center(src);
    const d = dest.el ? center(dest.el) : dest;
    const dt = new DataTransfer();
    const at = (x, y) => document.elementFromPoint(x, y) || document.body;
    const dragEv = (el, type, x, y) => el.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y
    }));

    pointer('pointerover', src, s.x, s.y, { pressed: false });
    pointer('mouseover', src, s.x, s.y, { pressed: false });
    pointer('pointerdown', src, s.x, s.y);
    pointer('mousedown', src, s.x, s.y);
    const html5 = src.draggable || src.getAttribute('draggable') === 'true';
    if (html5) dragEv(src, 'dragstart', s.x, s.y);
    await sleep(50);

    const steps = 14;
    let last = null;
    for (let i = 1; i <= steps; i++) {
      const x = s.x + ((d.x - s.x) * i) / steps;
      const y = s.y + ((d.y - s.y) * i) / steps;
      const under = at(x, y);
      pointer('pointermove', under, x, y);
      pointer('mousemove', under, x, y);
      if (html5) {
        const over = i > steps / 2 && dest.el ? dest.el : under;
        if (over !== last) { dragEv(over, 'dragenter', x, y); last = over; }
        dragEv(over, 'dragover', x, y);
        dragEv(src, 'drag', x, y);
      }
      await sleep(25);
    }
    if (html5) {
      dragEv(dest.el || at(d.x, d.y), 'drop', d.x, d.y);
      dragEv(src, 'dragend', d.x, d.y);
    }
    const upEl = at(d.x, d.y);
    pointer('pointerup', upEl, d.x, d.y, { pressed: false });
    pointer('mouseup', upEl, d.x, d.y, { pressed: false });
    await sleep(250);
  }

  async function runActions(actions, items, fromImg) {
    let done = 0;
    const errors = [];
    const get = (id) => items[Number(id) - 1] && items[Number(id) - 1].el;
    for (const a of actions) {
      try {
        const el = get(a.id);
        let ok = false;
        switch (a.type) {
          case 'fill': if (el) ok = await fillText(el, a.text); break;
          case 'select': if (el) ok = await selectOption(el, a.option); break;
          case 'check': if (el) ok = await clickAndVerify(el, true); break;
          case 'uncheck': if (el) ok = await clickAndVerify(el, false); break;
          case 'click': if (el) { ensureInView(proxyFor(el)); fullClick(proxyFor(el)); ok = true; } break;
          case 'drag': {
            const src = get(a.from); const dst = get(a.to);
            if (src && dst) { await dragTo(src, { el: dst }); ok = true; }
            break;
          }
          case 'drag_xy': {
            const src = get(a.from);
            if (src && fromImg) { await dragTo(src, fromImg(a.x, a.y)); ok = true; }
            break;
          }
          case 'click_xy': {
            const p = fromImg && fromImg(a.x, a.y);
            const t = p && document.elementFromPoint(p.x, p.y);
            if (t && !isUI(t)) { fullClick(t); ok = true; }
            break;
          }
        }
        if (ok) done++; else errors.push(JSON.stringify(a));
      } catch (e) {
        errors.push(`${a.type}: ${e.message}`);
      }
      await sleep(140);
    }
    return { done, errors };
  }

  // ---------------------------------------------------------------- main
  function visibleText() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = norm(n.textContent);
      const p = n.parentElement;
      if (!t || !p || isUI(p) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
      const r = p.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.width === 0) continue;
      out.push(t);
    }
    return out.join('\n');
  }

  async function solve(target) {
    busy = true;
    const { root, page } = findContainer(target);
    window.getSelection()?.removeAllRanges();

    const highlight = page ? null : root;
    const prevOutline = highlight ? highlight.style.outline : '';
    const setHighlight = (on) => { if (highlight && !stealth) highlight.style.outline = on ? '2px dashed #16a34a' : prevOutline; };
    setHighlight(true);

    try {
      const items = collect(root, { onlyViewport: page, clickables: true });
      const question = (page ? visibleText() : textOf(root)).slice(0, MAX_TEXT);
      const c = summarize(items);
      const needShot = page || c.drag > 0 || c.drop > 0 || hasMedia(root) || (c.text + c.choice + c.dropdown === 0) ||
        !!root.querySelector('canvas,svg,math,.MathJax,mjx-container,.katex');

      let shot = null; let toImg = null; let fromImg = null; let shotMarked = false;
      if (needShot) {
        if (!page) {
          const r = root.getBoundingClientRect();
          if (r.height < innerHeight && (r.top < 0 || r.bottom > innerHeight)) {
            root.scrollIntoView({ block: 'center' });
            await sleep(300);
          }
        }
        const off = await getFrameOffset();
        setHighlight(false);
        hideToast();
        const marked = !stealth;
        const removeMarks = marked ? drawMarks(items) : () => {};
        if (marked) await sleep(100);
        shotMarked = marked;
        const res = await send({ type: 'capture' });
        removeMarks();
        setHighlight(true);
        if (res.ok) {
          shot = res;
          const f = (window.devicePixelRatio || 1) * res.scale; // css px -> screenshot px
          toImg = (x, y) => ({ x: Math.round((x + off.x) * f), y: Math.round((y + off.y) * f) });
          fromImg = (x, y) => ({ x: Number(x) / f - off.x, y: Number(y) / f - off.y });
        }
      }

      toast('AutoAnswer חושב...', 'info');
      const res = await send({
        type: 'ask',
        system: SYSTEM,
        user: buildUserPrompt({ question, list: describe(items, toImg), page, shot, marked: shotMarked }),
        image: shot ? shot.dataUrl : null
      });
      if (!res.ok) throw new Error(res.error);

      const j = parseReply(res.reply);
      const { done, errors } = await runActions(j.actions, items, fromImg);
      const ans = norm(String(j.answer || ''));
      if (errors.length) console.warn('[AutoAnswer] failed actions:', errors);
      if (j.actions.length && !done) {
        report(false, `לא הצלחתי למלא אוטומטית. תשובה: ${ans}`);
        toast(`לא הצלחתי למלא אוטומטית.\nתשובה: ${ans}`, 'err', 15000);
      } else {
        report(true, `${ans || 'בוצע'}${errors.length ? ` (${errors.length} פעולות נכשלו)` : ''}`);
        toast(`✓ ${ans || 'בוצע'}${errors.length ? `\n(${errors.length} פעולות נכשלו)` : ''}`, 'ok', Math.min(15000, 4000 + ans.length * 60));
      }
    } catch (e) {
      const m = String(e.message || e);
      const friendly = m === 'NO_KEY' ? 'חסר מפתח API - פתח את התוסף והזן מפתח Groq או ChatGPT'
        : m === 'TIMEOUT' ? 'הבקשה ל-AI לקחה יותר מדי זמן'
          : m === 'EXTENSION_RELOADED' || /context invalidated/i.test(m) ? 'התוסף עודכן - רענן את הדף (F5)' : m;
      report(false, friendly);
      toast('✗ ' + friendly, 'err', 9000);
    } finally {
      setHighlight(false);
      busy = false;
    }
  }

  document.addEventListener('dblclick', (e) => {
    if (!enabled || busy || !e.isTrusted || isUI(e.target)) return;
    solve(e.target);
  }, true);
})();
