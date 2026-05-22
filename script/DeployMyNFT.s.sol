// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/MyNFT.sol";

/// @title DeployMyNFT
/// @notice Deploy MyNFT, mint 3 NFTs, save addresses to deployments/ directory
contract DeployMyNFT is Script {
    function run() external {
        string[3] memory tokenURIs = [
            "ipfs://bafkreifwirfke75dd2nsfpz5wfyqtmvjghbwhecp4mnk3jx5aac6vxnpgy",  // Token 0: Golden Dawn #1
            "ipfs://bafkreicnr5fx4czg63jcrhnkokhaek4fr2sp4owjooukkwacxfa2k77y2u",  // Token 1: Crystal Blue #2
            "ipfs://bafkreiez2dyfg77m4p5btyg6hwa5zm2lacd7ekaj54hjb4hguh7hgq5mbe"   // Token 2: Flame Vortex #3
        ];

        uint256 deployerPK = vm.envUint("PRIVATE_KEY");
        string memory network = _networkName();

        vm.startBroadcast(deployerPK);

        MyNFT nft = new MyNFT();
        console.log("MyNFT deployed at:", address(nft));

        for (uint256 i = 0; i < 3; i++) {
            uint256 tokenId = nft.mint(msg.sender, tokenURIs[i]);
            console.log("Minted Token", tokenId, "->", tokenURIs[i]);
        }

        vm.stopBroadcast();

        // ---- 作弊码保存部署地址到 JSON 文件 ----
        _saveAddress(network, "MyNFT", address(nft));

        console.log(unicode"\n=== 部署完成 ===");
        console.log(unicode"合约地址:", address(nft));
        console.log(unicode"OpenSea (Sepolia): https://testnets.opensea.io/assets/sepolia/", address(nft));
        console.log(unicode"地址已保存至: deployments/", network, ".json");
    }

    /// @notice 将合约地址写入 deployments/<network>.json
    function _saveAddress(string memory network, string memory name, address addr) internal {
        string memory dir = "deployments";
        if (!vm.exists(dir)) {
            vm.createDir(dir, true);
        }

        string memory path = string.concat(dir, "/", network, ".json");
        string memory json;

        // 如果文件已存在，先读取内容再合并
        if (vm.exists(path)) {
            json = vm.readFile(path);
        }

        vm.serializeString(json, name, vm.toString(addr));
        // network 字段用于跨环境识别
        string memory output = vm.serializeString(json, "network", network);
        vm.writeJson(output, path);
    }

    /// @notice 从 --rpc-url 或 chainid 推断网络名
    function _networkName() internal view returns (string memory) {
        uint256 cid = block.chainid;
        if (cid == 1) return "mainnet";
        if (cid == 11155111) return "sepolia";
        if (cid == 31337) return "anvil";
        return vm.toString(cid);
    }
}
