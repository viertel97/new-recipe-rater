import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ensureUsers } from "@/lib/users";

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          await ensureUsers();

          const login = credentials?.username as string;
          const password = credentials?.password as string;

          if (!login || !password) {
            console.log("[auth] missing credentials");
            return null;
          }

          const user =
            (await prisma.user.findUnique({ where: { username: login } })) ??
            (await prisma.user.findUnique({ where: { email: login } }));

          if (!user) {
            console.log("[auth] user not found:", login);
            return null;
          }

          const isValid = await bcrypt.compare(password, user.password);
          if (!isValid) {
            console.log("[auth] wrong password for:", login);
            return null;
          }

          console.log("[auth] login ok:", login);
          return { id: user.id, email: user.email ?? user.username, name: user.name };
        } catch (err) {
          console.error("[auth] authorize threw:", err);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
