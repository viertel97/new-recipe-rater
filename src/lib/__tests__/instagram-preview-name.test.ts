import { describe, it, expect } from "vitest";
import { instagramPreviewFilename } from "@/lib/instagram-preview-name";

describe("instagramPreviewFilename", () => {
  it("builds a jpg filename from a valid post id", () => {
    expect(instagramPreviewFilename("DKabc-9xYz_")).toBe("ig_DKabc-9xYz_.jpg");
  });

  it("returns null for ids with path-traversal or unexpected characters", () => {
    expect(instagramPreviewFilename("../etc/passwd")).toBeNull();
    expect(instagramPreviewFilename("a/b")).toBeNull();
    expect(instagramPreviewFilename("a.b")).toBeNull();
    expect(instagramPreviewFilename("")).toBeNull();
  });
});
