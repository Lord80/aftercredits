import { projectUrl, publishableKey } from '../cloud-config.js';

export const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(projectUrl) &&
  /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey);
export const endpoint = projectUrl.replace(/\/$/, '');
export const prefix =
  'aftercredits.cloud.v1.' + (configured ? new URL(endpoint).hostname : 'disabled');
export const sessionKey = prefix + '.session';
export const accountKey = (owner) => prefix + '.' + owner + '.archive';
export const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function session() {
  if (!configured) return null;
  try {
    const s = JSON.parse(localStorage.getItem(sessionKey));
    if (
      uuid(s?.id) &&
      typeof s.access === 'string' &&
      typeof s.refresh === 'string' &&
      typeof s.linked === 'boolean'
    )
      return s;
  } catch {
    /* A blocked or damaged session must not prevent opening the guest journal. */
  }
  return null;
}
function scopeNow() {
  const s = session();
  return s?.linked ? s.id : null;
}
// A page is bound to a single archive. An account change discards open forms and projections.
let initialOwner = null,
  initialUser = null;
try {
  initialUser = session()?.id;
  initialOwner = scopeNow();
} catch {
  /* Guest mode still works with blocked storage. */
}
export const owner = initialOwner;
export const keyFor = (guestKey) => (owner ? prefix + '.' + owner + '.' + guestKey : guestKey);
export function assertScope() {
  if (configured && scopeNow() !== owner)
    throw new Error('The active archive changed. Reload this page.');
}
export function requireSession(id) {
  const s = session();
  if (!s || s.id !== id) throw new Error('Sign in again with the same account.');
  return s;
}
export function reloadScope() {
  document.documentElement.style.visibility = 'hidden';
  location.reload();
}
if (configured && typeof window !== 'undefined') {
  function guard() {
    try {
      if (session()?.id !== initialUser) return reloadScope();
      assertScope();
    } catch {
      reloadScope();
    }
  }
  window.addEventListener('pageshow', guard);
  window.addEventListener('storage', (e) => {
    if (e.key === sessionKey || e.key === null) {
      guard();
    }
  });
}
