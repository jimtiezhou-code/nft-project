// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyNFT - 个人 NFT 收藏
/// @notice 基于 ERC721 标准发行的个人 NFT 合约
contract MyNFT is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor()
        ERC721("MyNFT Collection", "MNFT")
        Ownable(msg.sender)
    {}

    /// @notice 铸造新 NFT
    /// @param to 接收者地址
    /// @param uri Token 的元数据 URI (IPFS)
    /// @return tokenId 新铸造的 Token ID
    function mint(address to, string memory uri) public onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        return tokenId;
    }

    /// @notice 当前下一个可铸造的 Token ID
    function nextTokenId() public view returns (uint256) {
        return _nextTokenId;
    }

    // ========== Required Overrides ==========

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
