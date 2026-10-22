// App lock: 6-digit PIN (PBKDF2) with optional Face ID / Touch ID via WebAuthn.
//
// Threat model: this protects against someone picking up your *unlocked* phone or laptop. State lives in this device's
// localStorage and the server session is unaffected. Someone with developer-tools access to an unlocked browser profile
// can bypass it; for that, rely on the device passcode and disk encryption. The biometric assertion is verified locally
// against the stored public key (signature, challenge, origin and the user-verified flag).

const KEY = 'bt_lock'; // same key as the previous version, so existing PINs keep working
export const PIN_LENGTH = 6;
const ITERATIONS = 210_000;
const enc = new TextEncoder();

interface Stored {
  salt: string;
  iter: number;
  hash: string;
  timeout: number;
  fails: number;
  until: number;
  bio?: { id: string; pk: string };
}

const read = (): Stored | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return v?.hash ? v : null;
  } catch {
    return null;
  }
};
const write = (v: Stored) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
};

const toHex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hashPin(pin: string, saltHex: string, iter = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: iter }, key, 256);
  return toHex(bits);
}

function safeEqual(a: string, b: string): boolean {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export const lockSupported = () => !!(window.crypto?.subtle && window.isSecureContext);
export const lockEnabled = () => !!read();
export const biometricEnabled = () => !!read()?.bio;
export const getLockTimeout = () => read()?.timeout ?? 1;
export function setLockTimeout(minutes: number) {
  const s = read();
  if (s) write({ ...s, timeout: minutes });
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch {
    return false;
  }
}

/** Converts a DER-encoded ECDSA signature (what WebAuthn returns) into the raw r||s form WebCrypto verifies. */
export function derToRaw(der: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(der);
  let i = 2;
  if (b[1]! & 0x80) i += b[1]! & 0x7f;
  const part = () => {
    i++;
    const len = b[i++]!;
    let v = b.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part();
  const s = part();
  return Uint8Array.from([...r, ...s]);
}

export async function enableBiometric(): Promise<void> {
  const s = read();
  if (!s) throw new Error('Set a PIN first.');
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Budget', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'budget', displayName: 'Budget' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;
  const response = cred?.response as AuthenticatorAttestationResponse | undefined;
  const pk = response?.getPublicKey?.();
  if (!cred || !pk) throw new Error('This browser cannot export the passkey public key.');
  write({ ...s, bio: { id: b64u(cred.rawId), pk: b64u(pk) } });
}

export function disableBiometric() {
  const s = read();
  if (s) {
    const { bio: _bio, ...rest } = s;
    write(rest);
  }
}

export async function verifyBiometric(): Promise<boolean> {
  const s = read();
  if (!s?.bio) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: unb64u(s.bio.id) }],
    },
  })) as PublicKeyCredential | null;
  const a = cred?.response as AuthenticatorAssertionResponse | undefined;
  if (!a) return false;
  const clientData = JSON.parse(new TextDecoder().decode(a.clientDataJSON)) as { type: string; challenge: string; origin: string };
  if (clientData.type !== 'webauthn.get' || clientData.challenge !== b64u(challenge) || clientData.origin !== location.origin) return false;
  const authData = new Uint8Array(a.authenticatorData);
  if (!(authData[32]! & 0x04)) return false; // user-verified flag
  const hash = await crypto.subtle.digest('SHA-256', a.clientDataJSON);
  const signed = new Uint8Array([...authData, ...new Uint8Array(hash)]);
  const key = await crypto.subtle.importKey('spki', unb64u(s.bio.pk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(a.signature), signed);
}

function throttleMessage(): string | null {
  const wait = (read()?.until ?? 0) - Date.now();
  if (wait <= 0) return null;
  return `Too many attempts. Try again in ${wait > 60_000 ? `${Math.ceil(wait / 60_000)} min` : `${Math.ceil(wait / 1000)} s`}.`;
}

/** true when correct, otherwise a message to show. After 5 wrong tries: 30 s, 1 min, 2 min ... capped at 1 h. */
export async function checkPin(pin: string): Promise<true | string> {
  const locked = throttleMessage();
  if (locked) return locked;
  const s = read();
  if (!s) return 'No PIN is set.';
  if (safeEqual(await hashPin(pin, s.salt, s.iter), s.hash)) {
    write({ ...s, fails: 0, until: 0 });
    return true;
  }
  const fails = s.fails + 1;
  const until = fails >= 5 ? Date.now() + Math.min(3_600_000, 30_000 * 2 ** (fails - 5)) : 0;
  write({ ...s, fails, until });
  const left = 5 - fails;
  return throttleMessage() ?? `Incorrect PIN. ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`;
}

export async function setPin(pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const prev = read();
  // A new PIN invalidates the old passkey binding.
  write({ salt, iter: ITERATIONS, hash: await hashPin(pin, salt), timeout: prev?.timeout ?? 1, fails: 0, until: 0 });
}

export function removeLock() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
