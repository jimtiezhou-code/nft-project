// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/MyNFT.sol";

/// @title DeployMyNFT
/// @notice Deploy MyNFT and mint 3 NFTs (keystore mode)
contract DeployMyNFT is Script {
    function run() external {
        string[3] memory tokenURIs = [
            "ipfs://bafkreifwirfke75dd2nsfpz5wfyqtmvjghbwhecp4mnk3jx5aac6vxnpgy",  // Token 0: Golden Dawn #1
            "ipfs://bafkreicnr5fx4czg63jcrhnkokhaek4fr2sp4owjooukkwacxfa2k77y2u",  // Token 1: Crystal Blue #2
            "ipfs://bafkreiez2dyfg77m4p5btyg6hwa5zm2lacd7ekaj54hjb4hguh7hgq5mbe"   // Token 2: Flame Vortex #3
        ];

        vm.startBroadcast();

        MyNFT nft = new MyNFT();
        console.log("MyNFT deployed at:", address(nft));

        for (uint256 i = 0; i < 3; i++) {
            uint256 tokenId = nft.mint(msg.sender, tokenURIs[i]);
            console.log("Minted Token", tokenId, "->", tokenURIs[i]);
        }

        console.log(unicode"\n=== 部署完成 ===");
        console.log(unicode"合约地址:", address(nft));
        console.log(unicode"OpenSea (Sepolia): https://testnets.opensea.io/assets/sepolia/", address(nft));

        vm.stopBroadcast();
    }
}
