SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN ('ob_sendorder', 'ob_shipping_template')
ORDER BY table_name, ordinal_position
LIMIT 200;
