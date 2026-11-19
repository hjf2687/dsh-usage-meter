/**
 * dsh-usage-meter · ledger store
 *
 * One append-only JSONL file per month under the configured directory, plus an
 * in-memory fold that answers every query the settings page and the
 * `usage_stats` tool need.
 *
 * Guarantees this module owns:
 *
 *  - One row per accepted model call. A rejected (duplicate) call is counted in
 *    `stats.duplicates` and never written.
 *  - Every month file is folded into memory at most once. `record()` loads the
 *    target month *before* appending, so a row this process just wrote can
 *    never be scanned back in and counted twice.
 *  - A torn or hand-edited tail line is skipped and counted in
 *    `stats.badLines`; a bad ledger never throws at the caller.
 *
 * Single process, single writer: the running Harness owns this directory.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The seven aggregate columns. `total` is always the sum of the four token sides. */
export const BUCKET_FIELDS = Object.freeze([
  'requests',
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
  'total',
]);

/** Column order used by every renderer. */
export const TOKEN_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite']);

/**
 * Key of the merged "every route outside the top window" trend series. The
 * client never matches on this string; it labels the entry from `other: true`
 * so the name stays localised.
 */
export const OTHER_SERIES_KEY = '__other__';

/** How many named routes the trend chart and the share list show before merging. */
export const TOP_ROUTES = 5;

export function emptyBucket() {
  return { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Local-calendar day key, because "today" on the settings page means the user's today. */
export function dayKey(ts) {
  const date = new Date(Number.isFinite(Number(ts)) ? Number(ts) : Date.now());
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function monthOfDay(day) {
  return String(day).slice(0, 7);
}

/**
 * Normalise one provider `TokenUsage` into ledger columns.
 *
 * DSH guarantees `reasoningTokens ⊆ outputTokens` (the token meter treats a
 * larger reasoning count as invalid), so reasoning is reported separately and
 * never added on top of the output side. `total` is our own consumed-token sum:
 * every token the channel charged the request for is exactly one of
 * input / output / cache-read / cache-write.
 */
export function normaliseUsage(raw) {
  const input = count(raw?.inputTokens);
  const output = count(raw?.outputTokens);
  const cacheRead = count(raw?.cacheReadTokens);
  const cacheWrite = count(raw?.cacheWriteTokens);
  const reasoning = count(raw?.reasoningTokens);
  const reportedTotal = count(raw?.totalTokens);
  return { input, output, cacheRead, cacheWrite, reasoning, reportedTotal, total: input + output + cacheRead + cacheWrite };
}

export function mergeInto(target, source) {
  target.requests += count(source.requests);
  target.input += count(source.input);
  target.output += count(source.output);
  target.cacheRead += count(source.cacheRead);
  target.cacheWrite += count(source.cacheWrite);
  target.reasoning += count(source.reasoning);
  target.total += count(source.total);
  return target;
}

export function isEmptyBucket(bucket) {
  return bucket.requests === 0 && bucket.total === 0;
}

/** `range` → the inclusive local day window a query runs over. `null` means "everything on disk". */
export function resolveRange(range, now = Date.now()) {
  const today = dayKey(now);
  if (range === 'today') return { from: today, to: today };
  if (range === '7d') return { from: dayKey(now - 6 * 86400000), to: today };
  if (range === '30d') return { from: dayKey(now - 29 * 86400000), to: today };
  return { from: null, to: today };
}

const MONTH_FILE = /^events-(\d{4}-\d{2})\.jsonl$/;

function monthsBetween(fromDay, toDay) {
  const months = [];
  let year = Number(String(fromDay).slice(0, 4));
  let month = Number(String(fromDay).slice(5, 7));
  const endYear = Number(String(toDay).slice(0, 4));
  const endMonth = Number(String(toDay).slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(endYear) || !Number.isFinite(endMonth)) return months;
  for (let guard = 0; guard < 600; guard += 1) {
    months.push(`${year}-${pad2(month)}`);
    if (year === endYear && month === endMonth) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export class UsageStore {
  /**
   * @param {{dir: string, dedupWindowMs?: number, log?: (level: string, message: string) => void}} options
   */
  constructor(options) {
    this.dir = String(options.dir);
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.dedupWindowMs = Math.max(0, count(options.dedupWindowMs) || 0);
    /** fingerprint → timestamp of the last accepted call carrying it. */
    this.fingerprints = new Map();
    /** month → true once its file is folded into `buckets`. */
    this.loadedMonths = new Set();
    /** `${day}\0${provider}\0${model}` → bucket. */
    this.buckets = new Map();
    this.stats = { appended: 0, backfilled: 0, duplicates: 0, writeErrors: 0, scannedRows: 0, badLines: 0, months: 0 };
    this.firstDay = null;
    this.lastDay = null;
    this.lastWriteAt = null;
    this.lastError = null;
  }

  fileFor(month) {
    return path.join(this.dir, `events-${month}.jsonl`);
  }

  /**
   * Append one accepted call.
   * @returns {boolean} true when a row was written, false when it was a duplicate or the write failed.
   */
  record(input) {
    const at = Number.isFinite(Number(input?.ts)) ? Number(input.ts) : Date.now();
    const provider = typeof input?.provider === 'string' && input.provider !== '' ? input.provider : 'unknown';
    const model = typeof input?.model === 'string' && input.model !== '' ? input.model : 'unknown';
    const purpose = typeof input?.purpose === 'string' && input.purpose !== '' ? input.purpose : 'main';
    const sessionId = typeof input?.sessionId === 'string' && input.sessionId !== '' ? input.sessionId : null;
    const usage = input?.usage ?? {};
    const values = {
      input: count(usage.input),
      output: count(usage.output),
      cacheRead: count(usage.cacheRead),
      cacheWrite: count(usage.cacheWrite),
      reasoning: count(usage.reasoning),
      total: count(usage.total),
    };

    if (this.dedupWindowMs > 0) {
      const fingerprint = [provider, model, purpose, sessionId ?? '', values.input, values.output, values.cacheRead, values.cacheWrite].join('|');
      const previous = this.fingerprints.get(fingerprint);
      if (previous !== undefined && at - previous <= this.dedupWindowMs) {
        this.stats.duplicates += 1;
        this.fingerprints.set(fingerprint, at);
        return false;
      }
      this.fingerprints.set(fingerprint, at);
      if (this.fingerprints.size > 4096) this.pruneFingerprints(at);
    }

    const day = dayKey(at);
    const row = {
      ts: at,
      day,
      provider,
      model,
      purpose,
      sessionId,
      input: values.input,
      output: values.output,
      cacheRead: values.cacheRead,
      cacheWrite: values.cacheWrite,
      reasoning: values.reasoning,
      total: values.total,
      reportedTotal: count(usage.reportedTotal),
      source: typeof input?.source === 'string' && input.source !== '' ? input.source : 'stream',
    };

    const month = monthOfDay(day);
    // Fold the month *before* writing into it: a month this process appended to
    // must already be in memory, otherwise a later range query would scan the
    // row back in and count it a second time.
    this.ensureMonth(month);

    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.fileFor(month), `${JSON.stringify(row)}\n`, 'utf8');
      this.stats.appended += 1;
      this.lastWriteAt = at;
    } catch (error) {
      this.stats.writeErrors += 1;
      this.lastError = `append failed: ${describeError(error)}`;
      this.log('warn', `cannot append ledger row: ${describeError(error)}`);
      return false;
    }

    this.accumulate(day, provider, model, { ...values, requests: 1 });
    return true;
  }

  /**
   * Bulk-append historical rows, one write per month file.
   *
   * Used only by the backfill. It deliberately skips the dedup window: those
   * rows describe calls the live listener never saw, and folding them is the
   * whole point. Each month is still loaded before it is appended to, so the
   * "fold exactly once" invariant holds here too.
   *
   * @param {Array<object>} rows ledger rows without `day`, already normalised
   * @returns {number} how many rows were written
   */
  ingest(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const byMonth = new Map();
    for (const row of rows) {
      if (row === null || typeof row !== 'object') continue;
      const day = dayKey(row.ts);
      const month = monthOfDay(day);
      let list = byMonth.get(month);
      if (list === undefined) {
        list = [];
        byMonth.set(month, list);
      }
      list.push({ ...row, day });
    }

    let written = 0;
    for (const [month, list] of byMonth) {
      list.sort((left, right) => Number(left.ts) - Number(right.ts));
      this.ensureMonth(month);
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.appendFileSync(this.fileFor(month), list.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
      } catch (error) {
        this.stats.writeErrors += 1;
        this.lastError = `backfill append failed: ${describeError(error)}`;
        this.log('warn', `cannot append backfilled rows: ${describeError(error)}`);
        continue;
      }
      for (const row of list) {
        this.accumulate(row.day, row.provider, row.model, row);
        written += 1;
      }
      this.stats.appended += list.length;
      this.stats.backfilled += list.length;
    }
    if (written > 0) this.lastWriteAt = Date.now();
    return written;
  }

  /** The timestamp of the oldest row on disk, or null when the ledger is empty. */
  earliestTimestamp() {
    let earliest = null;
    for (const month of this.listMonths()) {
      let text;
      try {
        text = fs.readFileSync(this.fileFor(month), 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') this.log('warn', `cannot read ${this.fileFor(month)}: ${describeError(error)}`);
        continue;
      }
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        let row;
        try {
          row = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const ts = Number(row?.ts);
        if (Number.isFinite(ts)) earliest = earliest === null ? ts : Math.min(earliest, ts);
      }
    }
    return earliest;
  }

  accumulate(day, provider, model, values) {
    const key = `${day}\u0000${provider}\u0000${model}`;
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = emptyBucket();
      this.buckets.set(key, bucket);
    }
    bucket.requests += 1;
    bucket.input += values.input;
    bucket.output += values.output;
    bucket.cacheRead += values.cacheRead;
    bucket.cacheWrite += values.cacheWrite;
    bucket.reasoning += values.reasoning;
    bucket.total += values.total;
    if (this.firstDay === null || day < this.firstDay) this.firstDay = day;
    if (this.lastDay === null || day > this.lastDay) this.lastDay = day;
  }

  pruneFingerprints(now) {
    const cutoff = now - Math.max(this.dedupWindowMs, 60000);
    for (const [fingerprint, at] of this.fingerprints) {
      if (at < cutoff) this.fingerprints.delete(fingerprint);
    }
  }

  ensureMonth(month) {
    if (this.loadedMonths.has(month)) return;
    this.loadedMonths.add(month);
    this.loadFile(this.fileFor(month), month);
  }

  /** Every month file on disk, newest last. */
  listMonths() {
    let entries;
    try {
      entries = fs.readdirSync(this.dir);
    } catch (error) {
      if (error?.code !== 'ENOENT') this.log('warn', `cannot list ${this.dir}: ${describeError(error)}`);
      return [];
    }
    return entries
      .map((name) => MONTH_FILE.exec(name)?.[1])
      .filter((month) => typeof month === 'string')
      .sort();
  }

  ensureRange(fromDay, toDay) {
    const months = fromDay === null ? this.listMonths() : monthsBetween(fromDay, toDay);
    for (const month of months) this.ensureMonth(month);
  }

  loadFile(file, month) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.lastError = `read failed: ${describeError(error)}`;
        this.log('warn', `cannot read ${file}: ${describeError(error)}`);
      }
      return;
    }
    this.stats.months += 1;
    let start = 0;
    for (let index = 0; index <= text.length; index += 1) {
      if (index !== text.length && text.charCodeAt(index) !== 10) continue;
      const line = text.slice(start, index).trim();
      start = index + 1;
      if (line === '') continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        this.stats.badLines += 1;
        continue;
      }
      if (row === null || typeof row !== 'object') {
        this.stats.badLines += 1;
        continue;
      }
      const day = typeof row.day === 'string' && row.day !== '' ? row.day : dayKey(row.ts);
      if (monthOfDay(day) !== month) {
        // A row filed under the wrong month: still counted, keyed by its own day.
        this.log('warn', `row in ${file} belongs to ${day}`);
      }
      this.stats.scannedRows += 1;
      this.accumulate(
        day,
        typeof row.provider === 'string' && row.provider !== '' ? row.provider : 'unknown',
        typeof row.model === 'string' && row.model !== '' ? row.model : 'unknown',
        {
          input: count(row.input),
          output: count(row.output),
          cacheRead: count(row.cacheRead),
          cacheWrite: count(row.cacheWrite),
          reasoning: count(row.reasoning),
          total: count(row.total),
        },
      );
    }
  }

  /**
   * Grouped totals for one window.
   * @param {{range?: string, groupBy?: string, provider?: string, model?: string, limit?: number}} options
   */
  summary(options = {}) {
    const groupBy = GROUPINGS.has(options.groupBy) ? options.groupBy : 'provider';
    const { from, to } = resolveRange(options.range);
    const limit = Math.min(Math.max(count(options.limit) || 50, 1), 500);
    const provider = typeof options.provider === 'string' && options.provider !== '' ? options.provider : null;
    const model = typeof options.model === 'string' && options.model !== '' ? options.model : null;

    this.ensureRange(from, to);

    const groups = new Map();
    for (const [key, bucket] of this.buckets) {
      const [day, channel, modelId] = key.split('\u0000');
      if (to !== null && day > to) continue;
      if (from !== null && day < from) continue;
      if (provider !== null && channel !== provider) continue;
      if (model !== null && modelId !== model) continue;
      const groupKey = groupKeyOf(groupBy, day, channel, modelId);
      let target = groups.get(groupKey);
      if (target === undefined) {
        target = emptyBucket();
        groups.set(groupKey, target);
      }
      mergeInto(target, bucket);
    }

    const totals = emptyBucket();
    const rows = [];
    for (const [key, bucket] of groups) {
      mergeInto(totals, bucket);
      rows.push({ key, ...bucket });
    }
    rows.sort(groupBy === 'day' ? byDay : byTotal);
    const truncated = rows.length > limit;
    return {
      range: RANGES.has(options.range) ? options.range : 'all',
      groupBy,
      from,
      to,
      provider,
      model,
      totals,
      rows: truncated ? rows.slice(0, limit) : rows,
      groups: rows.length,
      truncated,
    };
  }

  /**
   * Everything the settings page draws, in one pass over the fold: KPI totals,
   * the rolling-year heat grid, the per-day trend split by route, and the route
   * share. One request instead of four keeps the page from flickering.
   *
   * @param {{range?: string, heatmapDays?: number, series?: number}} options
   */
  overview(options = {}) {
    const { from, to } = resolveRange(options.range);
    const heatmapDays = Math.min(Math.max(count(options.heatmapDays) || 365, 30), 400);
    const heatTo = dayKey(Date.now());
    const heatFrom = dayKey(Date.now() - (heatmapDays - 1) * 86400000);
    const seriesLimit = Math.min(Math.max(count(options.series) || TOP_ROUTES, 1), 8);

    this.ensureRange(from, to);
    if (from !== null && from > heatFrom) this.ensureRange(heatFrom, heatTo);

    const totals = emptyBucket();
    const routes = new Map();
    const days = new Map();
    /** `${day}\0${route}` → total tokens, for the trend series. */
    const routeDay = new Map();
    const heat = new Map();
    const activeDays = new Set();

    for (const [key, bucket] of this.buckets) {
      const [day, provider, model] = key.split('\u0000');
      if (day >= heatFrom && day <= heatTo) heat.set(day, (heat.get(day) ?? 0) + bucket.total);
      if (to !== null && day > to) continue;
      if (from !== null && day < from) continue;

      activeDays.add(day);
      mergeInto(totals, bucket);

      let dayBucket = days.get(day);
      if (dayBucket === undefined) {
        dayBucket = emptyBucket();
        days.set(day, dayBucket);
      }
      mergeInto(dayBucket, bucket);

      const routeKey = `${provider} / ${model}`;
      let routeBucket = routes.get(routeKey);
      if (routeBucket === undefined) {
        routeBucket = emptyBucket();
        routes.set(routeKey, routeBucket);
      }
      mergeInto(routeBucket, bucket);

      const slot = `${day}\u0000${routeKey}`;
      routeDay.set(slot, (routeDay.get(slot) ?? 0) + bucket.total);
    }

    const routeRows = [...routes].map(([key, bucket]) => ({ key, ...bucket })).sort(byTotal);
    const dayRows = [...days].map(([day, bucket]) => ({ day, ...bucket })).sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0));
    const peak = dayRows.reduce((best, row) => (best === null || row.total > best.total ? row : best), null);

    const top = routeRows.slice(0, seriesLimit).map((row) => row.key);
    const indexOfRoute = new Map(top.map((key, index) => [key, index]));
    const series = top.map((key) => ({ key, points: [] }));
    /**
     * Every route outside the top window folds into one merged `other` series,
     * so a long tail of near-zero routes does not add a line per route.
     */
    const hasOther = routeRows.length > seriesLimit;
    const otherDays = new Map();
    for (const [slot, total] of routeDay) {
      const separator = slot.indexOf('\u0000');
      const day = slot.slice(0, separator);
      const index = indexOfRoute.get(slot.slice(separator + 1));
      if (index !== undefined) {
        series[index].points.push({ day, total });
        continue;
      }
      if (hasOther) otherDays.set(day, (otherDays.get(day) ?? 0) + total);
    }
    for (const entry of series) entry.points.sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0));
    if (hasOther && otherDays.size > 0) {
      series.push({
        key: OTHER_SERIES_KEY,
        other: true,
        points: [...otherDays].map(([day, total]) => ({ day, total })).sort((left, right) => (left.day < right.day ? -1 : left.day > right.day ? 1 : 0)),
      });
    }

    return {
      range: RANGES.has(options.range) ? options.range : 'all',
      from,
      to,
      heatFrom,
      heatTo,
      totals,
      activeDays: activeDays.size,
      firstDay: dayRows.length > 0 ? dayRows[0].day : null,
      lastDay: dayRows.length > 0 ? dayRows[dayRows.length - 1].day : null,
      peakDay: peak === null ? null : { day: peak.day, total: peak.total, requests: peak.requests },
      routes: routeRows,
      days: dayRows,
      series,
      heatmap: [...heat].map(([day, total]) => ({ day, total })),
    };
  }

  /**
   * Recent raw rows, newest first — the settings page drill-down.
   *
   * Paging happens here rather than in the browser: `offset` skips rows after
   * the newest-first sort, and `matched` always reports how many rows the
   * filter selected in total, which is what the page footer divides into pages.
   */
  events(options = {}) {
    const { from, to } = resolveRange(options.range);
    const limit = Math.min(Math.max(count(options.limit) || 100, 1), 2000);
    const offset = Math.max(count(options.offset), 0);
    const provider = typeof options.provider === 'string' && options.provider !== '' ? options.provider : null;
    const model = typeof options.model === 'string' && options.model !== '' ? options.model : null;

    const months = from === null ? this.listMonths().slice(-3) : monthsBetween(from, to);
    const kept = [];
    for (const month of months) {
      let text;
      try {
        text = fs.readFileSync(this.fileFor(month), 'utf8');
      } catch (error) {
        if (error?.code !== 'ENOENT') this.log('warn', `cannot read ${this.fileFor(month)}: ${describeError(error)}`);
        continue;
      }
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        let row;
        try {
          row = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (row === null || typeof row !== 'object') continue;
        const day = typeof row.day === 'string' && row.day !== '' ? row.day : dayKey(row.ts);
        if (to !== null && day > to) continue;
        if (from !== null && day < from) continue;
        if (provider !== null && row.provider !== provider) continue;
        if (model !== null && row.model !== model) continue;
        kept.push(row);
      }
    }
    kept.sort((a, b) => count(b.ts) - count(a.ts));
    return {
      rows: kept.slice(offset, offset + limit),
      matched: kept.length,
      offset: Math.min(offset, kept.length),
      limit,
      scannedMonths: months,
    };
  }

  health() {
    return {
      dir: this.dir,
      dedupWindowMs: this.dedupWindowMs,
      firstDay: this.firstDay,
      lastDay: this.lastDay,
      lastWriteAt: this.lastWriteAt,
      lastError: this.lastError,
      loadedMonths: [...this.loadedMonths].sort(),
      groups: this.buckets.size,
      stats: { ...this.stats },
    };
  }
}

export const GROUPINGS = Object.freeze(new Set(['provider', 'model', 'provider-model', 'day']));
export const RANGES = Object.freeze(new Set(['today', '7d', '30d', 'all']));

export function groupKeyOf(groupBy, day, provider, model) {
  if (groupBy === 'model') return model;
  if (groupBy === 'provider-model') return `${provider} / ${model}`;
  if (groupBy === 'day') return day;
  return provider;
}

function byTotal(a, b) {
  if (b.total !== a.total) return b.total - a.total;
  if (b.requests !== a.requests) return b.requests - a.requests;
  return a.key.localeCompare(b.key);
}

function byDay(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function describeError(error) {
  if (error === null || error === undefined) return 'unknown error';
  const code = typeof error.code === 'string' && error.code !== '' ? `${error.code}: ` : '';
  return `${code}${String(error.message ?? error)}`;
}