export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "https://example.com";
    const parsed = new URL(trimmed, base);
    if (!isAllowedUrlProtocol(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function sanitizeExternalUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return "";

  try {
    const parsed = new URL(trimmed);
    if (!isAllowedUrlProtocol(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function sanitizeImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return sanitizeUrl(trimmed);
}

export function sanitizeExternalImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^data:image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return sanitizeExternalUrl(trimmed);
}

function isAllowedUrlProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
}
