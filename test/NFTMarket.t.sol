// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Test.sol";
import "../src/MyToken.sol";
import "../src/MyNFT.sol";
import "../src/NFTMarket.sol";
import "../src/interfaces/ITokenReceiver.sol";

contract NFTMarketTest is Test {
    MyToken public token;
    MyNFT public nft;
    NFTMarket public market;

    // ---- 账号定义 ----
    // makeAddr(name) 根据 name 生成确定性地址，比 address(0x1) 更可读、可追溯
    address public owner;
    address public alice;
    address public bob;

    // 从私钥加载的账号（用于需要真实签名的测试场景）
    // Anvil 默认测试私钥 #1: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    uint256 public deployerPK;
    address public deployer;

    uint256 constant TOKEN_DECIMALS = 1e18;
    uint256 constant PRICE = 100 * TOKEN_DECIMALS;
    uint256 constant INITIAL_SUPPLY = 10_000 * TOKEN_DECIMALS;

    // ==================== Setup ====================

    function setUp() public {
        // 1. 使用 makeAddr 创建确定性测试地址
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // 2. 从私钥加载账号 — 支持 .env 覆盖或使用 Anvil 默认私钥
        // 从私钥加载账号（Anvil 默认测试私钥 #1，可通过 .env 中 TEST_PRIVATE_KEY 覆盖）
        string memory pkStr = vm.envOr("TEST_PRIVATE_KEY", string(""));
        if (bytes(pkStr).length > 0) {
            deployerPK = vm.parseUint(pkStr);
        } else {
            deployerPK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        }
        deployer = vm.addr(deployerPK);

        // 3. 给所有地址打标签 — 在 forge test -vvvv 输出中显示名称而非裸地址
        vm.label(owner, "owner");
        vm.label(alice, "alice");
        vm.label(bob, "bob");
        vm.label(deployer, "deployer");

        // 4. 给测试账号分配 ETH（支付 gas 费）
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(deployer, 100 ether);

        // 5. 部署合约
        token = new MyToken();
        nft = new MyNFT();
        market = new NFTMarket(address(nft), address(token));

        vm.label(address(token), "MyToken");
        vm.label(address(nft), "MyNFT");
        vm.label(address(market), "NFTMarket");

        // 6. 分发 Token 与 NFT
        require(token.transfer(alice, INITIAL_SUPPLY), "transfer alice");
        require(token.transfer(bob, INITIAL_SUPPLY), "transfer bob");

        string[3] memory uris = [
            "ipfs://token0",
            "ipfs://token1",
            "ipfs://token2"
        ];
        for (uint256 i = 0; i < 3; i++) {
            nft.mint(alice, uris[i]);
        }
    }

    // ==================== 账号与签名演示 ====================

    /// @notice 演示：使用私钥账号签名并恢复公钥（展示 makeAddr vs createWallet 的区别）
    function test_AccountFromPrivateKey_CanSign() public view {
        bytes32 digest = keccak256("hello foundry");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(deployerPK, digest);

        // ecrecover 恢复出的地址应该等于 vm.addr(deployerPK)
        address recovered = ecrecover(digest, v, r, s);
        assertEq(recovered, deployer);
    }

    /// @notice 演示：使用 vm.createWallet 一行创建带密钥的钱包
    function test_CreateWallet_Demo() public {
        // vm.createWallet 返回 Wallet 结构体：{ addr, publicKey, privateKey }
        Vm.Wallet memory charlie = vm.createWallet("charlie");
        vm.label(charlie.addr, "charlie");
        vm.deal(charlie.addr, 10 ether);

        // charlie 有真实的私钥，可以签名
        bytes32 digest = keccak256("charlie signed");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(charlie.privateKey, digest);
        address recovered = ecrecover(digest, v, r, s);
        assertEq(recovered, charlie.addr);
    }

    // ==================== MyToken ====================

    function test_MyToken_Mint() public view {
        assertEq(token.totalSupply(), 1_000_000 * TOKEN_DECIMALS);
        assertEq(token.balanceOf(alice), INITIAL_SUPPLY);
        assertEq(token.balanceOf(bob), INITIAL_SUPPLY);
    }

    function test_MyToken_TransferWithData_CallsTokensReceived() public {
        _listNFT(alice, 0, PRICE);

        uint256 bobBefore = token.balanceOf(bob);
        uint256 aliceBefore = token.balanceOf(alice);

        bytes memory data = abi.encode(uint256(0));
        vm.prank(bob);
        bool ok = token.transfer(address(market), PRICE, data);
        assertTrue(ok);

        assertEq(nft.ownerOf(0), bob);
        assertEq(token.balanceOf(bob), bobBefore - PRICE);
        assertEq(token.balanceOf(alice), aliceBefore + PRICE);
    }

    function test_MyToken_TransferWithData_RevertsWhenReceiverRejects() public {
        bytes memory data = abi.encode(uint256(99));
        vm.prank(bob);
        vm.expectRevert("not listed");
        token.transfer(address(market), PRICE, data);
    }

    // ==================== NFTMarket — list ====================

    function test_List() public {
        _listNFT(alice, 0, PRICE);

        (address seller, uint256 price, bool active) = market.listings(0);
        assertEq(seller, alice);
        assertEq(price, PRICE);
        assertTrue(active);
        assertEq(nft.ownerOf(0), address(market));
    }

    function test_List_RevertNotOwner() public {
        vm.prank(bob);
        vm.expectRevert("not owner");
        market.list(0, PRICE);
    }

    function test_List_RevertPriceZero() public {
        vm.prank(alice);
        vm.expectRevert("price must be > 0");
        market.list(0, 0);
    }

    function test_List_RevertNotApproved() public {
        vm.prank(alice);
        vm.expectRevert(); // ERC721: insufficient approval
        market.list(0, PRICE);
    }

    // ==================== NFTMarket — unlist ====================

    function test_Unlist() public {
        _listNFT(alice, 0, PRICE);

        vm.prank(alice);
        market.unlist(0);

        (,, bool active) = market.listings(0);
        assertFalse(active);
        assertEq(nft.ownerOf(0), alice);
    }

    function test_Unlist_RevertNotSeller() public {
        _listNFT(alice, 0, PRICE);

        vm.prank(bob);
        vm.expectRevert("not seller");
        market.unlist(0);
    }

    function test_Unlist_RevertNotListed() public {
        vm.prank(alice);
        vm.expectRevert("not listed");
        market.unlist(0);
    }

    // ==================== NFTMarket — buyNFT ====================

    function test_BuyNFT() public {
        _listNFT(alice, 0, PRICE);

        uint256 bobBefore = token.balanceOf(bob);
        uint256 aliceBefore = token.balanceOf(alice);

        vm.prank(bob);
        token.approve(address(market), PRICE);
        vm.prank(bob);
        market.buyNFT(0, PRICE);

        assertEq(nft.ownerOf(0), bob);
        assertEq(token.balanceOf(bob), bobBefore - PRICE);
        assertEq(token.balanceOf(alice), aliceBefore + PRICE);

        (,, bool active) = market.listings(0);
        assertFalse(active);
    }

    function test_BuyNFT_RevertNotListed() public {
        vm.prank(bob);
        vm.expectRevert("not listed");
        market.buyNFT(0, PRICE);
    }

    function test_BuyNFT_RevertWrongAmount() public {
        _listNFT(alice, 0, PRICE);

        vm.prank(bob);
        vm.expectRevert("wrong amount");
        market.buyNFT(0, 50 * TOKEN_DECIMALS);
    }

    function test_BuyNFT_RevertNotApproved() public {
        _listNFT(alice, 0, PRICE);

        vm.prank(bob);
        vm.expectRevert(); // ERC20: insufficient allowance
        market.buyNFT(0, PRICE);
    }

    // ==================== NFTMarket — tokensReceived ====================

    function test_TokensReceived() public {
        _listNFT(alice, 0, PRICE);

        uint256 bobBefore = token.balanceOf(bob);
        uint256 aliceBefore = token.balanceOf(alice);

        bytes memory data = abi.encode(uint256(0));
        vm.prank(bob);
        token.transfer(address(market), PRICE, data);

        assertEq(nft.ownerOf(0), bob);
        assertEq(token.balanceOf(bob), bobBefore - PRICE);
        assertEq(token.balanceOf(alice), aliceBefore + PRICE);
    }

    function test_TokensReceived_RevertNotToken() public {
        _listNFT(alice, 0, PRICE);
        bytes memory data = abi.encode(uint256(0));

        vm.prank(bob);
        vm.expectRevert("only token");
        market.tokensReceived(bob, PRICE, data);
    }

    function test_TokensReceived_RevertNotListed() public {
        bytes memory data = abi.encode(uint256(99));
        vm.prank(bob);
        vm.expectRevert("not listed");
        token.transfer(address(market), PRICE, data);
    }

    function test_TokensReceived_RevertWrongAmount() public {
        _listNFT(alice, 0, PRICE);

        bytes memory data = abi.encode(uint256(0));
        vm.prank(bob);
        vm.expectRevert("wrong amount");
        token.transfer(address(market), 50 * TOKEN_DECIMALS, data);
    }

    function test_TokensReceived_RevertInvalidData() public {
        vm.prank(bob);
        vm.expectRevert("invalid data");
        token.transfer(address(market), PRICE, "0x");
    }

    function test_TokensReceived_ReturnsSelector() public {
        _listNFT(alice, 0, PRICE);

        bytes memory data = abi.encode(uint256(0));
        vm.prank(bob);
        bool ok = token.transfer(address(market), PRICE, data);
        assertTrue(ok);
    }

    // ==================== 多 NFT / 多用户 ====================

    function test_MultipleListings() public {
        _listNFT(alice, 0, 50 * TOKEN_DECIMALS);
        _listNFT(alice, 1, 200 * TOKEN_DECIMALS);
        _listNFT(alice, 2, 500 * TOKEN_DECIMALS);

        vm.startPrank(bob);
        token.approve(address(market), 200 * TOKEN_DECIMALS);
        market.buyNFT(1, 200 * TOKEN_DECIMALS);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), bob);
        assertEq(nft.ownerOf(0), address(market));
        assertEq(nft.ownerOf(2), address(market));
    }

    function test_BuyViaBothMethods() public {
        _listNFT(alice, 0, PRICE);
        _listNFT(alice, 1, PRICE);

        vm.startPrank(bob);
        token.approve(address(market), PRICE);
        market.buyNFT(0, PRICE);
        vm.stopPrank();
        assertEq(nft.ownerOf(0), bob);

        bytes memory data = abi.encode(uint256(1));
        vm.prank(bob);
        token.transfer(address(market), PRICE, data);
        assertEq(nft.ownerOf(1), bob);
    }

    function test_RelistAfterBuy() public {
        _listNFT(alice, 0, PRICE);

        vm.prank(bob);
        token.approve(address(market), PRICE);
        vm.prank(bob);
        market.buyNFT(0, PRICE);

        uint256 newPrice = 200 * TOKEN_DECIMALS;
        vm.startPrank(bob);
        nft.approve(address(market), 0);
        market.list(0, newPrice);
        vm.stopPrank();

        (address seller, uint256 price, bool active) = market.listings(0);
        assertEq(seller, bob);
        assertEq(price, newPrice);
        assertTrue(active);
        assertEq(nft.ownerOf(0), address(market));
    }

    // ==================== View helpers ====================

    function test_NftBalance_TokenBalance() public {
        _listNFT(alice, 0, PRICE);
        _listNFT(alice, 1, PRICE);

        assertEq(market.nftBalance(), 2);
        assertEq(market.tokenBalance(), 0);
    }

    // ==================== internal helper ====================

    function _listNFT(address seller, uint256 tokenId, uint256 price) internal {
        vm.startPrank(seller);
        nft.approve(address(market), tokenId);
        market.list(tokenId, price);
        vm.stopPrank();
    }
}
