// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/ITokenReceiver.sol";

contract NFTMarket is ITokenReceiver {
    IERC721 public immutable nft;
    IERC20 public immutable token;

    struct Listing {
        address seller;
        uint256 price; // 价格：多少个 TOKEN（已含 decimals）
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event Bought(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price);

    constructor(address _nft, address _token) {
        nft = IERC721(_nft);
        token = IERC20(_token);
    }

    /// @notice 上架 NFT — 需先 approve 市场合约转移该 NFT
    function list(uint256 tokenId, uint256 price) external {
        require(price > 0, "price must be > 0");
        require(nft.ownerOf(tokenId) == msg.sender, "not owner");

        nft.transferFrom(msg.sender, address(this), tokenId);

        listings[tokenId] = Listing({seller: msg.sender, price: price, active: true});
        emit Listed(tokenId, msg.sender, price);
    }

    /// @notice 下架
    function unlist(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        require(l.active, "not listed");
        require(l.seller == msg.sender, "not seller");

        listings[tokenId].active = false;
        nft.transferFrom(address(this), msg.sender, tokenId);
        emit Unlisted(tokenId, l.seller);
    }

    /// @notice 直接购买 NFT（需先 approve 市场合约转移 TOKEN）
    function buyNFT(uint256 tokenId, uint256 amount) external {
        Listing memory l = listings[tokenId];
        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        listings[tokenId].active = false;
        require(token.transferFrom(msg.sender, l.seller, amount), "transferFrom failed");
        nft.transferFrom(address(this), msg.sender, tokenId);
        emit Bought(tokenId, msg.sender, l.seller, amount);
    }

    /// @notice ERC20 回调 — 用户通过 MyToken.transfer(to,amount,data) 触发购买
    ///         data = abi.encode(tokenId)
    function tokensReceived(address from, uint256 amount, bytes calldata data)
        external
        override
        returns (bytes4)
    {
        require(msg.sender == address(token), "only token");
        require(data.length >= 32, "invalid data");

        uint256 tokenId = abi.decode(data, (uint256));
        Listing memory l = listings[tokenId];

        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        listings[tokenId].active = false;

        // 把收到的 TOKEN 转给卖家
        require(token.transfer(l.seller, amount), "transfer failed");

        // 把 NFT 转给买家
        nft.transferFrom(address(this), from, tokenId);

        emit Bought(tokenId, from, l.seller, amount);
        return ITokenReceiver.tokensReceived.selector;
    }

    /// @notice 查询市场合约持有的 NFT / TOKEN 余额（调试用）
    function nftBalance() external view returns (uint256) {
        return nft.balanceOf(address(this));
    }

    function tokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
