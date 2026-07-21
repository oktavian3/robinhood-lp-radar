import "dotenv/config";
import { buildCandles } from "./src/engine/candle-builder.js";

async function main() {
  console.log("Building candles from historical events...");
  const count = await buildCandles();
  console.log(`Candles built: ${count}`);
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
