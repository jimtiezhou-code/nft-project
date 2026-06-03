# NFTMarket.sol — Gas Report v1

> 生成日期：2026-06-03  
> 测试套件：32 tests (32 passed, 0 failed)  
> Solidity：0.8.25 | 优化器：默认 | via_ir：false

---

## 一、NFTMarket 合约部署

| 指标 | 值 |
|------|-----|
| 部署成本 (Deployment Cost) | **2,138,248 gas** |
| 部署大小 (Deployment Size) | **10,287 bytes** |

> 部署成本接近 EIP-170 合约大小上限（24,576 bytes）约 42%，主要因为包含 EIP-712 重构建 ECDSA/MessageHashUtils library。

---

## 二、函数 Gas 消耗明细

| 函数 | 类型 | Min | Avg | Median | Max | 调用次数 |
|------|------|-----|-----|--------|-----|---------|
| `list(tokenId, price)` | 写 | 22,283 | 119,045 | 134,819 | 134,819 | 31 |
| `unlist(tokenId)` | 写 | 28,544 | 35,055 | 28,586 | 48,036 | 3 |
| `buyNFT(tokenId, amount)` | 写 | 28,859 | 63,277 | 84,215 | 89,027 | 7 |
| `permitBuy(tokenId, amount, deadline, sig)` | 写 | 24,303 | 58,136 | 39,434 | 115,008 | 7 |
| `tokensReceived(from, amount, data)` | 写 | 23,245 | 23,245 | 23,245 | 23,245 | 1 |
| `listings(tokenId)` | 读 | 7,378 | 7,378 | 7,378 | 7,378 | 5 |
| `buildPermitDigest(buyer, id, amt, dl)` | 读 | 3,100 | 3,100 | 3,100 | 3,100 | 5 |
| `nftBalance()` | 读 | 6,582 | 6,582 | 6,582 | 6,582 | 1 |
| `tokenBalance()` | 读 | 6,414 | 6,414 | 6,414 | 6,414 | 1 |

---

## 三、写入函数分析（Min / Max 差异原因）

### 3.1 `list()` — 22,283 ~ 134,819

```
min: ERC721 已在市场手中（relist 场景），仅更新 mapping
max: ERC721 transferFrom + mapping 写入（首次上架）
```

首次上架需要 `transferFrom`（2 次 SSTORE + 1 次 event），relist 仅更新 storage mapping。

### 3.2 `unlist()` — 28,544 ~ 48,036

```
min: 同一区块内下架（SSTORE 热写）
max: 跨区块下架（SSTORE 冷写 2200 gas）
```

### 3.3 `buyNFT()` — 28,859 ~ 89,027

```
min: ERC20 transferFrom 目标已有余额（热 SSTORE）
max: ERC20 transferFrom 目标无余额（冷 SSTORE 2200 + 新 slot）
```

### 3.4 `permitBuy()` — 24,303 ~ 115,008

| 消耗项 | Gas | 说明 |
|--------|-----|------|
| 基础调用 + deadline 检查 | ~3,000 | 固定 |
| EIP-712 digest 重建 | ~3,100 | `buildPermitDigest` 内部 |
| ecrecover 签名恢复 | ~3,000 | ECDSA 预编译 |
| `usedDigests[digest] = true` | ~20,000 | SSTORE 冷写（首次使用该 slot） |
| listing.active = false | ~5,000 | SSTORE 热写 |
| ERC20 transferFrom | ~15,000 ~ 60,000 | 含 allowance 更新 |
| ERC721 transferFrom | ~40,000 ~ 65,000 | 含 ownerOf 更新 |
| 3 个 event 日志 | ~3,375 | Bought event |

**Min (24,303)**: 所有 storage slot 热写入（首次 `permitBuy` 最终成功场景）。  
**Max (115,008)**: digest slot 首次冷写入 + ERC20/ERC721 首次冷写入 + 多次 mapping 更新。

### 3.5 各购买路径 Gas 对比

| 购买方式 | Avg Gas | 对比 `permitBuy` |
|------|------|------|
| `buyNFT` (标准 approve+buy) | 63,277 | 基准 |
| `permitBuy` (EIP-712 白名单) | 58,136 | **节省 8.1%** |
| `tokensReceived` (ERC20 回调) | 23,245 | 节省 63.3% (是市场合约的 gas，不含 ERC20 转账部分) |

> 注：`tokensReceived` 的 gas 只计市场合约侧，ERC20 的 `transfer(address,uint256,bytes)` 本身消耗 ~78,061 (avg)，合计约 101k。因此三种购买方式端到端 gas 相近。

---

## 四、视图函数

| 函数 | 操作 | Gas | 说明 |
|------|------|-----|------|
| `listings(tokenId)` | 读 mapping | 7,378 | 无 storage 写入 |
| `buildPermitDigest(...)` | 纯计算 | 3,100 | 仅 keccak256 + abi.encode |
| `nftBalance()` | 跨合约调用 | 6,582 | → MyNFT.balanceOf |
| `tokenBalance()` | 跨合约调用 | 6,414 | → MyToken.balanceOf |

---

## 五、关联合约 Gas 参考

### MyNFT (ERC-721)

| 函数 | Min | Avg | Max | 调用次数 |
|------|-----|-----|-----|---------|
| 部署 | — | 2,260,978 | — | 1 |
| `mint(to, uri)` | 87,568 | 98,968 | 121,768 | 96 |
| `approve(addr, id)` | 49,068 | 49,070 | 49,080 | 28 |
| `ownerOf(id)` | 3,050 | 3,050 | 3,050 | 42 |

### MyToken (ERC-20)

| 函数 | Min | Avg | Max | 调用次数 |
|------|-----|-----|-----|---------|
| 部署 | — | 1,185,565 | — | 1 |
| `approve(spender, amount)` | 46,942 | 46,942 | 46,942 | 11 |
| `transfer(to, amount)` | 52,206 | 52,206 | 52,206 | 64 |
| `transfer(to, amount, data)` | 57,321 | 78,061 | 97,076 | 8 |
| `balanceOf(addr)` | 2,851 | 2,851 | 2,851 | 19 |

---

## 六、优化建议

| 优化点 | 预期节省 | 说明 |
|--------|---------|------|
| `usedDigests` → `nonces` 递增 | ~15,000/笔 | 用 `mapping(address => uint256) nonces` 替代 mapping(bytes32 => bool)，仅需更新 1 个 slot |
| 合并 `listings` mapping 字段 | ~5,000 | 将 `seller, price, active` 打包进单个 `struct` 减少 slot 数（已打包） |
| 使用 Solmate ERC20/ERC721 | ~30-50% 部署成本 | 替换 OpenZeppelin 可大幅降低合约体积和部署 gas |
| `immutable` 变量 | 已使用 | `nft`, `token`, `signer` 已为 immutable，读取仅 ~100 gas |
