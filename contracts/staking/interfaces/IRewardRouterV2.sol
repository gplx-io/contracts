// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IRewardRouterV2 {
    function feeGplpTracker() external view returns (address);
    function stakedGplpTracker() external view returns (address);
}
