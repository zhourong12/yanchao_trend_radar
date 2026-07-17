SELECT
  r.route_name,
  r.shipping_mode_id,
  r.shipping_template_id,
  COUNT(DISTINCT CASE WHEN s.shipping_template_id = r.shipping_template_id THEN s.id END) AS direct_order_ids,
  COUNT(CASE WHEN st.shipping_template_id = r.shipping_template_id THEN 1 END) AS snapshot_rows,
  COUNT(DISTINCT CASE WHEN st.shipping_template_id = r.shipping_template_id THEN st.sendorder_id END) AS snapshot_order_ids_by_template,
  COUNT(DISTINCT CASE WHEN st.shipping_mode_id = r.shipping_mode_id THEN st.sendorder_id END) AS snapshot_order_ids_by_mode,
  COUNT(DISTINCT CASE WHEN s.shipping_template_id = r.shipping_template_id AND st.sendorder_id IS NULL THEN s.id END) AS direct_orders_missing_snapshot,
  COUNT(DISTINCT CASE WHEN st.shipping_mode_id = r.shipping_mode_id AND s.shipping_template_id <> r.shipping_template_id THEN s.id END) AS snapshot_mode_direct_template_mismatch
FROM (
  SELECT '英国空调专线【高温补贴9.5折】' AS route_name, 1006 AS shipping_mode_id, 2286 AS shipping_template_id
  UNION ALL
  SELECT '欧洲空调专线【高温补贴9.5折】', 1009, 2289
) r
CROSS JOIN ob_sendorder s
LEFT JOIN ob_sendorder_shipping_template st ON st.sendorder_id = s.id
WHERE s.createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00')
  AND s.createtime < UNIX_TIMESTAMP('2026-07-10 00:00:00')
GROUP BY r.route_name, r.shipping_mode_id, r.shipping_template_id
ORDER BY r.shipping_template_id
LIMIT 100;
