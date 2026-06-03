// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./interfaces/ITokenReceiver.sol";

contract NFTMarket is ITokenReceiver {
    using ECDSA for bytes32;

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("PermitBuy(address buyer,uint256 tokenId,uint256 amount,uint256 deadline,uint256 nonce)");

    IERC721 public immutable nft;
    IERC20 public immutable token;
    address public immutable signer;
    bytes32 private immutable DOMAIN_SEPARATOR;

    // Storage packing: price first (own slot), seller+active share slot (20+1 bytes)
    struct Listing {
        uint256 price;
        address seller;
        bool    active;
    }

    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public permitNonces;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event Bought(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 price);

    constructor(address _nft, address _token, address _signer) {
        nft    = IERC721(_nft);
        token  = IERC20(_token);
        signer = _signer;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("NFTMarket Permit")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    // ==================== Listing ====================

    function list(uint256 tokenId, uint256 price) external {
        require(price > 0, "price must be > 0");
        address sender = msg.sender;
        require(nft.ownerOf(tokenId) == sender, "not owner");

        nft.transferFrom(sender, address(this), tokenId);
        listings[tokenId] = Listing({price: price, seller: sender, active: true});
        emit Listed(tokenId, sender, price);
    }

    function unlist(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.active, "not listed");
        address sender = msg.sender;
        require(l.seller == sender, "not seller");

        l.active = false;
        nft.transferFrom(address(this), sender, tokenId);
        emit Unlisted(tokenId, l.seller);
    }

    // ==================== Buy ====================

    function buyNFT(uint256 tokenId, uint256 amount) external {
        Listing storage l = listings[tokenId];
        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        l.active = false;
        address sender = msg.sender;
        address seller = l.seller;
        require(token.transferFrom(sender, seller, amount), "transferFrom failed");
        nft.transferFrom(address(this), sender, tokenId);
        emit Bought(tokenId, sender, seller, amount);
    }

    function permitBuy(
        uint256 tokenId,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(block.timestamp <= deadline, "permit expired");

        Listing storage l = listings[tokenId];
        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        address buyer = msg.sender;
        uint256 nonce = permitNonces[buyer];
        bytes32 digest = _buildPermitDigest(buyer, tokenId, amount, deadline, nonce);
        require(_recoverSigner(digest, signature) == signer, "invalid permit signature");
        unchecked { permitNonces[buyer] = nonce + 1; }

        l.active = false;
        address seller = l.seller;
        require(token.transferFrom(buyer, seller, amount), "transferFrom failed");
        nft.transferFrom(address(this), buyer, tokenId);
        emit Bought(tokenId, buyer, seller, amount);
    }

    function buildPermitDigest(
        address buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 deadline,
        uint256 nonce
    ) public view returns (bytes32) {
        return _buildPermitDigest(buyer, tokenId, amount, deadline, nonce);
    }

    // ==================== Callback ====================

    function tokensReceived(address from, uint256 amount, bytes calldata data)
        external
        override
        returns (bytes4)
    {
        require(msg.sender == address(token), "only token");
        require(data.length >= 32, "invalid data");

        uint256 tokenId = abi.decode(data, (uint256));
        Listing storage l = listings[tokenId];

        require(l.active, "not listed");
        require(amount == l.price, "wrong amount");

        l.active = false;
        require(token.transfer(l.seller, amount), "transfer failed");
        nft.transferFrom(address(this), from, tokenId);
        emit Bought(tokenId, from, l.seller, amount);
        return ITokenReceiver.tokensReceived.selector;
    }

    // ==================== Views ====================

    function nftBalance() external view returns (uint256) {
        return nft.balanceOf(address(this));
    }

    function tokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ==================== Internal ====================

    function _buildPermitDigest(
        address buyer,
        uint256 tokenId,
        uint256 amount,
        uint256 deadline,
        uint256 nonce
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(PERMIT_TYPEHASH, buyer, tokenId, amount, deadline, nonce)
        );
        return MessageHashUtils.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) internal pure returns (address) {
        require(signature.length == 65, "invalid signature length");
        (address recovered, , ) = digest.tryRecover(signature);
        return recovered;
    }
}
