/* Rondor Excavations — AI document extraction.
 *
 * Sends a parked document (blueprint, material quote, invoice…) to the
 * Anthropic Messages API directly from the browser and gets back structured
 * JSON the quote builder can pre-populate from.
 *
 * PRIVACY: the owner's Anthropic API key lives ONLY in their browser's
 * localStorage (key 'rondor_anthropic_key'). It is never written to disk on
 * any server, never logged, and never shown in the UI. The only network call
 * it is ever attached to is https://api.anthropic.com/v1/messages, made when
 * the owner taps "Extract with AI". Each extraction burns a small amount of
 * the owner's own Anthropic API credit.
 *
 * BROWSER ACCESS: browsers block the x-api-key header by default; the
 * 'anthropic-dangerous-direct-browser-access: true' header opts into
 * Anthropic's supported direct-browser flow (see their docs).
 */

/* =====================================================================
   TUNING ZONE — edit the model, prompt, and schema below to change what
   the extractor pulls out of documents. The review screen in app.js
   (vExtractReview) must stay in sync with the JSON schema: job_name,
   customer {name, address, phone, email}, line_items[] {description,
   quantity, unit, unit_price, category}, notes, document_type.
   ===================================================================== */
window.RondorAI = (() => {
'use strict';

const MODEL = 'claude-sonnet-4-5';          // vision-capable Sonnet
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MAX_TOKENS = 4000;
const KEY_LS = 'rondor_anthropic_key';       // localStorage key for the API key
const MAX_BYTES = 20 * 1024 * 1024;          // refuse files over 20 MB

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

/* ---------------- key management (localStorage only) ---------------- */
function getKey() {
  try { return localStorage.getItem(KEY_LS) || ''; } catch (e) { return ''; }
}
function setKey(k) {
  try {
    if (k) localStorage.setItem(KEY_LS, k);
    else localStorage.removeItem(KEY_LS);
  } catch (e) {}
}
function hasKey() { return !!getKey(); }

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

function friendlyError(status, bodyText) {
  let detail = '';
  try {
    const b = JSON.parse(bodyText || '{}');
    detail = (b.error && b.error.message) || '';
  } catch (e) {}
  if (status === 401) return 'The API key was rejected by Anthropic. Check it in Settings → AI extraction and paste it again.';
  if (status === 429) return 'Anthropic rate-limited the request. Wait a minute and try again.';
  if (status === 400 && /model/i.test(detail)) return 'The model "' + MODEL + '" was not accepted (' + detail + '). Your API key may not have access to it — try the latest Sonnet in the code tuning zone.';
  if (status >= 500) return 'Anthropic had a server problem (' + status + '). Try again in a bit.';
  return 'Extraction failed (HTTP ' + status + '). ' + (detail || 'Please try again.');
}

/* ---------------- main entry ---------------- */
async function extract({ blob, fileName, mime }) {
  const key = getKey();
  if (!key) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
  if (blob.size > MAX_BYTES) throw new Error('That file is too large to send (over 20 MB).');

  const b64 = await blobToBase64(blob);
  const isPdf = /pdf/i.test(mime || '') || /\.pdf$/i.test(fileName || '');
  const media = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64',
        media_type: /png/i.test(mime || '') ? 'image/png' : 'image/jpeg', data: b64 } };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [media, { type: 'text', text: USER_PROMPT }] }]
      })
    });
  } catch (e) {
    throw new Error('Could not reach api.anthropic.com — check your connection and try again.');
  }
  if (!res.ok) throw new Error(friendlyError(res.status, await res.text().catch(() => '')));
  const data = await res.json();
  const text = (data.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
  if (!text) throw new Error('The model returned no text. Try again.');
  let parsed;
  try { parsed = parseJson(text); }
  catch (e) { throw new Error('The model did not return usable JSON. Try again or with a clearer scan.'); }
  return normalize(parsed);
}

return { MODEL, CATEGORIES, DOC_TYPES, JSON_SCHEMA, getKey, setKey, hasKey, extract, parseJson, normalize };
})();
