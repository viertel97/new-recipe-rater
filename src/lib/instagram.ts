const POST_ID_RE = /instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/;

export function getInstagramPostId(url: string): string | null {
  const m = url.match(POST_ID_RE);
  return m ? m[1] : null;
}

export function isInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|reels|tv)\//.test(url);
}

export function instagramThumbnailUrl(postId: string): string {
  return `https://www.instagram.com/p/${postId}/media/?size=l`;
}
