WITH periods AS (
  SELECT 'A' period_key, UNIX_TIMESTAMP('2026-07-10 00:00:00') start_ts, UNIX_TIMESTAMP('2026-07-17 00:00:00') end_ts
  UNION ALL
  SELECT 'B', UNIX_TIMESTAMP('2026-07-03 00:00:00'), UNIX_TIMESTAMP('2026-07-10 00:00:00')
)
SELECT
  p.period_key,
  COUNT(s.id) gross_orders,
  SUM(s.status_id IN (97,98,99)) cancelled_orders,
  SUM(s.status_id NOT IN (97,98,99) OR s.status_id IS NULL) net_orders,
  ROUND(100 * SUM(s.status_id NOT IN (97,98,99) OR s.status_id IS NULL) / NULLIF(COUNT(s.id), 0), 2) net_retention_rate,
  COUNT(DISTINCT s.user_id) ordering_users
FROM periods p
LEFT JOIN ob_sendorder s ON s.createtime >= p.start_ts AND s.createtime < p.end_ts
LEFT JOIN ob_user u ON u.id = s.user_id
WHERE s.id IS NULL OR COALESCE(u.is_test, 0) = 0
GROUP BY p.period_key
ORDER BY p.period_key;
