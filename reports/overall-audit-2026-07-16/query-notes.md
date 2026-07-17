# 整体审核：数据核验记录

审核时间：2026-07-16（Asia/Singapore）

## 口径

- “原始记录”按最新 `collection_date`、渠道及外部记录唯一键统计。
- “真实映射”只统计 `outcome = 'mapped'`；`validation`（供给验证）与 `demo`（Seed）不属于趋势发现。
- “可追溯记录”指 `run_id` 非空、可以关联到一次采集运行的记录。
- 查询中未记录数据库地址、账号、令牌或应用密钥。

## 核心查询

```sql
SELECT
  channel,
  COUNT(*) AS raw_count,
  SUM(entered_analysis = 1) AS entered_count,
  SUM(outcome = 'mapped') AS mapped_count,
  COUNT(DISTINCT market) AS markets
FROM yanchao_trend_radar.collection_records
WHERE collection_date = (
  SELECT MAX(collection_date)
  FROM yanchao_trend_radar.collection_records
)
GROUP BY channel
ORDER BY raw_count DESC;
```

```sql
SELECT
  COUNT(*) AS total,
  SUM(run_id IS NULL) AS without_run
FROM yanchao_trend_radar.collection_records
WHERE collection_date = (
  SELECT MAX(collection_date)
  FROM yanchao_trend_radar.collection_records
);
```

```sql
SELECT
  (SELECT COUNT(*) FROM yanchao_trend_radar.opportunities) AS opportunities,
  (SELECT COUNT(*) FROM yanchao_trend_radar.opportunity_feedback) AS feedback_events,
  (SELECT COUNT(*) FROM yanchao_trend_radar.opportunity_validations WHERE supply_status = 'verified') AS supply_verified,
  (SELECT COUNT(*) FROM yanchao_trend_radar.opportunity_validations WHERE sales_status = 'verified') AS sales_verified;
```

```sql
SELECT
  market,
  COUNT(*) AS rows_count,
  SUM(outcome = 'mapped') AS mapped_count
FROM yanchao_trend_radar.collection_records
WHERE collection_date = (
  SELECT MAX(collection_date)
  FROM yanchao_trend_radar.collection_records
)
  AND channel = 'google-trends-discovery'
GROUP BY market
ORDER BY market;
```

## 快照结论

- 最新快照共 1,619 条记录；趋势/热榜原始记录（排除 1688 与 Seed）1,220 条，真实映射 11 条，真实映射率约 0.90%。
- 1688 有 395 条 `validation` 记录全部被标为 `entered_analysis = 1`，导致“进入分析”口径被供给数据放大。
- 1,619 条记录中 1,582 条 `run_id` 为空，只有约 2.3% 可关联到采集运行。
- 真实销售验证为 0；当前机会的销售证据仍来自 Seed。
- Google Trending Now 实际覆盖 9/10 个目标市场，缺少中国大陆；页面详情的十国趋势图不是本次数据库查询结果。

