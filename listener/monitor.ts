/**
 * NFTMarket Event Monitor — 监听链上买卖事件（Polling 模式）
 *
 * 用法:
 *   MARKET_ADDRESS=<0x...> npx tsx listener/monitor.ts
 *
 * 环境变量:
 *   SEPOLIA_RPC_URL  — Sepolia RPC 节点地址
 *   MARKET_ADDRESS   — NFTMarket 合约地址
 *   POLL_INTERVAL    — 轮询间隔（秒），默认 10
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
} from "viem";
import { sepolia } from "viem/chains";

// ========== 配置 ==========

const RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

const MARKET_ADDRESS = (
  process.env.MARKET_ADDRESS || "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 10); // 秒

const TOKEN_DECIMALS = 1e18;

// ========== Client ==========

const client = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});

// ========== Event ABIs ==========

const EVENT_LISTED = parseAbiItem(
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)"
);
const EVENT_UNLISTED = parseAbiItem(
  "event Unlisted(uint256 indexed tokenId, address indexed seller)"
);
const EVENT_BOUGHT = parseAbiItem(
  "event Bought(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price)"
);

const ALL_EVENTS = [EVENT_LISTED, EVENT_UNLISTED, EVENT_BOUGHT] as const;

// viem getLogs with `events` returns decoded logs, but TS type is narrow
type DecodedLog = Log & { eventName: string; args: Record<string, unknown> };

// ========== 格式化 ==========

function fmtAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtPrice(price: bigint): string {
  return `${Number(price) / TOKEN_DECIMALS} MTK`;
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

// ========== 事件日志输出 ==========

const EVENT_EMOJI: Record<string, string> = {
  Listed: "📋",
  Unlisted: "📤",
  Bought: "💰",
};

function handleLog(log: DecodedLog) {
  const name = log.eventName;
  const emoji = EVENT_EMOJI[name] || "📢";
  const tx = log.transactionHash;

  switch (name) {
    case "Listed": {
      const { tokenId, seller, price } = log.args as unknown as {
        tokenId: bigint; seller: string; price: bigint;
      };
      console.log(
        `[${ts()}] ${emoji} ${name.padEnd(8)} | Token #${tokenId} | Seller: ${fmtAddr(seller)} | Price: ${fmtPrice(price)} | tx: ${tx}`
      );
      break;
    }
    case "Unlisted": {
      const { tokenId, seller } = log.args as unknown as {
        tokenId: bigint; seller: string;
      };
      console.log(
        `[${ts()}] ${emoji} ${name.padEnd(8)} | Token #${tokenId} | Seller: ${fmtAddr(seller)} | tx: ${tx}`
      );
      break;
    }
    case "Bought": {
      const { tokenId, buyer, seller, price } = log.args as unknown as {
        tokenId: bigint; buyer: string; seller: string; price: bigint;
      };
      console.log(
        `[${ts()}] ${emoji} ${name.padEnd(8)} | Token #${tokenId} | Buyer: ${fmtAddr(buyer)} → Seller: ${fmtAddr(seller)} | Price: ${fmtPrice(price)} | tx: ${tx}`
      );
      break;
    }
  }
}

// ========== Polling 轮询 ==========

async function pollOnce(lastBlock: bigint): Promise<bigint> {
  try {
    const currentBlock = await client.getBlockNumber();
    if (currentBlock <= lastBlock) return lastBlock;

    const fromBlock = lastBlock + 1n;
    const toBlock = currentBlock;

    const logs = (await client.getLogs({
      address: MARKET_ADDRESS,
      events: ALL_EVENTS,
      fromBlock,
      toBlock,
    })) as unknown as DecodedLog[];

    for (const log of logs) {
      handleLog(log);
    }

    if (logs.length > 0) {
      console.log(
        `  ↳ 轮询 [${fromBlock} → ${toBlock}] 共 ${logs.length} 条事件`
      );
    }

    return currentBlock;
  } catch (err: unknown) {
    const e = err as { code?: string; shortMessage?: string };
    if (e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT") {
      console.error(`[${ts()}] ⚠️  RPC 连接失败，重试中...`);
    } else {
      console.error(`[${ts()}] ⚠️  轮询错误:`, e.shortMessage || err);
    }
    return lastBlock;
  }
}

// ========== 主入口 ==========

async function main() {
  console.log("=".repeat(60));
  console.log(" NFTMarket Event Monitor (Polling Mode)");
  console.log("=".repeat(60));
  console.log(` RPC:           ${RPC_URL}`);
  console.log(` Market:        ${MARKET_ADDRESS}`);
  console.log(` Chain:         Sepolia (${sepolia.id})`);
  console.log(` Poll Interval: ${POLL_INTERVAL}s`);
  console.log("=".repeat(60));

  if (MARKET_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.log("\n⚠️  请先设置 MARKET_ADDRESS 环境变量:");
    console.log("   MARKET_ADDRESS=<0x...> npx tsx listener/monitor.ts");
    console.log("\n   获取地址:");
    console.log("     - deployments/sepolia.json");
    console.log("     - broadcast/DeployNFTMarket.s.sol/11155111/run-latest.json");
    console.log("\n   监听器仍将启动，等待后续设置有效地址...\n");
  }

  let lastBlock: bigint;
  try {
    lastBlock = await client.getBlockNumber();
    console.log(`\n✅ 从区块 ${lastBlock} 开始监听...\n`);
  } catch {
    console.error("❌ 无法连接 RPC，请检查网络");
    process.exit(1);
  }

  // 启动前先查一轮已有事件
  lastBlock = await pollOnce(lastBlock);

  const interval = setInterval(() => {
    pollOnce(lastBlock).then((b) => {
      lastBlock = b;
    });
  }, POLL_INTERVAL * 1000);

  process.on("SIGINT", () => {
    console.log("\n\n🛑 停止监听...");
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
