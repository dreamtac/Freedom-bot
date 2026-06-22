export interface NewsPost {
  id: string;
  source: string;
  category: string;
  title: string;
  summary: string;
  publishedAt: Date;
  url: string;
  imageUrl?: string;
}
