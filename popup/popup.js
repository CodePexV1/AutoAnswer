const DEFAULTS = {
  enabled: false,
  stealth: true,
  provider: 'groq',
  groqKey: '',
  openaiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  openaiModel: 'gpt-4o',
  lastResult: null
};
const FIELDS = {
  groq: { key: 'groqKey', model: 'groqModel', placeholder: 'gsk_...' },
  openai: { key: 'openaiKey', model: 'openaiModel', placeholder: 'sk-...' }
};
const DEFAULT_HINT = 'לחיצה כפולה על שאלה = תשובה אוטומטית';

const $ = (id) => document.getElementById(id);
let state = { ...DEFAULTS };

function hint(text, kind = '') {
  const h = $('hint');
  h.textContent = text || DEFAULT_HINT;
  h.className = 'hint ' + kind;
}

function renderLast() {
  const r = state.lastResult;
  const el = $('last');
  if (!r) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'last ' + (r.ok ? 'ok' : 'err');
  const t = new Date(r.at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  $('lastText').textContent = (r.ok ? '✓ ' : '✗ ') + r.text;
  $('lastTime').textContent = t;
}

function render() {
  if (!FIELDS[state.provider]) state.provider = 'groq';
  $('enabled').checked = !!state.enabled;
  $('stealth').checked = !!state.stealth;
  const st = $('status');
  st.textContent = state.enabled ? 'פעיל - לחץ פעמיים על שאלה' : 'כבוי';
  st.className = 'status' + (state.enabled ? ' on' : '');
  for (const b of document.querySelectorAll('.seg button')) {
    b.setAttribute('aria-checked', String(b.dataset.provider === state.provider));
  }
  const f = FIELDS[state.provider];
  $('key').value = state[f.key] || '';
  $('key').placeholder = f.placeholder;
  $('model').value = state[f.model] || '';
  renderLast();
}

async function loadModels() {
  const f = FIELDS[state.provider];
  const key = (state[f.key] || '').trim();
  const list = $('models');
  list.innerHTML = '';
  if (!key) return;
  const provider = state.provider;
  const res = await chrome.runtime.sendMessage({ type: 'models', provider, key });
  if (provider !== state.provider) return;
  if (!res || !res.ok) {
    hint('המפתח לא תקין: ' + (res ? res.error : ''), 'err');
    return;
  }
  for (const id of res.models) {
    const o = document.createElement('option');
    o.value = id;
    list.appendChild(o);
  }
  hint('✓ המפתח תקין (' + res.models.length + ' מודלים)', 'ok');
}

async function save(patch) {
  Object.assign(state, patch);
  await chrome.storage.local.set(patch);
  render();
}

$('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));
$('stealth').addEventListener('change', (e) => save({ stealth: e.target.checked }));

for (const b of document.querySelectorAll('.seg button')) {
  b.addEventListener('click', async () => {
    await save({ provider: b.dataset.provider });
    hint();
    loadModels();
  });
}

let keyTimer;
$('key').addEventListener('input', (e) => {
  clearTimeout(keyTimer);
  const f = FIELDS[state.provider];
  state[f.key] = e.target.value.trim();
  keyTimer = setTimeout(async () => {
    await chrome.storage.local.set({ [f.key]: state[f.key] });
    hint();
    loadModels();
  }, 500);
});

$('model').addEventListener('change', (e) => {
  const f = FIELDS[state.provider];
  save({ [f.model]: e.target.value.trim() || DEFAULTS[f.model] });
});

chrome.storage.onChanged.addListener((c) => {
  if (c.lastResult) { state.lastResult = c.lastResult.newValue; renderLast(); }
});

chrome.storage.local.get(DEFAULTS).then((s) => {
  state = s;
  render();
  loadModels();
});
