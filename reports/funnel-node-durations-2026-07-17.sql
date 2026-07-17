WITH balance_pay AS (
  SELECT sendorder_sn, MIN(createtime) pay_time
  FROM ob_user_money_log
  WHERE type = 2
    AND createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
  GROUP BY sendorder_sn
), orders_base AS (
  SELECT
    s.id,
    s.sn,
    s.createtime order_time,
    CASE WHEN re.successtime IS NOT NULL AND re.successtime > 0 THEN re.successtime ELSE bp.pay_time END pay_time,
    s.pack_time,
    s.out_time,
    CASE WHEN s.createtime >= UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'A' ELSE 'B' END period_key
  FROM ob_sendorder s
  JOIN ob_user u ON u.id = s.user_id AND COALESCE(u.is_test, 0) = 0
  LEFT JOIN ob_recharge re ON re.id = s.recharge_id
  LEFT JOIN balance_pay bp ON bp.sendorder_sn = s.sn
  WHERE s.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND s.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
    AND (s.status_id NOT IN (97,98,99) OR s.status_id IS NULL)
), duration_values AS (
  SELECT
    CASE WHEN g.createtime >= UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'A' ELSE 'B' END period_key,
    'package_to_order' metric,
    (s.createtime - g.createtime) / 3600.0 hours_value
  FROM ob_order_goods g
  JOIN ob_user u ON u.id = g.user_id AND COALESCE(u.is_test, 0) = 0
  JOIN ob_sendorder s ON s.id = g.sendorder_id
  WHERE g.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
    AND g.createtime < UNIX_TIMESTAMP('2026-07-17 00:00:00')
    AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
    AND (s.status_id NOT IN (97,98,99) OR s.status_id IS NULL)
    AND s.createtime >= g.createtime
  UNION ALL
  SELECT period_key, 'order_to_pay', (pay_time - order_time) / 3600.0
  FROM orders_base
  WHERE pay_time IS NOT NULL AND pay_time >= order_time
  UNION ALL
  SELECT period_key, 'order_to_pack', (pack_time - order_time) / 3600.0
  FROM orders_base
  WHERE pack_time IS NOT NULL AND pack_time > 0 AND pack_time >= order_time
  UNION ALL
  SELECT period_key, 'pack_to_out', (out_time - pack_time) / 3600.0
  FROM orders_base
  WHERE pack_time IS NOT NULL AND pack_time > 0
    AND out_time IS NOT NULL AND out_time > 0 AND out_time >= pack_time
), ranked AS (
  SELECT
    period_key,
    metric,
    hours_value,
    CUME_DIST() OVER (PARTITION BY period_key, metric ORDER BY hours_value) cd
  FROM duration_values
)
SELECT
  period_key,
  metric,
  COUNT(*) covered_records,
  ROUND(AVG(hours_value), 2) avg_hours,
  ROUND(MIN(CASE WHEN cd >= 0.5 THEN hours_value END), 2) p50_hours,
  ROUND(MIN(CASE WHEN cd >= 0.9 THEN hours_value END), 2) p90_hours,
  ROUND(MAX(hours_value), 2) max_hours
FROM ranked
GROUP BY period_key, metric
ORDER BY period_key, FIELD(metric, 'package_to_order','order_to_pay','order_to_pack','pack_to_out');
