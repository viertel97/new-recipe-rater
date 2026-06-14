import { describe, it, expect } from "vitest";
import { getInstagramPostId, isInstagramUrl, instagramThumbnailUrl } from "@/lib/instagram";

describe("instagram helpers", () => {
  it("extracts post id from p/reel/reels/tv urls", () => {
    expect(getInstagramPostId("https://instagram.com/p/AbC-1/")).toBe("AbC-1");
    expect(getInstagramPostId("https://www.instagram.com/reel/XyZ_2/")).toBe("XyZ_2");
    expect(getInstagramPostId("https://instagram.com/reels/QwE3/")).toBe("QwE3");
    expect(getInstagramPostId("https://instagram.com/tv/Tv4/")).toBe("Tv4");
    expect(getInstagramPostId("https://example.com/recipe")).toBeNull();
  });

  it("detects instagram urls", () => {
    expect(isInstagramUrl("https://instagram.com/p/AbC1/")).toBe(true);
    expect(isInstagramUrl("https://www.instagram.com/reel/XyZ2/")).toBe(true);
    expect(isInstagramUrl("https://example.com/x")).toBe(false);
  });

  it("builds a lightweight thumbnail url from a post id", () => {
    expect(instagramThumbnailUrl("AbC1")).toBe("https://www.instagram.com/p/AbC1/media/?size=l");
  });

  it("rejects urls where instagram.com is not the host (SSRF guard)", () => {
    expect(getInstagramPostId("https://evil.com/instagram.com/p/ABC123/")).toBeNull();
    expect(getInstagramPostId("http://169.254.169.254/instagram.com/p/x/")).toBeNull();
    expect(isInstagramUrl("https://evil.com/instagram.com/p/ABC123/")).toBe(false);
    expect(isInstagramUrl("https://instagram.com.evil.com/p/x/")).toBe(false);
  });
});
