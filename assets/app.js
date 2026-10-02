/* Rondor Excavations field app — UI. Works against LocalStore or LiveStore. */
(() => {
'use strict';
const C = window.RONDOR_DATA, Calc = window.RondorCalc, RS = window.RondorStore;
let Store = null, Me = null, Prices = null, OutboxCount = 0;

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = Calc.money;
const online = () => navigator.onLine !== false;

/* ---------------- shell ---------------- */
function shell(inner, active) {
  const nav = Me ? bottomNav(active, Me.role) : '';
  document.body.className = Me ? 'hasnav' : '';
  $('#app').innerHTML = `
    <div class="brandbar">
      <img class="logo" src="assets/logo.png" alt="Rondor Excavations Ltd.">
      <div><div class="bname">Rondor Excavations Ltd.</div>
      <div class="btag">NOT THE BIGGEST, BUT AMONG THE BEST</div></div>
      <div class="badge30">OVER 30 YEARS</div>
    </div>
    ${!online() ? '<div class="offlinebar">OFFLINE — changes will sync when reconnected</div>' : ''}
    ${OutboxCount ? `<div class="offlinebar">${OutboxCount} photo(s) waiting to upload <button class="btn sm gold" onclick="App.syncNow()">Sync now</button></div>` : ''}
    <div class="wrap">${inner}</div>${nav}`;
  if (Me) {
    const w = document.querySelector('.brandbar');
    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = `${esc(Me.display_name || Me.email)}<br><span class="small">${esc(Me.role)}</span>`;
    w.appendChild(who);
  }
}

function bottomNav(active, role) {
  const items = role === 'owner'
    ? [['#/','🏠','Home'], ['#/estimate','🧮','Estimate'], ['#/quotes','📄','Quotes'],
       ['#/jobs','🚧','Jobs'], ['#/docs','📁','Docs'], ['#/customers','👥','Clients'], ['#/more','⋯','More']]
    : [['#/','🏠','Jobs'], ['#/account','👤','Account']];
  return '<nav class="nav">' + items.map(([h, ic, t]) =>
    `<a href="${h}" class="${active === h ? 'on' : ''}"><span class="ic">${ic}</span>${t}</a>`).join('') + '</nav>';
}

function errBox(m) { return `<div class="err">${esc(m)}</div>`; }
function okBox(m) { return `<div class="okmsg">${esc(m)}</div>`; }
function statusPill(s) { return `<span class="status st-${esc(s)}">${esc(s.replace('_', ' '))}</span>`; }
function back(link, label) { return `<p><a class="linkbtn" href="${link}">← ${label || 'Back'}</a></p>`; }

/* ---------------- router ---------------- */
const routes = {};
function route(path, fn) { routes[path] = fn; }

async function navigate() {
  const hash = location.hash || '#/';
  const [path, query] = hash.slice(2).split('?');
  const parts = path.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'login') return await vLogin();
    if (!Me) return await vLogin();
    const ownerOnly = ['estimate', 'quotes', 'quote', 'customers', 'customer', 'jobs', 'job', 'docs', 'doc', 'extract', 'ai', 'prices', 'admin', 'qb', 'more'];
    if (Me.role === 'worker' && ownerOnly.includes(parts[0])) return await vWorkerHome();
    const r = parts.join('/');
    // NB: every dispatch is awaited so async errors land in this try/catch
    // instead of becoming unhandled promise rejections that leave the screen frozen.
    if (routes[r]) return await routes[r](query);
    // parametric
    if (parts[0] === 'quote' && parts[1]) return await vQuoteDetail(parts[1]);
    if (parts[0] === 'customer' && parts[1]) return await vCustomerDetail(parts[1]);
    if (parts[0] === 'doc' && parts[1]) return await vDocDetail(parts[1]);
    if (parts[0] === 'job' && parts[1] && Me.role === 'owner') return await vJobDetail(parts[1]);
    if (parts[0] === 'wjob' && parts[1]) return await vWorkerJob(parts[1]);
    if (parts[0] === 'estimate' && parts[1]) return await vEstimate(parts[1]);
    return await vHome();
  } catch (e) {
    shell(errBox('Error: ' + e.message) + back('#/', 'Home'), '#/');
  }
}
window.addEventListener('hashchange', navigate);
window.addEventListener('online', () => { refreshOutbox(); navigate(); });
window.addEventListener('offline', () => navigate());

async function refreshOutbox() {
  try { OutboxCount = (await RS.Outbox.all()).length; } catch (e) { OutboxCount = 0; }
}

/* ---------------- auth ---------------- */
async function vLogin() {
  shell(`
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>Rondor Field App</h2>
      <p class="muted">Sign in to continue.</p>
      <div id="lerr"></div>
      <label class="f">Username</label>
      <input id="lemail" type="text" autocomplete="username" placeholder="admin" value="admin">
      <label class="f">Password</label>
      <input id="lpass" type="password" autocomplete="current-password" placeholder="admin" value="admin">
      <button class="btn block" onclick="App.doLogin()">Sign in</button>
      <p class="muted small">Accounts: <b>admin/admin</b> (owner, full access) · <b>user/user</b> (field worker, jobs only — no financials).</p>
    </div>`, '');
  $('#lpass').addEventListener('keydown', e => { if (e.key === 'Enter') App.doLogin(); });
}

async function doLogin() {
  const id = $('#lemail').value.trim(), pw = $('#lpass').value;
  try {
    Me = await Store.signIn(id, pw);
    Prices = await Store.getPrices();
    location.hash = '#/';
  } catch (e) { $('#lerr').innerHTML = errBox(e.message); }
}

async function forgot() {
  const email = $('#lemail').value.trim();
  if (!email) { $('#fmsg').innerHTML = errBox('Enter your email first.'); return; }
  try { await Store.resetPassword(email); $('#fmsg').innerHTML = okBox('Reset email sent — check your inbox.'); }
  catch (e) { $('#fmsg').innerHTML = errBox(e.message); }
}

/* ---------------- home ---------------- */
async function vHome() {
  if (Me.role === 'worker') return vWorkerHome();
  const [quotes, jobs, customers] = await Promise.all([Store.listQuotes(), Store.listJobs(), Store.listCustomers()]);
  const open = quotes.filter(q => ['draft', 'sent'].includes(q.status)).length;
  shell(`
    <div class="card"><h2>Good day, ${esc(Me.display_name || 'boss')}.</h2>
      <div class="row">
        <div class="card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:1.6rem;font-weight:800">${quotes.length}</div><div class="muted">Quotes</div></div>
        <div class="card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:1.6rem;font-weight:800">${open}</div><div class="muted">Open</div></div>
        <div class="card" style="flex:1;min-width:120px;text-align:center"><div style="font-size:1.6rem;font-weight:800">${jobs.filter(j=>j.status==='active').length}</div><div class="muted">Active jobs</div></div>
      </div>
      <button class="btn gold block" onclick="location.hash='#/estimate'">🧮 New estimate</button>
      <div class="row">
        <button class="btn ghost sm" onclick="location.hash='#/quotes'">Quotes</button>
        <button class="btn ghost sm" onclick="location.hash='#/jobs'">Jobs</button>
        <button class="btn ghost sm" onclick="location.hash='#/customers'">Clients</button>
      </div></div>
    <div class="card"><h3>Recent quotes</h3>${quoteListHtml(quotes.slice(0, 5))}</div>
    <div class="card"><h3>Active jobs</h3>${jobListHtml(jobs.filter(j => j.status === 'active').slice(0, 5))}</div>
  `, '#/');
}

function quoteListHtml(quotes) {
  if (!quotes.length) return '<p class="muted">None yet.</p>';
  return quotes.map(q => `
    <div class="item" onclick="location.hash='#/quote/${q.id}'" style="cursor:pointer">
      <div class="t"><div class="h">${esc(q.number)}</div>
      <div class="muted small">${esc(q.estimate && q.estimate.customer ? q.estimate.customer.name : '')} · ${esc(q.work_date || '')}</div></div>
      <div class="row"><span style="font-weight:700">${money(q.totals && q.totals.grandTotal)}</span>${statusPill(q.status)}</div>
    </div>`).join('');
}
function jobListHtml(jobs) {
  if (!jobs.length) return '<p class="muted">None yet.</p>';
  return jobs.map(j => `
    <div class="item" onclick="location.hash='#/job/${j.id}'" style="cursor:pointer">
      <div class="t"><div class="h">${esc(j.name)}</div><div class="muted small">${esc(j.address || '')}</div></div>
      ${statusPill(j.status)}
    </div>`).join('');
}

/* worker home: assigned jobs ONLY — no financials anywhere */
async function vWorkerHome() {
  const jobs = await Store.myJobs();
  shell(`
    <div class="card"><h2>My jobs</h2>
      <p class="muted">Tap a job to log photos. You can only see job names and addresses.</p>
      ${jobs.length ? jobs.map(j => `
        <div class="item" onclick="location.hash='#/wjob/${j.id}'" style="cursor:pointer">
          <div class="t"><div class="h">${esc(j.name)}</div><div class="muted small">${esc(j.address || '')}</div></div>
          ${statusPill(j.status)}
        </div>`).join('') : '<p class="muted">No jobs assigned to you yet.</p>'}
    </div>
    ${OutboxCount ? `<div class="card"><h3>Pending uploads</h3><p>${OutboxCount} photo(s) will upload when you're back online.</p><button class="btn sm gold" onclick="App.syncNow()">Sync now</button></div>` : ''}
  `, '#/');
}

window.App = { doLogin, forgot, syncNow: async () => {
  const n = await RS.Outbox.flush(Store, () => {});
  OutboxCount = (await RS.Outbox.all()).length;
  alert(n ? `Uploaded ${n} photo(s).` : 'Nothing uploaded — still offline or queue empty.');
  navigate();
} };

/* ================= ESTIMATOR ================= */
let Est = null; // {est, quoteId, tab}
route('estimate', () => vEstimate());

async function vEstimate(quoteId) {
  const customers = await Store.listCustomers();
  if (!Est || (quoteId && Est.quoteId !== quoteId)) {
    if (quoteId && quoteId !== 'new') {
      const q = await Store.getQuote(quoteId);
      Est = { est: JSON.parse(JSON.stringify(q.estimate)), quoteId, tab: C.jobs[0].id };
    } else {
      const draft = RS.Drafts.load();
      Est = { est: draft || Calc.blankEstimate(), quoteId: null, tab: C.jobs[0].id };
    }
  }
  renderEstimate(customers);
}

function estTotals() { return Calc.quoteTotals(Est.est, Prices); }

function renderEstimate(customers) {
  const est = Est.est, t = estTotals();
  const job = C.jobs.find(j => j.id === Est.tab);
  // A blank estimate has no job type included, so quoteTotals() returns an
  // empty jobs array — default the totals so the page still renders.
  const jt = t.jobs.find(j => j.jobId === job.id) ||
    { sections: [], labourTotal: 0, subtotal: 0, op: 0, total: 0 };
  const js = est.jobs[job.id];

  const tabs = C.jobs.map(j => {
    const on = j.id === Est.tab;
    const inc = est.jobs[j.id].included;
    return `<button class="jobtab ${on ? 'on' : ''}" onclick="App.estTab('${j.id}')">${inc ? '● ' : ''}${esc(j.name)}</button>`;
  }).join('');

  const sections = job.sections.map(sec => {
    const st = jt.sections.find(s => s.id === sec.id) || { lines: [], total: 0 };
    const lines = sec.lines.map(l => {
      const ls = (js.lines[l.key] || {});
      const qty = ls.qty || 0;
      const stl = st.lines.find(x => x.key === l.key) || { unitPrice: 0, total: 0 };
      const priceInput = l.editablePrice
        ? `<input class="price" type="number" step="0.01" min="0" value="${ls.price ?? ''}" placeholder="${stl.unitPrice.toFixed(2)}" oninput="App.estPrice('${job.id}','${l.key}',this.value)">`
        : `<span class="small" style="min-width:70px;text-align:right">${money(stl.unitPrice)}</span>`;
      const laneNote = l.priceKey === 'LANE_DAY'
        ? `<div class="flag" style="margin:4px 0">Per-day = ${esc(String(est.lane.width))}m × $${esc(String(est.lane.rate))}/m² (workbook cell M11). <b>RATE BASIS TO BE CONFIRMED.</b></div>` : '';
      return `<div class="line ${qty ? '' : 'zero'}">
        <div class="lname">${esc(l.label)}${l.unit ? `<span class="un">per ${esc(l.unit)}</span>` : ''}${l.note ? `<span class="un">${esc(l.note)}</span>` : ''}${laneNote}</div>
        ${priceInput}
        <input class="qty" type="number" step="any" min="0" value="${qty || ''}" placeholder="0" oninput="App.estQty('${job.id}','${l.key}',this.value)">
        <div class="ltotal" data-lt="${job.id}:${l.key}">${money(stl.total)}</div>
      </div>`;
    }).join('');
    return `<div class="sect"><div class="shead" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
      <span>${esc(sec.name)}</span><span class="st" data-st="${job.id}:${sec.id}">${money(st.total)}</span></div>
      <div class="sbody">${lines}</div></div>`;
  }).join('');

  const perUnit = job.perUnit && js.numUnits
    ? `<div class="flag">Per-${esc(job.perUnit)} cost: <b>${money(jt.total / js.numUnits)}</b> (${esc(String(js.numUnits))} ${esc(job.perUnit)}s)</div>` : '';
  const perUnitInput = job.perUnit
    ? `<label class="f">Number of ${esc(job.perUnit)}s (for per-unit cost)</label>
       <input type="number" min="0" step="1" style="max-width:140px" value="${js.numUnits || ''}" placeholder="0" oninput="App.estNumUnits('${job.id}',this.value)">` : '';

  const trench = trenchHtml(job, js);

  const ap = t.admin;
  const apLines = C.adminPermits.lines.map(l => {
    const qty = +(((est.adminPermits.lines || {})[l.key] || {}).qty) || 0;
    const up = Calc.priceOf(l.priceKey, Prices);
    return `<div class="line ${qty ? '' : 'zero'}">
      <div class="lname">${esc(l.label)}</div>
      <span class="small" style="min-width:70px;text-align:right">${money(up)}</span>
      <input class="qty" type="number" step="any" min="0" value="${qty || ''}" placeholder="0" oninput="App.estAP('${l.key}',this.value)">
      <div class="ltotal">${money(qty * up)}</div></div>`;
  }).join('');

  const cust = est.customer || {};
  shell(`
    ${back('#/', 'Home')}
    <div class="card"><h2>${Est.quoteId ? 'Edit estimate' : 'New estimate'}</h2>
      <label class="f">Customer</label>
      <select onchange="App.estCustomer(this.value)">
        <option value="">— type new below —</option>
        ${customers.map(c => `<option value="${c.id}" ${est.customerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <div class="row">
        <div style="flex:1;min-width:140px"><label class="f">Name</label><input id="ec_name" type="text" value="${esc(cust.name || '')}" oninput="App.estCustField('name',this.value)"></div>
        <div style="flex:1;min-width:140px"><label class="f">Phone</label><input type="tel" value="${esc(cust.phone || '')}" oninput="App.estCustField('phone',this.value)"></div>
      </div>
      <div class="row">
        <div style="flex:1;min-width:140px"><label class="f">Email</label><input type="email" value="${esc(cust.email || '')}" oninput="App.estCustField('email',this.value)"></div>
        <div style="flex:1;min-width:140px"><label class="f">Address</label><input type="text" value="${esc(cust.address || '')}" oninput="App.estCustField('address',this.value)"></div>
      </div>
      <div class="row">
        <div><label class="f">Work date</label><input type="date" value="${esc(est.workDate || '')}" onchange="App.estDate(this.value)"></div>
        <div><label class="f">Frost surcharge (25%, Dec 1–Mar 31)</label>
          <select onchange="App.estFrost(this.value)">
            <option value="auto" ${est.frostOverride == null ? 'selected' : ''}>Auto (${t.frostApplies ? 'applies' : 'no'})</option>
            <option value="yes" ${est.frostOverride === true ? 'selected' : ''}>Force on</option>
            <option value="no" ${est.frostOverride === false ? 'selected' : ''}>Force off</option>
          </select></div>
      </div>
      <div class="row">
        <div><label class="f">Lane closure width (m)</label><input type="number" step="0.1" style="max-width:110px" value="${esc(String(est.lane.width))}" oninput="App.estLane('width',this.value)"></div>
        <div><label class="f">Rate ($/m²)</label><input type="number" step="0.01" style="max-width:110px" value="${esc(String(est.lane.rate))}" oninput="App.estLane('rate',this.value)"></div>
      </div>
      <div class="flag">Lane-closure per-day = width × rate — <b>rate basis to be confirmed</b>.</div>
    </div>

    <div class="card">
      <label class="row" style="font-weight:700"><input type="checkbox" ${js.included ? 'checked' : ''} onchange="App.estInclude('${job.id}',this.checked)" style="width:22px;height:22px"> Include ${esc(job.name)} on this quote</label>
      <div class="jobtabs">${tabs}</div>
      ${js.included ? `
        ${perUnitInput}${perUnit}
        <label class="f">Labour &amp; equipment — qty × ${money(job.labourRate)}</label>
        <input class="qty" type="number" step="any" min="0" value="${js.labourQty || ''}" placeholder="0" oninput="App.estLabour('${job.id}',this.value)">
        <div class="kv"><span>Labour total</span><span class="v" data-labour="${job.id}">${money(jt.labourTotal)}</span></div>
        <div class="mt">${sections}</div>
        <div class="kv"><span>Subtotal</span><span class="v" data-sub="${job.id}">${money(jt.subtotal)}</span></div>
        <div class="kv"><span>Overhead &amp; profit (${Math.round(job.opRate * 100)}%)</span><span class="v" data-op="${job.id}">${money(jt.op)}</span></div>
        <div class="kv"><span><b>${esc(job.name)} total</b></span><span class="v" data-jt="${job.id}">${money(jt.total)}</span></div>
        <div class="mt">${trench}
      ` : `<p class="muted">Tick the box above to add ${esc(job.name)} to this quote.</p>`}
    </div>

    <div class="card"><h3>Administrative permits <span class="muted">(+10% profit)</span></h3>${apLines}
      <div class="kv"><span>Permits total</span><span class="v">${money(ap.total)}</span></div></div>

    ${aiLinesCard(est)}

    <div class="card"><h3>Quote total</h3>
      ${t.jobLines.map(j => `<div class="kv"><span>${esc(j.name)}</span><span class="v">${money(j.total)}</span></div>`).join('')}
      ${t.aiLines.length ? `<div class="kv"><span>Extracted items (from documents)</span><span class="v">${money(t.aiLinesTotal)}</span></div>` : ''}
      <div class="kv"><span>Administrative permits</span><span class="v">${money(t.adminPermitsTotal)}</span></div>
      ${t.frostApplies ? `<div class="kv"><span>Frost surcharge (25%)</span><span class="v">${money(t.frostAmount)}</span></div>` : ''}
      <div class="kv"><span><b>Grand total (GST not included)</b></span><span class="v" data-grand>${money(t.grandTotal)}</span></div>
      <div class="mt row">
        <button class="btn gold" onclick="App.saveQuote()">💾 Save quote</button>
        <button class="btn ghost sm" onclick="App.clearDraft()">Clear draft</button>
      </div>
      <div id="estmsg"></div>
    </div>
    <div class="totalbar"><span>Total</span><span>${money(t.grandTotal)}</span></div>
  `, '#/estimate');
}

/* AI-extracted line items live outside the 7 workbook estimators — priced as-is. */
function aiLinesCard(est) {
  const lines = est.aiLines || [];
  if (!lines.length) return '';
  const rows = lines.map((l, i) => `
    <div class="line">
      <div class="lname">${esc(l.description)}${l.unit ? `<span class="un">per ${esc(l.unit)}</span>` : ''}
        <span class="un">${esc(l.category || 'other')}</span></div>
      <span class="small" style="min-width:70px;text-align:right">${money(l.unit_price)} × ${esc(String(l.quantity))}</span>
      <span style="min-width:44px"></span>
      <div class="ltotal">${money((+l.quantity || 0) * (+l.unit_price || 0))}</div>
      <button class="btn sm danger" onclick="App.aiLineRemove(${i})" title="Remove">✕</button>
    </div>`).join('');
  return `<div class="card"><h3>📄 Extracted items <span class="muted small">(from documents — priced as shown)</span></h3>
    ${rows}
    <p class="muted small">To change these, extract the document again from 📁 Docs.</p></div>`;
}

function trenchHtml(job, js) {
  const tr = js.trench || {};
  const g = (k, dflt) => (tr[k] !== undefined && tr[k] !== '' ? tr[k] : dflt);
  const mud = Calc.mudHaul(+g('mudW', 1) || 0, +g('mudL', 25) || 0, +g('mudH', 3) || 0);
  const pv = Calc.pipeVolume(+g('pipeR', 0.075) || 0, +g('pipeL', 25) || 0);
  const sand = Calc.fillLoads(+g('sandW', 1) || 0, +g('sandL', 25) || 0, +g('sandH', 3) || 0, pv);
  const stone = Calc.fillLoads(+g('stoneW', 1) || 0, +g('stoneL', 28) || 0, +g('stoneH', 1.75) || 0, pv);
  const inp = (k, v, label) => `<div><label class="f">${label}</label>
    <input type="number" step="any" style="max-width:96px" value="${esc(String(v))}" oninput="App.estTrench('${job.id}','${k}',this.value)"></div>`;
  return `<div class="sect"><div class="shead" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none'">
    <span>🚧 Trench calculator</span><span class="st">tap to ${tr._open ? 'hide' : 'open'}</span></div>
    <div class="sbody" style="display:${tr._open ? '' : 'none'}">
      <p class="muted small">Mud swell 20%. Sand/stone: tonnes = m³ × 1.61, loads = tonnes ÷ 12. Pipe volume is subtracted from fill.</p>
      <h4>Mud haul</h4><div class="row">${inp('mudW', g('mudW', 1), 'Width (m)')}${inp('mudL', g('mudL', 25), 'Length (m)')}${inp('mudH', g('mudH', 3), 'Height (m)')}</div>
      <div class="kv"><span>Volume (w/ swell)</span><span class="v">${mud.cuM} m³</span></div>
      <div class="kv"><span>Tandem loads (÷7)</span><span class="v">${mud.loads}</span></div>
      <h4>Pipe volume</h4><div class="row">${inp('pipeR', g('pipeR', 0.075), 'Radius (m)')}${inp('pipeL', g('pipeL', 25), 'Length (m)')}</div>
      <div class="kv"><span>Pipe volume</span><span class="v">${pv} m³</span></div>
      <h4>Sand fill</h4><div class="row">${inp('sandW', g('sandW', 1), 'Width')}${inp('sandL', g('sandL', 25), 'Length')}${inp('sandH', g('sandH', 3), 'Height')}</div>
      <div class="kv"><span>Sand loads</span><span class="v">${sand.loads} (${sand.tonnes} t)</span></div>
      <button class="btn sm ghost" onclick="App.trenchToQty('${job.id}','sand',${sand.loads})">Use ${sand.loads} → SAND qty</button>
      <h4>Stone fill</h4><div class="row">${inp('stoneW', g('stoneW', 1), 'Width')}${inp('stoneL', g('stoneL', 28), 'Length')}${inp('stoneH', g('stoneH', 1.75), 'Height')}</div>
      <div class="kv"><span>Stone loads</span><span class="v">${stone.loads} (${stone.tonnes} t)</span></div>
      <button class="btn sm ghost" onclick="App.trenchToQty('${job.id}','pitrun',${stone.loads})">Use ${stone.loads} → PIT RUN qty</button>
    </div></div>`;
}

Object.assign(window.App, {
  estTab(id) { Est.tab = id; RS.Drafts.save(Est.est); vEstimate(); },
  estInclude(id, on) {
    Est.est.jobs[id].included = on; RS.Drafts.save(Est.est); renderEstimate([]);
    // re-render needs customers; cheap: reload
    vEstimate();
  },
  estQty(jobId, key, v) {
    const L = Est.est.jobs[jobId].lines[key] || (Est.est.jobs[jobId].lines[key] = {});
    L.qty = parseFloat(v) || 0; RS.Drafts.save(Est.est); softRefreshTotals();
  },
  estPrice(jobId, key, v) {
    const L = Est.est.jobs[jobId].lines[key] || (Est.est.jobs[jobId].lines[key] = {});
    L.price = v === '' ? undefined : parseFloat(v); RS.Drafts.save(Est.est); softRefreshTotals();
  },
  estLabour(jobId, v) { Est.est.jobs[jobId].labourQty = parseFloat(v) || 0; RS.Drafts.save(Est.est); softRefreshTotals(); },
  estNumUnits(jobId, v) { Est.est.jobs[jobId].numUnits = parseFloat(v) || 0; RS.Drafts.save(Est.est); vEstimate(); },
  estAP(key, v) {
    const L = Est.est.adminPermits.lines[key] || (Est.est.adminPermits.lines[key] = {});
    L.qty = parseFloat(v) || 0; RS.Drafts.save(Est.est); softRefreshTotals();
  },
  estTrench(jobId, k, v) {
    const tr = Est.est.jobs[jobId].trench || (Est.est.jobs[jobId].trench = {});
    tr[k] = v; tr._open = true; RS.Drafts.save(Est.est);
  },
  trenchToQty(jobId, lineKey, loads) {
    const L = Est.est.jobs[jobId].lines[lineKey] || (Est.est.jobs[jobId].lines[lineKey] = {});
    L.qty = (parseFloat(L.qty) || 0) + loads; RS.Drafts.save(Est.est); vEstimate();
  },
  estDate(v) { Est.est.workDate = v; Est.est.frostOverride = null; RS.Drafts.save(Est.est); vEstimate(); },
  estFrost(v) { Est.est.frostOverride = v === 'auto' ? null : v === 'yes'; RS.Drafts.save(Est.est); vEstimate(); },
  estLane(k, v) { Est.est.lane[k] = parseFloat(v) || 0; RS.Drafts.save(Est.est); softRefreshTotals(); },
  estCustField(k, v) { Est.est.customer[k] = v; Est.est.customerId = null; RS.Drafts.save(Est.est); },
  async estCustomer(id) {
    if (!id) return;
    const c = await Store.getCustomer(id);
    Est.est.customerId = id;
    Est.est.customer = { name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' };
    RS.Drafts.save(Est.est); vEstimate();
  },
  clearDraft() { RS.Drafts.clear(); Est = null; vEstimate(); },
  aiLineRemove(i) {
    (Est.est.aiLines || []).splice(i, 1);
    RS.Drafts.save(Est.est); vEstimate();
  },
  async saveQuote() {
    const msg = $('#estmsg');
    try {
      const t = estTotals();
      if (!t.jobs.length && !t.aiLines.length) throw new Error('Include at least one job type or extract document items first.');
      let customerId = Est.est.customerId;
      if (!customerId && Est.est.customer.name) {
        const c = await Store.saveCustomer({ name: Est.est.customer.name, phone: Est.est.customer.phone,
          email: Est.est.customer.email, address: Est.est.customer.address,
          notes: [Est.est.aiJobName, Est.est.aiNotes].filter(Boolean).join(' — ') });
        customerId = c.id; Est.est.customerId = customerId;
      }
      const q = {
        id: Est.quoteId || undefined,
        customer_id: customerId || null,
        work_date: Est.est.workDate || null,
        frost_applies: t.frostApplies,
        estimate: JSON.parse(JSON.stringify(Est.est)),
        totals: t,
        terms: C.terms.slice(),
        snapshot_html: snapshotHtml(Est.est, t, Est.est.customer, C.terms.slice())
      };
      const saved = await Store.saveQuote(q);
      Est.quoteId = saved.id; RS.Drafts.clear();
      msg.innerHTML = okBox(`Saved as quote ${esc(saved.number)}.`);
      setTimeout(() => { location.hash = '#/quote/' + saved.id; }, 900);
    } catch (e) { msg.innerHTML = errBox(e.message); }
  }
});

// update all totals without full re-render (keeps input focus)
function softRefreshTotals() {
  const t = estTotals();
  const set = (sel, v) => document.querySelectorAll(sel).forEach(el => { el.textContent = v; });
  set('.totalbar span:last-child', money(t.grandTotal));
  set('[data-grand]', money(t.grandTotal));
  t.jobs.forEach(j => {
    j.sections.forEach(sec => {
      set(`[data-st="${j.jobId}:${sec.id}"]`, money(sec.total));
      sec.lines.forEach(l => set(`[data-lt="${j.jobId}:${l.key}"]`, money(l.total)));
    });
    set(`[data-labour="${j.jobId}"]`, money(j.labourTotal));
    set(`[data-sub="${j.jobId}"]`, money(j.subtotal));
    set(`[data-op="${j.jobId}"]`, money(j.op));
    set(`[data-jt="${j.jobId}"]`, money(j.total));
  });
}

/* frozen customer-facing snapshot (also used for print/PDF) */
function snapshotHtml(est, t, cust, terms) {
  const rows = t.jobLines.map(j => `<tr><td>${esc(j.name)}</td><td class="n">${money(j.total)}</td></tr>`).join('')
    + (t.aiLines || []).map(l => `<tr><td>Document item: ${esc(l.description)} (${esc(String(l.quantity))} ${esc(l.unit)} @ ${money(l.unitPrice)})</td><td class="n">${money(l.total)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Quote</title>
  <style>body{font-family:Arial,sans-serif;max-width:700px;margin:20px auto;color:#1c2333}
  .h{background:#1B3A8B;color:#fff;padding:18px;border-radius:8px}
  table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}
  .n{text-align:right}.tot{font-weight:800;font-size:1.2em}ol li{margin-bottom:6px;font-size:.9em}
  @media print{.noprint{display:none}}</style></head><body>
  <div class="h"><h2 style="margin:0">Rondor Excavations Ltd.</h2><div>NOT THE BIGGEST, BUT AMONG THE BEST · OVER 30 YEARS</div>
  <div>956 Redonda St, Sunnyside MB, R5R 0J7 · 204.791.4905</div></div>
  <h3>Quotation</h3>
  <p><b>${esc(cust.name || '')}</b><br>${esc(cust.address || '')}<br>${esc(cust.phone || '')} ${esc(cust.email || '')}</p>
  <p>Work date: ${esc(est.workDate || '')}</p>
  <table><tr><th>Scope of work</th><th class="n">Amount</th></tr>${rows}
  <tr><td>Administrative permits</td><td class="n">${money(t.adminPermitsTotal)}</td></tr>
  ${t.frostApplies ? `<tr><td>Frost surcharge (25% — work Dec 1 to Mar 31)</td><td class="n">${money(t.frostAmount)}</td></tr>` : ''}
  <tr class="tot"><td>Total (GST not included)</td><td class="n">${money(t.grandTotal)}</td></tr></table>
  <h4>Terms and Conditions</h4><ol>${(terms || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
  <p class="noprint"><button onclick="window.print()">Print / save as PDF</button></p>
  </body></html>`;
}

/* ================= QUOTES ================= */
route('quotes', async () => {
  const quotes = await Store.listQuotes();
  shell(`${back('#/', 'Home')}<div class="card"><h2>Quotes</h2>
    <button class="btn gold sm" onclick="location.hash='#/estimate'">🧮 New estimate</button>
    <div class="mt">${quoteListHtml(quotes)}</div></div>`, '#/quotes');
});

async function vQuoteDetail(id) {
  const q = await Store.getQuote(id);
  if (!q) { shell(errBox('Quote not found.') + back('#/quotes', 'Quotes'), '#/quotes'); return; }
  const t = q.totals, est = q.estimate;
  const cust = (est && est.customer) || {};
  const jobDetail = t.jobs.map(j => {
    const secs = j.sections.map(s => `
      <div class="kv"><span style="padding-left:12px">${esc(s.name)}</span><span class="v">${money(s.total)}</span></div>`).join('');
    return `<div class="sect"><div class="shead"><span>${esc(j.jobName)}</span><span class="st">${money(j.total)}</span></div>
      <div class="sbody">${secs}
      <div class="kv"><span style="padding-left:12px">Labour &amp; equipment</span><span class="v">${money(j.labourTotal)}</span></div>
      <div class="kv"><span style="padding-left:12px">Overhead &amp; profit (${Math.round(j.opRate * 100)}%)</span><span class="v">${money(j.op)}</span></div>
      </div></div>`;
  }).join('');
  const aiDetail = (t.aiLines && t.aiLines.length) ? `
    <div class="sect"><div class="shead"><span>📄 Extracted items (from documents)</span><span class="st">${money(t.aiLinesTotal)}</span></div>
      <div class="sbody">${q.estimate.aiJobName ? `<p class="muted small">Job: ${esc(q.estimate.aiJobName)}${q.estimate.aiDocType ? ' · ' + esc(q.estimate.aiDocType.replace('_', ' ')) : ''}${q.estimate.aiNotes ? ' — ' + esc(q.estimate.aiNotes) : ''}</p>` : ''}
      ${t.aiLines.map(l => `
        <div class="kv"><span style="padding-left:12px">${esc(l.description)} <span class="muted small">(${esc(String(l.quantity))} ${esc(l.unit)} @ ${money(l.unitPrice)} · ${esc(l.category)})</span></span><span class="v">${money(l.total)}</span></div>`).join('')}
      </div></div>` : '';
  shell(`
    ${back('#/quotes', 'Quotes')}
    <div class="card">
      <div class="internal-banner">INTERNAL — full detail. The customer never sees this page.</div>
      <div class="row space"><h2 style="margin:0">Quote ${esc(q.number)}</h2>${statusPill(q.status)}</div>
      <p class="muted">${esc(cust.name || '')} · ${esc(cust.address || '')} · Work date: ${esc(q.work_date || '')}</p>
      ${jobDetail}
      ${aiDetail}
      <div class="kv"><span>Administrative permits</span><span class="v">${money(t.adminPermitsTotal)}</span></div>
      ${t.frostApplies ? `<div class="kv"><span>Frost surcharge (25%)</span><span class="v">${money(t.frostAmount)}</span></div>` : ''}
      <div class="kv"><span><b>Grand total (GST not included)</b></span><span class="v" data-grand>${money(t.grandTotal)}</span></div>
      <div class="mt row">
        <button class="btn gold sm" onclick="App.quoteLink('${q.id}')">🔗 Customer accept link</button>
        <button class="btn ghost sm" onclick="App.quoteSnapshot('${q.id}')">🖨 Print / PDF</button>
        <button class="btn ghost sm" onclick="App.quoteToJob('${q.id}')">🚧 Create job</button>
        <button class="btn ghost sm" onclick="App.editQuote('${q.id}')">✏️ Edit</button>
      </div>
      <div id="qmsg" class="mt"></div>
      ${q.accept_token ? `<p class="muted small">Accept link: <span id="qlink"></span></p>` : ''}
    </div>
    <div class="card"><h3>Terms and Conditions (as quoted)</h3><ol class="terms">${(q.terms || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
  `, '#/quotes');
  if (q.accept_token) {
    Store.sendQuoteLink(q.id).then(u => { const el = $('#qlink'); if (el) el.textContent = u; });
  }
}

Object.assign(window.App, {
  async quoteLink(id) {
    try {
      const url = await Store.sendQuoteLink(id);
      $('#qmsg').innerHTML = okBox('Customer link ready — copy and send it (text/email):') +
        `<input type="text" readonly value="${esc(url)}" onclick="this.select()" style="margin-top:6px">`;
    } catch (e) { $('#qmsg').innerHTML = errBox(e.message); }
  },
  quoteSnapshot(id) {
    Store.getQuote(id).then(q => {
      const w = window.open('', '_blank');
      w.document.write(q.snapshot_html || '<p>No snapshot.</p>');
      w.document.close();
    });
  },
  async quoteToJob(id) {
    const q = await Store.getQuote(id);
    const cust = (q.estimate && q.estimate.customer) || {};
    const job = await Store.saveJob({ name: `${cust.name || 'Job'} — ${q.number}`, address: cust.address || '',
      customer_id: q.customer_id, quote_id: q.id, status: 'active', assigned_worker_ids: [] });
    location.hash = '#/job/' + job.id;
  },
  editQuote(id) { Est = null; location.hash = '#/estimate/' + id; },
  async deleteQuote(id) {
    if (!confirm('Delete this quote?')) return;
    await Store.deleteQuote(id); location.hash = '#/quotes';
  }
});

/* ================= CUSTOMERS ================= */
route('customers', async () => {
  const cs = await Store.listCustomers();
  shell(`${back('#/', 'Home')}<div class="card"><h2>Clients</h2>
    <button class="btn gold sm" onclick="App.custNew()">+ New client</button>
    <div class="mt">${cs.map(c => `
      <div class="item" onclick="location.hash='#/customer/${c.id}'" style="cursor:pointer">
        <div class="t"><div class="h">${esc(c.name)}</div><div class="muted small">${esc(c.address || '')} · ${esc(c.phone || '')}</div></div>
      </div>`).join('') || '<p class="muted">None yet.</p>'}</div></div>`, '#/customers');
});

async function vCustomerDetail(id) {
  const c = await Store.getCustomer(id);
  const h = await Store.customerHistory(id);
  shell(`${back('#/customers', 'Clients')}
    <div class="card"><h2>${esc(c.name)}</h2>
      <p class="muted">${esc(c.address || '')}<br>${esc(c.phone || '')} · ${esc(c.email || '')}</p>
      ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
      <button class="btn ghost sm" onclick="App.custEdit('${c.id}')">Edit</button></div>
    <div class="card"><h3>Quotes (${h.quotes.length})</h3>${quoteListHtml(h.quotes)}</div>
    <div class="card"><h3>Jobs (${h.jobs.length})</h3>${jobListHtml(h.jobs)}</div>`, '#/customers');
}

Object.assign(window.App, {
  custNew() {
    shell(`${back('#/customers', 'Clients')}<div class="card"><h2>New client</h2><div id="cmsg"></div>
      <label class="f">Name</label><input id="cn" type="text">
      <label class="f">Phone</label><input id="cp" type="tel">
      <label class="f">Email</label><input id="ce" type="email">
      <label class="f">Address</label><input id="ca" type="text">
      <label class="f">Notes</label><textarea id="cno"></textarea>
      <button class="btn gold block" onclick="App.custSave()">Save client</button></div>`, '#/customers');
  },
  async custEdit(id) {
    const c = await Store.getCustomer(id);
    shell(`${back('#/customer/' + id, 'Client')}<div class="card"><h2>Edit client</h2><div id="cmsg"></div>
      <label class="f">Name</label><input id="cn" type="text" value="${esc(c.name)}">
      <label class="f">Phone</label><input id="cp" type="tel" value="${esc(c.phone || '')}">
      <label class="f">Email</label><input id="ce" type="email" value="${esc(c.email || '')}">
      <label class="f">Address</label><input id="ca" type="text" value="${esc(c.address || '')}">
      <label class="f">Notes</label><textarea id="cno">${esc(c.notes || '')}</textarea>
      <button class="btn gold block" onclick="App.custSave('${c.id}')">Save</button></div>`, '#/customers');
  },
  async custSave(id) {
    try {
      const c = await Store.saveCustomer({ id: id || undefined, name: $('#cn').value.trim(),
        phone: $('#cp').value.trim(), email: $('#ce').value.trim(),
        address: $('#ca').value.trim(), notes: $('#cno').value.trim() });
      if (!c.name) throw new Error('Name is required.');
      location.hash = '#/customer/' + c.id;
    } catch (e) { $('#cmsg').innerHTML = errBox(e.message); }
  }
});

/* ================= JOBS (owner) ================= */
route('jobs', async () => {
  const jobs = await Store.listJobs();
  shell(`${back('#/', 'Home')}<div class="card"><h2>Jobs</h2>
    <button class="btn gold sm" onclick="App.jobNew()">+ New job</button>
    <div class="mt">${jobListHtml(jobs)}</div></div>`, '#/jobs');
});

async function vJobDetail(id) {
  const [job, cos, actuals, photos, profiles] = await Promise.all([
    Store.getJob(id), Store.listCOs(id), Store.listActuals(id), Store.listPhotos(id), Store.listProfiles()
  ]);
  const quote = job.quote_id ? await Store.getQuote(job.quote_id).catch(() => null) : null;
  const estTotal = quote ? quote.totals.grandTotal : 0;
  const coApproved = cos.filter(c => c.status === 'approved').reduce((a, c) => a + (+c.price || 0), 0);
  const actByCat = { labour: 0, materials: 0, subtrades: 0, equipment: 0 };
  actuals.forEach(a => { actByCat[a.category] = (actByCat[a.category] || 0) + (+a.amount || 0); });
  const actTotal = Object.values(actByCat).reduce((a, b) => a + b, 0);
  const contractTotal = Calc.round2(estTotal + coApproved);
  const variance = Calc.round2(contractTotal - actTotal);

  const coHtml = cos.map(c => `
    <div class="item"><div class="t"><div class="h">${esc(c.description)}</div>
      <div class="muted small">${money(c.price)} ${c.approved_by_name ? '· approved by ' + esc(c.approved_by_name) : ''}</div></div>
      <div class="row">${statusPill(c.status)}
      ${c.status === 'pending' ? `<button class="btn sm ghost" onclick="App.coLink('${c.id}')">🔗 Approval link</button>` : ''}</div></div>
    <div id="comsg-${c.id}"></div>`).join('') || '<p class="muted">No change orders.</p>';

  const actHtml = actuals.map(a => `
    <div class="item"><div class="t"><div class="h">${esc(a.description || a.category)}</div>
      <div class="muted small">${esc(a.category)}${a.hours ? ' · ' + esc(String(a.hours)) + ' hrs' : ''}</div></div>
      <div class="row"><b>${money(a.amount)}</b><button class="btn sm danger" onclick="App.actualDel('${a.id}','${job.id}')">✕</button></div></div>`).join('')
    || '<p class="muted">No actuals entered.</p>';

  const photoHtml = await photoTimelineHtml(photos);

  const workers = profiles.filter(p => p.role === 'worker');
  shell(`${back('#/jobs', 'Jobs')}
    <div class="card"><div class="row space"><h2 style="margin:0">${esc(job.name)}</h2>${statusPill(job.status)}</div>
      <p class="muted">${esc(job.address || '')}</p>
      <label class="f">Assign field workers (they see name + address only — no financials)</label>
      <select multiple id="jassign" style="min-height:90px">
        ${workers.map(w => `<option value="${w.id}" ${(job.assigned_worker_ids || []).includes(w.id) ? 'selected' : ''}>${esc(w.display_name || w.email)} (${esc(w.email)})</option>`).join('')}
      </select>
      <div class="row mt">
        <button class="btn sm gold" onclick="App.jobAssign('${job.id}')">Save assignments</button>
        <select id="jstatus" onchange="App.jobStatus('${job.id}',this.value)">
          ${['active', 'on_hold', 'complete'].map(s => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}
        </select>
      </div><div id="jmsg"></div></div>

    <div class="card"><h3>💰 Job costing — estimate vs actual</h3>
      <div class="kv"><span>Quoted total</span><span class="v">${money(estTotal)}</span></div>
      <div class="kv"><span>Approved change orders</span><span class="v">+${money(coApproved)}</span></div>
      <div class="kv"><span><b>Contract total</b></span><span class="v"><b>${money(contractTotal)}</b></span></div>
      ${['labour', 'materials', 'subtrades', 'equipment'].map(c =>
        `<div class="kv"><span style="padding-left:12px">Actual — ${c}</span><span class="v">${money(actByCat[c])}</span></div>`).join('')}
      <div class="kv"><span><b>Total actual</b></span><span class="v"><b>${money(actTotal)}</b></span></div>
      <div class="kv"><span><b>Variance (contract − actual)</b></span>
        <span class="v" style="color:${variance >= 0 ? 'var(--ok)' : 'var(--danger)'}">${money(variance)}</span></div>
      <h4 class="mt">Add actual cost</h4>
      <div class="row">
        <select id="acat">${['labour', 'materials', 'subtrades', 'equipment'].map(c => `<option>${c}</option>`).join('')}</select>
        <input id="adhours" type="number" step="any" placeholder="Hours (labour)" style="max-width:120px">
        <input id="aamt" type="number" step="0.01" placeholder="Amount $" style="max-width:120px">
      </div>
      <input id="adesc" type="text" placeholder="Description" class="mt">
      <button class="btn sm gold mt" onclick="App.actualAdd('${job.id}')">Add actual</button>
      <div class="mt">${actHtml}</div></div>

    <div class="card"><h3>📝 Change orders</h3>${coHtml}
      <h4 class="mt">New change order</h4>
      <textarea id="codesc" placeholder="Description of extra work"></textarea>
      <input id="coprice" type="number" step="0.01" placeholder="Price $" class="mt">
      <button class="btn sm gold mt" onclick="App.coAdd('${job.id}')">Add change order</button>
      <div id="comsg" class="mt"></div></div>

    <div class="card"><h3>📷 Photo timeline (${photos.length})</h3>${photoHtml}</div>
  `, '#/jobs');
}

async function photoTimelineHtml(photos) {
  if (!photos.length) return '<p class="muted">No photos yet.</p>';
  const items = await Promise.all(photos.map(async p => {
    let url = '';
    try { url = await Store.photoUrl(p); } catch (e) {}
    const d = new Date(p.taken_at);
    return `<div><a href="${esc(url)}" target="_blank"><img src="${esc(url)}" alt="job photo" loading="lazy"></a>
      <div class="photometa">${esc(Calc.stampText(p.taken_at, p.lat, p.lng))}${p.note ? ' · ' + esc(p.note) : ''}</div></div>`;
  }));
  return `<div class="photogrid">${items.join('')}</div>`;
}

Object.assign(window.App, {
  jobNew() {
    shell(`${back('#/jobs', 'Jobs')}<div class="card"><h2>New job</h2>
      <label class="f">Job name</label><input id="jn" type="text" placeholder="e.g. Smith — sewer replacement">
      <label class="f">Address</label><input id="ja" type="text">
      <button class="btn gold block" onclick="App.jobSave()">Create job</button></div>`, '#/jobs');
  },
  async jobSave() {
    const j = await Store.saveJob({ name: $('#jn').value.trim(), address: $('#ja').value.trim(),
      status: 'active', assigned_worker_ids: [] });
    location.hash = '#/job/' + j.id;
  },
  async jobAssign(id) {
    const sel = [...$('#jassign').selectedOptions].map(o => o.value);
    await Store.saveJob({ id, assigned_worker_ids: sel });
    $('#jmsg').innerHTML = okBox('Assignments saved.');
  },
  async jobStatus(id, s) { await Store.saveJob({ id, status: s }); $('#jmsg').innerHTML = okBox('Status updated.'); },
  async coAdd(jobId) {
    const desc = $('#codesc').value.trim(), price = parseFloat($('#coprice').value) || 0;
    if (!desc) { $('#comsg').innerHTML = errBox('Description required.'); return; }
    await Store.saveCO({ job_id: jobId, description: desc, price });
    vJobDetail(jobId);
  },
  async coLink(coId) {
    try {
      const url = await Store.sendCOLink(coId);
      $('#comsg-' + coId).innerHTML = okBox('Approval link — copy and send to the customer:') +
        `<input type="text" readonly value="${esc(url)}" onclick="this.select()">`;
    } catch (e) { $('#comsg-' + coId).innerHTML = errBox(e.message); }
  },
  async actualAdd(jobId) {
    const a = { job_id: jobId, category: $('#acat').value,
      hours: parseFloat($('#adhours') && $('#adhours').value) || null,
      amount: parseFloat($('#aamt').value) || 0, description: $('#adesc').value.trim() };
    if (!a.amount) { alert('Enter an amount.'); return; }
    await Store.saveActual(a); vJobDetail(jobId);
  },
  async actualDel(aid, jobId) {
    if (!confirm('Delete this actual?')) return;
    await Store.deleteActual(aid); vJobDetail(jobId);
  }
});

/* ================= WORKER: job photos ================= */
async function vWorkerJob(id) {
  // SECURITY: worker view gets ONLY id/name/address/status via myJobs().
  const jobs = await Store.myJobs();
  const job = jobs.find(j => j.id === id);
  if (!job) { shell(errBox('Job not found or not assigned to you.') + back('#/', 'My jobs'), '#/'); return; }
  const photos = await Store.listPhotos(id);
  const items = await Promise.all(photos.map(async p => {
    let url = '';
    try { url = await Store.photoUrl(p); } catch (e) {}
    return `<div><a href="${esc(url)}" target="_blank"><img src="${esc(url)}" alt="job photo" loading="lazy"></a>
      <div class="photometa">${esc(Calc.stampText(p.taken_at, p.lat, p.lng))}</div></div>`;
  }));
  shell(`
    ${back('#/', 'My jobs')}
    <div class="card"><h2>${esc(job.name)}</h2><p class="muted">${esc(job.address || '')} · ${esc(job.status)}</p>
      <div class="internal-banner" style="background:#e5e7eb;color:#374151">FIELD VIEW — job info only. No prices, no quote details.</div>
      <label class="f">Note (optional)</label>
      <input id="pnote" type="text" placeholder="e.g. trench at 6ft, east side">
      <label class="btn gold block" style="text-align:center">📷 Take photo
        <input id="pfile" type="file" accept="image/*" capture="environment" style="display:none">
      </label>
      <div id="pmsg"></div>
      <p class="muted small">Every photo is stamped with date, time and GPS location — location must be enabled.</p>
    </div>
    <div class="card"><h3>Photos on this job (${photos.length})</h3>
      ${items.length ? `<div class="photogrid">${items.join('')}</div>` : '<p class="muted">No photos yet.</p>'}</div>
  `, '#/');
  $('#pfile').addEventListener('change', () => App.capturePhoto(id));
}

function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Geolocation not supported on this device.'));
    navigator.geolocation.getCurrentPosition(res, rej,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
  });
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

/* Burn a visible date/time + GPS stamp onto the image via canvas. */
async function stampImage(file, takenAt, lat, lng) {
  const img = await loadImage(file);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const stamp = Calc.stampText(takenAt, lat, lng);
  ctx.font = `700 ${Math.max(22, Math.round(w / 34))}px sans-serif`;
  const pad = 12, tw = ctx.measureText(stamp).width;
  const bh = Math.max(30, Math.round(w / 22)) + pad;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, h - bh, w, bh);
  ctx.fillStyle = '#F5A800';
  ctx.fillText(stamp, pad, h - bh / 2 + Math.max(8, Math.round(w / 68)));
  URL.revokeObjectURL(img.src);
  return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Image processing failed')), 'image/jpeg', 0.85));
}

Object.assign(window.App, {
  async capturePhoto(jobId) {
    const msg = $('#pmsg');
    const file = $('#pfile').files[0];
    if (!file) return;
    msg.innerHTML = '<p class="muted">Getting location…</p>';
    try {
      let pos;
      try { pos = await getPosition(); }
      catch (e) { throw new Error('Location is required for every photo. Please enable Location Services for this site and try again.'); }
      const takenAt = new Date().toISOString();
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      msg.innerHTML = '<p class="muted">Stamping photo…</p>';
      const blob = await stampImage(file, takenAt, lat, lng);
      const note = $('#pnote').value.trim();
      if (online()) {
        msg.innerHTML = '<p class="muted">Uploading…</p>';
        await Store.uploadPhoto(jobId, blob, { taken_at: takenAt, lat, lng, note });
        msg.innerHTML = okBox('Photo uploaded with date + GPS stamp.');
      } else {
        await RS.Outbox.add({ jobId, blob, takenAt, lat, lng, note });
        await refreshOutbox();
        msg.innerHTML = okBox('Offline — photo queued and will upload when you reconnect.');
      }
      $('#pfile').value = '';
      setTimeout(() => vWorkerJob(jobId), 1200);
    } catch (e) { msg.innerHTML = errBox(e.message); }
  }
});

/* ================= PRICES (owner) ================= */
route('prices', async () => {
  const rows = C.prices.map(p => `
    <div class="line"><div class="lname">${esc(p.label)}</div>
      <input class="price" type="number" step="0.01" data-pkey="${esc(p.key)}" value="${esc(String(Prices[p.key] ?? p.price))}">
    </div>`).join('');
  shell(`${back('#/more', 'More')}
    <div class="card"><h2>Price list</h2>
      <p class="muted">Central rates — every estimate uses these. ${Store.mode === 'local' ? 'Saved in this browser.' : 'Saved to the shared database.'}</p>
      ${rows}
      <button class="btn gold block" onclick="App.savePrices()">Save prices</button>
      <button class="btn ghost sm" onclick="App.resetPrices()">Reset to workbook defaults</button>
      <div id="prmsg" class="mt"></div></div>`, '#/more');
});
Object.assign(window.App, {
  async savePrices() {
    const map = {};
    document.querySelectorAll('[data-pkey]').forEach(el => { map[el.dataset.pkey] = parseFloat(el.value) || 0; });
    await Store.savePrices(map); Prices = map;
    $('#prmsg').innerHTML = okBox('Prices saved.');
  },
  async resetPrices() {
    if (!confirm('Reset all prices to the workbook defaults?')) return;
    const map = {};
    C.prices.forEach(p => { map[p.key] = p.price; });
    await Store.savePrices(map); Prices = map; route('prices');
  }
});

/* ================= ADMIN (owner) ================= */
route('admin', async () => {
  const profiles = await Store.listProfiles();
  shell(`${back('#/more', 'More')}
    <div class="card"><h2>Team</h2>
      <p class="muted">Set roles here. ${Store.mode === 'local'
        ? 'Accounts are fixed: admin/admin (owner), user/user (worker).'
        : 'Create new users in Supabase → Authentication → Users (disable public signup there), then set their role here.'}</p>
      ${profiles.map(p => `
        <div class="item"><div class="t"><div class="h">${esc(p.display_name || p.email)}</div>
          <div class="muted small">${esc(p.email || '')}</div></div>
          <select onchange="App.setRole('${p.id}',this.value)" ${Store.mode === 'local' ? 'disabled' : ''}>
            ${['worker', 'owner'].map(r => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select></div>`).join('')}
      <div id="amsg"></div></div>`, '#/more');
});
Object.assign(window.App, {
  async setRole(pid, role) {
    try { await Store.setRole(pid, role); $('#amsg').innerHTML = okBox('Role updated.'); }
    catch (e) { $('#amsg').innerHTML = errBox(e.message); }
  }
});

/* ================= QUICKBOOKS CSV (owner) ================= */
route('qb', async () => {
  const quotes = (await Store.listQuotes()).filter(q => q.status === 'accepted');
  shell(`${back('#/more', 'More')}
    <div class="card"><h2>QuickBooks export</h2>
      <p class="muted">Accepted quotes as a CSV you can import into QuickBooks (Sales Receipt / Invoice import format). Full API sync is phase 2.</p>
      <p><b>${quotes.length}</b> accepted quote(s).</p>
      <button class="btn gold" onclick="App.qbDownload()" ${quotes.length ? '' : 'disabled'}>⬇ Download CSV</button></div>`, '#/more');
});
Object.assign(window.App, {
  async qbDownload() {
    const quotes = (await Store.listQuotes()).filter(q => q.status === 'accepted');
    const rows = [['RefNumber', 'TxnDate', 'Customer', 'Description', 'Amount']];
    quotes.forEach(q => {
      const cust = (q.estimate && q.estimate.customer && q.estimate.customer.name) || '';
      (q.totals.jobLines || []).forEach(j => rows.push([q.number, q.work_date || '', cust, j.name, (+j.total).toFixed(2)]));
      rows.push([q.number, q.work_date || '', cust, 'Administrative permits', (+q.totals.adminPermitsTotal).toFixed(2)]);
      (q.totals.aiLines || []).forEach(l => rows.push([q.number, q.work_date || '', cust,
        'Document item (' + l.category + '): ' + l.description, (+l.total).toFixed(2)]));
      if (q.totals.frostApplies) rows.push([q.number, q.work_date || '', cust, 'Frost surcharge (25%)', (+q.totals.frostAmount).toFixed(2)]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'rondor-quickbooks.csv'; a.click();
  }
});

/* ================= DOCUMENTS (owner) ================= */
let docUrl = null;       // current preview blob URL (revoked on next render)
let ExtractCache = null; // {docId, docName, data} — unapplied extraction review state

function fmtSize(b) {
  b = +b || 0;
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function docIcon(mime) { return /pdf/i.test(mime || '') ? '📕' : '🖼️'; }

route('docs', vDocs);
async function vDocs() {
  const docs = await RS.Docs.all();
  const jobs = await Store.listJobs();
  const quotes = await Store.listQuotes();
  shell(`${back('#/', 'Home')}
    <div class="card"><h2>📁 Documents</h2>
      <p class="muted">Park blueprints, supplier quotes, and invoices here. Files stay on this device — park them against a job or quote to keep them organized, and optionally extract them into a draft quote with AI.</p>
      <div id="docmsg"></div>
      <label class="f">File (PDF, JPG, PNG — 20 MB max)</label>
      <input id="dfile" type="file" accept=".pdf,.jpg,.jpeg,.png">
      <label class="f">Job (optional)</label>
      <select id="djob"><option value="">— none —</option>
        ${jobs.map(j => `<option value="${j.id}">${esc(j.name)}</option>`).join('')}</select>
      <label class="f">Quote (optional)</label>
      <select id="dquote"><option value="">— none —</option>
        ${quotes.map(q => `<option value="${q.id}">${esc(q.number)} — ${esc((q.estimate.customer || {}).name || '')}</option>`).join('')}</select>
      <button class="btn block mt" onclick="App.parkDoc()">Park document</button>
    </div>
    <div class="card"><h3>Parked documents (${docs.length})</h3>
      ${docs.length ? docs.map(d => `
        <div class="item"><div class="t"><div class="h">${docIcon(d.mime)} ${esc(d.name)}</div>
          <div class="muted small">${fmtSize(d.size)} · parked ${esc((d.parkedAt || '').slice(0, 10))}${d.jobId ? ' · job' : ''}${d.quoteId ? ' · quote' : ''}</div></div>
          <button class="btn sm ghost" onclick="location.hash='#/doc/${d.id}'">Open</button>
        </div>`).join('') : '<p class="muted">Nothing parked yet.</p>'}
    </div>`, '#/docs');
}

async function vDocDetail(id) {
  const d = await RS.Docs.get(id);
  if (!d) { location.hash = '#/docs'; return; }
  const jobs = await Store.listJobs();
  const quotes = await Store.listQuotes();
  if (docUrl) { URL.revokeObjectURL(docUrl); docUrl = null; }
  docUrl = URL.createObjectURL(d.blob);
  const preview = /pdf/i.test(d.mime)
    ? `<iframe src="${docUrl}" style="width:100%;height:420px;border:1px solid #ccd;border-radius:8px;background:#fff"></iframe>`
    : `<img src="${docUrl}" style="max-width:100%;border-radius:8px;display:block;margin:0 auto">`;
  const job = jobs.find(j => j.id === d.jobId);
  const quote = quotes.find(q => q.id === d.quoteId);
  shell(`${back('#/docs', 'Docs')}
    <div class="card"><h2>${docIcon(d.mime)} ${esc(d.name)}</h2>
      <div id="docmsg"></div>
      <p class="muted small">${fmtSize(d.size)} · parked ${esc((d.parkedAt || '').slice(0, 10))}${job ? ' · Job: ' + esc(job.name) : ''}${quote ? ' · Quote: ' + esc(quote.number) : ''}</p>
      ${preview}
      <div class="row mt">
        <div><label class="f">Park against job</label>
          <select id="ldjob"><option value="">— none —</option>
          ${jobs.map(j => `<option value="${j.id}" ${j.id === d.jobId ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select></div>
        <div><label class="f">Park against quote</label>
          <select id="ldquote"><option value="">— none —</option>
          ${quotes.map(q => `<option value="${q.id}" ${q.id === d.quoteId ? 'selected' : ''}>${esc(q.number)}</option>`).join('')}</select></div>
      </div>
      <button class="btn sm ghost mt" onclick="App.linkDoc('${d.id}')">Save links</button>
      <hr>
      <button class="btn gold block" onclick="App.extractDoc('${d.id}')">🤖 Extract with AI</button>
      <button class="btn danger block mt" onclick="App.deleteDoc('${d.id}')">Delete document</button>
    </div>`, '#/docs');
}

/* ================= AI EXTRACTION SETTINGS (owner) ================= */
route('ai', () => {
  const prov = RondorAI.getProvider();
  const cfg = RondorAI.PROVIDERS[prov];
  const has = RondorAI.hasKey();
  shell(`${back('#/more', 'More')}
    <div class="card"><h2>🤖 AI extraction</h2>
      <p class="muted">Parked documents can be read by AI and turned into draft quote line items — blueprints (quantities from the plan), supplier quotes, invoices.</p>
      <div id="aimsg"></div>
      <label class="f">AI provider</label>
      <select id="aiprov" onchange="App.aiProvider(this.value)">
        ${RondorAI.PROVIDER_IDS.map(id =>
          `<option value="${id}" ${id === prov ? 'selected' : ''}>${RondorAI.PROVIDERS[id].label}</option>`).join('')}
      </select>
      ${cfg.note ? `<p class="flag mt">${esc(cfg.note)}</p>` : ''}
      ${cfg.needsKey ? `
        ${has ? '<p class="okmsg">✓ API key is set on this device.</p>' : '<p class="err">No API key set — extraction is disabled until you add one.</p>'}
        <label class="f">${esc(cfg.keyLabel)}</label>
        <input id="aikey" type="password" autocomplete="off" placeholder="${esc(cfg.keyHint)}">
        <button class="btn block" onclick="App.aiSaveKey()">Save key on this device</button>
        ${has ? '<button class="btn danger block mt" onclick="App.aiClearKey()">Remove key</button>' : ''}
      ` : '<p class="okmsg">✓ No API key needed — Ollama runs on your own computer.</p>'}
      <div class="row mt">
        <div style="flex:1;min-width:140px"><label class="f">Model</label>
          <input id="aimodel" type="text" autocomplete="off" value="${esc(RondorAI.getModel())}" placeholder="${esc(cfg.defaultModel)}"></div>
        ${prov === 'ollama' ? `<div style="flex:1;min-width:140px"><label class="f">Ollama address</label>
          <input id="aiollama" type="text" autocomplete="off" value="${esc(RondorAI.getOllamaUrl())}"></div>` : ''}
      </div>
      <button class="btn sm ghost" onclick="App.aiSaveModel()">Save model${prov === 'ollama' ? ' &amp; address' : ''}</button>
      ${cfg.pdfNote ? `<p class="muted small mt">${esc(cfg.pdfNote)}</p>` : ''}
      <p class="muted small mt">${cfg.needsKey ? esc(cfg.keyHelp || '') + ' ' : ''}Keys are stored only in this browser's localStorage and are only ever sent to that provider when you tap "Extract with AI". Each extraction uses a small amount of your own API credit (Ollama is free).</p>
    </div>`, '#/more');
});

/* ================= EXTRACTION REVIEW (owner) ================= */
route('extract', vExtractReview);
async function vExtractReview() {
  const c = ExtractCache;
  if (!c) { location.hash = '#/docs'; return; }
  const drafts = (await Store.listQuotes()).filter(q => q.status === 'draft');
  shell(`${back('#/docs', 'Docs')}
    <div class="card"><h2>Review extracted data</h2>
      <p class="muted">From <b>${esc(c.docName)}</b>. Check every field — nothing is applied until you tap Apply. Leaving this screen discards the extraction (the document stays parked).</p>
      <div id="exmsg"></div>
      <label class="f">Job name</label>
      <input id="xjob" type="text" value="${esc(c.data.job_name)}" placeholder="e.g. 123 Main St — sewer replacement">
      <div class="row">
        <div><label class="f">Customer name</label><input id="xcname" type="text" value="${esc(c.data.customer.name)}"></div>
        <div><label class="f">Phone</label><input id="xcphone" type="text" value="${esc(c.data.customer.phone)}"></div>
      </div>
      <div class="row">
        <div><label class="f">Email</label><input id="xcemail" type="text" value="${esc(c.data.customer.email)}"></div>
        <div><label class="f">Address</label><input id="xcaddr" type="text" value="${esc(c.data.customer.address)}"></div>
      </div>
      <label class="f">Document type</label>
      <select id="xdoctype">${RondorAI.DOC_TYPES.map(t =>
        `<option value="${t}" ${t === c.data.document_type ? 'selected' : ''}>${t.replace('_', ' ')}</option>`).join('')}</select>
      <label class="f">Notes</label>
      <textarea id="xnotes" rows="3">${esc(c.data.notes)}</textarea>
      <h3>Line items</h3>
      <div id="xlines"></div>
      <button class="btn sm ghost" onclick="App.xAddRow()">+ Add row</button>
      <h3 class="mt">Apply</h3>
      <button class="btn gold block" onclick="App.xApply('new')">Apply to new draft quote</button>
      ${drafts.length ? `<div class="row mt">
        <div><label class="f">Existing draft</label>
          <select id="xdraft">${drafts.map(q => `<option value="${q.id}">${esc(q.number)} — ${esc((q.estimate.customer || {}).name || '')}</option>`).join('')}</select></div>
        <div><label class="f">&nbsp;</label>
          <button class="btn sm block" onclick="App.xApply('existing')">Apply to draft</button></div>
      </div>` : '<p class="muted small">No draft quotes to append to — save one first.</p>'}
      <button class="btn danger block mt" onclick="App.xDiscard()">Discard extraction</button>
    </div>`, '#/docs');
  renderXLines();
}
function renderXLines() {
  const host = $('#xlines');
  if (!host || !ExtractCache) return;
  host.innerHTML = ExtractCache.data.line_items.map((l, i) => `
    <div class="card" style="padding:10px;margin:8px 0;background:#f7f9fd">
      <input id="xd-${i}" type="text" value="${esc(l.description)}" placeholder="Description">
      <div class="row">
        <div><label class="f">Qty</label><input id="xq-${i}" type="number" step="any" min="0" value="${esc(String(l.quantity))}"></div>
        <div><label class="f">Unit</label><input id="xu-${i}" type="text" value="${esc(l.unit)}" placeholder="m / each / hrs"></div>
      </div>
      <div class="row">
        <div><label class="f">Unit price (CA$)</label><input id="xp-${i}" type="number" step="0.01" min="0" value="${esc(String(l.unit_price))}"></div>
        <div><label class="f">Category</label><select id="xc-${i}">${RondorAI.CATEGORIES.map(t =>
          `<option value="${t}" ${t === l.category ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      </div>
      <button class="btn sm danger" onclick="App.xDelRow(${i})">Remove</button>
    </div>`).join('') || '<p class="muted">No line items — add a row or discard.</p>';
}
function xReadLines() {
  const g = id => document.getElementById(id);
  ExtractCache.data.line_items.forEach((l, i) => {
    l.description = g('xd-' + i).value;
    l.quantity = +g('xq-' + i).value || 0;
    l.unit = g('xu-' + i).value;
    l.unit_price = +g('xp-' + i).value || 0;
    l.category = g('xc-' + i).value;
  });
}

Object.assign(window.App, {
  /* ---- documents ---- */
  async parkDoc() {
    const msg = $('#docmsg');
    try {
      const f = $('#dfile').files[0];
      if (!f) throw new Error('Choose a file first.');
      if (!/pdf|jpe?g|png/i.test(f.type) && !/\.(pdf|jpe?g|png)$/i.test(f.name))
        throw new Error('PDF, JPG or PNG only.');
      if (f.size > 20 * 1024 * 1024) throw new Error('File is too large (20 MB max).');
      msg.innerHTML = '<p class="muted">Parking…</p>';
      await RS.Docs.add({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size,
        blob: f, jobId: $('#djob').value || null, quoteId: $('#dquote').value || null });
      vDocs();
    } catch (e) { msg.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  },
  async deleteDoc(id) {
    const d = await RS.Docs.get(id);
    if (!d) { vDocs(); return; }
    if (!confirm(`Delete "${d.name}" from this device?`)) return;
    await RS.Docs.remove(id);
    ExtractCache = null;
    vDocs();
  },
  async linkDoc(id) {
    await RS.Docs.setLink(id, $('#ldjob').value || null, $('#ldquote').value || null);
    vDocDetail(id);
  },
  /* ---- extraction ---- */
  async extractDoc(id) {
    const msg = $('#docmsg');
    if (!RondorAI.hasKey()) { location.hash = '#/ai'; return; }
    const d = await RS.Docs.get(id);
    if (!d) return;
    try {
      msg.innerHTML = '<p class="muted">🤖 Reading document — this can take up to a minute…</p>';
      const data = await RondorAI.extract({ blob: d.blob, fileName: d.name, mime: d.mime });
      ExtractCache = { docId: id, docName: d.name, data };
      location.hash = '#/extract';
    } catch (e) {
      if (e.code === 'NO_KEY') { location.hash = '#/ai'; return; }
      msg.innerHTML = `<p class="err">${esc(e.message)}</p>`;
    }
  },
  xAddRow() {
    xReadLines();
    ExtractCache.data.line_items.push({ description: '', quantity: 0, unit: '', unit_price: 0, category: 'other' });
    renderXLines();
  },
  xDelRow(i) {
    xReadLines();
    ExtractCache.data.line_items.splice(i, 1);
    renderXLines();
  },
  xDiscard() {
    if (confirm('Discard this extraction? The document stays parked.')) {
      ExtractCache = null;
      location.hash = '#/docs';
    }
  },
  async xApply(mode) {
    const msg = $('#exmsg');
    try {
      xReadLines();
      const c = ExtractCache;
      const customer = {
        name: $('#xcname').value.trim(), phone: $('#xcphone').value.trim(),
        email: $('#xcemail').value.trim(), address: $('#xcaddr').value.trim()
      };
      const aiLines = c.data.line_items
        .filter(l => l.description.trim())
        .map(l => ({ description: l.description.trim(), quantity: +l.quantity || 0,
                     unit: l.unit.trim(), unit_price: +l.unit_price || 0,
                     category: l.category, docId: c.docId }));
      if (!customer.name) throw new Error('Enter a customer name first.');
      if (!aiLines.length) throw new Error('There are no line items to apply.');
      msg.innerHTML = '<p class="muted">Applying…</p>';
      const aiMeta = { aiJobName: $('#xjob').value.trim(),
                       aiNotes: $('#xnotes').value.trim(),
                       aiDocType: $('#xdoctype').value };
      if (mode === 'new') {
        Est = { est: Calc.blankEstimate(), quoteId: null, tab: C.jobs[0].id };
        Est.est.customer = customer;
        Est.est.customerId = null;
        Est.est.aiLines = aiLines;
        Object.assign(Est.est, aiMeta);
      } else {
        const qid = $('#xdraft').value;
        if (!qid) throw new Error('Pick a draft quote first.');
        const q = await Store.getQuote(qid);
        Est = { est: JSON.parse(JSON.stringify(q.estimate)), quoteId: q.id, tab: C.jobs[0].id };
        Est.est.customer = { ...(Est.est.customer || {}), ...customer };
        Est.est.aiLines = (Est.est.aiLines || []).concat(aiLines);
        Object.assign(Est.est, aiMeta);
      }
      ExtractCache = null;
      await App.saveQuote();
    } catch (e) { msg.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  },
  /* ---- AI settings ---- */
  aiProvider(id) {
    RondorAI.setProvider(id);
    routes['ai']();
  },
  aiSaveKey() {
    const v = $('#aikey').value.trim();
    const label = RondorAI.PROVIDERS[RondorAI.getProvider()].keyLabel || 'API key';
    if (!v) { $('#aimsg').innerHTML = `<p class="err">Paste your ${esc(label)} first.</p>`; return; }
    RondorAI.setKey(v);
    $('#aimsg').innerHTML = '<p class="okmsg">✓ Key saved on this device.</p>';
    setTimeout(() => { if (location.hash === '#/ai') routes['ai'](); }, 900);
  },
  aiSaveModel() {
    const m = $('#aimodel');
    if (m) RondorAI.setModel(m.value);
    const u = $('#aiollama');
    if (u) RondorAI.setOllamaUrl(u.value);
    const msg = $('#aimsg');
    if (msg) msg.innerHTML = '<p class="okmsg">✓ Saved.</p>';
  },
  aiClearKey() { RondorAI.setKey(''); routes['ai'](); }
});

/* ================= MORE / ACCOUNT ================= */
route('more', () => {
  shell(`${back('#/', 'Home')}<div class="card"><h2>More</h2>
    <button class="btn ghost block" onclick="location.hash='#/prices'">💲 Price list</button>
    <button class="btn ghost block" onclick="location.hash='#/admin'">👥 Team &amp; roles</button>
    <button class="btn ghost block" onclick="location.hash='#/docs'">📁 Documents</button>
    <button class="btn ghost block" onclick="location.hash='#/ai'">🤖 AI extraction</button>
    <button class="btn ghost block" onclick="location.hash='#/qb'">📊 QuickBooks export</button>
    <button class="btn ghost block" onclick="location.hash='#/account'">👤 Account</button>
    <p class="muted small">Backend: ${Store.mode === 'local' ? 'Local (this browser only)' : 'Supabase live'}</p>
  </div>`, '#/more');
});
route('account', async () => {
  shell(`${back(Me.role === 'owner' ? '#/more' : '#/', 'Back')}
    <div class="card"><h2>Account</h2>
      <p><b>${esc(Me.display_name || Me.email)}</b><br><span class="muted">${esc(Me.email || '')} · ${esc(Me.role)}</span></p>
      <label class="f">Display name</label>
      <input id="aname" type="text" value="${esc(Me.display_name || '')}">
      <button class="btn sm ghost mt" onclick="App.saveName()">Save name</button>
      <div id="amsg2" class="mt"></div>
      <button class="btn danger block mt" onclick="App.logout()">Sign out</button>
    </div>`, '#/account');
});
Object.assign(window.App, {
  async saveName() {
    await Store.updateDisplayName(Me.id, $('#aname').value.trim());
    Me = await Store.myProfile(); navigate();
  },
  async logout() { await Store.signOut(); Me = null; location.hash = '#/login'; }
});

/* ---------------- boot ---------------- */
async function boot() {
  try {
    Store = await RS.init();
  } catch (e) {
    $('#app').innerHTML = `<div class="card" style="max-width:520px;margin:40px auto">
      <h2>Couldn't start</h2><p>${esc(e.message)}</p>
      <p class="muted small">Tip: this install stores data locally in the browser. Set DEMO_MODE: false in config.js and add Supabase keys for the shared backend.</p></div>`;
    return;
  }
  await refreshOutbox();
  try {
    Me = (Store.session() || (Store.mode === 'live' && (await Store.sb.auth.getSession()).data.session))
      ? await Store.myProfile() : null;
  } catch (e) { Me = null; }
  if (Me) { try { Prices = await Store.getPrices(); } catch (e) { Prices = {}; } }
  // flush any queued offline photos
  if (Me && online()) {
    const n = await RS.Outbox.flush(Store, () => {});
    if (n) { await refreshOutbox(); }
  }
  Store.onAuth(async s => {
    Me = s ? await Store.myProfile().catch(() => null) : null;
    if (Me && !Prices) { try { Prices = await Store.getPrices(); } catch (e) {} }
    navigate();
  });
  if (!location.hash) location.hash = '#/';
  navigate();
}
document.addEventListener('DOMContentLoaded', boot);
})();
