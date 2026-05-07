/**
 * Generate PWA icons from a source SVG.
 * Usage: npx tsx scripts/gen-icons.ts
 */
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs/promises";

const OUT = path.join(process.cwd(), "public", "icons");

// Simple fork icon SVG — same color as app theme
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="80" fill="#0a0a0a"/>
  <text x="256" y="320" font-size="280" text-anchor="middle" font-family="system-ui">🍽️</text>
</svg>`;

const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0a0a0a"/>
  <text x="256" y="340" font-size="280" text-anchor="middle" font-family="system-ui">🍽️</text>
</svg>`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const src = Buffer.from(SVG);
  const maskSrc = Buffer.from(MASKABLE_SVG);

  await sharp(src).resize(192, 192).png().toFile(path.join(OUT, "icon-192.png"));
  console.log("✓ icon-192.png");

  await sharp(src).resize(512, 512).png().toFile(path.join(OUT, "icon-512.png"));
  console.log("✓ icon-512.png");

  await sharp(maskSrc).resize(512, 512).png().toFile(path.join(OUT, "maskable-512.png"));
  console.log("✓ maskable-512.png");

  console.log("Icons generated in public/icons/");
}

main().catch((err) => { console.error(err); process.exit(1); });
