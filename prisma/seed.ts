import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const raw = process.env.USERS;
  if (!raw) {
    console.log("No USERS env var set. Nothing to seed.");
    return;
  }

  const entries = raw.split(",").map((e) => e.trim()).filter(Boolean);

  for (const entry of entries) {
    const [username, password] = entry.split(":");
    if (!username || !password) {
      console.warn(`Skipping invalid entry: "${entry}" — expected "username:password"`);
      continue;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        name: username.charAt(0).toUpperCase() + username.slice(1),
        password: hashed,
      },
    });
    console.log(`User ready: ${user.username}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
