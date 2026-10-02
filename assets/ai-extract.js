/* Rondor Excavations — AI document extraction (4 providers).
 *
 * Sends a parked document (blueprint, material quote, invoice…) to an AI
 * provider directly from the browser and gets back structured JSON the quote
 * builder can pre-populate from.
 *
 * PROVIDERS (Settings → AI extraction):
 *   Anthropic — browser-direct Messages API call
 *     (anthropic-dangerous-direct-browser-access: true). PDFs via document
 *     blocks, images via image blocks.
 *   OpenAI — https://api.openai.com/v1/chat/completions, Bearer key,
 *     vision via image_url blocks, response_format json_object. IMAGES ONLY —
 *     PDFs are refused with a friendly note (convert pages to images first,
 *     or use Anthropic for PDFs).
 *   NVIDIA NIM — https://integrate.api.nvidia.com/v1/chat/completions, which
 *     is OpenAI-compatible, so it shares the OpenAI code path.
 *   Ollama — local server (default http://localhost:11434), POST /api/chat
 *     with base64 images. No key. Only works when the app is opened on the
 *     same machine running Ollama (it will NOT work from a phone).
 *
 * PRIVACY: each provider's API key lives ONLY in the browser's localStorage
 * (keys 'rondor_ai_key_<provider>'). A key is never written to disk on any
 * server, never logged, never shown in the UI, and is attached only to that
 * provider's host, only when the owner taps "Extract with AI". Each
 * extraction burns a small amount of the owner's own API credit (except
 * Ollama, which is free and local).
 */

/* =====================================================================
   TUNING ZONE — edit the models, prompt, and schema below to change what
   the extractor pulls out of documents. The review screen in app.js
   (vExtractReview) must stay in sync with the JSON schema: job_name,
   customer {name, address, phone, email}, line_items[] {description,
   quantity, unit, unit_price, category}, notes, document_type.
   ===================================================================== */
window.RondorAI = (() => {
'use strict';

const MODEL = 'claude-sonnet-4-5';          // Anthropic default (vision-capable Sonnet)
const MAX_TOKENS = 4000;
const MAX_BYTES = 20 * 1024 * 1024;         // refuse files over 20 MB

const LS_PROVIDER = 'rondor_ai_provider';
const LS_KEY_PREFIX = 'rondor_ai_key_';      // + provider id
const LS_MODEL_PREFIX = 'rondor_ai_model_';  // + provider id
const LS_OLLAMA_URL = 'rondor_ai_ollama_url';
const LEGACY_ANTHROPIC_KEY = 'rondor_anthropic_key'; // migrated on read

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    host: 'api.anthropic.com',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-5',
    needsKey: true,
    keyLabel: 'Anthropic API key',
    keyHint: 'sk-ant-…',
    keyHelp: 'Get a key at console.anthropic.com → API keys.',
    supportsPdf: true,
    note: ''
  },
  openai: {
    label: 'OpenAI',
    host: 'api.openai.com',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    needsKey: true,
    keyLabel: 'OpenAI API key',
    keyHint: 'sk-…',
    keyHelp: 'Get a key at platform.openai.com → API keys.',
    supportsPdf: false,
    pdfNote: 'OpenAI vision reads images only, not PDFs — convert the PDF pages to JPG/PNG first, or switch to Anthropic for PDFs.'
  },
  nvidia: {
    label: 'NVIDIA NIM',
    host: 'integrate.api.nvidia.com',
    apiUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    defaultModel: 'meta/llama-3.2-90b-vision-instruct',
    needsKey: true,
    keyLabel: 'NVIDIA API key',
    keyHint: 'nvapi-…',
    keyHelp: 'Get a key at build.nvidia.com → API keys.',
    supportsPdf: false,
    openaiCompatible: true,
    pdfNote: 'NVIDIA NIM vision reads images only, not PDFs — convert the PDF pages to JPG/PNG first, or switch to Anthropic for PDFs.'
  },
  ollama: {
    label: 'Ollama (local)',
    host: null, // user-configurable
    apiUrl: null,
    defaultModel: 'llama3.2-vision',
    defaultBaseUrl: 'http://localhost:11434',
    needsKey: false,
    supportsPdf: false,
    pdfNote: 'Ollama vision reads images only, not PDFs — convert the PDF pages to JPG/PNG first, or switch to Anthropic for PDFs.',
    note: 'Ollama runs on your own computer — extraction only works when this app is opened on the same machine running Ollama. It will not work from a phone.'
  }
};
const PROVIDER_IDS = ['anthropic', 'openai', 'nvidia', 'ollama'];

const CATEGORIES = ['materials', 'labour', 'equipment', 'sub-trades', 'permits', 'other'];
const DOC_TYPES = ['blueprint', 'material_quote', 'invoice', 'other'];

const SYSTEM_PROMPT =
  'You are a data-extraction assistant for Rondor Excavations Ltd., a Canadian ' +
  'excavation contractor in Manitoba. Extract structured estimating data from the ' +
  'provided document. Return ONLY valid JSON — no markdown fences, no commentary, ' +
  'no extra keys.';

const JSON_SCHEMA = `{
  "job_name": string,        // short project/job name, e.g. "123 Main St - sewer replacement"
  "customer": {
    "name": string,          // customer or project name as shown
    "address": string,
    "phone": string,
    "email": string
  },
  "line_items": [
    {
      "description": string, // e.g. "150mm PVC sewer pipe"
      "quantity": number,    // numeric quantity; 0 if not determinable
      "unit": string,        // e.g. "m", "each", "hrs", "loads"
      "unit_price": number,  // price per unit in CAD; 0 if not shown
      "category": "materials|labour|equipment|sub-trades|permits|other"
    }
  ],
  "notes": string,           // anything relevant that did not fit above
  "document_type": "blueprint|material_quote|invoice|other"
}`;

const USER_PROMPT =
  'Analyze the attached document and extract estimating data as a single JSON ' +
  'object exactly matching this schema:\n' + JSON_SCHEMA + '\n\n' +
  'Rules:\n' +
  '- BLUEPRINTS / site plans: pull visible quantities, dimensions, pipe runs ' +
  '(length + diameter), counts of structures (catchbasins, manholes), and any ' +
  'noted materials. Set unit_price to 0 when the plan shows no prices.\n' +
  '- MATERIAL QUOTES / supplier quotes: pull every line item with its description, ' +
  'quantity, unit, and unit price. Use the supplier totals only as a sanity check.\n' +
  '- INVOICES: same as material quotes.\n' +
  '- Guess category from the description; default to "other" when unsure.\n' +
  '- Keep descriptions short and factual. Use numbers (not strings) for quantity ' +
  'and unit_price. Return ONLY the JSON object.';

/* ---------------- settings (localStorage only) ---------------- */
function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }
  catch (e) {}
}

function getProvider() {
  const p = lsGet(LS_PROVIDER);
  return PROVIDER_IDS.includes(p) ? p : 'anthropic';
}
function setProvider(p) {
  if (PROVIDER_IDS.includes(p)) lsSet(LS_PROVIDER, p);
}
function getKey(provider) {
  const p = provider || getProvider();
  const k = lsGet(LS_KEY_PREFIX + p);
  if (k) return k;
  // one-time grace: the old single-key install stored the Anthropic key here
  if (p === 'anthropic') return lsGet(LEGACY_ANTHROPIC_KEY);
  return '';
}
function setKey(k, provider) {
  const p = provider || getProvider();
  lsSet(LS_KEY_PREFIX + p, k);
  if (p === 'anthropic' && k) { try { localStorage.removeItem(LEGACY_ANTHROPIC_KEY); } catch (e) {} }
}
function hasKey(provider) {
  const p = provider || getProvider();
  return !PROVIDERS[p].needsKey || !!getKey(p);
}
function getModel(provider) {
  const p = provider || getProvider();
  return lsGet(LS_MODEL_PREFIX + p) || PROVIDERS[p].defaultModel;
}
function setModel(m, provider) {
  const p = provider || getProvider();
  lsSet(LS_MODEL_PREFIX + p, (m || '').trim());
}
function getOllamaUrl() { return lsGet(LS_OLLAMA_URL) || PROVIDERS.ollama.defaultBaseUrl; }
function setOllamaUrl(u) { lsSet(LS_OLLAMA_URL, (u || '').trim()); }

/* ---------------- helpers ---------------- */
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(new Error('Could not read the file.'));
    fr.readAsDataURL(blob);
  });
}

/* Pull a JSON object out of model text, tolerating fences and chatter. */
function parseJson(text) {
  let t = String(text || '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/* Coerce the model's output into the schema shape; never throws. */
function normalize(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const cust = (r.customer && typeof r.customer === 'object') ? r.customer : {};
  const items = Array.isArray(r.line_items) ? r.line_items : [];
  return {
    job_name: String(r.job_name || ''),
    customer: {
      name: String(cust.name || ''),
      address: String(cust.address || ''),
      phone: String(cust.phone || ''),
      email: String(cust.email || '')
    },
    line_items: items.map(li => {
      const o = (li && typeof li === 'object') ? li : {};
      const cat = String(o.category || 'other').toLowerCase().replace(/[_\s]+/g, '-');
      const catNorm = CATEGORIES.includes(cat) ? cat
        : (CATEGORIES.includes(String(o.category || '').toLowerCase()) ? String(o.category).toLowerCase() : 'other');
      return {
        description: String(o.description || ''),
        quantity: +o.quantity || 0,
        unit: String(o.unit || ''),
        unit_price: +o.unit_price || 0,
        category: catNorm
      };
    }).filter(li => li.description),
    notes: String(r.notes || ''),
    document_type: DOC_TYPES.includes(String(r.document_type || '').toLowerCase())
      ? String(r.document_type).toLowerCase() : 'other'
  };
}

function friendlyError(providerId, status, bodyText) {
  const cfg = PROVIDERS[providerId] || PROVIDERS.anthropic;
  let detail = '';
  try {
    const b = JSON.parse(bodyText || '{}');
    detail = (b.error && (b.error.message || b.error)) || b.message || '';
    if (typeof detail !== 'string') detail = '';
  } catch (e) {}
  if (status === 401 || status === 403)
    return 'The API key was rejected by ' + cfg.label + '. Check it in Settings → AI extraction and paste it again.';
  if (status === 429)
    return cfg.label + ' rate-limited the request. Wait a minute and try again.';
  if (status === 400 && /model/i.test(detail))
    return 'The model "' + getModel(providerId) + '" was not accepted (' + detail + '). Check the model name in Settings → AI extraction.';
  if (status >= 500)
    return cfg.label + ' had a server problem (' + status + '). Try again in a bit.';
  return 'Extraction failed (HTTP ' + status + '). ' + (detail || 'Please try again.');
}

/* ---------------- provider calls ---------------- */
async function callAnthropic({ b64, mime, isPdf }) {
  const key = getKey('anthropic');
  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64',
        media_type: /png/i.test(mime || '') ? 'image/png' : 'image/jpeg', data: b64 } };
  let res;
  try {
    res = await fetch(PROVIDERS.anthropic.apiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: getModel('anthropic'),
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [media, { type: 'text', text: USER_PROMPT }] }]
      })
    });
  } catch (e) {
    throw new Error('Could not reach api.anthropic.com — check your connection and try again.');
  }
  if (!res.ok) throw new Error(friendlyError('anthropic', res.status, await res.text().catch(() => '')));
  const data = await res.json();
  const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  if (!text) throw new Error('The model returned no text. Try again.');
  return text;
}

/* OpenAI + NVIDIA NIM share this OpenAI-compatible path. */
async function callOpenAICompatible(providerId, { b64, mime }) {
  const cfg = PROVIDERS[providerId];
  const key = getKey(providerId);
  const mediaType = /png/i.test(mime || '') ? 'image/png' : 'image/jpeg';
  const body = {
    model: getModel(providerId),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: USER_PROMPT },
        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + b64 } }
      ]}
    ],
    response_format: { type: 'json_object' },
    max_tokens: MAX_TOKENS
  };
  let res;
  try {
    res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('Could not reach ' + cfg.host + ' — check your connection and try again.');
  }
  if (!res.ok) throw new Error(friendlyError(providerId, res.status, await res.text().catch(() => '')));
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('The model returned no text. Try again.');
  return text;
}

async function callOllama({ b64 }) {
  const base = getOllamaUrl().replace(/\/+$/, '');
  const model = getModel('ollama');
  let res;
  try {
    res = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT, images: [b64] }
        ]
      })
    });
  } catch (e) {
    throw new Error('Could not reach Ollama at ' + base + ' — is Ollama running on this machine? ' +
      'Note: Ollama only works when this app is opened on the same computer as Ollama (it will not work from a phone).');
  }
  if (!res.ok)
    throw new Error('Ollama returned HTTP ' + res.status + '. Check the model name ("' + model +
      '") is pulled — run `ollama pull ' + model + '` on that machine.');
  const data = await res.json();
  const text = data.message && data.message.content;
  if (!text) throw new Error('Ollama returned no text. Try again.');
  return text;
}

/* ---------------- main entry ---------------- */
async function extract({ blob, fileName, mime }) {
  const provider = getProvider();
  const cfg = PROVIDERS[provider];
  if (cfg.needsKey && !getKey()) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
  if (blob.size > MAX_BYTES) throw new Error('That file is too large to send (over 20 MB).');

  const b64 = await blobToBase64(blob);
  const isPdf = /pdf/i.test(mime || '') || /\.pdf$/i.test(fileName || '');
  if (isPdf && !cfg.supportsPdf) throw new Error(cfg.pdfNote);

  let text;
  if (provider === 'anthropic') text = await callAnthropic({ b64, mime, isPdf });
  else if (provider === 'ollama') text = await callOllama({ b64 });
  else text = await callOpenAICompatible(provider, { b64, mime });

  let parsed;
  try { parsed = parseJson(text); }
  catch (e) { throw new Error('The model did not return usable JSON. Try again or with a clearer scan.'); }
  return normalize(parsed);
}

return { MODEL, PROVIDERS, PROVIDER_IDS, CATEGORIES, DOC_TYPES, JSON_SCHEMA,
         getProvider, setProvider, getKey, setKey, hasKey,
         getModel, setModel, getOllamaUrl, setOllamaUrl,
         extract, parseJson, normalize };
})();
