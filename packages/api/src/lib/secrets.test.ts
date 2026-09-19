import { describe, it, expect } from "vitest";
import { createSecretBox, secretHint } from "./secrets";

describe("createSecretBox", () => {
  it("round-trips a value", () => {
    const box = createSecretBox("test-secret");
    const ciphertext = box.encrypt("sk-ant-very-secret");
    expect(ciphertext).not.toContain("sk-ant");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(box.decrypt(ciphertext)).toBe("sk-ant-very-secret");
  });

  it("produces a different ciphertext each time", () => {
    const box = createSecretBox("test-secret");
    expect(box.encrypt("same")).not.toBe(box.encrypt("same"));
  });

  it("refuses a value encrypted under another secret", () => {
    const ciphertext = createSecretBox("one").encrypt("value");
    expect(() => createSecretBox("two").decrypt(ciphertext)).toThrow();
  });

  it("refuses a tampered value", () => {
    const box = createSecretBox("test-secret");
    const ciphertext = box.encrypt("value");
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith("A") ? "BB" : "AA");
    expect(() => box.decrypt(tampered)).toThrow();
    expect(() => box.decrypt("garbage")).toThrow("Unrecognized secret format");
  });
});

describe("secretHint", () => {
  it("shows only the tail of a key", () => {
    expect(secretHint("sk-ant-api03-abcdef")).toBe("…cdef");
    expect(secretHint("abc")).toBe("•••");
  });
});
