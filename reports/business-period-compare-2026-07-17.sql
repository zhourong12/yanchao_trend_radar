/* Read-only business-period comparison.
   A = 2026-07-10..2026-07-16; B = 2026-07-03..2026-07-09. */
WITH periods AS (
  SELECT 'A' period_key, UNIX_TIMESTAMP('2026-07-10 00:00:00') start_ts, UNIX_TIMESTAMP('2026-07-17 00:00:00') end_ts
  UNION ALL
  SELECT 'B', UNIX_TIMESTAMP('2026-07-03 00:00:00'), UNIX_TIMESTAMP('2026-07-10 00:00:00')
)
SELECT
  p.period_key,
  (SELECT COUNT(*) FROM ob_user u
    WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
      AND COALESCE(u.is_test, 0) = 0) AS new_users,
  (SELECT COUNT(*) FROM ob_sendorder s
    WHERE s.createtime >= p.start_ts AND s.createtime < p.end_ts) AS gross_sendorders,
  (SELECT COUNT(*) FROM ob_sendorder s
    WHERE s.createtime >= p.start_ts AND s.createtime < p.end_ts
      AND (s.status_id NOT IN (97, 98, 99) OR s.status_id IS NULL)) AS net_sendorders,
  (SELECT COUNT(DISTINCT s.user_id) FROM ob_sendorder s
    WHERE s.createtime >= p.start_ts AND s.createtime < p.end_ts) AS ordering_users,
  (SELECT COUNT(*) FROM ob_order_goods g
    WHERE g.createtime >= p.start_ts AND g.createtime < p.end_ts
      AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0) AS valid_packages,
  (SELECT COUNT(DISTINCT g.user_id) FROM ob_order_goods g
    WHERE g.createtime >= p.start_ts AND g.createtime < p.end_ts
      AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0) AS package_users,
  (SELECT COUNT(*) FROM ob_coupon c
    WHERE c.createtime >= p.start_ts AND c.createtime < p.end_ts
      AND c.coupon_activity_id IS NOT NULL AND c.coupon_activity_id > 0) AS activity_coupons_issued,
  (SELECT COUNT(DISTINCT c.user_id) FROM ob_coupon c
    WHERE c.createtime >= p.start_ts AND c.createtime < p.end_ts
      AND c.coupon_activity_id IS NOT NULL AND c.coupon_activity_id > 0) AS activity_coupon_users,
  (SELECT COUNT(*) FROM (
      SELECT fc.user_id
      FROM (
        SELECT c.user_id, MIN(c.createtime) first_coupon_time
        FROM ob_coupon c
        WHERE c.createtime >= p.start_ts AND c.createtime < p.end_ts
          AND c.coupon_activity_id IS NOT NULL AND c.coupon_activity_id > 0
        GROUP BY c.user_id
      ) fc
      WHERE EXISTS (
        SELECT 1 FROM ob_sendorder s
        WHERE s.user_id = fc.user_id
          AND s.createtime >= fc.first_coupon_time
          AND s.createtime < fc.first_coupon_time + 7 * 86400
          AND (s.status_id NOT IN (97, 98, 99) OR s.status_id IS NULL)
      )
    ) converted) AS coupon_users_to_net_order_7d,
  DATE_FORMAT(FROM_UNIXTIME(p.start_ts), '%Y-%m-%d') AS period_start,
  DATE_FORMAT(FROM_UNIXTIME(p.end_ts), '%Y-%m-%d') AS period_end_exclusive
FROM periods p
ORDER BY p.period_key;
