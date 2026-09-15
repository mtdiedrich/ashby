// Title filters, shared by poll.js and the board.
//
// They lived in poll.js alone, which meant the embedding ranker happily spent slots
// in its top 25 on an ML Research Intern and an Engineering Manager. Same judgement,
// one definition.

// Titles worth looking at. Two shapes: terms that mean ML on their own, and terms
// that only mean ML next to a role word ("ML" alone matches too much, "ML Engineer"
// and "ML Infrastructure" do not).
export const WANT = new RegExp([
  // unambiguous on their own
  'machine learning', 'deep learning', '\\bmle\\b', '\\bml ?ops\\b', '\\bmlops\\b',
  '\\bllm\\b', '\\bnlp\\b', 'computer vision', 'foundation model',
  'generative ai', '\\bgen ?ai\\b', 'applied scientist', 'applied ai',
  'research (engineer|scientist)', '\\bai\\/ml\\b',
  // only with a role word attached
  '\\bml\\b[ \\/-]?(engineer|infra|infrastructure|platform|systems|scientist|research)',
  '\\bai\\b[ \\/-]?(engineer|infra|infrastructure|platform)',
].join('|'), 'i');

// Titles that match WANT but are never the job. Lawyers whose remit is "Machine
// Learning & AI", SDETs on an inference team, account executives selling AI.
export const REJECT = new RegExp('\\b(' + [
  'intern', 'internship', 'manager', 'director', 'head of', 'vp', 'vice president',
  'recruiter', 'sales', 'marketing', 'account executive', 'chief', 'president',
  'sdet', 'software development engineer in test', 'qa', 'analyst',
  'solutions (architect|engineer|consultant)', 'support', 'designer',
  'frontend', 'front end', 'physical design', 'silicon', 'technical program',
  'sre', 'developer advocate', 'evangelist', 'technical writer',
  'counsel', 'paralegal', 'finance', 'people ops', 'talent',
].join('|') + ')\\b', 'i');

export const US_LOC = new RegExp([
  'united states', '\\bu\\.?s\\.?a?\\b', '\\bus[- ]remote\\b',
  'alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware',
  'florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana',
  'maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana',
  'nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina',
  'north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina',
  'south dakota|tennessee|texas|utah|vermont|virginia|washington|wisconsin|wyoming',
  '\\b(ca|ny|wa|tx|ma|il|co|ga|fl|nc|va|pa|oh|mi|mn|or|ut|az|nj|md|dc|ia|tn|wi|nv)\\b',
  'san francisco|\\bsf\\b|palo alto|mountain view|menlo park|redwood city|san jose',
  'sunnyvale|santa clara|san mateo|cupertino|oakland|berkeley|los angeles|san diego',
  'seattle|bellevue|redmond|portland|denver|boulder|austin|dallas|houston',
  'chicago|boston|cambridge|brooklyn|nyc|atlanta|miami|philadelphia|pittsburgh',
  'minneapolis|detroit|phoenix|salt lake city|nashville|raleigh|durham|washington, d',
].join('|'), 'i');

// Named non-US places. A "Remote" posting still has a region in practice, and
// "Remote - European Union" is not a job you can take from Iowa.
export const BLOCK_LOC = /\b(tokyo|japan|seoul|korea|singapore|delhi|india|bangalore|abu dhabi|dubai|uae|london|uk\b|united kingdom|dublin|ireland|paris|france|berlin|munich|germany|amsterdam|netherlands|zurich|switzerland|stockholm|sweden|oslo|norway|copenhagen|denmark|madrid|barcelona|spain|milan|rome|italy|warsaw|poland|lisbon|portugal|tel aviv|israel|sydney|melbourne|australia|toronto|vancouver|canada|são paulo|brazil|mexico city|european union|europe|european|emea|apac|latam|remote - eu)\b/i;

// Location text that is acceptable without naming a US place — a bare "Remote"
// with nothing abroad attached.
export const OK_LOC = new RegExp([
  'remote', 'united states', '\\bu\\.?s\\.?a?\\b', 'iowa', 'cedar rapids',
].join('|'), 'i');

/** Is this title the kind of role we are looking for at all? */
export const wantedTitle = t => WANT.test(t ?? '') && !REJECT.test(t ?? '');

/** US, judging the primary location first so a US secondary cannot drag one in. */
export function usLocation(primary, combined) {
  const p = primary ?? '';
  const all = combined ?? p;
  // A US city in secondaryLocations must not drag in a London posting.
  if (BLOCK_LOC.test(p) && !US_LOC.test(p)) return false;
  return US_LOC.test(all) || OK_LOC.test(all);
}
