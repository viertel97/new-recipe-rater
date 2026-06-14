import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import { isInstagramUrl } from "@/lib/instagram";
import { ensureInstagramPreview } from "@/lib/instagram-preview";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !isInstagramUrl(url)) {
    return new NextResponse(null, { status: 400 });
  }

  const filePath = await ensureInstagramPreview(url);
  if (!filePath) {
    return new NextResponse(null, { status: 404 });
  }

  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => controller.enqueue(chunk));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
