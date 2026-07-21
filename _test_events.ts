import { rpcClient } from "./src/lib/rpc.js";
import { getPools, insertRawEvent, query } from "./src/db/index.js";

async function main() {
  const pools = await getPools();
  const withAddr = pools.filter(p => p.pool_address && p.pool_address !== "0x" && p.protocol !== "v4");
  console.log(`Total pools: ${pools.length}, with address: ${withAddr.length}`);

  const latest = Number(await rpcClient.getBlockNumber());
  console.log(`Latest block: ${latest}`);

  let totalEvents = 0;
  let poolCount = 0;

  for (const p of withAddr.slice(0, 10)) { // Just first 10
    poolCount++;
    const fromBlock = p.created_block ? Math.max(0, p.created_block - 5000) : Math.max(0, latest - 20000);
    const batchSize = 5000;
    let cursor = fromBlock;
    let poolEvents = 0;

    console.log(`\nPool ${poolCount}: ${p.protocol} ${p.pool_address.slice(0,10)} created=${p.created_block} from=${fromBlock} latest=${latest}`);

    while (cursor < latest) {
      const to = Math.min(cursor + batchSize, latest);

      try {
        const result: any = await rpcClient.request({
          method: "eth_getLogs",
          params: [{
            address: p.pool_address,
            fromBlock: "0x" + cursor.toString(16),
            toBlock: "0x" + to.toString(16),
          }],
        });

        const count = result?.length ?? 0;
        poolEvents += count;
        totalEvents += count;
        if (count > 0) console.log(`  [${cursor}→${to}]: ${count} events`);
      } catch (e: any) {
        console.log(`  ERROR [${cursor}→${to}]: ${e?.message?.slice(0, 80)}`);
      }
      cursor = to;
    }

    console.log(`  Total for pool: ${poolEvents} events`);
  }

  console.log(`\nGrand total: ${totalEvents} events from ${poolCount} pools`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
