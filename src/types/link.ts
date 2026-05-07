export type Urgency = "TOMORROW" | "NEXT_WEEK" | "NEXT_MONTH" | "ARCHIVE";

export type Category = "DINNER" | "SNACK" | "CAKE" | "BREAKFAST";

export type CategoryStatus = "PENDING" | "DONE" | "FAILED";

export type MediaStatus = "PENDING" | "RESOLVED" | "FAILED" | "EVICTED";

export type MediaAsset = {
  id: string;
  sourceUrl: string;
  type: "VIDEO" | "IMAGE";
  localPath: string;
  contentType: string;
  sizeBytes: number;
  thumbnailPath: string | null;
  title: string | null;
  description: string | null;
  fetchedAt: Date;
};

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
  mediaAsset: MediaAsset | null;
  mediaStatus: MediaStatus;
};

export type OgData = {
  title: string | null;
  image: string | null;
  description: string | null;
  siteName: string | null;
};
