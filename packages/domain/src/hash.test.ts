import { describe, expect, it } from "vitest";
import { hmacSha256Hex, sha256Hex } from "./hash.js";

describe("browser-safe SHA-256", () => {
  it("matches the standard empty-string vector", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes UTF-8 input deterministically", () => {
    expect(sha256Hex("maestro é")).toBe("faac73aa1e42e87c866c71f3d66a68a5d80ab6802567a4203ca6d3f12842028e");
  });

  it("matches the standard HMAC-SHA-256 vector", () => {
    expect(hmacSha256Hex("The quick brown fox jumps over the lazy dog", "key")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
});
