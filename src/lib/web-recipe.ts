import { extractMeta, extractTitleTag } from "@/lib/og";

export type TandoorIngredient = {
  food: { name: string };
  unit: { name: string } | null;
  amount: number;
  note: string;
};

export type TandoorRecipe = {
  name: string;
  servings: number;
  steps: { instruction: string; ingredients: TandoorIngredient[] }[];
};

export type ExtractedRecipe = {
  structured: TandoorRecipe | null; // set when JSON-LD Recipe found
  text: string; // readable page text for AI fallback
  imageUrl: string | null; // best thumbnail candidate (absolute URL)
};

// ---------------------------------------------------------------------------
// Entity decoding + URL resolution
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function resolveUrl(candidate: string, base: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  try {
    // Protocol-relative (//host/path) and relative URLs both handled by URL().
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON-LD parsing
// ---------------------------------------------------------------------------

function collectJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed blocks; a single bad one shouldn't sink extraction.
    }
  }
  return blocks;
}

function typeMatchesRecipe(type: unknown): boolean {
  if (typeof type === "string") return type === "Recipe";
  if (Array.isArray(type)) return type.some((t) => t === "Recipe");
  return false;
}

function findRecipeNode(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeMatchesRecipe(obj["@type"])) return obj;
    if (Array.isArray(obj["@graph"])) {
      const found = findRecipeNode(obj["@graph"]);
      if (found) return found;
    }
  }
  return null;
}

function parseServings(recipeYield: unknown): number {
  const candidates = Array.isArray(recipeYield) ? recipeYield : [recipeYield];
  for (const c of candidates) {
    const str = typeof c === "number" ? String(c) : typeof c === "string" ? c : "";
    const m = str.match(/\d+/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n > 0) return n;
    }
  }
  return 1;
}

function parseInstructions(
  instructions: unknown
): { instruction: string }[] {
  const out: { instruction: string }[] = [];
  const push = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) out.push({ instruction: trimmed });
  };
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      // HowToSection wraps itemListElement of HowToStep.
      if (Array.isArray(obj.itemListElement)) {
        walk(obj.itemListElement);
      } else if (typeof obj.text === "string") {
        push(obj.text);
      }
    }
  };
  walk(instructions);
  return out;
}

// Lenient ingredient parse: pull a leading amount + optional short unit, keep
// the rest as the food name. Free-text is acceptable — Tandoor tolerates loose
// ingredients, so on any doubt the whole line becomes the food name.
export function parseIngredient(line: string): TandoorIngredient {
  const text = line.trim();
  const m = text.match(/^([\d]+(?:[.,/]\d+)?)\s*([a-zA-Z%µ.]{1,5})?\s+(.+)$/);
  if (m) {
    const amount = parseFloat(m[1].replace(",", ".").replace(/\/.*/, ""));
    const unit = m[2] ? { name: m[2] } : null;
    return {
      food: { name: m[3].trim() },
      unit,
      amount: Number.isFinite(amount) ? amount : 0,
      note: "",
    };
  }
  return { food: { name: text }, unit: null, amount: 0, note: "" };
}

function mapRecipeNode(node: Record<string, unknown>): TandoorRecipe {
  const name =
    typeof node.name === "string" && node.name.trim() ? node.name.trim() : "Recipe";

  const ingredientLines = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient.filter((i): i is string => typeof i === "string")
    : [];
  const ingredients = ingredientLines
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIngredient);

  const instructions = parseInstructions(node.recipeInstructions);
  const steps =
    instructions.length > 0
      ? instructions.map((s) => ({ instruction: s.instruction, ingredients: [] as TandoorIngredient[] }))
      : [{ instruction: "", ingredients: [] as TandoorIngredient[] }];
  // All ingredients live on the first step (single ingredient list per recipe).
  steps[0].ingredients = ingredients;

  return {
    name,
    servings: parseServings(node.recipeYield),
    steps,
  };
}

function jsonLdImageUrl(node: Record<string, unknown>, base: string): string | null {
  const pick = (img: unknown): string | null => {
    if (typeof img === "string") return resolveUrl(img, base);
    if (Array.isArray(img)) {
      for (const it of img) {
        const r = pick(it);
        if (r) return r;
      }
      return null;
    }
    if (img && typeof img === "object") {
      const url = (img as Record<string, unknown>).url;
      if (typeof url === "string") return resolveUrl(url, base);
    }
    return null;
  };
  return pick(node.image);
}

// ---------------------------------------------------------------------------
// Readable text extraction (AI fallback)
// ---------------------------------------------------------------------------

export function extractReadableText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Image picker
// ---------------------------------------------------------------------------

const IMAGE_EXT = /\.(jpe?g|webp|png)(?:[?#]|$)/i;
const EXCLUDE_HOST = /(amzn\.to|amazon\.|awin1\.com|doubleclick|googlesyndication)/i;
const EXCLUDE_NAME = /(logo|icon|sprite|avatar|badge|favicon)/i;

type ImgCandidate = { url: string; width: number };

function declaredWidth(url: string, srcsetWidth?: number): number {
  if (srcsetWidth) return srcsetWidth;
  const m = url.match(/[?&]width=(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function collectImgCandidates(html: string, base: string): ImgCandidate[] {
  const out: ImgCandidate[] = [];
  const add = (raw: string, srcsetWidth?: number) => {
    const decoded = decodeEntities(raw);
    const abs = resolveUrl(decoded, base);
    if (!abs) return;
    out.push({ url: abs, width: declaredWidth(abs, srcsetWidth) });
  };

  const imgRe = /<img\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = imgRe.exec(html)) !== null) {
    const t = tag[0];
    const src = t.match(/\ssrc=["']([^"']+)["']/i);
    if (src) add(src[1]);
    const dataSrc = t.match(/\sdata-src=["']([^"']+)["']/i);
    if (dataSrc) add(dataSrc[1]);
    const srcset = t.match(/\ssrcset=["']([^"']+)["']/i);
    if (srcset) {
      for (const entry of srcset[1].split(",")) {
        const parts = entry.trim().split(/\s+/);
        if (!parts[0]) continue;
        const w = parts[1]?.match(/^(\d+)w$/);
        add(parts[0], w ? parseInt(w[1], 10) : undefined);
      }
    }
  }
  return out;
}

function scoreCandidate(c: ImgCandidate): number {
  if (!IMAGE_EXT.test(c.url)) return -1;
  if (/\.svg(?:[?#]|$)/i.test(c.url)) return -1;
  if (EXCLUDE_HOST.test(c.url)) return -1;
  if (EXCLUDE_NAME.test(c.url)) return -1;
  if (c.width && c.width < 200) return -1;
  let score = c.width || 100; // undeclared width: neutral baseline
  if (/preview_images/i.test(c.url)) score += 10000; // Shopify recipe poster
  return score;
}

function pickBestContentImage(html: string, base: string): string | null {
  const candidates = collectImgCandidates(html, base);
  let best: { url: string; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreCandidate(c);
    if (score < 0) continue;
    if (!best || score > best.score) best = { url: c.url, score };
  }
  return best?.url ?? null;
}

function pickImage(
  base: string,
  html: string,
  jsonLdImage: string | null
): string | null {
  if (jsonLdImage) return jsonLdImage;
  const content = pickBestContentImage(html, base);
  if (content) return content;
  const og = extractMeta(html, "og:image");
  return og ? resolveUrl(og, base) : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function extractRecipeFromHtml(url: string, html: string): ExtractedRecipe {
  const blocks = collectJsonLdBlocks(html);
  let structured: TandoorRecipe | null = null;
  let jsonLdImage: string | null = null;

  for (const block of blocks) {
    const node = findRecipeNode(block);
    if (node) {
      structured = mapRecipeNode(node);
      jsonLdImage = jsonLdImageUrl(node, url);
      break;
    }
  }

  const text = structured ? "" : buildAiText(html);

  return {
    structured,
    text,
    imageUrl: pickImage(url, html, jsonLdImage),
  };
}

function buildAiText(html: string): string {
  const title = extractTitleTag(html);
  const body = extractReadableText(html);
  return title ? `${title}\n\n${body}` : body;
}
