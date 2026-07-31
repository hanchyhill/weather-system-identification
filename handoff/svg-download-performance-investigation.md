# SVG 下载性能排查交接

更新日期：2026-07-30（Asia/Shanghai）

## 当前目标

定位 `vis_web` 生产/内网部署中 SVG 请求“下载很快但 Waiting/收到响应头很慢”的原因，并提供可运行时调整的前端诊断开关。

## 已实现、尚未提交的代码改动

- `vis_web/src/utils/downloadDebug.js`
  - 下载调试记录：Resource Timing、前端 SVG 队列/缓存/响应阶段和 Service Worker 预取阶段。
  - JSON 导出会剔除 URL 查询参数，最多保留 2,000 条记录。
  - 新增 `foregroundResponseDrain` 本地设置，用于控制 SW 是否执行 `response.clone().arrayBuffer()`。
- `vis_web/src/components/PushSubscribeButton.vue`
  - “全局设置 → 下载调试”中可开启记录、导出 JSON。
  - 新增“前台 SVG 并发数”（1–16，默认 4）即时控制。
  - 新增“Service Worker 完整读取响应体”开关；关闭时跳过上述 clone/body read，仅用于 A/B 诊断。
- `vis_web/src/utils/loadQueue.js`
  - 默认 `DEFAULT_MAX_CONCURRENT` 已从 8 改为 4。
  - 并发数持久化键：`weather-svg-max-concurrent`；运行时 `setMaxConcurrent()` 立即作用于新任务。
- `vis_web/public/sw.js` 与 `vis_web/src/utils/swClient.js`
  - SW 接收 `setForegroundResponseDrain` 消息。
  - 关闭完整读取后，SW 在收到响应头后结束前台计数；这会使后台预取的恢复判断更早，因此该开关只应用于诊断对照。
  - 新增 `setForegroundFetchBypass`：开启后页面 `/data/` 请求不再调用 `event.respondWith`，可完全绕过 SW 的页面请求拦截路径。
- `vis_web/src/utils/configBackup.js`
  - 并发数和完整读取开关均可随配置备份导入/导出。
- `nginx_nwp.conf`
  - SVG 产品路径设为 7 天 immutable 缓存与 `open_file_cache`。
  - 数据响应加入 `Server-Timing: nginx;dur=$request_time`；已证实该 header 在响应头生成时取值为 `0.000`，**不能**用于完整 Nginx 请求耗时判断，后续可移除。

## 验证状态

最近一次本地验证已通过：

```powershell
cd vis_web
pnpm test   # 37 项通过
pnpm build  # 通过
```

未创建 commit。开始后先检查 `git status --short`，不要覆盖现有未提交改动。

## 已分析的数据与结论

相关文件：

- `demo/weather-download-debug-2026-07-29T19-28-20-433Z.json`：前台并发 8。
- `demo/weather-download-debug-并发4.json`：前台并发 4。
- `demo/weather-download-debug-并发2.json`：前台并发 2。
- `demo/weather_data_timing.log`：用户从内网 Nginx 采集的 access log。

前台 SVG “开始 fetch 到收到响应头”的统计：

| 并发 | 请求数 | P50 | P95 | 最大 | 超过 5 秒 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 296 | 2.16 s | 21.28 s | 33.76 s | 41 |
| 4 | 123 | 1.54 s | 3.66 s | 4.40 s | 0 |
| 2 | 36 | 1.63 s | 5.03 s | 6.82 s | 3 |

注意：三次运行请求数量和图层组合不完全一致，不能视为严格性能基准；但并发 4 相比 8 已明显消除长尾，是当前默认值。

其他证据：

- 服务器本机对一个 `wind_barb` SVG 做 gzip/identity 串行及 8 并发 curl：TTFB 约 40–146 ms，gzip 不是 10–30 秒等待的主因。
- `weather_data_timing.log` 中所有请求协议均为 HTTP/2，SVG 的 `rt=0.000`；用户已确认来源 `10.148.36.92` 是其本机内网 IP，不存在先前推测的前置代理。
- Nginx 日志与前端慢请求导出时间段并未严格重叠，下一轮必须同步采集才能逐条关联。
- Service Worker 内部后台预取在旧日志中远快于页面 fetch（P95 约 0.7 s），因此“Window → Service Worker fetch 事件 → 网络”的页面路径是高优先级怀疑对象。

## 后续推荐实验（按优先级）

1. 部署当前前端，确保 Service Worker 已更新（硬刷新/关闭旧页面）。
2. 固定相同的地图、多图数量、起报时次、层次、图层和操作步骤；关闭后台预取；分别测试并发 2、4、8，每档至少重复三次并导出 JSON。
3. 在并发 4 下做 Service Worker 完整读取开关的 A/B：
   - 开启：保留原逻辑。
   - 关闭：跳过 `response.clone().arrayBuffer()`。
   - 对比 `page / response-headers / timingMs.queueAndTtfb` 的 P50/P95/max，以及前端队列等待。
4. 同时保留 Nginx access log，并确保其覆盖上述前端导出的准确时间段。若需服务端完整耗时，需在 `/etc/nginx/nginx.conf` 的 `http {}` 块定义包含 `$request_time` 的 `log_format`；不能只依赖 `Server-Timing` header。
5. 若关闭完整读取能显著改善，应重新设计 SW 的前台完成检测，避免按每个响应 clone 全量读取；要注意不能让后台预取在前台 body 尚在下载时过早恢复。
6. 已新增“完全跳过 Service Worker 数据请求拦截”开关。下一步应在并发 4、固定工作负载、后台预加载关闭的前提下，对比开启/关闭该开关；这是验证 SW fetch 事件路径的最高优先级实验。

## 最新 A/B 结果：跳过 Service Worker 额外读取

新增文件：

- `demo/weather-download-debug-并发4-跳过额外读取.json`
- 更新后的 `demo/weather_data_timing.log`（与该次导出时间段 04:07–04:10 +08:00 对应）。

在并发 4、关闭 `response.clone().arrayBuffer()` 后，页面请求并未改善：

| 模式 | 页面请求数 | 响应头等待 P50 | P95 | 最大 | 超过 5 秒 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 并发 4 + 完整读取 | 123 | 1.54 s | 3.66 s | 4.40 s | 0 |
| 并发 4 + 跳过额外读取 | 140 | 2.17 s | 5.21 s | 17.45 s | 9 |

两次工作负载不完全一致，因此不能把数值差异全部归因于开关；但该实验已否定“clone/body read 是主要瓶颈”的假设，至少它不是可直接消除长尾的修复方向。后续默认应保持完整读取开启，以维持后台预取在前台 body 完成后再恢复的原有语义。

更强的同步证据：跳过额外读取日志中最慢的两个页面请求为 17.45 s 和 16.75 s；它们对应的 Nginx 同 URL access log 都是 `status=200 rt=0.000`，且日志完成时间为浏览器收到响应头前约 1 秒。说明这十几秒中的绝大部分发生在 Window 调用 fetch 之后、请求真正抵达 Nginx 之前。Nginx 端 274 条记录里仅 1 条非零 `rt`（0.662 s），其余均为 0.000。

排查重点应转向浏览器发起请求/HTTP2 流调度或页面代码中 fetch 前后的异步链路，而不是 Nginx、gzip 或 Service Worker 的 clone 读取。

## 完全跳过 Service Worker 的首次结果（需要重测）

文件：`demo/weather-download-debug-并发4-跳过serviceworker.json`。

- 页面响应头等待 P50 降至 288 ms（原并发 4 + 完整读取为 1.54 s），这支持 SW 页面拦截路径存在影响。
- 但 P95 为 5.00 s、最大 7.06 s，不能据此直接宣布改善。
- 原因：该导出包含 278 个 `service-worker / prefetch-*` 事件。绕过前台请求后，SW 不再收到前台 fetch 事件，原有“前台请求到来即暂停后台预取”的机制失效，后台预取与页面直连请求发生竞争，实验被污染。
- 代码已修正：开启“完全跳过”时会 `cancelPrefetch('idle')`，且 `startPrefetch` 会拒绝启动。部署后应在固定工作负载下重新采样；关闭该开关后需刷新页面或重新应用预加载设置才会恢复后台预取。

## 完全跳过 Service Worker 的干净对照（v2，结论成立）

文件：`demo/weather-download-debug-并发4-跳过serviceworker_v2.json`。

- 后台预取事件为 0，说明该轮没有预取竞争，属于有效对照。
- 页面响应头等待：P50 为 186 ms（原并发 4 + 完整读取为 1.54 s，下降约 88%）；P95 为 4.87 s，最大 9.13 s。
- 两轮共有 16 个 URL；其中 12 个风羽 URL 在跳过 SW 后全部变快：平均等待从 2.72 s 降至 184 ms，P50 从 2.66 s 降至 176 ms。
- 结论：Service Worker 的**页面 `/data/` fetch 拦截路径**是前台中位数等待的主要根因。此前仅关闭 clone/body read 无效，说明问题不只在额外读取本身，而在完整拦截/协调路径与浏览器请求调度的组合。

建议的正式修复方向：默认让产品 SVG（`/data/products/.../*.svg`）绕过 SW fetch 事件；页面已通过 IndexedDB 保存 SVG 原始 Blob，无需 SW 再拦截 SVG。保留 manifest 的 SW 网络优先缓存。与此同时，应重新设计后台预取启动条件，避免它与前台 SVG 直接请求竞争；不要把当前“完全跳过”诊断开关直接作为永久默认行为。

## 正式修复已实施，待部署复测

- `sw.js` 对产品 SVG 路径直接返回，不再调用 `event.respondWith`；manifest 和其他数据请求仍保留现有 SW 策略。
- 页面 `cacheSvgSource()` 在真正发起 SVG 网络请求前后，通过 `foregroundSvgRequestStarted/Finished` 消息通知 SW。
- SW 收到开始通知时会暂停/中断后台预取；全部 SVG 请求完成并经历原有空闲窗口后，才恢复预取。这样保留“前端空闲时预加载到 IndexedDB”的功能，但页面 SVG 不再经过导致长等待的 SW fetch 拦截路径。
- 已运行 `pnpm test`（37 项通过）和 `pnpm build`（通过）。部署后应在正常模式（不启用“完全跳过”诊断开关）下再导出一次记录，验证性能与预取状态。

## 正式修复后的首轮记录：剩余卡顿已定位为页面队列

文件：`demo/weather-download-debug-2026-07-30T01-30-40-431Z.json`。

- 后台预取事件为 0，说明没有预取竞争；页面 SVG 已正常绕过 SW 响应拦截。
- 页面收到响应头的 P50/P95/最大为 953 ms / 4.69 s / 6.05 s，仍有请求长尾，但不是主要可感知停顿来源。
- 真正的瓶颈是前台高优先级队列：144 个高优先级请求的排队 P50/P95/最大为 2.86 s / 18.16 s / 23.18 s；其中 30 个排队超过 10 秒。
- 低优先级队列 111 个请求的 P95 仅 489 ms，说明低优先级只在高优先级清空后启动，调度逻辑正常；问题是同一时刻需要加载的“可见”高优先级 SVG 数量远超过当前全局并发 4。

下一轮应在正式 SW 修复已部署、后台预取关闭的相同工作负载下测试前台并发 6 和 8，观察响应头 P95 与高优先级队列 P95 的端到端折中。此前并发 8 的数据仍包含旧 SW 拦截，不能用于这一阶段的并发选择。

## 2026-07-30 复测：根因是服务器冷文件磁盘读取，前端结论需推翻

### 关键更正

**此前所有"Service Worker / 前端并发"结论都建立在被污染的数据上。**

复查 `demo/` 里的导出发现：并发 8、并发 4、并发 2、跳过额外读取这四份日志中，
所有 SVG 的 Resource Timing `transferSize` 均为 **0**——即这些请求全部由 SW 的
`respondWith` 提供或命中 HTTP 缓存，**没有产生真实网络字节**。用它们的"等待时间"
做并发对比是无效的。只有以下三份含真实网络传输：

| 文件 | 真实网络请求 | HTTP 缓存命中 |
| --- | ---: | ---: |
| `...01-30-40-431Z.json` | 242 | 13 |
| `...跳过serviceworker.json` | 243 | 0 |
| `...跳过serviceworker_v2.json` | 256 | 0 |

"跳过 SW 后 P50 从 1.54 s 降到 186 ms"的对比，实际是在拿"SW 代答/缓存命中"
和"真实网络"相比，两者本就不可比。

### 实测证据

用 Node 原生 `http2` 客户端（与浏览器同样单连接多路复用）直连生产服务器：

- **服务器本身很快**：暖文件 conc=16 时 TTFB p50=28 ms、p95=70 ms，吞吐 13 MB/s。
- **单线程串行、完全无并发**下，冷文件 TTFB 依然高达 1124 / 1440 / 2297 / 1909 ms，
  个别达到 9037 ms 甚至 12 s 超时。
- 同一批 25 个路径，串行三轮：

  | 轮次 | 平均 TTFB | >500 ms |
  | --- | ---: | ---: |
  | 第 1 轮（冷） | **986 ms** | 19/25 |
  | 第 2 轮（暖） | **4 ms** | 0/25 |
  | 第 3 轮（暖） | **3 ms** | 0/25 |

- 一个"视图" 16 块瓦片、并发 4：**冷 17.8 s，暖 0.1 s。**
- 排除 gzip：冷文件 `Accept-Encoding: identity` 平均 1635 ms，`gzip` 平均 1433 ms，
  两者无差异，说明与压缩无关，是纯磁盘读取延迟。
- 排除编码协商：`gzip` / `br` / `gzip, deflate, br, zstd` / `identity` 的暖文件
  TTFB 均为 1–19 ms。
- 排除主线程阻塞：Chrome 中主线程忙等 3 s 时，页面测得 3001 ms，但 Resource Timing
  仍正确报告 `waitingTtfb=10 ms`。页面自测值会把主线程排队算进去，不可单独作为网络指标。

结论：**瓶颈是服务器上 `/data/weather_vis/` 的冷文件磁盘读取，约 1 s/文件；
一旦进入 OS page cache 就降到 3–6 ms。** 与 Service Worker、前端并发数、gzip、
HTTP/2 调度均无关。

这也解释了为什么 Nginx `rt=0.000` 与浏览器观测矛盾——`$request_time` 的取值时机
无法反映该等待，此前已确认该字段不可用。

### 数据规模

单个 manifest 就有 **10,985 个瓦片文件**（zoom 0/1/2 分别 2505/1696/6784，
`wind_barb` 一层占 7791）。页面会同时用到 4 个起报时次，冷文件总量远超 page cache
可容纳范围，因此用户每次看未访问过的时次/时效都会撞上冷读。

### 建议的修复方向（服务端为主）

1. **确认存储介质**：在服务器执行 `df -hT /data/weather_vis`、`lsblk -d -o NAME,ROTA`、
   `mount | grep weather_vis`。若是机械盘或网络挂载（NFS/CIFS），这就是直接原因。
   `iostat -x 1` 观察 `r_await` 可进一步确认。
2. **生成后预热 page cache**：`draw_schedule.py` 产出 SVG 后，对该 init_time 目录执行
   一次顺序读（`vmtouch -t` 或 `tar cf /dev/null <dir>`），把文件带入 page cache。
   单个时次约 660 MB，需先确认可用内存。
3. **`open_file_cache_min_uses` 改为 1**：当前为 2，意味着每个文件首次请求必然
   绕过 file cache。注意它只缓存元数据，不解决内容读取。
4. **考虑减少文件数量**：冷读延迟与文件大小基本无关（32 kB 文件 1440 ms，
   423 kB 文件 8 ms），说明代价在每次寻道而非传输。把同一 fc_hour/level/layer 的
   多个瓦片合并为单文件，能把冷读次数降一个量级，这比任何前端调度优化都有效。
5. **`gzip_static`**：预压缩可省 CPU，但实测不是瓶颈，优先级低。

### 已确认：存储是 NFS 网盘

用户已确认 `/data/weather_vis/` 挂载在 NFS 网盘上，这与实测的冷读约 1 s、
暖读 3–6 ms 完全吻合——冷读代价是 NFS 网络往返 + 服务端寻道，与文件大小无关
（32 kB 文件 1440 ms，423 kB 文件 8 ms）。

**决定的服务端方案**：热数据迁移到本地盘符，7 天以上的数据重定向到现有 NFS 网盘。

### 前端改动已全部回退（2026-07-30）

既然根因在服务端，前端诊断期的改动全部撤回，只保留 Service Worker 缓存能力。

已回退到 HEAD 的文件：

- `vis_web/public/sw.js` — 移除产品 SVG 绕过 `respondWith`、`foregroundFetchBypass`、
  `foregroundResponseDrain` 诊断开关。
- `vis_web/src/utils/loadQueue.js` — 恢复 `MAX_CONCURRENT = 8`（改 4 的依据来自被污染数据）。
- `vis_web/src/composables/weatherView/helpers.js` — 移除 `foregroundSvgRequestStarted/Finished` 通知。
- `vis_web/src/utils/swClient.js`、`downloadDebug.js`、`configBackup.js`、
  `components/PushSubscribeButton.vue`、`tests/svg-prefetch-redesign.test.js` — 移除诊断开关与并发数 UI。

**保留的 Service Worker 缓存能力**（回退后仍在 `sw.js` 中）：
`startPrefetch` 后台预取、`putSource` 写 IndexedDB、`networkFirstManifest` 的
manifest 网络优先缓存、`respondWith` 拦截 `/data/` 请求、前台请求到来时暂停预取。

回退前的完整 diff 已存为 `handoff/frontend-diagnostic-changes.patch`（456 行），
需要时可 `git apply` 取回。

验证：`pnpm test` 36 项通过，`pnpm build` 通过。

保留的两个文件：

- `nginx_nwp.conf` — 配合本次服务端迁移，见下。
- `vis_web/vite.config.js` — `WEATHER_REMOTE_DATA` 调试代理，opt-in，不影响默认行为。

### nginx 配置调整（配合迁移）

- 移除两处 `Server-Timing "nginx;dur=$request_time"`：实测取值恒为 `0.000`，无法反映
  NFS 等待，是误导来源。
- 移除 `weather_timing` access_log：该格式需在 `nginx.conf` 顶层定义 `log_format`，
  排查阶段用完即可撤下。
- `open_file_cache_min_uses` 由 2 改为 **1**：一次性访问上万个瓦片的场景下，
  「首次请求必然绕过 file cache」等于该缓存对绝大多数请求无效。同时把
  `max` 提到 20000、`inactive` 放宽到 5m，覆盖单个 manifest 的 10,985 个瓦片。
- 新增 `aio threads=weather_io`：NFS 是阻塞式读取，不用线程池的话单个慢请求会
  占住 worker，连带拖慢本地盘上的热数据。**前置条件**：`nginx -V` 确认有
  `--with-threads`，并在 `nginx.conf` 的 main 段定义
  `thread_pool weather_io threads=32 max_queue=65536;`。

### 迁移方案的两点提醒

1. **7 天界线要对齐实际使用范围**。单个 manifest 有 10,985 个瓦片、页面同时用 4 个
   起报时次；用户一旦翻到第 8 天的数据，仍会掉回秒级冷读。建议先确认典型使用是否
   真的只看 7 天内，或对 NFS 段单独放宽前端提示。
2. **热数据盘容量**。单个起报时次约 660 MB（11k 文件 × 约 60 kB），7 天按每天 4 个
   时次估算约 18 GB，需确认本地盘余量与保留策略。

### 前端结论的处置

- 并发数从 8 改 4 的依据（长尾消失）来自被污染数据，**不构成保留 4 的理由**。
  真实网络下并发 4 冷读一个视图仍需 17.8 s。在冷读约 1 s 的前提下，适度提高并发
  反而能并行掩盖磁盘延迟；建议服务端修复后重新选值。
- SW 后台预取实际上**有益**（它在提前把文件读进 page cache），不应视为竞争源。
- `sw.js` 中产品 SVG 绕过 `respondWith` 的改动本身无害，可保留。
- 诊断开关（`foregroundResponseDrain` / `foregroundFetchBypass`）已完成使命，
  可在确认修复后移除。

### 本地调试方式

`vite.config.js` 新增 `WEATHER_REMOTE_DATA` 环境变量，设置后 `/data` 反代到线上：

```bash
cd vis_web
WEATHER_REMOTE_DATA=https://nwp.gdmo.gq pnpm dev
```

注意 Vite dev server 对浏览器是 HTTP/1.1，无法复现生产的 HTTP/2 行为；
定位网络问题时应直接用 Node `http2` 客户端压测生产地址。

## 部署提示

- 旧用户浏览器若已保存 `weather-svg-max-concurrent=8`，部署后仍会保持 8；须在设置页面改为 4，或清除该 localStorage 键。
- 生产 Nginx 曾报告重复 `server_name nwp.gdmo.gq` warning；确认实际生效 server block 后再调整配置。
- `expires 7d` 与手写 `Cache-Control` 会产生重复的 Cache-Control 值；不影响当前功能，但后续可清理为单一策略。
