// Instagram post ids are [A-Za-z0-9_-]; reject anything else so the value is
// safe to use directly as a filename (no path traversal).
const POST_ID_RE = /^[\w-]+$/;

export function instagramPreviewFilename(postId: string): string | null {
  if (!POST_ID_RE.test(postId)) return null;
  return `ig_${postId}.jpg`;
}
