/** All 51 US real estate licensing jurisdictions. Order is alphabetical by code. */
export const JURISDICTIONS = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
} as const;

export type JurisdictionCode = keyof typeof JURISDICTIONS;
export const JURISDICTION_CODES = Object.keys(JURISDICTIONS) as JurisdictionCode[];

export function isJurisdictionCode(x: string): x is JurisdictionCode {
  return x in JURISDICTIONS;
}

/** Bank identifiers. National banks are vendor-specific; state banks are one per jurisdiction. */
export type BankId = "national_pearsonvue" | "national_psi" | `state_${JurisdictionCode}`;
export const NATIONAL_BANKS = ["national_pearsonvue", "national_psi"] as const;
export const ALL_BANKS: BankId[] = [
  ...NATIONAL_BANKS,
  ...JURISDICTION_CODES.map((c) => `state_${c}` as const),
];
export const BANK_ID_RE = /^(national_pearsonvue|national_psi|state_[A-Z]{2})$/;
