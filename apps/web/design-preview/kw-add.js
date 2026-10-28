/**
 * Add keywords (16-drawers-dialogs-popovers.md section 4): a 560 px dialog. One keyword per line, one location, a
 * language, the devices, optional group, tags and priority. A line that cannot be tracked is listed with its
 * reason, and the rest are added. When something was skipped, the result screen says what and why.
 */
import { GROUP_SEP, LANGUAGES, LOCATIONS, PLAN_LIMIT, activeCount, addRecords, allTags, childrenOf, findTracked, groupList, roomLeft, takeDeleted } from './kw-data.js';
import { archiveKeywords } from './kw-bulk.js';
import { BUTTON, BUTTON_PRIMARY, badge, segmented, selectField, toast } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { FIELD_LABEL, INPUT, confirmDiscard, field, fieldError, openDialog } from './kw-dialog.js';
import { ensureGroup, validateName } from './kw-groups.js';

export const MAX_LINES = 1000;
const MAX_CHARS = 700;
const OPERATOR = /(^|\s)(site|inurl|intitle|intext|filetype|related|cache|link|info):/i;
const hasControl = (text) => [...text].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const DEVICE_CHOICES = [['desktop', 'Desktop'], ['mobile', 'Mobile'], ['both', 'Desktop and mobile']];
const PRIORITY = [['1', '1, highest'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5, lowest']];

const count = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Why a keyword cannot be tracked, as a sentence; '' when it can. Shared with the import. */
export function keywordProblem(raw) {
  const keyword = raw.trim().replace(/\s+/g, ' ');
  if (hasControl(raw)) return 'The line contains a control character, such as a tab.';
  if (keyword.replace(/["'“”]/g, '').trim() === '') return 'The keyword is empty.';
  if (keyword.length > MAX_CHARS) return `Use at most ${MAX_CHARS} characters.`;
  if (OPERATOR.test(keyword)) return 'Search operators such as site: are not part of a keyword.';
  if (/(^|\s)-\S/.test(keyword)) return 'A minus before a word is a search operator.';
  return '';
}

/**
 * Splits the text into keywords. Blank lines are skipped, a repeat (in any case) is dropped and counted, and a line
 * that cannot be tracked becomes a problem with its number.
 */
export function parseKeywordLines(text) {
  const entries = [];
  const problems = [];
  const seen = new Set();
  let repeats = 0;
  let total = 0;
  text.split('\n').forEach((raw, index) => {
    if (raw.trim() === '') return;
    total += 1;
    const line = index + 1;
    const problem = keywordProblem(raw);
    if (problem) {
      problems.push({ line, text: problem });
      return;
    }
    const keyword = raw.trim().replace(/\s+/g, ' ');
    const key = keyword.toLowerCase();
    if (seen.has(key)) repeats += 1;
    else {
      entries.push({ line, keyword });
      seen.add(key);
    }
  });
  return { entries, problems, repeats, total };
}

function datalist(id, values) {
  const list = el('datalist');
  list.id = id;
  values.forEach((value) => {
    const option = el('option');
    option.value = value;
    list.append(option);
  });
  return list;
}

function wideSelect(options, value, onChange, label) {
  const select = selectField(options, value, onChange, label, 'w-full');
  select.classList.replace('h-control-sm', 'h-control');
  return select;
}

/** @param {{onInspect: (id: number) => void}} options */
export function openAddDialog({ onInspect }) {
  // Set once the keywords are added or the result screen is up: from then on nothing typed can be lost.
  let finished = false;
  const onCancel = () => {
    if (finished || area.value.trim() === '') return true;
    confirmDiscard('The keywords you typed will be lost.', () => frame.close());
    return false;
  };
  const frame = openDialog({ title: 'Add keywords', description: 'Keywords are tracked on Google. Their metrics arrive within minutes.', width: 'md', onCancel });
  const { body, footer } = frame;

  const area = el('textarea', 'h-36 px-3 py-2 rounded-md border border-border bg-surface text-foreground type-table placeholder:text-foreground-tertiary w-full');
  area.setAttribute('aria-label', 'Keywords');
  area.placeholder = 'seo agency berlin\nkeyword research\nbacklink checker';
  const counter = el('p', 'type-meta num text-foreground-secondary');
  const problemList = el('ul', 'flex flex-col gap-1 type-meta text-negative-text');
  problemList.setAttribute('aria-label', 'Lines that cannot be added');
  const quotaError = fieldError('');
  quotaError.hidden = true;

  const locationSelect = wideSelect([['', 'Choose a location'], ...LOCATIONS.map(([code, name]) => [String(code), name])], '', () => refresh(), 'Location');
  const locationError = fieldError('Choose a location');
  locationError.hidden = true;
  const languageSelect = wideSelect(LANGUAGES, 'en', () => {}, 'Language');
  const prioritySelect = wideSelect(PRIORITY, '3', () => {}, 'Priority');
  let device = 'desktop';
  const deviceGroup = segmented(DEVICE_CHOICES, device, (value) => {
    device = value;
    deviceGroup.sync(value);
    refresh();
  }, 'Device');
  // A group, not a label: a label would pass its click on to the first radio (Desktop).
  const deviceCaption = el('span', 'type-label text-foreground', 'Device');
  deviceCaption.id = 'kw-add-device';
  const deviceField = el('div', FIELD_LABEL);
  deviceField.setAttribute('role', 'group');
  deviceField.setAttribute('aria-labelledby', deviceCaption.id);
  deviceField.append(deviceCaption, deviceGroup);
  const groupInput = el('input', INPUT);
  groupInput.setAttribute('list', 'kw-add-groups');
  groupInput.placeholder = 'Services / SEO audits';
  const groupError = fieldError('');
  groupError.hidden = true;
  const tagInput = el('input', INPUT);
  tagInput.setAttribute('list', 'kw-add-tags');
  tagInput.placeholder = 'Topics: SEO';
  const tagError = fieldError('');
  tagError.hidden = true;

  const pair = el('div', 'grid grid-cols-1 sm:grid-cols-2 gap-3');
  pair.append(field('Location', locationSelect), field('Language', languageSelect));
  body.append(
    field('Keywords', area, { hint: 'One per line, up to 1,000 at a time' }),
    counter,
    problemList,
    quotaError,
    pair,
    locationError,
    deviceField,
    field('Group', groupInput, { hint: 'Type a new group to create it.' }),
    groupError,
    field('Tags', tagInput, { hint: 'From the vocabularies, separated by commas.' }),
    tagError,
    field('Priority', prioritySelect),
    datalist('kw-add-groups', groupList().filter((path) => childrenOf(path).length === 0)),
    datalist('kw-add-tags', allTags()),
  );

  const cancel = el('button', BUTTON, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => frame.dismiss());
  const submit = el('button', `${BUTTON_PRIMARY} disabled:bg-surface-disabled disabled:text-foreground-disabled`, 'Add keywords');
  submit.type = 'button';
  footer.append(cancel, submit);

  let plan = null;
  const devicesOf = () => (device === 'both' ? ['desktop', 'mobile'] : [device]);

  /** What the typed text would do right now: the lines, the rows per device and the room left. */
  function refresh() {
    const parsed = parseKeywordLines(area.value);
    const location = Number(locationSelect.value) || 0;
    const devices = devicesOf();
    const rows = parsed.entries.flatMap((entry) => devices.map((item) => ({ ...entry, location, device: item, tracked: location ? findTracked(entry.keyword, location, item) : null })));
    const fresh = rows.filter((row) => !row.tracked);
    plan = { parsed, rows, fresh };

    counter.textContent = `${count(parsed.entries.length, 'keyword')} · ${count(parsed.repeats, 'repeat')} left out · ${count(parsed.entries.length * devices.length, 'tracked keyword')}, one per device`;
    problemList.replaceChildren(...parsed.problems.map((problem) => el('li', '', `Line ${problem.line}: ${problem.text}`)));

    const tooMany = parsed.total > MAX_LINES;
    const room = roomLeft();
    const overRoom = !tooMany && fresh.length > room;
    quotaError.hidden = !(tooMany || overRoom);
    quotaError.textContent = tooMany
      ? `Add at most ${MAX_LINES.toLocaleString('en-US')} keywords at a time. This list has ${parsed.total.toLocaleString('en-US')}.`
      : `Your plan has room for ${room.toLocaleString('en-US')} more active keywords (${activeCount().toLocaleString('en-US')} of ${PLAN_LIMIT.toLocaleString('en-US')} used); this adds ${fresh.length.toLocaleString('en-US')}.`;
    submit.disabled = tooMany || overRoom || parsed.entries.length + parsed.problems.length === 0;
    submit.textContent = fresh.length === 0 ? 'Add keywords' : `Add ${count(fresh.length, 'keyword')}`;
  }

  function resultScreen(added, tracked, problems) {
    finished = true;
    body.replaceChildren();
    footer.replaceChildren();
    frame.dialog.querySelector('h2').textContent = added > 0 ? 'Keywords added' : 'No keywords added';
    body.append(el('p', 'type-body text-foreground-secondary', added > 0 ? `${count(added, 'keyword')} added.` : 'Nothing was added.'));
    if (tracked.length > 0) {
      body.append(el('h3', 'type-label text-foreground-secondary pt-1', 'Already tracked'));
      body.append(el('p', 'type-meta text-foreground-tertiary', `The project tracks these ${count(tracked.length, 'keyword')} already.`));
      tracked.forEach((item) => {
        const line = el('div', 'min-h-10 py-1 flex items-center gap-2 flex-wrap border-t border-border-subtle');
        const place = `${LOCATIONS.find(([code]) => code === item.location)?.[1] ?? ''}, ${item.device}`;
        line.append(el('span', 'type-body-strong text-foreground min-w-0 truncate', item.keyword), el('span', 'type-meta text-foreground-tertiary', place));
        const show = el('button', `${BUTTON} h-control-sm px-2 ml-auto`, 'Show it');
        show.type = 'button';
        show.addEventListener('click', () => {
          frame.close();
          onInspect(item.tracked.id);
        });
        line.append(show);
        if (item.tracked.archived) {
          const unarchive = el('button', `${BUTTON} h-control-sm px-2`, 'Unarchive');
          unarchive.type = 'button';
          unarchive.addEventListener('click', () => {
            archiveKeywords([item.tracked.id], false, { byFilter: false }, () => unarchive.replaceWith(badge('Unarchived', 'positive')));
          });
          line.append(unarchive);
        }
        body.append(line);
      });
    }
    if (problems.length > 0) {
      body.append(el('h3', 'type-label text-foreground-secondary pt-1', 'Not added'));
      problems.forEach((problem) => {
        body.append(el('div', 'min-h-9 py-1 border-t border-border-subtle type-body text-foreground', `Line ${problem.line}: ${problem.text}`));
      });
    }
    const done = el('button', BUTTON_PRIMARY, 'Done');
    done.type = 'button';
    done.addEventListener('click', () => {
      frame.close();
      if (added > 0) toast({ title: `${count(added, 'keyword')} added`, description: 'Their metrics arrive within minutes.', tone: 'success' });
    });
    footer.append(done);
    done.focus();
  }

  submit.addEventListener('click', () => {
    locationError.hidden = locationSelect.value !== '';
    groupError.hidden = true;
    tagError.hidden = true;
    if (!locationSelect.value) {
      locationSelect.focus();
      return;
    }
    const group = groupInput.value.trim();
    if (group) {
      const parts = group.split(GROUP_SEP);
      const problem = parts.map((part, index) => validateName(part, index === 0 ? null : parts.slice(0, index).join(GROUP_SEP))).find(Boolean);
      if (problem) {
        groupError.hidden = false;
        groupError.textContent = problem;
        return;
      }
    }
    const tags = tagInput.value.split(',').map((tag) => tag.trim()).filter(Boolean);
    const unknown = tags.filter((tag) => !allTags().includes(tag));
    if (unknown.length > 0) {
      tagError.hidden = false;
      tagError.textContent = `Not in the vocabularies: ${unknown.join(', ')}.`;
      return;
    }
    refresh();
    const { fresh, rows, parsed } = plan;
    if (fresh.length > roomLeft()) return;

    if (group) ensureGroup(group);
    // A keyword deleted before comes back with its history and settings; the others are new rows.
    const toCreate = [];
    let restored = 0;
    fresh.forEach((row) => {
      if (takeDeleted(row.keyword, row.location, row.device)) restored += 1;
      else toCreate.push(row);
    });
    addRecords(toCreate.map((row) => ({ keyword: row.keyword, location: row.location, device: row.device, language: languageSelect.value, priority: Number(prioritySelect.value), group: group || null, tags })), { source: 'manual' });
    const added = toCreate.length + restored;
    const tracked = rows.filter((row) => row.tracked).map((row) => ({ keyword: row.keyword, location: row.location, device: row.device, tracked: row.tracked }));
    if (tracked.length === 0 && parsed.problems.length === 0) {
      finished = true;
      frame.close();
      toast({ title: `${count(added, 'keyword')} added`, description: 'Their metrics arrive within minutes.', tone: 'success' });
      return;
    }
    resultScreen(added, tracked, parsed.problems);
  });

  area.addEventListener('input', refresh);
  refresh();
  area.focus();
  return frame;
}
