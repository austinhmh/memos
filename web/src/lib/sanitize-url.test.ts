import { describe, expect, it } from "vitest";
import {
  sanitizeExternalImageUrl,
  sanitizeExternalResourceUrl,
  sanitizeExternalUrl,
  sanitizeImageUrl,
  sanitizeResourceUrl,
  sanitizeUrl,
} from "./sanitize-url";

describe("sanitizeUrl", () => {
  it("allows http, https, mailto, and anchor URLs", () => {
    expect(sanitizeUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(sanitizeUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(sanitizeUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
    expect(sanitizeUrl("#section-1")).toBe("#section-1");
  });

  it("rejects scriptable or unsupported URL protocols", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBe("");
    expect(sanitizeUrl("vbscript:msgbox(1)")).toBe("");
    expect(sanitizeUrl("data:text/html,<svg onload=alert(1)>")).toBe("");
    expect(sanitizeUrl("file:///etc/passwd")).toBe("");
  });
});

describe("sanitizeExternalUrl", () => {
  it("requires an absolute safe external URL", () => {
    expect(sanitizeExternalUrl("https://example.com/file.pdf")).toBe("https://example.com/file.pdf");
    expect(sanitizeExternalUrl("/file/attachments/local/name.png")).toBe("");
    expect(sanitizeExternalUrl("//example.com/protocol-relative.png")).toBe("");
    expect(sanitizeExternalUrl("#local-anchor")).toBe("");
    expect(sanitizeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });
});

describe("sanitizeResourceUrl", () => {
  it("allows http, https, and relative resource URLs without mailto", () => {
    expect(sanitizeResourceUrl("https://example.com/image.png")).toBe("https://example.com/image.png");
    expect(sanitizeResourceUrl("http://example.com/image.png")).toBe("http://example.com/image.png");
    expect(sanitizeResourceUrl("/file/attachments/local/name.png")).toBe("/file/attachments/local/name.png");
    expect(sanitizeResourceUrl("mailto:test@example.com")).toBe("");
    expect(sanitizeExternalResourceUrl("mailto:test@example.com")).toBe("");
  });
});

describe("sanitizeImageUrl", () => {
  it("allows safe image data URLs only for image contexts", () => {
    const dataImage = "data:image/png;base64,aGVsbG8=";
    expect(sanitizeImageUrl(dataImage)).toBe(dataImage);
    expect(sanitizeExternalImageUrl(dataImage)).toBe(dataImage);
    expect(sanitizeImageUrl("data:text/html,<script>alert(1)</script>")).toBe("");
  });

  it("rejects mailto and SVG image URLs", () => {
    expect(sanitizeImageUrl("mailto:test@example.com")).toBe("");
    expect(sanitizeExternalImageUrl("mailto:test@example.com")).toBe("");
    expect(sanitizeImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")).toBe("");
  });
});
