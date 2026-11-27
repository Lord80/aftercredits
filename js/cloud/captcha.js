// Loaded only when the operator configures a public Turnstile site key.
import { turnstileSiteKey } from '../account-config.js';
let loading;
function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading)
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      const failed = () => {
        clearTimeout(timer);
        script.remove();
        loading = null;
        reject(new Error('Verification could not load. Check your connection and try again.'));
      };
      const timer = setTimeout(failed, 12000);
      script.onload = () => {
        clearTimeout(timer);
        window.turnstile ? resolve(window.turnstile) : failed();
      };
      script.onerror = failed;
      document.head.append(script);
    });
  return loading;
}
export function mountChallenge(form, message) {
  if (!turnstileSiteKey) return { response: () => undefined, reset() {}, remove() {} };
  const node = document.createElement('div');
  form.append(node);
  let widget,
    token = '',
    removed = false;
  function mount() {
    load()
      .then((api) => {
        if (removed) return;
        widget = api.render(node, {
          sitekey: turnstileSiteKey,
          size: 'flexible',
          callback: (value) => {
            token = value;
          },
          'expired-callback': () => {
            token = '';
          },
          'error-callback': () => {
            token = '';
            message('Verification is unavailable. Check your connection.');
          },
        });
      })
      .catch((error) => {
        if (!removed) message(error.message);
      });
  }
  mount();
  return {
    response() {
      if (!token) throw new Error('Complete the verification before continuing.');
      return token;
    },
    reset() {
      token = '';
      if (removed) return;
      if (widget !== undefined) window.turnstile.reset(widget);
      else if (!loading) mount();
    },
    remove() {
      removed = true;
      if (widget !== undefined) window.turnstile.remove(widget);
    },
  };
}
