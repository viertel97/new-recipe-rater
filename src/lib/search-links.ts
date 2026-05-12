import type { LinkItem } from "@/types/link";

export function searchLinks(links: LinkItem[], query: string): LinkItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return links;
  return links.filter(
    (l) =>
      l.url.toLowerCase().includes(q) ||
      (l.notes?.toLowerCase().includes(q) ?? false) ||
      (l.reviewNote?.toLowerCase().includes(q) ?? false),
  );
}
