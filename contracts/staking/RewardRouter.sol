// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IGplpManager.sol";
import "../access/Governable.sol";

contract RewardRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;

    address public gplx;
    address public esGplx;
    address public bnGplx;

    address public gplp; // GPLX Liquidity Provider token

    address public stakedGplxTracker;
    address public bonusGplxTracker;
    address public feeGplxTracker;

    address public stakedGplpTracker;
    address public feeGplpTracker;

    address public gplpManager;

    event StakeGplx(address account, uint256 amount);
    event UnstakeGplx(address account, uint256 amount);

    event StakeGplp(address account, uint256 amount);
    event UnstakeGplp(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _gplx,
        address _esGplx,
        address _bnGplx,
        address _gplp,
        address _stakedGplxTracker,
        address _bonusGplxTracker,
        address _feeGplxTracker,
        address _feeGplpTracker,
        address _stakedGplpTracker,
        address _gplpManager
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;

        gplx = _gplx;
        esGplx = _esGplx;
        bnGplx = _bnGplx;

        gplp = _gplp;

        stakedGplxTracker = _stakedGplxTracker;
        bonusGplxTracker = _bonusGplxTracker;
        feeGplxTracker = _feeGplxTracker;

        feeGplpTracker = _feeGplpTracker;
        stakedGplpTracker = _stakedGplpTracker;

        gplpManager = _gplpManager;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(address _token, address _account, uint256 _amount) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function batchStakeGplxForAccount(address[] memory _accounts, uint256[] memory _amounts) external nonReentrant onlyGov {
        address _gplx = gplx;
        for (uint256 i = 0; i < _accounts.length; i++) {
            _stakeGplx(msg.sender, _accounts[i], _gplx, _amounts[i]);
        }
    }

    function stakeGplxForAccount(address _account, uint256 _amount) external nonReentrant onlyGov {
        _stakeGplx(msg.sender, _account, gplx, _amount);
    }

    function stakeGplx(uint256 _amount) external nonReentrant {
        _stakeGplx(msg.sender, msg.sender, gplx, _amount);
    }

    function stakeEsGplx(uint256 _amount) external nonReentrant {
        _stakeGplx(msg.sender, msg.sender, esGplx, _amount);
    }

    function unstakeGplx(uint256 _amount) external nonReentrant {
        _unstakeGplx(msg.sender, gplx, _amount);
    }

    function unstakeEsGplx(uint256 _amount) external nonReentrant {
        _unstakeGplx(msg.sender, esGplx, _amount);
    }

    function mintAndStakeGplp(address _token, uint256 _amount, uint256 _minUsdg, uint256 _minGplp) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");

        address account = msg.sender;
        uint256 gplpAmount = IGplpManager(gplpManager).addLiquidityForAccount(account, account, _token, _amount, _minUsdg, _minGplp);
        IRewardTracker(feeGplpTracker).stakeForAccount(account, account, gplp, gplpAmount);
        IRewardTracker(stakedGplpTracker).stakeForAccount(account, account, feeGplpTracker, gplpAmount);

        emit StakeGplp(account, gplpAmount);

        return gplpAmount;
    }

    function mintAndStakeGplpETH(uint256 _minUsdg, uint256 _minGplp) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");

        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).approve(gplpManager, msg.value);

        address account = msg.sender;
        uint256 gplpAmount = IGplpManager(gplpManager).addLiquidityForAccount(address(this), account, weth, msg.value, _minUsdg, _minGplp);

        IRewardTracker(feeGplpTracker).stakeForAccount(account, account, gplp, gplpAmount);
        IRewardTracker(stakedGplpTracker).stakeForAccount(account, account, feeGplpTracker, gplpAmount);

        emit StakeGplp(account, gplpAmount);

        return gplpAmount;
    }

    function unstakeAndRedeemGplp(address _tokenOut, uint256 _gplpAmount, uint256 _minOut, address _receiver) external nonReentrant returns (uint256) {
        require(_gplpAmount > 0, "RewardRouter: invalid _gplpAmount");

        address account = msg.sender;
        IRewardTracker(stakedGplpTracker).unstakeForAccount(account, feeGplpTracker, _gplpAmount, account);
        IRewardTracker(feeGplpTracker).unstakeForAccount(account, gplp, _gplpAmount, account);
        uint256 amountOut = IGplpManager(gplpManager).removeLiquidityForAccount(account, _tokenOut, _gplpAmount, _minOut, _receiver);

        emit UnstakeGplp(account, _gplpAmount);

        return amountOut;
    }

    function unstakeAndRedeemGplpETH(uint256 _gplpAmount, uint256 _minOut, address payable _receiver) external nonReentrant returns (uint256) {
        require(_gplpAmount > 0, "RewardRouter: invalid _gplpAmount");

        address account = msg.sender;
        IRewardTracker(stakedGplpTracker).unstakeForAccount(account, feeGplpTracker, _gplpAmount, account);
        IRewardTracker(feeGplpTracker).unstakeForAccount(account, gplp, _gplpAmount, account);
        uint256 amountOut = IGplpManager(gplpManager).removeLiquidityForAccount(account, weth, _gplpAmount, _minOut, address(this));

        IWETH(weth).withdraw(amountOut);

        _receiver.sendValue(amountOut);

        emit UnstakeGplp(account, _gplpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeGplxTracker).claimForAccount(account, account);
        IRewardTracker(feeGplpTracker).claimForAccount(account, account);

        IRewardTracker(stakedGplxTracker).claimForAccount(account, account);
        IRewardTracker(stakedGplpTracker).claimForAccount(account, account);
    }

    function claimEsGplx() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(stakedGplxTracker).claimForAccount(account, account);
        IRewardTracker(stakedGplpTracker).claimForAccount(account, account);
    }

    function claimFees() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeGplxTracker).claimForAccount(account, account);
        IRewardTracker(feeGplpTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(address _account) external nonReentrant onlyGov {
        _compound(_account);
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    function _compound(address _account) private {
        _compoundGplx(_account);
        _compoundGplp(_account);
    }

    function _compoundGplx(address _account) private {
        uint256 esGplxAmount = IRewardTracker(stakedGplxTracker).claimForAccount(_account, _account);
        if (esGplxAmount > 0) {
            _stakeGplx(_account, _account, esGplx, esGplxAmount);
        }

        uint256 bnGplxAmount = IRewardTracker(bonusGplxTracker).claimForAccount(_account, _account);
        if (bnGplxAmount > 0) {
            IRewardTracker(feeGplxTracker).stakeForAccount(_account, _account, bnGplx, bnGplxAmount);
        }
    }

    function _compoundGplp(address _account) private {
        uint256 esGplxAmount = IRewardTracker(stakedGplpTracker).claimForAccount(_account, _account);
        if (esGplxAmount > 0) {
            _stakeGplx(_account, _account, esGplx, esGplxAmount);
        }
    }

    function _stakeGplx(address _fundingAccount, address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        IRewardTracker(stakedGplxTracker).stakeForAccount(_fundingAccount, _account, _token, _amount);
        IRewardTracker(bonusGplxTracker).stakeForAccount(_account, _account, stakedGplxTracker, _amount);
        IRewardTracker(feeGplxTracker).stakeForAccount(_account, _account, bonusGplxTracker, _amount);

        emit StakeGplx(_account, _amount);
    }

    function _unstakeGplx(address _account, address _token, uint256 _amount) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedGplxTracker).stakedAmounts(_account);

        IRewardTracker(feeGplxTracker).unstakeForAccount(_account, bonusGplxTracker, _amount, _account);
        IRewardTracker(bonusGplxTracker).unstakeForAccount(_account, stakedGplxTracker, _amount, _account);
        IRewardTracker(stakedGplxTracker).unstakeForAccount(_account, _token, _amount, _account);

        uint256 bnGplxAmount = IRewardTracker(bonusGplxTracker).claimForAccount(_account, _account);
        if (bnGplxAmount > 0) {
            IRewardTracker(feeGplxTracker).stakeForAccount(_account, _account, bnGplx, bnGplxAmount);
        }

        uint256 stakedBnGplx = IRewardTracker(feeGplxTracker).depositBalances(_account, bnGplx);
        if (stakedBnGplx > 0) {
            uint256 reductionAmount = stakedBnGplx.mul(_amount).div(balance);
            IRewardTracker(feeGplxTracker).unstakeForAccount(_account, bnGplx, reductionAmount, _account);
            IMintable(bnGplx).burn(_account, reductionAmount);
        }

        emit UnstakeGplx(_account, _amount);
    }
}
