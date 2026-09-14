/* Ashby application-form filler — runs inside the page.
 *
 * Injected with page.evaluate(). Exposes window.__ashby:
 *   configure(me)  install personal details (kept out of this file on purpose)
 *   fill()         apply the deterministic RULES, return [{name, path, ok, err}]
 *   pending()      describe every still-empty field, for the model
 *   applyPlan(p)   execute the model's plan, outline gold (filled) / red (skipped or failed)
 *   dumpLabels()   every field + detected kind, for debugging a new form
 *
 * DOM facts verified against live boards 2026-09-13:
 *   entry      div.ashby-application-form-field-entry[data-field-path]
 *   label      label.ashby-application-form-question-title; REQUIRED is signalled by a
 *              hashed class containing "_required_" (e.g. _required_f7cvd_91), not by
 *              aria-required, and not by any abbr/asterisk element.
 *   yes/no     .ashby-application-form-input-yesno > button[data-option=yes|no][aria-pressed]
 *   autocomplete .ashby-application-form-input-autocomplete (input[role=combobox]) — its
 *              [role=listbox] is PORTALED TO document.body, NOT inside the entry. Scoping
 *              the option search to the entry finds nothing.
 *   radio      .ashby-application-form-input-radio-group (EEOC etc.)
 *   file       .ashby-application-form-input-file > input[type=file] (visually hidden but
 *              present, so Playwright setInputFiles works — no click-the-button dance)
 *   There is no <form> element on the page.
 */
(function () {
  'use strict';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let ME = {};

  // ---- low level ---------------------------------------------------------

  // React tracks input values on the node; assigning .value directly is silently
  // reverted on the next render. Go through the prototype setter so React's
  // onChange sees a real change.
  function setReactValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // A bare .click() misses handlers bound to pointer/mouse events, which the
  // autocomplete results use. Send the whole sequence at the element's centre.
  function realClick(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, view: window,
                   clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const ptr = { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', ptr));
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new PointerEvent('pointerup', ptr));
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  async function waitFor(fn, { timeout = 4000, step = 100 } = {}) {
    const until = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > until) return null;
      await sleep(step);
    }
  }

  // ---- entries -----------------------------------------------------------

  const allEntries = () => [...document.querySelectorAll('[data-field-path]')];
  const byPath = p => document.querySelector('[data-field-path="' + CSS.escape(p) + '"]');
  const labelOf = en => en.querySelector('label')?.textContent.trim() ?? '';
  const pathOf  = en => en.getAttribute('data-field-path');

  function findEntry(re) {
    return allEntries().find(en => re.test(labelOf(en))) ?? null;
  }

  function isRequired(en) {
    const lbl = en.querySelector('label');
    if (lbl && /_required_/.test(lbl.className)) return true;
    return !!en.querySelector('input[required], textarea[required], select[required], [aria-required="true"]');
  }

  // Class-based, because it stays correct when an entry mixes controls — e.g. the
  // "Phone Number" entry holds an input[type=tel] plus two stray radios, and a
  // tag-priority check would call that a radio group.
  function kindOf(en) {
    if (en.querySelector('.ashby-application-form-input-file'))           return 'file';
    if (en.querySelector('.ashby-application-form-input-yesno'))          return 'yesno';
    if (en.querySelector('.ashby-application-form-input-autocomplete'))   return 'combobox';
    if (en.querySelector('.ashby-application-form-input-radio-group'))    return 'radio';
    if (en.querySelector('.ashby-application-form-input-checkbox-group')) return 'checkbox';
    if (en.querySelector('.ashby-application-form-input-textarea'))       return 'longtext';
    if (en.querySelector('select'))                                       return 'select';
    if (en.querySelector('.ashby-application-form-input-text'))           return 'text';
    // Fallbacks, in case the class names change under us.
    if (en.querySelector('input[type=file]'))                             return 'file';
    if (en.querySelector('button[data-option]'))                          return 'yesno';
    if (en.querySelector('input[role=combobox]'))                         return 'combobox';
    if (en.querySelector('input[type=radio]'))                            return 'radio';
    // Must precede the generic input fallback: a checkbox group has no text
    // input, and calling it "text" makes every filler fail with "no text input".
    if (en.querySelector('input[type=checkbox]'))                         return 'checkbox';
    if (en.querySelector('textarea'))                                     return 'longtext';
    if (en.querySelector('input'))                                        return 'text';
    return 'unknown';
  }

  // Checkboxes on these forms are overwhelmingly consent: arbitration agreements,
  // "I hereby certify that the answers given by me are true", demographic
  // self-identification. Nothing here ever ticks one — they are reported as
  // pending, outlined red, and left for the person submitting the application.
  const NEVER_TICK = 'checkbox — agreements and self-identification are yours to tick';

  const textInput = en => en.querySelector(
    'textarea, input[role=combobox], input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number]');

  function isEmpty(en) {
    switch (kindOf(en)) {
      case 'file':     return !(en.querySelector('input[type=file]')?.files?.length);
      case 'yesno':    return !en.querySelector('button[data-option][aria-pressed="true"]');
      case 'radio':    return !en.querySelector('input[type=radio]:checked');
      case 'checkbox': return !en.querySelector('input[type=checkbox]:checked');
      case 'select':   return !en.querySelector('select')?.value;
      default:         return !(textInput(en)?.value ?? '').trim();
    }
  }

  function optionsOf(en) {
    const kind = kindOf(en);
    if (kind === 'select') {
      return [...en.querySelectorAll('select option')].map(o => o.textContent.trim()).filter(Boolean);
    }
    if (kind === 'radio') {
      return [...en.querySelectorAll('input[type=radio]')].map(r =>
        en.querySelector('label[for="' + CSS.escape(r.id) + '"]')?.textContent.trim() ??
        r.closest('.ashby-application-form-input-radio-group-option')
         ?.querySelector('.ashby-application-form-input-radio-group-option-label')?.textContent.trim() ??
        r.value ?? '');
    }
    if (kind === 'checkbox') {
      return [...en.querySelectorAll('.ashby-application-form-input-checkbox-group-option')]
        .map(o => o.textContent.trim()).filter(Boolean);
    }
    if (kind === 'yesno') return ['yes', 'no'];
    return undefined;
  }

  // A combobox carries no options in the DOM until it is opened. Open it with an
  // empty query, read what it offers, then close. Geo autocompletes return nothing
  // (they need a query) and that is fine — the field just has no options list.
  // Restricted pick-lists (offices, countries, "how did you hear about us") return
  // their full set, which is what lets the model choose a value that will stick.
  async function probeCombo(en) {
    const el = en.querySelector('input[role=combobox]');
    if (!el || el.value.trim()) return undefined;
    const toggle = en.querySelector('button');
    try {
      if (toggle) realClick(toggle); else el.focus();
      const opts = await waitFor(() => {
        const o = [...document.querySelectorAll('[role=option]')];
        return o.length ? o : null;
      }, { timeout: 1200, step: 80 });
      const texts = opts ? opts.map(o => o.textContent.trim()).filter(Boolean).slice(0, 60) : undefined;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      el.blur();
      await sleep(120);
      return texts;
    } catch { return undefined; }
  }

  // ---- fillers -----------------------------------------------------------

  async function fillText(en, value) {
    const el = textInput(en);
    if (!el) throw new Error('no text input in entry');
    el.focus();
    setReactValue(el, String(value));
    el.blur();
    await sleep(30);
  }

  async function fillYesNo(en, value) {
    const want = /^(y|yes|true|1)$/i.test(String(value)) ? 'yes' : 'no';
    // Re-find by path: React re-renders these on click, and a stale `en` reference
    // makes a document-wide fallback hit a different question's button.
    const path = pathOf(en);
    const btn = byPath(path)?.querySelector('button[data-option="' + want + '"]');
    if (!btn) throw new Error('no ' + want + ' button');
    realClick(btn);
    await sleep(80);
    const ok = await waitFor(
      () => byPath(path)?.querySelector('button[data-option="' + want + '"][aria-pressed="true"]'),
      { timeout: 1500 });
    if (!ok) throw new Error(want + ' did not take');
  }

  async function fillPick(en, matcher) {
    const re = matcher instanceof RegExp ? matcher : new RegExp(escapeRe(matcher), 'i');
    const kind = kindOf(en);

    if (kind === 'select') {
      const sel = en.querySelector('select');
      const opt = [...sel.options].find(o => re.test(o.textContent.trim()));
      if (!opt) throw new Error('no option matching ' + re);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (kind === 'radio') {
      const radios = [...en.querySelectorAll('input[type=radio]')];
      const labels = optionsOf(en);
      const i = labels.findIndex(t => re.test(t));
      if (i < 0) throw new Error('no radio matching ' + re + ' in [' + labels.join(' | ') + ']');
      realClick(radios[i]);
      await sleep(60);
      if (!radios[i].checked) { radios[i].click(); await sleep(60); }
      if (!en.querySelector('input[type=radio]:checked')) throw new Error('radio did not take');
      return;
    }

    if (kind === 'yesno') return fillYesNo(en, /^y/i.test(String(matcher)) ? 'yes' : 'no');
    throw new Error('fillPick on kind=' + kind);
  }

  // Match an option against the typed query. Deliberately strict: these lists are
  // debounced and the popup keeps showing the PREVIOUS query's results for a
  // moment, so accepting "whatever is first" can enter something unrelated —
  // typing "Cedar Rapids" into a country list was observed offering "New Zealand"
  // left over from an earlier keystroke. A wrong value entered silently is far
  // worse than an empty field the model or the human then fills.
  function matchOption(opts, value) {
    const want = String(value).trim().toLowerCase();
    const text = o => o.textContent.trim().toLowerCase();
    const head = want.split(',')[0].trim();          // "Cedar Rapids, Iowa" -> "Cedar Rapids"
    return opts.find(o => text(o) === want)
        ?? opts.find(o => text(o).startsWith(want))
        ?? opts.find(o => text(o).startsWith(head))
        ?? opts.find(o => text(o).includes(want))
        ?? null;
  }

  async function fillCombo(en, value) {
    const el = en.querySelector('input[role=combobox]');
    if (!el) throw new Error('no combobox in entry');

    el.focus();
    setReactValue(el, '');                           // clear, so stale results cannot linger
    await sleep(150);
    setReactValue(el, String(value));

    // The results listbox is portaled to document.body — do NOT scope this query
    // to the entry. Wait for an option that actually matches, rather than for the
    // first option of any kind, so the debounce race resolves before we click.
    const pick = await waitFor(() => {
      const o = [...document.querySelectorAll('[role=option]')];
      return o.length ? matchOption(o, value) : null;
    }, { timeout: 5000, step: 150 });

    if (!pick) {
      const seen = [...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim()).slice(0, 5);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      setReactValue(el, '');
      el.blur();
      throw new Error('no suggestion matching "' + value + '"' + (seen.length ? ' (offered: ' + seen.join(', ') + ')' : ''));
    }

    realClick(pick);
    await sleep(250);
    if (!el.value.trim()) throw new Error('selection did not take');
    return el.value.trim();
  }

  // Location widgets differ per board: one is a city/region geocoder, the next is a
  // plain country list. Try the most specific value first and fall back to broader
  // ones rather than failing the field outright.
  async function fillLocation(en, value) {
    const tries = [value ?? ME.location, ...(ME.locationFallbacks ?? [])].filter(Boolean);
    if (!tries.length) throw new Error('no value configured');
    let last;
    for (const t of tries) {
      try { return await fillCombo(en, t); }
      catch (e) { last = e; }
    }
    throw last;
  }

  // ---- deterministic rules ----------------------------------------------
  // Applied in order to empty entries only. `value` returning null/undefined
  // means "no value configured" and the rule is reported as skipped, so the
  // field falls through to the model pass instead of being silently left blank.

  const RULES = [
    { name: 'name',        match: /^(full )?name$|^your name$/i,                        kind: 'text',   value: () => ME.name },
    { name: 'first name',  match: /first name/i,                                        kind: 'text',   value: () => ME.firstName },
    { name: 'last name',   match: /last name|surname/i,                                 kind: 'text',   value: () => ME.lastName },
    { name: 'email',       match: /e-?mail/i,                                           kind: 'text',   value: () => ME.email },
    { name: 'phone',       match: /phone|mobile/i,                                      kind: 'text',   value: () => ME.phone },
    { name: 'linkedin',    match: /linked ?in/i,                                        kind: 'text',   value: () => ME.linkedin },
    { name: 'github',      match: /github|portfolio|personal (web)?site|twitter/i,      kind: 'text',   value: () => ME.github },
    { name: 'location',    match: /location|where.*(live|based|located)|^city|state, province|region/i, kind: 'location', value: () => ME.location },
    { name: 'school',      match: /school|university|college|institution/i,             kind: 'any',    value: () => ME.school },
    { name: 'degree',      match: /degree/i,                                            kind: 'any',    value: () => ME.degree },
    { name: 'discipline',  match: /discipline|major|field of study/i,                   kind: 'any',    value: () => ME.discipline },
    { name: 'grad year',   match: /graduat\w*\s*(year|date)|year of graduation/i,       kind: 'any',    value: () => ME.gradYear },
    // NOTE: the original rule was /worked [at|for]/i — square brackets are a
    // character class, so it matched "worked a", "worked t", "worked |", and
    // never the intended phrase reliably. Grouped here.
    { name: 'worked here', match: /(have you ever )?worked (at|for)|current(ly)? (work|employee)|former employee/i,
                                                                                        kind: 'boolish',  value: () => ME.workedHere ?? 'no' },
    { name: 'sponsorship', match: /sponsor|visa|work permit/i,                          kind: 'boolish',  value: () => ME.needsSponsorship ?? 'no' },
    { name: 'legally authorized', match: /legally (authoriz|entitled)|authorized to work|right to work/i,
                                                                                        kind: 'boolish',  value: () => ME.authorizedToWork ?? 'yes' },
    { name: 'over 18',     match: /(at least|over) 18|age of 18/i,                      kind: 'boolish',  value: () => 'yes' },
    { name: 'non-compete', match: /non-?compete|restrictive covenant/i,                 kind: 'boolish',  value: () => ME.nonCompete ?? 'no' },
    { name: 'referral',    match: /how did you hear|referr|where did you find/i,        kind: 'any',    value: () => ME.referralSource },
  ];

  // "Do you require sponsorship?" is a yes/no button pair on one board and a
  // two-option radio group on the next. A rule declares `boolish` and the actual
  // widget decides how the answer gets entered.
  async function fillBoolish(en, value) {
    const yes = /^(y|yes|true|1)$/i.test(String(value));
    const kind = kindOf(en);
    if (kind === 'yesno') return fillYesNo(en, yes ? 'yes' : 'no');
    if (kind === 'radio' || kind === 'select') return fillPick(en, yes ? /^\s*yes\b/i : /^\s*no\b/i);
    if (kind === 'checkbox') throw new Error(NEVER_TICK);
    return fillText(en, yes ? 'Yes' : 'No');
  }

  async function applyValue(en, kind, value) {
    if (kind === 'boolish')  return fillBoolish(en, value);
    if (kind === 'location') return fillLocation(en, value);
    switch (kind === 'any' ? kindOf(en) : kind) {
      case 'yesno':    return fillBoolish(en, value);
      case 'combobox': return kind === 'location' ? fillLocation(en, value) : fillCombo(en, value);
      case 'select':
      case 'radio':    return fillPick(en, value);
      case 'checkbox': throw new Error(NEVER_TICK);
      case 'file':     throw new Error('file inputs are handled by Playwright');
      default:         return fillText(en, value);
    }
  }

  async function fill() {
    const results = [];
    const used = new Set();

    for (const rule of RULES) {
      for (const en of allEntries()) {
        const path = pathOf(en);
        if (used.has(path) || !rule.match.test(labelOf(en)) || !isEmpty(en)) continue;
        if (kindOf(en) === 'checkbox') {
          results.push({ name: rule.name, path, label: labelOf(en), ok: false, skipped: true, err: NEVER_TICK });
          continue;
        }

        const value = rule.value();
        if (value == null || value === '') {
          results.push({ name: rule.name, path, label: labelOf(en), ok: false, skipped: true, err: 'no value configured' });
          continue;                                  // leave it for the model pass
        }
        used.add(path);
        try {
          await applyValue(en, rule.kind, value);
          results.push({ name: rule.name, path, label: labelOf(en), ok: true, value: String(value) });
        } catch (e) {
          used.delete(path);
          results.push({ name: rule.name, path, label: labelOf(en), ok: false, err: e.message });
        }
        await sleep(40);
      }
    }
    return results;
  }

  // ---- model pass --------------------------------------------------------

  function describeEntry(en) {
    const ta = en.querySelector('textarea');
    return {
      path: pathOf(en),
      label: labelOf(en),
      required: isRequired(en),
      kind: kindOf(en),
      options: optionsOf(en),
      maxLength: ta && ta.maxLength > 0 ? ta.maxLength : undefined,
      current: (textInput(en)?.value ?? ''),
    };
  }

  async function pending() {
    const out = [];
    for (const en of allEntries().filter(isEmpty)) {
      const d = describeEntry(en);
      if (d.kind === 'combobox') d.options = await probeCombo(en);
      out.push(d);
    }
    return out;
  }

  const mark = (en, colour) => {
    en.style.outline = '2px solid ' + colour;
    en.style.outlineOffset = '3px';
    en.style.borderRadius = '4px';
  };

  async function applyPlan(plan) {
    const results = [];
    for (const step of plan) {
      const en = byPath(step.path);
      if (!en) { results.push({ ...step, ok: false, err: 'field gone' }); continue; }
      const label = labelOf(en);

      if (step.action === 'skip' || kindOf(en) === 'checkbox') {
        mark(en, 'red');
        results.push({ ...step, label, ok: true, skipped: true,
                       err: kindOf(en) === 'checkbox' ? NEVER_TICK : undefined });
        continue;
      }
      try {
        if      (step.action === 'text')  await fillText(en, step.value);
        else if (step.action === 'yesno') await fillYesNo(en, step.value);
        else if (step.action === 'pick')  await fillPick(en, step.value);
        else if (step.action === 'combo') await fillCombo(en, step.value);
        else throw new Error('unknown action "' + step.action + '"');
        mark(en, 'gold');
        results.push({ ...step, label, ok: true });
      } catch (e) {
        mark(en, 'red');
        results.push({ ...step, label, ok: false, err: e.message });
      }
      await sleep(60);
    }
    return results;
  }

  const dumpLabels = () => allEntries().map(en => ({
    path: pathOf(en), label: labelOf(en), kind: kindOf(en),
    required: isRequired(en), empty: isEmpty(en), options: optionsOf(en),
  }));

  window.__ashby = {
    configure: me => { ME = me || {}; return Object.keys(ME).length; },
    fill, pending, applyPlan, dumpLabels, findEntry,
    // exposed for debugging from the console / the §8c fallback
    _: { allEntries, byPath, labelOf, kindOf, isEmpty, isRequired,
         fillText, fillYesNo, fillPick, fillCombo, fillLocation, RULES },
  };
})();
