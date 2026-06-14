// Parse an Instagram post/reel/tv URL, anchoring on the HOST (not a substring
// match) so URLs like https://evil.com/instagram.com/p/x/ are rejected. This is
// the SSRF guard for the unauthenticated /api/ig-thumb route, which feeds the
// validated URL to a server-side downloader + fetch.
function parseInstagramPostId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname !== "instagram.com" && !u.hostname.endsWith(".instagram.com")) {
    return null;
  }
  const m = u.pathname.match(/^\/(?:p|reel|reels|tv)\/([\w-]+)/);
  return m ? m[1] : null;
}

export function getInstagramPostId(url: string): string | null {
  return parseInstagramPostId(url);
}

export function isInstagramUrl(url: string): boolean {
  return parseInstagramPostId(url) !== null;
}

export function instagramThumbnailUrl(postId: string): string {
  return `https://www.instagram.com/p/${postId}/media/?size=l`;
}
