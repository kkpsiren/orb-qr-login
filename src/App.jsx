import React, { useReducer, useRef, useState } from "react";
import {
  createQrInitRequest,
  createQrPollRequest,
  parseQrInitResponse,
  parseQrPollResponse,
} from "@orbclub/modules/auth/qr";

const DEFAULT_CREDENTIAL_SCOPE = "id";
const DEFAULT_ORB_QR_INIT_URL = "https://orbapi.xyz/init-sign-in";
const DEFAULT_ORB_QR_POLL_URL = "https://orbapi.xyz/poll-sign-in";
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const CREDENTIAL_SCOPE_OPTIONS = [
  {
    value: "id",
    label: "ID token only",
    description: "Ask Orb only for identity.",
  },
  {
    value: "id_access",
    label: "ID + access",
    description: "Ask for identity and an app access token.",
  },
  {
    value: "id_access_refresh",
    label: "ID + access + refresh",
    description: "Ask for identity plus access and refresh tokens.",
  },
];

export default function App() {
  const [state, dispatch] = useReducer(
    qrLoginReducer,
    undefined,
    createInitialLoginState,
  );
  const [credentialScope, setCredentialScope] = useState(
    DEFAULT_CREDENTIAL_SCOPE,
  );
  const [sessionScope, setSessionScope] = useState(DEFAULT_CREDENTIAL_SCOPE);
  const activeController = useRef(null);

  async function startLogin() {
    activeController.current?.abort();

    const requestedScope = credentialScope;
    const controller = new AbortController();
    activeController.current = controller;
    dispatch({ type: "start" });

    try {
      const session = await connectWithCredentialScope({
        credentials: requestedScope,
        signal: controller.signal,
        onInit: ({ qrCode, deepLink }) => {
          dispatch({ type: "init", payload: { qrCode, deepLink } });
        },
      });

      if (!controller.signal.aborted) {
        setSessionScope(requestedScope);
        dispatch({ type: "success", payload: session });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "error", error });
      }
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
      }
    }
  }

  function resetLogin() {
    activeController.current?.abort();
    activeController.current = null;
    dispatch({ type: "reset" });
  }

  const canStart = state.status === "idle" || state.status === "error";
  const isConnecting = state.status === "connecting";
  const showStart = canStart && !state.session;
  const showQr = isConnecting || Boolean(state.qrCode);
  const showStatus = state.status !== "idle";
  const appClassName = state.session
    ? "app-shell with-session"
    : "app-shell single-panel";

  return (
    <main className={appClassName}>
      <section className="login-panel" aria-labelledby="page-title">
        <div className="heading-row">
          <div>
            <p className="eyebrow">Dummy client</p>
            <h1 id="page-title">Orb QR Login</h1>
          </div>
          {showStatus ? (
            <span className={`status-pill status-${state.status}`}>
              {state.status}
            </span>
          ) : null}
        </div>

        {showStart ? (
          <fieldset className="scope-picker">
            <legend>Request</legend>
            {CREDENTIAL_SCOPE_OPTIONS.map((option) => (
              <label
                className="scope-option"
                key={option.value}
                htmlFor={`scope-${option.value}`}
              >
                <input
                  checked={credentialScope === option.value}
                  id={`scope-${option.value}`}
                  name="credential-scope"
                  onChange={() => setCredentialScope(option.value)}
                  type="radio"
                  value={option.value}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {showQr ? (
          <div className="qr-stage" aria-live="polite">
            {state.qrCode ? (
              <img className="qr-image" src={state.qrCode} alt="Orb login QR" />
            ) : (
              <div className="qr-placeholder" aria-hidden="true">
                QR
              </div>
            )}
          </div>
        ) : null}

        {state.status !== "idle" ? (
          <p className="state-message">{state.message}</p>
        ) : null}

        {state.error ? <p className="error-message">{state.error}</p> : null}

        <div className="actions">
          {canStart ? (
            <button type="button" className="primary-action" onClick={startLogin}>
              Start QR login
            </button>
          ) : null}

          {isConnecting ? (
            <button type="button" className="secondary-action" onClick={resetLogin}>
              Cancel
            </button>
          ) : null}

          {state.deepLink ? (
            <a className="secondary-action action-link" href={state.deepLink}>
              Open Orb
            </a>
          ) : null}

          {state.status === "authenticated" ? (
            <button type="button" className="secondary-action" onClick={resetLogin}>
              Start over
            </button>
          ) : null}
        </div>
      </section>

      {state.session ? (
        <section className="session-panel" aria-labelledby="session-title">
          <h2 id="session-title">Session</h2>
          <dl className="session-list">
            {summarizeSession(state.session, sessionScope).map(([label, value]) => (
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

async function connectWithCredentialScope({ credentials, signal, onInit }) {
  throwIfAborted(signal);

  const initRequest = createQrInitRequest({
    endpoint: DEFAULT_ORB_QR_INIT_URL,
    credentials,
  });
  const initPayload = parseQrInitResponse(
    await fetchJson(initRequest.url, initRequest.init, signal),
  );

  onInit?.({ qrCode: initPayload.qrCode, deepLink: initPayload.deepLink });

  while (true) {
    throwIfAborted(signal);

    const pollRequest = createQrPollRequest({
      endpoint: DEFAULT_ORB_QR_POLL_URL,
      secret: initPayload.secret,
    });
    const pollPayload = parseQrPollResponse(
      await fetchJson(pollRequest.url, pollRequest.init, signal),
    );

    if (requiredTokenReceived(pollPayload, credentials)) {
      return pollPayload;
    }

    if (pollPayload.status === "FAILED") {
      throw new Error("QR login failed.");
    }

    if (pollPayload.processed === true) {
      throw new Error("QR login completed without the requested credentials.");
    }

    await delay(DEFAULT_POLL_INTERVAL_MS, signal);
  }
}

function createInitialLoginState() {
  return {
    status: "idle",
    message: "Ready to start QR login.",
  };
}

function qrLoginReducer(state, action) {
  switch (action.type) {
    case "start":
      return {
        status: "connecting",
        message: "Preparing Orb QR login...",
      };
    case "init":
      return {
        ...state,
        status: "connecting",
        message: "Scan with Orb to approve this login.",
        qrCode: action.payload.qrCode,
        deepLink: action.payload.deepLink,
        error: undefined,
      };
    case "success":
      return {
        ...state,
        status: "authenticated",
        message: "QR login approved.",
        session: action.payload,
        error: undefined,
      };
    case "error":
      return {
        ...state,
        status: "error",
        message: "QR login failed.",
        error: getErrorMessage(action.error),
      };
    case "reset":
      return createInitialLoginState();
    default:
      return state;
  }
}

function summarizeSession(session, scope) {
  const rows = [["ID token", session.idToken ?? "Not returned"]];

  if (scope === "id_access" || scope === "id_access_refresh") {
    rows.push(["Access token", session.accessToken ?? "Not returned"]);
  }

  if (scope === "id_access_refresh") {
    rows.push(["Refresh token", session.refreshToken ?? "Not returned"]);
  }

  if (session.authenticationId) {
    rows.push(["Authentication ID", session.authenticationId]);
  }

  return rows;
}

function requiredTokenReceived(session, scope) {
  if (session.processed !== true || !isNonBlankString(session.idToken)) {
    return false;
  }

  if (scope === "id_access") {
    return isNonBlankString(session.accessToken);
  }

  if (scope === "id_access_refresh") {
    return (
      isNonBlankString(session.accessToken) &&
      isNonBlankString(session.refreshToken)
    );
  }

  return true;
}

async function fetchJson(input, init, signal) {
  throwIfAborted(signal);

  const response = await fetch(input, { ...init, signal });
  if (!response.ok) {
    throw new Error(`QR request failed (${response.status}).`);
  }

  return await response.json();
}

async function delay(ms, signal) {
  await new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(new Error("QR login was cancelled."));
    };

    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Unknown QR login error";
}

function isNonBlankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new Error("QR login was cancelled.");
  }
}
