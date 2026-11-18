// Mock harness: runs content.js inside a normal page (no extension) with a
// rule-based "AI" so detection + filling + dragging can be tested offline.
// Open http://localhost:5577/test/index.html?mock
(() => {
  const log = (window.__aaLog = []);
  const lines = (prompt) => prompt.split('INTERACTIVE ELEMENTS:')[1].trim().split('\n');
  const find = (prompt, re) => {
    const l = lines(prompt).find((x) => re.test(x));
    return l ? Number(l.match(/^#(\d+)/)[1]) : null;
  };
  const findAll = (prompt, re) => lines(prompt).filter((x) => re.test(x)).map((x) => Number(x.match(/^#(\d+)/)[1]));

  function oracle(p) {
    const q = p.split('QUESTION / SECTION TEXT:')[1].split('INTERACTIVE ELEMENTS:')[0];
    if (/בירת צרפת/.test(q)) return { answer: 'פריז', actions: [{ type: 'check', id: find(p, /"פריז"/) }] };
    if (/ראשוניים/.test(q)) return { answer: '7, 11', actions: [{ type: 'check', id: find(p, /"7"/) }, { type: 'check', id: find(p, /"11"/) }] };
    if (/12 כפול 7/.test(q)) return { answer: '84', actions: [{ type: 'fill', id: find(p, /\[text\]/), text: '84' }] };
    if (/פוטוסינתזה/.test(q)) return { answer: 'תהליך...', actions: [{ type: 'fill', id: find(p, /\[text\]/), text: 'תהליך שבו צמחים מייצרים סוכר וחמצן מאור, מים ופחמן דו-חמצני.' }] };
    if (/יבשת/.test(q)) return { answer: 'אפריקה', actions: [{ type: 'select', id: find(p, /\[dropdown\]/), option: 'אפריקה' }] };
    if (/עכביש/.test(q)) return { answer: '8', actions: [{ type: 'check', id: find(p, /\[radio\] "8"/) }] };
    if (/גרור כל מדינה/.test(q)) {
      const pairs = [['יפן', 'טוקיו'], ['איטליה', 'רומא'], ['מצרים', 'קהיר']];
      return { answer: 'matched', actions: pairs.map(([a, b]) => ({ type: 'drag', from: find(p, new RegExp(`\\[drag\\] "${a}"`)), to: find(p, new RegExp(`\\[drop\\] "${b}"`)) })) };
    }
    if (/זוגי/.test(q)) {
      const even = find(p, /\[drop\] "זוגי"/); const odd = find(p, /\[drop\] "אי-זוגי"/);
      return { answer: 'sorted', actions: ['3', '8', '14', '21'].map((n) => ({ type: 'drag', from: find(p, new RegExp(`\\[drag\\] "${n}"`)), to: Number(n) % 2 ? odd : even })) };
    }
    if (/משולשים/.test(q)) return { answer: '3', actions: [{ type: 'fill', id: find(p, /\[text\]/), text: '3' }] };
    if (/עיגול אדום/.test(q)) return { answer: '2nd', actions: [{ type: 'click', id: findAll(p, /\[click\]/)[1] }] };
    return { answer: 'unknown', actions: [] };
  }

  window.chrome = window.chrome || {};
  window.chrome.storage = {
    local: { get: (d, cb) => cb({ ...d, enabled: true }) },
    onChanged: { addListener() {} }
  };
  window.chrome.runtime = {
    lastError: null,
    onMessage: { addListener() {} },
    sendMessage(msg, cb) {
      setTimeout(() => {
        if (msg.type === 'capture') {
          log.push({ type: 'capture' });
          const dpr = window.devicePixelRatio || 1;
          cb({ ok: true, dataUrl: 'data:,', width: innerWidth * dpr, height: innerHeight * dpr, rawWidth: innerWidth * dpr, scale: 1 });
        } else if (msg.type === 'ask') {
          const reply = oracle(msg.user);
          log.push({ type: 'ask', image: !!msg.image, prompt: msg.user, reply });
          cb({ ok: true, reply: JSON.stringify(reply) });
        }
      }, 50);
    }
  };
  const s = document.createElement('script');
  s.src = '/content.js';
  document.head.appendChild(s);
})();
