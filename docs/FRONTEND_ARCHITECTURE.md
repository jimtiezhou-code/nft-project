# NFTMarket 前端架构与实现逻辑文档

## 一、整体架构概览

前端采用 **Next.js 15 App Router** 架构，通过 **wagmi + viem** 与链上合约交互，使用 **Reown AppKit**（原 WalletConnect）实现钱包认证。

```
用户浏览器
    │
    ├── Next.js 15 (App Router) — SSR + 客户端组件
    │   ├── layout.tsx        ← 根布局，SSR cookie 水合 wagmi 状态
    │   ├── providers.tsx     ← 全局 Provider 层（Wagmi + React Query + Toast）
    │   └── page.tsx          ← 主页面（Marketplace / List NFT 标签切换）
    │
    ├── 组件层
    │   ├── ConnectButton     ← 钱包连接/断开按钮（AppKit Web Component）
    │   ├── MarketplaceGrid   ← 市场网格（加载 NFT 列表 + 挂单状态）
    │   ├── NFTCard           ← 单张 NFT 卡片（购买 / 下架操作）
    │   ├── ListNFTForm       ← 上架表单（选择 NFT → 定价 → 授权 → 上架）
    │   └── ToastContainer    ← 全局交易通知弹窗
    │
    ├── 数据层
    │   ├── hooks/useNFTMetadata  ← 从 IPFS 拉取 NFT 元数据（名称、图片）
    │   ├── context/ToastContext  ← Toast 通知全局状态管理
    │   └── contracts/            ← ABI JSON + 合约地址（可替换）
    │
    └── 配置层
        ├── lib/config.ts       ← WagmiAdapter + AppKit 网络配置
        └── .env.local          ← Reown Project ID + RPC URL
```

---

## 二、钱包连接流程（WalletConnect / AppKit）

### 2.1 配置层：lib/config.ts

```typescript
const wagmiAdapter = new WagmiAdapter({
  projectId,        // Reown Cloud 项目 ID
  networks: [sepolia],
  customRpcUrls: { "eip155:11155111": [{ url: sepoliaRpc }] },
});
```

- `WagmiAdapter` 是 Reown AppKit 封装的 wagmi 配置适配器
- 指定 `customRpcUrls` 避免 wagmi 内置公共 RPC 被限流
- 导出 `wagmiConfig` 用于 SSR 水合

### 2.2 Provider 层：providers.tsx

```typescript
// 模块级别创建 AppKit 单例
createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [sepolia],
  defaultNetwork: sepolia,
  features: { email: false, socials: false },  // 仅 WalletConnect
});

// 组件内三层嵌套
<WagmiProvider config={wagmiConfig} initialState={initialState}>
  <QueryClientProvider client={queryClient}>
    <ToastProvider>
      {mounted && children}
      <ToastContainer />
    </ToastProvider>
  </QueryClientProvider>
</WagmiProvider>
```

设计决策：
- **AppKit 在模块级别创建**（非组件内），确保全局只有一个 WalletConnect 实例
- **禁用 email/socials**，仅保留 WalletConnect 登录方式
- **`mounted` 状态守卫**：避免 SSR 与客户端渲染不匹配导致的水合错误
- **三层嵌套**：Wagmi（链状态） → React Query（缓存） → Toast（通知）

### 2.3 SSR Cookie 水合：layout.tsx

```typescript
const initialState = cookieToInitialState(wagmiConfig, headers().get("cookie"));
```

- 服务端读取浏览器 cookie 中的 wagmi 状态
- 传递给 `WagmiProvider` 的 `initialState`
- 效果：**页面刷新后无需重新连接钱包**，无闪烁

### 2.4 连接按钮：ConnectButton.tsx

```
未连接 → 显示 <appkit-button />（Reown 提供的 Web Component）
已连接 → 显示截断地址 + <appkit-button />（点击可切换/断开）
```

---

## 三、市场展示流程（MarketplaceGrid → NFTCard）

### 3.1 数据加载链

```
MarketplaceGrid
  │
  ├── useReadContract("nextTokenId")     ← 查询 NFT 总发行量
  │     → 得到 totalTokens = 3
  │
  └── 遍历 i = 0 到 totalTokens-1
        └── NFTListingItem(tokenId=i)
              │
              ├── useReadContract("listings", tokenId)   ← 查询挂单状态
              │     → { seller, price, active }
              │
              └── NFTCard({ tokenId, listing })
                    │
                    └── useNFTMetadata(tokenId)
                          │
                          ├── useReadContract("tokenURI", tokenId)  ← 链上查 URI
                          └── fetch(IPFS_GATEWAY + cid)            ← IPFS 拿 JSON
                                → { name, description, image }
```

### 3.2 useNFTMetadata Hook 的设计

```typescript
// 多网关回退策略
const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];

// 内存缓存（key = tokenURI 字符串）
const metadataCache: Record<string, NFTMetadata | null> = {};
```

- 同一个 URI 只请求一次，后续从 `metadataCache` 读取
- 网关 1 失败 → 尝试网关 2 → 网关 3，8 秒超时
- 图片 URL 自动从 `ipfs://` 转换为 `https://ipfs.io/ipfs/...`

### 3.3 NFTCard 的状态管理

```
loading === true     → 骨架屏（animate-pulse）
listing.active === true
  ├── 我是卖家       → [Delist 按钮]
  └── 我是买家
        ├── 购买方式选择
        │     ├── "Approve + Buy (2 tx)"   ← 传统方式
        │     └── "One-Click Buy (1 tx)"   ← ERC20 回调
        └── 交易状态流转
              approve → 等待确认 → buy → 完成
listing.active === false  → "已售出或已下架"
```

---

## 四、上架流程（ListNFTForm）

### 4.1 交易链设计

上架需要两笔交易，前端自动串联：

```
用户点击 "List NFT"
  │
  ├── 第 1 笔：approve(NFTMarket, tokenId)
  │     调用方：MyNFT 合约
  │     目的：授权市场合约转移该 NFT
  │     状态：step = "approving"
  │
  └── useEffect 监听 isApproveConfirmed === true
       │
       └── 第 2 笔：list(tokenId, price)
             调用方：NFTMarket 合约
             目的：将 NFT 上架（转移到市场合约）
             状态：step = "listing"
```

### 4.2 交易确认检测

```typescript
const { writeContract: approveNFT, data: approveHash } = useWriteContract();
const { isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({ hash: approveHash });
```

- `useWriteContract` — 发起交易，返回 `hash`
- `useWaitForTransactionReceipt` — 监听 `hash`，等待链上确认
- `useEffect` 检测 `isSuccess` 变为 `true` → 触发下一步

### 4.3 实时所有权验证

```typescript
const { data: tokenOwner } = useReadContract({
  functionName: "ownerOf",
  args: selectedTokenId ? [BigInt(selectedTokenId)] : undefined,
  query: { enabled: !!selectedTokenId },
});

const isOwner = address && tokenOwner
  ? (tokenOwner as string).toLowerCase() === address.toLowerCase()
  : false;
```

- 用户选择 Token ID 后立即查询链上的 `ownerOf`
- 红色/绿色实时提示是否拥有该 NFT
- 不是持有者则按钮置灰

### 4.4 上架与购买的完整交互闭环

```
账户 A                            合约                             账户 B
  │                                │                                │
  │── approve(market, tokenId)──→  │                                │
  │── list(tokenId, price) ─────→  │  NFT 转入 Market               │
  │                                │  事件: Listed                   │
  │                                │                                │
  │                                │         ←── approve(market, price)
  │                                │         ←── buyNFT(tokenId, price)
  │                                │    MTK: B → A                  │
  │  收到 MTK  ←───────────────── │    NFT: Market → B             │
  │                                │    事件: Bought                 │
```

---

## 五、购买流程（NFTCard 两种方式）

### 5.1 方式一：Approve + Buy（2 笔交易）

```
step = "idle"
  │
  ├── [检查 allowance] 
  │     有额度 → 直接跳到 buying
  │     无额度 → 先 approving
  │
  ├── step = "approving": approveToken(market, price)
  │     useWaitForTransactionReceipt 等待...
  │
  ├── useEffect 检测 isApproveConfirmed
  │     step = "buying", 自动调用 buyNFT
  │
  └── useEffect 检测 isBuyConfirmed
        step = "idle", 显示成功 Toast, 刷新列表
```

### 5.2 方式二：One-Click Buy（1 笔交易，ERC20 回调）

```typescript
const handleBuyCallback = () => {
  buyCallback({
    address: CONTRACTS.MyToken,
    abi: MyTokenABI,
    functionName: "transfer",
    args: [CONTRACTS.NFTMarket, listing.price, encodeTokenId(tokenId)],
  });
};
```

- 调用 ERC20 的 `transfer(to, amount, data)` — 带 data 的重载版本
- `data` = `abi.encode(uint256 tokenId)`（32 字节填充的十六进制）
- MyToken 合约会把 data 传给 NFTMarket 的 `tokensReceived()` 回调
- NFTMarket 在 `tokensReceived()` 里完成 NFT 转移 — **一笔交易完成购买**

### 5.3 allowance 预检查优化

```typescript
const { data: allowance } = useReadContract({
  functionName: "allowance",
  args: [address, CONTRACTS.NFTMarket],
});

const hasAllowance = allowance >= listing.price;
```

- 如果已有足够授权 → 按钮直接显示 "Buy Now"（跳过 Approve 那笔）
- 如果授权不足 → 按钮显示 "Approve & Buy"

---

## 六、Toast 通知系统

### 6.1 架构设计

```
ToastContext (全局状态)
  │
  ├── toasts: Toast[]          ← 通知列表
  ├── addToast(toast) → id     ← 添加通知，返回 ID
  ├── updateToast(id, data)    ← 更新通知（pending → success/error）
  └── removeToast(id)          ← 移除通知

ToastContainer (渲染层)
  │
  └── 遍历 toasts → ToastItem 组件
        ├── pending: 黄色，不自动消失
        ├── success: 绿色，8 秒后消失 + Etherscan 链接
        ├── error:   红色，8 秒后消失
        └── info:    蓝色，8 秒后消失
```

### 6.2 典型使用场景

```typescript
// 开始交易
const id = addToast({ type: "pending", title: "Approving token..." });

// 交易成功
updateToast(id, { type: "success", title: "Token approved!", txHash });

// 交易失败
updateToast(id, { type: "error", title: "Approval failed", message: errorMsg });
```

---

## 七、合约与前端解耦设计

### 7.1 合约地址集中管理：addresses.ts

```typescript
export const CONTRACTS = {
  MyNFT: "0x86bD3a04b287208267B8ac795807A128e6B156A1" as `0x${string}`,
  MyToken: "0xc07Aa8ab04Fcf817A4A76aaCf761Fe5d27D349e2" as `0x${string}`,
  NFTMarket: "0x2503E57BF29bD1b32425361840FE6Bb0d6CCc7F7" as `0x${string}`,
};
```

- 全局唯一引用点，所有组件通过 `CONTRACTS.XXX` 引用地址
- 换链/换合约只需改这一个文件

### 7.2 ABI 文件独立存放：contracts/abis/

```
abis/
├── MyNFT.json       ← 从 Foundry out/ 目录复制
├── MyToken.json
└── NFTMarket.json
```

- 每个 ABI 对应一个合约
- 替换合约时，重新从 `forge build` 的 `out/` 目录复制

### 7.3 网络配置：lib/config.ts

```typescript
// 换网络时只需改这里
import { sepolia } from "@reown/appkit/networks";
```

---

## 八、关键设计决策

### 8.1 为什么每个 NFT 独立查询挂单状态？

每个 `NFTListingItem` 独立调用 `useReadContract("listings", tokenId)`，而不是用一个批量查询函数。

理由：
- 合约没有 `getAllListings()` 批量函数
- React Query 自动去重和缓存，N+1 查询实际网络开销很小（缓存命中）
- 每个卡片独立刷新，互不影响
- 代码简洁，不需要自定义 hook 或批量处理逻辑

### 8.2 为什么 approve 成功后自动触发 list/buy？

用户不需要手动点两次按钮。`useEffect` 监听 `isApproveConfirmed`，一旦授权确认，自动调用下一步：

```typescript
useEffect(() => {
  if (isApproveConfirmed && step === "approving") {
    buyNFT({ ... });
  }
}, [isApproveConfirmed]);
```

### 8.3 为什么需要 mounted 状态守卫？

```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);

return (
  <WagmiProvider ...>
    {mounted && children}   ← SSR 时不渲染，客户端挂载后才渲染
  </WagmiProvider>
);
```

wagmi 依赖 `window.ethereum`，SSR 时不存在。等待客户端挂载后渲染，避免水合错误。

### 8.4 SSR cookie 水合的价值

```typescript
const initialState = cookieToInitialState(wagmiConfig, cookie);
```

用户刷新页面后，wagmi 从 cookie 恢复连接状态，即时显示已连接钱包，无需重新扫码。用户体验与纯 SPA 一致。

---

## 九、文件清单与职责

| 文件 | 职责 |
|------|------|
| `src/lib/config.ts` | Wagmi 适配器 + AppKit 网络配置 |
| `src/app/providers.tsx` | 全局 Provider 层：Wagmi / React Query / Toast / AppKit |
| `src/app/layout.tsx` | 根布局 + SSR cookie 水合 |
| `src/app/page.tsx` | 主页面：Marketplace / List 标签切换 |
| `src/app/globals.css` | Tailwind 基础样式 + Toast 动画 |
| `src/components/ConnectButton.tsx` | 钱包连接 / 断开按钮 |
| `src/components/MarketplaceGrid.tsx` | 市场网格：遍历所有 NFT 并展示挂单状态 |
| `src/components/NFTCard.tsx` | NFT 卡片：购买（双模式）/ 下架 / 元数据展示 |
| `src/components/ListNFTForm.tsx` | 上架表单：选 NFT → 定价 → 授权 → 上架 |
| `src/components/ToastContainer.tsx` | 全局 Toast 通知渲染 |
| `src/context/ToastContext.tsx` | Toast 全局状态管理（add / update / remove） |
| `src/hooks/useNFTMetadata.ts` | 从链上 tokenURI 拉取 IPFS 元数据 |
| `src/contracts/addresses.ts` | 合约地址集中管理（可替换） |
| `src/contracts/abis/*.json` | 合约 ABI 文件（从 Foundry out/ 目录导出） |
| `.env.local` | 环境变量：Reown Project ID + RPC URL |
