import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTandoorRecipe, nameFromText } from "@/lib/tandoor";
import type { TandoorRecipe } from "@/lib/web-recipe";

describe("createTandoorRecipe", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.TANDOOR_URL = "http://tandoor.test";
    process.env.TANDOOR_TOKEN = "t";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces null order on steps and ingredients with indexes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 7 }), { status: 201 }));
    const recipe = {
      name: "R",
      servings: 2,
      steps: [
        {
          instruction: "a",
          order: null,
          ingredients: [
            { food: { name: "x" }, unit: null, amount: 1, note: "", order: null },
            { food: { name: "y" }, unit: null, amount: 2, note: "", order: null },
          ],
        },
      ],
    } as unknown as TandoorRecipe;

    await expect(createTandoorRecipe(recipe, "http://src")).resolves.toEqual({ id: 7 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.steps[0].order).toBe(0);
    expect(body.steps[0].ingredients.map((i: { order: number }) => i.order)).toEqual([0, 1]);
  });

  it("reports non-JSON responses readably", async () => {
    fetchMock.mockResolvedValue(new Response("<!doctype html><h1>500</h1>", { status: 500 }));
    await expect(
      createTandoorRecipe({ name: "R", servings: 1, steps: [] }, "http://src")
    ).rejects.toThrow(/non-JSON response \(500\)/);
  });

  it("uses the fallback name when the recipe name is blank", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    await createTandoorRecipe({ name: "  ", servings: 1, steps: [] }, "http://src", "Caption title");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe("Caption title");
  });

  it("keeps the AI-provided name when present", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 201 }));
    await createTandoorRecipe({ name: "Bolognese", servings: 1, steps: [] }, "http://src", "x");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe("Bolognese");
  });
});

describe("nameFromText", () => {
  it("takes the first non-empty line and shortens long ones", () => {
    expect(nameFromText("\n  Cauliflower Bolognese  \nmore")).toBe("Cauliflower Bolognese");
    expect(nameFromText("a".repeat(100))).toHaveLength(80);
    expect(nameFromText("")).toBe("");
  });
});
