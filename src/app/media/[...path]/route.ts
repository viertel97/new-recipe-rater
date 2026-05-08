import { NextRequest, NextResponse } from "next/server";
import { createReadStream, statSync } from "fs";
import path from "path";

const MEDIA_DIR = process.env.MEDIA_DIR ?? "/data/media";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  const filename = segments.join("/");

  // Prevent path traversal
  const filePath = path.resolve(path.join(MEDIA_DIR, filename));
  if (!filePath.startsWith(path.resolve(MEDIA_DIR) + path.sep)) {
    return new NextResponse(null, { status: 404 });
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(filePath);
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  const ext = path.extname(filename).slice(1).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

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
      "Content-Type": contentType,
      "Content-Length": String(stats.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
