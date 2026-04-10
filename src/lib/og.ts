export function extractMeta(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?)(?:property|name)=["']${property}["'][^>]*?content=["']([^"']*?)["']|<meta\\s+(?:[^>]*?)content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${property}["']`,
    "i"
  );
  const match = html.match(regex);
  return match ? (match[1] || match[2] || null) : null;
}

export function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : null;
}
