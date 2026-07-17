SELECT table_name, column_name, data_type, column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'ob_user', 'ob_sendorder', 'ob_order_goods', 'ob_coupon_user',
    'ob_user_red_envelopes', 'ob_user_red_envelopes_detail'
  )
ORDER BY table_name, ordinal_position;
