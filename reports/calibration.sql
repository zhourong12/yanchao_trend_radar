SELECT 'db_time' AS metric, DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS value_text, NULL AS value_num
UNION ALL
SELECT 'session_timezone', @@session.time_zone, NULL
UNION ALL
SELECT 'users_all', NULL, COUNT(*) FROM ob_user
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
UNION ALL
SELECT 'users_non_test', NULL, COUNT(*) FROM ob_user
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00') AND COALESCE(is_test, 0) = 0
UNION ALL
SELECT 'sendorders_all', NULL, COUNT(*) FROM ob_sendorder
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
UNION ALL
SELECT 'sendorders_not_deleted', NULL, COUNT(*) FROM ob_sendorder
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00') AND COALESCE(deletetime, 0) = 0
UNION ALL
SELECT 'goods_all', NULL, COUNT(*) FROM ob_order_goods
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
UNION ALL
SELECT 'goods_not_deleted', NULL, COUNT(*) FROM ob_order_goods
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
   AND COALESCE(is_del, 0) = 0 AND COALESCE(deletetime, 0) = 0
UNION ALL
SELECT 'coupons_all', NULL, COUNT(*) FROM ob_coupon
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
UNION ALL
SELECT 'activity_coupons', NULL, COUNT(*) FROM ob_coupon
 WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00') AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00')
   AND coupon_activity_id IS NOT NULL AND coupon_activity_id > 0;
