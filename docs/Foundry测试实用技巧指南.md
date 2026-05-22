# Foundry 测试实用技巧完全指南

> 适用: Foundry 0.2+ | Solidity ^0.8.x | forge-std

---

## 目录

1. [账号管理](#1-账号管理)
2. [身份模拟 (Prank)](#2-身份模拟-prank)
3. [ETH & 余额操作](#3-eth--余额操作)
4. [断言大全](#4-断言大全)
5. [Expect: 预期 revert / emit / call](#5-expect-预期-revert--emit--call)
6. [时间 & 区块操控](#6-时间--区块操控)
7. [签名测试](#7-签名测试)
8. [Fuzz 测试 (属性测试)](#8-fuzz-测试-属性测试)
9. [Invariant 测试 (不变量测试)](#9-invariant-测试-不变量测试)
10. [Fork 测试 (分叉测试)](#10-fork-测试-分叉测试)
11. [Gas 分析](#11-gas-分析)
12. [文件操作 (作弊码 JSON 读写)](#12-文件操作-作弊码-json-读写)
13. [调试技巧](#13-调试技巧)
14. [Differential 测试 (对比测试)](#14-differential-测试-对比测试)
15. [最佳实践清单](#15-最佳实践清单)

---

## 1. 账号管理

### 1.1 创建测试账号的三种方式

```solidity
contract AccountDemo is Test {
    // 方式1: makeAddr — 最常用，根据字符串生成确定性地址
    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    // 方式2: createWallet — 返回完整钱包（地址 + 公钥 + 私钥）
    //         适用于需要签名的场景
    Vm.Wallet memory charlie;

    // 方式3: 从已知私钥派生
    uint256 constant ANVIL_KEY_1 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address deployer;

    function setUp() public {
        // makeAddr 是纯函数，可以在 setUp 或直接初始化
        // 此时 alice, bob 已经是 makeAddr("alice"), makeAddr("bob")

        // createWallet 不是纯函数，只能在函数内调用
        charlie = vm.createWallet("charlie");

        // 从私钥派生
        deployer = vm.addr(ANVIL_KEY_1);

        // 打标签 — forge test -vvvv 时显示名称
        vm.label(alice,    "alice");
        vm.label(bob,      "bob");
        vm.label(charlie.addr, "charlie");
        vm.label(deployer, "deployer");
    }
}
```

### 1.2 三种方式对比

| 方式 | 确定性 | 有私钥 | 适用场景 |
|------|--------|--------|----------|
| `makeAddr("name")` | 是 | 否 | 90% 的测试：挂单、转账、授权 |
| `vm.createWallet("name")` | 是 | 是 | 需要签名的测试 (EIP-712, permit) |
| `vm.addr(privateKey)` | 是 | 是 | 从 .env 或 keystore 加载真实账号 |

### 1.3 给账号充值 ETH

```solidity
// 基础充值
vm.deal(alice, 100 ether);

// hoax: deal + prank 二合一（充值并模拟身份）
vm.hoax(alice, 10 ether);  // 从 alice 发起下一次调用，同时给她 10 ETH
```

---

## 2. 身份模拟 (Prank)

### 2.1 三种形式

```solidity
// 单次调用
vm.prank(alice);
contract.someFunction();

// 连续多次调用
vm.startPrank(alice);
contract.functionA();
contract.functionB();
vm.stopPrank();

// 带 ETH 的模拟
vm.prank(alice);
// alice 的 msg.value = 0

vm.deal(alice, 5 ether);
vm.prank(alice);
// alice 有余额，但 msg.value 仍为 0

// 发送 ETH 的 prank（用 hoax 或手动构造）
vm.hoax(alice, 5 ether);  // = deal + prank
// 下一次调用的 msg.value 仍为 0，但 alice 有 5 ETH
```

### 2.2 带 msg.value 的调用

> prank/hoax 只设置 `msg.sender`，不设置 `msg.value`。

```solidity
// 错误: msg.value 仍然是 0
vm.prank(alice);
payableContract.deposit{value: 1 ether}();  // alice 没有 ETH

// 正确: 先充值
vm.deal(alice, 1 ether);
vm.prank(alice);
payableContract.deposit{value: 1 ether}();
```

---

## 3. ETH & 余额操作

```solidity
contract BalanceDemo is Test {
    function test_BalanceManipulation() public {
        address user = makeAddr("user");

        // 设置余额
        vm.deal(user, 100 ether);
        assertEq(user.balance, 100 ether);

        // 读取余额
        uint256 bal = user.balance;

        // 清空余额
        vm.deal(user, 0);

        // 设置合约余额（测试 fallback/receive）
        vm.deal(address(contractAddr), 50 ether);
    }
}
```

---

## 4. 断言大全

```solidity
contract AssertionDemo is Test {
    function test_AllAssertions() public {
        // ---- 相等 ----
        assertEq(a, b);             // a == b
        assertEq(a, b, "my msg");   // 带错误信息
        assertNotEq(a, b);

        // ---- 布尔 ----
        assertTrue(condition);
        assertFalse(condition);

        // ---- 大小比较 ----
        assertGt(a, b);   // a > b
        assertGe(a, b);   // a >= b
        assertLt(a, b);   // a < b
        assertLe(a, b);   // a <= b

        // ---- 近似相等（用于精度敏感的计算） ----
        assertApproxEqAbs(a, b, 1e18);     // |a - b| <= 1e18
        assertApproxEqRel(a, b, 0.01e18);  // 相对误差 <= 1%

        // ---- 地址/字节 ----
        assertEq(address(a), address(b));

        // ---- 数组 ----
        uint256[] memory arr1;
        uint256[] memory arr2;
        assertEq(arr1, arr2);   // 深度比较

        // ---- 强制失败 ----
        fail("should not reach here");
    }
}
```

---

## 5. Expect: 预期 revert / emit / call

### 5.1 expectRevert — 预期回滚

```solidity
contract ExpectRevertDemo is Test {
    // 精确匹配 revert 消息
    function test_RevertWithMessage() public {
        vm.expectRevert("not owner");
        contract.restrictedFunction();
    }

    // 匹配部分 revert 消息（不需要完整字符串）
    function test_RevertPartialMatch() public {
        vm.expectRevert(bytes("not owner"));
        contract.restrictedFunction();
    }

    // 匹配自定义错误
    function test_RevertWithCustomError() public {
        vm.expectRevert(MyContract.Unauthorized.selector);
        contract.restrictedFunction();
    }

    // 带参数的自定义错误
    function test_RevertWithCustomErrorArgs() public {
        vm.expectRevert(
            abi.encodeWithSelector(MyContract.Insufficient.selector, 100, 50)
        );
        contract.withdraw(100);
    }

    // 不关心具体原因，只要 revert 就行
    function test_RevertAny() public {
        vm.expectRevert();
        contract.thisWillFail();
    }

    // ⚠️ 关键: expectRevert 只检查最近一次外部调用
    // 以下示例中，只有 token.transfer 的回滚被检查
    function test_OnlyLastCall() public {
        vm.startPrank(alice);
        nft.approve(address(market), tokenId);  // ← 不受 expectRevert 影响
        vm.stopPrank();

        vm.expectRevert("not listed");
        vm.prank(bob);
        market.buyNFT(99, PRICE);  // ← 只有这个被检查
    }
}
```

### 5.2 expectEmit — 预期事件

```solidity
contract ExpectEmitDemo is Test {
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);

    function test_ExpectEmit() public {
        // 关键步骤顺序:
        // 1. expectEmit — 声明预期
        // 2. emit — 手动发出相同的事件（告诉 Foundry 要匹配什么）
        // 3. 实际调用

        // 检查所有 indexed 参数 + 非 indexed 数据
        vm.expectEmit(true, true, true, true);
        emit Listed(0, alice, PRICE);
        market.list(0, PRICE);

        // 只检查 indexed 参数（不检查 data）
        vm.expectEmit(true, true, false, false);
        emit Listed(0, alice, 0);  // price 随便填，反正不检查
        market.list(0, PRICE);

        // 只检查 topic[0]（事件签名），不检查任何参数
        vm.expectEmit(false, false, false, false);
        emit Listed(0, address(0), 0);
        market.list(0, PRICE);
    }
}
```

### 5.3 expectCall — 预期调用

```solidity
function test_ExpectCall() public {
    // 验证某个地址的某个函数是否被调用
    vm.expectCall(
        address(token),
        abi.encodeWithSelector(IERC20.transfer.selector, alice, 100 ether)
    );
    market.buyNFT(0, PRICE);  // 内部会调用 token.transfer(alice, ...)
}
```

---

## 6. 时间 & 区块操控

```solidity
contract TimeDemo is Test {
    function test_TimeManipulation() public {
        // === warp: 跳跃时间 ===
        vm.warp(1_000_000);            // 设置 block.timestamp 为具体值
        vm.warp(block.timestamp + 7 days); // 时间快进 7 天

        // === roll: 跳跃区块号 ===
        vm.roll(5_000_000);            // 设置 block.number
        vm.roll(block.number + 100);   // 快进 100 个区块

        // === fee: 设置 gas 费用 ===
        vm.fee(100 gwei);              // 设置 basefee
        vm.txGasPrice(200 gwei);       // 设置 gas price

        // === 实用场景: 时间锁测试 ===
        vm.warp(block.timestamp + 31 days);
        vault.unlock();  // 30 天锁定期后才能调用
    }

    function test_VestingSchedule() public {
        // 部署时 cliff = 1 year
        vm.warp(block.timestamp + 365 days);
        // 现在可以提取
        vm.prank(beneficiary);
        vesting.release();
    }
}
```

---

## 7. 签名测试

### 7.1 基础签名

```solidity
contract SignDemo is Test {
    function test_SignAndRecover() public {
        uint256 pk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address signer = vm.addr(pk);

        // 签名
        bytes32 digest = keccak256("hello");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        // 恢复
        address recovered = ecrecover(digest, v, r, s);
        assertEq(recovered, signer);
    }
}
```

### 7.2 EIP-712 签名测试

```solidity
contract EIP712Demo is Test {
    function test_Permit() public {
        address owner = makeAddr("owner");
        uint256 ownerPK = 0x1234...;
        address spender = makeAddr("spender");

        vm.prank(owner);
        token.approve(spender, 0);  // 先用传统方式

        // 构造 EIP-712 permit 签名
        // ...使用你的 EIP-712 库来生成 digest...

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPK, digest);
        vm.prank(spender);
        token.permit(owner, spender, amount, deadline, v, r, s);
    }
}
```

---

## 8. Fuzz 测试 (属性测试)

### 8.1 基础 Fuzz

```solidity
contract FuzzDemo is Test {
    // testFuzz_ 前缀 → Foundry 自动对参数进行模糊测试
    // 默认 256 次随机输入
    function testFuzz_Transfer(uint256 amount) public {
        // 使用 vm.assume 过滤不合理输入
        vm.assume(amount > 0);
        vm.assume(amount <= token.balanceOf(alice));

        vm.prank(alice);
        token.transfer(bob, amount);

        assertEq(token.balanceOf(bob), amount);
        assertEq(token.balanceOf(alice), INITIAL - amount);
    }

    // 多个参数的 Fuzz
    function testFuzz_ListAndBuy(uint256 price, uint256 buyAmount) public {
        vm.assume(price > 0 && price < 1_000_000 ether);
        vm.assume(buyAmount == price);  // 精确匹配的约束
        // ...
    }
}
```

### 8.2 约束参数范围

```solidity
contract BoundedFuzz is Test {
    function testFuzz_BoundedPrice(
        uint256 price  // Foundry 自动注入 [0, type(uint256).max] 的值
    ) public {
        // 方式1: vm.assume 过滤
        vm.assume(price >= 0.01 ether && price <= 1000 ether);

        // 方式2: bound 函数（更高效，不会浪费 fuzz 运行次数）
        price = bound(price, 0.01 ether, 1000 ether);

        // bound 优于 assume — assume 如果过滤掉值会重试，浪费 fuzz 次数；
        // bound 直接映射到范围内，不会丢弃运行
    }
}
```

### 8.3 排除特定地址

```solidity
function testFuzz_ExcludeAddresses(address caller) public {
    vm.assume(caller != address(0));
    vm.assume(caller != address(this));
    vm.assume(caller != address(token));
    // ... 现在 caller 是安全的非零非合约地址
}
```

### 8.4 Fuzz 配置

```bash
# 增加 Fuzz 运行次数（默认 256）
forge test --fuzz-runs 10000

# 只运行 Fuzz 测试
forge test --match-test testFuzz

# 在 foundry.toml 中配置
# [profile.default]
# fuzz = { runs = 5000, max_test_rejects = 65536 }
```

---

## 9. Invariant 测试 (不变量测试)

### 9.1 什么是 Invariant 测试

不变量测试是 Fuzz 测试的进阶形式。Foundry 会随机调用合约的函数序列，验证某个"不变量"始终成立。

### 9.2 编写 Invariant 测试

```solidity
// 合约中定义不变量检查器
contract MarketInvariants is Test {
    NFTMarket market;
    MyToken token;
    MyNFT nft;

    function setUp() public {
        token = new MyToken();
        nft = new MyNFT();
        market = new NFTMarket(address(nft), address(token));
        // 给多个账号充值、授权...
    }

    // invariant_ 前缀 → Foundry 自动识别为不变量测试
    function invariant_MarketNeverHoldsUserTokens() public {
        // 市场的 token 余额应该始终 <= 某个合理范围
        // 因为转账后 token 应该立即转给卖家
        assertLe(
            token.balanceOf(address(market)),
            0,  // 市场合约不应持有任何 ERC20
            "market holds tokens!"
        );
    }

    function invariant_ListingsAreValid() public {
        // 每个活跃 listing 的 NFT 必须由市场合约持有
        // ...具体检查逻辑
    }
}

// 配合 Handler（target contract）使用
contract MarketHandler is Test {
    NFTMarket market;
    // 定义允许被随机调用的函数...
    // Foundry 会随机调用 handler 中的函数来尝试破坏 invariant
}
```

### 9.3 运行 Invariant 测试

```bash
forge test --match-test invariant -vvvv
# depth: 每次序列调用多少次函数
# runs:  多少组不同的随机序列
forge test --match-test invariant --invariant-depth 50 --invariant-runs 200
```

---

## 10. Fork 测试 (分叉测试)

### 10.1 基础 Fork 测试

Fork 测试让你在真实链的状态上运行测试，适合：
- 测试对已部署合约的交互（Uniswap、AAVE 等）
- 复现链上 bug
- 在真实环境中验证迁移/升级

```solidity
contract ForkDemo is Test {
    // 在 setUp 中创建 fork
    function setUp() public {
        // 创建 Sepolia fork
        uint256 forkId = vm.createFork("sepolia");  // 使用 foundry.toml 中的别名
        vm.selectFork(forkId);

        // 或者一行: vm.createSelectFork("sepolia");
        // 或者指定区块: vm.createSelectFork("sepolia", 6_500_000);
    }

    function test_InteractWithUniswap() public {
        // 现在可以直接调用 sepolia 上的 Uniswap 合约
        // 所有状态来自 fork 时的 sepolia 快照
        IUniswapV2Router router = IUniswapV2Router(UNISWAP_ROUTER_ADDR);
        // ...
    }
}
```

### 10.2 多 Fork 场景

```solidity
contract MultiForkDemo is Test {
    uint256 sepoliaFork;
    uint256 mainnetFork;

    function setUp() public {
        sepoliaFork = vm.createFork("sepolia");
        mainnetFork = vm.createFork("mainnet");
    }

    function test_CrossChainArbitrage() public {
        vm.selectFork(sepoliaFork);
        uint256 priceOnSepolia = oracle.getPrice("ETH");

        vm.selectFork(mainnetFork);
        uint256 priceOnMainnet = oracle.getPrice("ETH");

        // 比较价差...
    }
}
```

### 10.3 Fork 特定区块 & 作弊

```solidity
function test_ForkSpecificBlock() public {
    // Fork 特定区块（用于复现攻击、精确验证状态）
    vm.createSelectFork("mainnet", 17_000_000);

    // Fork 后仍然可以作弊
    vm.deal(alice, 1000 ether);
    vm.prank(alice);

    // 所有 fork 操作是独立的，不影响真实链
}
```

### 10.4 Fork 缓存

```bash
# 启用 fork 缓存（加速重复测试）
forge test --fork-url $SEPOLIA_RPC_URL --fork-block-number 6500000

# foundry.toml
# [profile.default]
# fork_block_number = 6500000
```

---

## 11. Gas 分析

### 11.1 Gas 报告

```bash
# 生成 gas 报告
forge test --gas-report

# 输出到文件
forge test --gas-report > gas-report.txt

# 按函数名匹配
forge test --match-test test_List --gas-report
```

### 11.2 快照测试 (Snapshot)

```solidity
contract GasSnapshotDemo is Test {
    function test_GasOptimization() public {
        // 对比优化前后的 gas
        uint256 gasBefore = gasleft();
        market.buyNFT(0, PRICE);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("buyNFT gas used:", gasUsed);
        // 优化代码后，再次运行，对比 gasUsed 的变化
    }

    // 使用 vm.snapshotGasLastCall (Foundry 内置)
    function test_GasSnapshot() public {
        market.list(0, PRICE);
        // 在 --gas-report 中会单独列出这次调用
        vm.snapshotGasLastCall("list");
    }
}
```

### 11.3 Gas Golf 技巧

```solidity
// 对比不同实现的 gas 消耗
function test_GasComparison() public {
    // 实现 A
    uint256 g0 = gasleft();
    contract.methodA();
    uint256 gasA = g0 - gasleft();

    // 实现 B
    uint256 g1 = gasleft();
    contract.methodB();
    uint256 gasB = g1 - gasleft();

    assertLt(gasB, gasA, "implementation B should be cheaper");
}
```

---

## 12. 文件操作 (作弊码 JSON 读写)

### 12.1 基础文件操作

```solidity
contract FileOpsDemo is Test {
    function test_ReadAndWrite() public {
        // 需要在 foundry.toml 中配置 fs_permissions
        // fs_permissions = [{ access = "read-write", path = "./" }]

        // 写入文件
        vm.writeFile("output.txt", "hello foundry");

        // 读取文件
        string memory content = vm.readFile("output.txt");
        assertEq(content, "hello foundry");

        // 检查文件是否存在
        bool exists = vm.exists("output.txt");

        // 删除文件
        vm.removeFile("output.txt");
    }
}
```

### 12.2 JSON 操作（部署地址管理）

```solidity
contract JsonDemo is Test {
    function test_JsonOperations() public {
        string memory json;

        // 构建 JSON
        vm.serializeString(json, "name", "MyNFT");
        vm.serializeUint(json, "chainId", 11155111);
        string memory output = vm.serializeString(json, "version", "1.0.0");
        vm.writeJson(output, "deployments/sepolia.json");

        // 读取 JSON
        string memory raw = vm.readFile("deployments/sepolia.json");
        string memory name = vm.parseJsonString(raw, ".name");
        uint256 chainId = vm.parseJsonUint(raw, ".chainId");

        // 读取 JSON 数组
        // string[] memory arr = vm.parseJsonStringArray(raw, ".addresses");

        // 写入到目录（自动创建）
        vm.createDir("deployments", true);  // true = recursive
    }
}
```

### 12.3 .env 读取

```solidity
contract EnvDemo is Test {
    function test_ReadEnv() public {
        // 读取环境变量
        string memory rpc = vm.envString("SEPOLIA_RPC_URL");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        bool flag = vm.envBool("USE_MAINNET");

        // 带默认值
        string memory rpc2 = vm.envOr("RPC_URL", string("http://localhost:8545"));
        uint256 chainId = vm.envOr("CHAIN_ID", uint256(31337));
    }
}
```

---

## 13. 调试技巧

### 13.1 console.log 分级

```solidity
contract DebugDemo is Test {
    function test_DebugLevels() public {
        // 基础 log（总是显示在 -vv 及以上）
        console.log("price =", price);
        console.log("alice balance:", token.balanceOf(alice));
        console.logAddress(address(market));

        // logInt / logUint / logString 等单类型专用方法
        console.logUint(price);
        console.logString("hello");

        // 重放交易 trace
        // forge test -vvvv 可以看到完整的执行路径
    }
}
```

### 13.2 verbosity 等级

```bash
forge test                          # 只看结果
forge test -v                       # 显示每个测试的 PASS/FAIL
forge test -vv                      # 显示 console.log 输出
forge test -vvv                     # 显示失败测试的 stack trace
forge test -vvvv                    # 显示所有测试的 stack trace
forge test -vvvvv                   # 显示 stack trace + 内存状态
```

### 13.3 匹配特定测试

```bash
forge test --match-test test_List          # 精确匹配函数名
forge test --match-contract NFTMarketTest  # 匹配合约名
forge test --match-path test/NFTMarket     # 匹配文件路径

# 组合使用
forge test --match-contract NFTMarketTest --match-test test_List -vvvv
```

### 13.4 Debug 实战流程

```
1. forge test → 有失败
2. forge test --match-test <失败的测试名> -vvvv
3. 在 trace 中找 [Revert] 关键字
4. 在关键位置加 console.log 打印状态
5. 重新运行，观察日志输出
6. 修复 → 去掉 debug 日志 → 提交
```

---

## 14. Differential 测试 (对比测试)

Differential 测试将对同一逻辑的两种实现进行比较，确保行为一致。

```solidity
contract DifferentialDemo is Test {
    // 场景: 你的新数学库 vs OpenZeppelin 的数学库
    function testFuzz_MulDivDifferential(
        uint256 a,
        uint256 b,
        uint256 denominator
    ) public {
        vm.assume(denominator > 0);
        // 防止溢出
        a = bound(a, 0, type(uint128).max);
        b = bound(b, 0, type(uint128).max);

        // OZ 的实现
        uint256 expected = OZMath.mulDiv(a, b, denominator);

        // 你的实现
        uint256 actual = MyMath.mulDiv(a, b, denominator);

        assertEq(actual, expected, "implementation mismatch");
    }

    // 场景: 新旧合约升级前后对比
    function test_UpgradeParity() public {
        // 在旧合约上操作
        uint256 oldResult = oldContract.process(data);

        // 在新合约上用相同输入
        uint256 newResult = newContract.process(data);

        assertEq(newResult, oldResult, "upgrade broke parity");
    }
}
```

---

## 15. 最佳实践清单

### 15.1 测试命名规范

```solidity
// 推荐模式: test_<FunctionName>_<Scenario>[_<ExpectedBehavior>]
function test_List() public { }                    // 正常路径
function test_List_RevertNotOwner() public { }     // 非 owner 应 revert
function test_List_RevertPriceZero() public { }    // 价格为 0 应 revert
function test_List_RevertNotApproved() public { }   // 未授权应 revert
function testFuzz_List(uint256 price) public { }    // Fuzz 测试
```

### 15.2 测试文件结构

```solidity
contract MyContractTest is Test {
    // ============ 状态变量 ============
    MyContract public contract;
    address public owner;
    address public alice;

    // ============ 常量 ============
    uint256 constant PRICE = 1 ether;

    // ============ Setup ============
    function setUp() public {
        // 1. 创建账号
        // 2. 打标签
        // 3. 分配 ETH
        // 4. 部署合约
        // 5. 设置初始状态
    }

    // ============ 功能 A 测试 ============
    function test_A_NormalPath() public { }
    function test_A_RevertCondition() public { }
    function testFuzz_A(uint256 input) public { }

    // ============ 功能 B 测试 ============
    // ...

    // ============ 内部辅助函数 ============
    function _setupListing(address seller, uint256 tokenId, uint256 price) internal { }
}
```

### 15.3 测试原则

| 原则 | 说明 |
|------|------|
| 每个 revert 条件一个测试 | 不要在一个测试里验多个 revert |
| 正常路径 + 异常路径 | 每个功能至少测 happy path + 所有 failure mode |
| 测试边界值 | 0、最大值、空数据、空地址 |
| Fuzz 关键参数 | 数量、价格、地址等外部可控输入 |
| 保持测试独立 | 每个测试不依赖其他测试的状态 |
| 测试不应该有条件分支 | 如果测试里有 if/else，拆成两个测试 |

### 15.4 常见陷阱

```solidity
// ❌ 错误: expectRevert 放在被测试调用之后
contract.buy(0);
vm.expectRevert();  // 太晚了！

// ❌ 错误: expectRevert 会捕获所有子调用中的 revert
vm.expectRevert("not listed");
token.transfer(market, amount, data);
// 如果 token.transfer 先 revert（比如余额不足），expectRevert 也会匹配

// ✅ 正确: 确保只有目标 revert 被捕获
vm.expectRevert("not listed");
vm.prank(bob);  // bob 有足够余额
token.transfer(address(market), PRICE, data);
```

### 15.5 测试覆盖目标

```
核心业务逻辑: 100% 分支覆盖
边界条件:      每个函数至少 1 个边界测试
Access Control: 每个 role/条件至少 1 个拒绝测试
Fuzz:          所有用户可控的数值参数
Invariant:     状态一致性规则
Gas:           关键路径有 snapshot
```

---

## 附录: 速查表

### vm 作弊码速查

| 作弊码 | 签名 | 用途 |
|--------|------|------|
| `vm.prank` | `(address)` | 模拟单次调用 |
| `vm.startPrank` | `(address)` | 模拟连续调用 |
| `vm.stopPrank` | `()` | 结束模拟 |
| `vm.deal` | `(address, uint256)` | 设置 ETH 余额 |
| `vm.hoax` | `(address, uint256)` | deal + prank |
| `vm.warp` | `(uint256)` | 设置 block.timestamp |
| `vm.roll` | `(uint256)` | 设置 block.number |
| `vm.expectRevert` | `()` or `(bytes)` | 预期下一次调用 revert |
| `vm.expectEmit` | `(bool,bool,bool,bool)` | 预期事件 |
| `vm.expectCall` | `(address, bytes)` | 预期调用 |
| `vm.label` | `(address, string)` | 地址标签 |
| `vm.sign` | `(uint256, bytes32)` | 签名 |
| `vm.addr` | `(uint256)` | 私钥→地址 |
| `vm.createWallet` | `(string)` | 创建确定性钱包 |
| `vm.assume` | `(bool)` | Fuzz 输入过滤 |
| `vm.bound` | `(uint256,uint256,uint256)` | Fuzz 输入约束 |
| `vm.createFork` | `(string)` | 创建 Fork |
| `vm.selectFork` | `(uint256)` | 切换 Fork |
| `vm.writeFile` | `(string,string)` | 写文件 |
| `vm.readFile` | `(string)` | 读文件 |
| `vm.writeJson` | `(string,string)` | 写 JSON |
| `vm.envUint` | `(string)` | 读 uint 环境变量 |
| `vm.envOr` | `(string, T)` | 读环境变量（带默认值） |
| `vm.snapshotGasLastCall` | `(string)` | Gas 快照 |
