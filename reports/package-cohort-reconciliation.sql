/* Read-only package × sendorder cohort matrix.
   Rows = package creation period; columns = sendorder creation period.
   A = 2026-07-03..2026-07-09, B = 2026-06-26..2026-07-02.
   This is the query needed to verify whether the screenshot's 6,238 / 3,871 / 2,350
   values are the same population as the report's package-to-order metrics. */
WITH packages AS (
  SELECT
    g.id AS package_id,
    CASE
      WHEN g.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
       AND g.createtime <  UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'A'
      WHEN g.createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00')
       AND g.createtime <  UNIX_TIMESTAMP('2026-07-03 00:00:00') THEN 'B'
    END AS package_period,
    g.sendorder_id
  FROM ob_order_goods g
  WHERE g.order_type = 1
    AND COALESCE(g.is_del, 0) = 0
    AND g.createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00')
    AND g.createtime <  UNIX_TIMESTAMP('2026-07-10 00:00:00')
),
linked AS (
  SELECT
    p.package_id,
    p.package_period,
    CASE
      WHEN s.createtime >= UNIX_TIMESTAMP('2026-07-03 00:00:00')
       AND s.createtime <  UNIX_TIMESTAMP('2026-07-10 00:00:00') THEN 'A'
      WHEN s.createtime >= UNIX_TIMESTAMP('2026-06-26 00:00:00')
       AND s.createtime <  UNIX_TIMESTAMP('2026-07-03 00:00:00') THEN 'B'
    END AS sendorder_period
  FROM packages p
  JOIN ob_sendorder s ON s.id = p.sendorder_id
  WHERE p.sendorder_id IS NOT NULL
    AND p.sendorder_id > 0
),
package_totals AS (
  SELECT package_period, COUNT(*) AS package_count
  FROM packages
  GROUP BY package_period
),
matrix AS (
  SELECT
    package_period,
    sendorder_period,
    COUNT(DISTINCT package_id) AS linked_package_count
  FROM linked
  WHERE sendorder_period IS NOT NULL
  GROUP BY package_period, sendorder_period
)
SELECT
  t.package_period,
  t.package_count,
  COALESCE(MAX(CASE WHEN m.sendorder_period = 'B' THEN m.linked_package_count END), 0) AS linked_to_prior_sendorders,
  COALESCE(MAX(CASE WHEN m.sendorder_period = 'A' THEN m.linked_package_count END), 0) AS linked_to_current_sendorders,
  ROUND(100 * COALESCE(MAX(CASE WHEN m.sendorder_period = 'B' THEN m.linked_package_count END), 0) / NULLIF(t.package_count, 0), 2) AS prior_sendorder_rate,
  ROUND(100 * COALESCE(MAX(CASE WHEN m.sendorder_period = 'A' THEN m.linked_package_count END), 0) / NULLIF(t.package_count, 0), 2) AS current_sendorder_rate
FROM package_totals t
LEFT JOIN matrix m ON m.package_period = t.package_period
GROUP BY t.package_period, t.package_count
ORDER BY t.package_period;
