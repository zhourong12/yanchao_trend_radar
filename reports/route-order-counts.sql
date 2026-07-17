SELECT
  r.route_name,
  r.shipping_mode_id,
  r.shipping_template_id,
  p.period_key,
  p.period_start,
  p.period_end_exclusive,
  COUNT(s.id) AS gross_orders,
  SUM(CASE WHEN s.status_id IN (97, 98, 99) THEN 1 ELSE 0 END) AS cancelled_orders,
  SUM(CASE WHEN s.status_id = 97 THEN 1 ELSE 0 END) AS platform_cancelled,
  SUM(CASE WHEN s.status_id = 98 THEN 1 ELSE 0 END) AS user_cancelled,
  SUM(CASE WHEN s.status_id = 99 THEN 1 ELSE 0 END) AS timeout_cancelled,
  SUM(CASE WHEN s.status_id NOT IN (97, 98, 99) OR s.status_id IS NULL AND s.id IS NOT NULL THEN 1 ELSE 0 END) AS net_orders,
  COUNT(DISTINCT s.user_id) AS gross_users,
  COUNT(DISTINCT CASE WHEN s.status_id NOT IN (97, 98, 99) OR s.status_id IS NULL THEN s.user_id END) AS net_users,
  SUM(CASE WHEN COALESCE(u.is_test, 0) = 1 THEN 1 ELSE 0 END) AS test_user_orders,
  SUM(CASE WHEN COALESCE(u.is_test, 0) = 1 AND s.status_id NOT IN (97, 98, 99) THEN 1 ELSE 0 END) AS test_user_net_orders,
  SUM(CASE WHEN s.deletetime IS NOT NULL AND s.deletetime > 0 THEN 1 ELSE 0 END) AS soft_deleted_orders
FROM (
  SELECT '英国空调专线【高温补贴9.5折】' AS route_name, 1006 AS shipping_mode_id, 2286 AS shipping_template_id
  UNION ALL
  SELECT '欧洲空调专线【高温补贴9.5折】', 1009, 2289
) r
CROSS JOIN (
  SELECT 'A' AS period_key, '2026-07-03 00:00:00' AS period_start, '2026-07-10 00:00:00' AS period_end_exclusive
  UNION ALL
  SELECT 'B', '2026-06-26 00:00:00', '2026-07-03 00:00:00'
  UNION ALL
  SELECT '14D', '2026-06-26 00:00:00', '2026-07-10 00:00:00'
) p
LEFT JOIN ob_sendorder s
  ON s.shipping_template_id = r.shipping_template_id
 AND s.createtime >= UNIX_TIMESTAMP(p.period_start)
 AND s.createtime < UNIX_TIMESTAMP(p.period_end_exclusive)
LEFT JOIN ob_user u ON u.id = s.user_id
GROUP BY r.route_name, r.shipping_mode_id, r.shipping_template_id,
         p.period_key, p.period_start, p.period_end_exclusive
ORDER BY r.shipping_template_id, FIELD(p.period_key, 'A', 'B', '14D')
LIMIT 100;
