const PLACEHOLDER = "/placeholders/cart-illustration.png";
const COMPANY_PLACEHOLDER = "/placeholders/company-placeholder.png";

export function getPlaceholder(): string {
  return PLACEHOLDER;
}

export function getCompanyPlaceholder(): string {
  return COMPANY_PLACEHOLDER;
}

export function onImageError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.dataset.placeholder) return;
  img.dataset.placeholder = "1";
  img.src = getPlaceholder();
}
