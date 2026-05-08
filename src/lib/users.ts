import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

/**
 * Ensures all users defined in the USERS env var exist in the database.
 * Format: USERS="username:password,username2:password2"
 * Called once on app startup.
 */
let provisioned = false;

export async function ensureUsers() {
  if (provisioned) return;
  provisioned = true;

  const raw = process.env.USERS;
  if (!raw) return;

  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);

  for (const entry of entries) {
    const [username, password] = entry.split(":");
    if (!username || !password) {
      console.warn(`Invalid USERS entry: "${entry}" — expected "username:password"`);
      continue;
    }

    const existing = await prisma.user.findUnique({ where: { username } });

    if (existing) {
      const passwordMatch = await bcrypt.compare(password, existing.password);
      if (!passwordMatch) {
        const hashed = await bcrypt.hash(password, 10);
        await prisma.user.update({ where: { username }, data: { password: hashed } });
        console.log(`Updated password for user: ${username}`);
      }
      continue;
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username,
        name: username.charAt(0).toUpperCase() + username.slice(1),
        password: hashed,
      },
    });
    console.log(`Created user: ${username}`);
  }
}
