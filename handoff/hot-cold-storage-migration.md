# 热/冷两级存储迁移手册

日期：2026-07-30（Asia/Shanghai）
服务器：`10.148.16.21`（`u16.local`），用户 `minhill`

## 背景

`/data` 整体挂载在 NFS（`as13000.local:/qxt21yjdata`）。服务器实测同一批 200 个文件：

| 存储 | 状态 | 单文件平均 |
| --- | --- | ---: |
| NFS | 冷读 | **729 ms** |
| NFS | 暖读 | 3 ms |
| 本地 SSD | 读 | **2 ms** |

本地盘裸速 498 MB/s 写、804 MB/s 读（`lsblk` 报 `ROTA=1` 是 VMware 虚拟盘误报）。
方案：近 7 天数据放本地 SSD，更早的留在 NFS，nginx 按「先热后冷」查找。

## 容量

单个完整起报时次 **6.8G**（`du`，约 2 万个 SVG），每天 2 次（00/12）= 13.6G/天，
含 JSON 约 14.8G/天。本地盘 `/dev/sda2` 492G 已用 171G、**可用 296G**。

保留 7 天占用约 **104G**，余量 192G。留足空间给其他数据与图层扩容
（图层配置曾从 3154 文件/时次涨到 2 万，涨了 8 倍）。

访问日志（6929 次 SVG 请求）显示请求集中在最近 4 个时次，7 天覆盖实际使用。

## 已完成的代码改动

| 文件 | 改动 |
| --- | --- |
| `src/archive_cold_data.py` | 新增。按保留期把超期时次 rsync 迁到冷盘。 |
| `src/draw_schedule.py` | 每天 03:39 触发归档，与生成任务共用单 worker 线程池，二者永不并发。 |
| `tests/test_archive_cold_data.py` | 新增 15 项测试，含真实 rsync 迁移语义（已在服务器 venv 跑通）。 |
| `ecosystem.weather-business.config.js` | 输出根改热盘，新增 `WEATHER_COLD_ROOT` / `WEATHER_HOT_RETENTION_DAYS`。 |
| `start_weather_business_pm2.sh` | 同上环境变量；新增热盘可写性预检，不可写则提前失败。 |
| `nginx_nwp.conf` | `/data/` 两级 `try_files`：热盘未命中回落 NFS，冷盘走 `aio threads`。 |
| `src/draw/svg_layer_rendering.py` | `vort_fill` 黄橙红色阶 85 档 → 6 档。 |
| `vis_web/src/utils/colorLegend.js` | 图例同步为 10 档。 |

### vort_fill 优化效果

色阶从「4 档蓝 + 85 档黄橙红」（89 档）改为「2 档蓝 + 6 档黄橙红」（8 档）。
同一时次、同一数据、同一参数的严格 A/B（服务器实跑，`2026072812/102/1000`）：

| 配置 | 档数 | 单块瓦片 SVG | 渲染耗时 |
| --- | ---: | ---: | ---: |
| 原：低 4 + 高 85 | 89 | **67.64 MB** | 4.11 s |
| 中间态：低 4 + 高 6 | 10 | 9.63 MB | 0.59 s |
| **最终：低 2 + 高 6** | **8** | **7.40 MB** | **0.49 s** |

体积降 **89%**（9.1 倍），渲染快 8 倍。`vort_fill` 原先占全部产品体积 60%、
仅占 3.8% 请求量。

两段各自的贡献（合成场实测）：高值段 85→6 档省掉大部分；低值段 0.05–0.15 只跨 0.1
却落在噪声主导的近零涡度区，是碎片化最重的区间，4 档时单独占约 4.0 MB。

**注意**：单个瓦片体积随天气活跃度剧烈变化。同一路径在 `2026072912` 是 68.84 MB，
在 `2026072812` 只有 0.76 MB。上表是同数据对照，可靠；跨时次比较无意义。

### 色阶边界与图例

```
0.05  0.10 | 0.15  0.30  0.45  0.60  0.75  0.90  1.00
 蓝2 档     |          黄橙红 6 档
```

低于 0.05 由 `set_under` 透明；高于 1.00 由 `extend="both"` 收进溢出色。
前端 `colorLegend.js` 的 `VORT_COLORS` 必须与 Python 端 `COLOR_ARR_VORT` 逐档对应，
改任一端都要同步另一端。

## nginx 配置已验证

用非 root 的独立 nginx 实例（端口 18099）实跑验证了四种情况：

| 场景 | 结果 |
| --- | --- |
| 文件只在热盘 | 200，`X-Weather-Tier: hot` |
| 文件只在冷盘 | 200，`X-Weather-Tier: cold` |
| JSON 只在冷盘 | 200，`X-Weather-Tier: cold` |
| 两处都没有 | 404 |

两级都用 `root`（不用 `alias`）：`alias` + `try_files` 在 named location 中行为不可靠。
因此两个根目录下都需要 `data` 子项，见下面的目录准备。

## 部署步骤

### 环境事实（已实测确认）

| 项 | 值 |
| --- | --- |
| nginx worker 用户 | **`nginx`**（不是 `www-data`） |
| nginx 版本 / 线程支持 | 1.30.1，带 `--with-threads` |
| 生效的 server 配置 | 仅 `/etc/nginx/conf.d/nginx_nwp.conf`（无重复 `server_name`） |
| `sudo` | **需要密码**，所有 sudo 步骤须你手工执行 |
| `pm2` 路径 | `/home/minhill/.local/share/pnpm/pm2`（已修好 `.bashrc`，SSH 命令可直接用） |
| 本地盘 | 492G，已用 172G，**可用 295G** |
| 近 7 天时次数 | 13 个（约 88G） |

### 第 0 步：加 nginx 线程池（sudo，你执行）

在 `/etc/nginx/nginx.conf` 的 **main 段**（最顶层，`user nginx;` 那一层，
**不在 `http {}` 内**）加一行：

```nginx
thread_pool weather_io threads=32 max_queue=65536;
```

当前该文件只有 `user nginx;` 和 `worker_processes auto;`，没有 `thread_pool`。
**缺这行 nginx 会启动失败**，因为新配置引用了 `aio threads=weather_io`。

加完先只做语法检查，**暂不 reload**：

```bash
sudo nginx -t
```

### 第 1 步：准备目录（sudo，你执行）

```bash
# 热盘：生成任务要写，属主给 minhill
sudo mkdir -p /srv/weather/hot/data/products
sudo chown -R minhill:minhill /srv/weather/hot
sudo chmod -R 755 /srv/weather/hot

# 冷盘：符号链接指向 NFS，让 nginx 能用 root 指令访问
sudo mkdir -p /srv/weather/cold
sudo ln -sfn /data/weather_vis /srv/weather/cold/data
```

验证 nginx 用户能读到两级路径：

```bash
ls -la /srv/weather/cold/          # data -> /data/weather_vis
sudo -u nginx test -r /srv/weather/hot/data && echo "hot readable by nginx"
sudo -u nginx test -r /srv/weather/cold/data/products && echo "cold readable by nginx"
```

两条都要输出成功。若冷盘那条失败，通常是 NFS 的 `sec=sys` 对 `nginx` 用户
不可读——此时先不要继续，回来告诉我具体报错。

### 第 2 步：暂停写入任务

```bash
pm2 stop weather-draw-schedule weather-trough
pm2 status
```

**这台服务器上跑着 18 个 PM2 app**（`adt-aidt-backend`、`cwcgom`、`huishang`、
`seafog`、`tc_env`、`vlm-backend` 等），只有 4 个属于天气系统。
**绝不要用 `pm2 stop all` 或 `pm2 restart all`**，会误停其他业务。

`weather-push-server` 和 `weather-push-schedule` 不写数据目录，可以继续跑。

### 第 3 步：复制近 7 天数据到热盘

注意这一步是**复制**而非移动，NFS 原件保留，便于随时回退。

先确认要复制的时次和空间：

```bash
CUTOFF=$(date -u -d '7 days ago' +%Y%m%d%H)
echo "cutoff: $CUTOFF"
cd /data/weather_vis
ls -1 products/ | sort | awk -v c="$CUTOFF" '$1 >= c'
df -h /                       # 确认可用空间 > 需求约 1.3 倍
```

放 `screen` 里执行复制（源端是 NFS 冷读，**预计数小时**）。
**按时次从新到旧**（`sort -r`）：最常访问的时次最先落到热盘，配合第 6 步的提前启动，
用户能最快感受到改善。

```bash
screen -S weathermig
CUTOFF=$(date -u -d '7 days ago' +%Y%m%d%H)
cd /data/weather_vis
for d in $(ls -1 products/ | sort -r | awk -v c="$CUTOFF" '$1 >= c'); do
  echo "=== $d $(date +%T) ==="
  rsync -a --info=progress2 "products/$d" /srv/weather/hot/data/products/
  [ -d "$d" ] && rsync -a "$d" /srv/weather/hot/data/
done
echo "ALL DONE $(date +%T)"
```

`Ctrl-A D` 脱离，`screen -r weathermig` 回来看进度。

**不必等这一步跑完就能开服**——见下面「迁移未完成时提前启动」。

复制完校验文件数一致：

```bash
for d in $(ls -1 /srv/weather/hot/data/products/ | sort); do
  a=$(find "/data/weather_vis/products/$d" -type f | wc -l)
  b=$(find "/srv/weather/hot/data/products/$d" -type f | wc -l)
  [ "$a" = "$b" ] && echo "OK   $d ($b)" || echo "DIFF $d nfs=$a hot=$b"
done
df -h /
```

全部 `OK` 再进入下一步。出现 `DIFF` 就对该时次重跑一次 `rsync -a`
（`rsync` 是增量的，重跑只补差异）。

### 迁移未完成时提前启动（推荐）

复制耗时数小时，**不需要等它跑完**。两级回落是按**单个文件**判定的，已实测确认：

| 状态 | nginx 行为 |
| --- | --- |
| 瓦片已复制到热盘 | 走热盘（快） |
| 瓦片还没复制 | 回落冷盘（慢，但可用） |
| `manifest.json` 还没复制 | 回落冷盘 |

三种情况都返回 200。因为第 3 步是**复制**，冷盘始终保有完整数据，所以任何未完成的
部分都能正常回落，用户看到的只是「部分快、部分还是老速度」，不会出现 404。

配合 `sort -r` 从新到旧复制，最常访问的时次最先加速。

**提前启动时必须先关掉归档**，否则有真实冲突：归档在 03:39 扫描热盘上超过 7 天的
时次，而随着复制持续数小时，那批时次里最旧的可能刚好跨过 7 天边界。此时归档会用
`rsync --remove-source-files` 把它从热盘搬回冷盘，和正在进行的复制方向相反、互相拉锯。
数据不会丢（冷盘有完整副本），但会白做大量 IO。

所以第 6 步先这样启动（`WEATHER_COLD_ROOT` 置空即禁用归档）：

```bash
cd /var/www/html/nwp_weather_system
WEATHER_COLD_ROOT= ./start_weather_business_pm2.sh
```

等第 3 步的 `ALL DONE` 出现、且校验全部 `OK` 之后，再用默认配置重启一次把归档打开：

```bash
./start_weather_business_pm2.sh
```

**另一个冲突点已确认无害**：生成任务只处理 `calLatestBaseTime()` 那一个时次
（`generate_svg_layers.py:118`），`backfill_manifest_from_existing_svgs` 也只扫
`output_root/<该时次>`，不会碰正在迁移的其他时次。唯一的重叠是最新时次同时被
rsync 复制和被生成任务写入——两者内容相同（rsync 的源就是之前生成的产物），
结果一致；若想彻底避开，可把最新 1–2 个时次从第 3 步的复制列表里排除，
交给生成任务自然写入热盘。

### 第 4 步：上传代码

从本地仓库同步这些文件到 `/var/www/html/nwp_weather_system/`：

```
src/draw/svg_layer_rendering.py       # vort_fill 色阶
src/archive_cold_data.py              # 新增
src/draw_schedule.py                  # 归档调度
tests/test_archive_cold_data.py       # 新增
tests/test_generate_svg_layers.py
ecosystem.weather-business.config.js
start_weather_business_pm2.sh
nginx_nwp.conf
vis_web/dist/                         # 本地 pnpm build 的产物（含图例改动）
```

在**本地**执行（Git Bash）：

```bash
cd H:/github/weather-system-identification
tar czf - src/draw/svg_layer_rendering.py src/archive_cold_data.py src/draw_schedule.py \
  tests/test_archive_cold_data.py tests/test_generate_svg_layers.py \
  ecosystem.weather-business.config.js start_weather_business_pm2.sh nginx_nwp.conf \
  | ssh nwp 'cd /var/www/html/nwp_weather_system && tar xzf - && echo "code synced"'

# 前端产物单独传（dist 已在本地构建）
tar czf - -C vis_web dist \
  | ssh nwp 'cd /var/www/html/nwp_weather_system/vis_web && tar xzf - && echo "dist synced"'
```

在服务器上确认改动到位并跑一次测试：

```bash
cd /var/www/html/nwp_weather_system
grep -n "VORT_LOW_BAND_COUNT = \|VORT_HIGH_BAND_COUNT = " src/draw/svg_layer_rendering.py
uv run python -m unittest discover 2>&1 | tail -3
```

应看到 `VORT_LOW_BAND_COUNT = 2`、`VORT_HIGH_BAND_COUNT = 6`，测试全绿。

### 第 5 步：切换 nginx（sudo，你执行）

```bash
sudo cp /etc/nginx/conf.d/nginx_nwp.conf /etc/nginx/conf.d/nginx_nwp.conf.bak-$(date +%F)
sudo cp /var/www/html/nwp_weather_system/nginx_nwp.conf /etc/nginx/conf.d/nginx_nwp.conf
sudo nginx -t
```

`nginx -t` **必须先通过**再 reload：

```bash
sudo nginx -s reload
```

验证两级命中（`X-Weather-Tier` 头指示数据来源，冷盘才有该头）：

```bash
# 近 7 天时次 -> 无 tier 头（热盘命中）
curl -sI https://nwp.gdmo.gq/data/products/2026072800/000/850/wind_barb/0/2/1.svg \
  | grep -iE "^HTTP|X-Weather-Tier"

# 旧时次 -> X-Weather-Tier: cold
curl -sI https://nwp.gdmo.gq/data/products/2026070400/000/850/wind_barb/0/2/1.svg \
  | grep -iE "^HTTP|X-Weather-Tier"

# manifest 与 JSON 也要通
curl -sI https://nwp.gdmo.gq/data/products/2026072912/manifest.json | grep -iE "^HTTP|X-Weather"
```

两个都应 `200`。若第 3 步尚未复制完，第一个可能也带 `cold` 头——这是正常的，
说明该文件还没轮到复制，回落生效。**任一为 `404` 才需要按「回滚」处理。**

### 第 6 步：重启任务

若第 3 步仍在进行，用这条（禁用归档，理由见「迁移未完成时提前启动」）：

```bash
cd /var/www/html/nwp_weather_system
WEATHER_COLD_ROOT= ./start_weather_business_pm2.sh
```

第 3 步已完成则用默认配置：

```bash
cd /var/www/html/nwp_weather_system
./start_weather_business_pm2.sh
```

脚本会预检热盘可写性，不可写则直接报错退出（不会让 PM2 起来后静默写失败）。

确认新数据写入热盘而非 NFS：

```bash
pm2 logs weather-draw-schedule --lines 40 --nostream
ls -la /srv/weather/hot/data/products/ | tail -3
# 等一轮生成（最长 10 分钟）后，新时次目录应出现在热盘
```

顺便确认新色阶生效——新生成的 `vort_fill` 应在 10 MB 以内而非 60 MB+：

```bash
find /srv/weather/hot/data/products -name '*.svg' -path '*vort_fill*' -newermt '-15 minutes' \
  -printf '%s %p\n' | sort -rn | head -3 | awk '{printf "%.2f MB  %s\n", $1/1048576, $2}'
```

### 第 7 步：dry-run 验证归档

```bash
cd /var/www/html/nwp_weather_system
uv run python src/archive_cold_data.py \
  --hot-root /srv/weather/hot/data \
  --cold-root /data/weather_vis \
  --retention-days 7 --dry-run
```

`--dry-run` 只打印计划、不动文件。刚部署时热盘只有近 7 天数据，
所以正常输出应是「没有超过 7 天的时次需要迁移」。

之后每天 03:39 自动执行，日志在 `logs/weather-draw-schedule.out.log`，
前缀 `[archive]`。第一次真正迁移会在热盘最旧时次超过 7 天时发生。

### 第 8 步（隔一两天后）：清理 NFS 上的重复副本

第 3 步是复制，所以近 7 天的数据现在 NFS 和热盘各有一份。等 nginx 切换稳定运行
一两天、确认热盘命中正常后再清理，回收 NFS 空间。

**这一步不可逆，逐个确认后删除，不要批量 `rm -rf`。**

```bash
# 先列出两边都存在的时次，确认热盘那份文件数一致
for d in $(ls -1 /srv/weather/hot/data/products/ | sort); do
  if [ -d "/data/weather_vis/products/$d" ]; then
    a=$(find "/data/weather_vis/products/$d" -type f | wc -l)
    b=$(find "/srv/weather/hot/data/products/$d" -type f | wc -l)
    echo "$d  nfs=$a  hot=$b  $([ "$a" = "$b" ] && echo SAFE-TO-DELETE || echo MISMATCH)"
  fi
done
```

只删除标记 `SAFE-TO-DELETE` 的，且一次一个：

```bash
rm -rf /data/weather_vis/products/<确认过的时次>
rm -rf /data/weather_vis/<同一时次>
```

注意归档功能会在时次超过 7 天时把它从热盘搬回 NFS，所以这里删掉的是「当前仍在
热盘保留期内」的重复副本，不影响后续归档。

## 回滚

在第 8 步之前，NFS 上始终保留完整原件，**回滚不涉及数据恢复**。

nginx 回退（最常用，30 秒内生效）：

```bash
sudo cp /etc/nginx/conf.d/nginx_nwp.conf.bak-<日期> /etc/nginx/conf.d/nginx_nwp.conf
sudo nginx -t && sudo nginx -s reload
```

任务写回 NFS：

```bash
cd /var/www/html/nwp_weather_system
WEATHER_OUTPUT_ROOT=/data/weather_vis WEATHER_COLD_ROOT= ./start_weather_business_pm2.sh
```

只想关归档、保留热盘写入：

```bash
WEATHER_COLD_ROOT= ./start_weather_business_pm2.sh
```

色阶回退：`git checkout src/draw/svg_layer_rendering.py vis_web/src/utils/colorLegend.js`
后重传。已生成的新色阶瓦片不会自动重绘，需要 `--overwrite` 重跑对应时次。

## 已修复：PM2 在 SSH 命令中找不到

**原因**：`~/.bashrc` 第 138 行本来就有 `PNPM_HOME` 和 PATH 设置，但文件开头的
非交互守卫会让 `ssh host "cmd"` 这类非交互 shell 提前 `return`，永远走不到那两行。
所以交互式登录能用 `pm2`，SSH 带命令就报「未找到命令」。

**已改**（2026-07-31）：把 export 移到守卫之前，并加去重判断避免 PATH 重复追加。

```bash
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
```

备份：`~/.bashrc.bak-2026-07-31-0023`。验证：`ssh nwp 'pm2 --version'` 返回 `5.4.2`，
交互与非交互 shell 中 pnpm 在 PATH 各出现 1 次。

因此本手册所有步骤都不再需要手动 `export PATH`。这也顺带修掉了
`start_weather_business_pm2.sh` 里 `ensure_node_tools()` 用 `command -v pm2` 检测时
误判为未安装、进而尝试 `npm install -g pm2` 的隐患。

## 待确认

- **归档时刻 03:39** 是否与其他运维任务冲突（可用 `--archive-*` 参数或
  `ARCHIVE_HOUR` / `ARCHIVE_MINUTE` 调整）。这台机器上还有 14 个其他业务的
  PM2 app，建议避开它们的高峰。
- **旧数据的 vort_fill 仍是 85 档产物**。新色阶只影响新生成的时次；已有时次除非
  用 `--overwrite` 重跑，否则保持原体积。