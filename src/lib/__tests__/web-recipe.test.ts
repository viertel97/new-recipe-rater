import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractRecipeFromHtml,
  parseIngredient,
  extractReadableText,
} from "@/lib/web-recipe";

const FIXTURES = path.resolve(__dirname, "fixtures");
const jsonLdHtml = readFileSync(path.join(FIXTURES, "jsonld-recipe.html"), "utf8");
const veganHtml = readFileSync(path.join(FIXTURES, "vegan-high-protein.html"), "utf8");

const VEGAN_URL =
  "https://vegan-high-protein.de/blogs/rezepte/smashed-potato-doner-salat-1";

describe("extractRecipeFromHtml — JSON-LD mapping", () => {
  const result = extractRecipeFromHtml("https://example.com/recipe", jsonLdHtml);

  it("maps name from an @graph Recipe node", () => {
    expect(result.structured?.name).toBe("Chickpea Curry");
  });

  it("maps servings from recipeYield", () => {
    expect(result.structured?.servings).toBe(4);
  });

  it("maps HowToStep instructions into steps", () => {
    const steps = result.structured!.steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].instruction).toBe("Chop the onions.");
    expect(steps[1].instruction).toContain("Simmer");
  });

  it("attaches all ingredients to the first step", () => {
    const ingredients = result.structured!.steps[0].ingredients;
    expect(ingredients).toHaveLength(3);
    expect(ingredients[0].food.name).toBe("chickpeas");
    expect(ingredients[0].amount).toBe(400);
    expect(ingredients[0].unit?.name).toBe("g");
  });

  it("prefers the JSON-LD image (array + first entry) over og:image", () => {
    expect(result.imageUrl).toBe("https://example.com/curry-1200.jpg");
  });

  it("emits no AI-fallback text when structured data is present", () => {
    expect(result.text).toBe("");
  });
});

describe("recipeInstructions variants", () => {
  it("handles a plain string", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "X",
      recipeInstructions: "Do the thing.",
    })}</script>`;
    const r = extractRecipeFromHtml("https://e.com", html);
    expect(r.structured?.steps[0].instruction).toBe("Do the thing.");
  });

  it("handles an array of strings", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "X",
      recipeInstructions: ["Step one", "Step two"],
    })}</script>`;
    const r = extractRecipeFromHtml("https://e.com", html);
    expect(r.structured?.steps.map((s) => s.instruction)).toEqual([
      "Step one",
      "Step two",
    ]);
  });
});

describe("extractRecipeFromHtml — AI fallback (vegan-high-protein)", () => {
  const result = extractRecipeFromHtml(VEGAN_URL, veganHtml);

  it("finds no structured recipe", () => {
    expect(result.structured).toBeNull();
  });

  it("yields readable text containing Zutaten and Anleitung", () => {
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("Zutaten");
    expect(result.text).toContain("Anleitung");
  });
});

describe("image picker — vegan-high-protein", () => {
  const result = extractRecipeFromHtml(VEGAN_URL, veganHtml);

  it("returns a preview_images poster, not the logo", () => {
    expect(result.imageUrl).toContain("preview_images");
    expect(result.imageUrl).toMatch(/\.jpg/i);
    expect(result.imageUrl).not.toMatch(/logo/i);
  });

  it("returns an absolute URL", () => {
    expect(result.imageUrl).toMatch(/^https:\/\//);
  });

  it("excludes svg/icon/tiny-width candidates", () => {
    expect(result.imageUrl).not.toMatch(/\.svg/i);
  });
});

describe("extractReadableText", () => {
  it("strips scripts/styles and decodes entities", () => {
    const text = extractReadableText(
      "<style>.a{}</style><script>bad()</script><p>Salt &amp; Pepper</p>"
    );
    expect(text).toBe("Salt & Pepper");
    expect(text).not.toContain("bad()");
  });
});

describe("parseIngredient", () => {
  it("splits amount, unit, and food", () => {
    expect(parseIngredient("200 g Kichererbsen")).toEqual({
      food: { name: "Kichererbsen" },
      unit: { name: "g" },
      amount: 200,
      note: "",
    });
  });

  it("keeps free-text as food name when no amount", () => {
    const r = parseIngredient("Salz nach Geschmack");
    expect(r.food.name).toBe("Salz nach Geschmack");
    expect(r.amount).toBe(0);
    expect(r.unit).toBeNull();
  });
});
