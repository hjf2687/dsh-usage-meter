/**
 * dsh-usage-meter · historical backfill
 *
 * The live half only sees model calls that happen after the plugin was loaded.
 * This half folds the **durable session logs** instead, so every channel/model
 * that was ever used shows up — including everything before the plugin existed.
 *
 * The fold mirrors the Harness's own `tokenUsage` projection, which is what
 * makes its totals comparable with the live capture:
 *
 *  - `request/header` publishes the route (`header.config.provider/model`).
 *  - `assistant/message` carries the settlement's own `usage` and, on
 *    `message.source`, the route that produced it; `assistant/attempt` carries
 *    usage only inside its recorded stream.
 *  - A settlement **replaces** the earlier sample of the same `(turn, step)`
 *    slot, and an identical repeat changes nothing; `llm/retry-started` closes
 *    that slot so a retried attempt is billed separately.
 *  - A forked session's log begins with the parent's inherited prefix, and
 *    those turns were already billed under the parent, so `inheritedEventCount`
 *    leading events are skipped.
 *
 * Everything here is plain ESM with Node builtins only.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Bumped when the state file's meaning changes, so an old one is re-run. */
const STATE_VERSION = 1;

/**
 * Backfill only folds settlements older than the plugin's first live capture,
 * minus this guard. A settlement's `time` can sit a few milliseconds before the
 * live row it produced, and folding it as well would count that one call twice.
 */
const GUARD_MS = 5000;

/** Sessions folded at once. Each read decompresses a whole log, so this is a memory ceiling too. */
const READ_CONCURRENCY = 4;

/** The purpose every backfilled row carries, so historical and live rows stay distinguishable. */
export const BACKFILL_PURPOSE = 'backfill';

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function tokenBuckets(usage) {
  return {
    input: count(usage?.inputTokens),
    output: count(usage?.outputTokens),
    cacheRead: count(usage?.cacheReadTokens),
    cacheWrite: count(usage?.cacheWriteTokens),
    reasoning: count(usage?.reasoningTokens),
    reportedTotal: count(usage?.totalTokens),
  };
}

function sameTokens(left, right) {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite
  );
}

/** The last `usage` chunk recorded inside an attempt's stream. */
function lastUsageInStream(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record === null || typeof record !== 'object') continue;
    if (record.type !== 'chunk') continue;
    const chunk = record.chunk;
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== null && typeof chunk.usage === 'object') {
      return chunk.usage;
    }
  }
  return undefined;
}

/** The usage one settlement reports, from its own field or its embedded stream. */
function usageOf(event, data) {
  if (event.type === 'assistant/message' && data.usage !== null && typeof data.usage === 'object') return data.usage;
  return lastUsageInStream(data.stream);
}

/** The route a settling assistant message was produced by, when it names one. */
function sourceRoute(data) {
  const source = data.message?.source;
  if (source === null || typeof source !== 'object') return undefined;
  const provider = source.provider;
  const model = source.model;
  if (typeof provider !== 'string' || typeof model !== 'string') return undefined;
  if (provider === '' || model === '') return undefined;
  return { provider, model };
}

/**
 * Fold one session's event log into one sample per billable settlement.
 *
 * @param {readonly unknown[]} events the session's raw events, in seq order
 * @param {number} skipBefore how many leading events are inherited from a parent session
 * @returns {Array<{time: number, provider: string, model: string, tokens: object}>}
 */
export function foldEvents(events, skipBefore = 0) {
  const samples = [];
  if (!Array.isArray(events)) return samples;
  const from = Math.max(0, Math.min(count(skipBefore), events.length));
  let routeProvider = 'unknown';
  let routeModel = 'unknown';
  let last = null;

  for (let index = from; index < events.length; index += 1) {
    const event = events[index];
    if (event === null || typeof event !== 'object') continue;
    const type = event.type;
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {};

    if (type === 'request/header') {
      const config = data.header?.config;
      const provider = config?.provider;
      const model = config?.model;
      if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
        routeProvider = provider;
        routeModel = model;
      }
      continue;
    }

    if (type === 'llm/retry-started') {
      if (last !== null && last.turn === data.turn && last.step === data.step) last = null;
      continue;
    }

    if (type !== 'assistant/message' && type !== 'assistant/attempt') continue;

    const usage = usageOf(event, data);
    if (usage === undefined) continue;
    const tokens = tokenBuckets(usage);

    const attached = type === 'assistant/message' ? sourceRoute(data) : undefined;
    const provider = attached === undefined ? routeProvider : attached.provider;
    const model = attached === undefined ? routeModel : attached.model;

    const turn = data.turn;
    const step = data.step;
    const slot = last !== null && last.turn === turn && last.step === step ? last : null;
    const time = Number.isFinite(Number(event.time)) ? Number(event.time) : Date.now();

    if (slot !== null && sameTokens(samples[slot.index].tokens, tokens)) continue;
    if (slot === null) {
      samples.push({ time, provider, model, tokens });
      last = { turn, step, index: samples.length - 1 };
    } else {
      samples[slot.index] = { time, provider, model, tokens };
      last = slot;
    }
  }
  return samples;
}

export function backfillStatePath(dir) {
  return path.join(dir, 'backfill.json');
}

export function readBackfillState(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(backfillStatePath(dir), 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeBackfillState(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(backfillStatePath(dir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function rowOf(sample, sessionId) {
  const tokens = sample.tokens;
  return {
    ts: sample.time,
    provider: sample.provider,
    model: sample.model,
    purpose: BACKFILL_PURPOSE,
    sessionId,
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    reasoning: tokens.reasoning,
    total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
    reportedTotal: tokens.reportedTotal,
    source: 'session-log',
  };
}

async function mapBounded(items, limit, worker) {
  const results = [];
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners = [];
  for (let index = 0; index < width; index += 1) {
    runners.push(
      (async () => {
        for (;;) {
          const current = cursor;
          cursor += 1;
          if (current >= items.length) return;
          results[current] = await worker(items[current], current);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

/**
 * Fold every durable session log into the ledger, once.
 *
 * - Idempotent: a completed run writes `backfill.json` and later activations
 *   (including a disable/enable cycle) return that state instead of re-reading.
 * - Non-blocking: activation must never wait on this; the caller runs it detached.
 * - Best-effort: one unreadable session costs that session, never the run.
 *
 * @param {{ctx: object, store: object, dir: string, log: Function, maxSessions?: number, now?: () => number}} options
 */
export async function runBackfill(options) {
  const { ctx, store, dir, log } = options;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const maxSessions = count(options.maxSessions) || 1000;

  const previous = readBackfillState(dir);
  if (previous !== null && previous.version === STATE_VERSION && previous.completedAt !== undefined) {
    return { state: 'done', ...previous, reused: true };
  }

  const service = typeof ctx?.get === 'function' ? ctx.get('sessionQuery') : undefined;
  if (service === undefined || typeof service.listSessions !== 'function' || typeof service.readSession !== 'function') {
    const settled = { version: STATE_VERSION, completedAt: null, state: 'unavailable', reason: 'no sessionQuery service in this composition' };
    return settled;
  }

  // The ledger's own earliest row is the moment live capture started; everything
  // older than that (minus the guard) is what this fold owes the user.
  const earliest = typeof store.earliestTimestamp === 'function' ? store.earliestTimestamp() : null;
  const liveFrom = earliest === null ? now() : earliest;
  const cutoff = liveFrom - GUARD_MS;

  let records;
  try {
    records = await service.listSessions();
  } catch (error) {
    log('warn', `backfill cannot list sessions: ${String(error?.message ?? error)}`);
    return { version: STATE_VERSION, completedAt: null, state: 'failed', reason: String(error?.message ?? error) };
  }
  const list = (Array.isArray(records) ? records : []).slice(0, maxSessions);

  const rows = [];
  let sessions = 0;
  let unreadable = 0;
  let skippedLive = 0;

  await mapBounded(list, READ_CONCURRENCY, async (record) => {
    const id = record?.header?.id;
    if (typeof id !== 'string' || id === '') return;
    let snapshot;
    try {
      snapshot = await service.readSession(id);
    } catch (error) {
      unreadable += 1;
      log('warn', `backfill cannot read session ${id}: ${String(error?.message ?? error)}`);
      return;
    }
    sessions += 1;
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    for (const sample of foldEvents(events, count(snapshot?.inheritedEventCount))) {
      if (sample.time >= cutoff) {
        skippedLive += 1;
        continue;
      }
      rows.push(rowOf(sample, id));
    }
  });

  const written = typeof store.ingest === 'function' ? store.ingest(rows) : 0;
  const state = {
    version: STATE_VERSION,
    completedAt: now(),
    state: 'done',
    liveFrom,
    cutoff,
    sessions,
    records: list.length,
    samples: written,
    skippedLive,
    unreadable,
  };
  if (!writeBackfillState(dir, state)) {
    log('warn', `backfill finished but its state file could not be written to ${dir}; it will run again next activation`);
  }
  return state;
}