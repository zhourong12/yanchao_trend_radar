SELECT
  sm.code AS route_name,
  COUNT(DISTINCT sm.id) AS exact_mode_rows,
  GROUP_CONCAT(DISTINCT sm.id ORDER BY sm.id SEPARATOR ',') AS shipping_mode_ids,
  COUNT(DISTINCT st.id) AS template_rows,
  GROUP_CONCAT(DISTINCT st.id ORDER BY st.id SEPARATOR ',') AS shipping_template_ids,
  GROUP_CONCAT(DISTINCT st.status ORDER BY st.status SEPARATOR ',') AS template_statuses,
  MIN(FROM_UNIXTIME(st.createtime)) AS earliest_template_created,
  MAX(FROM_UNIXTIME(st.createtime)) AS latest_template_created,
  COUNT(DISTINCT CASE WHEN sml.langcode = 'zh-cn' AND sml.name = sm.code THEN sml.shipping_mode_id END) AS exact_zh_cn_name_rows
FROM ob_shipping_mode sm
LEFT JOIN ob_shipping_template st ON st.shipping_mode_id = sm.id
LEFT JOIN ob_shipping_mode_lang sml ON sml.shipping_mode_id = sm.id
WHERE sm.code IN (
  '英国空调专线【高温补贴9.5折】',
  '欧洲空调专线【高温补贴9.5折】'
)
GROUP BY sm.code
ORDER BY sm.code
LIMIT 100;
