const APPLE_FLAG_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/";
const REGIONAL_INDICATOR_START = 0x1f1e6;
const REGIONAL_INDICATOR_END = 0x1f1ff;

function isRegionalIndicatorCodePoint(codePoint: number): boolean {
  return (
    codePoint >= REGIONAL_INDICATOR_START &&
    codePoint <= REGIONAL_INDICATOR_END
  );
}

export function isRegionalIndicatorFlag(value: string): boolean {
  const codePoints = Array.from(value.trim()).map(
    (char) => char.codePointAt(0) ?? 0,
  );
  return (
    codePoints.length === 2 &&
    codePoints.every(isRegionalIndicatorCodePoint)
  );
}

export function emojiToUnified(value: string): string {
  return Array.from(value.trim())
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter((part): part is string => Boolean(part))
    .join("-");
}

export function isFlagUnified(unified: string): boolean {
  const codePoints = unified
    .toLowerCase()
    .split("-")
    .map((part) => Number.parseInt(part, 16));
  return (
    codePoints.length === 2 &&
    codePoints.every((codePoint) =>
      Number.isFinite(codePoint) && isRegionalIndicatorCodePoint(codePoint),
    )
  );
}

export function appleFlagEmojiUrlFromUnified(unified: string): string | null {
  const normalized = unified.toLowerCase();
  return isFlagUnified(normalized) ? `${APPLE_FLAG_CDN_BASE}${normalized}.png` : null;
}

export function appleFlagEmojiUrlFromEmoji(value: string): string | null {
  if (!isRegionalIndicatorFlag(value)) return null;
  return appleFlagEmojiUrlFromUnified(emojiToUnified(value));
}

function createAppleFlagImage(url: string, fallbackText: string) {
  const img = document.createElement("img");
  img.src = url;
  img.alt = fallbackText;
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  img.style.display = "block";
  img.style.objectFit = "contain";
  return img;
}

function replaceFlagNode(
  element: HTMLElement,
  unified: string,
  url: string,
  sizing: "button" | "inline",
) {
  const existing = element.querySelector<HTMLImageElement>(
    "img[data-aebox-flag-emoji-img]",
  );
  if (element.dataset.aeboxFlagEmoji === unified && existing?.src === url) return;

  const fallbackText = element.textContent ?? "";
  const img = createAppleFlagImage(url, fallbackText);
  img.dataset.aeboxFlagEmojiImg = "apple";
  if (sizing === "button") {
    img.style.width = "var(--epr-emoji-fullsize)";
    img.style.height = "var(--epr-emoji-fullsize)";
    img.style.maxWidth = "var(--epr-emoji-fullsize)";
    img.style.maxHeight = "var(--epr-emoji-fullsize)";
    img.style.minWidth = "var(--epr-emoji-fullsize)";
    img.style.minHeight = "var(--epr-emoji-fullsize)";
    img.style.padding = "var(--epr-emoji-padding)";
  } else {
    img.style.width = "1em";
    img.style.height = "1em";
  }

  img.onerror = () => {
    element.dataset.aeboxFlagEmoji = "failed";
    element.textContent = fallbackText;
  };

  element.dataset.aeboxFlagEmoji = unified;
  element.textContent = "";
  element.style.display = "inline-flex";
  element.style.alignItems = "center";
  element.style.justifyContent = "center";
  element.appendChild(img);
}

export function replaceNativeFlagEmojiImages(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("button[data-unified]").forEach((button) => {
    const unified = button.dataset.unified;
    const url = unified ? appleFlagEmojiUrlFromUnified(unified) : null;
    if (!url || !unified) return;
    replaceFlagNode(button, unified, url, "button");
  });

  root
    .querySelectorAll<HTMLElement>(".epr-emoji-native[data-unified]")
    .forEach((element) => {
      if (element.closest("button[data-aebox-flag-emoji]")) return;
      const unified = element.dataset.unified;
      const url = unified ? appleFlagEmojiUrlFromUnified(unified) : null;
      if (!url || !unified) return;
      replaceFlagNode(element, unified, url, "inline");
    });
}
