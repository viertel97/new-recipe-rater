import type { TandoorRecipe } from "@/lib/web-recipe";

// Tandoor HTTP helpers shared by the social and generic import paths.
// Config read from env, matching the previous inline usage.

function config(): { url: string; token: string } {
  const url = process.env.TANDOOR_URL;
  const token = process.env.TANDOOR_TOKEN;
  if (!url || !token) throw new Error("Tandoor is not configured");
  return { url, token };
}

// POST /api/ai-import/ — parses free text into a recipe (does not save it).
export async function aiImportText(text: string): Promise<TandoorRecipe> {
  const { url, token } = config();
  const aiProviderId = process.env.TANDOOR_AI_PROVIDER_ID;

  const formData = new FormData();
  formData.append("recipe_id", "");
  formData.append("text", text);
  formData.append("file", new Blob([]), "");
  if (aiProviderId) formData.append("ai_provider_id", aiProviderId);

  const res = await fetch(`${url}/api/ai-import/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || data.error || !data.recipe) {
    throw new Error(data.msg || `Tandoor AI import failed (${res.status})`);
  }
  return data.recipe as TandoorRecipe;
}

// POST /api/recipe/ — creates the recipe. ai-import only parses, so callers
// pass either an ai-import result or a JSON-LD-derived TandoorRecipe.
export async function createTandoorRecipe(
  recipe: TandoorRecipe,
  sourceUrl: string
): Promise<{ id: number }> {
  const { url, token } = config();

  const payload = {
    ...recipe,
    source_url: sourceUrl,
    servings: recipe.servings ?? 1,
  };

  const res = await fetch(`${url}/api/recipe/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const created = await res.json();
  if (!res.ok) {
    throw new Error(
      `Failed to create recipe (${res.status}): ${JSON.stringify(created).substring(0, 200)}`
    );
  }
  return { id: created.id };
}

// PUT /api/recipe/{id}/image/ — best-effort; failure is logged, never thrown.
export async function uploadTandoorImage(
  recipeId: number,
  imageUrl: string
): Promise<void> {
  const { url, token } = config();
  try {
    const imageForm = new FormData();
    imageForm.append("image_url", imageUrl);

    const res = await fetch(`${url}/api/recipe/${recipeId}/image/`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: imageForm,
    });
    console.log("[tandoor] Image upload response:", { status: res.status });
  } catch (err) {
    console.error("[tandoor] Image upload failed (non-fatal):", err);
  }
}
