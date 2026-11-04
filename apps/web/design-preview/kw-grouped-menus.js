/* global navigator */
/**
 * The menus and pickers of the grouped Rankings mock: country, filter, columns, export, More, the arrow of Add
 * keywords, and the menus of a keyword row and of a group row. Each is a popover on its trigger.
 */
import { UNGROUPED, archiveKeywords, deleteKeywords, recheck, store } from './kw-grouped-data.js';
import { checkRow, icon, popover, toast } from './perf-ui.js';
import { confirmDialog } from './kw-dialog.js';
import { el } from './prompts-parts.js';
import { ALL_COUNTRIES, COLUMNS, addScope, FILTER_FIELDS, csvText, download, groupOf, plural, refresh, shown, state, tableRows, workbookXml } from './kw-grouped-model.js';
import { usedCountries } from './kw-grouped-data.js';
import { openAdd, openImport, openManageGroups, openMove, openRename, confirmDeleteGroup } from './kw-grouped-dialogs.js';
import { openGroup, openKeyword } from './kw-grouped-drawer.js';

const ITEM = 'w-full min-h-9 px-2 rounded-md flex items-center gap-2 type-body text-foreground text-left hover:bg-surface-hover focus-visible:bg-surface-hover';

/** A menu row. `checked` shows a check; `detail` is a short fact at its end; `danger` marks a destructive row. */
function item(panel, api, label, { iconName, detail, checked, danger = false, run }) {
  const node = el('button', `${ITEM} ${danger ? 'text-negative-text' : ''}`);
  node.type = 'button';
  node.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (checked !== undefined) node.setAttribute('aria-checked', String(checked));
  node.append(iconName ? icon(iconName, 'size-icon-sm text-foreground-tertiary') : el('span', 'size-4'), el('span', 'flex-1 truncate', label));
  if (detail) node.append(el('span', 'type-label text-foreground-tertiary whitespace-nowrap', detail));
  if (checked) node.append(icon('check', 'size-icon-sm text-primary-text'));
  node.addEventListener('click', () => {
    api.close();
    run();
  });
  panel.append(node);
  return node;
}

const pad = (panel) => {
  panel.classList.add('p-1', 'flex', 'flex-col');
  return panel;
};

function checkNow(items) {
  const ids = new Set(items.map((keyword) => keyword.id));
  recheck(ids);
  toast({ title: 'Check finished', description: `${plural(ids.size, 'keyword')} checked through the standard queue. The ranks are up to date.`, tone: 'success' });
  refresh();
}
export { checkNow };

export function exportItems(items, scope) {
  const stamp = '2026-11-04';
  return {
    csv: () => {
      download(`keywords-${scope}-${stamp}.csv`, csvText(tableRows(items)), 'text/csv;charset=utf-8');
      toast({ title: 'CSV saved', description: `${plural(items.length, 'keyword')}, the table only.`, tone: 'success' });
    },
    excel: () => {
      download(`keywords-${scope}-${stamp}.xls`, workbookXml(items), 'application/vnd.ms-excel');
      toast({ title: 'Excel workbook saved', description: `${plural(items.length, 'keyword')} with the counts above the table.`, tone: 'success' });
    },
  };
}

export function countryMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    // Only the countries that have keywords, and all of them when there is more than one
    const used = usedCountries();
    [...used, ...(used.length > 1 ? [ALL_COUNTRIES] : [])].forEach((name) =>
      item(panel, api, name, {
        iconName: 'map-pin',
        checked: state.country === name,
        run: () => {
          state.country = name;
          state.selected.clear();
          refresh();
        },
      }),
    );
  }, { label: 'Country' });
}

/** Filter: pick a field, then a value; one chip for each field, a new value replacing the old one. */
export function filterMenu(trigger) {
  popover(trigger, (panel, api) => {
    const fields = () => {
      pad(panel).replaceChildren();
      Object.entries(FILTER_FIELDS).forEach(([key, spec]) => {
        const row = item(panel, { close: () => {} }, spec.label, { run: () => values(key) });
        row.append(icon('chevron-right', 'size-icon-sm text-foreground-tertiary'));
      });
    };
    const values = (key) => {
      panel.replaceChildren();
      const back = el('button', `${ITEM} text-foreground-secondary`);
      back.type = 'button';
      back.append(icon('chevron-left', 'size-icon-sm'), el('span', '', FILTER_FIELDS[key].label));
      back.addEventListener('click', fields);
      panel.append(back);
      FILTER_FIELDS[key].values().forEach(([value, label]) =>
        item(panel, api, label, {
          checked: state.filters.some((filter) => filter.field === key && filter.value === value),
          run: () => {
            const chip = { field: key, value, label: `${FILTER_FIELDS[key].label}: ${label}` };
            const has = state.filters.some((filter) => filter.field === key && filter.value === value);
            // A field with several values (countries) adds or takes away one; the others replace their one chip
            if (FILTER_FIELDS[key].multiple) state.filters = has ? state.filters.filter((filter) => !(filter.field === key && filter.value === value)) : [...state.filters, chip];
            else state.filters = [...state.filters.filter((filter) => filter.field !== key), chip];
            refresh();
          },
        }),
      );
    };
    fields();
  }, { label: 'Add a filter' });
}

export function columnsMenu(trigger) {
  popover(trigger, (panel) => {
    panel.classList.add('p-2', 'flex', 'flex-col');
    COLUMNS.filter((column) => (column.only === undefined || column.only === state.mode) && column.not !== state.mode).forEach((column) =>
      panel.append(
        checkRow(column.label, state.columns.has(column.id), (on) => {
          if (on) state.columns.add(column.id);
          else state.columns.delete(column.id);
          refresh();
        }),
      ),
    );
  }, { label: 'Columns' });
}

export function exportMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    const files = exportItems(shown(), 'table');
    item(panel, api, 'Excel workbook with summary', { iconName: 'file-chart-column', run: files.excel });
    item(panel, api, 'CSV, table only', { iconName: 'file-text', run: files.csv });
  }, { label: 'Export' });
}

export function moreMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    item(panel, api, 'Refresh metrics', { iconName: 'refresh-cw', detail: '20 of 20 left today', run: () => {
      checkNow(shown());
    } });
    item(panel, api, 'Manage groups', { iconName: 'folder', run: openManageGroups });
    item(panel, api, 'Show archived keywords', { iconName: 'archive', checked: state.archived, run: () => {
      state.archived = !state.archived;
      state.selected.clear();
      refresh();
    } });
  }, { label: 'More actions' });
}

export function addMenu(trigger) {
  popover(trigger, (panel, api) => {
    pad(panel);
    item(panel, api, 'Import from a file', { iconName: 'upload', run: openImport });
  }, { label: 'More ways to add keywords' });
}

export function keywordMenu(trigger, keyword) {
  popover(trigger, (panel, api) => {
    pad(panel);
    item(panel, api, 'Open details', { iconName: 'panel-right-open', run: () => openKeyword(keyword.id) });
    item(panel, api, 'Check now', { iconName: 'refresh-cw', run: () => checkNow([keyword]) });
    item(panel, api, 'Move to a group', { iconName: 'folder', run: () => openMove(new Set([keyword.id])) });
    item(panel, api, 'Copy keyword', { iconName: 'copy', run: () => {
      navigator.clipboard?.writeText(keyword.keyword);
      toast({ title: 'Copied', description: keyword.keyword, tone: 'success' });
    } });
    item(panel, api, keyword.archived ? 'Restore' : 'Archive', { iconName: keyword.archived ? 'archive-restore' : 'archive', run: () => {
      archiveKeywords(new Set([keyword.id]), !keyword.archived);
      refresh();
    } });
    item(panel, api, 'Delete', { iconName: 'trash-2', danger: true, run: () => confirmDialog({ title: `Delete ${keyword.keyword}?`, description: 'Its history is deleted with it.', confirmLabel: 'Delete', danger: true, onConfirm: () => {
      deleteKeywords(new Set([keyword.id]));
      refresh();
    } }) });
  }, { label: `Actions for ${keyword.keyword}` });
}

export function groupMenu(trigger, name) {
  popover(trigger, (panel, api) => {
    pad(panel);
    const members = shown().filter((keyword) => groupOf(keyword) === name);
    item(panel, api, 'Open group', { iconName: 'panel-right-open', run: () => openGroup(name) });
    item(panel, api, 'Check now', { iconName: 'refresh-cw', detail: plural(members.length, 'keyword'), run: () => checkNow(members) });
    item(panel, api, 'Add keywords', { iconName: 'plus', run: () => openAdd({ group: name, countries: addScope() }) });
    const files = exportItems(members, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    item(panel, api, 'Export this group', { iconName: 'download', run: files.csv });
    if (name !== UNGROUPED && store.groups.some((group) => group.name === name)) {
      item(panel, api, 'Rename', { iconName: 'pencil', run: () => openRename(name) });
      item(panel, api, 'Delete group', { iconName: 'trash-2', danger: true, run: () => confirmDeleteGroup(name) });
    }
  }, { label: `Actions for ${name}` });
}
