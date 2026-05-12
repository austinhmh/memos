const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const FORBIDDEN_TAGS = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "source", "canvas"]);
const URL_ATTRS = new Set(["href", "xlink:href", "src"]);

function isForbiddenSvgUrl(value: string): boolean {
  const normalized = Array.from(value.trim())
    .filter((char) => char > " " && char.charCodeAt(0) !== 0x7f)
    .join("")
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("#")) return false;
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:")
  ) {
    return false;
  }
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html") ||
    normalized.startsWith("data:application/xhtml") ||
    normalized.startsWith("data:image/svg+xml") ||
    normalized.startsWith("file:")
  );
}

function sanitizeSvgElement(element: Element) {
  const tagName = element.tagName.toLowerCase();
  if (element.namespaceURI !== SVG_NAMESPACE || FORBIDDEN_TAGS.has(tagName)) {
    element.remove();
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase();
    const attrValue = attr.value;
    if (attrName.startsWith("on") || attrName === "srcdoc" || attrName === "formaction" || attrName === "action") {
      element.removeAttribute(attr.name);
      continue;
    }

    if (URL_ATTRS.has(attrName) && isForbiddenSvgUrl(attrValue)) {
      element.removeAttribute(attr.name);
    }
  }

  for (const child of Array.from(element.children)) {
    sanitizeSvgElement(child);
  }
}

export function sanitizeSvg(svg: string): string {
  if (!svg) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) return "";

  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NAMESPACE || root.tagName.toLowerCase() !== "svg") {
    return "";
  }

  sanitizeSvgElement(root);

  const serializer = new XMLSerializer();
  return serializer
    .serializeToString(root)
    .replace(/\sxmlns:NS\d+=""\sNS\d+:/g, " ")
    .replace(/\sxmlns:xlink=""/g, ` xmlns:xlink="${XLINK_NAMESPACE}"`);
}
