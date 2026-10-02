/* Rondor Excavations — pure estimating math. No DOM, no network.
   Mirrors Commercial_Quote_2026_REVAMPED.xlsx exactly:
   - materials get the workbook's 8% markup (services/sub-trades do not)
   - catchbasin/manhole sand is unmarked (per workbook — flagged open question)
   - per-job overhead/profit: copper/WWS/LDS 12%, watermain 15%,
     abandonments 10%, catchbasins 10%, manholes 15%, admin permits 10%
   - frost surcharge 25% for work Dec 1 – Mar 31
   - lane closure per-day = width x rate  (RATE BASIS TO BE CONFIRMED) */
window.RondorCalc = (() => {
  const D = () => window.RONDOR_DATA;
  const round2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;

  function priceOf(key, overrides) {
    if (!key) return 0;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) return +overrides[key] || 0;
    const p = D().prices.find(p => p.key === key);
    return p ? +p.price || 0 : 0;
  }

  function laneDayRate(lane) {
    return (+lane.width || 0) * (+lane.rate || 0);
  }

  function resolveUnitPrice(line, lineState, prices, lane) {
    if (lineState && lineState.price !== undefined && lineState.price !== null && lineState.price !== '') {
      return +lineState.price || 0;
    }
    if (line.priceKey === 'LANE_DAY') return laneDayRate(lane);
    return priceOf(line.priceKey, prices);
  }

  // st: { lines: {lineKey: {qty, price?}}, labourQty }
  function jobTotals(jobDef, st, prices, lane) {
    st = st || {};
    const sections = jobDef.sections.map(sec => {
      const lines = sec.lines.map(l => {
        const ls = (st.lines && st.lines[l.key]) || {};
        const qty = +ls.qty || 0;
        const unitPrice = resolveUnitPrice(l, ls, prices, lane);
        const total = round2(qty * unitPrice * (l.markup || 1));
        return { key: l.key, label: l.label, unit: l.unit, note: l.note || '',
                 qty, unitPrice: round2(unitPrice), markup: l.markup || 1, total };
      });
      return { id: sec.id, name: sec.name,
               total: round2(lines.reduce((a, l) => a + l.total, 0)), lines };
    });
    const labourQty = +(st.labourQty || 0);
    const labourTotal = round2(labourQty * jobDef.labourRate);
    const subtotal = round2(sections.reduce((a, s) => a + s.total, 0) + labourTotal);
    const op = round2(subtotal * jobDef.opRate);
    return { jobId: jobDef.id, jobName: jobDef.name, sections,
             labourQty, labourRate: jobDef.labourRate, labourTotal,
             subtotal, opRate: jobDef.opRate, op, total: round2(subtotal + op) };
  }

  function adminPermitsTotals(lines, prices) {
    // lines: {lineKey: {qty}} ; no markup on permits; 10% profit
    const items = D().adminPermits.lines.map(l => {
      const qty = +(((lines || {})[l.key] || {}).qty) || 0;
      const unitPrice = priceOf(l.priceKey, prices);
      const total = round2(qty * unitPrice);
      return { key: l.key, label: l.label, qty, unitPrice: round2(unitPrice), total };
    });
    const subtotal = round2(items.reduce((a, i) => a + i.total, 0));
    const op = round2(subtotal * D().adminPermits.opRate);
    return { items, subtotal, opRate: D().adminPermits.opRate, op, total: round2(subtotal + op) };
  }

  // est: { jobs: {jobId: jobState}, adminPermits: {lines}, aiLines: [...], workDate, frostOverride, lane }
  // aiLines: [{description, quantity, unit, unit_price, category}] — freeform lines
  // extracted from parked documents (see ai-extract.js). Priced as-is, no markup.
  function quoteTotals(est, prices) {
    const lane = est.lane || { width: D().laneClosure.width, rate: D().laneClosure.ratePerSqm };
    const jobs = D().jobs
      .filter(j => est.jobs && est.jobs[j.id] && est.jobs[j.id].included)
      .map(j => jobTotals(j, est.jobs[j.id], prices, lane));
    const admin = adminPermitsTotals(est.adminPermits && est.adminPermits.lines, prices);
    const aiLines = (est.aiLines || []).map(l => {
      const quantity = +l.quantity || 0, unitPrice = round2(+l.unit_price || 0);
      return { description: String(l.description || ''), quantity, unit: String(l.unit || ''),
               unitPrice, category: String(l.category || 'other'),
               total: round2(quantity * unitPrice), docId: l.docId || null };
    });
    const aiLinesTotal = round2(aiLines.reduce((a, l) => a + l.total, 0));
    const baseTotal = round2(admin.total + jobs.reduce((a, j) => a + j.total, 0) + aiLinesTotal);
    const frostApplies = frostDecision(est.workDate, est.frostOverride);
    const frostAmount = frostApplies ? round2(baseTotal * D().frost.rate) : 0;
    const grandTotal = round2(baseTotal + frostAmount);
    return {
      jobs, admin, aiLines, aiLinesTotal,
      jobLines: jobs.map(j => ({ name: j.jobName, total: j.total })),
      adminPermitsTotal: admin.total,
      baseTotal, frostApplies, frostAmount, grandTotal
    };
  }

  function frostDecision(workDateStr, override) {
    if (override === true) return true;
    if (override === false) return false;
    if (!workDateStr) return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(workDateStr);
    if (!m) return false;
    const md = m[2] + '-' + m[3];
    return md >= '12-01' || md <= '03-31';
  }

  // ---- trench calculators (workbook formulas) ----
  function mudHaul(w, l, h) {
    const cuM = round2(w * l * h * D().trench.mudSwell);
    return { cuM, loads: round2(cuM / D().trench.mudLoadCuM) };
  }
  function pipeVolume(radiusM, lengthM) {
    return round2(D().trench.pi * radiusM * radiusM * lengthM);
  }
  function fillLoads(w, l, h, pipeVolCuM) {
    const cuM = round2(w * l * h - (pipeVolCuM || 0));
    const tonnes = round2(cuM * D().trench.tonnesPerCuM);
    return { cuM, tonnes, loads: round2(tonnes / D().trench.tonnesPerLoad) };
  }

  function blankEstimate() {
    const jobs = {};
    D().jobs.forEach(j => { jobs[j.id] = { included: false, lines: {}, labourQty: 0, trench: null }; });
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    return {
      customerId: null,
      customer: { name: '', phone: '', email: '', address: '' },
      workDate: iso, frostOverride: null,
      lane: { width: D().laneClosure.width, rate: D().laneClosure.ratePerSqm },
      jobs, adminPermits: { lines: {} }
    };
  }

  function money(n) {
    return '$' + round2(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function stampText(takenAt, lat, lng) {
    const d = new Date(takenAt);
    const p = x => String(x).padStart(2, '0');
    const ds = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    return `${ds} · ${(+lat).toFixed(5)}, ${(+lng).toFixed(5)}`;
  }

  return { priceOf, laneDayRate, jobTotals, adminPermitsTotals, quoteTotals,
           frostDecision, mudHaul, pipeVolume, fillLoads,
           blankEstimate, money, todayISO, stampText, round2 };
})();
