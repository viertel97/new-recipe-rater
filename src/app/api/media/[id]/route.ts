import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";

const MEDIA_ROOT = process.env.MEDIA_ROOT ?? path.join(process.cwd(), "data", "media");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const fullPath = path.join(MEDIA_ROOT, asset.localPath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    // File missing — mark failed so resolver retries on next load
    await prisma.link.updateMany({
      where: { mediaAssetId: id },
      data: { mediaStatus: "FAILED", mediaError: "file missing on disk" },
    });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const stream = fs.createReadStream(fullPath);
  // @ts-expect-error — Node ReadableStream → Web ReadableStream
  const webStream = stream as unknown as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
