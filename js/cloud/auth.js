import { allowRegistration } from '../account-config.js';
import { blank } from './cache.js';
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
async function request(path, body, bearer, method = 'POST', signal) {
  signal?.throwIfAborted();
  if (!configured) throw new CloudError('Cloud sync has not been configured.', 400);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timeout = setTimeout(cancel, 12000);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    return await send(path, body, bearer, method, controller.signal);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    signal?.throwIfAborted();
  }
}
async function send(path, body, bearer, method, signal) {
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
      signal,
    });
  } catch {
    throw new CloudError('The cloud service could not be reached. Changes stay on this device.');
  }
  if (!response.ok) {
    const code = await response
      .json()
      .then((data) => data?.error_code)
      .catch(() => '');
    const known = {
      email_not_confirmed: 'Verify your email before signing in.',
      invalid_credentials: 'Check your email and password and try again.',
      otp_expired: 'This code has expired or is incorrect. Request another code.',
      weak_password: 'Choose a longer, less common password.',
      signup_disabled: 'New accounts are currently available by invitation.',
      captcha_failed: 'Complete the verification again and retry.',
    };
    const message = Object.hasOwn(known, code)
      ? known[code]
      : response.status === 429
        ? 'Too many requests. Try again shortly.'
        : response.status >= 500
          ? 'The cloud service is temporarily unavailable.'
          : path.startsWith('/rest/')
            ? 'The cloud rejected the change. Check the migration and the entry data.'
            : 'The account request was declined. Check the email, password or email code.';
    const error = new CloudError(message, response.status);
    error.code = code;
    throw error;
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
    displayName: profileName(raw.user),
    access: raw.access_token,
    refresh: raw.refresh_token,
    expires: Date.now() + raw.expires_in * 1000,
  };
}
function profileName(user) {
  const metadata = user?.user_metadata;
  const name = metadata?.display_name || metadata?.full_name;
  return typeof name === 'string' ? name.trim().slice(0, 80) : '';
}
const challenge = (token) => (token ? { gotrue_meta_security: { captcha_token: token } } : {});
function requireSignup() {
  if (allowRegistration !== true)
    throw new Error('New accounts are currently available by invitation.');
}
// The auth lock serializes identity changes. A cache is initialized once, before publishing its owner.
async function openArchive(s) {
  if (!navigator.locks) throw new Error('Opening a private archive requires HTTPS and Web Locks.');
  const key = accountKey(s.id);
  await navigator.locks.request(key, () => {
    try {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(blank()));
      localStorage.setItem(sessionKey, JSON.stringify({ ...s, linked: true }));
    } catch {
      throw new Error(
        'This browser could not save the private archive. Allow site storage or free up space and try again.'
      );
    }
  });
  return s.id;
}
function authenticate(getSession) {
  return authLock(async () => {
    if (session()) throw new Error('Sign out before switching accounts.');
    const s = credentials(await getSession());
    try {
      return await openArchive(s);
    } catch (error) {
      await request('/auth/v1/logout?scope=local', undefined, s.access).catch(() => {});
      throw error;
    }
  });
}
export function signIn(email, password, token) {
  return authenticate(() =>
    request('/auth/v1/token?grant_type=password', { email, password, ...challenge(token) })
  );
}
export async function signUp(email, password, displayName, token) {
  requireSignup();
  // Always verify through the email-code screen. Do not persist a signup response as a session.
  const reply = await request('/auth/v1/signup', {
    email,
    password,
    data: { display_name: displayName.trim().slice(0, 80) },
    ...challenge(token),
  });
  if (reply?.access_token) {
    await request('/auth/v1/logout?scope=local', undefined, reply.access_token).catch(() => {});
    throw new Error(
      'Email confirmation is unavailable. Ask the journal administrator to enable it.'
    );
  }
}
export function verifySignup(email, code, captcha) {
  return authenticate(() =>
    request('/auth/v1/verify', { email, token: code, type: 'signup', ...challenge(captcha) })
  );
}
export function resendVerification(email, token) {
  return request('/auth/v1/resend', { type: 'signup', email, ...challenge(token) });
}
export function resumeConnection(id) {
  return authLock(() => openArchive(requireSession(id)));
}
export function signOut(id) {
  return authLock(async () => {
    const s = requireSession(id);
    localStorage.removeItem(sessionKey);
    // Remove local access immediately, including in other tabs. Offline revocation is best effort.
    if (!navigator.onLine) return false;
    try {
      await request('/auth/v1/logout?scope=local', undefined, s.access);
    } catch {
      return false;
    }
    return true;
  });
}
export async function requestRecovery(email, token) {
  try {
    await request('/auth/v1/recover', { email, ...challenge(token) });
  } catch (error) {
    if (error.status >= 500 || error.code === 'email_provider_disabled')
      throw new Error(
        'Password recovery email is unavailable. Contact the person who manages this journal.'
      );
    throw error;
  }
}
export async function resetPassword(email, code, password, captcha) {
  const s = credentials(
    await request('/auth/v1/verify', {
      email,
      token: code,
      type: 'recovery',
      ...challenge(captcha),
    })
  );
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
export async function rpc(owner, name, params, signal) {
  signal?.throwIfAborted();
  const token = await access(owner);
  try {
    return await request('/rest/v1/rpc/' + name, params, token, 'POST', signal);
  } catch (error) {
    if (error.status !== 401) throw error;
    return request('/rest/v1/rpc/' + name, params, await access(owner, token), 'POST', signal);
  }
}
export async function updateDisplayName(id, value) {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error('Enter a display name of up to 80 characters.');
  await access(id);
  return authLock(async () => {
    const s = requireSession(id);
    const user = await request('/auth/v1/user', { data: { display_name: name } }, s.access, 'PUT');
    if (user?.id !== id) throw new Error('The account changed. Open Settings again.');
    localStorage.setItem(
      sessionKey,
      JSON.stringify({ ...requireSession(id), displayName: profileName(user) })
    );
  });
}
