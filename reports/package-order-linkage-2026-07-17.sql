WITH packages AS (
  SELECT
    g.id package_id,
    g.createtime package_time,
    g.sendorder_id,
    CASE
      WHEN g.createtime >= UNIX_TIMESTAMP('2026-07-10 00:00:00') AND g.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00') THEN 'A'
      WHEN g.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00') AND g.createtime < UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'B'
    END package_period
  FROM ob_order_goods g
  JOIN ob_user u ON u.id = g.user_id AND COALESCE(u.is_test, 0) = 0
  WHERE g.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND g.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
    AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
), linked AS (
  SELECT
    p.*,
    s.createtime sendorder_time,
    s.status_id,
    CASE
      WHEN s.createtime >= UNIX_TIMESTAMP('2026-07-10 00:00:00') AND s.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00') THEN 'A'
      WHEN s.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00') AND s.createtime < UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'B'
      ELSE 'OTHER'
    END order_period,
    CASE WHEN s.status_id NOT IN (97,98,99) OR s.status_id IS NULL THEN 1 ELSE 0 END is_net
  FROM packages p
  LEFT JOIN ob_sendorder s ON s.id = p.sendorder_id AND p.sendorder_id > 0
)
SELECT
  package_period,
  COUNT(*) valid_packages,
  SUM(sendorder_time IS NOT NULL AND is_net = 1) any_time_net_linked_packages,
  ROUND(100 * SUM(sendorder_time IS NOT NULL AND is_net = 1) / COUNT(*), 2) any_time_net_link_rate,
  SUM(order_period = package_period AND is_net = 1) same_period_net_linked_packages,
  ROUND(100 * SUM(order_period = package_period AND is_net = 1) / COUNT(*), 2) same_period_net_link_rate,
  SUM(package_period = 'B' AND order_period = 'A' AND is_net = 1) prior_package_to_current_net,
  SUM(sendorder_time IS NOT NULL AND sendorder_time < package_time) negative_sequence_packages
FROM linked
GROUP BY package_period
ORDER BY package_period;
