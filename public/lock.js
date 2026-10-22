// App lock: 6-digit PIN (PBKDF2) with optional Face ID / Touch ID via WebAuthn.
//
// Threat model: this protects against someone picking up your *unlocked* phone or laptop. State lives in this
// device's localStorage; the server session is unaffected. A determined attacker with devtools access to an unlocked
// browser profile can bypass it — for that, rely on device encryption/passcode. The biometric assertion is
// verified locally against the stored public key (signature, challenge, origin and user-verification flag).

const KEY = 'bt_lock';
const PIN_LEN = 6;
const ITER = 210_000;
const enc = new TextEncoder();

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hashPin(pin, saltHex, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256));
}
const safeEq = (a, b) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

export const supported = () => !!(window.crypto?.subtle && window.isSecureContext);
export const enabled = () => !!read()?.hash;
export const biometricEnabled = () => !!read()?.bio;
export const getTimeout = () => read()?.timeout ?? 1;
export function setTimeoutMinutes(m) { const s = read(); if (s) write({ ...s, timeout: Number(m) }); }
export async function biometricAvailable() {
  try { return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())); } catch { return false; }
}

// ───────────── WebAuthn (local verification) ─────────────
export function derToRaw(der) {
  const b = new Uint8Array(der);
  let i = 2; // 0x30 len
  if (b[1] & 0x80) i += b[1] & 0x7f;
  const part = () => {
    i++; // 0x02
    const len = b[i++];
    let v = b.slice(i, i + len); i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32); out.set(v, 32 - v.length);
    return out;
  };
  const r = part(), s = part();
  return Uint8Array.from([...r, ...s]);
}

export async function enableBiometric() {
  const s = read();
  if (!s) throw new Error('Set a PIN first');
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Budget Tracker', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'budget', displayName: 'Budget Tracker' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000,
  } });
  const pk = cred.response.getPublicKey?.();
  if (!pk) throw new Error('This browser can’t export the passkey public key');
  write({ ...s, bio: { id: b64u(cred.rawId), pk: b64u(pk) } });
}
export function disableBiometric() { const s = read(); if (s) { const { bio, ...rest } = s; write(rest); } }

async function verifyBiometric() {
  const s = read();
  if (!s?.bio) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const a = await navigator.credentials.get({ publicKey: {
    challenge, rpId: location.hostname, timeout: 60000, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: unb64u(s.bio.id) }],
  } });
  const clientData = JSON.parse(new TextDecoder().decode(a.response.clientDataJSON));
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== b64u(challenge) || clientData.origin !== location.origin) return false;
  const authData = new Uint8Array(a.response.authenticatorData);
  if (!(authData[32] & 0x04)) return false; // user-verified flag
  const hash = await crypto.subtle.digest('SHA-256', a.response.clientDataJSON);
  const signed = new Uint8Array([...authData, ...new Uint8Array(hash)]);
  const key = await crypto.subtle.importKey('spki', unb64u(s.bio.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(a.response.signature), signed);
}

// ───────────── PIN pad overlay ─────────────
let root = null;
function ensureRoot() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'lockscreen';
  root.className = 'lockscreen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.hidden = true;
  document.body.append(root);
  return root;
}

/**
 * Show the pad. `onPin(pin)` resolves true when accepted (pad closes) or a string error (pad shakes + shows it).
 * Resolves true when accepted, false when cancelled.
 */
function pad({ title, sub = '', onPin, cancellable = false, bio = false, onBio }) {
  const el = ensureRoot();
  return new Promise((resolve) => {
    let entry = '', busy = false;
    el.innerHTML = `<div class="lock-inner"><img src="/icons/icon-192.png" alt="" width="56" height="56">
      <h1>${title}</h1><p class="lock-sub" id="lock-sub">${sub}</p>
      <div class="dots" aria-hidden="true">${'<i></i>'.repeat(PIN_LEN)}</div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}" aria-label="${n}">${n}</button>`).join('')}
        ${bio ? '<button type="button" data-k="bio" class="alt" aria-label="Use Face ID or Touch ID">⦿</button>' : cancellable ? '<button type="button" data-k="cancel" class="alt small">Cancel</button>' : '<span></span>'}
        <button type="button" data-k="0" aria-label="0">0</button><button type="button" data-k="del" class="alt" aria-label="Delete">⌫</button></div></div>`;
    el.hidden = false;
    const dots = () => el.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < entry.length));
    const say = (t, bad) => { const s = el.querySelector('#lock-sub'); s.textContent = t; s.classList.toggle('bad', !!bad); };
    const close = (v) => { document.removeEventListener('keydown', onKey); el.hidden = true; el.innerHTML = ''; resolve(v); };
    async function submit() {
      busy = true;
      const r = await onPin(entry);
      busy = false;
      if (r === true) return close(true);
      entry = ''; dots();
      if (r && typeof r === 'object') return say(r.info, false); // neutral prompt, no shake
      el.querySelector('.dots').classList.remove('shake'); void el.offsetWidth; el.querySelector('.dots').classList.add('shake');
      navigator.vibrate?.(60);
      say(r || 'Wrong PIN', true);
    }
    function press(k) {
      if (busy) return;
      if (k === 'del') entry = entry.slice(0, -1);
      else if (k === 'cancel') return close(false);
      else if (k === 'bio') return onBio?.().then((ok) => ok && close(true));
      else if (entry.length < PIN_LEN) entry += k;
      dots();
      if (entry.length === PIN_LEN) submit();
    }
    function onKey(e) {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape' && cancellable) press('cancel');
    }
    el.onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
    document.addEventListener('keydown', onKey);
    if (bio && onBio) onBio().then((ok) => ok && close(true)).catch(() => {}); // try biometrics straight away
  });
}

function throttleMessage() {
  const s = read();
  const wait = (s?.until || 0) - Date.now();
  return wait > 0 ? `Too many attempts. Try again in ${wait > 60000 ? `${Math.ceil(wait / 60000)} min` : `${Math.ceil(wait / 1000)} s`}.` : null;
}

async function checkPin(pin) {
  const msg = throttleMessage();
  if (msg) return msg;
  const s = read();
  if (safeEq(await hashPin(pin, s.salt, s.iter), s.hash)) { write({ ...s, fails: 0, until: 0 }); return true; }
  const fails = (s.fails || 0) + 1;
  // 5 free tries, then 30s, 1m, 2m … capped at 1h.
  const until = fails >= 5 ? Date.now() + Math.min(3600_000, 30_000 * 2 ** (fails - 5)) : 0;
  write({ ...s, fails, until });
  return throttleMessage() || `Wrong PIN · ${5 - fails} ${5 - fails === 1 ? 'try' : 'tries'} left`;
}

let locked = false;
/** Show the lock screen until the user unlocks. */
export async function lock() {
  if (!enabled() || locked) return;
  locked = true;
  document.documentElement.classList.add('is-locked');
  await pad({
    title: 'Budget is locked', sub: 'Enter your PIN', onPin: checkPin,
    bio: biometricEnabled(), onBio: () => verifyBiometric().catch(() => false),
  });
  locked = false;
  document.documentElement.classList.remove('is-locked');
}

/** Ask for the current PIN (e.g. before changing lock settings). Resolves true if correct. */
export function verifyPin(title = 'Enter your PIN') {
  return pad({ title, sub: 'Confirm it’s you', onPin: checkPin, cancellable: true });
}

/** Create or replace the PIN (enter twice). Resolves true when saved. */
export async function setupPin() {
  let first = null;
  const ok = await pad({
    title: 'Choose a PIN', sub: `${PIN_LEN} digits`, cancellable: true,
    onPin: async (pin) => {
      if (first === null) { first = pin; return { info: 'Enter it again' }; }
      if (pin !== first) { first = null; return 'PINs didn’t match — start again'; }
      const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
      const prev = read();
      write({ salt, iter: ITER, hash: await hashPin(pin, salt), timeout: prev?.timeout ?? 1, fails: 0, until: 0 }); // new PIN invalidates old passkey
      return true;
    },
  });
  return ok;
}

export function removeLock() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Re-lock when the app returns from the background after the chosen delay. */
export function watchBackground() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (!enabled()) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (getTimeout() === 0) lock(); // hide content in the app switcher straight away
    } else if (hiddenAt && Date.now() - hiddenAt >= getTimeout() * 60_000) lock();
  });
}
