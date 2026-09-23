import { describe, expect, test } from "bun:test";
import { resolveSiwoOrigin, siwoManifest } from "./siwo-manifest.js";

describe("resolveSiwoOrigin", () => {
  test("accepts an exact https origin", () => {
    expect(resolveSiwoOrigin({ ORB_SIWO_ORIGIN: "https://login.example.com" })).toBe("https://login.example.com");
  });
  test("falls back to the Vercel production domain", () => {
    expect(resolveSiwoOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "qr.example.com" })).toBe("https://qr.example.com");
  });
  test("prefers ORB_SIWO_ORIGIN over the Vercel domain", () => {
    expect(
      resolveSiwoOrigin({ ORB_SIWO_ORIGIN: "https://a.example.com", VERCEL_PROJECT_PRODUCTION_URL: "b.example.com" }),
    ).toBe("https://a.example.com");
  });
  test("is null when unset", () => {
    expect(resolveSiwoOrigin({})).toBeNull();
  });
  test.each(["https://a.example.com/", "https://a.example.com/app", "http://a.example.com", "a.example.com"])(
    "rejects %s",
    (value) => {
      expect(() => resolveSiwoOrigin({ ORB_SIWO_ORIGIN: value })).toThrow();
    },
  );
});

test("manifest carries exactly version and origin", () => {
  expect(JSON.parse(siwoManifest("https://a.example.com"))).toEqual({ version: 1, origin: "https://a.example.com" });
});
