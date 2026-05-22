# Foundry 测试最佳实践 & 部署规范流程

> 适用版本: Foundry 0.2+ | Solidity ^0.8.25 | forge-std

---

## 目录

1. [测试文件中的账号加载](#1-测试文件中的账号加载)
2. [作弊码保存部署地址](#2-作弊码保存部署地址)
3. [.env 配置网络节点 URL](#3-env-配置)
4. [foundry.toml 配置节点](#4-foundrytoml-配置)
5. [完整的部署上线流程](#5-完整部署上线流程)
6. [常用命令速查](#6-常用命令速查)

---

## 1. 测试文件中的账号加载

### 1.1 三种账号创建方式对比

| 方式 | 代码 | 优点 | 适用场景 |
|------|------|------|----------|
| **makeAddr** | `makeAddr("alice")` | 确定性地址、可读性强、零成本 | 90% 的测试场景 |
| **createWallet** | `vm.createWallet("alice")` | 返回完整 Wallet 结构体（含私钥） | 需要签名的测试 |
| **硬编码私钥** | `vm.addr(pk)` | 完全控制私钥来源 | 从 .env / keystore 加载 |

### 1.2 推荐模式

```solidity
contract NFTMarketTest is Test {
    // 使用 makeAddr 创建确定性地址
    address public owner;
    address public alice;
    address public bob;

    // 从私钥加载（用于签名测试）
    uint256 public deployerPK;
    address public deployer;

    function setUp() public {
        // 1. makeAddr — 根据字符串生成确定性地址
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob   = makeAddr("bob");

        // 2. 从环境变量或默认私钥加载
        string memory pkStr = vm.envOr("TEST_PRIVATE_KEY", string(""));
        if (bytes(pkStr).length > 0) {
            deployerPK = vm.parseUint(pkStr);
        } else {
            // Anvil 默认测试私钥 #1
            deployerPK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        }
        deployer = vm.addr(deployerPK);

        // 3. 打标签 — forge test -vvvv 时显示名称而非 0x 地址
        vm.label(owner,    "owner");
        vm.label(alice,    "alice");
        vm.label(bob,      "bob");
        vm.label(deployer, "deployer");

        // 4. 分配测试 ETH
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
    }
}
```

### 1.3 createWallet 用法（需要签名的场景）

```solidity
function test_CreateWallet_Demo() public {
    // 一行创建带私钥的钱包
    Vm.Wallet memory charlie = vm.createWallet("charlie");
    vm.label(charlie.addr, "charlie");
    vm.deal(charlie.addr, 10 ether);

    // charlie 有真实私钥，可以进行签名
    bytes32 digest = keccak256("message");
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(charlie.privateKey, digest);
    address recovered = ecrecover(digest, v, r, s);
    assertEq(recovered, charlie.addr);
}
```

### 1.4 最佳实践总结

- **永远不要** 在测试中使用 `address(0x1)`、`address(0x2)` 这种魔法数字
- **优先使用** `makeAddr("descriptive-name")` — 名称有意义，输出可追踪
- **打标签** — `vm.label()` 让 `-vvvv` 输出清晰可读
- **需要签名时** — 使用 `vm.createWallet` 或从环境变量加载私钥
- **始终分配 ETH** — `vm.deal()` 确保测试账号有 gas

---

## 2. 作弊码保存部署地址

### 2.1 核心 API

| 作弊码 | 用途 |
|--------|------|
| `vm.writeJson(json, path)` | 写入 JSON 文件 |
| `vm.readFile(path)` | 读取文件内容 |
| `vm.serializeString(json, key, value)` | 向 JSON 添加字符串字段 |
| `vm.serializeUint(json, key, value)` | 向 JSON 添加数字字段 |
| `vm.toString(address)` | 将 address 转为字符串 |
| `vm.exists(path)` | 检查路径是否存在 |
| `vm.createDir(dir, recursive)` | 创建目录 |

### 2.2 部署脚本中的地址保存模式

```solidity
function _saveDeployment(
    string memory network,
    address token,
    address nft,
    address market
) internal {
    // 确保目录存在
    string memory dir = "deployments";
    if (!vm.exists(dir)) {
        vm.createDir(dir, true);
    }

    string memory path = string.concat(dir, "/", network, ".json");
    string memory json;

    // 如果文件已存在，读取并合并（避免覆盖其他部署的地址）
    if (vm.exists(path)) {
        json = vm.readFile(path);
    }

    vm.serializeString(json, "MyToken",   vm.toString(token));
    vm.serializeString(json, "MyNFT",     vm.toString(nft));
    vm.serializeString(json, "NFTMarket", vm.toString(market));
    vm.serializeUint(json,   "chainId",   block.chainid);
    string memory output = vm.serializeString(json, "network", network);
    vm.writeJson(output, path);
}
```

### 2.3 输出结果示例

部署后生成 `deployments/sepolia.json`:

```json
{
  "MyToken": "0x1234...",
  "MyNFT": "0x5678...",
  "NFTMarket": "0x9abc...",
  "chainId": 11155111,
  "network": "sepolia"
}
```

### 2.4 在测试/脚本中读取已部署地址

```solidity
string memory json = vm.readFile("deployments/sepolia.json");
address marketAddr = vm.parseJsonAddress(json, ".NFTMarket");
NFTMarket market = NFTMarket(marketAddr);
```

---

## 3. .env 配置

### 3.1 完整的 .env 模板

```bash
# ========== RPC Endpoints ==========
# 使用自己的 RPC URL 替换公共节点以获得更好性能
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
MAINNET_RPC_URL=https://virginia.rpc.blxrbdn.com

# ========== Etherscan API Key ==========
# 用于 forge verify-contract
# 获取地址: https://etherscan.io/myapikey
ETHERSCAN_API_KEY=YOUR_KEY_HERE

# ========== Deployer Private Key ==========
# 部署合约时需要（建议使用 keystore 替代明文私钥）
# forge script ... --private-key $PRIVATE_KEY
# 或更安全: forge script ... --keystore ~/.foundry/keystores/my-key
PRIVATE_KEY=

# ========== 可选 ==========
TEST_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### 3.2 安全须知

- `.env` 文件必须加入 `.gitignore`，**绝对不能提交到仓库**
- 生产私钥使用 `--keystore` 或 `--interactive` 输入，不要写入 .env
- 公共 RPC URL 可以直接写在 foundry.toml 中，不需要通过 .env
- 如果需要团队共享配置模板，创建 `.env.example`（不含真实密钥）

### 3.3 eth-reserve 保护

Foundry 会在每次脚本执行后检查 ETH 余额变化，如果发现余额减少会发出警告：

```
Warning: ETH balance of <address> decreased by X.XX ETH
```

部署预期有 gas 消耗，这是正常的。可以通过 `--skip` 跳过余额检查（不推荐），或在 foundry.toml 中配置 eth-reserve。

---

## 4. foundry.toml 配置

### 4.1 推荐配置详解

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.25"
remappings = [
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
    "forge-std/=lib/forge-std/src/"
]

# ---- 文件系统权限 ----
# 允许脚本写入 deployments/ 目录（保存部署地址）
# 允许读取 deployments/ 目录（其他脚本/测试引用已部署地址）
fs_permissions = [
    { access = "read-write", path = "./deployments/" }
]

# ---- RPC 节点配置 ----
# 引用 .env 中的变量，格式: "${ENV_VAR}"
# forge script 使用 --rpc-url sepolia 选择节点
[rpc_endpoints]
sepolia = "${SEPOLIA_RPC_URL}"
mainnet = "${MAINNET_RPC_URL}"

# ---- Etherscan 验证配置 ----
# forge script ... --broadcast --verify
[etherscan]
sepolia = { key = "${ETHERSCAN_API_KEY}", url = "https://api-sepolia.etherscan.io/api" }
mainnet = { key = "${ETHERSCAN_API_KEY}" }
```

### 4.2 多链 / 多环境 Profile 配置（进阶）

```toml
[profile.default]
# ... 基础配置 ...

[profile.ci]
# CI 环境中 Fuzz 运行次数更多
fuzz = { runs = 10000 }
# 显示更详细的输出
verbosity = 3

[profile.production]
# 生产环境使用更严格的优化
optimizer = true
optimizer_runs = 200
# 强制使用 via-IR 编译管线（某些新特性的要求）
via_ir = true
```

使用时通过 `FOUNDRY_PROFILE` 环境变量切换：

```bash
FOUNDRY_PROFILE=ci forge test
FOUNDRY_PROFILE=production forge build
```

### 4.3 关键配置项说明

| 配置项 | 说明 | 推荐值 |
|--------|------|--------|
| `solc` | Solidity 编译器版本 | 与合约 pragma 一致 |
| `fs_permissions` | 文件系统读写权限 | 仅开放必要的目录 |
| `rpc_endpoints` | 网络 RPC URL 别名 | 通过 .env 注入 |
| `etherscan` | 合约验证 API Key | 通过 .env 注入 |
| `optimizer` | 是否开启优化器 | 生产 true，开发 false |
| `optimizer_runs` | 优化器运行次数 | 通常 200-1000 |
| `via_ir` | 使用 IR 编译管线 | 复杂合约可能需要 |
| `fuzz.runs` | Fuzz 测试运行次数 | 默认 256，CI 可设 10000 |

---

## 5. 完整部署上线流程

### 5.1 流程图

```
本地开发 & 测试
    │
    ├── forge test              # 跑所有测试
    ├── forge test -vvvv        # 失败的测试看详细 trace
    ├── forge coverage          # 检查覆盖率
    │
    ▼
本地 Fork 模拟部署
    │
    ├── anvil --fork-url $SEPOLIA_RPC_URL    # 启动 Fork 节点
    ├── forge script ... --rpc-url http://localhost:8545 --broadcast
    ├── 在 Fork 上手动测试交互
    │
    ▼
测试网部署 (Sepolia)
    │
    ├── forge script ... --rpc-url sepolia --broadcast --verify
    ├── 检查 Etherscan 验证结果
    ├── 在 OpenSea Testnets 上查看 NFT
    ├── 前端对接测试
    │
    ▼
安全审计（可选）
    │
    ├── Slither / Aderyn 静态分析
    ├── 第三方审计
    │
    ▼
主网部署
    │
    ├── forge script ... --rpc-url mainnet --broadcast --verify
    ├── 确认 Etherscan 验证
    ├── 开源合约代码
    └── 前端上线
```

### 5.2 本地测试阶段

```bash
# 跑所有测试
forge test

# 详细输出（显示所有 logs）
forge test -vv

# 失败时显示堆栈追踪
forge test -vvvv

# 高轮次 Fuzz 测试
forge test --fuzz-runs 10000

# Gas 报告
forge test --gas-report

# 测试覆盖率
forge coverage
forge coverage --report lcov
```

### 5.3 本地 Fork 模拟部署

```bash
# 1. 启动 Fork 节点（模拟 sepolia 环境）
anvil --fork-url $SEPOLIA_RPC_URL --chain-id 11155111

# 2. 在另一个终端执行模拟部署
forge script script/DeployNFTMarket.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# 3. 使用 cast 在 Fork 上手动测试
cast call <MARKET_ADDR> "nftBalance()(uint256)" --rpc-url http://localhost:8545
```

### 5.4 测试网部署 (Sepolia)

```bash
# 完整部署 + 验证命令
forge script script/DeployNFTMarket.s.sol \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  --private-key $PRIVATE_KEY \
  --etherscan-api-key $ETHERSCAN_API_KEY

# 部署完成后，地址保存在 deployments/sepolia.json
cat deployments/sepolia.json
```

### 5.5 仅部署单个合约

```bash
# 仅部署 MyNFT
forge script script/DeployMyNFT.s.sol \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  --private-key $PRIVATE_KEY
```

### 5.6 主网部署 (Mainnet)

```bash
# 主网部署（建议使用 keystore 而非明文私钥）
forge script script/DeployNFTMarket.s.sol \
  --rpc-url mainnet \
  --broadcast \
  --verify \
  --keystore ~/.foundry/keystores/deployer \
  --etherscan-api-key $ETHERSCAN_API_KEY

# 部署完成后，地址保存在 deployments/mainnet.json
```

### 5.7 如果验证失败

```bash
# 手动验证已部署的合约
forge verify-contract \
  --rpc-url sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --compiler-version 0.8.25 \
  --constructor-args $(cast abi-encode "constructor(address,address)" $NFT_ADDR $TOKEN_ADDR) \
  0x<CONTRACT_ADDRESS> \
  src/NFTMarket.sol:NFTMarket
```

### 5.8 部署后检查清单

- [ ] `forge test` 全部通过
- [ ] `forge coverage` 核心逻辑覆盖率 > 80%
- [ ] Etherscan 合约验证通过（绿色勾）
- [ ] 部署地址已写入 `deployments/<network>.json`
- [ ] 在 Etherscan 上手动调用关键函数验证
- [ ] 前端对接测试通过
- [ ] (主网) 多签钱包确认
- [ ] (主网) 开源合约代码

---

## 6. 常用命令速查

### 6.1 测试相关

```bash
forge test                                    # 运行所有测试
forge test --match-test test_List             # 运行名称匹配的测试
forge test --match-contract NFTMarketTest     # 运行指定合约的测试
forge test -vvvv                              # 显示完整 trace（调试用）
forge test --gas-report                       # 输出 Gas 消耗报告
forge test --fuzz-runs 5000                   # 增加 Fuzz 轮次
forge test --fork-url $SEPOLIA_RPC_URL        # Fork 网络测试
```

### 6.2 脚本 / 部署

```bash
forge script script/DeployNFTMarket.s.sol     # 模拟运行（不广播）
forge script ... --broadcast                  # 实际广播交易
forge script ... --verify                     # 部署后自动验证
forge script ... --resume                     # 从中断处恢复
forge script ... -vvvv                        # 详细输出
```

### 6.3 Cast 交互

```bash
cast wallet address $PRIVATE_KEY              # 从私钥获取地址
cast call <ADDR> "balanceOf(address)" $WHO    # 调用只读函数
cast send <ADDR> "transfer(address,uint256)" $TO 100 --private-key $PK  # 发送交易
cast --to-wei 1 ether                         # 单位转换
cast --from-wei 1000000000000000000           # 反过来
```

### 6.4 工具

```bash
forge inspect <CONTRACT> methods              # 查看合约方法
forge inspect <CONTRACT> storage-layout       # 查看存储布局
forge clean                                   # 清理编译产物
forge update                                  # 更新依赖
forge fmt                                     # 格式化 Solidity 代码
```

---

## 附录: 本项目文件结构

```
nft-project/
├── .env                          # 环境变量（RPC URL、API Key、私钥）
├── .gitignore                    # 忽略 .env 和 deployments/
├── foundry.toml                  # Foundry 配置（节点、验证器、权限）
├── src/
│   ├── MyToken.sol               # ERC20 代币
│   ├── MyNFT.sol                 # ERC721 NFT
│   ├── NFTMarket.sol             # NFT 市场（ERC20 支付 + tokensReceived 回调）
│   └── interfaces/
│       └── ITokenReceiver.sol    # 代币接收回调接口
├── script/
│   ├── DeployMyNFT.s.sol         # 单独部署 MyNFT
│   └── DeployNFTMarket.s.sol     # 一键部署全套合约
├── test/
│   └── NFTMarket.t.sol           # 测试文件（覆盖 Token、Market、回调）
└── deployments/                  # 部署地址存档（自动生成，加入 .gitignore）
    ├── sepolia.json
    └── mainnet.json
```
