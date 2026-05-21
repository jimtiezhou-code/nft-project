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

    address public owner = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);

    uint256 constant TOKEN_DECIMALS = 1e18;
    uint256 constant PRICE = 100 * TOKEN_DECIMALS;

    function setUp() public {
        token = new MyToken();
        nft = new MyNFT();
        market = new NFTMarket(address(nft), address(token));

        // 给 alice, bob 转 Token
        token.transfer(alice, 10_000 * TOKEN_DECIMALS);
        token.transfer(bob, 10_000 * TOKEN_DECIMALS);

        // 给 alice 铸造 3 个 NFT
        string[3] memory uris = [
            "ipfs://token0",
            "ipfs://token1",
            "ipfs://token2"
        ];
        for (uint256 i = 0; i < 3; i++) {
            nft.mint(alice, uris[i]);
        }
    }

    // ==================== MyToken ====================

    function test_MyToken_Mint() public {
        assertEq(token.totalSupply(), 1_000_000 * TOKEN_DECIMALS); // 铸造总量不变
        assertEq(token.balanceOf(alice), 10_000 * TOKEN_DECIMALS);
        assertEq(token.balanceOf(bob), 10_000 * TOKEN_DECIMALS);
    }

    function test_MyToken_TransferWithData_CallsTokensReceived() public {
        // alice 上架 tokenId=0，价格 100 MTK
        _listNFT(alice, 0, PRICE);

        // bob 通过 transfer(address,uint256,bytes) 购买
        uint256 bobBefore = token.balanceOf(bob);
        uint256 aliceBefore = token.balanceOf(alice);

        bytes memory data = abi.encode(uint256(0));
        vm.prank(bob);
        bool ok = token.transfer(address(market), PRICE, data);
        assertTrue(ok);

        // bob 得到了 NFT
        assertEq(nft.ownerOf(0), bob);
        // bob 的 Token 减少了 PRICE
        assertEq(token.balanceOf(bob), bobBefore - PRICE);
        // alice 收到了 Token
        assertEq(token.balanceOf(alice), aliceBefore + PRICE);
    }

    function test_MyToken_TransferWithData_RevertsWhenReceiverRejects() public {
        // 不存在的 tokenId → tokensReceived 会 revert
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
        // NFT 转入市场
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
        // 不 approve 直接 list
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
        // NFT 退回
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

        // bob approve + buy
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
        bytes memory data = abi.encode(uint256(99)); // 不存在的 tokenId
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
        // data 太短
        vm.prank(bob);
        vm.expectRevert("invalid data");
        token.transfer(address(market), PRICE, "0x");
    }

    function test_TokensReceived_ReturnsSelector() public {
        _listNFT(alice, 0, PRICE);

        // 通过 MyToken.transfer 调用，验证返回 selector
        // transfer 内部检查 retval == TOKENS_RECEIVED
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

        // bob 买 tokenId=1
        vm.startPrank(bob);
        token.approve(address(market), 200 * TOKEN_DECIMALS);
        market.buyNFT(1, 200 * TOKEN_DECIMALS);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), bob);
        assertEq(nft.ownerOf(0), address(market)); // 还在卖
        assertEq(nft.ownerOf(2), address(market)); // 还在卖
    }

    function test_BuyViaBothMethods() public {
        _listNFT(alice, 0, PRICE);
        _listNFT(alice, 1, PRICE);

        // bob 用 buyNFT 买 tokenId=0
        vm.startPrank(bob);
        token.approve(address(market), PRICE);
        market.buyNFT(0, PRICE);
        vm.stopPrank();
        assertEq(nft.ownerOf(0), bob);

        // bob 用 transfer+data 买 tokenId=1
        bytes memory data = abi.encode(uint256(1));
        vm.prank(bob);
        token.transfer(address(market), PRICE, data);
        assertEq(nft.ownerOf(1), bob);
    }

    function test_RelistAfterBuy() public {
        // alice 上架 → bob 买
        _listNFT(alice, 0, PRICE);

        vm.prank(bob);
        token.approve(address(market), PRICE);
        vm.prank(bob);
        market.buyNFT(0, PRICE);

        // bob 重新上架（价格翻倍）
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

    // ==================== helper ====================

    function _listNFT(address seller, uint256 tokenId, uint256 price) internal {
        vm.startPrank(seller);
        nft.approve(address(market), tokenId);
        market.list(tokenId, price);
        vm.stopPrank();
    }
}
