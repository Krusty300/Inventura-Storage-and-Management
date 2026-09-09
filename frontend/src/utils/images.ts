import { getCompanyPlaceholder, getPlaceholder } from "./placeholders";

export function productImageUrl(
  p?: { images?: { url: string }[] | null; image_url?: string | null } | null
): string {
  if (p?.images?.length) return p.images[0].url;
  return p?.image_url || getPlaceholder();
}

export function entityImageUrl(imageUrl?: string | null): string {
  return imageUrl || getCompanyPlaceholder();
}