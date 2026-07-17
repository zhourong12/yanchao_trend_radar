import "dotenv/config";
import { createApp } from "./app";
import { startCollectionScheduler } from "./domain/collectionScheduler";

const port = Number(process.env.PORT ?? 8787);
const production = process.env.NODE_ENV === "production";
const vite = production
  ? undefined
  : await (async () => {
      const { createServer } = await import("vite");
      return createServer({ server: { middlewareMode: true }, appType: "spa" });
    })();

const server = createApp({ serveClient: production, clientMiddleware: vite?.middlewares }).listen(port, () => {
  console.log(`Opportunity radar listening on http://localhost:${port}`);
});
const stopScheduler = startCollectionScheduler();

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    stopScheduler();
    console.log(JSON.stringify({ event: "shutdown_started", signal }));
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    server.close(async (error) => {
      await vite?.close();
      clearTimeout(forceExit);
      if (error) console.error(JSON.stringify({ event: "shutdown_failed", error: error.message }));
      process.exit(error ? 1 : 0);
    });
  });
}
