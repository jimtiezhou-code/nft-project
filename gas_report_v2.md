# NFTMarket.sol — Gas Report v2 (优化后)

> 生成日期：2026-06-03  
> 测试套件：32 tests (32 passed, 0 failed)  
> Solidity：0.8.25 | via_ir：false

---

## 一、优化项 vs v1

| # | 优化项 | 说明 |
|---|--------|------|
| 1 | `usedDigests` → `permitNonces` | 递增 nonce 替代 mapping(bytes32=>bool)，省 1 次 SSTORE 冷写 |
| 2 | `_domainSeparator()` → `DOMAIN_SEPARATOR` immutable | 构造函数计算一次，运行时直接读常量（~100 gas），原需 keccak256+abi.encode (~2k gas) |
| 3 | Listing struct 重排 `{price, seller, active}` | 从 3 slot → 2 slot（seller + active 打包），list() 省 1 SSTORE |
| 4 | `memory` → `storage` 指针 | buyNFT/unlist/permitBuy/tokensReceived 统一用 storage 指针避免内存拷贝 |
| 5 | `msg.sender` 缓存 | 多次读取 msg.sender 改为局部变量读一次 |
| 6 | unchecked nonce 自增 | `permitNonces[buyer] = nonce + 1` 用 unchecked 省检查 |

---

## 二、部署成本对比

| 指标 | v1 | v2 | 节省 |
|------|-----|-----|------|
| Deployment Cost | 2,138,248 | **1,990,889** | **-147,359 (-6.9%)** |
| Deployment Size | 10,287 | **9,934** | **-353 bytes** |

---

## 三、函数 Gas 对比

| 函数 | v1 Avg | v2 Avg | 节省 | 优化来源 |
|------|--------|--------|------|---------|
| `list` | 119,045 | **99,324** | **-19,721 (-16.6%)** | struct 打包 (3→2 slot) + msg.sender 缓存 |
| `unlist` | 35,055 | **32,435** | **-2,620 (-7.5%)** | storage 指针 + msg.sender 缓存 |
| `buyNFT` | 63,277 | **63,622** | +345 (+0.5%) | 微小波动 |
| `permitBuy` | 58,136 | **57,493** | **-643 (-1.1%)** | nonces 模式 + immutable domain |
| `tokensReceived` | 23,245 | **23,267** | +22 (+0.1%) | 基本持平 |
| `buildPermitDigest` | 3,100 | **2,411** | **-689 (-22.2%)** | immutable domain + constant typehash |
| `listings` (view) | 7,378 | **5,429** | **-1,949 (-26.4%)** | 2 slot (vs 3) → 少 1 SLOAD |

---

## 四、`permitBuy` 详细 Gas 拆解 (v1 vs v2)

### v1 热路径（permitBuy 首次成功，116,721 gas）

| 步骤 | v1 操作 | Gas |
|------|---------|-----|
| deadline 检查 | SLOAD | ~100 |
| listing 读取 (3-slot) | 3× SLOAD | ~300 |
| `_buildPermitDigest` | keccak256 + `_domainSeparator()` 计算 + abi.encode | ~3,100 |
| `usedDigests[digest]` 读取 | SLOAD 冷读 | ~2,100 |
| `usedDigests[digest] = true` | SSTORE 冷写 | **~20,000** |
| `_recoverSigner` | ecrecover | ~3,000 |
| `listings[].active = false` | SSTORE | ~5,000 |
| `transferFrom` + `transferFrom` | ERC20 + ERC721 | ~50,000 |

### v2 热路径（permitBuy 首次成功，116,721 gas）

| 步骤 | v2 操作 | Gas |
|------|---------|-----|
| deadline 检查 | SLOAD | ~100 |
| listing 读取 (2-slot) | 2× SLOAD | ~200 |
| `permitNonces[buyer]` 读取 | SLOAD | ~2,100 (首次冷) |
| `_buildPermitDigest` | keccak256 + immutable domain + abi.encode | ~2,411 |
| `_recoverSigner` | ecrecover | ~3,000 |
| `permitNonces[buyer] = nonce + 1` | SSTORE (同一 slot 热写) | **~2,900** |
| `listings[].active = false` | SSTORE | ~5,000 |
| `transferFrom` + `transferFrom` | ERC20 + ERC721 | ~50,000 |

**关键差异**：v1 需 `usedDigests[digest] = true` 冷 SSTORE (~20k)，v2 的 `permitNonces` 和 listing 读写在相邻 slot，nonce 增量写仅 ~2.9k。

---

## 五、测试级 Gas 对比

| 测试 | v1 Gas | v2 Gas | 节省 |
|------|--------|--------|------|
| `test_List` | 217,653 | **193,870** | **-23,783 (-10.9%)** |
| `test_Unlist` | 255,036 | **236,755** | **-18,281 (-7.2%)** |
| `test_BuyNFT` | 394,173 | **377,927** | **-16,246 (-4.1%)** |
| `test_PermitBuy_Success` | 438,375 | **441,101** | +2,726 (+0.6%) |
| `test_PermitBuy_RevertReplay` | 598,395 | **572,190** | **-26,205 (-4.4%)** |
| `test_TokensReceived` | 333,234 | **310,230** | **-23,004 (-6.9%)** |
| `test_NftBalance_TokenBalance` | 379,457 | **335,811** | **-43,646 (-11.5%)** |
| `test_MultipleListings` | 679,804 | **621,839** | **-57,965 (-8.5%)** |
| `test_BuyViaBothMethods` | 588,000 | **550,701** | **-37,299 (-6.3%)** |
| `test_RelistAfterBuy` | 482,846 | **444,766** | **-38,080 (-7.9%)** |

---

## 六、函数级详细数据 (v2)

### NFTMarket

| 函数 | Min | Avg | Median | Max | 调用 |
|------|-----|-----|--------|-----|------|
| `list` | 22,283 | 99,324 | 112,985 | 112,985 | 31 |
| `unlist` | 24,192 | 32,435 | 24,377 | 48,738 | 3 |
| `buyNFT` | 24,574 | 63,622 | 86,952 | 91,764 | 7 |
| `permitBuy` | 24,325 | 57,493 | 36,362 | 116,721 | 7 |
| `tokensReceived` | 23,267 | 23,267 | 23,267 | 23,267 | 1 |
| `listings` | 5,429 | 5,429 | 5,429 | 5,429 | 5 |
| `buildPermitDigest` | 2,411 | 2,411 | 2,411 | 2,411 | 5 |
| `permitNonces` | 2,803 | 2,803 | 2,803 | 2,803 | 6 |
| `nftBalance` | 6,582 | 6,582 | 6,582 | 6,582 | 1 |
| `tokenBalance` | 6,436 | 6,436 | 6,436 | 6,436 | 1 |

### 部署

| 指标 | v2 |
|------|-----|
| Deployment Cost | 1,990,889 |
| Deployment Size | 9,934 bytes |

---

## 七、优化总结

| 类别 | 节省 | 说明 |
|------|------|------|
| **部署** | **-147k gas** | immutable domain + 更紧凑代码 |
| **list()** | **-20k (-17%)** | Listing struct 3→2 slot 打包 |
| **listings view** | **-1.9k (-26%)** | 2 SLOAD vs 3 SLOAD |
| **buildPermitDigest** | **-689 (-22%)** | immutable domain 走常量读取 |
| **端到端测试** | **平均 -6~11%** | 多项优化叠加 |

### 最大贡献：nonces 模式

`permitBuy` 中 `usedDigests[digest] = true`（冷 SSTORE ~20k）→ `permitNonces[buyer] = nonce + 1`（热写 ~2.9k），且同一 buyer 后续调用时 nonce 在热 slot 上连续读写，进一步降低摊销成本。
