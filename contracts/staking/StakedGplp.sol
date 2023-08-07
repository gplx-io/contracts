// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";

import "../core/interfaces/IGplpManager.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardTracker.sol";

// provide a way to transfer staked GPLP tokens by unstaking from the sender
// and staking for the receiver
// tests in RewardRouterV2.js
contract StakedGplp {
    using SafeMath for uint256;

    string public constant name = "StakedGplp";
    string public constant symbol = "sGPLP";
    uint8 public constant decimals = 18;

    address public gplp;
    IGplpManager public gplpManager;
    address public stakedGplpTracker;
    address public feeGplpTracker;

    mapping (address => mapping (address => uint256)) public allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        address _gplp,
        IGplpManager _gplpManager,
        address _stakedGplpTracker,
        address _feeGplpTracker
    ) public {
        gplp = _gplp;
        gplpManager = _gplpManager;
        stakedGplpTracker = _stakedGplpTracker;
        feeGplpTracker = _feeGplpTracker;
    }

    function allowance(address _owner, address _spender) external view returns (uint256) {
        return allowances[_owner][_spender];
    }

    function approve(address _spender, uint256 _amount) external returns (bool) {
        _approve(msg.sender, _spender, _amount);
        return true;
    }

    function transfer(address _recipient, uint256 _amount) external returns (bool) {
        _transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function transferFrom(address _sender, address _recipient, uint256 _amount) external returns (bool) {
        uint256 nextAllowance = allowances[_sender][msg.sender].sub(_amount, "StakedGplp: transfer amount exceeds allowance");
        _approve(_sender, msg.sender, nextAllowance);
        _transfer(_sender, _recipient, _amount);
        return true;
    }

    function balanceOf(address _account) external view returns (uint256) {
        return IRewardTracker(feeGplpTracker).depositBalances(_account, gplp);
    }

    function totalSupply() external view returns (uint256) {
        return IERC20(stakedGplpTracker).totalSupply();
    }

    function _approve(address _owner, address _spender, uint256 _amount) private {
        require(_owner != address(0), "StakedGplp: approve from the zero address");
        require(_spender != address(0), "StakedGplp: approve to the zero address");

        allowances[_owner][_spender] = _amount;

        emit Approval(_owner, _spender, _amount);
    }

    function _transfer(address _sender, address _recipient, uint256 _amount) private {
        require(_sender != address(0), "StakedGplp: transfer from the zero address");
        require(_recipient != address(0), "StakedGplp: transfer to the zero address");

        require(
            gplpManager.lastAddedAt(_sender).add(gplpManager.cooldownDuration()) <= block.timestamp,
            "StakedGplp: cooldown duration not yet passed"
        );

        IRewardTracker(stakedGplpTracker).unstakeForAccount(_sender, feeGplpTracker, _amount, _sender);
        IRewardTracker(feeGplpTracker).unstakeForAccount(_sender, gplp, _amount, _sender);

        IRewardTracker(feeGplpTracker).stakeForAccount(_sender, _recipient, gplp, _amount);
        IRewardTracker(stakedGplpTracker).stakeForAccount(_recipient, _recipient, feeGplpTracker, _amount);
    }
}
