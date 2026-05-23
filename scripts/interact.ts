/**
 * NFTMarket 交互脚本 — 上架、购买、下架（Keystore 模式，无需明文私钥）
 *
 * 用法:
 *   npx tsx scripts/interact.ts status
 *   npx tsx scripts/interact.ts list <tokenId> <priceInMTK>
 *   npx tsx scripts/interact.ts buy <tokenId>
 *   npx tsx scripts/interact.ts buy-callback <tokenId>
 *   npx tsx scripts/interact.ts unlist <tokenId>
 *
 * 运行时输入 keystore 密码，私钥仅存在于内存中，不落盘。
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
  parseEther,
  encodeAbiParameters,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import { scryptSync, createDecipheriv } from "crypto";
import { keccak_256 } from "@noble/hashes/sha3";

// ========== Keystore 解密（Web3 Secret Storage v3） ==========

function decryptKeystore(jsonStr: string, password: string): `0x${string}` {
  const ks = JSON.parse(jsonStr);
  const { kdf, kdfparams, cipher, cipherparams, ciphertext, mac } = ks.crypto;

  if (kdf !== "scrypt") throw new Error(`不支持的 KDF: ${kdf}`);
  if (cipher !== "aes-128-ctr") throw new Error(`不支持的 cipher: ${cipher}`);

  // 1. scrypt 派生密钥
  const salt = Buffer.from(kdfparams.salt, "hex");
  const derived = scryptSync(password, salt, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
    maxmem: 128 * kdfparams.n * kdfparams.r + 128 * 1024 * 1024,
  });
  if (derived.length < 32) throw new Error("scrypt 派生失败");

  // 2. 左 16 字节 = AES key，右 16 字节 = MAC key
  const aesKey = derived.subarray(0, 16);
  const macKey = derived.subarray(16, 32);

  // 3. 验证 MAC
  const macInput = Buffer.concat([macKey, Buffer.from(ciphertext, "hex")]);
  if (Buffer.from(keccak_256(macInput)).toString("hex") !== mac) {
    throw new Error("密码错误");
  }

  // 4. AES-128-CTR 解密
  const decipher = createDecipheriv(
    "aes-128-ctr",
    aesKey,
    Buffer.from(cipherparams.iv, "hex")
  );
  const pk = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);

  return `0x${pk.toString("hex")}`;
}

async function loadAccount(): Promise<ReturnType<typeof privateKeyToAccount>> {
  const ksPath =
    process.env.KEYSTORE_PATH ||
    resolve(homedir(), ".foundry/keystores/deployer");

  let keystoreJson: string;
  try {
    keystoreJson = readFileSync(ksPath, "utf-8");
  } catch {
    console.error(`❌ 找不到 keystore: ${ksPath}`);
    console.error("   可通过 KEYSTORE_PATH 环境变量指定路径");
    process.exit(1);
  }

  const password = await new Promise<string>((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("Keystore 密码: ", (ans) => {
      rl.close();
      res(ans);
    });
  });

  try {
    const pk = decryptKeystore(keystoreJson, password);
    return privateKeyToAccount(pk);
  } catch (err) {
    console.error("❌", (err as Error).message);
    process.exit(1);
  }
}

// ========== 加载部署地址 ==========

const deployments = JSON.parse(
  readFileSync(resolve("deployments/sepolia.json"), "utf-8")
) as Record<string, string | number>;

const TOKEN_ADDR = deployments.MyToken as `0x${string}`;
const NFT_ADDR = deployments.MyNFT as `0x${string}`;
const MARKET_ADDR = deployments.NFTMarket as `0x${string}`;

// ========== ABI ==========

const nftAbi = parseAbi([
  "function approve(address to, uint256 tokenId) external",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function nextTokenId() external view returns (uint256)",
]);

const tokenAbi = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount, bytes calldata data) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);

const marketAbi = parseAbi([
  "function list(uint256 tokenId, uint256 price) external",
  "function unlist(uint256 tokenId) external",
  "function buyNFT(uint256 tokenId, uint256 amount) external",
  "function listings(uint256 tokenId) external view returns (address seller, uint256 price, bool active)",
  "function nftBalance() external view returns (uint256)",
]);

// ========== 工具 ==========

async function send(hash: `0x${string}`, label: string) {
  process.stdout.write(`  ${label}... `);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(receipt.status === "success" ? "✅" : "❌");
  console.log(`  tx: ${hash}`);
  return receipt;
}

// ========== 命令 ==========

async function cmdList(tokenId: bigint, priceMTK: string) {
  const price = parseEther(priceMTK);
  console.log(`\n📋 上架 NFT #${tokenId}, 价格 ${priceMTK} MTK\n`);

  const h1 = await walletClient.writeContract({
    address: NFT_ADDR,
    abi: nftAbi,
    functionName: "approve",
    args: [MARKET_ADDR, tokenId],
  });
  await send(h1, "授权市场转移 NFT");

  const h2 = await walletClient.writeContract({
    address: MARKET_ADDR,
    abi: marketAbi,
    functionName: "list",
    args: [tokenId, price],
  });
  await send(h2, "上架");
  console.log(`\n✅ NFT #${tokenId} 已上架 (${priceMTK} MTK)\n`);
}

async function cmdBuy(tokenId: bigint) {
  const [, price] = await publicClient.readContract({
    address: MARKET_ADDR, abi: marketAbi, functionName: "listings", args: [tokenId],
  });
  if (price === 0n) {
    console.error(`❌ NFT #${tokenId} 未上架`);
    process.exit(1);
  }
  const priceMTK = formatEther(price);
  console.log(`\n💰 购买 NFT #${tokenId}, 价格 ${priceMTK} MTK\n`);

  const h1 = await walletClient.writeContract({
    address: TOKEN_ADDR,
    abi: tokenAbi,
    functionName: "approve",
    args: [MARKET_ADDR, price],
  });
  await send(h1, "授权市场扣 Token");

  const h2 = await walletClient.writeContract({
    address: MARKET_ADDR,
    abi: marketAbi,
    functionName: "buyNFT",
    args: [tokenId, price],
  });
  await send(h2, "购买");
  console.log(`\n✅ 已购买 NFT #${tokenId} (${priceMTK} MTK)\n`);
}

async function cmdBuyCallback(tokenId: bigint) {
  const [, price] = await publicClient.readContract({
    address: MARKET_ADDR, abi: marketAbi, functionName: "listings", args: [tokenId],
  });
  if (price === 0n) {
    console.error(`❌ NFT #${tokenId} 未上架`);
    process.exit(1);
  }
  const priceMTK = formatEther(price);
  console.log(`\n🔄 一键购买 NFT #${tokenId}, 价格 ${priceMTK} MTK (tokensReceived)\n`);

  const data = encodeAbiParameters([{ type: "uint256" }], [tokenId]);
  const hash = await walletClient.writeContract({
    address: TOKEN_ADDR,
    abi: tokenAbi,
    functionName: "transfer",
    args: [MARKET_ADDR, price, data],
  });
  await send(hash, "转账即购买");
  console.log(`\n✅ 已购买 NFT #${tokenId} (${priceMTK} MTK, 一笔交易)\n`);
}

async function cmdUnlist(tokenId: bigint) {
  console.log(`\n📤 下架 NFT #${tokenId}\n`);
  const hash = await walletClient.writeContract({
    address: MARKET_ADDR,
    abi: marketAbi,
    functionName: "unlist",
    args: [tokenId],
  });
  await send(hash, "下架");
  console.log(`\n✅ NFT #${tokenId} 已下架\n`);
}

async function cmdStatus(addr: string) {
  console.log("\n📊 NFTMarket 状态\n");
  console.log(`  MyToken:   ${TOKEN_ADDR}`);
  console.log(`  MyNFT:     ${NFT_ADDR}`);
  console.log(`  NFTMarket: ${MARKET_ADDR}`);
  console.log(`  操作者:    ${addr}`);

  const [mtk, nftCount, nextId] = await Promise.all([
    publicClient.readContract({ address: TOKEN_ADDR, abi: tokenAbi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: MARKET_ADDR, abi: marketAbi, functionName: "nftBalance" }),
    publicClient.readContract({ address: NFT_ADDR, abi: nftAbi, functionName: "nextTokenId" }),
  ]);

  console.log(`  MTK 余额:  ${formatEther(mtk)} MTK`);
  console.log(`  市场在售:  ${nftCount} 个 NFT`);
  console.log(`  已铸造:    ${nextId} 个 NFT`);

  if (Number(nextId) > 0) {
    console.log("\n  NFT 列表:");
    for (let i = 0n; i < nextId; i++) {
      const [seller, price, active] = await publicClient.readContract({
        address: MARKET_ADDR, abi: marketAbi, functionName: "listings", args: [i],
      });
      const owner = await publicClient.readContract({
        address: NFT_ADDR, abi: nftAbi, functionName: "ownerOf", args: [i],
      });
      const st = active
        ? `在售 ${formatEther(price)} MTK (卖家: ${seller.slice(0, 6)}...)`
        : `持有者: ${owner.slice(0, 6)}...`;
      console.log(`    #${i}: ${st}`);
    }
  }
  console.log();
}

// ========== 全局 client（account 在 main 中赋值） ==========

let publicClient: ReturnType<typeof createPublicClient>;
let walletClient: ReturnType<typeof createWalletClient>;

// ========== 主入口 ==========

async function main() {
  console.log("🔐 加载 keystore...");
  const account = await loadAccount();

  publicClient = createPublicClient({ chain: sepolia, transport: http() });
  walletClient = createWalletClient({ chain: sepolia, transport: http(), account });

  const cmd = process.argv[2];
  const tokenId = process.argv[3] ? BigInt(process.argv[3]) : undefined;

  switch (cmd) {
    case "list": {
      const priceMTK = process.argv[4];
      if (!tokenId || !priceMTK) {
        console.log("用法: npx tsx scripts/interact.ts list <tokenId> <priceInMTK>");
        process.exit(1);
      }
      await cmdList(tokenId, priceMTK);
      break;
    }
    case "buy": {
      if (tokenId === undefined) {
        console.log("用法: npx tsx scripts/interact.ts buy <tokenId>");
        process.exit(1);
      }
      await cmdBuy(tokenId);
      break;
    }
    case "buy-callback": {
      if (tokenId === undefined) {
        console.log("用法: npx tsx scripts/interact.ts buy-callback <tokenId>");
        process.exit(1);
      }
      await cmdBuyCallback(tokenId);
      break;
    }
    case "unlist": {
      if (tokenId === undefined) {
        console.log("用法: npx tsx scripts/interact.ts unlist <tokenId>");
        process.exit(1);
      }
      await cmdUnlist(tokenId);
      break;
    }
    case "status":
      await cmdStatus(account.address);
      break;
    default:
      console.log(`
📦 NFTMarket 交互脚本 (Keystore 模式)

用法: npx tsx scripts/interact.ts <命令> [参数]

命令:
  status                    查看市场和账户状态
  list <id> <priceMTK>     上架 NFT（approve + list 两笔交易）
  buy <id>                 购买 NFT（approve + buyNFT 两笔交易）
  buy-callback <id>        一键购买（transfer 回调 tokensReceived，一笔交易）
  unlist <id>              下架 NFT

示例:
  npx tsx scripts/interact.ts status
  npx tsx scripts/interact.ts list 0 100
  npx tsx scripts/interact.ts buy-callback 0
  npx tsx scripts/interact.ts unlist 0

安全说明:
  使用 ~/.foundry/keystores/deployer，运行时输入密码
  私钥仅存在于内存中，不会写入 .env 或任何文件
  可通过 KEYSTORE_PATH 环境变量指定其他 keystore 路径
`);
      break;
  }
}

main().catch((err) => {
  console.error("\n❌ 错误:", (err as Error).message || err);
  process.exit(1);
});
