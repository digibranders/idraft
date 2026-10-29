/* global TextDecoder, setInterval, clearInterval */
/**
 * Import keywords (docs/20 section 5.3.1): a 720 px stepper dialog over Rankings. Upload (a CSV file or pasted
 * lines), Map columns (CSV only), Review (the outcome of every row, with one choice for duplicates and archived
 * keywords), Confirm. The preview lives in this dialog only: a reload drops an unconfirmed import, as the product
 * does when a preview is not saved yet. After Confirm the progress shows under the page title.
 */
import { DEPTHS, INTENTS, LANGUAGES, LOCATIONS, PLAN_LIMIT, activeCount, addRecords, all, allTags, dedupeKey, findTracked, roomLeft, setArchived, updateRecords } from './kw-data.js';
import { keywordProblem } from './kw-add.js';
import { BUTTON, BUTTON_PRIMARY, downloadCsv, segmented, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { INPUT, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';
import { ensureGroup } from './kw-groups.js';

const MAX_BYTES = 50 * 1024 * 1024;
const SAMPLE_BYTES = 64 * 1024;
const PREVIEW_DAYS = 7;
const SHOWN_PER_OUTCOME = 20;
const STEPS = [['upload', 'Upload'], ['map', 'Map columns'], ['review', 'Review'], ['confirm', 'Confirm']];
const FIELDS = [
  ['', 'Ignore'],
  ['keyword', 'Keyword'],
  ['country', 'Country'],
  ['location', 'Location'],
  ['language', 'Language'],
  ['device', 'Device'],
  ['tags', 'Tags'],
  ['topic', 'Topic'],
  ['group', 'Group'],
  ['intent', 'Intent'],
  ['stage', 'Funnel stage'],
  ['priority', 'Priority'],
  ['target', 'Target URL'],
  ['depth', 'Depth profile'],
];
const HEADER_FIELD = {
  keyword: 'keyword',
  country: 'country',
  location: 'location',
  language: 'language',
  device: 'device',
  tags: 'tags',
  topic: 'topic',
  group: 'group',
  intent: 'intent',
  'funnel stage': 'stage',
  stage: 'stage',
  priority: 'priority',
  'target url': 'target',
  target: 'target',
  'depth profile': 'depth',
  depth: 'depth',
};
const COUNTRY = { germany: 2276, de: 2276, 'united states': 2840, us: 2840, usa: 2840 };
const STAGE_CODES = ['tofu', 'mofu', 'bofu', 'retention', 'unknown'];
const OUTCOMES = [
  ['new', 'New', 'These keywords are new. They are added.'],
  ['variant', 'Variant', 'The keyword is tracked for another location or device. The new one is added as its own keyword.'],
  ['duplicate', 'Duplicate', 'These keywords are tracked already for the same location and device.'],
  ['archived', 'Archived', 'These keywords are tracked and archived. They are not checked and do not count against the plan.'],
  ['invalid', 'Invalid', 'These rows cannot be imported. Each one gives its reason.'],
  ['over', 'Over quota', 'These rows would pass the plan limit, so they are not imported.'],
];
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** A small CSV reader: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''));
}

/** Drops a leading byte order mark (code point 0xFEFF). */
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Checks a file before it is used: its size, its first 64 KiB as UTF-8, its header and its repeated headers.
 * @returns {Promise<{error: string} | {headers: string[], sample: string[][], rows: string[][], name: string}>}
 */
async function readCsv(file) {
  if (file.size > MAX_BYTES) return { error: 'The file is larger than 50 MB. Split it and import the parts.' };
  let sampleText;
  try {
    sampleText = new TextDecoder('utf-8', { fatal: true }).decode(await file.slice(0, SAMPLE_BYTES).arrayBuffer());
  } catch {
    return { error: 'This file is not UTF-8. Save it as UTF-8 CSV and choose it again.' };
  }
  // A byte order mark from a spreadsheet export would stick to the first header and hide the Keyword column.
  const sampleRows = parseCsv(stripBom(sampleText));
  if (sampleRows.length === 0) return { error: 'The file is empty.' };
  const [headers] = sampleRows;
  const headerKey = headers.map((header) => header.trim().toLowerCase()).join('|');
  const rows = parseCsv(stripBom(await file.text())).slice(1);
  if (rows.length === 0) return { error: 'The file has no rows below its header.' };
  if (rows.some((row) => row.map((value) => value.trim().toLowerCase()).join('|') === headerKey)) {
    return { error: 'The file repeats its header row. Remove the repeated rows and choose it again.' };
  }
  return { headers, sample: rows.slice(0, 3), rows, name: file.name };
}

const autoMap = (headers) => headers.map((header) => HEADER_FIELD[header.trim().toLowerCase()] ?? '');

function rowFromValues(values, mapping, rowNumber) {
  const pick = (key) => {
    const index = mapping.indexOf(key);
    return index === -1 ? '' : (values[index] ?? '').trim();
  };
  return { row: rowNumber, keyword: pick('keyword'), country: pick('country'), location: pick('location'), language: pick('language'), device: pick('device'), tags: pick('tags'), topic: pick('topic'), group: pick('group'), intent: pick('intent'), stage: pick('stage'), priority: pick('priority'), target: pick('target'), depth: pick('depth') };
}

const BLANK_FIELDS = { country: '', location: '', language: '', device: '', topic: '', group: '', intent: '', stage: '', priority: '', target: '', depth: '' };

/** Pasted lines: a keyword, then a tab, then tags separated by |. Pasted rows have no other columns. */
function rowsFromPaste(text) {
  const rows = [];
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return;
    const [keyword, tags = ''] = line.split('\t');
    rows.push({ ...BLANK_FIELDS, row: index + 1, keyword: keyword.trim(), tags: tags.trim() });
  });
  return rows;
}

/**
 * Checks each row and works out what the import would do with it. The first valid row of a keyword wins; a later
 * repeat in the file is always skipped. The plan room is applied later by `applyQuota`, since the choices decide
 * which rows take a place.
 */
export function reviewRows(rows) {
  const seen = new Set();
  return rows.map((item) => {
    const problems = [];
    const problem = keywordProblem(item.keyword);
    if (problem) problems.push(problem);
    // A row with no country or location (a paste, or a CSV without those columns) defaults to Germany (2276)
    const place = String(item.country || item.location || '').trim();
    let location = 2276;
    if (place !== '') {
      const numeric = Number(place);
      location = COUNTRY[place.toLowerCase()] ?? (LOCATIONS.some(([code]) => code === numeric) ? numeric : null);
      if (location === null) problems.push(`Unknown location: ${place}.`);
    }
    const device = (item.device || 'desktop').toLowerCase();
    if (!['desktop', 'mobile'].includes(device)) problems.push('Device must be desktop or mobile.');
    const language = (item.language || 'en').toLowerCase();
    if (!LANGUAGES.some(([code]) => code === language)) problems.push('Language must be en or de.');
    const priority = item.priority === '' ? 3 : Number(item.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) problems.push('Priority must be 1 to 5.');
    const intent = (item.intent || 'unknown').toLowerCase();
    if (!INTENTS.some(([code]) => code === intent)) problems.push('Intent is not in the list.');
    const stage = (item.stage || 'unknown').toLowerCase();
    if (!STAGE_CODES.includes(stage)) problems.push('Funnel stage is not in the list.');
    const depth = (item.depth || 'standard').toLowerCase();
    if (!DEPTHS.some(([code]) => code === depth)) problems.push('Depth profile is not in the list.');
    if (item.target && !/^https?:\/\//i.test(item.target)) problems.push('Target URL must start with http:// or https://.');
    const tags = [...item.tags.split(/[|,]/), ...(item.topic ? [`Topics: ${item.topic}`] : [])].map((tag) => tag.trim()).filter(Boolean);
    const unknown = tags.find((tag) => !allTags().includes(tag));
    if (unknown) problems.push(`Unknown tag: ${unknown}.`);

    const base = { ...item, location: location ?? 2276, device, language, priority, intent, stage, depth, tags, group: item.group || null };
    if (problems.length > 0) return { ...base, outcome: 'invalid', reason: problems.join(' ') };
    const keyword = item.keyword.trim();
    const key = dedupeKey(keyword, base.location, device);
    if (seen.has(key)) return { ...base, outcome: 'duplicate', repeat: true, reason: 'Repeats an earlier row of this file.' };
    seen.add(key);
    const tracked = findTracked(keyword, base.location, device);
    if (tracked) return { ...base, outcome: tracked.archived ? 'archived' : 'duplicate', existing: tracked, reason: tracked.archived ? 'Archived in Keywords.' : 'Tracked already.' };
    const variant = all().some((kw) => kw.keyword.toLowerCase() === keyword.toLowerCase() && dedupeKey(kw.keyword, kw.location, kw.device) !== key);
    return { ...base, outcome: variant ? 'variant' : 'new' };
  });
}

/**
 * Marks the rows past the plan's room as over quota, in file order. New keywords take a place, and so do archived
 * ones the person chose to unarchive. Nothing else does, so a merge never counts against the plan.
 */
export function applyQuota(reviewed, choices, limit = roomLeft()) {
  let room = limit;
  return reviewed.map((item) => {
    const takesRoom = item.outcome === 'new' || item.outcome === 'variant' || (item.outcome === 'archived' && choices.archived === 'unarchive');
    if (!takesRoom) return item;
    if (room > 0) {
      room -= 1;
      return item;
    }
    return { ...item, outcome: 'over' };
  });
}

/** The counts the import would make, given the two choices. */
export function summarize(reviewed, choices) {
  const count = (outcome) => reviewed.filter((item) => item.outcome === outcome).length;
  const created = count('new') + count('variant');
  const merged = choices.duplicate === 'merge' ? reviewed.filter((item) => item.outcome === 'duplicate' && !item.repeat).length : 0;
  const unarchived = choices.archived === 'unarchive' ? count('archived') : 0;
  const skipped = reviewed.length - created - merged - unarchived;
  return { created, merged: merged + unarchived, skipped, over: count('over') };
}

// -------------------------------------------------------------------------------------------------
// Progress, shown by the Rankings page header while a confirmed import runs.

let progress = null;
let listener = () => {};
export const importProgress = () => progress;
export function onImportProgress(fn) {
  listener = fn;
}

function applyImport(reviewed, choices) {
  const creatable = reviewed.filter((item) => item.outcome === 'new' || item.outcome === 'variant');
  creatable.forEach((item) => {
    if (item.group) ensureGroup(item.group);
  });
  addRecords(creatable.map((item) => ({ keyword: item.keyword.trim(), location: item.location, device: item.device, language: item.language, priority: item.priority, intent: item.intent, group: item.group, tags: item.tags, target: item.target || null })), { source: 'csv_import' });
  if (choices.duplicate === 'merge') {
    reviewed.filter((item) => item.outcome === 'duplicate' && !item.repeat && item.existing).forEach((item) => {
      if (item.group) ensureGroup(item.group);
      updateRecords([item.existing.id], (kw) => ({ group: item.group ?? kw.group, tags: [...new Set([...kw.tags, ...item.tags])] }));
    });
  }
  if (choices.archived === 'unarchive') {
    const unarchive = reviewed.filter((item) => item.outcome === 'archived');
    if (unarchive.length > 0) setArchived(unarchive.map((item) => item.existing.id), false);
    unarchive.forEach((item) => {
      if (item.group) ensureGroup(item.group);
      updateRecords([item.existing.id], (kw) => ({ group: item.group ?? kw.group, priority: item.priority, tags: [...new Set([...kw.tags, ...item.tags])] }));
    });
  }
  const summary = summarize(reviewed, choices);
  toast({
    title: `Import finished: ${summary.created} added, ${summary.merged} updated, ${summary.skipped} skipped`,
    tone: 'success',
    action: {
      label: 'Download report',
      run: () => downloadCsv('rankings-import-report.csv', [['Row', 'Keyword', 'Location', 'Device', 'Outcome', 'Detail'], ...reviewed.map((item) => [item.row, item.keyword, item.location, item.device, item.outcome, item.reason ?? ''])]),
    },
  });
}

/** Runs the confirmed import: the progress polls every 400 ms in the mock, then the rows are written. */
function runImport(reviewed, choices) {
  const total = reviewed.length;
  progress = { done: 0, total };
  listener();
  const timer = setInterval(() => {
    progress = { done: Math.min(total, progress.done + Math.max(1, Math.ceil(total / 6))), total };
    listener();
    if (progress.done < total) return;
    clearInterval(timer);
    progress = null;
    listener();
    applyImport(reviewed, choices);
  }, 400);
}

// -------------------------------------------------------------------------------------------------
// The dialog

/**
 * Opens the stepper. The route is #/keywords/import while it is open, so a reload drops an unconfirmed preview.
 * @param {{onClose: () => void, onKeep?: () => void}} options onClose runs however the dialog closes. onKeep runs
 * when the person answers "Keep importing" to the Stop question, so the caller can put the address back.
 */
export function openImportDialog({ onClose, onKeep }) {
  // `reviewed` holds the rows before the plan room is applied; `current()` applies it to the chosen options.
  const job = { step: 'upload', source: 'csv', csv: null, pasteText: '', mapping: [], reviewed: null, choices: { duplicate: 'skip', archived: 'leave' }, createdAt: Date.now() };
  const current = () => applyQuota(job.reviewed, job.choices);
  let closing = false;
  let frame = null;
  const leave = () => {
    closing = true;
    frame.close();
  };
  // Closing past the first step asks first, since the preview would be lost. One question at a time.
  let asking = false;
  const stopAsk = () => {
    if (job.step === 'upload' || closing) return true;
    if (!asking) {
      asking = true;
      confirmDialog({ title: 'Stop this import?', description: 'The preview and the choices you made are lost.', confirmLabel: 'Stop import', cancelLabel: 'Keep importing', danger: true, onConfirm: leave, onKeep: () => {
        asking = false;
        onKeep?.();
      } });
    }
    return false;
  };
  frame = openDialog({ title: 'Import keywords', description: 'Upload a CSV file or paste keywords. Nothing is added until you confirm.', width: 'lg', onCancel: stopAsk, onClose });
  const { body, footer } = frame;

  const stepper = el('ol', 'flex items-center gap-4 flex-wrap');
  stepper.setAttribute('aria-label', 'Import steps');
  const next = el('button', BUTTON_PRIMARY, 'Next');
  next.type = 'button';
  const back = el('button', BUTTON, 'Back');
  back.type = 'button';
  const cancel = el('button', BUTTON, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => frame.dismiss());

  const order = () => (job.source === 'paste' ? ['upload', 'review', 'confirm'] : ['upload', 'map', 'review', 'confirm']);
  const goto = (step) => {
    job.step = step;
    draw();
  };
  const move = (delta) => {
    const steps = order();
    goto(steps[steps.indexOf(job.step) + delta]);
  };

  function drawStepper() {
    stepper.replaceChildren();
    const active = order().indexOf(job.step);
    order().forEach((key, index) => {
      const label = STEPS.find(([id]) => id === key)[1];
      const item = el('li', `type-label ${index <= active ? 'text-foreground' : 'text-foreground-tertiary'}`, `${index + 1}. ${label}`);
      if (key === job.step) item.setAttribute('aria-current', 'step');
      stepper.append(item);
    });
  }

  function drawUpload() {
    body.append(el('p', 'type-body text-foreground-secondary', 'CSV needs a header row. Pasted text takes one keyword per line, with tags after a tab, separated by |.'));
    const error = fieldError('');
    error.hidden = true;
    body.append(segmented([['csv', 'CSV file'], ['paste', 'Paste']], job.source, (value) => {
      job.source = value;
      draw();
    }, 'Source'));
    if (job.source === 'csv') {
      const input = el('input', `${INPUT} py-1.5`);
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.setAttribute('aria-label', 'CSV file');
      const note = el('p', 'type-meta text-foreground-secondary', job.csv ? `${job.csv.name}: ${job.csv.headers.length} columns, ${plural(job.csv.rows.length, 'row')}.` : 'Up to 50 MB, UTF-8.');
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const result = await readCsv(file);
        if (result.error) {
          job.csv = null;
          error.hidden = false;
          error.textContent = result.error;
          return;
        }
        job.csv = result;
        job.mapping = autoMap(result.headers);
        draw();
      });
      body.append(field('CSV file', input), note);
      if (job.csv) {
        const grid = el('table', 'w-full type-table');
        const head = el('tr');
        job.csv.headers.forEach((header) => head.append(el('th', 'px-2 py-1 text-left type-label text-foreground-secondary', header)));
        grid.append(head);
        job.csv.sample.forEach((values) => {
          const tr = el('tr', 'border-t border-border-subtle');
          values.forEach((value) => tr.append(el('td', 'px-2 py-1 type-body', value)));
          grid.append(tr);
        });
        const wrap = el('div', 'rounded-md border border-border overflow-x-auto');
        wrap.append(grid);
        body.append(wrap);
      }
      body.append(error);
      next.disabled = !job.csv;
    } else {
      const area = el('textarea', 'h-44 px-3 py-2 rounded-md border border-border bg-surface text-foreground type-table w-full');
      area.setAttribute('aria-label', 'Pasted keywords');
      area.placeholder = 'seo agency berlin\tTopics: SEO\nkeyword research';
      area.value = job.pasteText;
      area.addEventListener('input', () => {
        job.pasteText = area.value;
        next.disabled = area.value.trim() === '';
      });
      body.append(field('Keywords', area, { hint: 'One per line. A tab, then tags separated by |.' }));
      next.disabled = job.pasteText.trim() === '';
    }
    next.onclick = () => {
      job.reviewed = null;
      goto(job.source === 'paste' ? 'review' : 'map');
    };
  }

  function drawMap() {
    body.append(el('p', 'type-body text-foreground-secondary', 'Each column of the file maps to a field, or to Ignore. Keyword is required.'));
    const list = el('div', 'flex flex-col');
    job.csv.headers.forEach((header, index) => {
      const line = el('div', 'min-h-12 py-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border-subtle items-center');
      const label = el('div', 'min-w-0');
      const sample = job.csv.sample.map((values) => values[index]).filter(Boolean).slice(0, 2).join(', ');
      label.append(el('p', 'type-body-strong text-foreground truncate', header), el('p', 'type-meta text-foreground-tertiary truncate', sample || 'No sample'));
      const select = selectField(FIELDS, job.mapping[index] ?? '', (value) => {
        job.mapping[index] = value;
        draw();
      }, `Field for ${header}`, 'w-full');
      select.classList.replace('h-control-sm', 'h-control');
      line.append(label, select);
      list.append(line);
    });
    body.append(list);
    const missing = !job.mapping.includes('keyword');
    if (missing) body.append(fieldError('Map a column to Keyword.'));
    next.disabled = missing;
    next.onclick = () => {
      job.reviewed = reviewedRows();
      goto('review');
    };
  }

  function reviewedRows() {
    const rows = job.source === 'paste' ? rowsFromPaste(job.pasteText) : job.csv.rows.map((values, index) => rowFromValues(values, job.mapping, index + 2));
    return reviewRows(rows);
  }

  function drawReview() {
    job.reviewed ??= reviewedRows();
    const reviewed = current();
    const summary = summarize(reviewed, job.choices);
    const counts = Object.fromEntries(OUTCOMES.map(([key]) => [key, reviewed.filter((item) => item.outcome === key).length]));
    const strip = el('dl', 'grid grid-cols-2 sm:grid-cols-6 gap-px bg-border-subtle border border-border rounded-lg overflow-hidden');
    OUTCOMES.forEach(([key, label]) => {
      const cell = el('div', 'bg-surface px-3 py-2');
      cell.append(el('dt', 'type-meta', label), el('dd', 'type-metric num', String(counts[key])));
      strip.append(cell);
    });
    body.append(strip);
    OUTCOMES.forEach(([key, label, meaning]) => {
      const items = reviewed.filter((item) => item.outcome === key);
      if (items.length === 0) return;
      const section = el('section', 'flex flex-col gap-2 pt-1');
      section.append(el('h3', 'type-label text-foreground-secondary', `${label}, ${plural(items.length, 'row')}`), el('p', 'type-body text-foreground', meaning));
      if (key === 'duplicate' && items.some((item) => !item.repeat)) {
        section.append(choice('duplicate', [['skip', 'Skip them'], ['merge', 'Add their groups and tags to the tracked keywords']]));
      }
      if (key === 'duplicate' && items.some((item) => item.repeat)) {
        section.append(el('p', 'type-meta text-foreground-tertiary', 'Repeats inside the file are always skipped.'));
      }
      if (key === 'archived') section.append(choice('archived', [['leave', 'Leave them archived'], ['unarchive', "Unarchive them with the file's settings"]]));
      items.slice(0, SHOWN_PER_OUTCOME).forEach((item) => {
        section.append(el('p', 'type-body text-foreground min-w-0 truncate', `Row ${item.row}: ${item.keyword || '(empty)'}${item.reason ? `, ${item.reason}` : ''}`));
      });
      if (items.length > SHOWN_PER_OUTCOME) section.append(el('p', 'type-meta text-foreground-tertiary', `${plural(items.length - SHOWN_PER_OUTCOME, 'more row')} in the report.`));
      body.append(section);
    });
    if (summary.over > 0) {
      body.append(fieldError(`${plural(summary.over, 'keyword')} are over your plan's limit of ${PLAN_LIMIT.toLocaleString('en-US')}. Skip rows or archive keywords, then import again.`));
    }
    body.append(el('p', 'type-meta text-foreground-tertiary', `Your plan has room for ${roomLeft().toLocaleString('en-US')} more active keywords. ${activeCount().toLocaleString('en-US')} are in use.`));
    next.disabled = reviewed.length === 0 || summary.over > 0;
    next.onclick = () => goto('confirm');
  }

  function choice(name, options) {
    const group = el('div', 'flex flex-col gap-1');
    group.setAttribute('role', 'radiogroup');
    options.forEach(([value, text]) => {
      const row = el('label', 'min-h-8 flex items-center gap-2 type-body text-foreground cursor-pointer');
      const radio = el('input', 'size-4 accent-primary');
      radio.type = 'radio';
      radio.name = `kw-import-${name}`;
      radio.value = value;
      radio.checked = job.choices[name] === value;
      radio.addEventListener('change', () => {
        job.choices[name] = value;
        draw();
      });
      row.append(radio, el('span', '', text));
      group.append(row);
    });
    return group;
  }

  function drawConfirm() {
    const reviewed = current();
    const summary = summarize(reviewed, job.choices);
    body.append(el('p', 'type-body text-foreground', `${plural(summary.created, 'keyword')} will be added, ${plural(summary.merged, 'keyword')} updated and ${plural(summary.skipped, 'row')} skipped.`));
    body.append(el('p', 'type-meta text-foreground-tertiary', 'The import runs in the background. Its progress shows under the page title.'));
    const expired = Date.now() - job.createdAt > PREVIEW_DAYS * 86400000;
    if (expired) body.append(fieldError('This preview expired after 7 days. Start the import again.'));
    next.textContent = `Import ${plural(summary.created + summary.merged, 'keyword')}`;
    next.disabled = expired || summary.created + summary.merged === 0;
    next.onclick = () => {
      const snapshot = { reviewed, choices: { ...job.choices } };
      closing = true;
      frame.close();
      runImport(snapshot.reviewed, snapshot.choices);
    };
  }

  function draw() {
    body.replaceChildren();
    footer.replaceChildren();
    drawStepper();
    body.prepend(stepper);
    next.textContent = job.step === 'map' ? 'Review' : 'Next';
    if (job.step === 'upload') drawUpload();
    else if (job.step === 'map') drawMap();
    else if (job.step === 'review') drawReview();
    else drawConfirm();
    back.disabled = job.step === 'upload';
    back.onclick = () => move(-1);
    footer.append(cancel);
    if (job.step !== 'upload') footer.append(back);
    footer.append(next);
  }

  draw();
  return frame;
}
