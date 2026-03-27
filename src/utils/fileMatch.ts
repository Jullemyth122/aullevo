/**
 * fileMatch.ts
 * ─────────────────────────────────────────────────────────
 * Fuzzy keyword matching between library files and form fields.
 *
 * Strategy:
 * 1. Extract semantic keywords from the filename
 *    (e.g. "Julle_Myth_Vicentillo_Resume.docx" → ["resume"])
 * 2. Extract keywords from field label/name/id/context
 * 3. Bidirectional matching: filename keywords ↔ field keywords
 * 4. Accept-type matching: does the file MIME/extension match the accept attr?
 * 5. Levenshtein fuzzy fallback for near-misses
 * ─────────────────────────────────────────────────────────
 */

import type { FormField } from "../types";

/* ── Stop-words to ignore when extracting keywords ── */
export const IGNORE_WORDS = new Set([
  "upload",
  "file",
  "input",
  "select",
  "choose",
  "add",
  "the",
  "a",
  "an",
  "your",
  "please",
  "here",
  "drag",
  "drop",
  "browse",
  "or",
  "click",
  "attach",
  "new",
  "my",
  "type",
  "format",
  "document",
  "documents",
  "files",
  "field",
]);

/* ── Well-known semantic categories for filenames ── */
const FILE_CATEGORY_KEYWORDS: Record<string, string[]> = {
  resume: ["resume", "cv", "curriculum", "vitae"],
  cover: ["cover", "letter", "coverletter"],
  photo: [
    "photo",
    "picture",
    "avatar",
    "headshot",
    "portrait",
    "profile",
    "selfie",
  ],
  certificate: ["certificate", "cert", "diploma", "license", "licence"],
  transcript: ["transcript", "grades", "academic", "record"],
  id: ["passport", "identification", "national", "drivers", "license"],
  portfolio: ["portfolio", "work", "sample", "project"],
  attachment: ["attachment", "attachments", "other", "misc", "additional"],
};

/* ═══════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════ */

/**
 * Check if a saved file matches a given form field.
 *
 * @param field  Full FormField object (label, name, id, context, accept)
 * @param sf     Saved file object with at least { name, type }
 * @returns      true if the file is a good candidate for this field
 */
export function fileMatchesField(
  field: FormField | string,
  sf: { name: string; type?: string },
  extraKws: string[] = []
): boolean {
  // Support legacy string-only call signature
  if (typeof field === "string") {
    return _legacyLabelMatch(field, sf);
  }

  // 1. Accept-type filtering: if field has accept, file must match
  if (field.accept && sf.type) {
    if (!acceptMatchesFile(field.accept, sf.name, sf.type)) {
      return false;
    }
  }

  // 2. Keyword matching
  let fieldKws = fieldKeywords(field);
  if (extraKws.length > 0) {
    fieldKws = Array.from(new Set([...fieldKws, ...extraKws]));
  }
  const fileKws = fileKeywords(sf.name);

  if (fieldKws.length === 0 && fileKws.length === 0) return false;

  // The user requested strict matching: ONLY if keyword matches.
  // We no longer fallback to just accept type matching if field keywords are empty,
  // since that could inject unrelated files.

  // Direct keyword overlap (bidirectional)
  if (fieldKws.some((kw) => fileKws.includes(kw))) return true;

  // Category overlap: e.g. field says "resume", file tokens contain "cv"
  if (categoryOverlap(fieldKws, fileKws)) return true;

  // Substring matching: field keyword found inside filename or vice versa
  const nameLower = sf.name.toLowerCase();
  if (fieldKws.some((kw) => nameLower.includes(kw))) return true;

  // Levenshtein fuzzy fallback
  if (fuzzyMatch(fieldKws, fileKws)) return true;

  // We DO NOT fallback to just accept type matching if field keywords are empty,
  // since that injects unrelated files into generic fields like */*.
  // The user requested STRICT keyword matching only.
  // Because we now blend in AI semantic field types as extraKws, we don't need the blind fallback.
  return false;
}

/* ═══════════════════════════════════════════════════
   KEYWORD EXTRACTION
   ═══════════════════════════════════════════════════ */

/** Extract semantic keywords from a field's label, name, id, and context */
export function fieldKeywords(field: FormField): string[] {
  const parts = [
    field.label || "",
    field.ariaLabel || "",
    field.context || "",
    field.name || "",
    field.id || "",
    field.placeholder || "",
  ];
  return _tokenize(parts.join(" "));
}

/** Extract semantic keywords from a filename (strip extension) */
export function fileKeywords(filename: string): string[] {
  // Remove extension
  const base = filename.replace(/\.[^.]+$/, "");
  return _tokenize(base);
}

/** Check if a file matches the `accept` attribute of a file input */
export function acceptMatchesFile(
  accept: string,
  fileName: string,
  mimeType: string,
): boolean {
  if (!accept) return true; // No filter means anything goes

  const parts = accept.split(",").map((p) => p.trim().toLowerCase());
  const ext = ("." + fileName.split(".").pop()!).toLowerCase();
  const mime = mimeType.toLowerCase();

  return parts.some((part) => {
    if (part === "*/*") return true;
    if (part.startsWith(".")) return ext === part;
    if (part.endsWith("/*")) return mime.startsWith(part.replace("/*", "/"));
    return mime === part;
  });
}

/* ═══════════════════════════════════════════════════
   MATCHING HELPERS
   ═══════════════════════════════════════════════════ */

/** Check if field keywords and file keywords share a semantic category */
function categoryOverlap(fieldKws: string[], fileKws: string[]): boolean {
  for (const [, synonyms] of Object.entries(FILE_CATEGORY_KEYWORDS)) {
    const fieldHit = fieldKws.some((kw) => synonyms.includes(kw));
    const fileHit = fileKws.some((kw) => synonyms.includes(kw));
    if (fieldHit && fileHit) return true;
  }
  return false;
}

/** Levenshtein fuzzy match between two keyword lists */
function fuzzyMatch(fieldKws: string[], fileKws: string[]): boolean {
  return fieldKws.some((kw) => {
    const maxDist = Math.floor(kw.length / 3); // stricter than /2
    return fileKws.some(
      (token) => getLevenshteinDistance(token, kw) <= maxDist,
    );
  });
}

/** Legacy support: match just a label string (old call signature) */
function _legacyLabelMatch(label: string, sf: { name: string }): boolean {
  const keywords = _tokenize(label);
  if (keywords.length === 0) return false;
  const nameLower = sf.name.toLowerCase();

  // Substring
  if (keywords.some((kw) => nameLower.includes(kw))) return true;

  // Category overlap
  const fileKws = fileKeywords(sf.name);
  if (categoryOverlap(keywords, fileKws)) return true;

  // Fuzzy
  if (fuzzyMatch(keywords, fileKws)) return true;

  return false;
}

/* ═══════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════ */

export function _tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // split camelCase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !IGNORE_WORDS.has(w));
}

export function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Re-export old name for backward compat
export function labelKeywords(label: string): string[] {
  return _tokenize(label);
}
