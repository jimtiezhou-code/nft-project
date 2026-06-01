// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/ITokenReceiver.sol";

contract NFTMarket is ITokenReceiver {
    using ECDSA for bytes32;

    IERC721 public immutable nft;
    IERC20 public immutable token;
    address public immutable signer; // 项目方白名单签名地址

    struct Listing {
        address seller;
        uint256 price; // 价格：多少个 TOKEN（已含 decimals）
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    // 记录已使用过的 permit 摘要，防止重放
    mapping(bytes32 => bool) public usedDigests;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event Bought(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price);

    constructor(address _nft, address _token, address _signer) {
        nft = IERC721(_nft);
        token = IERC20(_token);
        signer = _signer;
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

    /// @notice 白名单许可购买 — 只有持有项目方签名的白名单地址才可购买
    /// @param tokenId NFT token ID
    /// @param amount  购买价格（与 listing.price 一致）
    /// @param deadline 签名有效期（Unix timestamp，超过此时间签名失效）
    /// @param signature 项目方对 (buyer, tokenId, amount, deadline) 的 ECDSA 签名
    function permitBuy(
        uint256 tokenId,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // 1. 检查签名是否过期
        require(block.timestamp <= deadline, "permit expired");

        // 2. 检查 listing 状态
        Listing memory l = listings[tokenId];
        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        // 3. 重建签名摘要并验证签名
        bytes32 digest = _buildPermitDigest(msg.sender, tokenId, amount, deadline);
        require(!usedDigests[digest], "permit already used");
        require(_recoverSigner(digest, signature) == signer, "invalid permit signature");

        // 4. 标记已使用，防重放
        usedDigests[digest] = true;

        // 5. 执行购买
        listings[tokenId].active = false;
        require(token.transferFrom(msg.sender, l.seller, amount), "transferFrom failed");
        nft.transferFrom(address(this), msg.sender, tokenId);
        emit Bought(tokenId, msg.sender, l.seller, amount);
    }

    /// @notice 构建 permit 的签名摘要
    function buildPermitDigest(
        address buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 deadline
    ) public view returns (bytes32) {
        return _buildPermitDigest(buyer, tokenId, amount, deadline);
    }

    // ==================== Internal ====================

    /// @dev 使用 EIP-191 标准（personal_sign 格式）构建摘要
    function _buildPermitDigest(
        address buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 deadline
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("PermitBuy(address buyer,uint256 tokenId,uint256 amount,uint256 deadline)"),
                buyer,
                tokenId,
                amount,
                deadline
            )
        );
        return MessageHashUtils.toTypedDataHash(
            _domainSeparator(),
            structHash
        );
    }

    /// @dev EIP-712 domain separator
    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("NFTMarket Permit")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev 从签名中恢复签名者地址（使用 tryRecover，无效签名返回 address(0) 而不是 revert）
    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "invalid signature length");
        (address recovered, , ) = digest.tryRecover(signature);
        return recovered;
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