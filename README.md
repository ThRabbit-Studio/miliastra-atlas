# Miliastra Atlas

[![Release](https://img.shields.io/github/v/release/ThRabbit-Studio/miliastra-atlas?label=release)](https://github.com/ThRabbit-Studio/miliastra-atlas/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**English name: `miliastra-atlas`** · 奇域数据导出器

> Export [Miliastra Wonderland](https://act.mihoyo.com/miliastra_wonderland/developer) (千星奇域) creator-center data into clean, analysis-ready Excel workbooks — one sheet per topic, Chinese headers, no debug noise.

浏览器扩展（Chrome/Edge，Manifest V3）：在米游社千星奇域创作者中心，把**奇域（关卡）数据**和**奇匠（创作者）数据**一键导出成一眼能看懂的 Excel 表格。

- 数据来源是**官方数据接口**（与页面显示完全一致），不是截图式抓取
- **分类分工作表**：趋势、分布、评论、指标汇总各自成表，表头全中文
- **只导有意义的数据**：导航文字、接口原始字段（`cur`/`delta`/`value_type`）、调试信息一律不进表格
- 需要你的**创作者中心登录态**（扩展用浏览器里的登录态直接调接口）

**直接下载安装包**：[miliastra-atlas-v1.2.0.zip](https://github.com/ThRabbit-Studio/miliastra-atlas/releases/download/v1.2.0/miliastra-atlas-v1.2.0.zip)（58.5 KB，解压后按下方第 1 节加载；用法与常见问题见 [Release 说明](https://github.com/ThRabbit-Studio/miliastra-atlas/releases/tag/v1.2.0)）

---

## 0. 快速开始（3 步）

```powershell
git clone https://github.com/ThRabbit-Studio/miliastra-atlas.git
cd miliastra-atlas
npm install            # 只用于跑测试（开发依赖 playwright）
npm test               # 单元测试 + 真实浏览器 E2E
```

扩展本体在 `extension/`，直接加载即可（不需要构建步骤）；打包分发包用 `npm run build`。

## 1. 安装

**方式 A：下载 Release 安装包（推荐给使用者）**

1. 下载 [miliastra-atlas-v1.2.0.zip](https://github.com/ThRabbit-Studio/miliastra-atlas/releases/download/v1.2.0/miliastra-atlas-v1.2.0.zip) 并解压到**固定目录**（例如 `D:\miliastra-atlas`，装了之后别删，Chrome 会一直引用它）
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）→ 开启右上角 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择解压出来的目录（含 `manifest.json` 的那一层）

**方式 B：从源码加载（推荐给开发者）**

1. `git clone https://github.com/ThRabbit-Studio/miliastra-atlas.git`
2. 打开 `chrome://extensions` → 开启 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择仓库里的 `extension` 文件夹

> 两种方式装的是同一个扩展；源码方式改完代码点一下重新加载即可，不需要构建。

**加载完成后**：打开 [千星奇域创作者中心](https://act.mihoyo.com/miliastra_wonderland/developer?mhy_presentation_style=fullscreen&mhy_auth_required=true) 并**登录**，页面右下角就会出现蓝色「导出奇域数据」按钮（也可点工具栏扩展图标）。

> 装扩展前就开着的页面不用手动刷新：点扩展图标会自动注入脚本。

## 2. 使用

进到你要分析的页面（奇域详情页 / 奇匠数据页都行），点右下角按钮 → **导出 Excel (.xlsx)**。

面板上依次选三项，再点导出：

**① 导出模式**

| 模式 | 产物 | 适合 |
| --- | --- | --- |
| **单表**（默认） | `数据概况` + `<奇域名>_数据总表` + `评论内容` + `数据说明`（4 张） | 筛选、透视表、折线图、导入 pandas |
| 分表 | 约 18 张按主题拆分的工作表 | 逐项查看、只看某一类 |

**② 导出区间**

| 区间 | 效果 |
| --- | --- |
| **近7日** | 每张趋势表只保留最近 7 天；汇总表的「近7日变化」（官方口径，如奇域热度 +117） |
| **近30日**（默认） | 30 天每日数据；汇总表给「近30日变化」 |
| **全部** | 接口返回的全部天数（当前近 30 天） |

**③ 分布区间**（仅单表模式）：`常规区间` / `长区间` / `超长区间` 三选一，决定 `数据总表` 里用哪套时长分布列。

三项选择都会被记住，下次打开面板还是上次的设置。

| 按钮 | 作用 |
| --- | --- |
| 导出 Excel (.xlsx) | 主产物，多工作表 |
| 导出 CSV | 单文件多段（`# 表名` 分段 + BOM，Excel 直接打开不乱码） |
| 导出 JSON | 接口原始响应 + 页面采集结果，便于排查 |
| 数据自检 | 显示解析到的奇域ID、图表来源、已拦截接口、页面「标签:值」清单 |
| 刷新数据 | 页面切换后重新采集 |

导出文件形如 `奇域数据_54461776301_尘世执政录_20261010_230145.xlsx`。

## 3. 导出的表格长什么样

支持两种导出模式（面板顶部切换），**默认单表**：

### 模式一：单表（默认）—— 一行一天的大表

产物 4 张工作表：`数据概况` + **`<奇域名>_数据总表`** + `评论内容` + `数据说明`。
示例：[miliastra-atlas-sample-single-30d.xlsx](test/out/miliastra-atlas-sample-single-30d.xlsx)（9.9 KB）

`数据总表` 把所有指标按「日期」合并，**同一天的奇域热度、时长、评论数、点击率、时长分布占比落在同一行**，可直接筛选 / 做透视表 / 插折线图：

| 奇域名称 | 日期 | 奇域热度 | 平均游玩时长(秒) | 平均游玩时长(秒)(可读) | 评论数 | 封面点击率(%) | 平均推荐率(%) | 奇域总热度 | 创作者平均推荐率(%) | 游玩指数 | 奇域总数 | 订阅人数 | ≤1分钟 占比(%) | … |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 尘世执政录 | 2026-09-27 | 59 | 140 | 2分20秒 | 1 | | 0 | 156 | 58.33 | 100 | 7 | 533 | 12.5 | … |
| 尘世执政录 | 2026-10-09 | 505 | 323 | 5分23秒 | 5 | 2.59 | 0 | 581 | 62.5 | 100 | 8 | 533 | 50 | … |

- 列会**自动裁剪**：某列在整个区间内都没有有效值就不出现
- 主干用接口返回的**每日序列**，不受页面上「近7日/近30日」图表显示范围限制
- 面板「**分布区间**」下拉可换用哪套时长区间：常规（≤1/1-3/3-5/5-7/>7）、长（≤3/3-6/6-9/9-12/>12）、超长（≤6/6-13/13-19/19-26/>26）

### 模式二：分表 —— 按主题拆成多张工作表

产物约 18 张表，按「先结论、后明细」排列（示例：[miliastra-atlas-sample-multi-30d.xlsx](test/out/miliastra-atlas-sample-multi-30d.xlsx)，26.3 KB）：

| 工作表 | 内容 | 为什么这样设计 |
| --- | --- | --- |
| **数据概况** | 奇域名/ID/状态/发布时间 + 本次关键指标 + 导出时间 | 打开先看这一页 |
| **关卡基础数据** | 项目-内容两列的基础信息 | 便于引用 |
| **页面指标一览** | 页面上各分组（游玩数据/互动数据/活跃指数…）的指标合并成一张：分组、指标、页面显示值、数值、单位、较昨日变化 | 避免「一行占一张表」 |
| **关卡指标汇总** | 一个指标一行：当日数值、单位、较昨日、**所选区间变化**、变化值来源 | 直接用于横向比较 |
| **奇域热度 / 平均游玩时长 / 评论数 / 封面点击率** | 日期 + 数值（时长另有可读列「5分23秒」） | 每张趋势表可直接插折线图 |
| **单局游玩时长分布** | **三套区间全导出**，用「区间组」列区分 | 与页面「常规/长/超长区间」下拉一致 |
| **单局时长分布_人数** | 同上的绝对人数 | 占比之外看体量 |
| **评论内容** | 用户 / UID / 评论时间 / 推荐态度 / 评论内容 / 点赞数 / 回复数 / 楼层 | 可直接做反馈分析 |
| **奇匠指标汇总** | 奇域总热度、热度排名、平均推荐率、游玩指数、奇域总数 + 区间变化 | 创作者维度一页看全 |
| **奇域总热度 / 平均推荐率(奇匠) / 游玩指数 / 奇域总数 / 订阅人数趋势** | 每项指标按所选区间的每日数值 | 你要的「奇匠数据」趋势 |
| **数据说明** | 口径、模式、区间、比率换算、缺失数据说明 | 让数字可追溯、可解释 |

> 同名指标会区分来源：关卡维度的「平均推荐率」和创作者维度的「平均推荐率(奇匠)」各占一张表，不会互相覆盖。

### 明确**不会**出现在表格里的东西

- 顶部导航文字（奇匠中心 / 奇匠论坛 / 通行证ID / 退出登录…）
- 接口技术字段：`metric_type`、`value_type`、`cur`、`delta`、`cur_invalid`、`retcode`、`message`
- 接口原始响应 dump、调试/自检数据、图表 DOM 细节
- 无有效数据的指标（接口标记 `cur_invalid` 的，直接不进表）
- 无有效数据的天（**留空而非填 0**，避免污染统计与画图）
- **没有分析价值的碎片表**：如「活跃指数」这种只有 1-2 行的独立表已并入「页面指标一览」；
  「订阅档位」（3 行固定门槛）、「奇域列表」（与单域分析无关）已不再导出

## 4. 数据是怎么取到的

```
页面(act.mihoyo.com) ──导出按钮──▶ background service worker
                                        │ 带登录态直连官方接口
                                        ▼
        GET /data/get_stage_detail?stage_id=…   → 关卡指标 + 30 天趋势 + 分布 + 评论
        GET /data/get_user_info                 → 奇匠指标 + 30 天趋势
        GET /data/get_stage_list                → 名下奇域列表
                                        │
                                        ▼
                     extract.js：中文名/单位/口径映射 → 多工作表 → xlsx
```

- 优点：**完整**（页面只显示 7 天也能拿到 30 天全量）、**准确**（单位换算显式写死并测试覆盖）
- 兜底：接口不可用时自动退回页面采集（DOM + ECharts），保证还能导出（此时区间选择同样生效）
- 比率口径：接口以「万分之一」存储，导出时除以 100（`6250 → 62.5%`）；`METRIC_VALUE_TYPE_SCORE` 按 100 归一（`10000 → 100`）
- 变化值来源：优先用接口给的区间变化量；接口标记为无数据时按该区间「首个有效点 → 末个有效点」计算，并在「变化值来源」列标注

## 5. 目录结构

```
miliastra-atlas/
├─ extension/                       ← 加载到浏览器的扩展本体（无需构建）
│  ├─ manifest.json
│  ├─ icons/
│  └─ src/
│     ├─ background.js              接口取数（带登录态）+ 下载落盘 + 按需注入
│     ├─ inject.js                  页面环境 fetch/XHR 拦截（兜底数据源）
│     ├─ content.js                 编排：取数 → 组表 → 导出
│     ├─ ui.js                      右下角悬浮面板（Shadow DOM）+ 区间选择
│     ├─ popup.html / popup.js      工具栏弹窗
│     └─ core/
│        ├─ extract.js              ★ 官方接口 → 工作表（字段/单位/口径映射）
│        ├─ data.js                 解析、清洗、字段中文化、兜底组表
│        ├─ collect.js              DOM + ECharts 采集（兜底）
│        └─ xlsx.js                 零依赖 XLSX 生成器（CompressionStream + ZIP + CRC32）
├─ test/                            测试与示例
│  ├─ extract-test.js               ★ 用真实接口响应断言工作表结构与所有单位换算
│  ├─ fixture/api/                  真实抓取的接口响应，作为固定测试数据
│  ├─ make-sample.js / dom-test.js / inject-test.js / chrome-stub-test.js / browser-e2e.js
│  └─ out/                          生成的示例表格（已被 .gitignore 忽略）
├─ tools/
│  ├─ api.js                        官方接口客户端（复用调试登录态）
│  ├─ live.js                       login（登录一次）/ capture / open
│  ├─ discover.js                   走真实 UI 路径枚举路由与接口
│  ├─ build-from-live.js            用真实/固定数据生成示例表格
│  └─ build.ps1                     预检 + 全部测试 + 打包 dist/*.zip
├─ package.json                     npm scripts（test / sample / build）
├─ LICENSE                          MIT
└─ .debug-profile/                  独立调试浏览器资料（含登录态，已忽略，勿上传）
```

## 6. 测试

```powershell
npm test                            # 全部测试（等价于下面几条依次执行）
npm run test:unit                   # 只跑不依赖浏览器的单元/集成测试
node test/extract-test.js       # 官方接口 → 工作表：单位换算/结构/去噪（92 项）
node test/make-sample.js        # 解析/打包 + CRC32 + XML 校验
node test/dom-test.js           # DOM 采集兜底路径
node test/inject-test.js        # fetch/XHR 拦截
node test/chrome-stub-test.js   # 扩展环境端到端 + 按需注入
node test/browser-e2e.js        # 真实 Chrome：官方接口路径 + 完整导出链路 + 区间切换
powershell -File tools/build.ps1   # 预检 + 全部测试 + 打包
```

> `browser-e2e` 用 Playwright 驱动**本机已安装的 Chrome/Edge**，不下载额外浏览器内核；
> 本机没有 Chromium 内核时会自动跳过，不影响其它测试。可用 `MHY_E2E_BROWSER` 指定浏览器路径。

调试用真实数据（用的是独立浏览器 profile，不影响你日常 Chrome）：

```powershell
node tools/live.js login          # 打开登录页，登录一次（登录态存 .debug-profile）
node tools/discover.js            # 走真实 UI 路径，枚举路由与接口并落盘
node tools/build-from-live.js     # 用 fixture/实时数据生成示例表格
node tools/build-from-live.js 54461776301   # 指定奇域 ID 现拉一份
```

## 7. 已知限制

- 需要登录态；未登录时接口返回 `retcode: -100`，扩展会提示并退回页面采集
- 「平均推荐率」这类指标在你的账号下可能整段为 0（接口就是这么返回的），此时该趋势表只会保留有数据的那几天
- 评论明细取的是接口返回的评论列表（默认最近若干条），不是全量历史评论
- 数值一律按接口原始口径导出，不做四舍五入以外的加工；如有疑问看「数据说明」表
- 接口地址与字段来自页面本身，官方改版后可能需要同步更新 `extension/src/core/extract.js` 的字段映射

## 8. 免责声明

- 本项目是非官方的第三方工具，**与 miHoYo / HoYoverse 无任何隶属或背书关系**
- 扩展只读取你自己账号在创作者中心**已有权限**看到的数据，**不上传、不中转、不留存**任何数据；导出的表格只落在你本机
- 调试资料目录 `.debug-profile/` 含登录态，已被 `.gitignore` 排除；**请不要把它提交或分享出去**
- 扩展通过官方接口取数，请自行控制调用频率，避免对服务造成压力；由此产生的风险由使用者承担
- 「原神」「千星奇域」及 miHoYo 等相关名称与标识归其所有者所有

## 9. 开发约定

- 改动解析逻辑后，先跑 `node test/extract-test.js`（有真实接口响应做断言），再跑全量 `npm test`
- 新增指标：在 `extension/src/core/extract.js` 的 `STAGE_METRICS` / `USER_METRICS` 里加一条映射（中文名、工作表名、排序、单位口径）
- 新增工作表：保持「先结论后明细」的顺序，并在 `test/extract-test.js` 里补对应断言
- 提交前确认没有把 `.debug-profile/`、`dist/`、`test/out/`、`*.pem` 带进版本库

