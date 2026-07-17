SELECT
  COUNT(*) AS coupons,
  COUNT(DISTINCT user_id) AS users,
  SUM(status = 1) AS used,
  SUM(coupon_activity_id IS NOT NULL) AS activity_non_null,
  SUM(coupon_activity_id > 0) AS activity_positive,
  SUM(coupon_activity_id = 0) AS activity_zero
FROM ob_coupon
WHERE createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00')
  AND createtime < UNIX_TIMESTAMP('2026-07-02 00:00:00');
