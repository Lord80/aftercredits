import { equal } from '../validation.js';

export async function reviewChanges({ page, el, action, body }, cloud, returnToSection, backLabel) {
  const p = cloud.conflictPreview();
  if (!p) return returnToSection();
  if (!p.conflicts.length) {
    await cloud.resolveConflicts(p.token, new Map());
    return returnToSection();
  }
  page('Review changes');
  body.append(
    el(
      'p',
      'Choose the whole version to keep for each title. Your other titles will sync automatically.'
    )
  );
  const choices = new Map();
  for (const group of p.conflicts) {
    const title = (group.local[0] || group.remote[0] || group.base[0]).title;
    const comparison = el('dl');
    comparison.className = 'account-comparison';
    for (const [source, entries] of [
      ['This device', group.local],
      ['Cloud', group.remote],
    ]) {
      const column = el('div');
      column.append(el('dt', source));
      if (!entries.length) column.append(el('dd', 'Deleted'));
      for (const entry of entries) {
        const rating = entry.rating.toFixed(1) + ' / 10';
        column.append(el('dd', entry.title === title ? rating : entry.title + ' · ' + rating));
      }
      comparison.append(column);
    }
    const detail = el('details');
    detail.append(el('summary', 'Compare all saved fields'));
    detail.ontoggle = () => {
      if (!detail.open || detail.childElementCount > 1) return;
      for (const [label, entries] of [
        ['Earlier', group.base],
        ['This device', group.local],
        ['Cloud', group.remote],
      ])
        detail.append(
          el('strong', label),
          el('pre', entries.length ? JSON.stringify(entries, null, 2) : 'Deleted / absent')
        );
    };
    const label = el('label', 'Version for ' + title);
    const select = el('select');
    for (const [text, value] of [
      ['Choose a version', ''],
      ['Keep this device', 'device'],
      ['Keep cloud', 'cloud'],
    ])
      select.add(new Option(text, value));
    select.onchange = () => {
      if (select.value) choices.set(group.key, select.value);
      else choices.delete(group.key);
      apply.disabled = choices.size !== p.conflicts.length;
    };
    label.append(select);
    const groupTitle = el('h4', title, 'comparison-heading');
    body.append(groupTitle, comparison);
    if (group.local.length === 1 && group.remote.length === 1) {
      const left = group.local[0],
        right = group.remote[0];
      const fields = [
        ['Date added', 'added'],
        ['Saved film details', 'metadata'],
        ['Media type', 'mediaType'],
        ['Catalog match', 'tmdbId'],
      ]
        .filter(([, key]) => !equal(left[key], right[key]))
        .map(([label]) => label);
      if (fields.length)
        body.append(el('p', 'Also compare ' + fields.join(', ').toLowerCase() + '.'));
    }
    body.append(detail, label);
  }
  const apply = action(
    body,
    'Confirm resolutions',
    async () => {
      await cloud.resolveConflicts(p.token, choices);
      await returnToSection();
    },
    'button primary'
  );
  apply.disabled = true;
  action(body, backLabel, returnToSection, 'account-link');
}
