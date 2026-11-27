import { allowRegistration } from '../account-config.js';
import { mountChallenge } from './captcha.js';
import {
  signIn,
  signUp,
  verifySignup,
  resendVerification,
  requestRecovery,
  resetPassword,
} from './auth.js';
import { snapshot } from '../collection.js';

export function field(form, label, type, autocomplete, value = '') {
  const wrap = document.createElement('div');
  wrap.className = 'account-field';
  const input = document.createElement('input');
  input.id = 'user-' + autocomplete;
  input.name = autocomplete;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  input.value = value;
  const caption = document.createElement('label');
  caption.htmlFor = input.id;
  caption.textContent = label;
  wrap.append(caption, input);
  if (type === 'password') {
    wrap.classList.add('password-field');
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'password-switch';
    show.textContent = 'Show';
    show.setAttribute('aria-label', 'Show password');
    show.onclick = () => {
      const hide = input.type === 'text';
      input.type = hide ? 'password' : 'text';
      show.textContent = hide ? 'Show' : 'Hide';
      show.setAttribute('aria-label', hide ? 'Show password' : 'Hide password');
    };
    wrap.append(show);
  }
  form.append(wrap);
  return input;
}
const pages = {
  signin: ['Sign in', 'Open your private movie and series collection.', 'Sign in', 'Signing in…'],
  signup: [
    'Create account',
    'Keep your collection with you across devices.',
    'Create account',
    'Creating account…',
  ],
  verify: [
    'Verify your email',
    'Enter the confirmation code sent to your email.',
    'Verify email',
    'Verifying…',
  ],
  recover: [
    'Forgot password?',
    'We’ll email a code so you can choose a new password.',
    'Send recovery code',
    'Sending code…',
  ],
  reset: [
    'Set a new password',
    'Enter your recovery code and choose a new password.',
    'Set new password',
    'Updating password…',
  ],
};

export function authScreen(ui, mode = 'signin', address = '') {
  const [title, description, label, progress] = pages[mode];
  const { body, el, page, action, run, message, authenticated } = ui;
  page(title);
  body.append(el('p', description));
  const form = el('form');
  form.className = 'cloud-form';
  body.append(form);
  let name, code, password;
  if (mode === 'signup') {
    name = field(form, 'Display name', 'text', 'nickname');
    name.maxLength = 80;
    name.pattern = '.*\\S.*';
  }
  const email = field(form, 'Email', 'email', 'email', address);
  email.maxLength = 254;
  email.autocapitalize = 'none';
  email.spellcheck = false;
  if (mode === 'verify' || mode === 'reset') {
    code = field(
      form,
      mode === 'verify' ? 'Confirmation code' : 'Recovery code',
      'text',
      'one-time-code'
    );
    code.inputMode = 'numeric';
    code.pattern = '[0-9]{6,10}';
    code.maxLength = 10;
  }
  if (['signin', 'signup', 'reset'].includes(mode)) {
    password = field(
      form,
      mode === 'reset' ? 'New password' : 'Password',
      'password',
      mode === 'signin' ? 'current-password' : 'new-password'
    );
    if (mode !== 'signin') {
      password.minLength = 8;
      password.placeholder = 'At least 8 characters';
    }
  }
  const captcha = mountChallenge(form, (msg) => message(msg, true));
  ui.onLeave(() => captcha.remove());
  const submit = el('button', label);
  submit.type = 'submit';
  submit.className = 'button primary';
  form.append(submit);
  const links = el('div');
  links.className = 'account-links';
  const follow = (text, to) =>
    action(links, text, () => authScreen(ui, to, email.value.trim()), 'account-link');
  if (mode === 'signin') {
    follow('Forgot password?', 'recover');
    if (allowRegistration === true) follow('Create account', 'signup');
  } else follow('Back to sign in', 'signin');

  const sendAgain = mode === 'verify' || mode === 'reset';
  if (sendAgain)
    action(
      links,
      'Send another code',
      async () => {
        if (!email.reportValidity()) return;
        try {
          const send = mode === 'verify' ? resendVerification : requestRecovery;
          await send(email.value.trim(), captcha.response());
          message('Check your email for a new code.');
        } finally {
          captcha.reset();
        }
      },
      'account-link'
    );
  body.append(links);
  form.onsubmit = (event) => {
    event.preventDefault();
    run(progress, async () => {
      const to = email.value.trim();
      try {
        const token = captcha.response();
        if (mode === 'signin' || mode === 'verify') {
          // A reload would discard tab-only guest edits. Offer an independent copy first.
          const guest = snapshot();
          if (guest.notice && guest.items.length && !ui.guestCopyMatches(guest.items)) {
            const { backupText } = await import('../backup.js');
            const { download } = await import('../download.js');
            const at = new Date().toISOString();
            download(backupText(guest.items, at), 'guest-before-signin', at, 'json');
            ui.noteGuestCopy(guest.items);
            message(
              'A copy of your tab-only guest titles was generated. Check your download, then continue.'
            );
            return;
          }
          if (mode === 'signin') await signIn(to, password.value, token);
          else await verifySignup(to, code.value, token);
          authenticated(guest.items.length);
        } else if (mode === 'signup') {
          await signUp(to, password.value, name.value, token);
          authScreen(ui, 'verify', to);
          message('Check your email for your confirmation code.');
        } else if (mode === 'recover') {
          await requestRecovery(to, token);
          authScreen(ui, 'reset', to);
          message('If this account exists, check your email for the recovery code.');
        } else {
          await resetPassword(to, code.value, password.value, token);
          authScreen(ui, 'signin', to);
          message('Password updated. Sign in to continue.');
        }
      } catch (error) {
        if (error.code === 'email_not_confirmed') {
          authScreen(ui, 'verify', to);
          message('Verify your email to open your collection. You can request another code here.');
        } else throw error;
      } finally {
        captcha.reset();
      }
    });
  };
}
