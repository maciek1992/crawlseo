// Locale tables mapping the app's country/language identifiers to the
// formats each provider expects:
//  - Keyword Tool guest MCP wants full English country/language names
//    (e.g. "Poland", "Polish").
//  - DataForSEO wants numeric location codes and ISO language codes.
//  - Google Autocomplete wants an `hl` (UI language) code.

export type CountryOption = {
  id: string;
  label: string;
  ktCountry: string;
  dfsLocation: number;
};

export type LanguageOption = {
  id: string;
  label: string;
  ktLanguage: string;
  dfsCode: string;
  hl: string;
};

// Start set per the plan: Global, US, UK, PL, DE, FR, ES, IT.
export const COUNTRIES: CountryOption[] = [
  { id: "global", label: "Global", ktCountry: "Global / Worldwide", dfsLocation: 2840 },
  { id: "us", label: "United States", ktCountry: "United States", dfsLocation: 2840 },
  { id: "gb", label: "United Kingdom", ktCountry: "United Kingdom", dfsLocation: 2826 },
  { id: "pl", label: "Polska", ktCountry: "Poland", dfsLocation: 2616 },
  { id: "de", label: "Germany", ktCountry: "Germany", dfsLocation: 2276 },
  { id: "fr", label: "France", ktCountry: "France", dfsLocation: 2250 },
  { id: "es", label: "Spain", ktCountry: "Spain", dfsLocation: 2724 },
  { id: "it", label: "Italy", ktCountry: "Italy", dfsLocation: 2380 },
];

// Languages per the plan: EN, PL, DE, FR, ES, IT.
export const LANGUAGES: LanguageOption[] = [
  { id: "en", label: "English", ktLanguage: "English", dfsCode: "en", hl: "en" },
  { id: "pl", label: "Polski", ktLanguage: "Polish", dfsCode: "pl", hl: "pl" },
  { id: "de", label: "Deutsch", ktLanguage: "German", dfsCode: "de", hl: "de" },
  { id: "fr", label: "Français", ktLanguage: "French", dfsCode: "fr", hl: "fr" },
  { id: "es", label: "Español", ktLanguage: "Spanish", dfsCode: "es", hl: "es" },
  { id: "it", label: "Italiano", ktLanguage: "Italian", dfsCode: "it", hl: "it" },
];

export const DEFAULT_COUNTRY_ID = "global";
export const DEFAULT_LANGUAGE_ID = "en";

export function findCountry(id: string): CountryOption {
  return COUNTRIES.find((c) => c.id === id) ?? COUNTRIES[0];
}

export function findLanguage(id: string): LanguageOption {
  return LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];
}
