// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IGplpManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

import "../access/Governable.sol";

// provide a way to migrate staked GPLP tokens by unstaking from the sender
// and staking for the receiver
// meant for a one-time use for a specified sender
// requires the contract to be added as a handler for stakedGplpTracker and feeGplpTracker
contract StakedGplpMigrator is Governable {
    using SafeMath for uint256;

    address public sender;
    address public gplp;
    address public stakedGplpTracker;
    address public feeGplpTracker;
    bool public isEnabled = true;

    constructor(
        address _sender,
        address _gplp,
        address _stakedGplpTracker,
        address _feeGplpTracker
    ) public {
        sender = _sender;
        gplp = _gplp;
        stakedGplpTracker = _stakedGplpTracker;
        feeGplpTracker = _feeGplpTracker;
    }

    function disable() external onlyGov {
        isEnabled = false;
    }

    function transfer(address _recipient, uint256 _amount) external onlyGov {
        _transfer(sender, _recipient, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(isEnabled, "StakedGplpMigrator: not enabled");
        require(_sender != address(0), "StakedGplpMigrator: transfer from the zero address");
        require(_recipient != address(0), "StakedGplpMigrator: transfer to the zero address");

        IRewardTracker(stakedGplpTracker).unstakeForAccount(_sender, feeGplpTracker, _amount, _sender);
        IRewardTracker(feeGplpTracker).unstakeForAccount(_sender, gplp, _amount, _sender);

        IRewardTracker(feeGplpTracker).stakeForAccount(_sender, _recipient, gplp, _amount);
        IRewardTracker(stakedGplpTracker).stakeForAccount(_recipient, _recipient, feeGplpTracker, _amount);
    }
}
