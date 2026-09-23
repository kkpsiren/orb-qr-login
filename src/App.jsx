import React, { useEffect, useReducer, useRef, useState } from "react";
import { SiteSignInError, signInWithOrb, tokenExpiresAt } from "./siwo-browser.js";

// The protocol issues no refresh token and the access token lives about ten
// minutes. If the token carries no readable `exp`, assume that lifetime.
const FALLBACK_SESSION_MS = 10 * 60 * 1000;

export default function App() {
  const [state, dispatch] = useReducer(loginReducer, undefined, createInitialLoginState);
  const activeController = useRef(null);
  const isTouch = useCoarsePointer();

  // End the session when its access token does; never show a dead token as signed in.
  useEffect(() => {
    const expiresAt = state.session?.expiresAt;
    if (!expiresAt) return undefined;
    const expireIfDue = () => {
      if (Date.now() >= expiresAt) dispatch({ type: "expired" });
    };
    const timer = setTimeout(expireIfDue, Math.min(Math.max(0, expiresAt - Date.now()), 2_147_483_647));
    // Background tabs throttle timers; check again when the tab returns.
    document.addEventListener("visibilitychange", expireIfDue);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", expireIfDue);
    };
  }, [state.session?.expiresAt]);

  useEffect(() => () => activeController.current?.abort(), []);

  async function startLogin() {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    dispatch({ type: "start" });

    try {
      const credentials = await signInWithOrb({
        signal: controller.signal,
        onProvisioning: () => dispatch({ type: "provisioning" }),
        onQr: ({ qrCode, deepLink, expiresAt }) =>
          dispatch({ type: "qr", payload: { qrCode, deepLink, expiresAt } }),
      });
      if (controller.signal.aborted) return;
      const expiresAt = tokenExpiresAt(credentials.accessToken) ?? Date.now() + FALLBACK_SESSION_MS;
      if (expiresAt <= Date.now()) throw new SiteSignInError("The access token is already expired.", "invalid");
      dispatch({ type: "success", payload: { ...credentials, expiresAt } });
    } catch (error) {
      if (!controller.signal.aborted) dispatch({ type: "error", error });
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }

  function resetLogin() {
    activeController.current?.abort();
    activeController.current = null;
    dispatch({ type: "reset" });
  }

  const canStart = state.status === "idle" || state.status === "error" || state.status === "expired";
  const isConnecting = state.status === "connecting";
  const appClassName = state.session ? "app-shell with-session" : "app-shell single-panel";

  return (
    <main className={appClassName}>
      <section className="login-panel" aria-labelledby="page-title">
        <div className="heading-row">
          <div>
            <p className="eyebrow">Dummy client</p>
            <h1 id="page-title">Sign in with Orb</h1>
          </div>
          {state.status !== "idle" ? (
            <span className={`status-pill status-${state.status}`}>{state.status}</span>
          ) : null}
        </div>

        {isConnecting ? (
          <div className="qr-stage" aria-live="polite">
            {state.qrCode ? (
              <img className="qr-image" src={state.qrCode} alt="Scan with the Orb app to sign in" />
            ) : (
              <div className="qr-placeholder" aria-hidden="true">QR</div>
            )}
          </div>
        ) : null}

        {state.status !== "idle" ? <p className="state-message">{state.message}</p> : null}
        {state.error ? <p className="error-message">{state.error}</p> : null}

        <div className="actions">
          {canStart ? (
            <button type="button" className="primary-action" onClick={startLogin}>
              {state.status === "idle" ? "Sign in with Orb" : "Get a new code"}
            </button>
          ) : null}

          {isConnecting ? (
            <button type="button" className="secondary-action" onClick={resetLogin}>Cancel</button>
          ) : null}

          {/* A phone cannot scan its own screen: offer the deep link on touch devices. */}
          {isConnecting && state.deepLink && isTouch ? (
            <a className="secondary-action action-link" href={state.deepLink}>Open Orb app</a>
          ) : null}

          {state.status === "authenticated" ? (
            <button type="button" className="secondary-action" onClick={resetLogin}>Sign out</button>
          ) : null}
        </div>
      </section>

      {state.session ? (
        <section className="session-panel" aria-labelledby="session-title">
          <h2 id="session-title">Session</h2>
          <dl className="session-list">
            {[
              ["Account", state.session.user_id],
              ["Expires", new Date(state.session.expiresAt).toLocaleTimeString()],
              ["ID token", state.session.idToken],
              ["Access token", state.session.accessToken],
            ].map(([label, value]) => (
              <div className="session-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </main>
  );
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return coarse;
}

function createInitialLoginState() {
  return { status: "idle", message: "Ready to sign in." };
}

function loginReducer(state, action) {
  switch (action.type) {
    case "start":
      return { status: "connecting", message: "Preparing sign-in..." };
    case "provisioning":
      return {
        status: "connecting",
        message: "Setting up Sign in with Orb for this site (first use can take a few minutes)...",
      };
    case "qr":
      return {
        status: "connecting",
        message: "Scan with the Orb app to approve this sign-in.",
        qrCode: action.payload.qrCode,
        deepLink: action.payload.deepLink,
      };
    case "success":
      return { status: "authenticated", message: "Signed in.", session: action.payload };
    case "expired":
      return { status: "expired", message: "Your session expired. Sign in again." };
    case "error":
      return {
        status: "error",
        message:
          action.error instanceof SiteSignInError && action.error.reason === "expired"
            ? "This code expired."
            : "Sign-in failed.",
        error: getErrorMessage(action.error),
      };
    case "reset":
      return createInitialLoginState();
    default:
      return state;
  }
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown sign-in error";
}
