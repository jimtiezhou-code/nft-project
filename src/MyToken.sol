// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/ITokenReceiver.sol";

contract MyToken is ERC20 {
    bytes4 private constant TOKENS_RECEIVED = ITokenReceiver.tokensReceived.selector;

    constructor() ERC20("MyToken", "MTK") {
        _mint(msg.sender, 1_000_000 * 1e18);
    }

    /// @notice 铸造代币（仅用于测试/演示）
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice 带回调的转账 — 转账成功后调用接收者的 tokensReceived
    function transfer(address to, uint256 amount, bytes calldata data) public returns (bool) {
        _transfer(msg.sender, to, amount);

        if (to.code.length > 0) {
            bytes4 retval = ITokenReceiver(to).tokensReceived(msg.sender, amount, data);
            require(retval == TOKENS_RECEIVED, "MyToken: receiver rejected");
        }
        return true;
    }
}
