// AutoAnswer - background service worker
// Handles settings, screenshots and the calls to Grok (xAI) / OpenAI.

const DEFAULTS = {
  enabled: false,
  provider: 'grok', // 'grok' | 'openai'
  grokKey: '',
  openaiKey: '',
  grokModel: 'grok-4',
  openaiModel: 'gpt-4o'
};

const PROVIDERS = {
  grok: { base: 'https://api.x.ai/v1', keyField: 'grokKey', modelField: 'grokModel', name: 'Grok' },
  openai: { base: 'https://api.openai.com/v1', keyField: 'openaiKey', modelField: 'openaiModel', name: 'ChatGPT' }
};

const MAX_IMAGE_WIDTH = 1600;
const REQUEST_TIMEOUT_MS = 120000;

function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function updateBadge() {
  const { enabled } = await getSettings();
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in current)) missing[k] = v;
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) updateBadge();
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-enabled') return;
  const { enabled } = await getSettings();
  await chrome.storage.local.set({ enabled: !enabled });
});

// Pick the provider to use: the selected one, or the other one if only it has a key.
function resolveProvider(s) {
  const order = s.provider === 'openai' ? ['openai', 'grok'] : ['grok', 'openai'];
  for (const id of order) {
    const p = PROVIDERS[id];
    if (s[p.keyField] && s[p.keyField].trim()) {
      return { id, ...p, key: s[p.keyField].trim(), model: (s[p.modelField] || DEFAULTS[p.modelField]).trim() };
    }
  }
  return null;
}

async function captureScreenshot(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_IMAGE_WIDTH / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bmp, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { dataUrl: 'data:image/jpeg;base64,' + btoa(bin), width: w, height: h, rawWidth: bmp.width, scale };
}

async function chat({ system, user, image }) {
  const s = await getSettings();
  const p = resolveProvider(s);
  if (!p) throw new Error('NO_KEY');

  const content = image
    ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image, detail: 'high' } }]
    : user;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(p.base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ]
      })
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK: ' + e.message);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message || JSON.parse(text).error || text; } catch (_) {}
    throw new Error(`${p.name} ${res.status}: ${String(msg).slice(0, 300)}`);
  }
  const data = JSON.parse(text);
  const msg = data.choices?.[0]?.message?.content;
  const reply = Array.isArray(msg) ? msg.map((c) => c.text || '').join('') : (msg || '');
  return { reply, provider: p.name, model: p.model };
}

async function listModels(provider, key) {
  const p = PROVIDERS[provider];
  const res = await fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + key } });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch (_) {}
    throw new Error(`${res.status}: ${String(msg).slice(0, 200)}`);
  }
  const data = JSON.parse(text);
  return (data.data || data.models || []).map((m) => m.id).filter(Boolean).sort();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'capture') {
        const shot = await captureScreenshot(sender.tab.windowId);
        sendResponse({ ok: true, ...shot });
      } else if (msg.type === 'ask') {
        const r = await chat(msg);
        sendResponse({ ok: true, ...r });
      } else if (msg.type === 'models') {
        sendResponse({ ok: true, models: await listModels(msg.provider, msg.key) });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
  })();
  return true;
});
