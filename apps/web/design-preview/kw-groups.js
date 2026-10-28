/* global queueMicrotask */
/**
 * Manage groups (docs/20 section 5.3): a tree of groups, each with its keyword count, and the four actions of a
 * group: add a subgroup, rename, move, delete. The name rules are checked here, and `validateName` is shared with
 * the Add keywords dialog, which can create a group.
 */
import { GROUP_SEP, addGroup, childrenOf, deleteGroup, groupDepth, groupList, hasGroup, isWithin, keywordCountOf, moveGroup, renameGroup, subtreeHeight } from './kw-data.js';
import { BUTTON, BUTTON_PRIMARY, BUTTON_SM, FIELD, icon } from './perf-ui.js';
import { el } from './prompts-parts.js';
import { BUTTON_DANGER, INPUT, field, fieldError, openDialog } from './kw-dialog.js';

export const MAX_LEVELS = 10;
const MAX_NAME = 100;

/**
 * @param {string} name the typed name
 * @param {string|null} parent the group it goes under, or null for the top level
 * @param {string|null} except the group being renamed, which does not count as a sibling
 * @returns {string} the problem, or '' when the name is fine
 */
export function validateName(name, parent, except = null) {
  const text = name.trim();
  if (text === '') return 'Enter a group name.';
  if (text.length > MAX_NAME) return `A group name has ${MAX_NAME} characters at most.`;
  if (text.includes('/')) return 'A group name cannot contain “/”.';
  const level = parent === null ? 1 : groupDepth(parent) + 1;
  if (level > MAX_LEVELS) return `Groups go ${MAX_LEVELS} levels deep at most.`;
  const siblings = parent === null ? groupList().filter((path) => groupDepth(path) === 1) : childrenOf(parent);
  const taken = siblings.some((path) => path !== except && path.split(GROUP_SEP).at(-1).toLowerCase() === text.toLowerCase());
  if (taken) return 'A group next to it already has this name.';
  return '';
}

/** Creates a group at a path such as "Services / Content", making sure the parent exists. */
export function ensureGroup(path) {
  const parts = path.split(GROUP_SEP);
  parts.forEach((_, index) => {
    const partial = parts.slice(0, index + 1).join(GROUP_SEP);
    if (!hasGroup(partial)) addGroup(partial);
  });
}

function sortedRoots() {
  return groupList().filter((path) => groupDepth(path) === 1).sort((a, b) => a.localeCompare(b));
}

const countText = (path) => {
  const count = keywordCountOf(path);
  return count === 0 ? 'No keywords' : `${count.toLocaleString('en-US')} ${count === 1 ? 'keyword' : 'keywords'}`;
};

/** Escape cancels the inline form. It must not reach the dialog, which would close the whole Manage groups list. */
function escapeCancels(wrap, onCancel) {
  wrap.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  });
}

/** An inline form under a row: one input and its buttons, with the error below. */
function inlineForm({ label, initial = '', onSave, onCancel, placeholder = '' }) {
  const wrap = el('div', 'rounded-md border border-border bg-surface-subtle p-2 flex flex-col gap-2');
  const input = el('input', INPUT);
  input.value = initial;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  const error = fieldError('');
  error.hidden = true;
  const save = el('button', `${BUTTON_PRIMARY} h-control-sm px-2`, 'Save');
  save.type = 'button';
  const cancel = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  const submit = () => {
    const problem = onSave(input.value);
    error.hidden = !problem;
    error.textContent = problem ?? '';
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  wrap.append(field(label, input), error, el('div', 'flex items-center gap-2', ''));
  wrap.lastElementChild.append(save, cancel);
  escapeCancels(wrap, onCancel);
  queueMicrotask(() => input.focus());
  return wrap;
}

/**
 * Move to: the top level or any group that is not the moving group, its own subgroups, or too deep for it. The
 * name must stay unique among the siblings at the new place.
 */
function moveForm(path, onSave, onCancel) {
  const wrap = el('div', 'rounded-md border border-border bg-surface-subtle p-2 flex flex-col gap-2');
  const select = el('select', FIELD);
  select.setAttribute('aria-label', 'Move to');
  const options = [['', 'Top level'], ...groupList().map((target) => [target, target])];
  options.forEach(([value, text]) => {
    const option = el('option', '', text);
    option.value = value;
    select.append(option);
  });
  const height = subtreeHeight(path);
  const allowed = (target) => !isWithin(target, path) && (target === '' || groupDepth(target) + height <= MAX_LEVELS);
  options.forEach(([value], index) => {
    select.options[index].disabled = !allowed(value);
  });
  const error = fieldError('');
  error.hidden = true;
  const save = el('button', `${BUTTON_PRIMARY} h-control-sm px-2`, 'Move');
  save.type = 'button';
  save.addEventListener('click', () => {
    const target = select.value === '' ? null : select.value;
    // The group's own path is passed as the exception, so moving it to the parent it already has is not a clash.
    const problem = target !== null && isWithin(target, path)
      ? 'A group cannot move into itself or a group under it.'
      : validateName(path.split(GROUP_SEP).at(-1), target, path);
    error.hidden = !problem;
    error.textContent = problem;
    if (!problem) onSave(target);
  });
  const cancel = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  wrap.append(field('Move to', select), error, el('div', 'flex items-center gap-2'));
  wrap.lastElementChild.append(save, cancel);
  escapeCancels(wrap, onCancel);
  return wrap;
}

function deleteForm(path, onCancel, onDone) {
  const below = groupList().filter((item) => item !== path && isWithin(item, path)).length;
  const wrap = el('div', 'rounded-md border border-negative-border bg-negative-subtle p-2 flex flex-col gap-2');
  wrap.append(el('p', 'type-body-strong text-foreground', `Delete ${path.split(GROUP_SEP).at(-1)}?`));
  wrap.append(el('p', 'type-body text-foreground-secondary', below > 0
    ? `Its ${below} ${below === 1 ? 'subgroup is' : 'subgroups are'} deleted too. Keywords in them stay tracked and leave the group.`
    : 'Keywords in it stay tracked and leave the group.'));
  const row = el('div', 'flex items-center gap-2');
  const confirm = el('button', BUTTON_DANGER, below > 0 ? 'Delete group and subgroups' : 'Delete group');
  confirm.type = 'button';
  confirm.addEventListener('click', () => {
    deleteGroup(path);
    onDone();
  });
  const cancel = el('button', `${BUTTON_SM} text-foreground-secondary`, 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  row.append(confirm, cancel);
  wrap.append(row);
  escapeCancels(wrap, onCancel);
  return wrap;
}

/** @param {{onChange?: () => void}} options */
export function openGroups({ onChange } = {}) {
  const frame = openDialog({ title: 'Manage groups', description: 'Groups file keywords by theme. A keyword sits in one leaf group.', width: 'md' });
  let form = null;
  const list = el('div', 'flex flex-col gap-1');
  const tree = el('div', 'flex flex-col');

  const draw = () => {
    list.replaceChildren();
    if (groupList().length === 0) {
      list.append(el('p', 'type-body text-foreground-secondary py-6 text-center', 'No groups yet. Add one to file keywords by theme.'));
    }
    const render = (path, level) => {
      const row = el('div', 'flex flex-col');
      const line = el('div', 'min-h-9 py-1 flex items-center gap-2 flex-wrap rounded-md hover:bg-surface-hover');
      line.style.paddingLeft = `${level * 16 + 4}px`;
      const name = el('span', 'type-body-strong text-foreground min-w-0 truncate', path.split(GROUP_SEP).at(-1));
      const count = el('span', 'type-meta text-foreground-tertiary whitespace-nowrap', countText(path));
      const actions = el('div', 'flex items-center gap-1 ml-auto flex-wrap');
      const action = (text, onClick) => {
        const node = el('button', `${BUTTON_SM} text-foreground-secondary`, text);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
      };
      if (groupDepth(path) < MAX_LEVELS) {
        actions.append(action('Add subgroup', () => {
          form = { path, kind: 'sub' };
          draw();
        }));
      }
      actions.append(
        action('Rename', () => {
          form = { path, kind: 'rename' };
          draw();
        }),
        action('Move to', () => {
          form = { path, kind: 'move' };
          draw();
        }),
        action('Delete', () => {
          form = { path, kind: 'delete' };
          draw();
        }),
      );
      line.append(name, count, actions);
      row.append(line);
      if (form?.path === path) {
        const close = () => {
          form = null;
          draw();
        };
        const done = () => {
          form = null;
          draw();
          onChange?.();
        };
        if (form.kind === 'delete') row.append(deleteForm(path, close, done));
        else if (form.kind === 'move') {
          row.append(moveForm(path, (target) => {
            moveGroup(path, target);
            done();
          }, close));
        } else {
          const rename = form.kind === 'rename';
          const parentPath = rename ? path.split(GROUP_SEP).slice(0, -1).join(GROUP_SEP) || null : path;
          row.append(inlineForm({
            label: rename ? 'Group name' : 'Subgroup name',
            initial: rename ? path.split(GROUP_SEP).at(-1) : '',
            placeholder: rename ? '' : 'Content',
            onCancel: close,
            onSave: (value) => {
              const problem = validateName(value, parentPath, rename ? path : null);
              if (problem) return problem;
              if (rename) renameGroup(path, value.trim());
              else addGroup(`${path}${GROUP_SEP}${value.trim()}`);
              done();
              return '';
            },
          }));
        }
      }
      list.append(row);
      childrenOf(path).sort((a, b) => a.localeCompare(b)).forEach((child) => render(child, level + 1));
    };
    sortedRoots().forEach((root) => render(root, 0));
    if (form?.path === undefined && form?.kind === 'top') {
      list.prepend(inlineForm({
        label: 'Group name',
        placeholder: 'Services',
        onCancel: () => {
          form = null;
          draw();
        },
        onSave: (value) => {
          const problem = validateName(value, null);
          if (problem) return problem;
          addGroup(value.trim());
          form = null;
          draw();
          onChange?.();
          return '';
        },
      }));
    }
  };

  const addTop = el('button', `${BUTTON} h-control-sm`, 'Add group');
  addTop.type = 'button';
  addTop.prepend(icon('plus', 'size-icon text-foreground-tertiary'));
  addTop.addEventListener('click', () => {
    form = { kind: 'top' };
    draw();
  });
  tree.append(list);
  frame.body.append(el('div', 'flex items-center'), tree);
  frame.body.firstElementChild.append(addTop);
  draw();
  frame.body.append(el('p', 'type-meta text-foreground-tertiary', `Subgroups go ${MAX_LEVELS} levels deep at most.`));
  return frame;
}
