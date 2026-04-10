import { NextRequest, NextResponse } from "next/server";
import { snapsave } from "snapsave-media-downloader";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url || !url.includes("instagram.com")) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const result = await snapsave(url);
    if (!result.success || !result.data?.media?.length) {
      return NextResponse.json({ error: "No media found" }, { status: 404 });
    }

    const media = result.data.media
      .filter((m) => m.url)
      .map((m) => ({
        url: m.url!,
        thumbnail: m.thumbnail,
        type: m.type,
      }));

    return NextResponse.json(
      { media },
      { headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } }
    );
  } catch {
    return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
  }
}
