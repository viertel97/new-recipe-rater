import { NextRequest, NextResponse } from "next/server";
import { extractMeta, extractTitleTag } from "@/lib/og";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; InstaRater/1.0)" },
      signal: AbortSignal.timeout(5000),
    });

    const html = await res.text();

    const title = extractMeta(html, "og:title") || extractMeta(html, "twitter:title") || extractTitleTag(html);
    const image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
    const description = extractMeta(html, "og:description") || extractMeta(html, "twitter:description");
    const siteName = extractMeta(html, "og:site_name");

    return NextResponse.json(
      { title, image, description, siteName },
      { headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } }
    );
  } catch {
    return NextResponse.json({ error: "Failed to fetch metadata" }, { status: 500 });
  }
}
