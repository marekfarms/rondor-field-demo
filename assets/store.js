/* Rondor Excavations — data layer.
   One interface, two backends:
     LocalStore  — zero-setup, everything in localStorage. Used when
                   config.DEMO_MODE is true or no Supabase keys are set.
     LiveStore   — Supabase (Postgres + Auth + Storage). Same UI.
   The app only ever talks to `Store`.
   Parked documents live in IndexedDB (too big for localStorage); see `Docs`. */
window.RondorStore = (() => {
  const C = window.RONDOR_DATA, Calc = window.RondorCalc;
  const LS_KEY = 'rondor_app_v2';
  const DRAFT_KEY = 'rondor_draft';
  const OUTBOX_DB = 'rondor_outbox';
  const DOCS_DB = 'rondor_docs';

  const uid = (p) => (p || 'x').replace(/[^a-z0-9]/gi, '').slice(0, 8) +
    Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6);
  const token = () => [...crypto.getRandomValues(new Uint8Array(24))]
    .map(b => b.toString(16).padStart(2, '0')).join('');

  function defaultPrices() {
    const m = {};
    C.prices.forEach(p => { m[p.key] = p.price; });
    return m;
  }

  /* ================= LOCAL STORE ================= */
  class LocalStore {
    constructor() { this.mode = 'local'; this._cbs = []; }
    _load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
      if (!d || !d.seeded) { d = this._seed(); localStorage.setItem(LS_KEY, JSON.stringify(d)); }
      return d;
    }
    _save(d) { localStorage.setItem(LS_KEY, JSON.stringify(d)); }
    _emit() { this._cbs.forEach(cb => cb(this._session)); }
    onAuth(cb) { this._cbs.push(cb); }

    _seed() {
      // Fresh production install: two fixed accounts, the workbook default
      // price list, and nothing else. No sample customers, quotes, or jobs.
      const d = { seeded: true, profiles: [], customers: [], quotes: [],
                  jobs: [], cos: [], actuals: [], photos: [],
                  prices: defaultPrices(), counter: {}, session: null };
      d.profiles.push(
        { id: 'demo-admin', email: 'admin', display_name: 'Owner', role: 'owner', created_at: new Date().toISOString() },
        { id: 'demo-user', email: 'user', display_name: 'Field worker', role: 'worker', created_at: new Date().toISOString() }
      );
      return d;
    }

    /* ---- auth ---- */
    async signIn(id, password) {
      const d = this._load();
      const ok = (id === 'admin' && password === 'admin') || (id === 'user' && password === 'user');
      if (!ok) throw new Error('Invalid login. Use admin/admin or user/user.');
      const pid = id === 'admin' ? 'demo-admin' : 'demo-user';
      d.session = { profileId: pid, at: Date.now() };
      this._session = d.session; this._save(d); this._emit();
      return this.myProfile();
    }
    async signOut() {
      const d = this._load(); d.session = null; this._session = null; this._save(d); this._emit();
    }
    session() { return this._session || this._load().session; }
    async resetPassword() { throw new Error('Password reset needs the live backend. Accounts on this install are fixed: admin/admin, user/user.'); }

    /* ---- profiles ---- */
    async myProfile() {
      const d = this._load(); const s = d.session || this._session;
      if (!s) return null;
      return d.profiles.find(p => p.id === s.profileId) || null;
    }
    async listProfiles() { return this._load().profiles.slice(); }
    async setRole(pid, role) {
      const d = this._load();
      const p = d.profiles.find(x => x.id === pid); if (p) p.role = role;
      this._save(d);
    }
    async updateDisplayName(pid, name) {
      const d = this._load();
      const p = d.profiles.find(x => x.id === pid); if (p) p.display_name = name;
      this._save(d);
    }

    /* ---- customers ---- */
    async listCustomers() { return this._load().customers.slice().sort((a,b)=>a.name.localeCompare(b.name)); }
    async getCustomer(id) { return this._load().customers.find(c => c.id === id) || null; }
    async saveCustomer(c) {
      const d = this._load();
      if (!c.id) { c.id = uid('c'); c.owner_id = 'demo-admin'; c.created_at = new Date().toISOString(); d.customers.push(c); }
      else { const i = d.customers.findIndex(x => x.id === c.id); if (i >= 0) d.customers[i] = { ...d.customers[i], ...c }; }
      this._save(d); return c;
    }
    async customerHistory(id) {
      const d = this._load();
      return { quotes: d.quotes.filter(q => q.customer_id === id), jobs: d.jobs.filter(j => j.customer_id === id) };
    }

    /* ---- quotes ---- */
    _nextNumber() {
      const d = this._load(); const y = new Date().getFullYear();
      d.counter[y] = (d.counter[y] || 0) + 1; this._save(d);
      return 'R-' + y + '-' + String(d.counter[y]).padStart(4, '0');
    }
    async listQuotes() { return this._load().quotes.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)); }
    async getQuote(id) { return this._load().quotes.find(q => q.id === id) || null; }
    async saveQuote(q) {
      const d = this._load();
      if (!q.id) {
        q.id = uid('q'); q.owner_id = 'demo-admin'; q.number = this._nextNumber();
        q.created_at = new Date().toISOString(); q.status = q.status || 'draft';
        d.quotes.push(q);
      } else {
        const i = d.quotes.findIndex(x => x.id === q.id);
        if (i >= 0) d.quotes[i] = { ...d.quotes[i], ...q };
      }
      this._save(d); return q;
    }
    async deleteQuote(id) {
      const d = this._load(); d.quotes = d.quotes.filter(q => q.id !== id); this._save(d);
    }
    async sendQuoteLink(id) {
      const d = this._load();
      const q = d.quotes.find(x => x.id === id); if (!q) throw new Error('Quote not found');
      if (!q.accept_token) q.accept_token = token();
      if (q.status === 'draft') q.status = 'sent';
      this._save(d);
      return acceptUrl('?t=' + q.accept_token);
    }

    /* ---- jobs ---- */
    async listJobs() { return this._load().jobs.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)); }
    async getJob(id) { return this._load().jobs.find(j => j.id === id) || null; }
    async saveJob(j) {
      const d = this._load();
      if (!j.id) { j.id = uid('j'); j.owner_id = 'demo-admin'; j.created_at = new Date().toISOString(); d.jobs.push(j); }
      else { const i = d.jobs.findIndex(x => x.id === j.id); if (i >= 0) d.jobs[i] = { ...d.jobs[i], ...j }; }
      this._save(d); return j;
    }
    async deleteJob(id) {
      const d = this._load();
      d.jobs = d.jobs.filter(j => j.id !== id);
      d.cos = d.cos.filter(c => c.job_id !== id);
      d.actuals = d.actuals.filter(a => a.job_id !== id);
      d.photos = d.photos.filter(p => p.job_id !== id);
      this._save(d);
    }
    // worker-safe: id, name, address, status ONLY — never financials
    async myJobs() {
      const me = await this.myProfile(); if (!me) return [];
      if (me.role === 'owner') return (await this.listJobs()).map(j => ({ ...j }));
      return this._load().jobs
        .filter(j => (j.assigned_worker_ids || []).includes(me.id))
        .map(j => ({ id: j.id, name: j.name, address: j.address, status: j.status, created_at: j.created_at }));
    }

    /* ---- change orders ---- */
    async listCOs(jobId) { return this._load().cos.filter(c => c.job_id === jobId); }
    async saveCO(co) {
      const d = this._load();
      if (!co.id) { co.id = uid('co'); co.owner_id = 'demo-admin'; co.status = 'pending'; co.created_at = new Date().toISOString(); d.cos.push(co); }
      else { const i = d.cos.findIndex(x => x.id === co.id); if (i >= 0) d.cos[i] = { ...d.cos[i], ...co }; }
      this._save(d); return co;
    }
    async sendCOLink(id) {
      const d = this._load();
      const co = d.cos.find(x => x.id === id); if (!co) throw new Error('Change order not found');
      if (!co.token) co.token = token();
      this._save(d);
      return acceptUrl('?co=' + co.token);
    }

    /* ---- actuals ---- */
    async listActuals(jobId) { return this._load().actuals.filter(a => a.job_id === jobId); }
    async saveActual(a) {
      const d = this._load();
      if (!a.id) { a.id = uid('a'); a.owner_id = 'demo-admin'; a.created_at = new Date().toISOString(); d.actuals.push(a); }
      else { const i = d.actuals.findIndex(x => x.id === a.id); if (i >= 0) d.actuals[i] = { ...d.actuals[i], ...a }; }
      this._save(d); return a;
    }
    async deleteActual(id) { const d = this._load(); d.actuals = d.actuals.filter(a => a.id !== id); this._save(d); }

    /* ---- photos ---- */
    async listPhotos(jobId) {
      return this._load().photos.filter(p => p.job_id === jobId)
        .sort((a, b) => b.taken_at.localeCompare(a.taken_at));
    }
    async uploadPhoto(jobId, blob, meta) {
      const d = this._load();
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob);
      });
      const me = await this.myProfile();
      const photo = { id: uid('p'), job_id: jobId, owner_id: 'demo-admin',
        worker_id: me ? me.id : null, storage_path: 'local/' + jobId + '/' + Date.now() + '.jpg',
        taken_at: meta.taken_at, lat: meta.lat, lng: meta.lng, note: meta.note || '',
        dataUrl, created_at: new Date().toISOString() };
      d.photos.push(photo); this._save(d); return photo;
    }
    async photoUrl(photo) { return photo.dataUrl || ''; }

    /* ---- prices ---- */
    async getPrices() { return { ...this._load().prices }; }
    async savePrices(map) { const d = this._load(); d.prices = { ...map }; this._save(d); }

    /* ---- public token pages ---- */
    async publicQuote(t) {
      const q = this._load().quotes.find(x => x.accept_token === t);
      if (!q) return null;
      const c = await this.getCustomer(q.customer_id);
      return { number: q.number, status: q.status, work_date: q.work_date,
        customer_name: c ? c.name : (q.estimate.customer || {}).name || '',
        job_lines: q.totals.jobLines, ai_lines: q.totals.aiLines || [],
        ai_total: q.totals.aiLinesTotal || 0, admin_permits: q.totals.adminPermitsTotal,
        frost: q.totals.frostAmount, total: q.totals.grandTotal, terms: q.terms,
        accepted_at: q.accepted_at, accepted_by: q.accepted_by_name };
    }
    async acceptQuote(t, name) {
      if (!name || name.trim().length < 2) return false;
      const d = this._load();
      const q = d.quotes.find(x => x.accept_token === t);
      if (!q || !['draft', 'sent'].includes(q.status)) return false;
      q.status = 'accepted'; q.accepted_at = new Date().toISOString(); q.accepted_by_name = name.trim();
      this._save(d); return true;
    }
    async publicCO(t) {
      const d = this._load();
      const co = d.cos.find(x => x.token === t); if (!co) return null;
      const j = d.jobs.find(x => x.id === co.job_id);
      return { job_name: j ? j.name : '', description: co.description, price: co.price,
               status: co.status, approved_at: co.approved_at, approved_by: co.approved_by_name };
    }
    async approveCO(t, name) {
      if (!name || name.trim().length < 2) return false;
      const d = this._load();
      const co = d.cos.find(x => x.token === t);
      if (!co || co.status !== 'pending') return false;
      co.status = 'approved'; co.approved_at = new Date().toISOString(); co.approved_by_name = name.trim();
      this._save(d); return true;
    }
  }

  /* ================= LIVE (SUPABASE) STORE ================= */
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  const SB_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  class LiveStore {
    constructor() { this.mode = 'live'; this._cbs = []; }
    async init() {
      await loadScript(SB_CDN);
      const cfg = window.RONDOR_CONFIG;
      this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data } = await this.sb.auth.getSession();
      this._session = data.session || null;
      this.sb.auth.onAuthStateChange((_e, s) => { this._session = s; this._emit(); });
    }
    _emit() { this._cbs.forEach(cb => cb(this._session)); }
    onAuth(cb) { this._cbs.push(cb); }
    session() { return this._session; }

    async signIn(email, password) {
      const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return this.myProfile();
    }
    async signOut() { await this.sb.auth.signOut(); }
    async resetPassword(email) {
      const { error } = await this.sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html#/login'
      });
      if (error) throw error;
    }

    async myProfile() {
      const s = this._session || (await this.sb.auth.getSession()).data.session;
      if (!s) return null;
      const { data, error } = await this.sb.from('profiles').select('*').eq('id', s.user.id).single();
      if (error) throw error;
      return data;
    }
    async listProfiles() {
      const { data, error } = await this.sb.from('profiles').select('*').order('created_at');
      if (error) throw error; return data;
    }
    async setRole(pid, role) {
      const { error } = await this.sb.from('profiles').update({ role }).eq('id', pid);
      if (error) throw error;
    }
    async updateDisplayName(pid, name) {
      // SECURITY: users may only change their own display name, never their
      // role — enforced by the set_my_display_name() definer function.
      const { error } = await this.sb.rpc('set_my_display_name', { p_name: name });
      if (error) throw error;
    }

    async listCustomers() {
      const { data, error } = await this.sb.from('customers').select('*').order('name');
      if (error) throw error; return data;
    }
    async getCustomer(id) {
      const { data, error } = await this.sb.from('customers').select('*').eq('id', id).single();
      if (error) throw error; return data;
    }
    async saveCustomer(c) {
      const me = await this.myProfile();
      if (c.id) {
        const { data, error } = await this.sb.from('customers').update(c).eq('id', c.id).select().single();
        if (error) throw error; return data;
      }
      const { data, error } = await this.sb.from('customers')
        .insert({ ...c, owner_id: me.id }).select().single();
      if (error) throw error; return data;
    }
    async customerHistory(id) {
      const [q, j] = await Promise.all([
        this.sb.from('quotes').select('id,number,status,work_date,created_at').eq('customer_id', id),
        this.sb.from('jobs').select('id,name,status,created_at').eq('customer_id', id)
      ]);
      return { quotes: q.data || [], jobs: j.data || [] };
    }

    async listQuotes() {
      const { data, error } = await this.sb.from('quotes').select('*').order('created_at', { ascending: false });
      if (error) throw error; return data;
    }
    async getQuote(id) {
      const { data, error } = await this.sb.from('quotes').select('*').eq('id', id).single();
      if (error) throw error; return data;
    }
    async saveQuote(q) {
      if (q.id) {
        const { data, error } = await this.sb.from('quotes').update(q).eq('id', q.id).select().single();
        if (error) throw error; return data;
      }
      const number = await this.sb.rpc('next_quote_number');
      if (number.error) throw number.error;
      const me = await this.myProfile();
      const { data, error } = await this.sb.from('quotes')
        .insert({ ...q, owner_id: me.id, number: number.data, status: q.status || 'draft' })
        .select().single();
      if (error) throw error; return data;
    }
    async deleteQuote(id) {
      const { error } = await this.sb.from('quotes').delete().eq('id', id);
      if (error) throw error;
    }
    async sendQuoteLink(id) {
      const q = await this.getQuote(id);
      let t = q.accept_token;
      if (!t) {
        t = token();
        const { error } = await this.sb.from('quotes')
          .update({ accept_token: t, status: q.status === 'draft' ? 'sent' : q.status }).eq('id', id);
        if (error) throw error;
      }
      return acceptUrl('?t=' + t);
    }

    async listJobs() {
      const { data, error } = await this.sb.from('jobs').select('*').order('created_at', { ascending: false });
      if (error) throw error; return data;
    }
    async getJob(id) {
      const { data, error } = await this.sb.from('jobs').select('*').eq('id', id).single();
      if (error) throw error; return data;
    }
    async saveJob(j) {
      const me = await this.myProfile();
      if (j.id) {
        const { data, error } = await this.sb.from('jobs').update(j).eq('id', j.id).select().single();
        if (error) throw error; return data;
      }
      const { data, error } = await this.sb.from('jobs').insert({ ...j, owner_id: me.id }).select().single();
      if (error) throw error; return data;
    }
    async deleteJob(id) {
      const { error } = await this.sb.from('jobs').delete().eq('id', id);
      if (error) throw error;
    }
    async myJobs() {
      const me = await this.myProfile(); if (!me) return [];
      if (me.role === 'owner') return this.listJobs();
      // SECURITY: RPC returns ONLY id, name, address, status — never financials.
      const { data, error } = await this.sb.rpc('get_worker_jobs');
      if (error) throw error; return data || [];
    }

    async listCOs(jobId) {
      const { data, error } = await this.sb.from('change_orders').select('*').eq('job_id', jobId).order('created_at');
      if (error) throw error; return data;
    }
    async saveCO(co) {
      const me = await this.myProfile();
      if (co.id) {
        const { data, error } = await this.sb.from('change_orders').update(co).eq('id', co.id).select().single();
        if (error) throw error; return data;
      }
      const { data, error } = await this.sb.from('change_orders')
        .insert({ ...co, owner_id: me.id, status: 'pending' }).select().single();
      if (error) throw error; return data;
    }
    async sendCOLink(id) {
      const { data: co, error } = await this.sb.from('change_orders').select('*').eq('id', id).single();
      if (error) throw error;
      let t = co.token;
      if (!t) {
        t = token();
        const u = await this.sb.from('change_orders').update({ token: t }).eq('id', id);
        if (u.error) throw u.error;
      }
      return acceptUrl('?co=' + t);
    }

    async listActuals(jobId) {
      const { data, error } = await this.sb.from('actuals').select('*').eq('job_id', jobId).order('created_at');
      if (error) throw error; return data;
    }
    async saveActual(a) {
      const me = await this.myProfile();
      const { data, error } = await this.sb.from('actuals').insert({ ...a, owner_id: me.id }).select().single();
      if (error) throw error; return data;
    }
    async deleteActual(id) {
      const { error } = await this.sb.from('actuals').delete().eq('id', id);
      if (error) throw error;
    }

    async listPhotos(jobId) {
      const { data, error } = await this.sb.from('photos').select('*')
        .eq('job_id', jobId).order('taken_at', { ascending: false });
      if (error) throw error; return data || [];
    }
    async uploadPhoto(jobId, blob, meta) {
      const me = await this.myProfile();
      const job = await this.getJob(jobId).catch(() => null);
      const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const up = await this.sb.storage.from('job-photos').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { data, error } = await this.sb.from('photos').insert({
        job_id: jobId, owner_id: job ? job.owner_id : me.id, worker_id: me.id,
        storage_path: path, taken_at: meta.taken_at, lat: meta.lat, lng: meta.lng, note: meta.note || ''
      }).select().single();
      if (error) throw error; return data;
    }
    async photoUrl(photo) {
      const { data, error } = await this.sb.storage.from('job-photos')
        .createSignedUrl(photo.storage_path, 3600);
      if (error) throw error; return data.signedUrl;
    }

    async getPrices() {
      const me = await this.myProfile();
      const { data } = await this.sb.from('price_lists').select('prices').eq('owner_id', me.id).single();
      if (data && data.prices) return data.prices;
      const seeded = defaultPrices();
      await this.sb.from('price_lists').insert({ owner_id: me.id, prices: seeded });
      return seeded;
    }
    async savePrices(map) {
      const me = await this.myProfile();
      const { error } = await this.sb.from('price_lists')
        .upsert({ owner_id: me.id, prices: map, updated_at: new Date().toISOString() });
      if (error) throw error;
    }

    /* public token pages hit the SECURITY DEFINER functions (anon-safe) */
    async publicQuote(t) {
      const { data, error } = await this.sb.rpc('get_quote_public', { p_token: t });
      if (error) throw error; return data;
    }
    async acceptQuote(t, name) {
      const { data, error } = await this.sb.rpc('accept_quote_public', { p_token: t, p_name: name });
      if (error) throw error; return data;
    }
    async publicCO(t) {
      const { data, error } = await this.sb.rpc('get_co_public', { p_token: t });
      if (error) throw error; return data;
    }
    async approveCO(t, name) {
      const { data, error } = await this.sb.rpc('approve_co_public', { p_token: t, p_name: name });
      if (error) throw error; return data;
    }
  }

  function acceptUrl(qs) {
    const base = location.href.split('?')[0].replace(/index\.html$/, '');
    return base + 'accept.html' + qs;
  }

  function isDemoMode() {
    const cfg = window.RONDOR_CONFIG || {};
    return cfg.DEMO_MODE === true ||
      !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT');
  }

  let _store = null;
  async function init() {
    if (_store) return _store;
    _store = isDemoMode() ? new LocalStore() : new LiveStore();
    if (_store.init) await _store.init();
    return _store;
  }

  /* ---- offline photo outbox (IndexedDB) ---- */
  const Outbox = {
    _db() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(OUTBOX_DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async add(item) { const db = await this._db(); return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').add(item);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async all() { const db = await this._db(); return new Promise((res, rej) => {
      const q = db.transaction('photos', 'readonly').objectStore('photos').getAll();
      q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); },
    async remove(id) { const db = await this._db(); return new Promise((res, rej) => {
      const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').delete(id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },
    async flush(store, onOne) {
      const items = await this.all();
      let done = 0;
      for (const it of items) {
        try {
          await store.uploadPhoto(it.jobId, it.blob, { taken_at: it.takenAt, lat: it.lat, lng: it.lng, note: it.note });
          await this.remove(it.id); done++;
          if (onOne) onOne(done, items.length);
        } catch (e) { break; } // stop on first failure; retry later
      }
      return done;
    }
  };

  /* ---- estimator draft autosave (localStorage) ---- */
  const Drafts = {
    // Wizard in-progress state: { est, wizStep, quoteId }
    save(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ d, at: Date.now() })); } catch (e) {} },
    load() { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); return d && d.d; } catch (e) { return null; } },
    clear() { localStorage.removeItem(DRAFT_KEY); }
  };

  /* ---- parked documents (IndexedDB — file blobs are too big for localStorage) ----
     Docs are owner-only by UI routing. Each doc: {id, name, mime, size, blob,
     jobId|null, quoteId|null, parkedAt}. */
  const Docs = {
    _db() {
      return new Promise((res, rej) => {
        const r = indexedDB.open(DOCS_DB, 1);
        r.onupgradeneeded = () => {
          if (!r.result.objectStoreNames.contains('docs'))
            r.result.createObjectStore('docs', { keyPath: 'id' });
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    _req(promiseFn) {
      return this._db().then(db => new Promise((res, rej) => {
        const tx = db.transaction('docs', 'readwrite');
        const store = tx.objectStore('docs');
        const q = promiseFn(store);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
        tx.onerror = () => rej(tx.error);
      }));
    },
    async add(doc) {
      doc.id = doc.id || uid('doc');
      doc.parkedAt = doc.parkedAt || new Date().toISOString();
      await this._req(s => s.put(doc));
      return doc;
    },
    async all() {
      const rows = await this._db().then(db => new Promise((res, rej) => {
        const q = db.transaction('docs', 'readonly').objectStore('docs').getAll();
        q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error);
      }));
      return rows.sort((a, b) => (b.parkedAt || '').localeCompare(a.parkedAt || ''));
    },
    async get(id) {
      return this._db().then(db => new Promise((res, rej) => {
        const q = db.transaction('docs', 'readonly').objectStore('docs').get(id);
        q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
      }));
    },
    async setLink(id, jobId, quoteId) {
      const d = await this.get(id); if (!d) return;
      d.jobId = jobId || null; d.quoteId = quoteId || null;
      await this._req(s => s.put(d));
    },
    async remove(id) {
      await this._db().then(db => new Promise((res, rej) => {
        const tx = db.transaction('docs', 'readwrite');
        tx.objectStore('docs').delete(id);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      }));
    }
  };

  return { init, isDemoMode, Outbox, Drafts, Docs, get store() { return _store; } };
})();
