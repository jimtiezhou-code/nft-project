// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface ITokenReceiver {
    function tokensReceived(
        address from,
        uint256 amount,
        bytes calldata data
    ) external returns (bytes4);
}
