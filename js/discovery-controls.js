import {
  defaults,
  facets,
  languageLabel,
  missingLabels,
  runQuery,
  sorts,
  unknown,
} from './discovery.js';
import { hideDialog, showDialog } from './motion.js';
import { icon } from './views.js';

const ranges = { year: 'Release year', rating: 'Rating', added: 'Added' };
const byId = (id) => document.getElementById(id);
function makeButton(label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  return b;
}
export function setupDiscovery({ getState, getRows, update }) {
  const dialog = byId('discovery-filters'),
    form = byId('discovery-form'),
    trigger = byId('filter-open');
  const order = byId('order'),
    search = byId('query'),
    chips = byId('active-filters');
  order.replaceChildren(...sorts.map(([v, n]) => new Option(n, v)));
  let draft,
    lastRows,
    options,
    lastChips = '',
    closing = false;
  function currentOptions() {
    const rows = getRows();
    if (rows !== lastRows) {
      lastRows = rows;
      options = facets(rows);
    }
    return options;
  }
  function facetLabel(key, value) {
    return (
      currentOptions()[key].find((o) => o.key === value)?.label ??
      (key === 'genres'
        ? value === unknown
          ? 'Unknown genre'
          : 'Genre ' + value
        : languageLabel(value))
    );
  }
  function fillOptions() {
    const all = currentOptions();
    for (const key of ['genres', 'languages']) {
      const area = byId('facet-' + key);
      const selected = draft[key],
        choices = [...all[key]];
      for (const id of selected)
        if (!choices.some((v) => v.key === id))
          choices.push({ key: id, label: facetLabel(key, id), count: 0 });
      const prior = area.contains(document.activeElement) ? document.activeElement.value : null;
      area.replaceChildren();
      for (const option of choices) {
        const label = document.createElement('label'),
          input = document.createElement('input'),
          n = document.createElement('small');
        input.type = 'checkbox';
        input.name = key;
        input.value = option.key;
        input.checked = selected.includes(option.key);
        n.textContent = String(option.count);
        label.append(input, option.label, n);
        area.append(label);
        if (prior === input.value) input.focus({ preventScroll: true });
      }
      if (!choices.length) area.textContent = 'No saved titles';
    }
    for (const [key, list, first] of [
      ['source', all.sources, 'All entries'],
      ['missing', all.missing, 'Any metadata'],
    ]) {
      const select = form.elements[key];
      select.replaceChildren(new Option(first, ''));
      for (const o of list) select.add(new Option(o.label + ' · ' + o.count, o.key));
      if (draft[key] && !list.some((o) => o.key === draft[key]))
        select.add(new Option((missingLabels[draft[key]] || draft[key]) + ' · 0', draft[key]));
      select.value = draft[key];
    }
    byId('filter-decade').replaceChildren(
      new Option('Choose decade', ''),
      ...all.decades.map((o) => new Option(o.label + ' · ' + o.count, o.key))
    );
  }
  function preview() {
    for (const prefix of Object.keys(ranges)) {
      const min = form.elements[prefix + 'From'],
        max = form.elements[prefix + 'To'];
      max.setCustomValidity('');
      if (min.value && max.value && draft[prefix + 'From'] > draft[prefix + 'To'])
        max.setCustomValidity('The upper bound must follow the lower bound.');
    }
    const valid = form.checkValidity(),
      count = valid ? runQuery(getRows(), draft).length : 0;
    byId('filter-preview').textContent = valid
      ? count + ' ' + (count === 1 ? 'match' : 'matches')
      : 'Check the range';
    form.querySelector('[type="submit"]').disabled = !valid;
    for (const b of form.querySelectorAll('[data-preset]'))
      b.setAttribute('aria-pressed', String(draft.sort === b.dataset.preset));
    const decade = byId('filter-decade');
    decade.value =
      Number(draft.yearFrom) % 10 === 0 && Number(draft.yearTo) === Number(draft.yearFrom) + 9
        ? draft.yearFrom
        : '';
  }
  function populate() {
    fillOptions();
    for (const prefix of Object.keys(ranges))
      for (const edge of ['From', 'To']) form.elements[prefix + edge].value = draft[prefix + edge];
    preview();
  }
  trigger.onclick = () => {
    if (closing || dialog.open) return;
    draft = structuredClone(getState());
    populate();
    showDialog(dialog, trigger);
    dialog.querySelector('.filter-body').scrollTop = 0;
    byId('filter-close').focus();
  };
  async function close() {
    if (closing) return;
    closing = true;
    await hideDialog(dialog, trigger);
    draft = null;
    closing = false;
    trigger.focus({ preventScroll: true });
  }
  byId('filter-close').onclick = close;
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        close();
    }
  });
  form.addEventListener('input', (e) => {
    const el = e.target,
      key = el.name;
    if (el.id === 'filter-decade') {
      draft.yearFrom = el.value.padStart(4, '0');
      draft.yearTo = el.value ? String(Number(el.value) + 9).padStart(4, '0') : '';
      if (!el.value) draft.yearFrom = '';
      form.elements.yearFrom.value = draft.yearFrom;
      form.elements.yearTo.value = draft.yearTo;
    } else if (key === 'genres' || key === 'languages')
      draft[key] = [...form.querySelectorAll('input[name="' + key + '"]:checked')].map(
        (i) => i.value
      );
    else if (key)
      draft[key] =
        el.value && key.startsWith('rating')
          ? el.valueAsNumber
          : el.value && key.startsWith('year')
            ? el.value.padStart(4, '0')
            : el.value;
    preview();
  });
  form.addEventListener('click', (e) => {
    const preset = e.target.closest('[data-preset]');
    if (preset) {
      draft.sort = preset.dataset.preset;
      preview();
    }
  });
  byId('reset-draft').onclick = () => {
    draft = { ...defaults(), query: draft.query, sort: draft.sort };
    populate();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    if (!closing && form.reportValidity()) {
      update(draft);
      close();
    }
  };
  const clear = () => {
    update(defaults());
    search.focus({ preventScroll: true });
  };
  function sync() {
    const state = getState(),
      rowsChanged = lastRows !== getRows();
    if (search.value !== state.query) search.value = state.query;
    order.value = state.sort;
    const actions = [];
    function chip(label, reset) {
      actions.push({ label, reset });
    }
    if (state.query.trim()) chip('“' + state.query.trim() + '”', { query: '' });
    for (const key of ['genres', 'languages'])
      for (const v of state[key])
        chip(facetLabel(key, v), { [key]: state[key].filter((x) => x !== v) });
    for (const [key, label] of Object.entries(ranges)) {
      const from = state[key + 'From'],
        to = state[key + 'To'];
      if (from || to)
        chip(label + ' ' + (from && to ? from + '–' + to : from ? '≥ ' + from : '≤ ' + to), {
          [key + 'From']: '',
          [key + 'To']: '',
        });
    }
    if (state.source) chip(state.source === 'manual' ? 'Manual' : 'Catalog', { source: '' });
    if (state.missing) chip(missingLabels[state.missing], { missing: '' });
    const signature = JSON.stringify(actions);
    if (signature !== lastChips) {
      lastChips = signature;
      chips.replaceChildren();
      for (const { label, reset } of actions) {
        const b = makeButton(label);
        b.setAttribute('aria-label', 'Remove ' + label);
        b.append(icon('x'));
        b.onclick = () => {
          update({ ...getState(), ...reset });
          (chips.querySelector('button') || trigger).focus({ preventScroll: true });
        };
        chips.append(b);
      }
      const total = actions.length - (state.query.trim() ? 1 : 0);
      trigger.setAttribute('aria-label', total ? 'Filters, ' + total + ' active' : 'Filters');
      byId('filter-count').hidden = !total;
      byId('filter-count').textContent = total;
      chips.hidden = !actions.length;
      if (actions.length) {
        const b = makeButton('Clear all');
        b.className = 'clear-filters';
        b.onclick = clear;
        chips.append(b);
      }
    }
    if (dialog.open && draft && rowsChanged) {
      fillOptions();
      preview();
    }
  }
  return { sync, clear };
}
