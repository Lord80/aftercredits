import { publishableKey } from '../cloud-config.js';
import {
  accountKey,
  configured,
  endpoint,
  prefix,
  requireSession,
  session,
  sessionKey,
  uuid,
} from './scope.js';

export class CloudError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}
async function request(path, body, bearer, method = 'POST') {
  if (!configured) throw new CloudError('Cloud sync has not been configured.', 400);
  let response;
  try {
    response = await fetch(endpoint + path, {
      method,
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
      },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new CloudError('The cloud service could not be reached. Changes stay on this device.');
  }
  if (!response.ok) {
    const message =
      response.status === 429
        ? 'Too many requests. Try again shortly.'
        : response.status >= 500
          ? 'The cloud service is temporarily unavailable.'
          : path.startsWith('/rest/')
            ? 'The cloud rejected the change. Check the migration and the entry data.'
            : 'The account request was declined. Check the email, password or recovery code.';
    throw new CloudError(message, response.status);
  }
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    throw new CloudError('The cloud reply was incomplete. Retry to check the saved operation.');
  }
}
const authLock = (fn) => {
  if (!navigator.locks) throw new Error('Account access requires HTTPS and Web Locks.');
  return navigator.locks.request(prefix + '.auth', async () => fn());
};
function credentials(raw) {
  if (
    !uuid(raw?.user?.id) ||
    !raw.access_token ||
    !raw.refresh_token ||
    !Number.isFinite(raw.expires_in)
  )
    throw new Error('The authentication response could not be verified.');
  return {
    id: raw.user.id,
    email: raw.user.email,
    access: raw.access_token,
    refresh: raw.refresh_token,
    expires: Date.now() + raw.expires_in * 1000,
  };
}
export async function signIn(email, password) {
  return authLock(async () => {
    if (session()) throw new Error('Sign out before switching accounts.');
    const s = credentials(await request('/auth/v1/token?grant_type=password', { email, password }));
    s.linked = localStorage.getItem(accountKey(s.id)) !== null;
    localStorage.setItem(sessionKey, JSON.stringify(s));
    return s;
  });
}
export function signOut() {
  return authLock(async () => {
    const s = session();
    localStorage.removeItem(sessionKey);
    // Remove local access immediately, including in other tabs. Offline revocation is best effort.
    if (s) {
      if (!navigator.onLine) return false;
      try {
        await request('/auth/v1/logout?scope=local', undefined, s.access);
      } catch {
        return false;
      }
    }
    return true;
  });
}
export function requestRecovery(email) {
  return request('/auth/v1/recover', { email });
}
export async function resetPassword(email, code, password) {
  const s = credentials(await request('/auth/v1/verify', { email, token: code, type: 'recovery' }));
  try {
    await request('/auth/v1/user', { password }, s.access, 'PUT');
  } finally {
    await request('/auth/v1/logout?scope=local', undefined, s.access).catch(() => {});
  }
}
async function access(owner, rejected) {
  const existing = requireSession(owner);
  if (existing.access !== rejected && existing.expires > Date.now() + 45000) return existing.access;
  return authLock(async () => {
    const s = requireSession(owner);
    if (s.access !== rejected && s.expires > Date.now() + 45000) return s.access;
    let next;
    try {
      next = credentials(
        await request('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh })
      );
    } catch (error) {
      if ([400, 401, 403].includes(error.status)) {
        localStorage.removeItem(sessionKey);
        window.dispatchEvent(new Event('cloud-session-ended'));
      }
      throw error;
    }
    if (next.id !== owner) throw new Error('The renewed session belongs to a different account.');
    localStorage.setItem(sessionKey, JSON.stringify({ ...next, linked: s.linked }));
    return next.access;
  });
}
export async function rpc(owner, name, params) {
  const token = await access(owner);
  try {
    return await request('/rest/v1/rpc/' + name, params, token);
  } catch (error) {
    if (error.status !== 401) throw error;
    return request('/rest/v1/rpc/' + name, params, await access(owner, token));
  }
}
export function activateSession(id) {
  return authLock(() => {
    const s = requireSession(id);
    localStorage.setItem(sessionKey, JSON.stringify({ ...s, linked: true }));
  });
}
