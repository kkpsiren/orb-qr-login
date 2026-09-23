import { afterEach, describe, expect, test } from "bun:test";
import { SiteSignInError, signInWithOrb, tokenExpiresAt } from "./siwo-browser.js";

const HEX = "a".repeat(64);
const READY = {
  phase: "READY",
  session: HEX,
  qrCode: "data:image/png;base64,AAAA",
  deepLink: `orbapp://orb/approve?secret=${HEX}`,
  expiresAt: Date.now() + 60_000,
};
const TOKENS = { processed: true, source: "lens", user_id: `0x${"1".repeat(40)}`, idToken: "id", accessToken: "access" };

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

// Scripted backend; pauses resolve immediately.
function script(responses) {
  const calls = [];
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    const [status, payload] = next;
    return new Response(JSON.stringify(payload), { status });
  };
  return calls;
}

describe("signInWithOrb", () => {
  test("runs init then polls until approved", async () => {
    const calls = script([
      [200, { status: "SUCCESS", data: { phase: "PROVISIONING", retryAfterMs: 10_000 } }],
      [200, { status: "SUCCESS", data: READY }],
      [200, { status: "SUCCESS", data: { processed: false } }],
      [503, {}],
      new TypeError("network"),
      [200, { status: "SUCCESS", data: TOKENS }],
    ]);
    let qr, provisioning = 0;
    const result = await signInWithOrb({ onQr: (value) => (qr = value), onProvisioning: () => provisioning++ });
    expect(result).toEqual({ user_id: TOKENS.user_id, idToken: "id", accessToken: "access" });
    expect(provisioning).toBe(1);
    expect(qr).toEqual({ qrCode: READY.qrCode, deepLink: READY.deepLink, expiresAt: READY.expiresAt });
    expect(calls[0].url).toBe("https://orbapi.xyz/init-site-sign-in");
    expect(calls[0].init).toMatchObject({ method: "POST", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    const { state, codeChallenge } = calls[0].body;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const poll = calls[2];
    expect(poll.url).toBe("https://orbapi.xyz/poll-site-sign-in");
    expect(poll.body.session).toBe(HEX);
    expect(poll.body.state).toBe(state);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(poll.body.codeVerifier)));
    expect(Buffer.from(digest).toString("base64url")).toBe(codeChallenge);
  });

  test("a FAILED init is unavailable", async () => {
    script([[200, { status: "FAILED", msg: "Site sign-in is unavailable" }]]);
    const error = await signInWithOrb({ onQr: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(SiteSignInError);
    expect(error.reason).toBe("unavailable");
  });

  test("rejects a malformed approval", async () => {
    script([[200, { status: "SUCCESS", data: { ...READY, deepLink: "https://evil.example" } }]]);
    await expect(signInWithOrb({ onQr: () => {} })).rejects.toBeInstanceOf(SiteSignInError);
  });

  test("rejects credentials carrying a refresh token", async () => {
    script([
      [200, { status: "SUCCESS", data: READY }],
      [200, { status: "SUCCESS", data: { ...TOKENS, refreshToken: "r" } }],
    ]);
    const error = await signInWithOrb({ onQr: () => {} }).catch((e) => e);
    expect(error.reason).toBe("invalid");
  });

  test("gives up after bounded provisioning", async () => {
    script(Array.from({ length: 6 }, () => [200, { status: "SUCCESS", data: { phase: "PROVISIONING" } }]));
    const error = await signInWithOrb({ onQr: () => {} }).catch((e) => e);
    expect(error.reason).toBe("provisioning");
  });

  test("stops when cancelled", async () => {
    const controller = new AbortController();
    script([[200, { status: "SUCCESS", data: READY }], [200, { status: "SUCCESS", data: { processed: false } }]]);
    const error = await signInWithOrb({ signal: controller.signal, onQr: () => controller.abort() }).catch((e) => e);
    expect(error.reason).toBe("cancelled");
  });
});

test("tokenExpiresAt reads the JWT exp claim", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_900_000_000 })).toString("base64url");
  expect(tokenExpiresAt(`h.${payload}.s`)).toBe(1_900_000_000_000);
  expect(tokenExpiresAt("garbage")).toBeNull();
});
