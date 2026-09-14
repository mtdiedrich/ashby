// Ashby's descriptionPlain carries the formatting debris of whatever editor the
// job was pasted from: runs of blank lines, lines holding a single non-breaking
// space, trailing whitespace, zero-width characters. One posting had 40+ lines of
// nothing in it. That is noise on screen and tokens on the invoice, since the whole
// description goes into the scoring prompt.

// Built from codepoints rather than written as literals: these characters are
// invisible in a source file, and a literal one pasted into a character class
// silently becomes part of a range instead of a member of it.
//   200B zero-width space · 2060 word joiner · FEFF BOM
const ZERO_WIDTH = new RegExp('[' + String.fromCharCode(0x200b, 0x2060, 0xfeff) + ']', 'g');
//   2028 line separator · 2029 paragraph separator
const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** Normalise a job description: real blank lines only, at most one in a row. */
export function tidy(s) {
  if (!s) return '';
  return String(s)
    .replace(ZERO_WIDTH, '')         // drop entirely, they are not spacing
    .replace(LINE_SEPS, '\n')
    .replace(/\r\n?/g, '\n')         // CRLF -> LF
    // JS \s already covers U+00A0 and the U+2000-200A space run, so trimming the
    // end of each line turns a nbsp-only line into an empty one.
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')      // never more than one blank line
    .trim();
}
