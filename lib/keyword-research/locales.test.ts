import { describe, it, expect } from "vitest";
import { findCountry, findLanguage, COUNTRIES, LANGUAGES } from "./locales";

describe("locales", () => {
  it("maps PL to Poland / DataForSEO location 2616", () => {
    const country = findCountry("pl");
    expect(country.ktCountry).toBe("Poland");
    expect(country.dfsLocation).toBe(2616);
  });

  it("maps pl language to Polish / dfs code pl / hl pl", () => {
    const language = findLanguage("pl");
    expect(language.ktLanguage).toBe("Polish");
    expect(language.dfsCode).toBe("pl");
    expect(language.hl).toBe("pl");
  });

  it("falls back to the first entry for an unknown id", () => {
    expect(findCountry("does-not-exist")).toBe(COUNTRIES[0]);
    expect(findLanguage("does-not-exist")).toBe(LANGUAGES[0]);
  });

  it("includes the plan's required start set", () => {
    const countryIds = COUNTRIES.map((c) => c.id).sort();
    expect(countryIds).toEqual(["de", "es", "fr", "global", "gb", "it", "pl", "us"].sort());

    const languageIds = LANGUAGES.map((l) => l.id).sort();
    expect(languageIds).toEqual(["de", "en", "es", "fr", "it", "pl"].sort());
  });
});
