/* Throwaway e2e driver: boots the real app in a stubbed DOM, signs in as admin,
   walks the quote wizard end-to-end, saves, and verifies the quote total. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const DIR = __dirname;

// ---- fakes ----
const lsData = {};
const localStorage = {
  getItem: k => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: k => { delete lsData[k]; },
};
const idbStores = {};
const indexedDB = {
  open(name, version) {
    const req = {};
    const db = {
      createObjectStore: sname => { idbStores[name][sname] = idbStores[name][sname] || {}; },
      objectStoreNames: { contains: sname => !!(idbStores[name] && idbStores[name][sname]) },
      transaction: (sname, mode) => ({
        objectStore: () => ({
          getAll: () => { const q = {}; setTimeout(() => { q.result = Object.values(idbStores[name][sname] || {}); q.onsuccess && q.onsuccess(); }, 0); return q; },
          get: id => { const q = {}; setTimeout(() => { q.result = (idbStores[name][sname] || {})[id] || null; q.onsuccess && q.onsuccess(); }, 0); return q; },
          add: item => { const s = idbStores[name][sname] || (idbStores[name][sname] = {}); const id = item.id || ('id' + Math.random().toString(36).slice(2)); s[id] = { ...item, id }; const q = {}; setTimeout(() => { q.result = id; q.onsuccess && q.onsuccess(); }, 0); return q; },
          put: item => { const s = idbStores[name][sname] || (idbStores[name][sname] = {}); s[item.id] = item; const q = {}; setTimeout(() => { q.onsuccess && q.onsuccess(); }, 0); return q; },
          delete: id => { const s = idbStores[name][sname] || {}; delete s[id]; const q = {}; setTimeout(() => { q.onsuccess && q.onsuccess(); }, 0); return q; },
        }),
        oncomplete: null, onerror: null,
      }),
    };
    req.result = db;
    setTimeout(() => {
      if (!idbStores[name]) {
        idbStores[name] = {};
        if (req.onupgradeneeded) req.onupgradeneeded();
      }
      req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  }
};
const elements = {};
function makeEl(sel) {
  return elements[sel] || (elements[sel] = {
    innerHTML: '', textContent: '', value: '', className: '',
    addEventListener() {}, click() {}, appendChild() {},
  });
}
let lastHtml = '';
const appEl = makeEl('#app');
Object.defineProperty(appEl, 'innerHTML', {
  get() { return lastHtml; },
  set(v) { lastHtml = v; },
});
const listeners = {};
const document = {
  querySelector: s => (s === '#app' ? appEl : makeEl(s)),
  querySelectorAll: () => [],
  getElementById: id => null,
  createElement: () => ({ click() {}, appendChild() {}, set innerHTML(v) {}, get innerHTML() { return ''; }, className: '' }),
  addEventListener: (ev, fn) => { listeners[ev] = fn; },
  body: {},
  title: '',
};
const winListeners = {};
const location = { hash: '', href: '' };
const sandbox = {
  window: null, document, localStorage, indexedDB, location,
  navigator: { onLine: true },
  fetch: async () => { throw new Error('no fetch'); },
  FileReader: function () {},
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  scrollTo: () => {},
  confirm: () => true,
  setTimeout, clearTimeout,
  console,
  crypto: require('crypto').webcrypto,
};
sandbox.window = sandbox;
sandbox.window.localStorage = localStorage;
sandbox.window.addEventListener = (ev, fn) => { winListeners[ev] = fn; };
sandbox.window.scrollTo = () => {};
vm.createContext(sandbox);
function load(file) {
  vm.runInContext(fs.readFileSync(path.join(DIR, file), 'utf8'), sandbox, { filename: file });
}
for (const f of ['config.js', 'assets/data.js', 'assets/calc.js', 'assets/store.js',
                 'assets/ai-extract.js', 'assets/wizard.js', 'assets/app.js']) load(f);

const App = sandbox.window.App;
const WZ = sandbox.window.RondorWizard;
const Calc = sandbox.window.RondorCalc;
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(c, name, extra) {
  if (c) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
function shows(re, name) { ok(re.test(lastHtml), name); }

(async () => {
  delete lsData['rondor_app_v2'];
  await listeners['DOMContentLoaded'](); // boot → login screen
  await tick();
  shows(/Sign in to continue/, 'boot shows login');
  makeEl('#lemail').value = 'admin'; makeEl('#lpass').value = 'admin';
  await App.doLogin();
  await tick();
  shows(/Good day/, 'login as admin lands on home');

  // --- walk the wizard ---
  location.hash = '#/wizard'; await winListeners['hashchange'](); await tick();
  shows(/Who is this quote for/, 'step 1: customer');
  shows(/Step 1 of 6/, 'progress: step 1 of 6 (no jobs yet)');
  App.wizCustField('name', 'E2E Customer'); App.wizCustField('phone', '204-555-0100');
  App.wizNext(); await tick();
  shows(/Job details/, 'step 2: basics');
  App.wizBasic('jobName', 'E2E Job'); App.wizBasic('workDate', '2026-10-15');
  App.wizNext(); await tick();
  shows(/What type of work is it/, 'step 3: work types');
  App.wizToggleJob('copper', true); App.wizToggleJob('wws150', true);
  App.wizNext(); await tick();
  shows(/Step 4 of 15/, 'progress: step 4 of 15 (two jobs)');
  shows(/labour &amp; equipment/i, 'step 4: copper labour');
  App.wizLabour('copper', '2');
  App.wizNext(); await tick();
  shows(/Copper service — Permits/, 'step 5: copper permits');
  App.wizLineQty('copper', 'perm_closeday', '3');
  App.wizNext(); await tick();
  shows(/Sub-trades/, 'step 6: copper sub-trades');
  App.wizLineQty('copper', 'trucking', '4');
  App.wizNext(); await tick();
  shows(/Materials/, 'step 7: copper materials');
  shows(/Trench helper/, 'trench helper present on materials screen');
  App.wizLineQty('copper', 'sand', '6');
  App.wizNext(); await tick();
  shows(/150mm Wastewater sewer/, 'step 8: wws150 labour');
  App.wizLabour('wws150', '1');
  App.wizNext(); await tick(); // wws permits
  App.wizNext(); await tick(); // wws subtrades
  App.wizNext(); await tick(); // wws materials
  shows(/Materials/, 'step 11: wws150 materials');
  App.wizLineQty('wws150', 'pipe1', '120');
  App.wizNext(); await tick();
  shows(/Want to add another type of work/, 'step 12: add-more loop');
  App.wizNext(); await tick(); // "No — continue"
  shows(/Permits &amp; extras/, 'step 13: extras');
  App.wizAP('cutpermit', '1');
  App.wizNext(); await tick();
  shows(/Review your quote/, 'step 14: review');
  shows(/Tap any line to jump back/, 'review has jump-back hint');
  // expected total computed independently
  const prices = await sandbox.window.RondorStore.init().then(s => s.getPrices());
  const est = Calc.blankEstimate();
  est.customer.name = 'E2E Customer'; est.customer.phone = '204-555-0100';
  est.jobName = 'E2E Job'; est.workDate = '2026-10-15';
  WZ.ensureJobState(est, 'copper'); est.jobs.copper.labourQty = 2;
  WZ.setLineQty(est, 'copper', 'perm_closeday', 3);
  WZ.setLineQty(est, 'copper', 'trucking', 4);
  WZ.setLineQty(est, 'copper', 'sand', 6);
  WZ.ensureJobState(est, 'wws150'); est.jobs.wws150.labourQty = 1;
  WZ.setLineQty(est, 'wws150', 'pipe1', 120);
  est.adminPermits.lines = { cutpermit: { qty: 1 } };
  const t = Calc.quoteTotals(est, prices);
  const money = Calc.money;
  ok(lastHtml.includes(money(t.grandTotal)),
    'review shows expected grand total ' + money(t.grandTotal));
  // jump-back: tap a line, change it, come back
  App.wizJump('copper', 'permits'); await tick();
  shows(/Copper service — Permits/, 'jump-back lands on copper permits');
  App.wizBack(); await tick(); // back to labour
  App.wizNext(); await tick(); // forward to permits
  App.wizNext(); await tick(); // subtrades
  App.wizNext(); await tick(); // materials
  App.wizNext(); await tick(); // wws labour
  App.wizNext(); await tick(); App.wizNext(); await tick(); App.wizNext(); await tick(); // wws sections
  App.wizNext(); await tick(); // addmore
  App.wizNext(); await tick(); // extras
  App.wizNext(); await tick(); // review
  shows(/Review your quote/, 'back at review after jump-back round trip');
  App.wizNext(); await tick();
  shows(/Ready to save/, 'done step');
  await App.wizSave(); await tick(50);
  ok(/^#\/quote\//.test(location.hash), 'save → quote detail', location.hash);
  shows(/E2E Customer/, 'quote detail shows customer');
  shows(/E2E Job/, 'quote detail shows job name');
  // draft cleared
  ok(sandbox.window.RondorStore.Drafts.load() === null, 'draft cleared after save');

  // --- resume flow: start a new quote, bail halfway, resume from home ---
  location.hash = '#/wizard'; await winListeners['hashchange'](); await tick();
  App.wizCustField('name', 'Resume Test'); App.wizNext(); await tick();
  App.wizBasic('jobName', 'Resume Job');
  App.wizSaveExit(); await tick();
  ok(/^#\/quotes/.test(location.hash), 'save & exit → quotes list');
  location.hash = '#/'; await winListeners['hashchange'](); await tick();
  shows(/Unfinished quote/, 'home shows resume banner');
  shows(/Resume Job/, 'banner names the draft job');
  location.hash = '#/wizard'; await winListeners['hashchange'](); await tick();
  shows(/Job details/, 'resume returns to step 2 (basics)');
  shows(/Resume Job/, 'answers survived the round trip');

  // --- parked AI routes redirect ---
  location.hash = '#/ai'; await winListeners['hashchange'](); await tick(60);
  ok(location.hash === '#/docs', '#/ai redirects to docs when parked', location.hash);
  shows(/📁 Documents/, 'docs page renders');
  ok(!/Extract with AI/.test(lastHtml), 'no Extract-with-AI button when parked');
  location.hash = '#/extract'; await winListeners['hashchange'](); await tick(60);
  ok(location.hash === '#/docs', '#/extract redirects to docs when parked', location.hash);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
