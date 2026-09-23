// Browser-site Sign in with Orb, run in the page.
//
// This is the only web sign-in protocol live on MAINNET. It runs in the
// viewer's browser on purpose: the backend rate-limits these endpoints per
// client IP (12 inits and 120 polls a minute), so a server proxy would put
// every viewer behind one shared address. The backend identifies the site by
// the page's Origin header, checked against the manifest this site serves at
// /.well-known/orb-siwo.json, and answers CORS for that origin.
//
// No private key, cookie, Web Storage or server is needed. The result is an
// id token and an access token (~10 minutes); no refresh token is issued.

export const ORB_SIGN_IN_BASE_URL = "https://orbapi.xyz";

const SESSION = /^[0-9a-f]{64}$/;
const DEEP_LINK = /^orbapp:\/\/orb\/approve\?secret=[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_TOKEN_LENGTH = 16_384;
const REQUEST_TIMEOUT_MS = 10_000;
// Stays inside the backend's 30-polls-a-minute per-session limit.
const POLL_INTERVAL_MS = 2_500;
// The first sign-in from a new origin is provisioned; bound the wait.
const PROVISIONING_RETRY_MS = 10_000;
const PROVISIONING_ATTEMPTS = 6;

/** reason: "expired" | "cancelled" | "unavailable" | "provisioning" | "invalid" */
export class SiteSignInError extends Error {
  constructor(message, reason = "unavailable") {
    super(message);
    this.name = "SiteSignInError";
    this.reason = reason;
  }
}

// Transport and server faults (network, 5xx, 429), as opposed to an answer
// the backend meant. Retried while polling.
class TransientFailure extends Error {}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const randomDigest = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

const isToken = (value) =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH;

/**
 * Runs one sign-in attempt.
 *
 * onQr({ qrCode, deepLink, expiresAt }) is called once the approval is ready;
 * onProvisioning() while a new origin is being set up. Resolves with
 * { user_id, idToken, accessToken }; rejects with SiteSignInError.
 */
export async function signInWithOrb({
  onQr,
  onProvisioning = () => {},
  signal,
  baseUrl = ORB_SIGN_IN_BASE_URL,
}) {
  const check = () => {
    if (signal?.aborted) throw new SiteSignInError("Sign-in cancelled.", "cancelled");
  };

  const pause = (ms) =>
    new Promise((resolve, reject) => {
      check();
      const onAbort = () => {
        clearTimeout(timer);
        reject(new SiteSignInError("Sign-in cancelled.", "cancelled"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  async function post(path, body) {
    check();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        body: JSON.stringify(body),
      });
    } catch {
      check();
      throw new TransientFailure("Sign in with Orb is unreachable.");
    }
    check();
    if (response.status >= 500 || response.status === 429) {
      throw new TransientFailure("Sign in with Orb is busy.");
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new TransientFailure("Sign in with Orb is unavailable.");
    }
    if (!response.ok || !isRecord(payload) || payload.status !== "SUCCESS" || !isRecord(payload.data)) {
      // A FAILED init usually means this origin's manifest is missing or wrong.
      const detail = isRecord(payload) && typeof payload.msg === "string" ? ` (${payload.msg})` : "";
      throw new SiteSignInError(`Sign in with Orb is unavailable${detail}.`);
    }
    return payload.data;
  }

  const state = randomDigest();
  const codeVerifier = randomDigest();
  const codeChallenge = await challengeFor(codeVerifier);

  let started = null;
  for (let attempt = 0; attempt < PROVISIONING_ATTEMPTS && !started; attempt += 1) {
    let data;
    try {
      data = await post("/init-site-sign-in", { state, codeChallenge });
    } catch (error) {
      throw error instanceof SiteSignInError
        ? error
        : new SiteSignInError("Sign in with Orb is unavailable.");
    }
    if (data.phase === "PROVISIONING") {
      onProvisioning();
      await pause(PROVISIONING_RETRY_MS);
      continue;
    }
    started = data;
  }
  if (!started) {
    throw new SiteSignInError("Sign in with Orb is still being set up for this site. Try again in a few minutes.", "provisioning");
  }

  // Only a complete, well-formed approval is shown.
  const { phase, session, qrCode, deepLink, expiresAt } = started;
  if (
    phase !== "READY" ||
    typeof session !== "string" || !SESSION.test(session) ||
    typeof deepLink !== "string" || !DEEP_LINK.test(deepLink) ||
    typeof qrCode !== "string" || !qrCode.startsWith("data:image/") ||
    !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()
  ) {
    throw new SiteSignInError("Sign in with Orb returned an invalid approval.");
  }
  onQr({ qrCode, deepLink, expiresAt });

  // Poll for the approval's whole lifetime (~5 minutes), not a shorter client
  // timeout: a late scan still signs the viewer in.
  for (;;) {
    check();
    if (Date.now() >= expiresAt) throw new SiteSignInError("This code expired.", "expired");
    let data;
    try {
      data = await post("/poll-site-sign-in", { session, state, codeVerifier });
    } catch (error) {
      if (error instanceof TransientFailure) {
        await pause(POLL_INTERVAL_MS);
        continue;
      }
      throw error;
    }
    if (data.processed === true) {
      const { source, user_id: userId, idToken, accessToken, refreshToken } = data;
      // A refresh token is never issued by this protocol; reject one.
      if (
        source !== "lens" ||
        typeof userId !== "string" || !ADDRESS.test(userId) ||
        !isToken(idToken) || !isToken(accessToken) ||
        refreshToken !== undefined
      ) {
        throw new SiteSignInError("Sign in with Orb returned invalid credentials.", "invalid");
      }
      return { user_id: userId, idToken, accessToken };
    }
    if (data.processed !== false) {
      throw new SiteSignInError("Sign in with Orb returned an invalid response.");
    }
    await pause(POLL_INTERVAL_MS);
  }
}

/** Expiry (ms) from a JWT's `exp` claim, or null. Not a signature check. */
export function tokenExpiresAt(jwt) {
  try {
    const part = jwt.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
