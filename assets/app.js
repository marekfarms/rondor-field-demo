/* Rondor Excavations field app — UI. Works against DemoStore or LiveStore. */
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
  const demo = Store.mode === 'demo';
  const nav = Me ? bottomNav(active, Me.role) : '';
  document.body.className = Me ? 'hasnav' : '';
  $('#app').innerHTML = `
    <div class="brandbar">
      <img class="logo" src="assets/logo.png" alt="Rondor Excavations Ltd.">
      <div><div class="bname">Rondor Excavations Ltd.</div>
      <div class="btag">NOT THE BIGGEST, BUT AMONG THE BEST</div></div>
      <div class="badge30">OVER 30 YEARS</div>
    </div>
    ${demo ? '<div class="offlinebar" style="background:#92600a">DEMO MODE — data stays in this browser</div>' : ''}
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
       ['#/jobs','🚧','Jobs'], ['#/customers','👥','Clients'], ['#/more','⋯','More']]
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
    if (parts[0] === 'login') return vLogin();
    if (!Me) return vLogin();
    const ownerOnly = ['estimate', 'quotes', 'quote', 'customers', 'customer', 'jobs', 'job', 'prices', 'admin', 'qb', 'more'];
    if (Me.role === 'worker' && ownerOnly.includes(parts[0])) return vWorkerHome();
    const r = parts.join('/');
    if (routes[r]) return routes[r](query);
    // parametric
    if (parts[0] === 'quote' && parts[1]) return vQuoteDetail(parts[1]);
    if (parts[0] === 'customer' && parts[1]) return vCustomerDetail(parts[1]);
    if (parts[0] === 'job' && parts[1] && Me.role === 'owner') return vJobDetail(parts[1]);
    if (parts[0] === 'wjob' && parts[1]) return vWorkerJob(parts[1]);
    if (parts[0] === 'estimate' && parts[1]) return vEstimate(parts[1]);
    return vHome();
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
  const demo = Store.mode === 'demo';
  shell(`
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2>Rondor Field App</h2>
      <p class="muted">${demo ? 'Demo mode — no setup needed.' : 'Sign in with your company account.'}</p>
      <div id="lerr"></div>
      <label class="f">${demo ? 'Username' : 'Email'}</label>
      <input id="lemail" type="${demo ? 'text' : 'email'}" autocomplete="username"
             placeholder="${demo ? 'admin' : 'you@company.ca'}">
      <label class="f">Password</label>
      <input id="lpass" type="password" autocomplete="current-password"
             placeholder="${demo ? 'admin' : '••••••••'}">
      <button class="btn block" onclick="App.doLogin()">Sign in</button>
      ${demo ? '<p class="muted small">Demo accounts: <b>admin/admin</b> (owner, full access) · <b>user/user</b> (field worker, jobs only — no financials).</p>'
             : '<p><button class="linkbtn" onclick="App.forgot()">Forgot password?</button></p><div id="fmsg"></div>'}
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
  const jt = t.jobs.find(j => j.jobId === job.id);
  const js = est.jobs[job.id];

  const tabs = C.jobs.map(j => {
    const on = j.id === Est.tab;
    const inc = est.jobs[j.id].included;
    return `<button class="jobtab ${on ? 'on' : ''}" onclick="App.estTab('${j.id}')">${inc ? '● ' : ''}${esc(j.name)}</button>`;
  }).join('');

  const sections = job.sections.map(sec => {
    const st = jt.sections.find(s => s.id === sec.id);
    const lines = sec.lines.map(l => {
      const ls = (js.lines[l.key] || {});
      const qty = ls.qty || 0;
      const stl = st.lines.find(x => x.key === l.key);
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
        <div class="mt">${trench}}
      ` : `<p class="muted">Tick the box above to add ${esc(job.name)} to this quote.</p>`}
    </div>

    <div class="card"><h3>Administrative permits <span class="muted">(+10% profit)</span></h3>${apLines}
      <div class="kv"><span>Permits total</span><span class="v">${money(ap.total)}</span></div></div>

    <div class="card"><h3>Quote total</h3>
      ${t.jobLines.map(j => `<div class="kv"><span>${esc(j.name)}</span><span class="v">${money(j.total)}</span></div>`).join('')}
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
  async saveQuote() {
    const msg = $('#estmsg');
    try {
      const t = estTotals();
      if (!t.jobs.length) throw new Error('Include at least one job type first.');
      let customerId = Est.est.customerId;
      if (!customerId && Est.est.customer.name) {
        const c = await Store.saveCustomer({ name: Est.est.customer.name, phone: Est.est.customer.phone,
          email: Est.est.customer.email, address: Est.est.customer.address, notes: '' });
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
  const rows = t.jobLines.map(j => `<tr><td>${esc(j.name)}</td><td class="n">${money(j.total)}</td></tr>`).join('');
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
  shell(`
    ${back('#/quotes', 'Quotes')}
    <div class="card">
      <div class="internal-banner">INTERNAL — full detail. The customer never sees this page.</div>
      <div class="row space"><h2 style="margin:0">Quote ${esc(q.number)}</h2>${statusPill(q.status)}</div>
      <p class="muted">${esc(cust.name || '')} · ${esc(cust.address || '')} · Work date: ${esc(q.work_date || '')}</p>
      ${jobDetail}
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
      <p class="muted">Central rates — every estimate uses these. ${Store.mode === 'demo' ? 'Demo: saved in this browser.' : 'Saved to the shared database.'}</p>
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
      <p class="muted">Set roles here. ${Store.mode === 'demo'
        ? 'Demo accounts are fixed: admin/admin (owner), user/user (worker).'
        : 'Create new users in Supabase → Authentication → Users (disable public signup there), then set their role here.'}</p>
      ${profiles.map(p => `
        <div class="item"><div class="t"><div class="h">${esc(p.display_name || p.email)}</div>
          <div class="muted small">${esc(p.email || '')}</div></div>
          <select onchange="App.setRole('${p.id}',this.value)" ${Store.mode === 'demo' ? 'disabled' : ''}>
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
      if (q.totals.frostApplies) rows.push([q.number, q.work_date || '', cust, 'Frost surcharge (25%)', (+q.totals.frostAmount).toFixed(2)]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'rondor-quickbooks.csv'; a.click();
  }
});

/* ================= MORE / ACCOUNT ================= */
route('more', () => {
  shell(`${back('#/', 'Home')}<div class="card"><h2>More</h2>
    <button class="btn ghost block" onclick="location.hash='#/prices'">💲 Price list</button>
    <button class="btn ghost block" onclick="location.hash='#/admin'">👥 Team &amp; roles</button>
    <button class="btn ghost block" onclick="location.hash='#/qb'">📊 QuickBooks export</button>
    <button class="btn ghost block" onclick="location.hash='#/account'">👤 Account</button>
    <p class="muted small">Backend: ${Store.mode === 'demo' ? 'DEMO (this browser only)' : 'Supabase live'}</p>
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
      <p class="muted small">Tip: to use the zero-setup demo, set DEMO_MODE: true in config.js.</p></div>`;
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
