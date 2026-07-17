SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('ob_shipping_mode', 'ob_shipping_mode_lang', 'ob_sendorder_shipping_template', 'ob_user')
ORDER BY table_name, ordinal_position
LIMIT 200;
