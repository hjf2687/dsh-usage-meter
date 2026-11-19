/**
 * dsh-usage-meter · host half
 *
 * What this plugin adds to a running Harness:
 *
 *  1. **Capture** — a listener on the `llm/stream` waterfall. Every streaming
 *     model call is observed on the way through; whatever `TokenUsage` the
 *     resolved adapter reports is folded into a per-channel × per-model ×
 *     per-day ledger. No pricing, no balance, no money anywhere.
 *  2. **Ledger** — an append-only monthly JSONL file under
 *     `$DSH_HOME/usage-meter/`, owned by `./store.js`.
 *  3. **HTTP surface** — read-only JSON routes under `/dsh-usage-meter/*` for
 *     the settings page.
 *  4. **`usage_stats` tool** — so the model can answer "which channel burned
 *     how many tokens" without a browser.
 *
 * Everything is plain ESM with Node builtins only, so the plugin loads in a
 * profile whose `node_modules` has no Harness packages (the normal desktop
 * case). `lib/plugin.js` re-imports this file whenever it changes on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The bootstrap re-imports this file with a `?v=<closure stamp>` query. Node
// caches modules by resolved URL, so every other module in the closure must
// carry the same query — otherwise an edited `store.js` stays invisible behind
// the cache. A direct import (tests, tools) has no query and gets the plain URL.
const STAMP = new URL(import.meta.url).searchParams.get('v') ?? '';
function closureUrl(relative) {
  const url = new URL(relative, import.meta.url);
  if (STAMP !== '') url.searchParams.set('v', STAMP);
  return url.href;
}

const { UsageStore, dayKey, resolveRange, RANGES, GROUPINGS, normaliseUsage } = await import(closureUrl('./store.js'));
const { runBackfill, readBackfillState } = await import(closureUrl('./backfill.js'));

const NAME = 'dsh-usage-meter';
const TOOL_NAME = 'usage_stats';
const ROUTE_PREFIX = '/dsh-usage-meter';
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const LOG_PREFIX = '[usage-meter]';

/** Deployment defaults; the `config:` block of this plugin's loader row overrides them. */
const DEFAULTS = Object.freeze({
  enabled: true,
  dir: path.join(DSH_HOME, 'usage-meter'),
  // Identical (channel, model, purpose, session, token) tuples closer than this
  // are the same call re-reported (retry/replay) and are folded into one row.
  // 0 disables folding entirely.
  dedupWindowMs: 2000,
  // Purposes to skip. Empty = record everything the runtime asks for.
  excludePurposes: [],
  maxDetailRows: 200,
  // Fold the durable session logs once, so channels/models used before this
  // plugin existed still show up.
  backfill: true,
  backfillMaxSessions: 2000,
});

const RANGE_LABEL = Object.freeze({ today: '今天', '7d': '近 7 天', '30d': '近 30 天', all: '全部' });
const GROUP_LABEL = Object.freeze({ provider: '按渠道', model: '按模型', 'provider-model': '渠道 × 模型', day: '按天' });

const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

function log(level, message) {
  const line = `${LOG_PREFIX} ${message}`;
  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
}

function describeError(error) {
  if (error === null || error === undefined) return 'unknown error';
  const code = typeof error.code === 'string' && error.code !== '' ? `${error.code}: ` : '';
  return `${code}${String(error.message ?? error)}`;
}

function clampInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

function resolveConfig(rawConfig) {
  const raw = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    enabled: raw.enabled !== false,
    dir: typeof raw.dir === 'string' && raw.dir.trim() !== '' ? raw.dir.trim() : DEFAULTS.dir,
    dedupWindowMs: clampInt(raw.dedupWindowMs, DEFAULTS.dedupWindowMs, 0, 60000),
    excludePurposes: Array.isArray(raw.excludePurposes) ? raw.excludePurposes.filter((entry) => typeof entry === 'string') : [],
    maxDetailRows: clampInt(raw.maxDetailRows, DEFAULTS.maxDetailRows, 10, 2000),
    backfill: raw.backfill !== false,
    backfillMaxSessions: clampInt(raw.backfillMaxSessions, DEFAULTS.backfillMaxSessions, 1, 20000),
  };
}

/** Never ship a filesystem path we did not resolve ourselves. */
function publicConfig(config) {
  return {
    enabled: config.enabled,
    dir: config.dir,
    backfill: config.backfill,
    backfillMaxSessions: config.backfillMaxSessions,
    dedupWindowMs: config.dedupWindowMs,
    excludePurposes: [...config.excludePurposes],
    maxDetailRows: config.maxDetailRows,
  };
}

/* -------------------------------------------------------------------------- */
/* Capture                                                                    */
/* -------------------------------------------------------------------------- */

function isAsyncIterable(value) {
  return value !== null && value !== undefined && typeof value[Symbol.asyncIterator] === 'function';
}

function describeCall(options) {
  if (options === null || typeof options !== 'object') return null;
  return {
    provider: typeof options.provider === 'string' && options.provider !== '' ? options.provider : 'unknown',
    model: typeof options.model === 'string' && options.model !== '' ? options.model : 'unknown',
    purpose: typeof options.purpose === 'string' && options.purpose !== '' ? options.purpose : 'main',
    sessionId: typeof options.sessionId === 'string' && options.sessionId !== '' ? options.sessionId : null,
  };
}

/**
 * Pass the adapter's chunks through untouched and fold the last `usage` chunk
 * of the call into the ledger once the stream settles.
 *
 * The last chunk wins on purpose: an adapter that reports usage incrementally
 * would otherwise be summed several times for one request. A call that fails
 * after reporting usage is still recorded, because those tokens were spent.
 */
async function* observe(produced, call, store, config) {
  let usage = null;
  try {
    const stream = isAsyncIterable(produced) ? produced : await produced;
    for await (const chunk of stream) {
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'usage' && chunk.usage !== null && typeof chunk.usage === 'object') {
        usage = chunk.usage;
      }
      yield chunk;
    }
  } finally {
    if (usage !== null) {
      try {
        store.record({
          ...call,
          ts: Date.now(),
          source: 'stream',
          usage: normaliseUsage(usage),
        });
      } catch (error) {
        // Capture must never damage a model call.
        log('warn', `cannot record usage: ${describeError(error)}`);
      }
    }
  }
}

/**
 * The waterfall listener. Registered on `ctx.on` because Cordis events are
 * global by default; waterfall listeners receive the continuation as the last
 * argument and must return the (optionally wrapped) async iterable.
 */
function createListener(store, config, isEnabled) {
  return (options, next) => {
    let call = null;
    try {
      call = describeCall(options);
    } catch (error) {
      log('warn', `cannot describe call: ${describeError(error)}`);
    }
    const produced = next();
    if (call === null || !isEnabled() || config.excludePurposes.includes(call.purpose)) return produced;
    return observe(produced, call, store, config);
  };
}

/* -------------------------------------------------------------------------- */
/* Tool rendering                                                             */
/* -------------------------------------------------------------------------- */

function isWideCodePoint(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

function displayWidth(text) {
  let width = 0;
  for (const character of String(text)) width += isWideCodePoint(character.codePointAt(0)) ? 2 : 1;
  return width;
}

function padDisplay(text, width, align = 'left') {
  const value = String(text);
  const padding = Math.max(0, width - displayWidth(value));
  if (align === 'right') return `${' '.repeat(padding)}${value}`;
  return `${value}${' '.repeat(padding)}`;
}

function trimDisplay(text, width) {
  const value = String(text);
  if (displayWidth(value) <= width) return value;
  let out = '';
  let used = 0;
  for (const character of value) {
    const step = isWideCodePoint(character.codePointAt(0)) ? 2 : 1;
    if (used + step > width - 1) break;
    out += character;
    used += step;
  }
  return `${out}…`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatTable(summary) {
  const keyWidth = Math.min(34, Math.max(8, ...summary.rows.map((row) => displayWidth(row.key))));
  const headers = [GROUP_LABEL[summary.groupBy] ?? '分组', keyWidth, '请求', 6, '输入', 12, '输出', 11, '缓存读', 11, '缓存写', 10, '合计', 12];
  const lines = [];
  lines.push(`用量统计 · ${RANGE_LABEL[summary.range] ?? summary.range} · ${GROUP_LABEL[summary.groupBy] ?? summary.groupBy}`);
  const fromLabel = summary.from === null || summary.from === undefined || summary.from === 'all' ? '最早' : summary.from;
  const providerLabel = summary.provider !== null && summary.provider !== undefined && summary.provider !== 'all' ? ` · 渠道 ${summary.provider}` : '';
  const modelLabel = summary.model !== null && summary.model !== undefined && summary.model !== 'all' ? ` · 模型 ${summary.model}` : '';
  lines.push(`窗口：${fromLabel} → ${summary.to}${providerLabel}${modelLabel}`);
  lines.push('');
  lines.push(
    [
      padDisplay(headers[0], headers[1]),
      padDisplay(headers[2], headers[3], 'right'),
      padDisplay(headers[4], headers[5], 'right'),
      padDisplay(headers[6], headers[7], 'right'),
      padDisplay(headers[8], headers[9], 'right'),
      padDisplay(headers[10], headers[11], 'right'),
      padDisplay(headers[12], headers[13], 'right'),
    ].join('  '),
  );
  for (const row of summary.rows) {
    lines.push(
      [
        padDisplay(trimDisplay(row.key, keyWidth), keyWidth),
        padDisplay(formatCount(row.requests), 6, 'right'),
        padDisplay(formatCount(row.input), 12, 'right'),
        padDisplay(formatCount(row.output), 11, 'right'),
        padDisplay(formatCount(row.cacheRead), 11, 'right'),
        padDisplay(formatCount(row.cacheWrite), 10, 'right'),
        padDisplay(formatCount(row.total), 12, 'right'),
      ].join('  '),
    );
  }
  lines.push('');
  lines.push(
    [
      padDisplay('合计', keyWidth),
      padDisplay(formatCount(summary.totals.requests), 6, 'right'),
      padDisplay(formatCount(summary.totals.input), 12, 'right'),
      padDisplay(formatCount(summary.totals.output), 11, 'right'),
      padDisplay(formatCount(summary.totals.cacheRead), 11, 'right'),
      padDisplay(formatCount(summary.totals.cacheWrite), 10, 'right'),
      padDisplay(formatCount(summary.totals.total), 12, 'right'),
    ].join('  '),
  );
  if (summary.truncated) lines.push(`\n（共 ${summary.groups} 组，只列出前 ${summary.rows.length} 组；调大 limit 或用 provider / model 过滤）`);
  lines.push('\n口径：total = 输入 + 输出 + 缓存读 + 缓存写；reasoning 已包含在输出内，不重复累加。本插件不计费。');
  return lines.join('\n');
}

function buildToolDefinition(store, config) {
  return {
    name: TOOL_NAME,
    description:
      'Query the local DeepSeek Harness token ledger: how many tokens each channel (provider) and each model consumed, grouped by channel, model, channel × model, or day. ' +
      'Use it when the user asks which channel/model burned how many tokens, how much was used today / this week / this month, or which channel is the heaviest. ' +
      'It counts tokens only — there is no pricing, cost, or balance in this ledger, so never present its numbers as money. ' +
      'Data is recorded locally by the dsh-usage-meter plugin; an empty result means no call has been recorded yet. ' +
      'Rows folded from historical session logs carry purpose "backfill"; everything else was captured live.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        range: { type: 'string', enum: ['today', '7d', '30d', 'all'], description: 'Window to report. Default 7d.' },
        groupBy: {
          type: 'string',
          enum: ['provider', 'model', 'provider-model', 'day'],
          description: 'provider = per channel; model = per model id; provider-model = channel × model pairs; day = per local calendar day. Default provider.',
        },
        provider: { type: 'string', description: 'Only this channel, e.g. "qwen". Omit for every channel.' },
        model: { type: 'string', description: 'Only this model id, e.g. "deepseek-v4.1-flash". Omit for every model.' },
        limit: { type: 'number', description: 'Max rows returned, 1-100. Default 30.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'range', 'groupBy', 'totals', 'rows'],
        properties: {
          ok: { type: 'boolean' },
          range: { type: 'string' },
          groupBy: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          groups: { type: 'number' },
          truncated: { type: 'boolean' },
          totals: { type: 'object', additionalProperties: true, required: ['requests', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total'], properties: bucketProperties() },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['key', 'requests', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'total'],
              properties: { key: { type: 'string' }, ...bucketProperties() },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value === null || typeof value !== 'object' || value.ok !== true) {
          return [{ type: 'text', text: `用量统计失败：${String(value?.error ?? 'unknown error')}` }];
        }
        return [{ type: 'text', text: formatTable(value) }];
      },
    },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const input = args !== null && typeof args === 'object' ? args : {};
      const summary = store.summary({
        range: input.range,
        groupBy: input.groupBy,
        provider: input.provider,
        model: input.model,
        limit: input.limit,
      });
      // The canonical value must satisfy `output.schema`, where these three are
      // non-nullable strings. `null` in the summary means "not narrowed".
      return {
        ok: true,
        ...summary,
        from: summary.from ?? 'all',
        provider: summary.provider ?? 'all',
        model: summary.model ?? 'all',
      };
    },
    presentCall(args) {
      const input = args !== null && typeof args === 'object' ? args : {};
      return {
        card: 'generic',
        kind: 'usage',
        title: `用量统计 · ${RANGE_LABEL[input.range] ?? '近 7 天'}`,
        rawInput: args,
      };
    },
    presentResult(_args, result) {
      const text = result?.content?.find?.((block) => block.type === 'text')?.text;
      return { card: 'generic', title: '用量统计', content: typeof text === 'string' ? [{ type: 'text', text }] : [] };
    },
  };
}

function bucketProperties() {
  return {
    requests: { type: 'number' },
    input: { type: 'number' },
    output: { type: 'number' },
    cacheRead: { type: 'number' },
    cacheWrite: { type: 'number' },
    reasoning: { type: 'number' },
    total: { type: 'number' },
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

function isLoopbackHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return false;
  if (Number(match[1]) !== 127) return false;
  return [match[2], match[3], match[4]].every((part) => Number(part) <= 255);
}

/**
 * Fail-closed admission for every route this plugin owns: a forged Host, a
 * cross-site request or a foreign Origin never reaches a handler.
 * @returns {number|null} the status to reject with, or null to continue
 */
function rejectionOf(req, ctx) {
  try {
    const headers = req?.headers ?? {};
    let hostUrl;
    try {
      hostUrl = new URL(`http://${String(headers.host ?? '')}`);
    } catch {
      return 403;
    }
    const authority = hostUrl.host;
    if (!isLoopbackHostname(hostUrl.hostname)) return 403;
    if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403;
    const origin = headers.origin;
    if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
      let originUrl;
      try {
        originUrl = new URL(origin);
      } catch {
        return 403;
      }
      if (originUrl.host.toLowerCase() !== authority.toLowerCase()) return 403;
    }
    const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined;
    if (connection !== undefined && typeof connection.requestRejection === 'function') {
      const code = connection.requestRejection(req);
      if (code !== undefined && code !== null && code !== false) return typeof code === 'number' ? code : 403;
    }
    return null;
  } catch (error) {
    log('warn', `fence failed closed: ${describeError(error)}`);
    return 403;
  }
}

function sendJson(res, status, payload) {
  try {
    res.writeHead(status, JSON_HEADERS);
    res.end(JSON.stringify(payload));
  } catch (error) {
    log('warn', `cannot write response: ${describeError(error)}`);
  }
}

function queryOf(url) {
  const out = {};
  for (const [key, value] of url.searchParams) out[key] = value;
  return out;
}

/* -------------------------------------------------------------------------- */
/* Activation diagnostics                                                     */
/* -------------------------------------------------------------------------- */

const ACTIVATION_LOG_LIMIT = 64 * 1024;

/**
 * Each contribution this plugin installs (capture listener, routes, tool) is
 * installed through its own guard. A rejected contribution must not take the
 * whole fiber down with it: the remaining ones still install, and the reason is
 * appended to `activation.log` next to the ledger so the failure is diagnosable
 * without a debugger attached to the app.
 */
function createDiagnostics(config) {
  const steps = {};
  let logFile = null;

  function resolveLogFile() {
    if (logFile !== null) return logFile;
    for (const candidate of [path.join(config.dir, 'activation.log'), path.join(DSH_HOME, 'usage-meter-activation.log')]) {
      try {
        fs.mkdirSync(path.dirname(candidate), { recursive: true });
        logFile = candidate;
        return logFile;
      } catch {
        /* try the next candidate */
      }
    }
    logFile = '';
    return logFile;
  }

  function write(line) {
    const file = resolveLogFile();
    if (file === '') return;
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`, 'utf8');
      const size = fs.statSync(file).size;
      if (size > ACTIVATION_LOG_LIMIT) {
        const tail = fs.readFileSync(file, 'utf8').split('\n').slice(-200).join('\n');
        fs.writeFileSync(file, `${tail}\n`, 'utf8');
      }
    } catch {
      /* diagnostics must never be the reason activation fails */
    }
  }

  return {
    run(step, operation) {
      try {
        operation();
        steps[step] = { ok: true };
        write(`${step}: ok`);
      } catch (error) {
        const message = describeError(error);
        steps[step] = { ok: false, error: message };
        write(`${step}: FAILED ${message}`);
        write(`${step}: stack ${String(error?.stack ?? '').split('\n').slice(0, 6).join(' | ')}`);
      }
    },
    summary() {
      return {
        steps: { ...steps },
        failed: Object.keys(steps).filter((step) => steps[step].ok !== true),
        logFile: logFile ?? '',
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Plugin                                                                     */
/* -------------------------------------------------------------------------- */

export const name = NAME;
export const inject = ['tools', 'webServer'];
export const TOOL = TOOL_NAME;
export const ROUTE = ROUTE_PREFIX;

/**
 * The plugin body, invoked by the thin `lib/plugin.js` bootstrap (which
 * re-imports this module whenever it changes on disk).
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} rawConfig the `config:` block of this plugin's loader row
 */
export function activate(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  /** Live switch: capture can be muted without unloading the plugin. */
  let enabled = config.enabled;
  const store = new UsageStore({ dir: config.dir, dedupWindowMs: config.dedupWindowMs, log });
  const diagnostics = createDiagnostics(config);
  /** Live view of the one-shot historical fold; the health route reports it. */
  let backfillStatus = { state: 'idle' };

  diagnostics.run('capture', () => {
    ctx.effect(
      () => ctx.on('llm/stream', createListener(store, config, () => enabled)),
      'usage-meter: llm/stream capture',
    );
  });

  /* ---- read-only HTTP surface for the client half -------------------------- */

  const routeHandler = async (req, res) => {
    const rejected = rejectionOf(req, ctx);
    if (rejected !== null) {
      try {
        res.statusCode = rejected;
        res.end();
      } catch {
        /* ignore */
      }
      return;
    }
    let url;
    try {
      url = new URL(String(req.url ?? ROUTE_PREFIX), 'http://localhost');
    } catch {
      sendJson(res, 400, { ok: false, error: 'malformed request url' });
      return;
    }
    const route = url.pathname.replace(/\/+$/, '');
    const query = queryOf(url);

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'use GET' });
      return;
    }
    try {
      if (route === `${ROUTE_PREFIX}/overview.json`) {
        sendJson(res, 200, { ok: true, ...store.overview(query) });
        return;
      }
      if (route === `${ROUTE_PREFIX}/summary.json`) {
        sendJson(res, 200, { ok: true, ...store.summary(query) });
        return;
      }
      if (route === `${ROUTE_PREFIX}/events.json`) {
        const limit = Math.min(clampInt(query.limit, config.maxDetailRows, 1, 2000), config.maxDetailRows);
        const offset = clampInt(query.offset, 0, 0, 1000000);
        sendJson(res, 200, {
          ok: true,
          range: RANGES.has(query.range) ? query.range : 'all',
          ...store.events({ ...query, limit, offset }),
        });
        return;
      }
      if (route === `${ROUTE_PREFIX}/health.json`) {
        sendJson(res, 200, {
          ok: true,
          plugin: NAME,
          enabled,
          config: publicConfig(config),
          today: dayKey(Date.now()),
          ranges: [...RANGES],
          groupings: [...GROUPINGS],
          activation: diagnostics.summary(),
          backfill: backfillStatus,
          ...store.health(),
        });
        return;
      }
      sendJson(res, 404, { ok: false, error: `unknown route ${route}` });
    } catch (error) {
      log('warn', `route ${route} failed: ${describeError(error)}`);
      sendJson(res, 500, { ok: false, error: `${error?.code ?? 'ERROR'}: ${String(error?.message ?? error).slice(0, 300)}` });
    }
  };

  diagnostics.run('routes', () => {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: routeHandler }),
      'usage-meter: read-only routes',
    );
  });

  /* ---- usage_stats tool --------------------------------------------------- */

  let disposeTool = null;
  diagnostics.run('tool', () => {
    disposeTool = ctx.tools.register(buildToolDefinition(store, config));
    ctx.effect(
      () => () => {
        try {
          if (typeof disposeTool === 'function') disposeTool();
        } catch {
          /* ignore */
        }
        disposeTool = null;
      },
      'usage-meter: usage_stats tool teardown',
    );
  });

  const activation = diagnostics.summary();
  log(
    'info',
    `${enabled ? 'recording' : 'DISABLED'} ${config.dir} (dedup ${config.dedupWindowMs}ms, tool ${TOOL_NAME}, route ${ROUTE_PREFIX})`,
  );
  if (activation.failed.length > 0) {
    log('warn', `contributions failed to install: ${activation.failed.join(', ')} — see ${activation.logFile}`);
  }

  /* ---- one-shot historical backfill --------------------------------------- */

  // Detached on purpose: activation must never wait on reading every session log.
  // `sessionQuery` is optional — a composition without it simply has no history
  // to fold, and that must not cost the plugin its live capture.
  if (config.backfill) {
    const settled = readBackfillState(config.dir);
    if (settled !== null && settled.completedAt !== null && settled.completedAt !== undefined) {
      backfillStatus = { state: 'done', ...settled, reused: true };
    } else {
      backfillStatus = { state: 'running' };
      const started = Date.now();
      void runBackfill({
        ctx,
        store,
        dir: config.dir,
        log,
        maxSessions: config.backfillMaxSessions,
      })
        .then((result) => {
          backfillStatus = result;
          const ms = Date.now() - started;
          if (result.state === 'done') {
            log('info', `backfill folded ${result.samples ?? 0} settlement(s) from ${result.sessions ?? 0} session(s) in ${ms}ms (skipped ${result.skippedLive ?? 0} already covered by live capture)`);
          } else {
            log('warn', `backfill did not run: ${result.state}${result.reason === undefined ? '' : ` — ${result.reason}`}`);
          }
        })
        .catch((error) => {
          backfillStatus = { state: 'failed', reason: describeError(error) };
          log('warn', `backfill failed: ${describeError(error)}`);
        });
    }
  } else {
    backfillStatus = { state: 'disabled' };
  }

  // Deliberately returns nothing: a plugin's apply may only return a disposer,
  // so handing back an arbitrary object is not safe.
}

export { normaliseUsage, resolveRange };