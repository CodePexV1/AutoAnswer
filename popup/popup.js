const DEFAULTS = {
  enabled: false,
  provider: 'grok',
  grokKey: '',
  openaiKey: '',
  grokModel: 'grok-4',
  openaiModel: 'gpt-4o'
};
const FIELDS = {
  grok: { key: 'grokKey', model: 'grokModel', placeholder: 'xai-...' },
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

function render() {
  $('enabled').checked = !!state.enabled;
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

chrome.storage.local.get(DEFAULTS).then((s) => {
  state = s;
  render();
  loadModels();
});
