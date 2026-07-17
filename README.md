# 雁巢商品机会雷达

把跨平台趋势信号转成可采购、可验证、可上架、可复盘的商品机会卡片。项目以规则化趋势发现、来源风险折损、供给/销售代理评分和业务反馈校准组成 MVP 闭环。

## 快速开始

要求 Node.js 22–24 和 MySQL 8.0+。

```bash
npm install
copy .env.example .env
npm run migrate:mysql
npm run dev
```

`npm run dev` 只启动一个主进程：业务接口、React 开发中间件和 DailyHot 进程内适配器都由该进程承载。60s API 使用已验证的公开实例；无需账号或 API Key。

- 工作台：http://127.0.0.1:8787
- API：http://127.0.0.1:8787/api/health
- 就绪检查：http://127.0.0.1:8787/api/ready

## 验证

```bash
npm run check
npm audit
```

`npm run check` 会依次执行 ESLint、Prettier 检查、测试、类型检查和前后端生产构建。API 测试使用临时状态目录，不会修改 `data/` 中的本地业务记录。

覆盖率检查使用 `npm run test:coverage`。当前回归门槛为行 70%、语句 65%、函数 55%、分支 50%，后续新增适配器测试时只提高不降低。

## 功能

- 机会池：事件、市场、商品、趋势、供给、毛利代理、竞争、合规安全和来源置信度。
- 筛选搜索：市场、状态、商品、事件、类目和业务文本。
- 验证闭环：跟进、验证、打样、上架、放弃；支持负责人、截止日期、备注、证据链接和反馈历史。
- 评分校准：来源类型及风险折损置信度，最新业务反馈校准最终排序。
- 数据源状态：记录各适配器成功、失败、信号量和最后检查时间；健康接口会标记降级。
- 可靠状态：MySQL 事务、关系化采集/机会/反馈模型、OAuth 凭证加密；测试仍可通过临时 JSON 状态隔离。
- 安全控制：受限 CORS、同源写保护、可选反馈令牌、写接口限流和审计日志。

## 数据源与口径

- Google Trends：优先从 Google 官方 Trending Now RSS 按国家无关键词发现热点；`interestOverTime` 仅用于验证可选监控词，并明确标记为非官方通道。
- 微博与开放热榜：第三方或自托管聚合数据，通过保守的“场景 + 商品意图”规则映射。
- 淘宝官方主题：复用代购服务的 Taobao Global Open 网关、IOP HMAC-SHA256 签名和 Token，采集区域热销/优选主题；它是趋势发现证据，不等同于销量或供应商数据。
- 供给与销售：1688 已具备 Global Open 直连适配器，返回值是本次查询的供给样本，不计入趋势映射；凭证未配置或接口失败时回退为明确标记的 Seed。Amazon 销售验证仍需配置授权数据接口。
- 关键词：`TREND_WATCHLIST_KEYWORDS` 只是可选的已知词监控集合，不负责发现；候选热点来自 Google Trending Now、微博和开放热榜。
- 毛利代理：使用目标售价、采购成本、粗略履约系数和需求代理估算，只用于候选排序，不是财务毛利。
- 来源风险：`official / third_party / unofficial / seed` 与 `low / medium / high` 会共同影响置信度。

生产数据源优先级：官方 API > 授权商业数据源 > 公开低频数据 > 人工导出。禁止将账号池、验证码绕过、App 逆向或私有接口抓取作为生产方案。

### Hot-list 配置

- `DAILY_HOT_API_BASE_URL`：默认留空，DailyHot 作为进程内 Adapter 运行，不再占用独立端口；仅在需要替换为外部部署时配置 URL。
- `SIXTY_SECONDS_API_BASE_URL`：默认使用 `https://60s.viki.moe/v2` 公开实例，并标记为高风险第三方来源。
- `GOOGLE_TRENDS_GEOS`：Google Trending Now 发现国家/地区列表，逗号分隔的 ISO 国家码；当前默认监听 `AU,GB,CN,US,IT,ES,CA,FR,HK,DE`（澳大利亚、英国、中国、美国、意大利、西班牙、加拿大、法国、中国香港、德国）。
- `TREND_WATCHLIST_KEYWORDS`：可选的已知词验证列表；留空时不执行关键词轮询，避免把固定词监控误当成热点发现。
- `SUPPLY_SOURCE_API_URL`：授权供给数据服务；返回 `productName/supplierCount/minPriceCny/maxPriceCny/moq/leadTimeDays/complianceTags`。
- `SALES_SOURCE_API_URL`：授权销售数据服务的标准化网关；返回 `platform/competitorCount/targetPriceUsd/reviewPainPoints/demandProxy`，可选返回 ISO 8601 `observedAt`。如接口需要鉴权，通过 `SALES_SOURCE_API_TOKEN` 传入 Bearer Token；供给接口对应 `SUPPLY_SOURCE_API_TOKEN`。
- `SALES_SOURCE_PROVIDER`：销售来源类型，可选 `keepa`、`rainforest`、`amazon-sp-api` 或 `custom`。系统据此保留来源属性并对第三方/中风险证据折损；未配置 URL 时销售验证保持“待验证”，不会用 Seed 数值补齐。
- `SALES_SOURCE_CACHE_TTL_SECONDS`：成功销售查询的进程内缓存时间，默认 900 秒；设为 `0` 可关闭。
- `TAOBAO_GLOBAL_OPEN_APPKEY/APPSECRET`：Taobao Global Open 应用凭证。Web 端通过受保护的 `POST /api/integrations/taobao/authorize-url` 创建授权链接，回调使用 `code` 调用 `/auth/token/create` 换取 Access Token 与 Refresh Token。
- `TAOBAO_GLOBAL_OPEN_REDIRECT_URI`：淘宝开放平台中登记的 OAuth 回调地址；本地默认为 `http://127.0.0.1:8787/api/integrations/taobao/callback`，正式环境必须配置可访问的 HTTPS 地址。
- 淘宝 OAuth Token、刷新凭证和授权状态会使用 AES-256-GCM 加密后写入 MySQL；Access Token 到期前 5 分钟通过 `/auth/token/refresh` 自动刷新。
- `TAOBAO_GLOBAL_OPEN_TOKEN`：仅保留为与代购旧查询代码兼容的固定 Token 回退项，不是推荐授权方式。
- `TAOBAO_THEME_CONTENT_TYPES`：淘宝主题类型，默认监听欧美、香港、台湾、新加坡、马来西亚、泰国、澳洲和哈萨克优选主题。
- `ALIBABA_1688_APPKEY/APPSECRET`：1688 Global Open 应用凭证。Web 端通过受保护的 `POST /api/integrations/1688/authorize-url` 创建授权链接，回调换取 Access Token 与 Refresh Token。
- `ALIBABA_1688_REDIRECT_URI`：1688 开放平台登记的回调地址；本地默认为 `http://127.0.0.1:8787/api/integrations/1688/callback`。Token 加密写入 MySQL，并在到期前自动刷新。
- `ALIBABA_1688_PROXY`：可选的官方 API 出口代理；未配置时直接访问 `gw.open.1688.com`。
- 公共实例默认关闭；仅短期试用时设置 `ALLOW_PUBLIC_HOTLIST=true`，对应信号标记为高风险。

适配器成功连接但 `signalCount=0` 不一定是故障：只有同时包含商品或使用场景意图的热点，才会通过保守映射规则进入机会池。实际连接状态可查看 `/api/health`。

### 商业机会判定口径

机会分为“信号、机会假设、验证中、可行动”四个阶段。没有真实供给和销售证据时，供给、毛利代理和竞争分保持为 0，不再用 seed 数值制造高分；卡片会显示阻塞原因和下一步最佳动作。配置真实业务数据服务后，系统会自动使用 live 数据，失败时回退为明确标记的 Demo 数据。

飞书商业机会摘要卡可通过 `FEISHU_TARGET_OPEN_ID=ou_xxx node scripts/send-feishu-digest.mjs` 发送。卡片使用 JSON 2.0 按钮和多端 URL；跟进、验证、打样等状态动作仍需要把本项目 API 部署到飞书可访问的 HTTPS 地址后，再接入卡片回调。

Web 端会在机会列表上方展示本次刷新时各数据源的采集状态、有效信号数量、来源风险、最近检查时间和失败原因；同一信息也可通过 `/api/health` 查询。

Web 端同时展示 Google Trending Now 的原始热点候选池。候选池通过 `/api/trend-candidates` 提供，不要求预设关键词；只有经过商品意图映射的候选才进入 `/api/signals` 和商业机会评分。Google 关键词轮询仅作为可选的二次验证，不再承担热点发现职责。

## 生产运行

```bash
npm run build
npm start
```

生产构建会生成 `dist/` 前端和 `dist-server/` 服务端。服务端同时托管前端及 `/api`，不再依赖开发期的 `tsx`。

容器部署：

```bash
set FEEDBACK_API_TOKEN=replace-with-a-long-random-token
docker compose up --build
```

共享环境必须启用 `REQUIRE_FEEDBACK_TOKEN=true`、`REQUIRE_ADMIN_TOKEN=true`、HTTPS 和受限来源。`ADMIN_API_TOKEN` 保护采集、连接测试、实时供给搜索和 OAuth 发起动作；内置令牌适用于可信内部 MVP，正式多用户场景仍应接入 SSO/OIDC 与 RBAC。

需要持续采集和机会快照刷新时配置 `COLLECTION_SCHEDULE_INTERVAL_MINUTES`。可用 `COLLECTION_SOURCE_INTERVALS_MINUTES=weibo-hot-live:5,amazon-sales:30` 为单源配置独立采集/健康检查频率；单源失败按 `COLLECTION_RETRY_DELAY_MS` 指数退避至 `COLLECTION_MAX_BACKOFF_MS`，连续失败达到 `COLLECTION_ALERT_FAILURE_THRESHOLD` 后通过 `COLLECTION_ALERT_WEBHOOK_URL` 发送 HTTPS 告警。页面 GET 请求只读取已保存快照，不会隐式调用外部平台或写库。

业务结果可随反馈的 `outcome` 字段回填，包括 `observedAt`、`unitsSold`、`revenueUsd`、`grossProfitUsd` 和 `returnRate`；回填后会立即重算机会评分和排序。现有 MySQL 实例需先应用 `scripts/migrations/20260717_add_opportunity_outcome.sql`。

启用令牌后，用户在页面“写入令牌”字段中输入令牌；它只保存在当前浏览器标签页的 `sessionStorage`，不会写入业务状态或构建产物。

MySQL 是正式运行时的持久化层。`CREDENTIAL_ENCRYPTION_KEY` 必须使用至少 24 位随机值，并与数据库备份分开保存；正式环境还应配置自动备份、最小权限账号和私网访问。

## 架构与扩展

- 前端：React 18 + Vite，负责机会工作台、采集审计、数据源管理和验证任务。
- 后端：Node.js + Express + TypeScript，统一提供 API、页面托管、采集编排、评分与 OAuth 回调，默认使用单端口 `8787`。
- 渠道层：`sourceRegistry` 注册实现统一接口的 Adapter；新增平台只需实现采集方法和标准化映射，不改机会分析核心。
- 数据层：MySQL 分表保存渠道连接、加密凭证、采集批次、采集明细、机会快照、反馈和验证状态；平台特有字段使用 JSON 扩展列。
- 数据流：渠道原始数据 → 标准采集记录 → 趋势/供给/销售信号 → 商业机会评分 → 人工验证与结果反馈。

## 工程结构

- `src/server/adapters/`：趋势、供给、销售数据源适配器。
- `src/server/domain/`：发现、评分、采集批次、机会和反馈 Repository。
- `src/server/infrastructure/`：MySQL 连接、建表和加密凭证存储。
- `src/client/`：React 机会池界面。
- `docs/dev-team-design.md`：MVP 设计和数据流。
- `docs/project-intro/`：Beautiful HTML 项目介绍页。
