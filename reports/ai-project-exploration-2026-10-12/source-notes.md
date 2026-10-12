# AI 项目再探索：从外部热点转向自有履约数据

研究日期：2026-10-12。本文是对 2026-07-16 三份探索（雁巢需求实验室、出海商品风险预检台、ProofPack）的延续和重新校准。

## 决策问题

哪类 AI 项目最可能在 4 周内做出可评测、可复盘的价值，并形成别人难以复制的优势？

## 推荐结论

优先建设 **“商品理解层”（Item Intelligence）**：用文本/多模态模型把集运主库中的每一件商品（`ob_order_goods`）标准化为品类、关键属性、物流敏感属性、申报品类候选和重量区间，每条结果带置信度、理由和模型版本。

它先服务两个应用，按风险由低到高推进：

1. **一期（4 周）：雁巢用户购买信号。** 按“国家 × 品类 × 4 周窗口”聚合真实购买行为，作为雷达的一方需求证据，补上“没有真实销售数据”这个最大缺口。只读、聚合、内部使用，出错影响最小。
2. **二期（影子模式）：申报与敏感货 AI 预检。** 打包和出库前给出品类级申报建议、敏感货提示和欧盟按品类计征的固定关税预估，人工确认后才生效。业务价值最高，但必须先通过一期的准确率门槛。

两者共用同一套商品理解结果和评测集。“到仓前重量与运费预估”可以在二期复用同一批特征。

## 为什么要重新想一次

1. **7/16 的三个方向都在向外找数据。** 需求实验室依赖新增广告流量，风险预检台依赖官方召回库，ProofPack 进入团队没有数据和渠道的现场服务行业。三者都没有用上团队最独特的资产：集运主库每周约 5,000 件包裹的商品名称、链接、图片、重量、用户国家和仓库处理结果。
2. **AI 项目必须有结果标签，才能评测和迭代。** 主库里已经有天然标签：质检备注、拒收/拒绝原因、问题件、退货/销毁、实称重量、物流成本预估与实际值。雷达侧几乎没有标签：截至 2026-07-16 审计，真实销售验证为 0，真实映射只有 11 条。
3. **跨境小包的经济学在 2025–2026 年变了。** 美国 2025-08-29 起对所有国家取消 de minimis；欧盟 2026-07-01 起对 150 欧元以下电商小包按商品品类征收 €3 固定关税；英国已宣布结束 £135 免关税。商品“是什么、归哪一类”从后台细节变成直接影响报价、清关和利润的环节。
4. **AI 导购会被平台方自己做掉。** 据 Reuters 援引知情人士报道，阿里计划把千问接入淘宝/天猫，支持对话找货、比价和下单。集运商难以替代的是“仓内实物 + 跨境履约”，AI 投入应该放在这里，而不是再做一个购物助手。

## 已核验的项目事实

来源均为本仓库文件。主库只有字段结构，本次没有访问任何业务数据。

- 雷达的热点映射 `mapHotTopicToProduct`（`src/server/adapters/hotListAdapters.ts`）只有 5 个正则分支，映射到 4 个关键词：宠物降温垫、汽车遮阳、防水鞋套和便携风扇。
- 2026-07-16 审计：趋势/热榜原始记录 1,220 条，真实映射 11 条，约 0.90%；真实销售验证为 0。
- `reports/schema-inspection.json` 显示 `ob_order_goods` 有以下字段：
  - 商品标识：`goodsname`、`cn_goodsname`、`en_goodsname`、`goodsurl`、`goodsimg`、`goodssite`、`skuname`
  - 重量与价格：`goodsweight`、`goodsvolume`、`goodsprice`
  - 已有分类：`big_category_id`、`ai_product_tags`、`ai_logistics_tags`
  - 仓库处理结果：`is_inspection`、`inspection_remark`、`isproblem`、`refusalreason`、`denialreason`、`return_status`、`active_destroy_time`
- `ob_sendorder` 有 `countweight`、`actualweight`、`after_real_weight`、`logistics_estimated_cost`、`logistics_actual_cost`、`actual_shipping_channel`、`shipping_template_id`、`area_id`、`pack_delay_compensation_id`。
- `ob_user` 有 `country_code`、`loginlangcode`、`opened_prohibited_goods_dialog`。
- 规模（`reports/weekly-dashboard-2026-07-10.html`）：
  - 包裹创建（`order_type = 1`、未删除）每周 5,012 vs 4,861
  - 集运订单每周 528 vs 620
  - 活动券用户 445 vs 482
- 链路耗时（`reports/funnel-node-trend-summary-8cycles-2026-07-17.html`）：
  - 包裹→集运订单，成熟周期 P50 约 125–164 小时
  - 订单→打包，P50 在 17.6–46.7 小时之间波动

**未核验项：** 主系统已有 `ai_product_tags`、`ai_logistics_tags` 字段，但它们的填充率、来源模型和准确率在本仓库中没有记录。一期第一件事是测量它们，而不是另起炉灶。本次云端会话没有主库只读访问，以上只能证明字段存在，不能证明数据可用。

## 外部事实

| 事实 | 对项目的意义 | 来源 |
| --- | --- | --- |
| 欧盟理事会 2025-12-12 同意、2026-02-11 最终批准：2026-07-01 起，150 欧元以下电商小包征收 €3 固定关税。按商品品类（税号子目）计征，同一包裹每个不同品类各计一次，覆盖 IOSS 登记卖家，约占进入欧盟电商流量的 93%。 | 申报品类数直接决定欧盟线路的固定关税。 | Council press release 2025-12-12、2026-02-11 |
| 该 €3 关税为过渡措施，至 2028-07-01 或欧盟海关数据枢纽上线后改为正常税率。另有处理费方案，与 €3 关税相互独立，仍在推进中。 | 2028 年后品类到税号的准确性更关键。 | 同上；European Commission IP/25/3045 |
| 美国 CBP：2025-08-29 起对所有国家暂停 de minimis 免税，邮政渠道另行按 IEEPA 税率处理。中国内地和香港商品自 2025-05-02 起已不适用。 | 美国线路的申报品类与价值准确性影响成本。 | CBP CSMS #66065494；KPMG |
| 英国 2025 秋季预算宣布取消 £135 关税减免，官方目标最迟 2029 年 3 月；有商业来源称已提前至 2028 年 10 月，未经官方原文核验。 | 英国线路将进入新的低值进口制度。 | 33 Bedford Row；FlavorCloud |
| Zonos 自称其 AI 税号分类新模型错误率比旧模型低 29.4%（两周线上流量），无独立基准。 | 说明 AI 税号分类已商业化，但准确率要用自有数据评测。 | Zonos blog 2026-09-22 |
| 电商品类分类研究显示，固定类目且有标注数据时，微调或混合方法通常优于纯零样本；行业零样本高准确率多为自报。 | 一期必须建金标评测集，不能直接相信模型输出。 | arXiv 2408.12779；行业演讲摘要 |
| 阿里计划把千问接入淘宝/天猫，做对话式找货、比价和下单（Reuters 援引知情人士，2026-05）。 | AI 导购不是集运商的护城河。 | The Next Web；Inside Retail Asia |

## 候选方向与评分

评分是项目选择判断，不是市场实测。每项 1–5 分，5 分最好。

权重：

- 自有数据与结果标签 25%
- 可量化业务价值 25%
- AI 必要性 15%（规则或传统统计做不到的部分）
- 4 周 MVP 可行性 20%（含外部依赖）
- 错误可控 15%（能否由人工兜底、影响是否可逆）

公式：`数据×25% + 价值×25% + AI×15% + MVP×20% + 错误可控×15%`。

7/16 的三个推荐也用本框架重新打分。这不否定它们在原框架下的结论，只说明在“AI 项目”这个问题下它们为什么不是首选。

| 方向 | 层级 | 数据 | 价值 | AI | MVP | 可控 | 加权分 | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 雁巢用户购买信号 | 雷达 | 5 | 4 | 4 | 4 | 5 | 4.40 | 一期推荐 |
| 申报与敏感货 AI 预检 | 集运主业 | 5 | 5 | 5 | 3 | 3 | 4.30 | 二期推荐，先影子模式 |
| 到仓前重量与运费预估 | 集运主业 | 5 | 4 | 3 | 4 | 4 | 4.10 | 复用商品理解特征 |
| LLM 热点→商品意图映射 | 雷达 | 2 | 3 | 5 | 5 | 4 | 3.60 | 等一方购买信号上线后做 |
| 口径守卫型经营分析 Agent | 内部效率 | 4 | 3 | 4 | 4 | 3 | 3.60 | 可并行小试 |
| 入库 QC 视觉比对 | 集运主业 | 3 | 4 | 5 | 2 | 4 | 3.50 | 需先确认质检照片留存 |
| 券与红包增益模型 | 增长 | 4 | 4 | 2 | 3 | 4 | 3.50 | 先做随机留存组 |
| “能不能寄”多语言问答 Agent | 集运主业 | 3 | 4 | 4 | 4 | 2 | 3.45 | 依赖商品理解层后再做 |
| 出海商品风险预检台（7/16） | 独立产品 | 3 | 3 | 4 | 3 | 3 | 3.15 | 可并入二期合规模块 |
| ProofPack 完工证据包（7/16） | 独立产品 | 1 | 3 | 4 | 4 | 4 | 3.00 | 与团队资产无关 |
| 雁巢需求实验室（7/16） | 雷达 | 2 | 3 | 1 | 3 | 4 | 2.60 | 非 AI，且依赖投放授权 |

### 各方向要点

- **雁巢用户购买信号**
  - 做什么：用商品理解结果，把真实购买按国家 × 品类 × 时间聚合，形成雷达的一方需求证据。
  - 价值：雷达第一次有了不是 Seed、也不依赖 Amazon 授权的需求证据。
  - 风险：只代表雁巢用户，存在样本偏差；小国家样本稀疏。
- **申报与敏感货 AI 预检**
  - 做什么：从标题、SKU、图片推断申报品类、HS 前 6 位候选和电池、液体、磁性、粉末、刀具、食品、木制品、品牌标识等敏感属性。
  - 价值：用仓库处理结果做评测标签；可为欧盟线路估算“不同品类数 × €3”。
  - 风险：申报错误有合规后果，只能作为建议，由人工确认并留痕。
- **到仓前重量与运费预估**
  - 做什么：商品到仓前用商品理解特征预测重量和体积区间，再以 `actualweight` 和 `logistics_actual_cost` 为标签迭代。
  - 价值：可能缩短包裹→集运订单的犹豫期（成熟周期 P50 125–164 小时）。
  - 风险：主体是表格回归，大模型只负责特征。
- **LLM 热点→商品意图映射**
  - 做什么：把 4 个关键词的规则扩成语义映射。
  - 风险：没有下游结果标签，映射得越多，噪声也越多。
  - 结论：等一方购买信号上线后，用“热点之后该国该品类购买是否上升”做标签再做。
- **口径守卫型经营分析 Agent**
  - 做什么：把 `reports/*.sql` 中已校验的口径沉淀为语义层，让 Agent 只读查询，并始终给出分子、分母和 SQL。
  - 价值：仓库中已有二十余份手写 SQL 和多次口径纠正，需求真实。
  - 风险：错数会直接进周会，必须先做指标字典和金标查询集。
- **入库 QC 视觉比对**
  - 做什么：比对质检照片与商品主图，提示错发、错色、错码和破损。
  - 风险：主库只看到 `goodsimg` 和质检标记，质检照片是否结构化留存未知；需要改仓库流程。
- **券与红包增益模型**
  - 价值：红包扣减环比 +117.6%，活动券用户 7 日下单率从 8.1% 降到 4.9%，问题真实。
  - 风险：没有随机留存组就学不到增益，本质是实验设计问题，不是 AI 问题。
- **“能不能寄”多语言问答 Agent**
  - 依据：`opened_prohibited_goods_dialog` 字段说明用户确实在查禁运规则。
  - 风险：对外承诺“可以寄”的风险高，必须建立在商品理解层和线路规则之上，且只回答有依据的部分。
- **出海商品风险预检台**：召回匹配能力可以作为二期合规模块并入申报预检，不单独立项。
- **ProofPack**：市场成立，但团队没有数据、渠道或领域优势。
- **需求实验室**：本身不是 AI 项目，且依赖广告花费、发布域名等单独授权；一方购买信号能更便宜地回答“有没有真实需求”。

## 推荐项目定义：商品理解层

### 输入

`ob_order_goods` 的中文、英文和原始标题、SKU 名称、来源站点、商品图、价格和重量。只读同步，不回写主库。

### 输出

每件商品一条结果，可按版本重算：

- `taxonomy_l1` / `taxonomy_l2`：雁巢内部品类。建议 30–60 个二级类，并与雷达 `category` 对齐。
- `attributes`：材质、电池、液体、磁性、粉末、刀具、食品、植物或木制品、品牌标识等。
- `logistics_flags`：敏感属性、置信度和证据（标题中的词或图片特征）。
- `declaration_candidates`：申报品名和 HS 前 6 位 Top 3 候选，仅作建议。
- `weight_band`：预估重量区间。
- 血缘字段：`model_version`、`prompt_version`、`run_id`、`origin = live`。

### 规则

- 低置信度结果进入人工队列。
- 模型不得输出“可寄”“合规”“安全”等结论。
- 用户 ID、姓名、地址、联系方式、订单号不进入模型调用，只发送商品信息。
- 模型调用设置超时、重试上限和错误分类，日志不记录凭证。

### 数据对象

- `item_understanding_runs`
- `item_understanding_results`
- `item_gold_labels`
- `item_eval_reports`
- `first_party_demand_snapshots`

正式结构使用版本化迁移，不依赖应用启动时建表。

## 一期应用：雁巢用户购买信号

### 口径

- **单元**：国家 × 二级品类 × 4 周滚动窗口。国家优先用集运订单收货地区；用户 `country_code` 只作兜底，需先核对两者差异。
- **指标**：去重购买用户数、商品件数、价格中位数、相对前一窗口变化、首次出现品类。
- **隐私门槛**：去重用户数少于 5 的单元格不单独展示，只并入总计；不输出用户 ID、商品链接或收货信息。
- **证据类型**：`first_party_purchase`，`origin = live`。页面统一称“雁巢用户购买信号”，并注明“只代表雁巢用户，不等于市场销量或 Amazon 销售”。

### 阶段口径（遵守 AGENTS.md 3.1）

- 与已有机会匹配的一方购买记录计为 `validation`，不增加趋势发现数和商品映射数。
- 如果把“购买异动品类”作为新的发现渠道，必须单列渠道和分母，不并入热榜映射率。
- 一方购买信号可以把销售验证从“无证据”推进到“有一方需求证据”，但不能单独满足“可行动”的竞争和利润门槛。

## 二期应用：申报与敏感货 AI 预检（影子模式）

- 打包前对每个集运订单给出：品类列表、敏感属性提示、申报建议、欧盟线路固定关税预估（不同品类数 × €3）。
- 影子模式：AI 建议与仓库最终申报并排记录，不自动写入申报，持续计算采纳率和差异原因。
- 面向用户展示关税预估前，必须先和物流商确认欧盟线路的清关模式（IOSS、DDP 和申报主体），以及 €3 是否适用于本公司线路。

## 4 周计划

| 周 | 重点 | 交付物 | 通过条件 |
| ---: | --- | --- | --- |
| 1 | 数据体检与金标 | 只读查询标题、图片、AI 标签、国家和处理结果的填充率；隐私设计；300 件分层抽样金标；现有 AI 标签基线 | 可用标题或图片 ≥70%；金标双人一致率 ≥90% |
| 2 | 商品理解 v0 | 文本优先、低置信再看图；批处理最近 4 周；评测报告；单件成本与延迟实测 | 达到下方准确率门槛，并优于现有 AI 标签 |
| 3 | 一方购买信号接入雷达 | 聚合快照、带 `run_id` 的 Adapter、机会证据卡、k≥5 门槛、样本偏差标注 | 至少 10 个机会获得一方购买证据 |
| 4 | 回测与影子对比 | 8 周回测（雷达品类 vs 一方购买变化）；200 件申报建议影子对比；继续/停止评审 | 至少 1 个跟进或放弃决策因此改变 |

## 继续/停止门槛

以下为本次探索假设，不是行业基准，首轮后按国家和品类重新校准。

| 指标 | 门槛 | 未达标时 |
| --- | --- | --- |
| 数据可用率 | ≥70% 商品有可用标题或图片 | 先改入库信息采集，暂停建模 |
| 二级品类准确率 | 金标 Top-1 ≥90%（大类 ≥95%） | 缩减类目或补少样本示例 |
| 敏感属性召回 | 电池、液体、磁性、粉末、刀具召回 ≥95%，精确率 ≥70% | 不进入二期申报预检 |
| 相对现有 AI 标签 | 在同一金标上明显更好 | 若现有标签已达标，停止重造，改为直接消费现有标签 |
| 影子采纳率 | 仓库无修改采纳 ≥80% | 只保留敏感货提示，不做申报建议 |
| 业务影响 | ≥10 个机会获得一方证据，≥1 个决策改变 | 一方信号降为辅助视图 |

## 主要风险与边界

- **样本偏差**：雁巢用户不等于目标市场整体，小国家和长尾品类样本稀疏。只做粗粒度、窗口滚动，并显示样本量。
- **隐私与授权**：主库数据用于雷达需明确内部授权；只出聚合结果，设置保留期；模型调用只含商品信息。
- **合规后果**：申报建议出错可能导致扣关或罚款。全程人工确认、留痕，不自动写入申报。
- **模型漂移**：结果带模型和提示词版本，类目或模型变更后可以重算并对比。
- **成本**：每周约 5,000 件，先文本后图片、仅低置信看图；单件成本在第 2 周实测后再定预算。
- **政策变化**：欧盟 2028 年后改为正常税率；英国时间表仍在变化。政策参数配置化，并链接官方原文。
- **已有系统**：主系统已有 AI 标签字段，必须先找到负责人和来源，避免两套标签冲突。

## 现在不建议做

- **AI 导购、找货聊天**：平台方会自己做，集运商没有优势。
- **通用 AI 上架文案**：品类拥挤，雷达目前也没有到达“可上架”的真实机会。
- **“爆品预测”模型**：没有结果标签就无法评测，容易做成看起来准确的噪声。
- **只改提示词扩大热点映射**：没有下游验证会放大噪声，应排在一方购买信号之后。

## 需要用户确认或提供

1. 主库只读账号或只读副本，以及能否把聚合结果用于雷达。
2. 模型供应商和数据政策：商品标题和图片能否发送给境内或境外模型 API。建议只发商品信息。
3. 运营或仓库 2–3 人日，用于 300 件金标标注。
4. 现有 `ai_product_tags`、`ai_logistics_tags` 的来源（模型、供应商或规则）和负责人。
5. 欧盟线路的清关模式和申报主体，决定二期关税预估能否面向用户展示。

## 报告结构与图表说明

- **受众**：项目负责人和业务负责人。
- **结构**：结论 → 为什么重新想 → 候选比较 → 推荐项目定义 → 4 周计划与门槛 → 风险 → 不建议做 → 待确认。
- **图表**：11 个方向的加权分单系列横向柱状图，从零开始。推荐项用强调色，其余用中性色，不加冗余图例。
- **表格**：评分拆解、4 周计划、继续/停止门槛。
- **未绘制**：市场规模、收入或节省金额图。主库数据未查询，任何金额都没有依据。

## 来源

### 项目内

- `AGENTS.md`
- `reports/overall-audit-2026-07-16/audit-summary.md`
- `reports/overall-audit-2026-07-16/query-notes.md`
- `reports/schema-inspection.json`
- `reports/extended-schema.json`
- `reports/weekly-dashboard-2026-07-10.html`
- `reports/funnel-node-trend-summary-8cycles-2026-07-17.html`
- `reports/beautiful-funnel-summary/owner-engineering-summary.html`
- `reports/demand-lab-exploration-2026-07-16/source-notes.md`
- `reports/export-risk-preflight-exploration-2026-07-16/source-notes.md`
- `reports/proofpack-exploration-2026-07-16/source-notes.md`
- `src/server/adapters/hotListAdapters.ts`

### 外部

- Council of the EU：[Customs: Council agrees to levy customs duty on small parcels as of 1 July 2026](https://www.consilium.europa.eu/en/press/press-releases/2025/12/12/customs-council-agrees-to-levy-customs-duty-on-small-parcels-as-of-1-july-2026/)（2025-12-12）
- Council of the EU：[Council gives final green light to new customs duty rules for small parcels](https://www.consilium.europa.eu/en/press/press-releases/2026/02/11/council-gives-final-green-light-to-new-customs-duty-rules-for-small-parcels/)（2026-02-11）
- Council of the EU：[EU action on the influx of small parcels](https://www.consilium.europa.eu/en/policies/eu-action-influx-of-small-parcels/)
- European Commission：[IP/25/3045](https://ec.europa.eu/commission/presscorner/api/files/document/print/en/ip_25_3045/IP_25_3045_EN.pdf)
- U.S. CBP：[CSMS #66065494](https://content.govdelivery.com/accounts/USDHSCBP/bulletins/3f01456)
- KPMG：[CBP implements EO suspending duty-free de minimis treatment](https://kpmg.com/us/en/taxnewsflash/news/2025/08/us-cbp-implements-eo-suspending-duty-free-de-minimis-treatment.html)
- 33 Bedford Row：[The end of the £135 customs duty relief](https://33bedfordrow.co.uk/insights/bulletins/the-end-of-the-135-customs-duty-relief-what-importers-and-platforms-need-to-know)
- FlavorCloud：[UK £135 duty-free threshold ending](https://flavorcloud.com/resources/commerce-intelligence-alerts-blog/uk-135-duty-free-threshold-ending)（商业来源，日期待官方核验）
- Zonos：[Classify rebuilt](https://zonos.com/blog/classify-rebuilt)（2026-09-22，厂商自报）
- [Investigating LLM Applications in E-Commerce](https://arxiv.org/pdf/2408.12779)（arXiv 2408.12779）
- The Next Web：[Alibaba integrates Qwen AI with Taobao](https://thenextweb.com/news/alibaba-integrates-qwen-ai-with-taobao)（2026-05-10）
- Inside Retail Asia：[Alibaba to integrate Qwen AI with Taobao, launch agentic shopping](https://insideretail.asia/2026/05/11/alibaba-to-integrate-qwen-ai-with-taobao-launch-agentic-shopping/)（2026-05-11）
