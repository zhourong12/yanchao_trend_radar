SELECT
  sm.id AS shipping_mode_id,
  sm.code,
  sm.name AS mode_name,
  sm.status AS mode_status,
  GROUP_CONCAT(DISTINCT CONCAT(COALESCE(sml.langcode, ''), ':', COALESCE(sml.name, '')) ORDER BY sml.langcode SEPARATOR ' | ') AS lang_names,
  COUNT(DISTINCT st.id) AS template_count,
  GROUP_CONCAT(DISTINCT st.id ORDER BY st.id SEPARATOR ',') AS template_ids,
  SUM(st.status = '1') AS active_template_count
FROM ob_shipping_mode sm
LEFT JOIN ob_shipping_mode_lang sml ON sml.shipping_mode_id = sm.id
LEFT JOIN ob_shipping_template st ON st.shipping_mode_id = sm.id
WHERE sm.name LIKE '%空调%'
   OR sm.name LIKE '%英国%'
   OR sm.name LIKE '%欧洲%'
   OR sm.code LIKE '%空调%'
   OR sml.name LIKE '%空调%'
   OR sml.name LIKE '%英国%'
   OR sml.name LIKE '%欧洲%'
GROUP BY sm.id, sm.code, sm.name, sm.status
ORDER BY sm.id
LIMIT 100;
