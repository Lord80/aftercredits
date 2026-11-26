import { accountKey, owner, assertScope } from './scope.js';

import { cacheAt, withEntries, working } from './cache.js';

function currentAccount() {
  assertScope();
  return cacheAt(accountKey(owner));
}
export function accountEntries() {
  return working(currentAccount());
}
export function saveAccountEntries(entries) {
  const c = withEntries(currentAccount(), entries);
  try {
    localStorage.setItem(accountKey(owner), JSON.stringify(c));
  } catch (error) {
    throw new DOMException(
      'This browser could not save the account change. Its previous copy is intact.',
      error.name
    );
  }
  window.dispatchEvent(new Event('cloud-edit'));
}

export async function prepareOfflineShell() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(new URL('../../offline.js', import.meta.url), {
      type: 'module',
      updateViaCache: 'none',
    });
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({
      type: 'warm-scenery',
      urls: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.startsWith(registration.scope + 'assets/')),
    });
    window.dispatchEvent(new Event('cloud-state'));
  } catch {
    /* Open tabs retain offline editing even if shell caching is unavailable. */
  }
}
