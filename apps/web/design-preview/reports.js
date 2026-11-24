/* global document, window, navigator, crypto */
/**
 * Reports (route #/reports): report links for clients and scheduled report emails, on mock data.
 * A link is a secret address to a read-only report: it is shown once when made, it expires (7, 30 or 90 days) and
 * it can be revoked. A schedule emails a fresh link weekly (Monday) or monthly (the 1st) at 06:00 UTC to up to ten
 * addresses. Nothing here shows costs. A reload starts from the fixtures.
 */
import { BUTTON_PRIMARY, BUTTON_SM, badge, icon, toast } from './perf-ui.js';
import { INPUT, PRIMARY_DISABLED, confirmDialog, field, fieldError, openDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { EXPIRY_CHOICES, HOST, RECIPIENTS_MAX, REPORT, RHYTHMS, SCHEDULES_MAX, SHARE_ORIGIN, TODAY, addDays, links, schedules, stateOf } from './reports-data.js';
import { renderGuest } from './reports-guest.js';

const view = document.querySelector('[data-view="reports"]');
const SELECT = `${INPUT} pr-8`;
const STATE = { active: ['Active', 'positive'], expired: ['Expired', 'neutral'], revoked: ['Revoked', 'negative'] };
const when = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const rhythmName = (key) => RHYTHMS.find(([value]) => value === key)[1];
const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** The first send after `now`: Monday 06:00 UTC for weekly, the 1st at 06:00 UTC for monthly. */
function nextSlot(frequency, now) {
  if (frequency === 'weekly') {
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7), 6));
    return monday > now ? monday : addDays(monday, 7);
  }
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 6));
  return first > now ? first : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 6));
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function select(options, value, label, onChange) {
  const node = el('select', SELECT);
  node.setAttribute('aria-label', label);
  options.forEach(([optionValue, text]) => {
    const option = el('option', '', text);
    option.value = optionValue;
    node.append(option);
  });
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function table(head, rows, empty) {
  if (!rows.length) {
    const box = el('div', 'rounded-lg border border-dashed border-border p-6 flex flex-col gap-1');
    box.append(el('p', 'type-body-strong', empty.title), el('p', 'type-body text-foreground-secondary', empty.text));
    return box;
  }
  const scroller = el('div', 'overflow-x-auto rounded-lg border border-border');
  const node = el('table', 'w-full min-w-max type-body');
  const header = el('tr', 'bg-surface-subtle');
  head.forEach((cell) => header.append(el('th', 'px-3 h-9 text-left type-label text-foreground-secondary whitespace-nowrap', cell)));
  const thead = el('thead', '');
  thead.append(header);
  const body = el('tbody', 'divide-y divide-border');
  rows.forEach((cells) => {
    const row = el('tr', '');
    cells.forEach((cell) => {
      const td = el('td', 'px-3 py-2 align-middle');
      if (cell instanceof window.Node) td.append(cell);
      else td.textContent = cell;
      row.append(td);
    });
    body.append(row);
  });
  node.append(thead, body);
  scroller.append(node);
  return scroller;
}

const actions = (...buttons) => {
  const wrap = el('div', 'flex items-center gap-2 justify-end');
  wrap.append(...buttons);
  return wrap;
};
function small(label, onClick, { iconName, danger } = {}) {
  const node = el('button', danger ? `${BUTTON_SM} text-negative-text` : BUTTON_SM);
  node.type = 'button';
  if (iconName) node.append(icon(iconName, 'size-icon-sm'));
  node.append(el('span', '', label));
  node.addEventListener('click', onClick);
  return node;
}

// -------------------------------------------------------------------------------------------------
// Preview of the guest page

function openPreview(expiresAt) {
  const frame = openDialog({ title: 'Report as a guest sees it', description: 'This is what opens from a report link. It needs no sign-in and cannot change anything.', width: 'lg' });
  renderGuest(frame.body, REPORT, { expiresAt });
  frame.footer.append(el('span', 'flex-1'), small('Close', frame.close));
}

// -------------------------------------------------------------------------------------------------
// Links

function showSecret(url, expiresAt) {
  const frame = openDialog({ title: 'Your report link', description: 'Copy it now. For safety it is shown only once, and anyone who has it can read the report until it expires or you revoke it.', width: 'md' });
  const input = el('input', INPUT);
  input.readOnly = true;
  input.value = url;
  input.setAttribute('aria-label', 'Report link');
  input.addEventListener('focus', () => input.select());
  frame.body.append(field('Link', input, { hint: `Works until ${when(expiresAt)}.` }));
  const copy = el('button', BUTTON_PRIMARY);
  copy.type = 'button';
  copy.append(icon('copy', 'size-icon-sm'), el('span', '', 'Copy link'));
  copy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(url);
    toast({ title: 'Link copied', description: 'Paste it into an email or message to your client.', tone: 'success' });
  });
  frame.footer.append(copy, el('span', 'flex-1'), small('Done', frame.close));
  input.focus();
}

function newLink() {
  let days = '30';
  const frame = openDialog({ title: 'New report link', description: `A read-only report of ${HOST}: Mention rate, Citation rate, Share of voice, competitors and cited domains. It shows no costs.`, width: 'sm' });
  frame.body.append(field('Link works for', select(EXPIRY_CHOICES, days, 'Link works for', (value) => (days = value)), { hint: 'It stops working after this, and you can revoke it sooner.' }));
  const make = el('button', PRIMARY_DISABLED);
  make.type = 'button';
  make.textContent = 'Make link';
  make.addEventListener('click', () => {
    const expiresAt = addDays(TODAY, Number(days));
    const secret = token();
    links.unshift({ id: `l${Date.now()}`, createdAt: TODAY, expiresAt, revokedAt: null });
    frame.close();
    draw();
    showSecret(`${SHARE_ORIGIN}${secret}`, expiresAt);
  });
  frame.footer.append(make, small('Cancel', frame.close));
  make.focus();
}

function linksSection() {
  const wrap = el('section', 'flex flex-col gap-3');
  const head = el('div', 'flex flex-wrap items-center gap-2');
  const text = el('div', 'flex-1 min-w-0 flex flex-col gap-0.5');
  text.append(el('h2', 'type-section-title', 'Report links'), el('p', 'type-body text-foreground-secondary', 'Share a read-only report with a client. Each link can be revoked.'));
  const preview = small('Preview report', () => openPreview(null), { iconName: 'file-chart-column' });
  const create = el('button', BUTTON_PRIMARY);
  create.type = 'button';
  create.append(icon('plus', 'size-icon-sm'), el('span', '', 'New link'));
  create.addEventListener('click', newLink);
  head.append(text, preview, create);
  const rows = links.map((link) => {
    const state = stateOf(link);
    const buttons = [small('Preview', () => openPreview(link.expiresAt), { iconName: 'external-link' })];
    if (state === 'active') {
      buttons.push(small('Revoke', () => confirmDialog({
        title: 'Revoke this link?',
        description: 'Anyone who opens it afterwards sees that it does not exist. You cannot undo this, but you can make a new link.',
        confirmLabel: 'Revoke link',
        danger: true,
        onConfirm: () => {
          link.revokedAt = TODAY;
          draw();
          toast({ title: 'Link revoked', description: 'It no longer opens the report.', tone: 'success' });
        },
      }), { iconName: 'trash-2', danger: true }));
    }
    return [when(link.createdAt), when(link.expiresAt), badge(...STATE[state]), actions(...buttons)];
  });
  wrap.append(head, table(['Made', 'Expires', 'State', ''], rows, { title: 'No links yet', text: 'Make a link to share this project\'s report with a client.' }));
  return wrap;
}

// -------------------------------------------------------------------------------------------------
// Schedules

function parseRecipients(text) {
  const list = [...new Set(text.split(/[\s,;]+/).map((part) => part.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return { error: 'Enter at least one email address.', list };
  if (list.length > RECIPIENTS_MAX) return { error: `Enter at most ${RECIPIENTS_MAX} addresses.`, list };
  const bad = list.find((address) => !ADDRESS.test(address));
  return bad ? { error: `"${bad}" is not an email address.`, list } : { error: null, list };
}

function scheduleDialog(existing) {
  let frequency = existing?.frequency ?? 'weekly';
  const area = el('textarea', `${INPUT} h-auto min-h-20 py-2`);
  area.value = existing ? existing.recipients.join('\n') : '';
  area.placeholder = 'name@client.com';
  area.setAttribute('aria-label', 'Recipients');
  const frame = openDialog({ title: existing ? 'Edit scheduled report' : 'Add scheduled report', description: 'Each email holds a new report link that works for 30 days. Sends go out at 06:00 UTC.', width: 'md' });
  const error = el('div', '');
  frame.body.append(
    field('How often', select(RHYTHMS, frequency, 'How often', (value) => (frequency = value))),
    field('Recipients', area, { hint: `One address per line, up to ${RECIPIENTS_MAX}.` }),
    error,
  );
  const save = el('button', PRIMARY_DISABLED);
  save.type = 'button';
  save.textContent = existing ? 'Save changes' : 'Add schedule';
  save.addEventListener('click', () => {
    const result = parseRecipients(area.value);
    error.replaceChildren(...(result.error ? [fieldError(result.error)] : []));
    if (result.error) return;
    if (existing) Object.assign(existing, { frequency, recipients: result.list, nextRunAt: nextSlot(frequency, TODAY) });
    else schedules.push({ id: `s${Date.now()}`, frequency, recipients: result.list, paused: false, nextRunAt: nextSlot(frequency, TODAY), lastSentAt: null, lastError: null });
    frame.close();
    draw();
    toast({ title: existing ? 'Schedule saved' : 'Schedule added', description: `Next email on ${when(nextSlot(frequency, TODAY))}.`, tone: 'success' });
  });
  frame.footer.append(save, small('Cancel', frame.close));
  area.focus();
}

function schedulesSection() {
  const wrap = el('section', 'flex flex-col gap-3');
  const head = el('div', 'flex flex-wrap items-center gap-2');
  const text = el('div', 'flex-1 min-w-0 flex flex-col gap-0.5');
  text.append(el('h2', 'type-section-title', 'Scheduled emails'), el('p', 'type-body text-foreground-secondary', 'Email the report to your client every week or month.'));
  const add = el('button', schedules.length >= SCHEDULES_MAX ? PRIMARY_DISABLED : BUTTON_PRIMARY);
  add.type = 'button';
  add.disabled = schedules.length >= SCHEDULES_MAX;
  add.append(icon('plus', 'size-icon-sm'), el('span', '', 'Add schedule'));
  add.addEventListener('click', () => scheduleDialog(null));
  head.append(text, add);
  const rows = schedules.map((schedule) => {
    const recipients = el('div', 'flex flex-col');
    schedule.recipients.forEach((address) => recipients.append(el('span', 'type-body', address)));
    const status = el('div', 'flex flex-col gap-1 items-start');
    status.append(badge(schedule.paused ? 'Paused' : 'Running', schedule.paused ? 'neutral' : 'positive'));
    if (schedule.lastError) status.append(el('span', 'type-meta text-negative-text', `Last send failed: ${schedule.lastError}`));
    else if (schedule.lastSentAt) status.append(el('span', 'type-meta text-foreground-tertiary', `Last sent ${when(schedule.lastSentAt)}`));
    return [
      rhythmName(schedule.frequency),
      recipients,
      schedule.paused ? 'Not scheduled' : when(schedule.nextRunAt),
      status,
      actions(
        small('Edit', () => scheduleDialog(schedule), { iconName: 'pencil' }),
        small(schedule.paused ? 'Resume' : 'Pause', () => {
          schedule.paused = !schedule.paused;
          if (!schedule.paused) schedule.nextRunAt = nextSlot(schedule.frequency, TODAY);
          draw();
        }),
        small('Delete', () => confirmDialog({
          title: 'Delete this schedule?',
          description: 'No more emails are sent. Links already emailed keep working until they expire or you revoke them.',
          confirmLabel: 'Delete schedule',
          danger: true,
          onConfirm: () => {
            schedules.splice(schedules.indexOf(schedule), 1);
            draw();
          },
        }), { iconName: 'trash-2', danger: true }),
      ),
    ];
  });
  wrap.append(head, table(['How often', 'Recipients', 'Next email', 'Status', ''], rows, { title: 'No scheduled emails', text: 'Add a schedule to email this report to your client without opening the app.' }));
  return wrap;
}

function draw() {
  const head = el('header', 'flex flex-col gap-1');
  head.append(el('h1', 'type-page-title', 'Reports'), el('p', 'type-body text-foreground-secondary', `Client-ready AI visibility reports for ${HOST}.`));
  view.replaceChildren(head, linksSection(), schedulesSection());
}

// The app's top bar names the project, as on Internal links: it is Eventus Security here
const crumb = document.querySelector('button.truncate[data-popup="menu-project"]');
const sidebarName = document.querySelector('[data-project-name]');
const original = { crumb: crumb?.firstChild?.textContent, sidebar: sidebarName?.textContent };
function appChrome(on) {
  if (crumb?.firstChild) crumb.firstChild.textContent = on ? 'Eventus Security' : original.crumb;
  if (sidebarName) sidebarName.textContent = on ? 'Eventus Security' : original.sidebar;
}

window.addEventListener('preview-route', (event) => {
  if (event.detail.view !== 'reports') return;
  appChrome(true);
  draw();
});
window.addEventListener('preview-leave', (event) => {
  if (event.detail.from === 'reports') appChrome(false);
});
if (window.location.hash === '#/reports') {
  appChrome(true);
  draw();
}
