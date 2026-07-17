WITH periods AS (
  SELECT '05/22-05/28' period_label, UNIX_TIMESTAMP('2026-05-22 00:00:00') start_ts, UNIX_TIMESTAMP('2026-05-29 00:00:00') end_ts, 1 period_order
  UNION ALL SELECT '05/29-06/04', UNIX_TIMESTAMP('2026-05-29 00:00:00'), UNIX_TIMESTAMP('2026-06-05 00:00:00'), 2
  UNION ALL SELECT '06/05-06/11', UNIX_TIMESTAMP('2026-06-05 00:00:00'), UNIX_TIMESTAMP('2026-06-12 00:00:00'), 3
  UNION ALL SELECT '06/12-06/18', UNIX_TIMESTAMP('2026-06-12 00:00:00'), UNIX_TIMESTAMP('2026-06-19 00:00:00'), 4
  UNION ALL SELECT '06/19-06/25', UNIX_TIMESTAMP('2026-06-19 00:00:00'), UNIX_TIMESTAMP('2026-06-26 00:00:00'), 5
  UNION ALL SELECT '06/26-07/02', UNIX_TIMESTAMP('2026-06-26 00:00:00'), UNIX_TIMESTAMP('2026-07-03 00:00:00'), 6
  UNION ALL SELECT '07/03-07/09', UNIX_TIMESTAMP('2026-07-03 00:00:00'), UNIX_TIMESTAMP('2026-07-10 00:00:00'), 7
  UNION ALL SELECT '07/10-07/16', UNIX_TIMESTAMP('2026-07-10 00:00:00'), UNIX_TIMESTAMP('2026-07-17 00:00:00'), 8
), balance_pay AS (
  SELECT sendorder_sn, MIN(createtime) pay_time
  FROM ob_user_money_log
  WHERE type = 2
    AND createtime >= UNIX_TIMESTAMP('2026-05-22 00:00:00')
  GROUP BY sendorder_sn
), orders_base AS (
  SELECT
    p.period_label,
    p.period_order,
    s.id,
    s.sn,
    s.createtime order_time,
    CASE WHEN re.successtime IS NOT NULL AND re.successtime > 0 THEN re.successtime ELSE bp.pay_time END pay_time,
    s.pack_time,
    s.out_time
  FROM periods p
  JOIN ob_sendorder s ON s.createtime >= p.start_ts AND s.createtime < p.end_ts
  JOIN ob_user u ON u.id = s.user_id AND COALESCE(u.is_test, 0) = 0
  LEFT JOIN ob_recharge re ON re.id = s.recharge_id
  LEFT JOIN balance_pay bp ON bp.sendorder_sn = s.sn
  WHERE (s.status_id NOT IN (97,98,99) OR s.status_id IS NULL)
), packages_base AS (
  SELECT
    p.period_label,
    p.period_order,
    g.id,
    g.createtime package_time,
    s.createtime order_time,
    CASE WHEN s.id IS NOT NULL AND (s.status_id NOT IN (97,98,99) OR s.status_id IS NULL) THEN 1 ELSE 0 END linked_net_order
  FROM periods p
  JOIN ob_order_goods g ON g.createtime >= p.start_ts AND g.createtime < p.end_ts
  JOIN ob_user u ON u.id = g.user_id AND COALESCE(u.is_test, 0) = 0
  LEFT JOIN ob_sendorder s ON s.id = g.sendorder_id
  WHERE g.order_type = 1
    AND COALESCE(g.is_del, 0) = 0
), duration_values AS (
  SELECT period_label, period_order, 'package_to_order' metric, (order_time - package_time) / 3600.0 hours_value
  FROM packages_base
  WHERE linked_net_order = 1 AND order_time >= package_time
  UNION ALL
  SELECT period_label, period_order, 'order_to_pay', (pay_time - order_time) / 3600.0
  FROM orders_base
  WHERE pay_time IS NOT NULL AND pay_time >= order_time
  UNION ALL
  SELECT period_label, period_order, 'order_to_pack', (pack_time - order_time) / 3600.0
  FROM orders_base
  WHERE pack_time IS NOT NULL AND pack_time > 0 AND pack_time >= order_time
  UNION ALL
  SELECT period_label, period_order, 'pack_to_out', (out_time - pack_time) / 3600.0
  FROM orders_base
  WHERE pack_time IS NOT NULL AND pack_time > 0
    AND out_time IS NOT NULL AND out_time > 0 AND out_time >= pack_time
), coverage AS (
  SELECT period_label, period_order, 'package_to_order' metric,
    COUNT(*) denominator_records,
    SUM(CASE WHEN linked_net_order = 1 AND order_time >= package_time THEN 1 ELSE 0 END) covered_records
  FROM packages_base
  GROUP BY period_label, period_order
  UNION ALL
  SELECT period_label, period_order, 'order_to_pay', COUNT(*),
    SUM(CASE WHEN pay_time IS NOT NULL AND pay_time >= order_time THEN 1 ELSE 0 END)
  FROM orders_base
  GROUP BY period_label, period_order
  UNION ALL
  SELECT period_label, period_order, 'order_to_pack', COUNT(*),
    SUM(CASE WHEN pack_time IS NOT NULL AND pack_time > 0 AND pack_time >= order_time THEN 1 ELSE 0 END)
  FROM orders_base
  GROUP BY period_label, period_order
  UNION ALL
  SELECT period_label, period_order, 'pack_to_out',
    SUM(CASE WHEN pack_time IS NOT NULL AND pack_time > 0 AND pack_time >= order_time THEN 1 ELSE 0 END),
    SUM(CASE WHEN pack_time IS NOT NULL AND pack_time > 0 AND pack_time >= order_time
      AND out_time IS NOT NULL AND out_time > 0 AND out_time >= pack_time THEN 1 ELSE 0 END)
  FROM orders_base
  GROUP BY period_label, period_order
), ranked AS (
  SELECT
    period_label,
    period_order,
    metric,
    hours_value,
    CUME_DIST() OVER (PARTITION BY period_order, metric ORDER BY hours_value) cd
  FROM duration_values
), duration_stats AS (
  SELECT
    period_label,
    period_order,
    metric,
    ROUND(AVG(hours_value), 4) avg_hours,
    ROUND(MIN(CASE WHEN cd >= 0.5 THEN hours_value END), 4) p50_hours,
    ROUND(MIN(CASE WHEN cd >= 0.9 THEN hours_value END), 4) p90_hours
  FROM ranked
  GROUP BY period_label, period_order, metric
)
SELECT
  c.period_order,
  c.period_label,
  c.metric,
  c.denominator_records,
  c.covered_records,
  ROUND(100.0 * c.covered_records / NULLIF(c.denominator_records, 0), 2) coverage_pct,
  d.avg_hours,
  d.p50_hours,
  d.p90_hours
FROM coverage c
LEFT JOIN duration_stats d
  ON d.period_order = c.period_order AND d.metric = c.metric
ORDER BY c.period_order, FIELD(c.metric, 'package_to_order','order_to_pay','order_to_pack','pack_to_out');
