SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND (
    table_name LIKE '%coupon%'
    OR table_name LIKE '%red%envelope%'
    OR table_name LIKE '%invite%'
    OR table_name LIKE '%activity%'
    OR table_name LIKE '%warehouse%log%'
  )
ORDER BY table_name;
