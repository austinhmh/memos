export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("#")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, getUrlBase());
    if (!isAllowedNavigationProtocol(parsed.protocol)) {
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
    if (!isAllowedNavigationProtocol(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

export function sanitizeResourceUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";

  try {
    const parsed = new URL(trimmed, getUrlBase());
    if (!isAllowedResourceProtocol(parsed.protocol)) {
      return "";
    }
    return isAbsoluteUrl(trimmed) ? parsed.toString() : trimmed;
  } catch {
    return "";
  }
}

export function sanitizeExternalResourceUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return "";

  try {
    const parsed = new URL(trimmed);
    if (!isAllowedResourceProtocol(parsed.protocol)) {
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
  if (isSafeImageDataUrl(trimmed)) {
    return trimmed;
  }
  return sanitizeResourceUrl(trimmed);
}

export function sanitizeExternalImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (isSafeImageDataUrl(trimmed)) {
    return trimmed;
  }
  return sanitizeExternalResourceUrl(trimmed);
}

function getUrlBase(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://example.com";
}

function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");
}

function isSafeImageDataUrl(url: string): boolean {
  return /^data:image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif);base64,[a-z0-9+/=]+$/i.test(url);
}

function isAllowedNavigationProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
}

function isAllowedResourceProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}
