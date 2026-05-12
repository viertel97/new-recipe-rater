import { z } from "zod";

export const submitLinkSchema = z.object({
  url: z.string().url("Must be a valid URL"),
});

export const rateLinkSchema = z.object({
  linkId: z.string().min(1),
  rating: z.enum(["GOOD", "BAD"]),
  urgency: z.enum(["TOMORROW", "NEXT_WEEK", "NEXT_MONTH", "ARCHIVE"]).optional(),
  reviewNote: z.string().max(500).optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});
