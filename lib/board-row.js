// Splitting a board row into what the table draws and what the expanded pane draws.
//
// One /api/board response was 5.8 MB for 600 rows — 3.4 MB of job descriptions and
// 1.7 MB of requirement evidence, all of it for panes that stay hidden until a row is
// expanded. The table needs none of it to draw a row, and render() rebuilt every byte
// of it as HTML on each keystroke in the search box.

/** The fields only the expanded pane reads. */
export const HEAVY = [
  'description', 'requirements', 'why', 'concerns', 'gaps', 'constraints',
  'applyUrl', 'jobUrl', 'department', 'team', 'workplaceType', 'employmentType',
  'judgedAt', 'fitnessModel',
];

/** Everything a table row draws — the columns, the state chip, and the id. */
export function summaryOf(row) {
  const r = row ?? {};
  const out = {};
  for (const k of ['id', 'title', 'slug', 'location', 'pay', 'fitness', 'coverage',
                   'similarity', 'score', 'fresh', 'value', 'daysLive', 'state',
                   'met', 'reqTotal', 'ats', 'fillable']) {
    if (k in r) out[k] = r[k];
    // The table reads these unconditionally, so they must exist even when absent
    // upstream — a missing key renders "undefined", a null renders the em dash.
    else if (['fitness', 'coverage', 'similarity', 'score', 'fresh', 'value', 'daysLive',
              'met', 'reqTotal'].includes(k)) out[k] = null;
  }
  return out;
}

/** Everything the expanded pane draws, fetched only when a row is opened. */
export function detailOf(row) {
  const r = row ?? {};
  return {
    description: r.description ?? '',
    requirements: r.requirements ?? [],
    why: r.why ?? null,
    concerns: r.concerns ?? [],
    gaps: r.gaps ?? [],
    constraints: r.constraints ?? [],
    applyUrl: r.applyUrl ?? null,
    jobUrl: r.jobUrl ?? null,
    department: r.department ?? null,
    team: r.team ?? null,
    workplaceType: r.workplaceType ?? null,
    employmentType: r.employmentType ?? null,
    judgedAt: r.judgedAt ?? null,
    fitnessModel: r.fitnessModel ?? null,
  };
}

/**
 * The board's default ordering — by `value`, which is what the page sorts on.
 *
 * The server used to order by fitness and slice the top N, while the page ordered
 * what it received by value. Every posting under two days old scored below the
 * fitness cutoff and was never sent, so the board's freshest row was two days old
 * while seven newer ones sat on disk unshown. A slice taken on one ordering cannot
 * serve a view ordered by another.
 *
 * Rows with no value sort last rather than first — `null` means "not computed on
 * every front yet", not "worthless" — and fall back to fitness, then similarity.
 */
export function byValue(a, b) {
  const av = a?.value, bv = b?.value;
  if (av != null && bv != null && av !== bv) return bv - av;
  if (av != null && bv == null) return -1;
  if (av == null && bv != null) return 1;
  return (b?.fitness ?? -1) - (a?.fitness ?? -1)
      || (b?.similarity ?? -9) - (a?.similarity ?? -9);
}
