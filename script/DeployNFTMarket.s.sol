// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "forge-std/Script.sol";
import "../src/MyToken.sol";
import "../src/MyNFT.sol";
import "../src/NFTMarket.sol";

/// @title DeployNFTMarket
/// @notice One-click deploy MyToken + MyNFT + NFTMarket, save all addresses
/// @dev Usage:
///      # Keystore mode (recommended):
///      forge script script/DeployNFTMarket.s.sol --rpc-url sepolia --keystore ~/.foundry/keystores/deployer --broadcast --verify
///
///      # Private key mode:
///      forge script script/DeployNFTMarket.s.sol --rpc-url sepolia --private-key $PRIVATE_KEY --broadcast --verify
///
///      # Dry-run (no broadcast):
///      forge script script/DeployNFTMarket.s.sol --rpc-url sepolia
contract DeployNFTMarket is Script {
    function run() external {
        string memory network = _networkName();
        console.log("Network:", network);
        console.log("ChainID:", block.chainid);

        // vm.startBroadcast() 不带参数时，Foundry 从 CLI 读取签名方式:
        //   --keystore <path>         → 交互式输入密码
        //   --private-key <0x...>     → 明文私钥
        //   --interactive             → 交互式输入私钥
        //   --unlocked <addr>         → 使用 anvil 解锁账号
        vm.startBroadcast();
        console.log("Deployer:", msg.sender);

        MyToken token = new MyToken();
        console.log("MyToken deployed at:", address(token));

        MyNFT nft = new MyNFT();
        console.log("MyNFT deployed at:", address(nft));

        // signer 使用部署者地址（项目方可后续通过 setSigner 更改）
        NFTMarket market = new NFTMarket(address(nft), address(token), msg.sender);
        console.log("NFTMarket deployed at:", address(market));
        console.log("Permit signer:", msg.sender);

        vm.stopBroadcast();

        _saveDeployment(network, address(token), address(nft), address(market), msg.sender);

        console.log(unicode"========== 部署摘要 ==========");
        console.log("Network:   ", network);
        console.log("MyToken:   ", vm.toString(address(token)));
        console.log("MyNFT:     ", vm.toString(address(nft)));
        console.log("NFTMarket: ", vm.toString(address(market)));
        console.log("Signer:    ", vm.toString(msg.sender));
        console.log(unicode"地址已保存: deployments/", network, ".json");
        console.log(unicode"================================");
    }

    function _saveDeployment(
        string memory network,
        address token,
        address nft,
        address market,
        address signerAddr
    ) internal {
        string memory dir = "deployments";
        if (!vm.exists(dir)) {
            vm.createDir(dir, true);
        }

        string memory path = string.concat(dir, "/", network, ".json");
        string memory json;

        if (vm.exists(path)) {
            json = vm.readFile(path);
        }

        vm.serializeString(json, "MyToken", vm.toString(token));
        vm.serializeString(json, "MyNFT", vm.toString(nft));
        vm.serializeString(json, "NFTMarket", vm.toString(market));
        vm.serializeString(json, "Signer", vm.toString(signerAddr));
        vm.serializeUint(json, "chainId", block.chainid);
        string memory output = vm.serializeString(json, "network", network);
        vm.writeJson(output, path);
    }

    function _networkName() internal view returns (string memory) {
        uint256 cid = block.chainid;
        if (cid == 1) return "mainnet";
        if (cid == 11155111) return "sepolia";
        if (cid == 31337) return "anvil";
        return vm.toString(cid);
    }
}