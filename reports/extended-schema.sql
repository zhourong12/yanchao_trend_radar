SELECT table_name, column_name, data_type, column_key
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name IN (
    'ob_coupon', 'ob_coupon_activity', 'ob_user_coupon_activity_order',
    'ob_user_red_envelope', 'ob_user_red_envelope_detail',
    'ob_invite_activity', 'ob_user_invite', 'ob_warehouse_log'
  )
ORDER BY table_name, ordinal_position;
