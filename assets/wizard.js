/* Rondor Excavations — quote wizard pure logic (no DOM).
 * Step building, plain-language question wording, and validation for the
 * TurboTax-style guided quote interview. DOM rendering lives in app.js.
 * All estimating math stays in calc.js — this module only reads job/line
 * definitions from RONDOR_DATA and writes quantities into the estimate.
 */
window.RondorWizard = (() => {
  'use strict';
  const D = () => window.RONDOR_DATA;
  const Calc = () => window.RondorCalc;

  const JOB_BLURBS = {
    copper: 'New copper water service — from the main to the building',
    wm150: '150 mm watermain — larger water main pipe',
    wws150: '150 mm wastewater sewer — sanitary sewer line',
    lds250: '250 mm land drainage sewer — stormwater / drainage line',
    abandon: 'Abandonments — safely seal off old services',
    catchbasin: 'Catchbasins — storm drains and grates',
    manhole: 'Manholes — access structures'
  };

  const SECTION_INTROS = {
    'Permits': 'Which permits does this part need? Enter a quantity — leave at 0 to skip.',
    'Sub-trades': 'Any sub-trades or hired equipment for this part? Enter quantities — 0 skips.',
    'Materials (8% markup)': 'What materials does this part need? Enter quantities — 0 skips.'
  };

  function jobDef(id) { return D().jobs.find(j => j.id === id); }
  function selectedJobs(est) {
    return D().jobs.filter(j => est.jobs && est.jobs[j.id] && est.jobs[j.id].included);
  }

  // Linear step list for the current estimate. Rebuilt whenever the set of
  // included work types changes.
  function buildSteps(est) {
    const steps = [
      { id: 'customer', title: 'Customer' },
      { id: 'basics', title: 'Job details' },
      { id: 'worktypes', title: 'Type of work' }
    ];
    for (const j of selectedJobs(est)) {
      steps.push({ id: 'labour', job: j.id, title: j.name + ' — labour' });
      for (const s of j.sections) {
        steps.push({ id: 'section', job: j.id, sec: s.id, title: j.name + ' — ' + s.name });
      }
    }
    const sel = selectedJobs(est);
    if (sel.length) steps.push({ id: 'addmore', title: 'Add more work?', job: sel[sel.length - 1].id });
    steps.push({ id: 'extras', title: 'Permits & extras' });
    steps.push({ id: 'review', title: 'Review quote' });
    steps.push({ id: 'done', title: 'Save' });
    return steps;
  }

  function stepIndexFor(steps, jobId, secId) {
    return steps.findIndex(s => s.id === 'section' && s.job === jobId && s.sec === secId);
  }
  function labourStepIndex(steps, jobId) {
    return steps.findIndex(s => s.id === 'labour' && s.job === jobId);
  }

  const UNIT_WORDS = {
    sqm: 'square metres', days: 'days', wks: 'weeks', hrs: 'hours',
    loads: 'loads', m: 'metres', ft: 'feet', lengths: 'lengths', units: 'units'
  };

  // Friendly question for one estimator line. Returns {q, hint}.
  // Special-cased lines get hand-written wording; everything else falls back
  // to a generic question built from the workbook label + unit.
  function lineQuestion(l) {
    if (l.key === 'perm_closeday') {
      return {
        q: 'Lane closure — how many days?',
        hint: 'Charged per day. The daily rate comes from your lane width × rate on the Extras step — the rate basis is still to be confirmed.'
      };
    }
    if (l.editablePrice && !l.priceKey) {
      return {
        q: l.label + ' — what did they quote you?',
        hint: 'Enter the price they quoted, then how many you need.' + (l.note ? ' ' + l.note : '')
      };
    }
    const uw = UNIT_WORDS[l.unit];
    const q = uw ? `${l.label} — how many ${uw}?` : `${l.label} — how many?`;
    return { q, hint: l.note || '' };
  }

  function sectionIntro(secName) {
    return SECTION_INTROS[secName] || 'Enter quantities — 0 skips.';
  }

  // Per-step validation. Returns an error string, or '' when the step is fine.
  function validateStep(step, est) {
    if (step.id === 'customer') {
      if (!est.customer || !est.customer.name || !est.customer.name.trim()) {
        return 'Enter the customer name (or pick an existing customer above).';
      }
    }
    if (step.id === 'basics') {
      if (!est.jobName || !est.jobName.trim()) return 'Give the job a name — e.g. "Smith — sewer replacement".';
    }
    if (step.id === 'worktypes') {
      if (!selectedJobs(est).length) return 'Pick at least one type of work.';
    }
    return '';
  }

  // Ensure every selected job has a state object (mirrors calc.blankEstimate shape).
  function ensureJobState(est, jobId) {
    if (!est.jobs[jobId]) est.jobs[jobId] = { included: true, lines: {}, labourQty: 0, trench: null };
    est.jobs[jobId].included = true;
    return est.jobs[jobId];
  }

  function setLineQty(est, jobId, lineKey, qty) {
    const js = ensureJobState(est, jobId);
    const L = js.lines[lineKey] || (js.lines[lineKey] = {});
    L.qty = Math.max(0, parseFloat(qty) || 0);
  }
  function setLinePrice(est, jobId, lineKey, price) {
    const js = ensureJobState(est, jobId);
    const L = js.lines[lineKey] || (js.lines[lineKey] = {});
    L.price = (price === '' || price == null) ? undefined : Math.max(0, parseFloat(price) || 0);
  }

  // Review model: grouped lines with qty > 0, each mapped back to its step.
  function reviewGroups(est, prices) {
    const t = Calc().quoteTotals(est, prices);
    const groups = t.jobs.map(j => {
      const jobId = j.jobId;
      const sections = j.sections
        .map(s => ({
          id: s.id, name: s.name, total: s.total,
          lines: s.lines.filter(l => l.qty > 0)
        }))
        .filter(s => s.lines.length);
      return {
        jobId, name: j.jobName, total: j.total,
        labourQty: j.labourQty, labourTotal: j.labourTotal, labourRate: j.labourRate,
        op: j.op, opRate: j.opRate, subtotal: j.subtotal,
        sections
      };
    });
    const adminLines = t.admin.items.filter(i => i.qty > 0);
    return { groups, adminLines, totals: t };
  }

  return {
    JOB_BLURBS, SECTION_INTROS,
    jobDef, selectedJobs, buildSteps, stepIndexFor, labourStepIndex,
    lineQuestion, sectionIntro, validateStep,
    ensureJobState, setLineQty, setLinePrice, reviewGroups
  };
})();
