WITH core_actions AS (
  SELECT DATE(FROM_UNIXTIME(g.createtime)) activity_date, g.user_id
  FROM ob_order_goods g
  WHERE g.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND g.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
    AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
  UNION
  SELECT DATE(FROM_UNIXTIME(s.createtime)), s.user_id
  FROM ob_sendorder s
  WHERE s.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND s.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
  UNION
  SELECT DATE(FROM_UNIXTIME(c.createtime)), c.user_id
  FROM ob_coupon c
  WHERE c.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND c.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
    AND c.coupon_activity_id IS NOT NULL AND c.coupon_activity_id > 0
), daily AS (
  SELECT activity_date, COUNT(DISTINCT user_id) active_users
  FROM core_actions
  WHERE user_id IS NOT NULL AND user_id > 0
  GROUP BY activity_date
)
SELECT
  CASE WHEN activity_date >= '2026-07-10' THEN 'A' ELSE 'B' END period_key,
  ROUND(AVG(active_users), 2) avg_daily_core_active,
  MIN(active_users) min_daily_core_active,
  MAX(active_users) max_daily_core_active,
  SUM(active_users) sum_daily_core_active,
  COUNT(*) observed_days
FROM daily
GROUP BY period_key
ORDER BY period_key;
