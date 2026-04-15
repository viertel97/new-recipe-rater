export type Urgency = "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE";

export type LinkItem = {
  id: string;
  url: string;
  rating: "PENDING" | "GOOD" | "BAD";
  urgency: Urgency | null;
  notes: string | null;
  reviewNote: string | null;
  tandoorRecipeId: number | null;
  createdAt: Date;
  submittedById: string;
  submittedBy: { name: string | null; email: string | null };
};

export type OgData = {
  title: string | null;
  image: string | null;
  description: string | null;
  siteName: string | null;
};
