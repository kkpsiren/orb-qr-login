// Build-time opt-in manifest for browser-site Sign in with Orb.
//
// The backend fetches https://<origin>/.well-known/orb-siwo.json before it
// issues a sign-in for that origin, and refuses unless it answers 200
// application/json, under 2KB, with exactly {"version":1,"origin":"<origin>"}
// where origin equals the page's Origin header (scheme + host (+ port), no
// trailing slash).

export const MANIFEST_PATH = ".well-known/orb-siwo.json";

/** The exact https origin this build signs in as, or null when unset. Throws when malformed. */
export function resolveSiwoOrigin(env = process.env) {
  const configured =
    env.ORB_SIWO_ORIGIN ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (!configured) return null;
  let origin;
  try {
    origin = new URL(configured).origin;
  } catch {
    throw new Error(`ORB_SIWO_ORIGIN is not a URL: ${configured}`);
  }
  if (origin !== configured || !origin.startsWith("https://")) {
    throw new Error(
      `ORB_SIWO_ORIGIN must be an exact https origin with no path or trailing slash (got ${configured}, expected e.g. ${origin})`,
    );
  }
  return origin;
}

/** Manifest body with exactly the keys the backend accepts. */
export function siwoManifest(origin) {
  return JSON.stringify({ version: 1, origin });
}

/** Vite plugin: writes dist/.well-known/orb-siwo.json for the configured origin. */
export function siwoManifestPlugin(env = process.env) {
  return {
    name: "orb-siwo-manifest",
    apply: "build",
    generateBundle() {
      const origin = resolveSiwoOrigin(env);
      if (!origin) {
        this.warn(
          "ORB_SIWO_ORIGIN is not set: no /.well-known/orb-siwo.json is emitted and Sign in with Orb will be refused for this build.",
        );
        return;
      }
      this.emitFile({ type: "asset", fileName: MANIFEST_PATH, source: siwoManifest(origin) });
    },
  };
}
