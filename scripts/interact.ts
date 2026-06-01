/**
 * NFTMarket 交互脚本 — 上架、购买、下架、白名单签名购买（Keystore 模式，无需明文私钥）
 *
 * 用法:
 *   npx tsx scripts/interact.ts status
 *   npx tsx scripts/interact.ts mint <toAddress> [uriIndex:1-3]
 *   npx tsx scripts/interact.ts list <tokenId> <priceInMTK>
 *   npx tsx scripts/interact.ts buy <tokenId>
 *   npx tsx scripts/interact.ts buy-callback <tokenId>
 *   npx tsx scripts/interact.ts unlist <tokenId>
 *   npx tsx scripts/interact.ts sign-permit <buyer> <tokenId> <priceMTK> [deadlineMinutes]
 *   npx tsx scripts/interact.ts permit-buy <tokenId> <deadline> <signature>
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
  encodePacked,
  keccak256,
  toHex,
  concat,
  pad,
  hexToBytes,
  bytesToHex,
  stringToHex,
  parseAbiParameters,
} from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { stdin, stdout } from "process";
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
  const derived = scryptSync(password, salt, 32, {
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

/** 隐藏输入密码，回显 * */
function readPassword(prompt: string): Promise<string> {
  return new Promise((res) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let buf = "";
    const onData = (chunk: Buffer) => {
      const chars = chunk.toString("utf-8");
      for (const ch of chars) {
        if (ch === "\r" || ch === "\n") {
          stdout.write("\n");
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          res(buf);
          return;
        }
        if (ch === "\x7f" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            stdout.write("\b \b");
          }
        } else if (ch === "\x03") {
          stdout.write("\n");
          process.exit(130);
        } else {
          buf += ch;
          stdout.write("*");
        }
      }
    };
    stdin.on("data", onData);
  });
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

  let password = process.env.KEYSTORE_PASSWORD || "";
  if (!password) {
    password = await readPassword("Keystore 密码: ");
  }

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

// ========== 预置 IPFS Metadata URI ==========

const PRESET_URIS: Record<string, string> = {
  "1": "ipfs://bafkreifwirfke75dd2nsfpz5wfyqtmvjghbwhecp4mnk3jx5aac6vxnpgy",
  "2": "ipfs://bafkreicnr5fx4czg63jcrhnkokhaek4fr2sp4owjooukkwacxfa2k77y2u",
  "3": "ipfs://bafkreiez2dyfg77m4p5btyg6hwa5zm2lacd7ekaj54hjb4hguh7hgq5mbe",
};

// ========== ABI ==========

const nftAbi = parseAbi([
  "function approve(address to, uint256 tokenId) external",
  "function mint(address to, string calldata uri) external returns (uint256)",
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
  "function permitBuy(uint256 tokenId, uint256 amount, uint256 deadline, bytes calldata signature) external",
  "function listings(uint256 tokenId) external view returns (address seller, uint256 price, bool active)",
  "function nftBalance() external view returns (uint256)",
  "function buildPermitDigest(address buyer, uint256 tokenId, uint256 amount, uint256 deadline) external view returns (bytes32)",
  "function signer() external view returns (address)",
]);

// ========== 工具 ==========

async function send(hash: `0x${string}`, label: string) {
  process.stdout.write(`  ${label}... `);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(receipt.status === "success" ? "✅" : "❌");
  console.log(`  tx: ${hash}`);
  return receipt;
}

// ========== EIP-712 Permit 签名构建 ==========

/**
 * 构建 EIP-712 domain separator（与 NFTMarket 合约中的 _domainSeparator 一致）
 */
function buildDomainSeparator(chainId: number, verifyingContract: `0x${string}`): `0x${string}` {
  const DOMAIN_TYPEHASH = keccak256(
    stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
  );
  const NAME_HASH = keccak256(stringToHex("NFTMarket Permit"));
  const VERSION_HASH = keccak256(stringToHex("1"));

  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
      [DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, BigInt(chainId), verifyingContract]
    )
  );
}

/**
 * 构建 PermitBuy 的 EIP-712 typed data hash
 * 对应合约中的 _buildPermitDigest
 */
function buildPermitDigestLocal(
  buyer: `0x${string}`,
  tokenId: bigint,
  amount: bigint,
  deadline: bigint,
  chainId: number,
  verifyingContract: `0x${string}`
): `0x${string}` {
  const PERMIT_TYPEHASH = keccak256(
    stringToHex("PermitBuy(address buyer,uint256 tokenId,uint256 amount,uint256 deadline)")
  );

  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, address, uint256, uint256, uint256"),
      [PERMIT_TYPEHASH, buyer, tokenId, amount, deadline]
    )
  );

  const domainSeparator = buildDomainSeparator(chainId, verifyingContract);

  return keccak256(
    concat(["0x19", "0x01", domainSeparator, structHash] as `0x${string}`[])
  ) as `0x${string}`;
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

async function cmdMint(to: string, uriIndex: string) {
  const uri = PRESET_URIS[uriIndex];
  if (!uri) {
    console.error(`❌ 无效的 URI 编号: ${uriIndex}（可选: ${Object.keys(PRESET_URIS).join(", ")}）`);
    process.exit(1);
  }
  console.log(`\n🎨 铸造 NFT -> ${to}`);
  console.log(`   URI: ${uri}\n`);

  const hash = await walletClient.writeContract({
    address: NFT_ADDR,
    abi: nftAbi,
    functionName: "mint",
    args: [to as `0x${string}`, uri],
  });
  await send(hash, "铸造");
  const nextId = await publicClient.readContract({
    address: NFT_ADDR, abi: nftAbi, functionName: "nextTokenId",
  });
  console.log(`\n✅ 已铸造 NFT #${Number(nextId) - 1} -> ${to}\n`);
}

/**
 * 项目方离线签名：为白名单用户生成 permit 签名
 *
 * 流程:
 *   1. 项目方指定 buyer、tokenId、price、deadline
 *   2. 脚本本地构建 EIP-712 digest
 *   3. 使用项目方 keystore 私钥签名
 *   4. 将 signature 发给白名单用户（可通过任意渠道：邮件、微信等）
 *
 * 白名单用户拿到签名后，通过 permit-buy 命令调用合约购买。
 */
async function cmdSignPermit(buyer: string, tokenId: bigint, priceMTK: string, deadlineMinutes: string) {
  const buyerAddr = buyer as `0x${string}`;
  const amount = parseEther(priceMTK);
  const chainId = await publicClient.getChainId();

  const deadlineMins = parseInt(deadlineMinutes) || 60;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineMins * 60);

  console.log(`\n🔏 生成白名单 Permit 签名`);
  console.log(`  买家地址:     ${buyer}`);
  console.log(`  NFT Token ID: ${tokenId}`);
  console.log(`  价格:         ${priceMTK} MTK`);
  console.log(`  过期时间:     ${new Date(Number(deadline) * 1000).toISOString()} (${deadlineMinutes} 分钟后)`);
  console.log(`  Chain ID:     ${chainId}`);
  console.log(`  验证合约:     ${MARKET_ADDR}`);

  // 1. 本地构建 EIP-712 digest
  const digest = buildPermitDigestLocal(buyerAddr, tokenId, amount, deadline, chainId, MARKET_ADDR);

  // 2. 与链上 buildPermitDigest 对比验证
  const onChainDigest = await publicClient.readContract({
    address: MARKET_ADDR,
    abi: marketAbi,
    functionName: "buildPermitDigest",
    args: [buyerAddr, tokenId, amount, deadline],
  });
  if (digest !== onChainDigest) {
    console.error("❌ 本地 digest 与链上不一致，请检查 EIP-712 参数!");
    console.error(`  本地: ${digest}`);
    console.error(`  链上: ${onChainDigest}`);
    process.exit(1);
  }
  console.log(`  ✅ 本地 digest 与链上一致`);

  // 3. 使用项目方 keystore 私钥签名
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: {
      name: "NFTMarket Permit",
      version: "1",
      chainId: Number(chainId),
      verifyingContract: MARKET_ADDR,
    },
    types: {
      PermitBuy: [
        { name: "buyer", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "amount", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "PermitBuy",
    message: {
      buyer: buyerAddr,
      tokenId: tokenId,
      amount: amount,
      deadline: deadline,
    },
  });

  console.log(`\n📝 签名结果 (发给白名单用户):`);
  console.log(`  Signature: ${signature}`);
  console.log(`  Deadline:  ${deadline}`);
  console.log(`\n白名单用户执行购买命令:`);
  console.log(`  npx tsx scripts/interact.ts permit-buy ${tokenId} ${deadline} ${signature}\n`);
}

/**
 * 白名单用户使用 permit 签名购买 NFT
 *
 * 流程:
 *   1. 用户从项目方获得 signature 和 deadline
 *   2. 先 approve 市场合约扣 Token
 *   3. 调用 permitBuy() 完成购买
 */
async function cmdPermitBuy(tokenId: bigint, deadline: string, signature: string) {
  const [, price] = await publicClient.readContract({
    address: MARKET_ADDR, abi: marketAbi, functionName: "listings", args: [tokenId],
  });
  if (price === 0n) {
    console.error(`❌ NFT #${tokenId} 未上架`);
    process.exit(1);
  }
  const priceMTK = formatEther(price);
  const deadlineBN = BigInt(deadline);

  // 检查是否过期
  if (deadlineBN < BigInt(Math.floor(Date.now() / 1000))) {
    console.error(`❌ 签名已过期 (deadline: ${new Date(Number(deadlineBN) * 1000).toISOString()})`);
    process.exit(1);
  }

  console.log(`\n🎫 白名单 Permit 购买 NFT #${tokenId}`);
  console.log(`  价格:     ${priceMTK} MTK`);
  console.log(`  过期时间: ${new Date(Number(deadlineBN) * 1000).toISOString()}`);
  console.log(`  签名:     ${signature.slice(0, 20)}...`);

  // 1. Approve
  const h1 = await walletClient.writeContract({
    address: TOKEN_ADDR,
    abi: tokenAbi,
    functionName: "approve",
    args: [MARKET_ADDR, price],
  });
  await send(h1, "授权市场扣 Token");

  // 2. PermitBuy
  const h2 = await walletClient.writeContract({
    address: MARKET_ADDR,
    abi: marketAbi,
    functionName: "permitBuy",
    args: [tokenId, price, deadlineBN, signature as `0x${string}`],
  });
  await send(h2, "白名单购买");
  console.log(`\n✅ 已通过白名单许可购买 NFT #${tokenId} (${priceMTK} MTK)\n`);
}

async function cmdStatus(addr: string) {
  console.log("\n📊 NFTMarket 状态\n");
  console.log(`  MyToken:   ${TOKEN_ADDR}`);
  console.log(`  MyNFT:     ${NFT_ADDR}`);
  console.log(`  NFTMarket: ${MARKET_ADDR}`);
  console.log(`  操作者:    ${addr}`);

  const [mtk, nftCount, nextId, signerAddr] = await Promise.all([
    publicClient.readContract({ address: TOKEN_ADDR, abi: tokenAbi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: MARKET_ADDR, abi: marketAbi, functionName: "nftBalance" }),
    publicClient.readContract({ address: NFT_ADDR, abi: nftAbi, functionName: "nextTokenId" }),
    publicClient.readContract({ address: MARKET_ADDR, abi: marketAbi, functionName: "signer" }),
  ]);

  console.log(`  Permit 签名者: ${signerAddr}`);
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
    case "mint": {
      const to = process.argv[3];
      const uriIdx = process.argv[4] || "1";
      if (!to) {
        console.log("用法: npx tsx scripts/interact.ts mint <toAddress> [uriIndex:1-3]");
        process.exit(1);
      }
      await cmdMint(to, uriIdx);
      break;
    }
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
    case "sign-permit": {
      // 用法: npx tsx scripts/interact.ts sign-permit <buyer> <tokenId> <priceMTK> [deadlineMinutes]
      const buyer = process.argv[3];
      const priceMTK = process.argv[5];
      const deadlineMins = process.argv[6] || "60";
      if (!buyer || tokenId === undefined || !priceMTK) {
        console.log("用法: npx tsx scripts/interact.ts sign-permit <buyer> <tokenId> <priceMTK> [deadlineMinutes]");
        console.log("示例: npx tsx scripts/interact.ts sign-permit 0xBOB_ADDRESS 0 100 30");
        process.exit(1);
      }
      await cmdSignPermit(buyer, tokenId, priceMTK, deadlineMins);
      break;
    }
    case "permit-buy": {
      // 用法: npx tsx scripts/interact.ts permit-buy <tokenId> <deadline> <signature>
      const deadline = process.argv[4];
      const signature = process.argv[5];
      if (tokenId === undefined || !deadline || !signature) {
        console.log("用法: npx tsx scripts/interact.ts permit-buy <tokenId> <deadline> <signature>");
        console.log("示例: npx tsx scripts/interact.ts permit-buy 0 1739000000 0x...");
        process.exit(1);
      }
      await cmdPermitBuy(tokenId, deadline, signature);
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
  mint <to> [uriIdx:1-3]   铸造 NFT 到指定地址（默认 URI #1，仅 Owner）
  list <id> <priceMTK>     上架 NFT（approve + list 两笔交易）
  buy <id>                 购买 NFT（approve + buyNFT 两笔交易）
  buy-callback <id>        一键购买（transfer 回调 tokensReceived，一笔交易）
  unlist <id>              下架 NFT
  sign-permit <buyer> <id> <priceMTK> [deadlineMins]  项目方给白名单地址离线签名
  permit-buy <id> <deadline> <sig>                    白名单用户使用签名购买

示例:
  npx tsx scripts/interact.ts status
  npx tsx scripts/interact.ts mint 0xYOUR_WALLET_ADDRESS 1
  npx tsx scripts/interact.ts list 0 100
  npx tsx scripts/interact.ts buy-callback 0
  npx tsx scripts/interact.ts unlist 0

白名单购买流程:
  # 1. 项目方给白名单地址签名（使用项目方 keystore）
  npx tsx scripts/interact.ts sign-permit 0xBOB_ADDRESS 0 100 30

  # 2. 白名单用户拿到签名后购买（使用自己的 keystore）
  npx tsx scripts/interact.ts permit-buy 0 1739000000 0x...

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