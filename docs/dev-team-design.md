# 雁巢商品机会雷达 MVP 设计

## 目标

把跨平台趋势信号转成可采购、可上架、可复盘的商品机会卡片。MVP 不做全平台热搜爬虫，先验证机会识别闭环。

## MVP 边界

- 趋势信号：以 seed adapter 模拟 Google Trends、百度指数、抖音热榜、微博热搜。
- 供给验证：以 seed adapter 模拟 1688、淘宝/拼多多价格和供应商指标。
- 销售验证：以 seed adapter 模拟 Amazon/跨境价格带、竞争强度。
- 输出：前端机会池、评分、证据、建议动作、反馈标记。

## 数据流

`adapter -> normalized signal -> source-risk weighting -> opportunity hypothesis -> evidence gate -> decision score -> action -> feedback -> ranking calibration`

当前反馈校准采用最近业务结果的可解释规则：跟进、验证、打样和上架逐级增加排序权重，放弃降低权重。后续积累足够样本后，可替换为按类目、市场和时间窗口训练的校准模型。

## 商业机会分析模型

机会不是单一分数，而是四个阶段：

1. **信号**：观察到趋势变化，但证据不足。
2. **机会假设**：趋势与具体商品、场景和市场形成可解释关联。
3. **验证中**：开始补充真实供给、销售、合规和样品证据。
4. **可行动**：供给与销售证据完整，业务可以进入采购、打样或上架决策。

供给和销售 seed 数据只用于演示字段和界面流程，不参与正式的供给、毛利代理和竞争得分。没有真实业务数据时，这些分数保持为 0，机会卡必须显示数据质量、证据完整度、阻塞原因和下一步最佳动作。

## 运行边界

- Google Trends 先按 `GOOGLE_TRENDS_GEOS` 从 Trending Now RSS 逐国无关键词发现；可选监控词再通过 `interestOverTime` 验证。每条信号只标记为对应 ISO 国家，不外推为整个区域。
- 毛利字段是候选排序代理，不是财务核算结果。
- JSON 状态存储仅支持单实例 MVP；多实例部署需迁移到事务数据库。
- 共享环境通过同源保护、访问令牌和限流保护反馈写入；正式多用户版本需接入 SSO/OIDC 与 RBAC。

## 后续接真实平台

每个真实平台只需要实现 `TrendSourceAdapter`，输出标准化 `TrendSignal`、`SupplySignal` 或 `SalesSignal`。禁止将账号池、逆向、验证码绕过作为生产数据源。
