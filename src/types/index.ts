export interface Property {
  id: string;
  title: string;
  streetAddress: string;
  city: string;
  monthlyRentUsd: number;
  bedrooms: number;
  bathrooms: number;
  imagePath: string;
  imageAlt: string;
}

export interface Sponsor {
  id: string;
  businessName: string;
  websiteUrl: string;
}

export interface PropertyCardProps {
  property: Property;
}

export interface SponsorBannerProps {
  sponsor: Sponsor;
}

export interface ServiceCategory {
  id: string;
  name: string;
  slug: string;
}

export interface ServiceCategoryMapping {
  category: ServiceCategory | null;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  price_amount: number;
  currency: string;
  created_at: string;
  service_category_mappings: ServiceCategoryMapping[];
}

/**
 * Controlled draft filters: city === "" means all cities; maxRentUsd ===
 * undefined means no rent limit. Change callbacks update the draft only.
 * The client parent applies that draft to listings in onSubmit.
 * SearchFilters must prevent the form's default navigation before onSubmit().
 * onClear resets both draft and applied values in the parent.
 */
export interface SearchFiltersProps {
  cities: string[];
  city: string;
  maxRentUsd?: number;
  onCityChange: (city: string) => void;
  onMaxRentChange: (maxRentUsd?: number) => void;
  onSubmit: () => void;
  onClear: () => void;
}
