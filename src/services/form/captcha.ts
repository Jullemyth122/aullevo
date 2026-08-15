import { CAPTCHA_SIGNALS, HONEYPOT_KEYWORDS } from "./constants";

/**
 * Detect if an element is a CAPTCHA widget.
 * Checks id, className, name, src, and data-* attributes.
 */
export function isCaptchaField(el: HTMLElement): boolean {
  const haystack = [
    el.id,
    el.className,
    el.getAttribute("name") || "",
    el.getAttribute("src") || "",
    el.getAttribute("data-sitekey") || "",
    el.getAttribute("data-type") || "",
  ]
    .join(" ")
    .toLowerCase();

  return CAPTCHA_SIGNALS.some((s) => haystack.includes(s));
}

/**
 * Scan the entire DOM for CAPTCHA widgets (iframes, divs, scripts).
 * Returns true if any CAPTCHA is found on the page.
 */
export function detectPageCaptcha(): { found: boolean; types: string[] } {
  const types: string[] = [];

  // Google reCAPTCHA
  if (
    document.querySelector(
      '.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]',
    )
  ) {
    types.push("reCAPTCHA");
  }
  // hCaptcha
  if (document.querySelector('.h-captcha, iframe[src*="hcaptcha"]')) {
    types.push("hCaptcha");
  }
  // Cloudflare Turnstile
  if (
    document.querySelector(
      '.cf-turnstile, iframe[src*="challenges.cloudflare"]',
    )
  ) {
    types.push("Turnstile");
  }
  // Arkose / FunCaptcha
  if (
    document.querySelector(
      '[id*="FunCaptcha"], [id*="arkose"], iframe[src*="arkoselabs"]',
    )
  ) {
    types.push("Arkose");
  }
  // Generic: any iframe with captcha in src
  document.querySelectorAll("iframe").forEach((iframe) => {
    const src = (
      iframe.src ||
      iframe.getAttribute("data-src") ||
      ""
    ).toLowerCase();
    if (src.includes("captcha") && !types.includes("Generic")) {
      types.push("Generic CAPTCHA iframe");
    }
  });

  return { found: types.length > 0, types };
}

/**
 * Detect if an element is an invisible honeypot trap field.
 */
export function isHoneypot(element: HTMLElement): boolean {
  if (!element) return false;

  const name = (element.getAttribute("name") || "").toLowerCase();
  const id = (element.id || "").toLowerCase();
  const className = (element.className || "").toLowerCase();
  const autocomplete = (
    element.getAttribute("autocomplete") || ""
  ).toLowerCase();

  const isMatchedKeyword = HONEYPOT_KEYWORDS.some(
    (kw) => name.includes(kw) || id.includes(kw) || className.includes(kw),
  );
  if (isMatchedKeyword) return true;

  if (autocomplete === "nope" || autocomplete === "off-bot") return true;

  const style = window.getComputedStyle(element);
  if (style.position === "absolute") {
    const left = parseInt(style.left || "0", 10);
    const top = parseInt(style.top || "0", 10);
    const zIndex = parseInt(style.zIndex || "0", 10);
    if (
      (left < -100 || top < -100 || zIndex < -100) &&
      (style.opacity === "0" || style.display === "none")
    ) {
      return true;
    }
  }

  return false;
}
