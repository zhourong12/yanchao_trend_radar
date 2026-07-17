WITH periods AS (
  SELECT 'A' period_key, UNIX_TIMESTAMP('2026-07-10 00:00:00') start_ts, UNIX_TIMESTAMP('2026-07-17 00:00:00') end_ts
  UNION ALL
  SELECT 'B', UNIX_TIMESTAMP('2026-07-03 00:00:00'), UNIX_TIMESTAMP('2026-07-10 00:00:00')
)
SELECT
  p.period_key,
  (SELECT COUNT(*)
   FROM ob_user u
   WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
     AND COALESCE(u.is_test, 0) = 0) AS new_users,
  (SELECT COUNT(*)
   FROM ob_user u
   WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
     AND COALESCE(u.is_test, 0) = 0
     AND EXISTS (
       SELECT 1 FROM ob_order_goods g
       WHERE g.user_id = u.id
         AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
         AND g.createtime >= u.createtime
         AND g.createtime < LEAST(u.createtime + 7 * 86400, p.end_ts)
     )) AS period_capped_package_users,
  (SELECT COUNT(*)
   FROM ob_user u
   WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
     AND COALESCE(u.is_test, 0) = 0
     AND EXISTS (
       SELECT 1 FROM ob_order_goods g
       WHERE g.user_id = u.id
         AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
         AND g.createtime >= u.createtime
         AND g.createtime < u.createtime + 7 * 86400
         AND g.createtime < UNIX_TIMESTAMP(NOW())
     )) AS observed_7d_package_users,
  (SELECT COUNT(*)
   FROM ob_user u
   WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
     AND COALESCE(u.is_test, 0) = 0
     AND u.createtime + 7 * 86400 <= UNIX_TIMESTAMP(NOW())) AS matured_users,
  (SELECT COUNT(*)
   FROM ob_user u
   WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
     AND COALESCE(u.is_test, 0) = 0
     AND u.createtime + 7 * 86400 <= UNIX_TIMESTAMP(NOW())
     AND EXISTS (
       SELECT 1 FROM ob_order_goods g
       WHERE g.user_id = u.id
         AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
         AND g.createtime >= u.createtime
         AND g.createtime < u.createtime + 7 * 86400
     )) AS matured_7d_package_users,
  ROUND(100 *
    (SELECT COUNT(*) FROM ob_user u
     WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
       AND COALESCE(u.is_test, 0) = 0
       AND EXISTS (
         SELECT 1 FROM ob_order_goods g
         WHERE g.user_id = u.id
           AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
           AND g.createtime >= u.createtime
           AND g.createtime < LEAST(u.createtime + 7 * 86400, p.end_ts)
       )) /
    NULLIF((SELECT COUNT(*) FROM ob_user u
      WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
        AND COALESCE(u.is_test, 0) = 0), 0), 2) AS period_capped_rate,
  ROUND(100 *
    (SELECT COUNT(*) FROM ob_user u
     WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
       AND COALESCE(u.is_test, 0) = 0
       AND u.createtime + 7 * 86400 <= UNIX_TIMESTAMP(NOW())
       AND EXISTS (
         SELECT 1 FROM ob_order_goods g
         WHERE g.user_id = u.id
           AND g.order_type = 1 AND COALESCE(g.is_del, 0) = 0
           AND g.createtime >= u.createtime
           AND g.createtime < u.createtime + 7 * 86400
       )) /
    NULLIF((SELECT COUNT(*) FROM ob_user u
      WHERE u.createtime >= p.start_ts AND u.createtime < p.end_ts
        AND COALESCE(u.is_test, 0) = 0
        AND u.createtime + 7 * 86400 <= UNIX_TIMESTAMP(NOW())), 0), 2) AS matured_7d_rate
FROM periods p
ORDER BY p.period_key;
