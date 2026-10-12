// Location matching, for the board's "US only" toggle and the levels.fyi lookup.
//
// This file used to hold the title filter too (WANT/REJECT/wantedTitle), which
// decided which postings were scored and which had their descriptions stored. It was
// dropped on 2026-10-03: every posting is scored, and nothing here filters the
// pipeline any more.

export const US_LOC = new RegExp([
  'united states', '\\bu\\.?s\\.?a?\\b', '\\bus[- ]remote\\b',
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware',
  'florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana',
  'maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana',
  'nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina',
  'north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina',
  'south dakota|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming',
  'san francisco|\\bsf\\b|palo alto|mountain view|menlo park|redwood city|san jose',
  'sunnyvale|santa clara|san mateo|cupertino|oakland|berkeley|los angeles|san diego|santa monica',
  'seattle|bellevue|redmond|portland|denver|boulder|austin|dallas|houston',
  'chicago|boston|cambridge|brooklyn|nyc|atlanta|miami|philadelphia|pittsburgh',
  'minneapolis|detroit|phoenix|salt lake city|nashville|raleigh|durham|washington, d',
].join('|'), 'i');

// Places abroad. A "Remote" posting still has a region in practice, and "Remote -
// Colombia" is not a job you can take from Iowa. This named ~50 places once, and the
// board's top rows filled with "Remote – Ukraine", "Colombia - Fully Remote" and
// "Remote, Ontario" — so it is every country now, plus the Canadian provinces, the
// regions, and the foreign cities boards write without a country. Deliberately NOT
// here: "georgia" (a state). Names that are also US places — "New Mexico", "Mexico,
// MO", "Panama City, FL" — are kept by usLocation finding a US place or state code in
// the same location before this rules it out.
const ABROAD = [
  // countries
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina', 'armenia', 'australia',
  'austria', 'azerbaijan', 'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus', 'belgium',
  'belize', 'benin', 'bhutan', 'bolivia', 'bosnia', 'botswana', 'brazil', 'brasil', 'brunei',
  'bulgaria', 'burkina faso', 'burundi', 'cambodia', 'cameroon', 'canada', 'cape verde', 'chad',
  'chile', 'china', 'colombia', 'congo', 'costa rica', 'croatia', 'cuba', 'cyprus', 'czech',
  'czechia', 'denmark', 'djibouti', 'dominican republic', 'ecuador', 'egypt', 'el salvador',
  'estonia', 'eswatini', 'ethiopia', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'germany',
  'deutschland', 'ghana', 'greece', 'guatemala', 'guinea', 'guyana', 'haiti', 'honduras',
  'hong kong', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq', 'ireland', 'israel',
  'italy', 'ivory coast', "c[oô]te d'ivoire", 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya',
  'korea', 'kosovo', 'kuwait', 'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia',
  'libya', 'liechtenstein', 'lithuania', 'luxembourg', 'macau', 'madagascar', 'malawi', 'malaysia',
  'maldives', 'mali', 'malta', 'mauritania', 'mauritius', 'mexico', 'méxico', 'moldova', 'monaco',
  'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'namibia', 'nepal', 'netherlands',
  'new zealand', 'nicaragua', 'niger', 'nigeria', 'north macedonia', 'macedonia', 'norway', 'oman',
  'pakistan', 'palestine', 'panama', 'papua new guinea', 'paraguay', 'peru', 'philippines',
  'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'saudi arabia', 'senegal', 'serbia',
  'sierra leone', 'singapore', 'slovakia', 'slovenia', 'somalia', 'south africa', 'spain', 'españa',
  'sri lanka', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria', 'taiwan', 'tajikistan',
  'tanzania', 'thailand', 'togo', 'trinidad', 'tunisia', 'turkey', 't[uü]rkiye', 'turkmenistan',
  'uganda', 'ukraine', 'united arab emirates', 'uae', 'united kingdom', 'uk', 'england', 'scotland',
  'wales', 'northern ireland', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam', 'viet nam', 'yemen',
  'zambia', 'zimbabwe',
  // Canadian provinces
  'ontario', 'quebec', 'québec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan',
  'nova scotia', 'new brunswick', 'newfoundland',
  // regions
  'european union', 'europe', 'european', 'emea', 'apac', 'latam', 'latin america', 'south america',
  'central america', 'asia', 'asia pacific', 'africa', 'middle east', 'mena', 'nordics', 'dach',
  'benelux', 'remote - eu',
  // cities written without their country
  'tokyo', 'seoul', 'delhi', 'bangalore', 'bengaluru', 'pune', 'hyderabad', 'chennai', 'mumbai',
  'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'abu dhabi', 'dubai', 'riyadh', 'doha',
  'london', 'manchester', 'edinburgh', 'dublin', 'paris', 'berlin', 'munich', 'stuttgart',
  'darmstadt', 'frankfurt', 'hamburg', 'cologne', 'düsseldorf', 'amsterdam', 'rotterdam', 'zurich',
  'zürich', 'geneva', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'madrid', 'barcelona', 'milan',
  'rome', 'warsaw', 'krakow', 'kraków', 'prague', 'vienna', 'budapest', 'bucharest', 'sofia',
  'belgrade', 'kyiv', 'kiev', 'lviv', 'vilnius', 'riga', 'tallinn', 'lisbon', 'porto', 'brussels',
  'tel aviv', 'istanbul', 'cairo', 'lagos', 'nairobi', 'cape town', 'johannesburg', 'sydney',
  'melbourne', 'brisbane', 'auckland', 'toronto', 'vancouver', 'montreal', 'montréal', 'ottawa',
  'calgary', 'são paulo', 'sao paulo', 'rio de janeiro', 'curitiba', 'belo horizonte',
  'buenos aires', 'bogot[aá]', 'medell[ií]n', 'santiago', 'mexico city', 'guadalajara',
  'monterrey', 'manila', 'jakarta', 'kuala lumpur', 'bangkok', 'ho chi minh', 'hanoi', 'shanghai',
  'beijing', 'shenzhen', 'taipei',
];
// Letter boundaries rather than \b, which is ASCII-only and splits "Zürich" and "México".
export const BLOCK_LOC = new RegExp('(?:^|[^\\p{L}])(' + ABROAD.join('|') + ')(?![\\p{L}])', 'iu');

// Location text that is acceptable without naming a US place — a bare "Remote"
// with nothing abroad attached. "Anywhere", "Worldwide" and "North America" are roles
// you can hold from the US.
export const OK_LOC = new RegExp([
  'remote', 'united states', '\\bu\\.?s\\.?a?\\b', 'iowa', 'cedar rapids',
  'anywhere', 'worldwide', '\\bglobal\\b', 'north america',
].join('|'), 'i');

// State codes, as boards write them. US_LOC once listed 26 of the 50, matched
// case-insensitively, so ~4,500 US postings ("St. Louis, MO") read as abroad while
// "or" and "ca" matched inside "Hamburg or Berlin" and "Toronto, CA". Every rule below
// was checked against the corpus's real location strings.
const CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'PR',
];
// Also country codes — "Pune, IN", "Darmstadt, DE", "Curitiba, PR", "IN - Jaipur".
const COUNTRY_TOO = ['DE', 'IN', 'PR'];
// Also words, so title case is not trusted for them: ", Or remote", ", In office",
// "Paris, La Défense".
const WORDS_TOO = ['OR', 'IN', 'ME', 'DE', 'LA'];
const NOT_ALNUM_AFTER = '(?![A-Za-z0-9])';           // "CT4" is a UK postcode

const commaForm = codes => new RegExp(',\\s*(' + codes.flatMap(c =>
  WORDS_TOO.includes(c) ? [c] : [c, c[0] + c[1].toLowerCase()]).join('|') + ')' + NOT_ALNUM_AFTER);

/** After a comma, upper or title case: "St. Louis, MO", "Killeen, Tx". */
export const STATE_CODE = commaForm(CODES);

// A bare uppercase token — "Hayward CA", "TX - Carrollton", "AZ_Mesa_HQ", "NY". Not
// the country codes, and "OR" only leading or after a comma ("Hanoi OR Ho Chi Minh").
export const STATE_TOKEN = new RegExp('(?<![A-Za-z0-9])(' +
  CODES.filter(c => !COUNTRY_TOO.includes(c) && c !== 'OR').join('|') + ')' + NOT_ALNUM_AFTER +
  '|(?:^|,\\s*)OR' + NOT_ALNUM_AFTER);

// What outweighs a place abroad named in the same primary location: a comma state
// code that is not also a country — "Vancouver, WA", "Panama City, FL", "Lebanon, NH",
// and "Boston, MA; … Toronto, ON", which names the US too.
const US_STATE_ONLY = commaForm(CODES.filter(c => !COUNTRY_TOO.includes(c)));

// Canadian province codes mark a place abroad like a country name does. Their
// ", CA" suffix is Canada, so it is dropped before looking for a US state.
const PROVINCES = 'ON|BC|QC|AB|MB|SK|NS|NB|NL|PE';
const PROVINCE_CODE = new RegExp(',\\s*(' + PROVINCES + ')' + NOT_ALNUM_AFTER);
const PROVINCE_THEN_CA = new RegExp(',\\s*(' + PROVINCES + ')\\s*,\\s*CA' + NOT_ALNUM_AFTER, 'g');

/** US, judging the primary location first so a US secondary cannot drag one in. */
export function usLocation(primary, combined) {
  const p = primary ?? '';
  const all = combined ?? p;
  // A primary location abroad rules a posting out, whatever its secondaries say — a
  // US office in secondaryLocations must not drag in a London posting. A US place or
  // state in the primary itself outweighs it, so "Panama City, FL" and "Mexico, MO"
  // stay and "Berlin, DE" goes.
  const abroad = BLOCK_LOC.test(p) || PROVINCE_CODE.test(p);
  if (abroad && !(US_LOC.test(p) || US_STATE_ONLY.test(p.replace(PROVINCE_THEN_CA, ', $1')))) return false;
  return US_LOC.test(all) || OK_LOC.test(all) || STATE_CODE.test(all) || STATE_TOKEN.test(all);
}
