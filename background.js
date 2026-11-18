// AutoAnswer - background service worker
// Handles settings, screenshots and the calls to Groq (free) / OpenAI.

const DEFAULTS = {
  enabled: false,
  stealth: true, // hide everything on the page (no outline, no toasts, no badge)
  provider: 'groq', // 'groq' | 'openai'
  groqKey: '',
  openaiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  groqVisionModel: 'qwen/qwen3.8-27b', // used automatically when a screenshot is attached
  openaiModel: 'gpt-4o'
};

const PROVIDERS = {
  groq: { base: 'https://api.groq.com/openai/v1', keyField: 'groqKey', modelField: 'groqModel', name: 'Groq' },
  openai: { base: 'https://api.openai.com/v1', keyField: 'openaiKey', modelField: 'openaiModel', name: 'ChatGPT' }
};
// Groq models that accept images (see console.groq.com/docs/vision).
const GROQ_VISION_RE = /qwen3\.8|muse-spark|vision|llama-4/i;

const MAX_IMAGE_WIDTH = 1600;
const REQUEST_TIMEOUT_MS = 120000;

function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

async function updateBadge() {
  const { enabled, stealth } = await getSettings();
  await chrome.action.setBadgeText({ text: enabled && !stealth ? 'ON' : '' });
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
  if (changes.enabled || changes.stealth) updateBadge();
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-enabled') return;
  const { enabled } = await getSettings();
  await chrome.storage.local.set({ enabled: !enabled });
});

// Pick the provider to use: the selected one, or the other one if only it has a key.
function resolveProvider(s) {
  const order = s.provider === 'openai' ? ['openai', 'groq'] : ['groq', 'openai'];
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

  let model = p.model;
  let messages;
  if (p.id === 'groq') {
    // Groq: switch to a vision model for screenshots, keep the prompt in one user message.
    if (image && !GROQ_VISION_RE.test(model)) model = (s.groqVisionModel || DEFAULTS.groqVisionModel).trim();
    messages = image
      ? [{ role: 'user', content: [{ type: 'text', text: system + '\n\n' + user }, { type: 'image_url', image_url: { url: image } }] }]
      : [{ role: 'system', content: system }, { role: 'user', content: user }];
  } else {
    const content = image
      ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image, detail: 'high' } }]
      : user;
    messages = [{ role: 'system', content: system }, { role: 'user', content }];
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(p.base + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({ model, messages })
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
  let reply = Array.isArray(msg) ? msg.map((c) => c.text || '').join('') : (msg || '');
  reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(); // reasoning models (Qwen) may inline their thinking
  return { reply, provider: p.name, model };
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
