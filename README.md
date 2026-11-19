# dsh-usage-meter

DSH（DeepSeek Harness）的**模型 token 用量统计**插件。只记用量，**不计费**：账本里没有任何单价、金额、汇率或余额字段。

统计口径是 **渠道（provider）× 模型 × 日期**，每次模型调用记一行，可以回答：

- 哪个中转渠道烧的 token 最多
- 某个模型今天 / 近 7 天 / 近 30 天用了多少
- 输入、输出、缓存读各是多少
- 每个渠道累计发了多少次请求

## 它记录什么

挂在 `llm/stream` 瀑布事件上旁路观察每一次流式模型调用，读取 adapter 上报的 `TokenUsage`：

| 字段 | 含义 |
|---|---|
| `input` | `inputTokens` |
| `output` | `outputTokens`（reasoning 已包含在内，不重复累加） |
| `cacheRead` | `cacheReadTokens` |
| `cacheWrite` | `cacheWriteTokens`（采集但不展示，见下） |
| `reasoning` | `reasoningTokens`（采集但不展示；本就在 `output` 内，不参与 `total`） |
| `total` | `input + output + cacheRead + cacheWrite` |

另外记录 `provider`（渠道）、`model`、`purpose`（`main` / `compaction` / `session-title` / `backfill` …）、`sessionId`、时间戳。

> `cacheWrite` 与 `reasoning` 仍然**采集并存进账本**，但**页面不显示这两列**：本机 1.7 万条历史记录里两者恒为 0，展示两列空数据只是噪音。要查它们，直接读 JSONL 或用 `jq`。

### 两条数据来源

| 来源 | 覆盖范围 | `purpose` | `source` |
|---|---|---|---|
| `llm/stream` 实时旁路 | 插件加载之后的每一次模型调用（含未写进会话日志的调用） | `main` 等真实用途 | `stream` |
| **历史回填**（一次性） | 插件存在**之前**的全部用量，折叠自持久会话日志 | `backfill` | `session-log` |

回填只跑一次，见下面「历史回填」一节。

## 它不做什么

- 不算钱：没有价格表、没有成本、没有余额查询（余额请用 dsh-whale-widget）。
- 不改 provider 配置、不改模型选择、不改任何 llm 行为；采集失败只在日志里告警，绝不影响模型调用。
- 不做自动清理，不删除任何历史；账本是追加写入的。
- 不联网：数据只写本地磁盘。

## 安装

插件目录（下称 `<插件目录>`，即本仓库克隆到你本机的位置）

### 方式一：手工挂到 profile（与同目录其他插件一致）

1. 在 profile 的 `package.json` 里加依赖与 bundle：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-usage-meter"
      ]
    }
  },
  "dependencies": {
    "dsh-usage-meter": "link:<插件目录>"
  }
}
```

2. 在 profile 目录跑一次 `pnpm install`（或 `dsh plugin --profile <名字> add <插件目录>`）。
3. **重启 DSH**（首次加进 profile 必须重启；只有 client bundle 变化会热更新）。
4. 打开 设置 → **用量统计**。

### 改了 host 代码之后怎么生效（不用重启）

profile 是 live 的，用插件管理器把这个插件**停用再启用**即可重新激活 fiber，代码立刻是新版：

```sh
dsh plugin --profile desktop disable usage-meter
dsh plugin --profile desktop enable usage-meter
```

（GUI 里「内置插件」页开关同一件事。第一次加入 profile 仍然要重启，因为 bundle 列表是在启动时读的。）

### 方式二：dsh plugin 转发

```sh
dsh plugin --profile desktop add <插件目录>
```

随后用 `dsh --profile desktop --dump-config` 确认出现 `id: usage-meter` 这一层。

## 使用

**入口**：侧边栏顶部的**全局面板列表**里，和「插件」「技能」「日程」并排的通栏行，`order: 1000` 保证**永远排在最后一个**。点它切换中央主栏到用量统计；点列表里其他项（或「对话」）就切回去。

> 这符合该座位的契约：`sidebar.panellist` 的说明是「Each list id addresses the matching main panel」，所以入口只提供图标，行按钮、标签和点击区域都由侧边栏自己渲染；面板内容注册在同名的 `main` key 上。

**主栏内容**，自上而下：

1. **KPI 条**：累计 Token 数、峰值 Token 数（单日最高，下面小字标出是哪天）、请求数、活跃天数、最长连续天数。
2. **Token 活动**：近 365 天的日历热力图，每格一天，颜色按当日用量分 4 档；鼠标悬停显示当天 tokens。
3. **每日 Token 趋势图**：按所选时间范围画折线，每条线一个渠道 × 模型，只画用量前 5 的渠道 × 模型；后面的一律并成一条「其他」线（按天求和），不单独占图例位置。天数 ≤ 45 时每个数据点带圆点提示。
4. **渠道 × 模型 用量**：占比环形图 + 份额列表（百分比、tokens、次数），同样只列前 5，其余合并为一行「其他」。
5. **渠道 × 模型**：明细表格（请求 / 输入 / 输出 / 缓存读 / 合计）；默认只显示前 5 个分组，右上角「展开」看全部，再展开「原始明细」看逐条调用。原始明细按 **每页 10 条**分页，底部是「第 [页码框] / Y 页 · 共 N 条」：中间那个数字就是输入框，键入页码按**回车**直接跳转（Esc 或点开别处还原），越界数字会标红且不跳转；翻页走服务端 `offset`，不把整本账搬到浏览器。
6. **账本状态**：采集开关、去重窗口、历史回填结果、各计数器与 `activation.log` 路径。

时间范围（今天 / 近 7 天 / 近 30 天 / 全部）作用于 KPI、趋势图、占比和表格；热力图固定是近 365 天，用来一眼看全年节奏。切走再切回来会重新拉一次数据。

**工具**：模型可以调用 `usage_stats`，参数 `range`、`groupBy`、`provider`、`model`、`limit`。直接问「上周哪个渠道用的 token 最多」即可。工具保留了 `provider` / `model` / `day` 三种分组（页面只固定用「渠道 × 模型」），因为对话里按天或按单模型切片仍然有用。

**只读 HTTP**（仅供本机页面使用，回环 + 同源校验，非本机 Host 一律 403）：

| 路由 | 说明 |
|---|---|
| `GET /dsh-usage-meter/overview.json?range=&heatmapDays=&series=` | 设置页一次拿齐：KPI、热力图、趋势序列、占比、明细表 |
| `GET /dsh-usage-meter/summary.json?range=&groupBy=&provider=&model=&limit=` | 分组汇总 |
| `GET /dsh-usage-meter/events.json?range=&limit=&offset=` | 最近原始调用（`offset` 为跳过的条数，返回 `rows` / `matched` / `offset` / `limit`，供分页） |
| `GET /dsh-usage-meter/health.json` | 账本状态与采集计数器 |

## 配置

改 profile 的 `cordis.patch.yml`（或在 `dsh plugin` 安装后由 patch 层覆盖），键位见 `cordis.patch.yml` 内的注释：

```yaml
- id: usage-meter
  name: dsh-usage-meter
  config:
    enabled: true
    dir: C:\Users\<you>\.dsh\usage-meter
    dedupWindowMs: 2000
    excludePurposes: []
    maxDetailRows: 200
    backfill: true
    backfillMaxSessions: 2000
```

`config` 是整段替换（不是深合并），覆盖时请重述所有想要的键。

## 历史回填

插件第一次加载时会**一次性**折叠所有持久会话日志，把插件存在之前的用量补进账本：

- 通过 `ctx.sessionQuery.listSessions()` + `readSession()` 读取。`sessionQuery` 是**可选**依赖：本组合没有这个服务时回填直接跳过（记为 `unavailable`），不影响实时采集，也不会让插件失活。
- 折叠语义与 Harness 自己的 token 用量投影一致：`request/header` 提供渠道/模型，`assistant/message`（自带 `usage`）或 `assistant/attempt`（用量在录制流里）提供数字；同一 `(turn, step)` 槽位的重复结算只算一次、不同数字按**替换**处理；`llm/retry-started` 关闭槽位，让重试单独计一次。
- **fork / 子代理的日志开头是父会话的继承前缀**，`inheritedEventCount` 之前的事件全部跳过，否则父会话的账会被再算一遍。
- 只折叠早于「实时采集起点」的结算。起点 = 账本里最早那一行的 `ts`，再往前留 5 秒护栏；所以实时与回填不会把同一通调用算两次。
- 结果写进 `backfill.json`，重装或停用/启用都不会重跑。跑完在设置页「账本状态 → 历史回填」显示「N 条 / M 个会话（跳过 K 条已实时采集）」。
- **想强制重跑**：`backfill.json` 与账本要一起删。只删 `backfill.json` 的话，起点会按现有账本最早行重新划线，历史行会被再补一遍（重复计）。

## 数据

默认目录 `$DSH_HOME/usage-meter/`，按月一个文件 `events-YYYY-MM.jsonl`，一行一次调用：

```json
{"ts":1790000000000,"day":"2026-09-30","provider":"qwen","model":"deepseek-v4.1-flash","purpose":"main","sessionId":"...","input":1234,"output":56,"cacheRead":7890,"cacheWrite":0,"reasoning":12,"total":9180,"reportedTotal":1290,"source":"stream"}
```

- `total` 是插件自己的口径（四侧之和）；`reportedTotal` 是 provider 原样上报的 `totalTokens`，只作对照。
- `backfill.json` 记录那次历史回填的起点、条数与跳过数；`activation.log` 是三个贡献的安装结果与失败堆栈（见「排障」）。
- 文件是追加写入的人可读 JSONL，可以用 `jq`、Excel、pandas 直接处理。
- 单写者假设：同一个账本目录只应由一个正在运行的 DSH 进程写入。

### 关于去重

`llm/stream` 位于 retry / replay 之外，理论上同一次调用可能被上报两次。因此默认启用 **2 秒去重窗口**：同渠道、同模型、同用途、同会话且四个 token 数完全相同的连续上报，只记一次，并把次数计入 `health.json` 的 `stats.duplicates`（设置页「已合并重复上报」）。

- 判断依据可观察：如果这个计数一直是 0，说明这个 Harness 版本不会重复上报，可以把 `dedupWindowMs` 设成 `0` 完全关闭合并。
- 反过来，如果发现分组 totals 明显偏大且该计数也在涨，说明确有重复上报，保持默认即可。

## 验证

静态检查（不需要重启 DSH）：

```sh
cd <插件目录>
node --check lib/plugin.js && node --check lib/host.js && node --check lib/store.js && node --check lib/backfill.js && node --check lib/client.js
```

装好并重启之后，四步自测：

1. 在这个 GUI 里正常聊一句，让它回一段话。
2. 点侧边栏顶部面板列表里**最后一个**通栏项「用量统计」（三根柱子图标）；中央主栏应切到用量统计。范围切「全部」应能看到回填进来的历史日期。
3. 页面底部「账本状态」应显示 采集运行中、数据目录、已记录 ≥ 1、历史回填「N 条 / M 个会话」；再点「原始明细」应看到时间戳，`用途` 列里 `backfill` 是历史、`main` 是实时；表格底部应有「第 [页码框] / N 页 · 共 M 条」、可用的「上一页 / 下一页」；在页码框里输入 27 回车，应直接跳到第 27 页，输入 99999 回车则输入框标红且不跳转。
4. 「渠道 × 模型」与「最近调用」两张表里都不应再有「缓存写」「推理」两列（这两项仍在账本里，只是不展示）。

## 卸载

1. 从 profile 的 `bundles` 与 `dependencies` 里删掉 `dsh-usage-meter`，跑一次 `pnpm install`，重启 DSH。
2. 想彻底清掉历史：删掉 `$DSH_HOME/usage-meter/` 整个目录（插件不会自己删）。

## 排障：activation.log

插件的三个贡献（`capture` 采集监听 / `routes` HTTP 路由 / `tool` 工具）各自独立安装，**任何一个装不上都不会拖垮整个插件**：其余照常工作，失败原因追加写进

```
$DSH_HOME\usage-meter\activation.log
```

每行形如 `2026-09-30T02:40:39.444Z tool: ok`；失败时是 `tool: FAILED ...` 加上 6 行堆栈。这个文件保留最近 64KB。

面板「账本状态」里也会把失败的贡献列成红色的「安装失败」徽标，并显示错误原文与该日志路径。

另外：**`apply()` 不能返回非 disposer 的值**（返回任意对象会让 fiber 直接 `failed`，插件完全不激活），这也是本插件早期版本踩过的坑。

## 已知限制

- 只覆盖走 `llm/stream` 的调用；如果某个 provider 全程不上报 `usage` chunk，该调用不会产生记录（连 `requests` 也不会加）。
- 明细查询按文件读取，`range=all` 时最多回看最近 3 个月文件；汇总不受此限制（会按需载入涉及的月份文件）。
- 明细分页是**每次翻页都重扫**对应月份文件后再切片（现有 1.6 万行约 70ms），所以翻页不是增量的；账本体量再上一个数量级时应改成按月份建索引。
- 折叠后的汇总缓存在内存里；进程重启后首次查询会重新扫描涉及的月份文件。

## 许可

MIT