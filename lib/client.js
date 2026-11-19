/**
 * dsh-usage-meter · client half
 *
 * Loaded by the Harness client module system as a plain factory bundle: the
 * bootstrap injects `window.__ModuleLoader__` and answers `require('react')`
 * from its static table, so this file needs no build step and no dependencies.
 *
 * It contributes two surfaces, the same pair a panel icon always comes in:
 *
 *   1. `sidebar.panellist` — the entry in the global panel list, ordered last
 *      (after plugins / 技能 / 日程). The sidebar owns the row, its label and its
 *      hit area; this file supplies the glyph only.
 *   2. `main` keyed `usage-meter` — the central column that entry selects:
 *      a KPI strip, a rolling-year heat grid, a per-day trend split by
 *      channel × model, a share donut, the channel × model table, a raw-event
 *      drill-down and the ledger's health.
 *
 * A `sidebar.panellist` id addresses the matching `main` key by contract, which
 * is why the two registrations share `PANEL_ID`.
 *
 * Styling uses the Harness `--dsw-alias-*` theme tokens with light/dark-safe
 * fallbacks, so the page follows the active theme instead of hard-coding a
 * palette. This plugin never shows money: it counts tokens only.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-meter',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const NS = 'dsh-usage-meter';
    const ROUTE = '/dsh-usage-meter';

    /**
     * Named routes shown in the trend chart and the share list. Everything past
     * this window merges into one localised "其他" entry, so a long tail of
     * near-zero models does not take a slot per route.
     */
    const TOP_ROUTES = 5;

    /**
     * Rows the "channel × model" table shows before the reader expands it.
     * The card opens as a five-row summary; the header button reveals the rest,
     * so a long tail of near-zero models never pushes the rest of the page away.
     */
    const TABLE_PREVIEW_ROWS = 5;

    /**
     * Rows per page in the "recent calls" drill-down. Ten rows of an eleven-column
     * table is about one card tall, so a page turn never moves the rest of the
     * page, and the reader still sees a meaningful burst of calls at once.
     */
    const DETAIL_PAGE_SIZE = 10;

    /* ------------------------------------------------------------------ */
    /* Styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
/* Platform roles. Only the documented --dsw-alias-* tokens are referenced; the
   comma fallbacks are a last resort for a host without a theme and are never
   the value that applies in a themed app. */
.dum-root{
  --dum-bg:var(--dsw-alias-bg-layer-2,#1c1d22);
  --dum-bg-soft:var(--dsw-alias-bg-layer-1,#16171b);
  --dum-bg-raised:var(--dsw-alias-bg-overlay,#23242a);
  --dum-border:var(--dsw-alias-border-l2,rgba(128,128,140,.32));
  --dum-border-soft:var(--dsw-alias-border-l1,rgba(128,128,140,.18));
  --dum-fg:var(--dsw-alias-label-primary,#e8e8ea);
  --dum-fg-2:var(--dsw-alias-label-secondary,#b7b8be);
  --dum-accent:var(--dsw-alias-brand-primary,#4f8cff);
  --dum-ok:var(--dsw-alias-state-success-primary,#3fb950);
  --dum-warn:var(--dsw-alias-state-warn-primary,#d29922);
  --dum-err:var(--dsw-alias-state-error-primary,#f85149);
  --dum-idle:var(--dsw-alias-state-idle-primary,#8a8b93);
  /* Roles the platform does not guarantee. Every one is mixed from the tokens
     above; the plain declaration in front of it only applies if color-mix() is
     unavailable, so light mode can never silently fall back to a dark literal. */
  --dum-fg-3:#8a8b93;
  --dum-fg-3:color-mix(in srgb,var(--dsw-alias-label-secondary,#b7b8be) 62%,var(--dsw-alias-bg-base,#101114));
  --dum-bg-input:#23242a;
  --dum-bg-input:color-mix(in srgb,var(--dsw-alias-label-primary,#e8e8ea) 5%,var(--dsw-alias-bg-layer-1,#16171b));
  --dum-hover:rgba(128,140,180,.12);
  --dum-hover:color-mix(in srgb,var(--dsw-alias-label-primary,#e8e8ea) 8%,transparent);
  --dum-hover-2:rgba(128,140,180,.2);
  --dum-hover-2:color-mix(in srgb,var(--dsw-alias-label-primary,#e8e8ea) 14%,transparent);
  --dum-ring:rgba(79,140,255,.55);
  --dum-ring:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 55%,transparent);
  --dum-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary,#e8e8ea) 6%,transparent),0 8px 20px color-mix(in srgb,var(--dsw-alias-label-primary,#e8e8ea) 4%,transparent);

  /* Heat levels: the brand colour tinted into the card surface, so the ramp
     follows the theme instead of hard-coding Tailwind blues. */
  --dum-heat-0:rgba(138,139,147,.22);
  --dum-heat-0:color-mix(in srgb,var(--dum-idle) 22%,var(--dsw-alias-bg-layer-1,#16171b));
  --dum-heat-1:#bfdbfe;
  --dum-heat-1:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 24%,var(--dsw-alias-bg-layer-1,#16171b));
  --dum-heat-2:#93c5fd;
  --dum-heat-2:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 46%,var(--dsw-alias-bg-layer-1,#16171b));
  --dum-heat-3:#60a5fa;
  --dum-heat-3:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 70%,var(--dsw-alias-bg-layer-1,#16171b));
  --dum-heat-4:var(--dsw-alias-brand-primary,#3b82f6);

  /* One radius scale for the whole sheet. */
  --dum-r-xs:5px;
  --dum-r-sm:7px;
  --dum-r:10px;
  --dum-r-lg:14px;
}
.dum-root{display:flex;flex-direction:column;gap:12px;min-width:0;color:var(--dum-fg);font-size:13px;line-height:1.5}

/* Page frame: the panel is a centred, readable column. */
.dum-main{height:100%;min-width:0;min-height:0;box-sizing:border-box;overflow:auto;padding:22px 26px 36px}
.dum-mainInner{width:100%;max-width:1120px;margin:0 auto;min-width:0}
@media (max-width:720px){.dum-main{padding:14px 14px 26px}}

/* Hero: identity above, the range control that governs everything below it. */
.dum-hero{border:1px solid var(--dum-border-soft);border-radius:var(--dum-r-lg);overflow:hidden;box-shadow:var(--dum-shadow);
  background:linear-gradient(135deg,color-mix(in srgb,var(--dum-accent) 15%,transparent),transparent 62%),var(--dum-bg)}
.dum-heroMain{display:flex;flex-direction:column;gap:6px;padding:18px 20px 15px;min-width:0}
.dum-title{margin:0;font-size:20px;font-weight:650;letter-spacing:-.012em;line-height:1.25}
.dum-sub{color:var(--dum-fg-3);font-size:12.5px;margin:0;line-height:1.6;max-width:74ch}
.dum-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:10px 16px;border-top:1px solid var(--dum-border-soft);
  background:color-mix(in srgb,var(--dum-fg) 4%,transparent)}
.dum-barLabel{color:var(--dum-fg-3);font-size:11.5px;flex:none}
.dum-spacer{flex:1 1 auto;min-width:0}
.dum-rangeText{color:var(--dum-fg-3);font-size:11.5px;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-seg{display:inline-flex;flex:none;border:1px solid var(--dum-border);border-radius:var(--dum-r-sm);overflow:hidden;background:var(--dum-bg-input)}
.dum-seg button{font:inherit;font-size:12px;line-height:1.2;color:var(--dum-fg-2);background:transparent;border:none;border-right:1px solid var(--dum-border-soft);
  padding:6px 12px;cursor:pointer;white-space:nowrap;transition:background-color .12s ease,color .12s ease}
.dum-seg button:last-child{border-right:none}
.dum-seg button:hover{background:var(--dum-hover);color:var(--dum-fg)}
.dum-seg button[data-active=true]{background:color-mix(in srgb,var(--dum-accent) 20%,transparent);color:var(--dum-fg);font-weight:600;box-shadow:inset 0 -2px 0 var(--dum-accent)}
.dum-seg button:focus-visible{outline:2px solid var(--dum-ring);outline-offset:-2px}
.dum-btn{font:inherit;font-size:12px;line-height:1.2;color:var(--dum-fg);background:var(--dum-bg-input);border:1px solid var(--dum-border);border-radius:var(--dum-r-sm);
  padding:6px 13px;cursor:pointer;white-space:nowrap;transition:background-color .12s ease,border-color .12s ease}
.dum-btn:hover:not(:disabled){background:var(--dum-hover-2);border-color:color-mix(in srgb,var(--dum-accent) 45%,var(--dum-border))}
.dum-btn:active:not(:disabled){transform:translateY(1px)}
.dum-btn:focus-visible{outline:2px solid var(--dum-ring);outline-offset:1px}
.dum-btn:disabled{opacity:.55;cursor:default}
.dum-card{display:flex;flex-direction:column;gap:12px;padding:15px 17px;border:1px solid var(--dum-border-soft);border-radius:var(--dum-r-lg);background:var(--dum-bg-soft);min-width:0;box-shadow:var(--dum-shadow)}
.dum-cardHead{display:flex;align-items:center;gap:8px 10px;flex-wrap:wrap;min-width:0}
.dum-cardTitle{display:flex;align-items:center;gap:8px;margin:0;font-size:13.5px;font-weight:640;letter-spacing:-.005em}
.dum-cardTitle::before{content:'';flex:none;width:3px;height:13px;border-radius:2px;background:var(--dum-accent);opacity:.85}
.dum-legendSub{color:var(--dum-fg-3);font-size:11.5px;font-variant-numeric:tabular-nums;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-scroll{overflow-x:auto;min-width:0}
/* Table wrapper keeps the footnote outside the horizontal scroller, so it stays
   put while a wide table scrolls sideways. */
.dum-tableWrap{display:flex;flex-direction:column;gap:8px;min-width:0}
.dum-tableNote{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0}
.dum-tableNote .dum-note{flex:1 1 320px;min-width:0}
/* Pager for the raw-event drill-down: the count sits left, the two page
   buttons right, and it wraps under the table on a narrow panel. */
.dum-pager{display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;min-width:0}
.dum-pagerInfo{display:inline-flex;align-items:center;gap:3px;flex-wrap:wrap;color:var(--dum-fg-3);font-size:11.5px;font-variant-numeric:tabular-nums;min-width:0}
.dum-pagerBtns{display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex:none}
/* The page number is the editable part of the footer, so a long ledger can be
   browsed by jumping straight to a page instead of clicking 600 times. */
.dum-pageJump{font:inherit;font-size:11.5px;font-variant-numeric:tabular-nums;text-align:center;color:var(--dum-fg);
  background:var(--dum-bg-input);border:1px solid var(--dum-border);border-radius:var(--dum-r-xs);
  padding:1px 4px;appearance:textfield;-moz-appearance:textfield}
.dum-pageJump::-webkit-outer-spin-button,.dum-pageJump::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.dum-pageJump:hover:not(:disabled){border-color:color-mix(in srgb,var(--dum-accent) 45%,var(--dum-border))}
.dum-pageJump:focus{outline:2px solid var(--dum-ring);outline-offset:1px;border-color:var(--dum-accent)}
.dum-pageJump[aria-invalid=true]{border-color:var(--dum-err);color:var(--dum-err)}
.dum-pageJump:disabled{opacity:.55;cursor:default}
.dum-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.dum-table th,.dum-table td{padding:7px 10px;border-bottom:1px solid var(--dum-border-soft);text-align:left;white-space:nowrap}
.dum-table th{color:var(--dum-fg-3);font-weight:600;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;position:sticky;top:0;background:var(--dum-bg-raised);border-bottom:1px solid var(--dum-border)}
.dum-table td.dum-key{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}
.dum-table td.dum-right,.dum-table th.dum-right{text-align:right}
.dum-table tbody tr:nth-child(even){background:color-mix(in srgb,var(--dum-fg) 3%,transparent)}
.dum-table tbody tr:hover{background:var(--dum-hover)}
.dum-totalRow td{border-top:1px solid var(--dum-border);border-bottom:none;font-weight:650;background:transparent}
.dum-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.dum-emptyState{display:flex;flex-direction:column;align-items:center;gap:5px;padding:24px 16px;border:1px dashed var(--dum-border);
  border-radius:var(--dum-r);background:color-mix(in srgb,var(--dum-fg) 2.5%,transparent);text-align:center}
.dum-emptyIcon{color:var(--dum-fg-3);opacity:.75}
.dum-emptyTitle{color:var(--dum-fg-2);font-size:12.5px;font-weight:600}
.dum-emptyHint{color:var(--dum-fg-3);font-size:11.5px;line-height:1.6;max-width:46ch}
.dum-loading{display:flex;align-items:center;justify-content:center;gap:9px;padding:26px 16px;color:var(--dum-fg-3);font-size:12px}
.dum-spinner{width:14px;height:14px;flex:none;border-radius:50%;border:2px solid color-mix(in srgb,var(--dum-fg) 20%,transparent);border-top-color:var(--dum-accent);animation:dum-spin .8s linear infinite}
@keyframes dum-spin{to{transform:rotate(360deg)}}
.dum-note{color:var(--dum-fg-3);font-size:11.5px;line-height:1.6;margin:0}
.dum-msg{display:flex;align-items:center;gap:9px;font-size:12px;padding:9px 12px;border-radius:var(--dum-r-sm);border:1px solid var(--dum-border-soft);background:var(--dum-bg)}
.dum-msg[data-tone=err]{color:var(--dum-err);border-color:color-mix(in srgb,var(--dum-err) 38%,transparent);background:color-mix(in srgb,var(--dum-err) 9%,transparent)}
.dum-msg[data-tone=warn]{color:var(--dum-warn);border-color:color-mix(in srgb,var(--dum-warn) 38%,transparent);background:color-mix(in srgb,var(--dum-warn) 9%,transparent)}
.dum-msgBody{min-width:0;overflow-wrap:anywhere}
.dum-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.dum-kv{display:flex;flex-wrap:wrap;gap:6px 20px;margin:0}
.dum-kv div{display:flex;gap:6px;font-size:11.5px;color:var(--dum-fg-3);min-width:0}
.dum-kv b{font-weight:600;color:var(--dum-fg-2);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px}
.dum-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;border-radius:999px;padding:2px 9px;
  border:1px solid var(--dum-border-soft);background:var(--dum-bg-input);color:var(--dum-fg-2);white-space:nowrap}
.dum-pill[data-tone=ok]{color:var(--dum-ok);border-color:color-mix(in srgb,var(--dum-ok) 42%,transparent);background:color-mix(in srgb,var(--dum-ok) 12%,transparent)}
.dum-pill[data-tone=warn]{color:var(--dum-warn);border-color:color-mix(in srgb,var(--dum-warn) 42%,transparent);background:color-mix(in srgb,var(--dum-warn) 12%,transparent)}
.dum-pill[data-tone=err]{color:var(--dum-err);border-color:color-mix(in srgb,var(--dum-err) 42%,transparent);background:color-mix(in srgb,var(--dum-err) 12%,transparent)}

/* KPI strip: auto-fitting cards, so a narrow panel wraps instead of pushing
   hairline dividers into the wrong place. */
.dum-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;min-width:0}
.dum-stat{display:flex;flex-direction:column;gap:3px;padding:13px 15px;min-width:0;border:1px solid var(--dum-border-soft);
  border-radius:var(--dum-r);background:var(--dum-bg-soft);box-shadow:var(--dum-shadow)}
.dum-statNum{font-size:22px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-statNum[data-tone=accent]{color:var(--dum-accent)}
.dum-statNum[data-tone=ok]{color:var(--dum-ok)}
.dum-statLabel{color:var(--dum-fg-2);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-statSub{color:var(--dum-fg-3);font-size:10.5px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Calendar heat grid. */
.dum-heatWrap{display:flex;flex-direction:column;gap:8px;min-width:0}
/* Positioned box for the SVG + its hover readout, so the readout can be placed
   above the hovered cell instead of following the pointer over it. */
.dum-heatArt{position:relative;min-width:0}
.dum-heatTip{position:absolute;z-index:2;pointer-events:none;transform:translateY(calc(-100% - 6px));
  white-space:nowrap;padding:3px 9px;border-radius:var(--dum-r-sm);border:1px solid var(--dum-border);
  background:var(--dum-bg-raised);color:var(--dum-fg);font-size:11.5px;font-variant-numeric:tabular-nums;
  box-shadow:var(--dum-shadow)}
.dum-heat{display:block;width:100%;height:auto}
.dum-heatCell{fill:var(--dum-heat-0);transition:fill .12s ease}
.dum-heatCell[data-l="1"]{fill:var(--dum-heat-1)}
.dum-heatCell[data-l="2"]{fill:var(--dum-heat-2)}
.dum-heatCell[data-l="3"]{fill:var(--dum-heat-3)}
.dum-heatCell[data-l="4"]{fill:var(--dum-heat-4)}
.dum-heatCell[data-dim="1"]{opacity:.35}
.dum-heatCell:hover{stroke:var(--dum-fg);stroke-width:1;vector-effect:non-scaling-stroke}
.dum-heatFoot{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;min-width:0}
.dum-heatFootLabel{color:var(--dum-fg-3);font-size:11px;flex:none}
.dum-heatLegend{display:inline-flex;align-items:center;gap:3px;flex:none}
.dum-heatLegend i{display:block;width:11px;height:11px;border-radius:3px}
.dum-axis{fill:var(--dum-fg-3);font-size:10px;font-variant-numeric:tabular-nums}

/* Line trend.

   Deliberately calm: hairline dashed grid, smooth curves with no area fill, and
   a floating card on hover. The chart's job is to show shape and relative size;
   exact numbers are the card's job, which is why the axis stays sparse. */
.dum-section{display:flex;flex-direction:column;gap:12px;min-width:0}
.dum-chartWrap{position:relative;min-width:0}
.dum-chart{display:block;width:100%;height:auto;overflow:visible}
.dum-chartHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0;min-height:16px}
.dum-readout{color:var(--dum-fg-2);font-size:11.5px;font-variant-numeric:tabular-nums}
.dum-readout[data-idle=true]{color:var(--dum-fg-3)}
/* Dashed hairlines read as guides, not as data. A crisp-edges shape-rendering
   hint would make the dashes jitter, so it is left off. */
.dum-grid{stroke:color-mix(in srgb,var(--dum-fg) 13%,transparent);stroke-width:1;stroke-dasharray:2 4}
.dum-gridBase{stroke:color-mix(in srgb,var(--dum-fg) 22%,transparent);stroke-width:1}
.dum-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
/* Dots on the line itself: small enough to be a hint, ringed in the card colour
   so a dot sitting on another line still reads as its own series. */
.dum-dot{stroke:var(--dum-bg-soft);stroke-width:1.5}
.dum-crosshair{stroke:color-mix(in srgb,var(--dum-fg) 32%,transparent);stroke-width:1;stroke-dasharray:3 3;shape-rendering:crispEdges}
/* Floating readout card: the numbers the chart deliberately does not print.
   A max-content width sizes the card to its longest "channel / model" label so a
   full name is never cut in half; the card is then shifted (not squeezed) to stay
   inside the chart, which is why it grows by content instead of being capped to a
   guessed width. The cap is the chart's own width: past that the label ellipsis
   is the last resort, exactly as in the legend. A pointer-events:none rule keeps
   it from stealing the hover that made it. */
.dum-tip{position:absolute;z-index:3;pointer-events:none;min-width:150px;width:max-content;
  max-width:min(460px,100%);
  transform:translate(-50%,calc(-100% - 10px));padding:9px 11px;border-radius:var(--dum-r-sm);
  border:1px solid var(--dum-border);background:var(--dum-bg-raised);
  box-shadow:0 6px 18px color-mix(in srgb,var(--dum-fg) 14%,transparent);
  display:flex;flex-direction:column;gap:6px}
.dum-tipHead{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:11.5px;color:var(--dum-fg-3);min-width:0}
.dum-tipDate{color:var(--dum-fg-2);font-weight:600}
.dum-tipTotal{color:var(--dum-fg);font-weight:600;font-variant-numeric:tabular-nums}
.dum-tipRow{display:grid;grid-template-columns:1fr auto;gap:2px 12px;align-items:center;font-size:11.5px;min-width:0}
.dum-tipName{display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--dum-fg-2)}
.dum-tipName span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-tipVal{color:var(--dum-fg);font-variant-numeric:tabular-nums;white-space:nowrap}
/* Legend as a wrapped row of self-sized entries, not a fixed-column grid: a grid
   gave every entry the same track, and any "channel / model" label longer than
   the track (~220px here) had its tail ellipsised, which cut real model names.
   Each entry now keeps its full label on one line and the row wraps to the next
   line instead, trading column alignment for a readable name. The ellipsis stays
   only as a last resort for a single label wider than the whole row (title still
   holds it). */
.dum-legend{display:flex;flex-wrap:wrap;align-items:center;gap:7px 22px;min-width:0}
.dum-legendItem{display:inline-flex;align-items:center;flex:0 0 auto;gap:7px;font-size:12px;color:var(--dum-fg-2);min-width:0;max-width:100%}
.dum-legendName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dum-swatch{width:9px;height:9px;border-radius:50%;flex:none}

/* Donut + share list. */
.dum-donut{display:flex;flex-wrap:wrap;align-items:center;gap:18px 24px;min-width:0}
.dum-donutArt{flex:0 0 176px;max-width:176px;min-width:0}
.dum-donutArt svg{display:block;width:100%;height:auto;overflow:visible}
.dum-donutList{flex:1 1 300px;min-width:0;display:flex;flex-direction:column}
.dum-donutCenter{fill:var(--dum-fg);font-weight:700;font-variant-numeric:tabular-nums}
.dum-donutCenterSub{fill:var(--dum-fg-3)}
.dum-shareRow{display:flex;align-items:flex-start;gap:10px;padding:9px 4px;font-size:12px;min-width:0;border-radius:var(--dum-r-xs);
  border-bottom:1px solid var(--dum-border-soft);transition:background-color .12s ease}
.dum-shareRow:hover,.dum-shareRow[data-active=true]{background:var(--dum-hover)}
.dum-shareRow:last-child{border-bottom:none}
/* Only the donut legend offsets its swatch: the trend legend centres its own. */
.dum-shareRow .dum-swatch{margin-top:4px}
.dum-shareBody{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.dum-shareName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550;line-height:1.35}
.dum-shareMeta{color:var(--dum-fg-3);font-size:11.5px;font-variant-numeric:tabular-nums;line-height:1.3}
.dum-pct{flex:0 0 auto;color:var(--dum-fg-2);font-variant-numeric:tabular-nums;line-height:1.35;font-weight:600}

/* Sidebar panel-list glyph: sized by the owner, tinted by the row's state. */
.dum-panelIcon{display:block;flex:none;color:currentColor}

@media (prefers-reduced-motion:reduce){
  .dum-root *{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}
}
`;

    /** Insert the plugin stylesheet once; the loader removes plugin tags on unload. */
    function ensureStyles() {
      const marker = `${NS}/styles`;
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin-css="${marker}"]`) !== null) return;
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin', NS);
      tag.setAttribute('data-plugin-css', marker);
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                       */
    /* ------------------------------------------------------------------ */

    const DICT_ZH = {
      nav: '用量统计',
      close: '关闭',
      title: '模型 token 用量统计',
      subtitle: '按渠道（provider）× 模型 × 日期记录每次模型调用的 token 用量。只记用量，不计费：这里没有任何单价、金额或余额。',
      rangeLabel: '时间范围',
      kpiTotal: '累计 Token 数',
      kpiPeak: '峰值 Token 数',
      kpiRequests: '请求数',
      kpiActive: '活跃天数',
      kpiStreak: '最长连续天数',
      heatTitle: 'Token 活动',
      heatSub: '近 365 天 · {n} 天有用量',
      heatLegendLess: '少',
      heatLegendMore: '多',
      wdMon: '一',
      wdWed: '三',
      wdFri: '五',
      monthsShort: '1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月',
      trendTitle: '每日 Token 趋势图',
      trendEmpty: '该范围内没有可用量。',
      trendHoverHint: '悬停查看每日数值',
      trendHoverDay: '当日合计',
      dayShort: '{m}-{d}',
      donutTitle: '渠道 × 模型 用量',
      shareMeta: '{total} tokens · {requests} 次',
      tableTitle: '渠道 × 模型',
      tableExpand: '展开',
      tableCollapse: '收起',
      tableCollapsedNote: '仅显示前 {shown} 个分组，另有 {rest} 个已折叠。',
      tableFoldedTotalHint: '合计包含 {n} 个已折叠的分组',
      other: '其他',
      allTime: '最早',
      noCost: '只统计 token 用量，不计费：这里没有任何单价、金额或余额。',
      rangeToday: '今天',
      range7d: '近 7 天',
      range30d: '近 30 天',
      rangeAll: '全部',
      groupLabel: '分组',
      groupProvider: '按渠道',
      groupModel: '按模型',
      groupPair: '渠道 × 模型',
      groupDay: '按天',
      refresh: '刷新',
      statTotal: '合计 tokens',
      statRequests: '请求数',
      statInput: '输入',
      statOutput: '输出',
      statCacheRead: '缓存读',
      statCacheWrite: '缓存写',
      statWindow: '窗口',
      colKey: '分组',
      colRequests: '请求',
      colInput: '输入',
      colOutput: '输出',
      colCacheRead: '缓存读',
      colTotal: '合计',
      total: '合计',
      empty: '还没有记录。',
      emptyHint: '跑一次对话（或让模型回一句话）之后刷新本页，就能看到第一条数据。',
      loading: '加载中…',
      loadingCard: '正在读取用量…',
      detail: '原始明细',
      detailHide: '收起明细',
      detailTitle: '最近调用',
      detailEmpty: '该范围内没有原始记录。',
      detailPageBefore: '第 ',
      detailPageAfter: ' / {pages} 页 · 共 {total} 条',
      detailPrev: '上一页',
      detailNext: '下一页',
      detailJumpLabel: '跳到第几页（共 {pages} 页，回车跳转）',
      detailJumpHint: '回车跳转，Esc 取消',
      detailJumpBad: '页码需在 1 – {pages} 之间',
      colTime: '时间',
      colProvider: '渠道',
      colModel: '模型',
      colPurpose: '用途',
      colSession: '会话',
      health: '账本状态',
      healthDir: '数据目录',
      healthGroups: '分组数',
      healthMonths: '已载入月份',
      healthCaptured: '已记录',
      healthDuplicates: '已合并重复上报',
      healthBadLines: '跳过的坏行',
      healthWriteErrors: '写入失败',
      healthDedup: '去重窗口',
      healthFailedSteps: '安装失败',
      healthBackfill: '历史回填',
      backfillDone: '{n} 条 / {s} 个会话（跳过 {skipped} 条已实时采集）',
      backfillDoneReused: '已完成 · {n} 条',
      backfillRunning: '正在读会话日志…',
      backfillUnavailable: '本组合无 sessionQuery，无法回填',
      backfillFailed: '失败',
      backfillDisabled: '已关闭',
      backfillIdle: '未开始',
      healthFailedHint: '以下贡献没能装进 Harness，其余功能仍然可用。详细堆栈见下面这个文件：',
      healthDisabled: '采集已关闭',
      healthEnabled: '采集运行中',
      healthLastError: '最近错误',
      dedupNote: '同渠道、同模型、同用途、同会话且 token 数完全相同的调用，若在去重窗口内重复上报（重试或重放），只记一次。窗口设为 0 可完全关闭该合并。',
      crashed: '用量统计面板出错',
      truncation: '共 {n} 组，只显示前 {shown} 组',
    };

    const DICT_EN = {
      nav: 'Token usage',
      close: 'Close',
      title: 'Model token usage',
      subtitle: 'Records the token usage of every model call per channel (provider) × model × day. Usage only, never billing: there is no price, cost or balance here.',
      rangeLabel: 'Range',
      kpiTotal: 'Total tokens',
      kpiPeak: 'Peak tokens',
      kpiRequests: 'Requests',
      kpiActive: 'Active days',
      kpiStreak: 'Longest streak',
      heatTitle: 'Token activity',
      heatSub: 'last 365 days · {n} days with usage',
      heatLegendLess: 'Less',
      heatLegendMore: 'More',
      wdMon: 'Mon',
      wdWed: 'Wed',
      wdFri: 'Fri',
      monthsShort: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec',
      trendTitle: 'Daily token trend',
      trendEmpty: 'No usage in this range.',
      trendHoverHint: 'Hover a day for exact values',
      trendHoverDay: 'day total',
      dayShort: '{m}-{d}',
      donutTitle: 'Channel × model share',
      shareMeta: '{total} tokens · {requests} requests',
      tableTitle: 'Channel × model',
      tableExpand: 'Expand',
      tableCollapse: 'Collapse',
      tableCollapsedNote: 'Showing the first {shown} groups; {rest} more are folded.',
      tableFoldedTotalHint: 'The total includes {n} folded groups',
      other: 'Other',
      allTime: 'earliest',
      noCost: 'Tokens only, never billing: there is no price, cost or balance here.',
      rangeToday: 'Today',
      range7d: 'Last 7 days',
      range30d: 'Last 30 days',
      rangeAll: 'All',
      groupLabel: 'Group by',
      groupProvider: 'Channel',
      groupModel: 'Model',
      groupPair: 'Channel × model',
      groupDay: 'Day',
      refresh: 'Refresh',
      statTotal: 'Total tokens',
      statRequests: 'Requests',
      statInput: 'Input',
      statOutput: 'Output',
      statCacheRead: 'Cache read',
      statCacheWrite: 'Cache write',
      statWindow: 'Window',
      colKey: 'Group',
      colRequests: 'Requests',
      colInput: 'Input',
      colOutput: 'Output',
      colCacheRead: 'Cache read',
      colTotal: 'Total',
      total: 'Total',
      empty: 'No records yet.',
      emptyHint: 'Run one conversation turn (or make the model reply once), then refresh this page.',
      loading: 'Loading…',
      loadingCard: 'Reading usage…',
      detail: 'Raw events',
      detailHide: 'Hide events',
      detailTitle: 'Recent calls',
      detailEmpty: 'No raw records in this range.',
      detailPageBefore: 'Page ',
      detailPageAfter: ' of {pages} · {total} rows',
      detailPrev: 'Previous',
      detailNext: 'Next',
      detailJumpLabel: 'Jump to page (of {pages}, Enter to go)',
      detailJumpHint: 'Enter to jump, Esc to cancel',
      detailJumpBad: 'Enter a page between 1 and {pages}',
      colTime: 'Time',
      colProvider: 'Channel',
      colModel: 'Model',
      colPurpose: 'Purpose',
      colSession: 'Session',
      health: 'Ledger health',
      healthDir: 'Directory',
      healthGroups: 'Groups',
      healthMonths: 'Months loaded',
      healthCaptured: 'Recorded',
      healthDuplicates: 'Duplicates folded',
      healthBadLines: 'Bad lines skipped',
      healthWriteErrors: 'Write failures',
      healthDedup: 'Dedup window',
      healthFailedSteps: 'Not installed',
      healthBackfill: 'History backfill',
      backfillDone: '{n} rows / {s} sessions ({skipped} already covered live)',
      backfillDoneReused: 'done · {n} rows',
      backfillRunning: 'Reading session logs…',
      backfillUnavailable: 'no sessionQuery in this composition',
      backfillFailed: 'failed',
      backfillDisabled: 'disabled',
      backfillIdle: 'not started',
      healthFailedHint: 'These contributions could not be installed into the Harness; the rest still works. The full stack is in the file below:',
      healthDisabled: 'Capture disabled',
      healthEnabled: 'Capture running',
      healthLastError: 'Last error',
      dedupNote: 'Calls with the same channel, model, purpose, session and identical token counts that are reported twice inside the dedup window (retry or replay) are folded into one row. Set the window to 0 to disable folding.',
      crashed: 'Usage panel crashed',
      truncation: '{n} groups in total, showing the first {shown}',
    };

    /** Fill `{name}` placeholders in a dictionary string. */
    function fmt(template, values) {
      return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (values !== undefined && values[key] !== undefined ? String(values[key]) : match));
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                            */
    /* ------------------------------------------------------------------ */

    async function api(path) {
      const response = await fetch(`${ROUTE}${path}`, { headers: { accept: 'application/json' } });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
      }
      if (payload !== null && typeof payload === 'object' && payload.ok === false) {
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
      return payload;
    }

    function formatCount(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '0';
      return Math.round(number).toLocaleString('en-US');
    }

    /** Long counts stay readable in a card without losing the exact number on hover. */
    function compactCount(value) {
      const number = Number(value);
      if (!Number.isFinite(number) || number === 0) return '0';
      if (number < 10000) return formatCount(number);
      if (number < 1000000) return `${(number / 1000).toFixed(1)}K`;
      if (number < 1000000000) return `${(number / 1000000).toFixed(2)}M`;
      return `${(number / 1000000000).toFixed(2)}B`;
    }

    /** Axis ticks read better without decimals: 375M, not 375.00M. */
    function axisCount(value) {
      const number = Number(value);
      if (!Number.isFinite(number) || number === 0) return '0';
      if (number >= 1000000000) return `${Math.round(number / 1000000000)}B`;
      if (number >= 1000000) return `${Math.round(number / 1000000)}M`;
      if (number >= 1000) return `${Math.round(number / 1000)}K`;
      return String(Math.round(number));
    }

    /**
     * Tokens one grouped row actually counted.
     *
     * A row can carry requests and still count nothing: a mistyped model name or a
     * call that failed before the first token. Those rows are not usage, so they
     * are omitted from the table, the share donut and the trend; the raw-event
     * drill-down still shows each of those calls with its own counts.
     */
    function tokenTotalOf(row) {
      const direct = Number(row?.total);
      if (Number.isFinite(direct) && direct > 0) return direct;
      return (
        (Number(row?.input) || 0) +
        (Number(row?.output) || 0) +
        (Number(row?.cacheRead) || 0) +
        (Number(row?.cacheWrite) || 0) +
        (Number(row?.reasoning) || 0)
      );
    }

    /** Trend series that counted at least one token somewhere in the range. */
    function seriesWithUsage(series) {
      return (Array.isArray(series) ? series : []).filter((entry) =>
        (Array.isArray(entry?.points) ? entry.points : []).some((point) => Number(point?.total) > 0),
      );
    }

    function formatTime(ts) {
      try {
        return new Date(Number(ts)).toLocaleString();
      } catch {
        return String(ts ?? '');
      }
    }

    function shortSession(id) {
      const value = String(id ?? '');
      if (value === '') return '—';
      return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
    }

    /** Deliberate loading body for a card whose data has not arrived yet. */
    function Loading(props) {
      return h('div', { className: 'dum-loading', role: 'status', 'aria-live': 'polite' }, [
        h('span', { key: 'spin', className: 'dum-spinner', 'aria-hidden': 'true' }),
        h('span', { key: 'text' }, String(props.label ?? '')),
      ]);
    }

    /** Empty state: one line of what is missing, one of what to do about it. */
    function EmptyState(props) {
      return h(
        'div',
        { className: 'dum-emptyState' },
        h('svg', { className: 'dum-emptyIcon', viewBox: '0 0 24 24', width: 26, height: 26, 'aria-hidden': 'true', focusable: 'false' }, [
          h('rect', { key: 'a', x: 4, y: 13, width: 3.6, height: 7, rx: 1.2, fill: 'currentColor', opacity: 0.5 }),
          h('rect', { key: 'b', x: 10.2, y: 8.5, width: 3.6, height: 11.5, rx: 1.2, fill: 'currentColor', opacity: 0.8 }),
          h('rect', { key: 'c', x: 16.4, y: 4.5, width: 3.6, height: 15.5, rx: 1.2, fill: 'currentColor', opacity: 0.35 }),
        ]),
        h('div', { key: 'title', className: 'dum-emptyTitle' }, String(props.title ?? '')),
        props.hint === undefined || props.hint === null ? null : h('div', { key: 'hint', className: 'dum-emptyHint' }, String(props.hint)),
      );
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: null };
      }

      static getDerivedStateFromError(error) {
        return { failed: error };
      }

      render() {
        if (this.state.failed !== null) {
          return h('div', { className: 'dum-root' }, [
            h('div', { key: 'msg', className: 'dum-msg', 'data-tone': 'err', role: 'alert' }, [
              h('span', { key: 'dot', className: 'dum-dot' }),
              h('span', { key: 'body', className: 'dum-msgBody' }, `${String(this.props.fallback ?? 'panel')}: ${String(this.state.failed?.message ?? this.state.failed)}`),
            ]),
          ]);
        }
        return this.props.children;
      }
    }

    function Segmented(props) {
      return h(
        'div',
        { className: 'dum-seg', role: 'group', 'aria-label': props.label },
        props.options.map((option) =>
          h(
            'button',
            {
              key: option.value,
              type: 'button',
              'data-active': option.value === props.value,
              'aria-pressed': option.value === props.value,
              onClick: () => props.onChange(option.value),
            },
            option.label,
          ),
        ),
      );
    }

    function Stat(props) {
      return h(
        'div',
        { className: 'dum-stat' },
        h('span', { className: 'dum-statNum', 'data-tone': props.tone, title: formatCount(props.value) }, props.display ?? formatCount(props.value)),
        h('span', { className: 'dum-statLabel' }, props.label),
        props.sub === undefined ? null : h('span', { className: 'dum-statSub' }, String(props.sub)),
      );
    }

    function LedgerTable(props) {
      const t = props.t;
      const rows = Array.isArray(props.summary?.rows) ? props.summary.rows : [];
      // Rows the preview holds back. The total row always counts them, so the
      // footnote below the table explains why the visible rows do not add up.
      const folded = Number(props.summary?.folded) > 0 ? Number(props.summary.folded) : 0;
      const totals = props.summary?.totals ?? {};
      if (rows.length === 0) {
        return h(EmptyState, { title: t('empty'), hint: t('emptyHint') });
      }
      const head = (label, right) => h('th', { key: label, className: right ? 'dum-right' : undefined }, label);
      const cells = (bucket, keyCell) =>
        [
          keyCell,
          h('td', { key: 'r', className: 'dum-right' }, formatCount(bucket.requests)),
          h('td', { key: 'i', className: 'dum-right' }, formatCount(bucket.input)),
          h('td', { key: 'o', className: 'dum-right' }, formatCount(bucket.output)),
          h('td', { key: 'cr', className: 'dum-right' }, formatCount(bucket.cacheRead)),
          h('td', { key: 't', className: 'dum-right' }, formatCount(bucket.total)),
        ];
      const keyCellOf = (row) => h('td', { key: 'k', className: 'dum-key', title: row.key }, row.key);
      const table = h(
        'table',
        { className: 'dum-table' },
        h('thead', null, h('tr', null, [
          head(t('colKey')),
          head(t('colRequests'), true),
          head(t('colInput'), true),
          head(t('colOutput'), true),
          head(t('colCacheRead'), true),
          head(t('colTotal'), true),
        ])),
        h(
          'tbody',
          null,
          rows.map((row) => h('tr', { key: row.key }, cells(row, keyCellOf(row)))),
          h(
            'tr',
            {
              className: 'dum-totalRow',
              // The total is the real one, folded rows included, so the reader is
              // told why the visible rows do not add up to it.
              title: folded > 0 ? fmt(t('tableFoldedTotalHint'), { n: formatCount(folded) }) : undefined,
            },
            cells(totals, h('td', { key: 'k', className: 'dum-key' }, t('total'))),
          ),
        ),
      );
      return h('div', { className: 'dum-tableWrap' }, [
        h('div', { key: 'scroll', className: 'dum-scroll' }, table),
        folded === 0
          ? null
          : h(
              'div',
              { key: 'foldedNote', className: 'dum-tableNote' },
              h('span', { key: 'text', className: 'dum-note' }, fmt(t('tableCollapsedNote'), { shown: formatCount(rows.length), rest: formatCount(folded) })),
            ),
      ]);
    }

    /**
     * Parse whatever the reader typed into a 1-based page number.
     *
     * Returns `null` for anything that cannot be a page in this ledger — an
     * empty box, a decimal, a negative number, or a page past the end — so the
     * caller can flag the field instead of snapping to a page nobody asked for.
     * Kept pure and outside the component so the rule is testable on its own.
     */
    function pageJumpTarget(draft, pages) {
      const total = Math.max(1, Math.floor(Number(pages)) || 1);
      const text = String(draft ?? '').trim();
      if (text === '') return null;
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || Math.trunc(parsed) !== parsed) return null;
      if (parsed < 1 || parsed > total) return null;
      return parsed;
    }

    /**
     * The editable page number inside the drill-down footer.
     *
     * It shows the page currently in view and doubles as the "go to page" box:
     * Enter commits, Escape or leaving the field restores the real page, and an
     * out-of-range number is flagged instead of silently snapping. The draft is
     * local so a half-typed number never drives a request.
     */
    function PageJump(props) {
      const t = props.t;
      const pages = Math.max(1, Number(props.pages) || 1);
      const current = Math.min(Math.max(Number(props.page) || 1, 1), pages);
      const [draft, setDraft] = useState(String(current));
      const [editing, setEditing] = useState(false);
      const [bad, setBad] = useState(false);
      /**
       * Page this box is waiting for, plus whether its request has actually
       * started. While a jump is in flight the typed page must stay on screen:
       * syncing from `current` would flash the old number back for one render
       * before the response lands.
       */
      const [pending, setPending] = useState(null);
      const [sawBusy, setSawBusy] = useState(false);

      // Follow the real page whenever the reader is not mid-edit and no jump is
      // in flight — that covers next/previous, a range switch and the server
      // clamping an overshoot.
      useEffect(() => {
        if (editing || pending !== null) return;
        setDraft(String(current));
        setBad(false);
      }, [current, editing, pending]);

      // Settle a jump: it lands when the new page is in view, and it gives up
      // once the request has come and gone without landing on it (a failed or
      // clamped fetch must not lock the field). Waiting for `sawBusy` matters —
      // right after Enter the parent has not flipped `busy` on yet.
      useEffect(() => {
        if (pending === null) return;
        if (current === pending) {
          setPending(null);
          setSawBusy(false);
          setEditing(false);
          setDraft(String(current));
          return;
        }
        if (props.busy === true) {
          if (!sawBusy) setSawBusy(true);
          return;
        }
        if (sawBusy) {
          setPending(null);
          setSawBusy(false);
          setEditing(false);
          setDraft(String(current));
        }
      }, [pending, sawBusy, current, props.busy]);

      const commit = () => {
        const target = pageJumpTarget(draft, pages);
        if (target === null) {
          setBad(true);
          return;
        }
        setBad(false);
        if (target === current) {
          setEditing(false);
          setDraft(String(current));
          return;
        }
        setPending(target);
        setSawBusy(false);
        props.onJump(target);
      };

      const reset = () => {
        setDraft(String(current));
        setBad(false);
        setEditing(false);
        setPending(null);
        setSawBusy(false);
      };

      return h('input', {
        type: 'number',
        className: 'dum-pageJump',
        value: draft,
        min: 1,
        max: pages,
        step: 1,
        inputMode: 'numeric',
        disabled: props.busy === true,
        'aria-label': fmt(t('detailJumpLabel'), { pages: formatCount(pages) }),
        'aria-invalid': bad ? 'true' : undefined,
        title: bad ? fmt(t('detailJumpBad'), { pages: formatCount(pages) }) : t('detailJumpHint'),
        style: { width: `${Math.max(3, String(pages).length + 1)}ch` },
        onFocus: () => setEditing(true),
        onChange: (event) => {
          setDraft(event.target.value);
          if (bad) setBad(false);
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            reset();
            event.currentTarget.blur();
          }
        },
        onBlur: () => {
          // Leaving the field abandons whatever was typed, so the footer never
          // lies about which page is on screen — unless a jump is still in
          // flight, in which case the box keeps showing the page it awaits.
          if (pending === null) reset();
          else setEditing(false);
        },
      });
    }

    function DetailTable(props) {
      const t = props.t;
      const rows = Array.isArray(props.detail?.rows) ? props.detail.rows : [];
      const matched = Number(props.detail?.matched) >= 0 ? Number(props.detail.matched) : rows.length;
      const pageSize = Number(props.detail?.limit) > 0 ? Math.min(Number(props.detail.limit), DETAIL_PAGE_SIZE) : DETAIL_PAGE_SIZE;
      const pages = Math.max(1, Math.ceil(matched / pageSize));
      // The footer reads the offset the server actually served, so it always
      // describes the rows on screen even if the ledger grew mid-browse.
      const servedOffset = Number.isFinite(Number(props.detail?.offset)) ? Number(props.detail.offset) : (Number(props.page) || 0) * pageSize;
      const page = Math.min(Math.max(Math.floor(servedOffset / pageSize), 0), pages - 1);
      // A page turn must not blank the card: the previous rows stay on screen
      // while the next page loads, with the buttons locked until it lands.
      if (props.loading === true && rows.length === 0) return h(Loading, { label: t('loading') });
      if (rows.length === 0) return h(EmptyState, { title: t('detailEmpty') });
      const pager =
        matched > pageSize
          ? h(
              'div',
              { key: 'pager', className: 'dum-pager' },
              h(
                'span',
                { key: 'info', className: 'dum-pagerInfo' },
                h('span', { key: 'before' }, t('detailPageBefore')),
                h(PageJump, {
                  key: 'jump',
                  t,
                  page: page + 1,
                  pages,
                  busy: props.loading === true,
                  onJump: (next) => props.onPage(next - 1),
                }),
                h('span', { key: 'after', 'aria-live': 'polite' }, fmt(t('detailPageAfter'), { pages: formatCount(pages), total: formatCount(matched) })),
              ),
              h(
                'span',
                { key: 'btns', className: 'dum-pagerBtns' },
                h(
                  'button',
                  {
                    key: 'prev',
                    type: 'button',
                    className: 'dum-btn',
                    disabled: page <= 0 || props.loading === true,
                    'aria-label': t('detailPrev'),
                    onClick: () => props.onPage(page - 1),
                  },
                  t('detailPrev'),
                ),
                h(
                  'button',
                  {
                    key: 'next',
                    type: 'button',
                    className: 'dum-btn',
                    disabled: page >= pages - 1 || props.loading === true,
                    'aria-label': t('detailNext'),
                    onClick: () => props.onPage(page + 1),
                  },
                  t('detailNext'),
                ),
              ),
            )
          : null;
      return h('div', { className: 'dum-tableWrap' }, [
        h(
          'div',
          { key: 'scroll', className: 'dum-scroll' },
          h(
            'table',
            { className: 'dum-table' },
            h('thead', null, h('tr', null, [
              h('th', { key: 'k' }, t('colTime')),
              h('th', { key: 'p' }, t('colProvider')),
              h('th', { key: 'm' }, t('colModel')),
              h('th', { key: 'u' }, t('colPurpose')),
              h('th', { key: 's' }, t('colSession')),
              h('th', { key: 'i', className: 'dum-right' }, t('colInput')),
              h('th', { key: 'o', className: 'dum-right' }, t('colOutput')),
              h('th', { key: 'cr', className: 'dum-right' }, t('colCacheRead')),
              h('th', { key: 't', className: 'dum-right' }, t('colTotal')),
            ])),
            h(
              'tbody',
              null,
              rows.map((row, index) =>
                h('tr', { key: `${row.ts}-${index}` }, [
                  h('td', { key: 'k' }, formatTime(row.ts)),
                  h('td', { key: 'p', title: String(row.provider ?? '') }, String(row.provider ?? '—')),
                  h('td', { key: 'm', className: 'dum-key', title: String(row.model ?? '') }, String(row.model ?? '—')),
                  h('td', { key: 'u', title: String(row.purpose ?? 'main') }, String(row.purpose ?? 'main')),
                  h('td', { key: 's', className: 'dum-mono', title: String(row.sessionId ?? '') }, shortSession(row.sessionId)),
                  h('td', { key: 'i', className: 'dum-right' }, formatCount(row.input)),
                  h('td', { key: 'o', className: 'dum-right' }, formatCount(row.output)),
                  h('td', { key: 'cr', className: 'dum-right' }, formatCount(row.cacheRead)),
                  h('td', { key: 't', className: 'dum-right' }, formatCount(row.total)),
                ]),
              ),
            ),
          ),
        ),
        pager,
      ]);
    }

    /** One line describing the one-shot historical fold. */
    function backfillLabel(t, backfill) {
      const state = backfill?.state;
      if (state === 'done') {
        return backfill.reused === true
          ? fmt(t('backfillDoneReused'), { n: formatCount(backfill.samples) })
          : fmt(t('backfillDone'), { n: formatCount(backfill.samples), s: formatCount(backfill.sessions), skipped: formatCount(backfill.skippedLive) });
      }
      if (state === 'running') return t('backfillRunning');
      if (state === 'unavailable') return t('backfillUnavailable');
      if (state === 'failed') return `${t('backfillFailed')}: ${String(backfill.reason ?? '')}`;
      if (state === 'disabled') return t('backfillDisabled');
      return t('backfillIdle');
    }

    function Health(props) {
      const t = props.t;
      const health = props.health ?? {};
      const stats = health.stats ?? {};
      const failed = Array.isArray(health.activation?.failed) ? health.activation.failed : [];
      return h(
        'div',
        { className: 'dum-card' },
        h(
          'div',
          { className: 'dum-cardHead' },
          h('h3', { className: 'dum-cardTitle' }, t('health')),
          h('span', { className: 'dum-pill', 'data-tone': health.enabled === false ? 'err' : 'ok' }, health.enabled === false ? t('healthDisabled') : t('healthEnabled')),
          health.dedupWindowMs > 0 ? h('span', { className: 'dum-pill' }, `${t('healthDedup')} ${health.dedupWindowMs}ms`) : null,
          failed.length > 0 ? h('span', { className: 'dum-pill', 'data-tone': 'err' }, `${t('healthFailedSteps')} ${failed.join(', ')}`) : null,
        ),
        failed.length > 0
          ? h(
              'div',
              { className: 'dum-msg', 'data-tone': 'err' },
              h('div', null, [
                h('div', { key: 'head' }, t('healthFailedHint')),
                h('div', { key: 'detail', className: 'dum-mono' }, failed.map((step) => `${step}: ${String(health.activation?.steps?.[step]?.error ?? '')}`).join(' / ')),
                h('div', { key: 'log', className: 'dum-mono' }, String(health.activation?.logFile ?? '')),
              ]),
            )
          : null,
        h('div', { className: 'dum-kv' }, [
          h('div', { key: 'dir' }, h('span', null, t('healthDir')), h('b', { className: 'dum-mono' }, String(health.dir ?? '—'))),
          h('div', { key: 'g' }, h('span', null, t('healthGroups')), h('b', null, formatCount(health.groups))),
          h('div', { key: 'm' }, h('span', null, t('healthMonths')), h('b', null, Array.isArray(health.loadedMonths) && health.loadedMonths.length > 0 ? health.loadedMonths.join(', ') : '—')),
          h('div', { key: 'c' }, h('span', null, t('healthCaptured')), h('b', null, formatCount(stats.appended))),
          h('div', { key: 'd' }, h('span', null, t('healthDuplicates')), h('b', null, formatCount(stats.duplicates))),
          h('div', { key: 'b' }, h('span', null, t('healthBadLines')), h('b', null, formatCount(stats.badLines))),
          h('div', { key: 'w' }, h('span', null, t('healthWriteErrors')), h('b', null, formatCount(stats.writeErrors))),
          h('div', { key: 'bf' }, h('span', null, t('healthBackfill')), h('b', null, backfillLabel(t, health.backfill))),
        ]),
        health.lastError ? h('div', { className: 'dum-msg', 'data-tone': 'warn' }, `${t('healthLastError')}: ${String(health.lastError)}`) : null,
        h('p', { className: 'dum-note' }, t('dedupNote')),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Page                                                               */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* Charts                                                             */
    /* ------------------------------------------------------------------ */

    const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
    const DAY_MS = 86400000;
    const colorOf = (index) => PALETTE[index % PALETTE.length];

    function parseDay(day) {
      const text = String(day ?? '');
      const year = Number(text.slice(0, 4));
      const month = Number(text.slice(5, 7));
      const date = Number(text.slice(8, 10));
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(date)) return null;
      return new Date(year, month - 1, date);
    }

    function dayKeyOf(date) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /** Zero-filled day keys across `[from, to]`, oldest first. */
    function dayKeys(from, to) {
      const start = parseDay(from);
      const end = parseDay(to);
      const keys = [];
      if (start === null || end === null) return keys;
      for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) keys.push(dayKeyOf(cursor));
      return keys;
    }

    /** Round an axis maximum up to a readable value. */
    function niceMax(value) {
      const max = Number(value) || 0;
      if (max <= 0) return 1;
      const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
      const step = max / magnitude;
      // Fine-grained ladder: jumping to 5x when 3x already clears the data would
      // throw away more than a third of the plot height.
      const factor =
        step <= 1 ? 1 : step <= 1.5 ? 1.5 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 3 ? 3 : step <= 4 ? 4 : step <= 5 ? 5 : step <= 6 ? 6 : step <= 8 ? 8 : 10;
      return factor * magnitude;
    }

    /** Longest and trailing runs of active days, oldest first. */
    function streaks(byDay, from, to) {      let longest = 0;
      let run = 0;
      for (const key of dayKeys(from, to)) {
        if ((byDay.get(key) ?? 0) > 0) {
          run += 1;
          if (run > longest) longest = run;
        } else {
          run = 0;
        }
      }
      return { longest, current: run };
    }

    /** Rolling-year calendar grid, one cell per local day. */
    function Heatmap(props) {
      const t = props.t;
      // Hovered-cell readout. Declared before the early returns below so the hook
      // order never changes between the empty and the filled render.
      const [tip, setTip] = useState(null);
      const byDay = new Map((props.heatmap ?? []).map((entry) => [entry.day, Number(entry.total) || 0]));
      const start = parseDay(props.from);
      const end = parseDay(props.to);
      if (start === null || end === null) return h(EmptyState, { title: t('empty') });
      let seen = 0;
      for (const value of byDay.values()) seen += value;
      if (seen === 0) return h(EmptyState, { title: t('empty'), hint: t('emptyHint') });

      const gridStart = new Date(start);
      gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
      const weeks = Math.floor((end - gridStart) / DAY_MS / 7) + 1;
      const cell = 12;
      const gap = 3;
      const padTop = 4;
      const padLeft = 26;
      const height = padTop + 7 * (cell + gap) + 16;
      // Extra right padding so the last month label is never clipped by the viewBox.
      const width = padLeft + weeks * (cell + gap) + 20;
      const max = Math.max(1, ...byDay.values());
      const monthNames = String(t('monthsShort') ?? '').split(',');

      const cells = [];
      const months = [];
      let seenMonth = '';
      for (let index = 0; index < weeks * 7; index += 1) {
        const cursor = new Date(gridStart);
        cursor.setDate(cursor.getDate() + index);
        if (cursor > end) break;
        const key = dayKeyOf(cursor);
        const total = byDay.get(key) ?? 0;
        const ratio = total / max;
        const level = total === 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
        const column = Math.floor(index / 7);
        const cellX = padLeft + column * (cell + gap);
        const cellY = padTop + (index % 7) * (cell + gap);
        const monthKey = key.slice(0, 7);
        if (monthKey !== seenMonth) {
          seenMonth = monthKey;
          // The grid starts on the Monday on or before the range, so its leading
          // cells can still belong to the previous month. Labelling those would
          // print two month names into the same column.
          if (key >= props.from) {
            const monthNumber = Number(monthKey.slice(5, 7));
            const label = (monthNames[monthNumber - 1] ?? `${monthNumber}月`).trim() || `${monthNumber}月`;
            const x = padLeft + column * (cell + gap);
            // The final label is anchored to the right edge it would otherwise cross.
            months.push({ key: monthKey, label, x, anchor: x > width - 34 ? 'end' : 'start' });
          }
        }
        cells.push(
          h(
            'rect',
            {
              key,
              className: 'dum-heatCell',
              'data-l': level,
              'data-dim': key < props.from ? '1' : '0',
              x: cellX,
              y: cellY,
              width: cell,
              height: cell,
              rx: 2.5,
              // The browser's own <title> tooltip follows the pointer and covers
              // the very cell being read, so the readout is ours: it sits above
              // the cell and is anchored to whichever side has room.
              onMouseEnter: () =>
                setTip({
                  text: `${key} · ${formatCount(total)} tokens`,
                  left: `${(cellX / width) * 100}%`,
                  right: `${((width - cellX - cell) / width) * 100}%`,
                  top: `${(cellY / height) * 100}%`,
                  side: cellX + cell / 2 <= width / 2 ? 'left' : 'right',
                }),
            },
          ),
        );
      }

      const weekdayLabels = [t('wdMon'), t('wdWed'), t('wdFri')];
      const tipStyle = tip === null
        ? null
        : tip.side === 'left'
          ? { left: tip.left, top: tip.top }
          : { right: tip.right, top: tip.top };
      return h('div', { className: 'dum-heatWrap' }, [
        h('div', { key: 'art', className: 'dum-heatArt' }, [
          h(
            'svg',
            {
              key: 'grid',
              className: 'dum-heat',
              viewBox: `0 0 ${width} ${height}`,
              role: 'img',
              'aria-label': t('heatTitle'),
              preserveAspectRatio: 'xMidYMid meet',
              onMouseLeave: () => setTip(null),
            },
            [
              h('g', { key: 'cells' }, cells),
              h(
                'g',
                { key: 'wd' },
                weekdayLabels.map((label, index) =>
                  h('text', { key: `wd${index}`, className: 'dum-axis', x: 0, y: padTop + index * 2 * (cell + gap) + cell - 2 }, label),
                ),
              ),
              h(
                'g',
                { key: 'mo' },
                months.map((month) => h('text', { key: month.key, className: 'dum-axis', x: month.x, y: height - 4, textAnchor: month.anchor }, month.label)),
              ),
            ],
          ),
          tip === null ? null : h('div', { key: 'tip', className: 'dum-heatTip', style: tipStyle, 'aria-hidden': 'true' }, tip.text),
        ]),
        h('div', { key: 'legend', className: 'dum-heatFoot' }, [
          h('span', { key: 'sp', className: 'dum-spacer' }),
          h('span', { key: 'less', className: 'dum-heatFootLabel' }, t('heatLegendLess')),
          h(
            'span',
            { key: 'scale', className: 'dum-heatLegend', role: 'img', 'aria-label': `${t('heatLegendLess')} → ${t('heatLegendMore')}` },
            [0, 1, 2, 3, 4].map((level) => h('i', { key: level, style: { background: `var(--dum-heat-${level})` } })),
          ),
          h('span', { key: 'more', className: 'dum-heatFootLabel' }, t('heatLegendMore')),
        ]),
      ]);
    }

    /**
     * How far each Bézier control point sits along its segment, as a fraction of
     * the segment length. 1/3 is the classic "tangent touches the midpoint" curve,
     * which is the most rounded; smaller values pull the curve towards the straight
     * line between two days.
     *
     * The daily series is spiky by nature — a route is idle for days and then
     * jumps — and at 1/3 every isolated peak came out as a pronounced S-bend on
     * each side of it. 0.19 keeps the corners soft while making a two-day bump
     * read as a bump rather than a wave.
     */
    const CURVE_TENSION = 0.19;

    /**
     * Smooth path through a series of points, as cubic Béziers.
     *
     * Two independent guarantees keep a curve from lying about the data:
     *
     *  - **No overshoot past a vertex.** Tangents are averaged between neighbours
     *    and zeroed where the series changes direction, so a peak never balloons
     *    above its true value.
     *  - **Never below the baseline.** Zeroing a tangent is not enough on its own:
     *    a control point belonging to a *flat* segment can still be dragged below
     *    the axis by the steep segment next to it, and the curve then loops under
     *    the zero line — reading as negative usage. `clampY` (the baseline) is
     *    applied to every control point, which removes that case exactly, since a
     *    cubic Bézier is bounded by the convex hull of its four control points.
     *
     * Points are evenly spaced in x, which is what makes the tangent rule correct.
     */
    function smoothPath(points, clampY = Infinity) {
      if (points.length === 0) return '';
      if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
      const n = points.length;
      // Slope of each segment, then a tangent per interior point: the average of
      // its two neighbours, zeroed when the series changes direction so the
      // curve flattens at a local peak rather than looping through it.
      const slopes = [];
      for (let i = 0; i < n - 1; i += 1) {
        const dx = points[i + 1][0] - points[i][0];
        slopes.push(dx === 0 ? 0 : (points[i + 1][1] - points[i][1]) / dx);
      }
      const tangents = new Array(n);
      tangents[0] = slopes[0];
      tangents[n - 1] = slopes[n - 2];
      for (let i = 1; i < n - 1; i += 1) {
        tangents[i] = slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2;
      }
      /** Keep a control point on or above the baseline (y grows downward). */
      const keep = (y) => Math.min(y, clampY);
      let d = `M ${points[0][0]} ${points[0][1]}`;
      for (let i = 0; i < n - 1; i += 1) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        // `dx` is how far each control point reaches inwards; the tangent is the
        // slope to follow, so control y = endpoint y + slope × reach.
        const reach = (x1 - x0) * CURVE_TENSION;
        const c1 = keep(y0 + tangents[i] * reach);
        const c2 = keep(y1 - tangents[i + 1] * reach);
        d += ` C ${x0 + reach} ${c1} ${x1 - reach} ${c2} ${x1} ${y1}`;
      }
      return d;
    }

    /** Per-day token trend, one line per route. */
    function TrendChart(props) {
      const t = props.t;
      const [hover, setHover] = useState(-1);
      // The hover card's width depends on the longest visible "channel / model"
      // label, so it is measured after mount and the card is then nudged until it
      // sits inside the chart. Both hooks are declared before the early return so
      // the hook order never changes between the empty and the filled render.
      const tipRef = React.useRef(null);
      const [tipLeftPx, setTipLeftPx] = useState(null);
      React.useLayoutEffect(() => {
        const node = tipRef.current;
        // Empty render (no series / no window): nothing is mounted, nothing to
        // measure — and the chart geometry defined below is not initialised either.
        if (node === null) {
          if (tipLeftPx !== null) setTipLeftPx(null);
          return;
        }
        const wrap = node.parentElement;
        if (wrap === null) return;
        const wrapWidth = wrap.clientWidth;
        if (wrapWidth <= 0) return;
        const cardWidth = node.offsetWidth;
        const half = cardWidth / 2 + 4;
        const desired = (xOf(hover) / width) * wrapWidth;
        // A card wider than the plot cannot be kept inside it at all; centring it
        // is the least surprising overflow.
        const next = half * 2 >= wrapWidth ? wrapWidth / 2 : Math.min(Math.max(desired, half), wrapWidth - half);
        if (tipLeftPx === null || Math.abs(tipLeftPx - next) > 0.5) setTipLeftPx(next);
      });
      const keys = dayKeys(props.from, props.to);
      const series = (props.series ?? []).filter((entry) => Array.isArray(entry.points) && entry.points.length > 0);
      if (keys.length === 0 || series.length === 0) return h(EmptyState, { title: t('trendEmpty'), hint: t('emptyHint') });

      const indexOf = new Map(keys.map((key, index) => [key, index]));
      /** The merged tail series carries `other: true`; its label is localised. */
      const labelOf = (entry) => (entry.other === true ? t('other') : entry.key);
      /** Value of one series on one day, or null when that day has no point. */
      const byDayOf = new Map(series.map((entry) => [entry.key, new Map(entry.points.map((point) => [point.day, Number(point.total) || 0]))]));
      const valueOn = (entry, day) => (byDayOf.get(entry.key)?.has(day) === true ? byDayOf.get(entry.key).get(day) : null);
      let observed = 0;
      for (const entry of series) {
        for (const point of entry.points) observed = Math.max(observed, Number(point.total) || 0);
      }
      const top = niceMax(observed);
      const width = 760;
      const height = 230;
      const padLeft = 56;
      // Room for the last x tick: it is right-anchored, but the label still needs
      // a couple of pixels before the viewBox edge.
      const padRight = 14;
      const padTop = 10;
      const padBottom = 26;
      const plotWidth = width - padLeft - padRight;
      const plotHeight = height - padTop - padBottom;
      const baseY = padTop + plotHeight;
      const xOf = (index) => padLeft + (keys.length === 1 ? plotWidth / 2 : (index / (keys.length - 1)) * plotWidth);
      const yOf = (value) => padTop + plotHeight - (top === 0 ? 0 : (value / top) * plotHeight);
      /** `key` is `YYYY-MM-DD`; the tick shows the zero-padded month-day. */
      const dayLabel = (key) => {
        const parts = String(key ?? '').split('-');
        if (parts.length < 3) return String(key ?? '');
        return fmt(t('dayShort'), { m: parts[1].padStart(2, '0'), d: parts[2].padStart(2, '0') });
      };

      const grid = [1, 0.75, 0.5, 0.25, 0].map((fraction) =>
        h('g', { key: `g${fraction}` }, [
          h('line', {
            key: 'line',
            className: fraction === 0 ? 'dum-gridBase' : 'dum-grid',
            x1: padLeft,
            x2: width - padRight,
            y1: yOf(top * fraction),
            y2: yOf(top * fraction),
            vectorEffect: 'non-scaling-stroke',
          }),
          h('text', { key: 'label', className: 'dum-axis', x: padLeft - 8, y: yOf(top * fraction) + 3, textAnchor: 'end' }, axisCount(top * fraction)),
        ]),
      );

      const tickCount = Math.min(keys.length, 8);
      const ticks = [];
      for (let tick = 0; tick < tickCount; tick += 1) {
        const index = tickCount === 1 ? 0 : Math.round((tick / (tickCount - 1)) * (keys.length - 1));
        const key = keys[index];
        // The outermost ticks are anchored inwards so no label is clipped.
        const anchor = tickCount === 1 ? 'middle' : tick === 0 ? 'start' : tick === tickCount - 1 ? 'end' : 'middle';
        ticks.push(h('text', { key: `x${index}`, className: 'dum-axis', x: xOf(index), y: height - 8, textAnchor: anchor }, dayLabel(key)));
      }

      // No area fill: the curves are read against each other, and a stack of
      // translucent fills turns the crossings into mud.
      //
      // Every day in the window gets a vertex, including the days a route was not
      // used: those sit on the baseline instead of being skipped. Skipping them
      // drew a line straight across the gap, so a route with two isolated days
      // showed as a floating stub that never touched zero — the chart claimed the
      // route was absent during days it was merely idle.
      const lines = series.map((entry, index) =>
        h('path', {
          key: entry.key,
          className: 'dum-line',
          stroke: colorOf(index),
          d: smoothPath(
            keys.map((day, dayIndex) => [xOf(dayIndex), yOf(valueOn(entry, day) ?? 0)]),
            // The zero line: no control point may sit below it.
            baseY,
          ),
        }),
      );

      // Dots mark the days a route actually burned tokens — not every baseline
      // vertex, or an idle route would stud the axis with dots. They carry no
      // native <title>: the browser tooltip would follow the pointer over the very
      // line being read, and the hover card already prints per-series values.
      const dots =
        keys.length <= 45
          ? series.flatMap((entry, index) =>
              entry.points
                .filter((point) => Number(point.total) > 0 && indexOf.has(point.day))
                .map((point) =>
                  h('circle', {
                    key: `${entry.key}|${point.day}`,
                    className: 'dum-dot',
                    cx: xOf(indexOf.get(point.day)),
                    cy: yOf(Number(point.total) || 0),
                    r: 2.5,
                    fill: colorOf(index),
                  }),
                ),
            )
          : [];

      // Nearest-day crosshair: the exact numbers behind a spike, on demand.
      const hoverKey = hover >= 0 && hover < keys.length ? keys[hover] : null;
      const hoverTotal =
        hoverKey === null ? 0 : series.reduce((running, entry) => running + (valueOn(entry, hoverKey) ?? 0), 0);
      const crosshair =
        hoverKey === null
          ? null
          : h('g', { key: 'cross' }, [
              h('line', {
                key: 'v',
                className: 'dum-crosshair',
                x1: xOf(hover),
                x2: xOf(hover),
                y1: padTop,
                y2: baseY,
                vectorEffect: 'non-scaling-stroke',
              }),
              ...series.map((entry, index) => {
                const value = valueOn(entry, hoverKey);
                if (value === null) return null;
                return h('circle', { key: `hv${entry.key}`, className: 'dum-dot', cx: xOf(hover), cy: yOf(value), r: 3.5, fill: colorOf(index), strokeWidth: 2 });
              }),
            ]);

      // With the cursor off the chart every series keeps its colour key, and it
      // stays that way while hovering too: a legend that reshuffles itself under
      // the pointer is harder to read than one with a few zeroes in it.
      const legendRows = series.map((entry, index) => ({ entry, index }));

      const pick = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const x = ((event.clientX - rect.left) / rect.width) * width;
        const ratio = (x - padLeft) / (plotWidth === 0 ? 1 : plotWidth);
        const index = Math.max(0, Math.min(keys.length - 1, Math.round(ratio * (keys.length - 1))));
        if (index !== hover) setHover(index);
      };

      /**
       * The floating card: date, day total, then one row per series that had a
       * point that day, biggest first.
       *
       * It is a plain HTML sibling of the <svg>, positioned in percentages of the
       * chart box. The svg keeps its aspect ratio (`height:auto`), so a point's
       * viewBox coordinate maps linearly onto a percentage of the rendered box —
       * which avoids `foreignObject`, whose nested positioning is unreliable
       * across engines and cannot be exercised without a browser.
       */
      const tipRows =
        hoverKey === null
          ? []
          : series
              .map((entry, index) => ({ entry, index, value: valueOn(entry, hoverKey) }))
              .filter((row) => Number(row.value) > 0)
              .sort((left, right) => right.value - left.value);
      // Place the card just above the day's highest point, which is where the eye
      // already is; clamp again when that would clip the top. Horizontally the
      // measured card width decides the final position (see the layout effect), so
      // the percentage below is only the first, pre-measurement guess.
      const tipAnchorX = xOf(hover);
      const dayPeak = hoverKey === null ? 0 : series.reduce((best, entry) => Math.max(best, valueOn(entry, hoverKey) ?? 0), 0);
      const tipHeightPx = 34 + tipRows.length * 20;
      const tipAnchorY = Math.max(padTop + tipHeightPx + 8, yOf(dayPeak) - 10);
      const tip = hoverKey === null ? null : h(
        'div',
        {
          key: 'tip',
          ref: tipRef,
          className: 'dum-tip',
          style: {
            left: tipLeftPx === null ? `${(tipAnchorX / width) * 100}%` : `${tipLeftPx}px`,
            top: `${(Math.min(tipAnchorY, baseY) / height) * 100}%`,
          },
          'aria-hidden': 'true',
        },
        [
          h('div', { key: 'head', className: 'dum-tipHead' }, [
            h('span', { key: 'd', className: 'dum-tipDate' }, hoverKey),
            h('span', { key: 'sep' }, '·'),
            h('span', { key: 't', className: 'dum-tipTotal' }, formatCount(hoverTotal)),
            h('span', { key: 'u' }, 'tokens'),
          ]),
          ...tipRows.map((row) =>
            h('div', { key: row.entry.key, className: 'dum-tipRow' }, [
              h('span', { key: 'n', className: 'dum-tipName' }, [
                h('span', { key: 'sw', className: 'dum-swatch', style: { background: colorOf(row.index) } }),
                h('span', { key: 'lbl', title: labelOf(row.entry) }, labelOf(row.entry)),
              ]),
              h('span', { key: 'v', className: 'dum-tipVal' }, compactCount(row.value)),
            ]),
          ),
        ],
      );

      return h('div', { className: 'dum-section' }, [
        h(
          'div',
          { key: 'head', className: 'dum-chartHead' },
          // While a day is under the cursor the card carries the numbers, so the
          // header keeps its idle hint or nothing at all.
          hoverKey === null ? [h('span', { key: 'readout', className: 'dum-readout', 'data-idle': true }, t('trendHoverHint'))] : [],
        ),
        h('div', { key: 'plot', className: 'dum-chartWrap' }, [
          h(
            'svg',
            {
              key: 'chart',
              className: 'dum-chart',
              viewBox: `0 0 ${width} ${height}`,
              role: 'img',
              'aria-label': t('trendTitle'),
              preserveAspectRatio: 'xMidYMid meet',
              onMouseMove: pick,
              onMouseLeave: () => setHover(-1),
            },
            [
              h('g', { key: 'grid' }, grid),
              h('g', { key: 'lines' }, lines),
              h('g', { key: 'dots' }, dots),
              h('g', { key: 'ticks' }, ticks),
              crosshair,
            ],
          ),
          tip,
        ]),
        h('div', { key: 'legend', className: 'dum-legend' },
          legendRows.map((row) =>
            h('span', { key: row.entry.key, className: 'dum-legendItem' }, [
              h('span', { key: 'sw', className: 'dum-swatch', style: { background: colorOf(row.index) } }),
              h('span', { key: 'name', className: 'dum-legendName', title: labelOf(row.entry) }, labelOf(row.entry)),
            ]),
          )),
      ]);
    }

    /** Token share per route, as a donut plus a share list. */
    function Donut(props) {
      const t = props.t;
      const [active, setActive] = useState(-1);
      const rows = Array.isArray(props.routes) ? props.routes : [];
      if (rows.length === 0) return h(EmptyState, { title: t('empty'), hint: t('emptyHint') });

      const head = rows.slice(0, TOP_ROUTES);
      const tail = rows.slice(TOP_ROUTES);
      const slices = [...head];
      if (tail.length > 0) {
        slices.push({
          key: t('other'),
          rest: true,
          requests: tail.reduce((sum, row) => sum + (Number(row.requests) || 0), 0),
          total: tail.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
        });
      }
      const sum = slices.reduce((running, row) => running + (Number(row.total) || 0), 0) || 1;

      const radius = 62;
      const stroke = 26;
      const center = 88;
      const circumference = 2 * Math.PI * radius;
      let offset = 0;
      const arcs = slices.map((row, index) => {
        const share = (Number(row.total) || 0) / sum;
        const arc = h(
          'circle',
          {
            key: row.key,
            cx: center,
            cy: center,
            r: radius,
            fill: 'none',
            stroke: colorOf(index),
            strokeWidth: active === index ? stroke + 5 : stroke,
            // A hair of slack keeps neighbouring slices from touching.
            strokeDasharray: `${Math.max(0, share * circumference - 1.5)} ${circumference}`,
            strokeDashoffset: -offset * circumference,
            transform: `rotate(-90 ${center} ${center})`,
            opacity: active === -1 || active === index ? 1 : 0.35,
            style: { transition: 'opacity .12s ease' },
            onMouseEnter: () => setActive(index),
            onMouseLeave: () => setActive(-1),
          },
          // No native <title>: it would cover the arc under the pointer, and the
          // share list beside the donut always prints the same name, token count
          // and percentage (hovering an arc already highlights that row).
        );
        offset += share;
        return arc;
      });

      const shown = active >= 0 && active < slices.length ? slices[active] : null;
      const shownShare = shown === null ? 0 : (Number(shown.total) || 0) / sum;

      const list = slices.map((row, index) => {
        const share = (Number(row.total) || 0) / sum;
        return h(
          'div',
          {
            key: row.key,
            className: 'dum-shareRow',
            'data-active': active === index,
            onMouseEnter: () => setActive(index),
            onMouseLeave: () => setActive(-1),
          },
          [
            h('span', { key: 'sw', className: 'dum-swatch', style: { background: colorOf(index) } }),
            h('span', { key: 'body', className: 'dum-shareBody' }, [
              h('span', { key: 'name', className: 'dum-shareName', title: row.key }, row.key),
              h(
                'span',
                { key: 'meta', className: 'dum-shareMeta' },
                fmt(t('shareMeta'), { total: compactCount(row.total), requests: formatCount(row.requests) }),
              ),
            ]),
            h('span', { key: 'pct', className: 'dum-pct' }, `${(share * 100).toFixed(1)}%`),
          ],
        );
      });

      return h('div', { className: 'dum-donut' }, [
        h(
          'div',
          { key: 'art', className: 'dum-donutArt' },
          h('svg', { viewBox: `0 0 ${center * 2} ${center * 2}`, role: 'img', 'aria-label': t('donutTitle') }, [
            h('circle', { key: 'track', cx: center, cy: center, r: radius, fill: 'none', stroke: 'var(--dum-border-soft)', strokeWidth: stroke }),
            ...arcs,
            h('text', { key: 'value', className: 'dum-donutCenter', x: center, y: center + 3, textAnchor: 'middle', fontSize: 20 }, compactCount(shown === null ? sum : shown.total)),
            h('text', { key: 'unit', className: 'dum-donutCenterSub', x: center, y: center + 21, textAnchor: 'middle', fontSize: 11 }, shown === null ? 'tokens' : `${(shownShare * 100).toFixed(1)}%`),
          ]),
        ),
        h('div', { key: 'list', className: 'dum-donutList' }, list),
      ]);
    }

    /* ------------------------------------------------------------------ */
    /* Sidebar panel entry + main panel                                   */
    /* ------------------------------------------------------------------ */

    /** Panel id: addresses both the sidebar list cell and the matching `main` key. */
    const PANEL_ID = 'usage-meter';

    /** `sidebar.panellist` glyph — the sidebar owns the row, its label and its hit area. */
    function PanelIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 16;
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' }, [
        h('rect', { key: 'a', x: 1.5, y: 8, width: 3, height: 6.5, rx: 1, fill: 'currentColor' }),
        h('rect', { key: 'b', x: 6.5, y: 4.5, width: 3, height: 10, rx: 1, fill: 'currentColor' }),
        h('rect', { key: 'c', x: 11.5, y: 1.5, width: 3, height: 13, rx: 1, fill: 'currentColor', opacity: 0.55 }),
      ]);
    }

    /** `main` keyed by the panel id — the usage page in the central column. */
    function UsageMainPanel(props) {
      const t = props.t;
      return h('div', { className: 'dum-main' }, h('div', { className: 'dum-mainInner' }, h(UsagePage, { t })));
    }

    function UsagePage(props) {
      const t = props.t;
      const [range, setRange] = useState('7d');
      const [overview, setOverview] = useState(null);
      const [health, setHealth] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [nonce, setNonce] = useState(0);
      const [showDetail, setShowDetail] = useState(false);
      const [tableExpanded, setTableExpanded] = useState(false);
      const [detail, setDetail] = useState(null);
      const [detailBusy, setDetailBusy] = useState(false);
      /**
       * Cursor of the "recent calls" drill-down: the page plus the window it
       * belongs to. Keying it means a range switch or a refresh lands on the
       * newest page without a reset effect firing a request for the old one.
       */
      const [detailCursor, setDetailCursor] = useState({ key: '', page: 0 });

      useEffect(() => {
        let cancelled = false;
        setBusy(true);
        Promise.all([api(`/overview.json?range=${encodeURIComponent(range)}`), api('/health.json')])
          .then(([nextOverview, nextHealth]) => {
            if (cancelled) return;
            setOverview(nextOverview);
            setHealth(nextHealth);
            setError(null);
          })
          .catch((failure) => {
            if (cancelled) return;
            setError(String(failure?.message ?? failure));
          })
          .finally(() => {
            if (!cancelled) setBusy(false);
          });
        return () => {
          cancelled = true;
        };
      }, [range, nonce]);

      // A new window or a refresh starts the drill-down at the newest page again.
      // Rather than resetting the page in a second effect (which would fire one
      // request for the stale position first), the cursor carries the window it
      // belongs to: a mismatched key simply reads as page 0.
      const detailKey = `${range}|${nonce}`;
      const detailPage = detailCursor.key === detailKey ? detailCursor.page : 0;

      useEffect(() => {
        if (!showDetail) return undefined;
        let cancelled = false;
        setDetailBusy(true);
        // The server clamps `offset` as well, so a position past the end after a
        // shrinking range comes back as the last real page instead of blank.
        api(`/events.json?range=${encodeURIComponent(range)}&limit=${DETAIL_PAGE_SIZE}&offset=${detailPage * DETAIL_PAGE_SIZE}`)
          .then((payload) => {
            if (cancelled) return;
            setDetail(payload);
            const total = Number(payload?.matched);
            const pages = Math.max(1, Math.ceil((Number.isFinite(total) ? total : 0) / DETAIL_PAGE_SIZE));
            if (detailPage > pages - 1) setDetailCursor({ key: detailKey, page: pages - 1 });
          })
          .catch((failure) => {
            if (!cancelled) setDetail({ ok: false, rows: [], error: String(failure?.message ?? failure) });
          })
          .finally(() => {
            if (!cancelled) setDetailBusy(false);
          });
        return () => {
          cancelled = true;
        };
      }, [showDetail, detailKey, detailPage]);

      const totals = overview?.totals ?? {};
      const allRoutes = Array.isArray(overview?.routes) ? overview.routes : [];
      // "Channel × model" reports usage, so a row that never counted a token is
      // noise in the table, the share donut and the trend alike: it is dropped
      // from all three rather than listed as a zero column.
      const routes = allRoutes.filter((row) => tokenTotalOf(row) > 0);
      // The card opens as a short preview; the header toggle reveals the tail.
      const foldedRoutes = tableExpanded ? 0 : Math.max(0, routes.length - TABLE_PREVIEW_ROWS);
      const visibleRoutes = foldedRoutes > 0 ? routes.slice(0, TABLE_PREVIEW_ROWS) : routes;
      const canFoldRoutes = routes.length > TABLE_PREVIEW_ROWS;
      const series = seriesWithUsage(overview?.series);
      const heatByDay = new Map((overview?.heatmap ?? []).map((entry) => [entry.day, Number(entry.total) || 0]));
      const streak = overview === null ? { longest: 0, current: 0 } : streaks(heatByDay, overview.heatFrom, overview.heatTo);
      const trendFrom = overview?.from ?? overview?.firstDay ?? overview?.heatFrom;
      const rangeOptions = [
        { value: 'today', label: t('rangeToday') },
        { value: '7d', label: t('range7d') },
        { value: '30d', label: t('range30d') },
        { value: 'all', label: t('rangeAll') },
      ];

      return h(
        'div',
        { className: 'dum-root' },
        h('header', { key: 'hero', className: 'dum-hero' }, [
          h('div', { key: 'id', className: 'dum-heroMain' }, [
            h('h2', { key: 'title', className: 'dum-title' }, t('title')),
            h('p', { key: 'sub', className: 'dum-sub' }, t('subtitle')),
          ]),
          h('div', { key: 'bar', className: 'dum-bar' }, [
            h('span', { key: 'label', className: 'dum-barLabel' }, t('rangeLabel')),
            h(Segmented, { key: 'seg', label: t('rangeLabel'), value: range, options: rangeOptions, onChange: setRange }),
            h('span', { key: 'sp', className: 'dum-spacer' }),
            h(
              'span',
              { key: 'when', className: 'dum-rangeText', title: `${overview?.from ?? t('allTime')} → ${overview?.to ?? '…'}` },
              `${overview?.from ?? t('allTime')} → ${overview?.to ?? '…'}`,
            ),
            h('button', { key: 'refresh', type: 'button', className: 'dum-btn', disabled: busy, onClick: () => setNonce((value) => value + 1) }, busy ? t('loading') : t('refresh')),
          ]),
        ]),
        h('div', { key: 'kpi', className: 'dum-stats' }, [
          h(Stat, { key: 'total', label: t('kpiTotal'), value: totals.total, display: compactCount(totals.total), tone: 'accent' }),
          h(Stat, { key: 'peak', label: t('kpiPeak'), value: overview?.peakDay?.total ?? 0, display: compactCount(overview?.peakDay?.total ?? 0), sub: overview?.peakDay?.day ?? '—' }),
          h(Stat, { key: 'requests', label: t('kpiRequests'), value: totals.requests }),
          h(Stat, { key: 'active', label: t('kpiActive'), value: overview?.activeDays ?? 0 }),
          h(Stat, { key: 'streak', label: t('kpiStreak'), value: streak.longest }),
        ]),
        h('p', { key: 'note', className: 'dum-note' }, t('noCost')),
        error === null
          ? null
          : h('div', { key: 'error', className: 'dum-msg', 'data-tone': 'err', role: 'alert' }, [
              h('span', { key: 'dot', className: 'dum-dot' }),
              h('span', { key: 'body', className: 'dum-msgBody' }, error),
              h('span', { key: 'sp', className: 'dum-spacer' }),
              h('button', { key: 'retry', type: 'button', className: 'dum-btn', disabled: busy, onClick: () => setNonce((value) => value + 1) }, t('refresh')),
            ]),
        h(
          'div',
          { key: 'heat', className: 'dum-card' },
          h(
            'div',
            { className: 'dum-cardHead' },
            h('h3', { className: 'dum-cardTitle' }, t('heatTitle')),
            h('span', { className: 'dum-legendSub' }, fmt(t('heatSub'), { n: formatCount((overview?.heatmap ?? []).length) })),
          ),
          overview === null ? h(Loading, { label: t('loadingCard') }) : h(Heatmap, { t, heatmap: overview.heatmap, from: overview.heatFrom, to: overview.heatTo }),
        ),
        h(
          'div',
          { key: 'trend', className: 'dum-card' },
          h('div', { className: 'dum-cardHead' }, h('h3', { className: 'dum-cardTitle' }, t('trendTitle'))),
          overview === null ? h(Loading, { label: t('loadingCard') }) : h(TrendChart, { t, series, from: trendFrom, to: overview.to }),
        ),
        h(
          'div',
          { key: 'donut', className: 'dum-card' },
          h('div', { className: 'dum-cardHead' }, h('h3', { className: 'dum-cardTitle' }, t('donutTitle'))),
          overview === null ? h(Loading, { label: t('loadingCard') }) : h(Donut, { t, routes }),
        ),
        h(
          'div',
          { key: 'table', className: 'dum-card' },
          h(
            'div',
            { className: 'dum-cardHead' },
            h('h3', { className: 'dum-cardTitle' }, t('tableTitle')),
            h('span', { className: 'dum-spacer' }),
            canFoldRoutes
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'dum-btn',
                    'aria-expanded': tableExpanded === true,
                    onClick: () => setTableExpanded((value) => !value),
                  },
                  tableExpanded ? t('tableCollapse') : t('tableExpand'),
                )
              : null,
            h('button', { type: 'button', className: 'dum-btn', 'aria-expanded': showDetail === true, onClick: () => setShowDetail((value) => !value) }, showDetail ? t('detailHide') : t('detail')),
          ),
          overview === null ? h(Loading, { label: t('loadingCard') }) : h(LedgerTable, { t, summary: { rows: visibleRoutes, totals, folded: foldedRoutes } }),
          showDetail === true
            ? h(
                'div',
                { key: 'detail', className: 'dum-card' },
                h('h3', { className: 'dum-cardTitle' }, t('detailTitle')),
                h(DetailTable, {
                  t,
                  detail,
                  loading: detailBusy,
                  page: detailPage,
                  onPage: (next) => setDetailCursor({ key: detailKey, page: Math.max(0, next) }),
                }),
               )
             : null,
        ),
        h(Health, { key: 'health', t, health }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin body                                                        */
    /* ------------------------------------------------------------------ */

    const name = NS;
    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ensureStyles();

      let translate = (key) => key;
      try {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh: DICT_ZH,
              en: DICT_EN,
            }),
          'dsh-usage-meter: dictionaries',
        );
        translate = ctx.locale.bind(NS);
      } catch (error) {
        console.warn(`[${NS}] locale registration failed, falling back to Chinese copy:`, error);
      }

      // Sidebar panel entry, ordered last among the global panel icons
      // (plugins / 技能 / 日程). A `sidebar.panellist` id addresses the matching
      // `main` key, so the entry supplies the glyph and the row label only.
      try {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 1000, label: () => translate('nav') },
            (ownerProps) => h(Boundary, { fallback: translate('crashed') }, h(PanelIcon, { size: ownerProps?.size })),
          ),
        );
        console.log(`[${NS}] sidebar panel entry registered`);
      } catch (error) {
        console.warn(`[${NS}] sidebar.panellist registration failed:`, error);
      }

      // The central column that sidebar entry selects.
      try {
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_ID },
            () => h(Boundary, { fallback: translate('crashed') }, h(UsageMainPanel, { t: translate })),
          ),
        );
        console.log(`[${NS}] main panel registered for "${PANEL_ID}"`);
      } catch (error) {
        console.warn(`[${NS}] main panel registration failed:`, error);
      }
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});