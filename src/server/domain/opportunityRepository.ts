import type { RowDataPacket } from "mysql2/promise";
import type { ProductOpportunity } from "../../shared/types";
import { initializeMysqlStore, isMysqlConfigured, mysqlPool } from "../infrastructure/mysqlStore";

let memorySnapshots: ProductOpportunity[] = [];

export async function persistOpportunitySnapshots(
  opportunities: ProductOpportunity[],
  options: { pruneDiscovered?: boolean } = {}
) {
  memorySnapshots = options.pruneDiscovered
    ? structuredClone(opportunities)
    : [
        ...memorySnapshots.filter((existing) => !opportunities.some((next) => next.id === existing.id)),
        ...structuredClone(opportunities)
      ];
  if (!isMysqlConfigured()) return;
  await initializeMysqlStore();
  const connection = await mysqlPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const opportunity of opportunities) {
      await connection.query(
        `INSERT INTO opportunities
       (id, origin, product_name, market, category, event_name, demand, reason, time_window, next_action,
        snapshot_json, created_at, updated_at)
       VALUES (?, 'discovered', ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, ?)
       ON DUPLICATE KEY UPDATE product_name = VALUES(product_name), market = VALUES(market),
        category = VALUES(category), event_name = VALUES(event_name), demand = VALUES(demand), reason = VALUES(reason),
        time_window = VALUES(time_window), next_action = VALUES(next_action), snapshot_json = VALUES(snapshot_json),
        updated_at = VALUES(updated_at)`,
        [
          opportunity.id,
          opportunity.productName,
          opportunity.market,
          opportunity.category,
          opportunity.eventName,
          opportunity.demand,
          opportunity.reason,
          opportunity.timeWindow,
          opportunity.analysis.nextBestAction,
          JSON.stringify(opportunity),
          new Date(opportunity.updatedAt),
          new Date(opportunity.updatedAt)
        ]
      );
    }
    if (options.pruneDiscovered) {
      const discoveredIds = opportunities.filter((item) => !item.id.startsWith("manual-")).map((item) => item.id);
      if (discoveredIds.length === 0) {
        await connection.query("DELETE FROM opportunities WHERE origin = 'discovered'");
      } else {
        await connection.query("DELETE FROM opportunities WHERE origin = 'discovered' AND id NOT IN (?)", [
          discoveredIds
        ]);
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function readOpportunitySnapshots(): Promise<ProductOpportunity[]> {
  if (!isMysqlConfigured()) return structuredClone(memorySnapshots).sort((a, b) => b.scores.overall - a.scores.overall);
  await initializeMysqlStore();
  const [rows] = await mysqlPool().query<RowDataPacket[]>(
    "SELECT snapshot_json FROM opportunities WHERE snapshot_json IS NOT NULL ORDER BY updated_at DESC"
  );
  return rows
    .map((row) => {
      const value = row.snapshot_json;
      if (!value) return null;
      return (typeof value === "string" ? JSON.parse(value) : value) as ProductOpportunity;
    })
    .filter((value): value is ProductOpportunity => Boolean(value))
    .sort((a, b) => b.scores.overall - a.scores.overall);
}
