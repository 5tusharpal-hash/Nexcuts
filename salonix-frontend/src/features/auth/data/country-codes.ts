export interface CountryCode {
  name: string;
  isoCode: string;
  dialCode: string;
  flag: string;
}

export const countryCodes: CountryCode[] = [
  { name: "India", isoCode: "IN", dialCode: "+91", flag: "IN" },
  { name: "United States", isoCode: "US", dialCode: "+1", flag: "US" },
  { name: "United Kingdom", isoCode: "GB", dialCode: "+44", flag: "GB" },
  { name: "United Arab Emirates", isoCode: "AE", dialCode: "+971", flag: "AE" },
  { name: "Australia", isoCode: "AU", dialCode: "+61", flag: "AU" },
  { name: "Bangladesh", isoCode: "BD", dialCode: "+880", flag: "BD" },
  { name: "Canada", isoCode: "CA", dialCode: "+1", flag: "CA" },
  { name: "France", isoCode: "FR", dialCode: "+33", flag: "FR" },
  { name: "Germany", isoCode: "DE", dialCode: "+49", flag: "DE" },
  { name: "Indonesia", isoCode: "ID", dialCode: "+62", flag: "ID" },
  { name: "Italy", isoCode: "IT", dialCode: "+39", flag: "IT" },
  { name: "Japan", isoCode: "JP", dialCode: "+81", flag: "JP" },
  { name: "Malaysia", isoCode: "MY", dialCode: "+60", flag: "MY" },
  { name: "Nepal", isoCode: "NP", dialCode: "+977", flag: "NP" },
  { name: "Netherlands", isoCode: "NL", dialCode: "+31", flag: "NL" },
  { name: "New Zealand", isoCode: "NZ", dialCode: "+64", flag: "NZ" },
  { name: "Pakistan", isoCode: "PK", dialCode: "+92", flag: "PK" },
  { name: "Philippines", isoCode: "PH", dialCode: "+63", flag: "PH" },
  { name: "Saudi Arabia", isoCode: "SA", dialCode: "+966", flag: "SA" },
  { name: "Singapore", isoCode: "SG", dialCode: "+65", flag: "SG" },
  { name: "South Africa", isoCode: "ZA", dialCode: "+27", flag: "ZA" },
  { name: "South Korea", isoCode: "KR", dialCode: "+82", flag: "KR" },
  { name: "Spain", isoCode: "ES", dialCode: "+34", flag: "ES" },
  { name: "Sri Lanka", isoCode: "LK", dialCode: "+94", flag: "LK" },
  { name: "Thailand", isoCode: "TH", dialCode: "+66", flag: "TH" },
  { name: "Turkey", isoCode: "TR", dialCode: "+90", flag: "TR" },
];

export const defaultCountryCode = countryCodes.find(
  (country) => country.isoCode === "IN",
) ?? countryCodes[0];

export function getCountryFlag(isoCode: string) {
  return isoCode
    .toUpperCase()
    .split("")
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}
