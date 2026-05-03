export type Urgency = "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE";

export type Category = "DINNER" | "SNACK" | "CAKE" | "BREAKFAST";

export type CategoryStatus = "PENDING" | "DONE" | "FAILED";

export type LinkItem = {
  id: string;
  url: string;
  rating: "PENDING" | "GOOD" | "BAD";
  urgency: Urgency | null;
  notes: string | null;
  reviewNote: string | null;
  tandoorRecipeId: number | null;
  category: Category | null;
  categoryStatus: CategoryStatus;
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
