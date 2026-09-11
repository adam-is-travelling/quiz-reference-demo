export type Country = { code: string; name: string }

export const COUNTRIES: readonly Country[] = [
  { code: "AF", name: "Afghanistan" },
  { code: "AX", name: "Åland Islands" },
  { code: "AL", name: "Albania" },
  { code: "DZ", name: "Algeria" },
  { code: "AD", name: "Andorra" },
  { code: "AO", name: "Angola" },
  { code: "AG", name: "Antigua and Barbuda" },
  { code: "AR", name: "Argentina" },
  { code: "AM", name: "Armenia" },
  { code: "AW", name: "Aruba" },
  { code: "AU", name: "Australia" },
  { code: "AT", name: "Austria" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BS", name: "Bahamas" },
  { code: "BH", name: "Bahrain" },
  { code: "BD", name: "Bangladesh" },
  { code: "BB", name: "Barbados" },
  { code: "BY", name: "Belarus" },
  { code: "BE", name: "Belgium" },
  { code: "BZ", name: "Belize" },
  { code: "BJ", name: "Benin" },
  { code: "BM", name: "Bermuda" },
  { code: "BT", name: "Bhutan" },
  { code: "BO", name: "Bolivia" },
  { code: "BQ", name: "Bonaire" },
  { code: "BA", name: "Bosnia and Herzegovina" },
  { code: "BW", name: "Botswana" },
  { code: "BR", name: "Brazil" },
  { code: "VG", name: "Britsh Virgin Islands" },
  { code: "BN", name: "Brunei Darussalam" },
  { code: "BG", name: "Bulgaria" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BI", name: "Burundi" },
  { code: "CV", name: "Cabo Verde" },
  { code: "KH", name: "Cambodia" },
  { code: "CM", name: "Cameroon" },
  { code: "CA", name: "Canada" },
  { code: "CF", name: "Central African Republic" },
  { code: "TD", name: "Chad" },
  { code: "CL", name: "Chile" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "KM", name: "Comoros" },
  { code: "CG", name: "Congo" },
  { code: "CD", name: "Congo, Democratic Republic" },
  { code: "CK", name: "Cook Islands" },
  { code: "CR", name: "Costa Rica" },
  { code: "CI", name: "Côte d'Ivoire" },
  { code: "HR", name: "Croatia" },
  { code: "CU", name: "Cuba" },
  { code: "CW", name: "Curaçao" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "DJ", name: "Djibouti" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "EC", name: "Ecuador" },
  { code: "EG", name: "Egypt" },
  { code: "SV", name: "El Salvador" },
  { code: "ENG", name: "England" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "ER", name: "Eritrea" },
  { code: "EE", name: "Estonia" },
  { code: "SZ", name: "Eswatini" },
  { code: "ET", name: "Ethiopia" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FJ", name: "Fiji" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GF", name: "French Guiana" },
  { code: "PF", name: "French Polynesia" },
  { code: "GA", name: "Gabon" },
  { code: "GM", name: "Gambia" },
  { code: "GE", name: "Georgia" },
  { code: "DE", name: "Germany" },
  { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" },
  { code: "GR", name: "Greece" },
  { code: "GL", name: "Greenland" },
  { code: "GD", name: "Grenada" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GU", name: "Guam" },
  { code: "GT", name: "Guatemala" },
  { code: "GG", name: "Guernsey" },
  { code: "GN", name: "Guinea" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HT", name: "Haiti" },
  { code: "VA", name: "Holy See" },
  { code: "HN", name: "Honduras" },
  { code: "HK", name: "Hong Kong" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IN", name: "India" },
  { code: "ID", name: "Indonesia" },
  { code: "IR", name: "Iran" },
  { code: "IQ", name: "Iraq" },
  { code: "IE", name: "Ireland" },
  { code: "IM", name: "Isle of Man" },
  { code: "IL", name: "Israel" },
  { code: "IT", name: "Italy" },
  { code: "JM", name: "Jamaica" },
  { code: "JP", name: "Japan" },
  { code: "JE", name: "Jersey" },
  { code: "JO", name: "Jordan" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "KE", name: "Kenya" },
  { code: "KI", name: "Kiribati" },
  { code: "KW", name: "Kuwait" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "LA", name: "Laos" },
  { code: "LV", name: "Latvia" },
  { code: "LB", name: "Lebanon" },
  { code: "LS", name: "Lesotho" },
  { code: "LR", name: "Liberia" },
  { code: "LY", name: "Libya" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MO", name: "Macao" },
  { code: "MG", name: "Madagascar" },
  { code: "MW", name: "Malawi" },
  { code: "MY", name: "Malaysia" },
  { code: "MV", name: "Maldives" },
  { code: "ML", name: "Mali" },
  { code: "MT", name: "Malta" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MQ", name: "Martinique" },
  { code: "MR", name: "Mauritania" },
  { code: "MU", name: "Mauritius" },
  { code: "MX", name: "Mexico" },
  { code: "FM", name: "Micronesia" },
  { code: "MD", name: "Moldova" },
  { code: "MC", name: "Monaco" },
  { code: "MN", name: "Mongolia" },
  { code: "ME", name: "Montenegro" },
  { code: "MS", name: "Montserrat" },
  { code: "MA", name: "Morocco" },
  { code: "MZ", name: "Mozambique" },
  { code: "MM", name: "Myanmar" },
  { code: "NA", name: "Namibia" },
  { code: "NR", name: "Nauru" },
  { code: "NP", name: "Nepal" },
  { code: "NL", name: "Netherlands" },
  { code: "NC", name: "New Caledonia" },
  { code: "NZ", name: "New Zealand" },
  { code: "NI", name: "Nicaragua" },
  { code: "NE", name: "Niger" },
  { code: "NG", name: "Nigeria" },
  { code: "NU", name: "Niue" },
  { code: "MK", name: "North Macedonia" },
  { code: "KP", name: "North Korea" },
  { code: "NIR", name: "Northern Ireland" },
  { code: "NO", name: "Norway" },
  { code: "OM", name: "Oman" },
  { code: "PK", name: "Pakistan" },
  { code: "PW", name: "Palau" },
  { code: "PS", name: "Palestine" },
  { code: "PA", name: "Panama" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PY", name: "Paraguay" },
  { code: "PE", name: "Peru" },
  { code: "PH", name: "Philippines" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "PR", name: "Puerto Rico" },
  { code: "QA", name: "Qatar" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "KN", name: "Saint Kitts and Nevis" },
  { code: "LC", name: "Saint Lucia" },
  { code: "MF", name: "Saint Martin" },
  { code: "VC", name: "Saint Vincent and the Grenadines" },
  { code: "WS", name: "Samoa" },
  { code: "SM", name: "San Marino" },
  { code: "ST", name: "Sao Tome and Principe" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SCO", name: "Scotland" },
  { code: "SN", name: "Senegal" },
  { code: "RS", name: "Serbia" },
  { code: "SC", name: "Seychelles" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SG", name: "Singapore" },
  { code: "SX", name: "Sint Maarten" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SO", name: "Somalia" },
  { code: "ZA", name: "South Africa" },
  { code: "GS", name: "South Georgia" },
  { code: "KR", name: "South Korea" },
  { code: "SS", name: "South Sudan" },
  { code: "ES", name: "Spain" },
  { code: "LK", name: "Sri Lanka" },
  { code: "SD", name: "Sudan" },
  { code: "SR", name: "Suriname" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "SY", name: "Syria" },
  { code: "TW", name: "Taiwan" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TZ", name: "Tanzania" },
  { code: "TH", name: "Thailand" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TG", name: "Togo" },
  { code: "TO", name: "Tonga" },
  { code: "TT", name: "Trinidad and Tobago" },
  { code: "TN", name: "Tunisia" },
  { code: "TR", name: "Türkiye" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TV", name: "Tuvalu" },
  { code: "UG", name: "Uganda" },
  { code: "UA", name: "Ukraine" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VU", name: "Vanuatu" },
  { code: "VE", name: "Venezuela" },
  { code: "VN", name: "Vietnam" },
  { code: "WAL", name: "Wales" },
  { code: "EH", name: "Western Sahara" },
  { code: "YE", name: "Yemen" },
  { code: "ZM", name: "Zambia" },
  { code: "ZW", name: "Zimbabwe" },
].sort((a, b) => a.name.localeCompare(b.name))

export function countryName(code: string | null | undefined): string {
  if (!code) return ""
  const entry = COUNTRIES.find((c) => c.code === code)
  return entry ? entry.name : code
}

/**
 * How a team's affiliation reads. A national team with no country is an
 * international side — the label is derived here rather than stored, so it
 * can never disagree with the data.
 */
export function teamLabel(result: {
  team_type?: string | null
  team_country?: string | null
}): string {
  if (result.team_country) return countryName(result.team_country)
  return result.team_type === "national" ? "International" : "—"
}

const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
  BRITAIN: "GB",
  "GREAT BRITAIN": "GB",
  USA: "US",
  "UNITED STATES OF AMERICA": "US",
}

export function resolveCountryCode(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const upper = raw.trim().toUpperCase()
  if (COUNTRY_ALIASES[upper]) return COUNTRY_ALIASES[upper]
  const byCode = COUNTRIES.find((c) => c.code === upper)
  if (byCode) return byCode.code
  const lower = raw.trim().toLowerCase()
  const byName = COUNTRIES.find((c) => c.name.toLowerCase() === lower)
  return byName?.code ?? null
}

/**
 * Adjectival forms, lowercased, for country references a team name makes
 * without naming the country — "Austrian National Team", "Dutch Masters".
 * A demonym often shares no letters with its country ("Dutch"/"Netherlands"),
 * so this cannot be derived from COUNTRIES and has to be listed.
 *
 * Deliberately not exhaustive. A demonym is listed only where it points at
 * exactly one country; the genuinely ambiguous ones are omitted rather than
 * guessed — "Korean", "Sudanese", "Congolese" and "Guinean" each span more
 * than one country in COUNTRIES. Omitting one costs an unfilled picker the
 * admin fills in themselves; guessing wrong silently mislabels a team.
 */
export const COUNTRY_DEMONYMS: Record<string, string> = {
  afghan: "AF",
  albanian: "AL",
  algerian: "DZ",
  american: "US",
  argentine: "AR",
  argentinian: "AR",
  armenian: "AM",
  australian: "AU",
  austrian: "AT",
  azerbaijani: "AZ",
  bangladeshi: "BD",
  belarusian: "BY",
  belgian: "BE",
  bolivian: "BO",
  brazilian: "BR",
  bulgarian: "BG",
  cambodian: "KH",
  cameroonian: "CM",
  canadian: "CA",
  chilean: "CL",
  chinese: "CN",
  colombian: "CO",
  croatian: "HR",
  cuban: "CU",
  cypriot: "CY",
  czech: "CZ",
  danish: "DK",
  dutch: "NL",
  ecuadorian: "EC",
  egyptian: "EG",
  emirati: "AE",
  english: "ENG",
  estonian: "EE",
  ethiopian: "ET",
  filipino: "PH",
  finnish: "FI",
  french: "FR",
  georgian: "GE",
  german: "DE",
  ghanaian: "GH",
  greek: "GR",
  hungarian: "HU",
  icelandic: "IS",
  indian: "IN",
  indonesian: "ID",
  iranian: "IR",
  iraqi: "IQ",
  irish: "IE",
  israeli: "IL",
  italian: "IT",
  jamaican: "JM",
  japanese: "JP",
  jordanian: "JO",
  kazakh: "KZ",
  kenyan: "KE",
  kuwaiti: "KW",
  latvian: "LV",
  lebanese: "LB",
  libyan: "LY",
  lithuanian: "LT",
  luxembourgish: "LU",
  malaysian: "MY",
  maltese: "MT",
  mexican: "MX",
  moldovan: "MD",
  mongolian: "MN",
  moroccan: "MA",
  nepalese: "NP",
  "new zealand": "NZ",
  nigerian: "NG",
  "northern irish": "NIR",
  norwegian: "NO",
  pakistani: "PK",
  peruvian: "PE",
  polish: "PL",
  portuguese: "PT",
  romanian: "RO",
  russian: "RU",
  samoan: "WS",
  saudi: "SA",
  scottish: "SCO",
  senegalese: "SN",
  serbian: "RS",
  singaporean: "SG",
  slovak: "SK",
  slovenian: "SI",
  somali: "SO",
  "south african": "ZA",
  spanish: "ES",
  "sri lankan": "LK",
  swedish: "SE",
  swiss: "CH",
  syrian: "SY",
  taiwanese: "TW",
  tanzanian: "TZ",
  thai: "TH",
  tunisian: "TN",
  turkish: "TR",
  ugandan: "UG",
  ukrainian: "UA",
  uruguayan: "UY",
  uzbek: "UZ",
  venezuelan: "VE",
  vietnamese: "VN",
  welsh: "WAL",
  zambian: "ZM",
  zimbabwean: "ZW",
}

/** Lowercase, punctuation to spaces, single-spaced. */
function normaliseForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Guess a national side's country from its name — "England A", "Netherlands
 * One", "Austrian National Team".
 *
 * Matches country names and demonyms on whole words only, so "Englander"
 * is not England. Where one match sits inside another, the longer wins:
 * "Northern Ireland A" is Northern Ireland, not Ireland. If two genuinely
 * different countries remain, returns null rather than picking one — a
 * mislabelled team is worse than an unfilled picker, because nothing on
 * screen distinguishes an inferred country from a confirmed one.
 */
export function inferCountryFromTeamName(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const normalised = normaliseForMatch(raw)
  if (!normalised) return null

  // Pad so a needle padded the same way can only match on word boundaries.
  const haystack = ` ${normalised} `
  const matches: Array<{ code: string; start: number; end: number }> = []

  const consider = (phrase: string, code: string) => {
    const at = haystack.indexOf(` ${phrase} `)
    if (at !== -1)
      matches.push({ code, start: at, end: at + phrase.length + 2 })
  }

  for (const country of COUNTRIES) {
    consider(normaliseForMatch(country.name), country.code)
  }
  for (const [demonym, code] of Object.entries(COUNTRY_DEMONYMS)) {
    consider(demonym, code)
  }
  if (matches.length === 0) return null

  const outermost = matches.filter(
    (m) =>
      !matches.some(
        (other) =>
          other !== m &&
          other.start <= m.start &&
          other.end >= m.end &&
          other.end - other.start > m.end - m.start,
      ),
  )
  const codes = new Set(outermost.map((m) => m.code))
  return codes.size === 1 ? outermost[0].code : null
}
