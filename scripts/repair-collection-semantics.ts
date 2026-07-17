import "dotenv/config";
import { repairCollectionOutcomeSemantics } from "../src/server/domain/collectionLedger";
import { mysqlPool } from "../src/server/infrastructure/mysqlStore";

try {
  const result = await repairCollectionOutcomeSemantics();
  console.log(JSON.stringify({ event: "collection_semantics_repaired", ...result }));
  await mysqlPool().end();
} catch (error) {
  console.error(
    JSON.stringify({
      event: "collection_semantics_repair_failed",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
}
