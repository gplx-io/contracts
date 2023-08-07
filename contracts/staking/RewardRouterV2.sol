// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IRewardRouterV2.sol";
import "./interfaces/IVester.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/IGplpManager.sol";
import "../access/Governable.sol";

contract RewardRouterV2 is IRewardRouterV2, ReentrancyGuard, Governable {
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

    address public override stakedGplpTracker;
    address public override feeGplpTracker;

    address public gplpManager;

    address public gplxVester;
    address public gplpVester;

    mapping (address => address) public pendingReceivers;

    event StakeGplx(address account, address token, uint256 amount);
    event UnstakeGplx(address account, address token, uint256 amount);

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
        address _gplpManager,
        address _gplxVester,
        address _gplpVester
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

        gplxVester = _gplxVester;
        gplpVester = _gplpVester;
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
        _unstakeGplx(msg.sender, gplx, _amount, true);
    }

    function unstakeEsGplx(uint256 _amount) external nonReentrant {
        _unstakeGplx(msg.sender, esGplx, _amount, true);
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

    function handleRewards(
        bool _shouldClaimGplx,
        bool _shouldStakeGplx,
        bool _shouldClaimEsGplx,
        bool _shouldStakeEsGplx,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        uint256 gplxAmount = 0;
        if (_shouldClaimGplx) {
            uint256 gplxAmount0 = IVester(gplxVester).claimForAccount(account, account);
            uint256 gplxAmount1 = IVester(gplpVester).claimForAccount(account, account);
            gplxAmount = gplxAmount0.add(gplxAmount1);
        }

        if (_shouldStakeGplx && gplxAmount > 0) {
            _stakeGplx(account, account, gplx, gplxAmount);
        }

        uint256 esGplxAmount = 0;
        if (_shouldClaimEsGplx) {
            uint256 esGplxAmount0 = IRewardTracker(stakedGplxTracker).claimForAccount(account, account);
            uint256 esGplxAmount1 = IRewardTracker(stakedGplpTracker).claimForAccount(account, account);
            esGplxAmount = esGplxAmount0.add(esGplxAmount1);
        }

        if (_shouldStakeEsGplx && esGplxAmount > 0) {
            _stakeGplx(account, account, esGplx, esGplxAmount);
        }

        if (_shouldStakeMultiplierPoints) {
            uint256 bnGplxAmount = IRewardTracker(bonusGplxTracker).claimForAccount(account, account);
            if (bnGplxAmount > 0) {
                IRewardTracker(feeGplxTracker).stakeForAccount(account, account, bnGplx, bnGplxAmount);
            }
        }

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 weth0 = IRewardTracker(feeGplxTracker).claimForAccount(account, address(this));
                uint256 weth1 = IRewardTracker(feeGplpTracker).claimForAccount(account, address(this));

                uint256 wethAmount = weth0.add(weth1);
                IWETH(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker(feeGplxTracker).claimForAccount(account, account);
                IRewardTracker(feeGplpTracker).claimForAccount(account, account);
            }
        }
    }

    function batchCompoundForAccounts(address[] memory _accounts) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    function signalTransfer(address _receiver) external nonReentrant {
        require(IERC20(gplxVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(gplpVester).balanceOf(msg.sender) == 0, "RewardRouter: sender has vested tokens");

        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        require(IERC20(gplxVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");
        require(IERC20(gplpVester).balanceOf(_sender) == 0, "RewardRouter: sender has vested tokens");

        address receiver = msg.sender;
        require(pendingReceivers[_sender] == receiver, "RewardRouter: transfer not signalled");
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);
        _compound(_sender);

        uint256 stakedGplx = IRewardTracker(stakedGplxTracker).depositBalances(_sender, gplx);
        if (stakedGplx > 0) {
            _unstakeGplx(_sender, gplx, stakedGplx, false);
            _stakeGplx(_sender, receiver, gplx, stakedGplx);
        }

        uint256 stakedEsGplx = IRewardTracker(stakedGplxTracker).depositBalances(_sender, esGplx);
        if (stakedEsGplx > 0) {
            _unstakeGplx(_sender, esGplx, stakedEsGplx, false);
            _stakeGplx(_sender, receiver, esGplx, stakedEsGplx);
        }

        uint256 stakedBnGplx = IRewardTracker(feeGplxTracker).depositBalances(_sender, bnGplx);
        if (stakedBnGplx > 0) {
            IRewardTracker(feeGplxTracker).unstakeForAccount(_sender, bnGplx, stakedBnGplx, _sender);
            IRewardTracker(feeGplxTracker).stakeForAccount(_sender, receiver, bnGplx, stakedBnGplx);
        }

        uint256 esGplxBalance = IERC20(esGplx).balanceOf(_sender);
        if (esGplxBalance > 0) {
            IERC20(esGplx).transferFrom(_sender, receiver, esGplxBalance);
        }

        uint256 gplpAmount = IRewardTracker(feeGplpTracker).depositBalances(_sender, gplp);
        if (gplpAmount > 0) {
            IRewardTracker(stakedGplpTracker).unstakeForAccount(_sender, feeGplpTracker, gplpAmount, _sender);
            IRewardTracker(feeGplpTracker).unstakeForAccount(_sender, gplp, gplpAmount, _sender);

            IRewardTracker(feeGplpTracker).stakeForAccount(_sender, receiver, gplp, gplpAmount);
            IRewardTracker(stakedGplpTracker).stakeForAccount(receiver, receiver, feeGplpTracker, gplpAmount);
        }

        IVester(gplxVester).transferStakeValues(_sender, receiver);
        IVester(gplpVester).transferStakeValues(_sender, receiver);
    }

    function _validateReceiver(address _receiver) private view {
        require(IRewardTracker(stakedGplxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedGplxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedGplxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedGplxTracker.cumulativeRewards > 0");

        require(IRewardTracker(bonusGplxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: bonusGplxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(bonusGplxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: bonusGplxTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeGplxTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeGplxTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeGplxTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeGplxTracker.cumulativeRewards > 0");

        require(IVester(gplxVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: gplxVester.transferredAverageStakedAmounts > 0");
        require(IVester(gplxVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: gplxVester.transferredCumulativeRewards > 0");

        require(IRewardTracker(stakedGplpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: stakedGplpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(stakedGplpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: stakedGplpTracker.cumulativeRewards > 0");

        require(IRewardTracker(feeGplpTracker).averageStakedAmounts(_receiver) == 0, "RewardRouter: feeGplpTracker.averageStakedAmounts > 0");
        require(IRewardTracker(feeGplpTracker).cumulativeRewards(_receiver) == 0, "RewardRouter: feeGplpTracker.cumulativeRewards > 0");

        require(IVester(gplpVester).transferredAverageStakedAmounts(_receiver) == 0, "RewardRouter: gplxVester.transferredAverageStakedAmounts > 0");
        require(IVester(gplpVester).transferredCumulativeRewards(_receiver) == 0, "RewardRouter: gplxVester.transferredCumulativeRewards > 0");

        require(IERC20(gplxVester).balanceOf(_receiver) == 0, "RewardRouter: gplxVester.balance > 0");
        require(IERC20(gplpVester).balanceOf(_receiver) == 0, "RewardRouter: gplpVester.balance > 0");
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

        emit StakeGplx(_account, _token, _amount);
    }

    function _unstakeGplx(address _account, address _token, uint256 _amount, bool _shouldReduceBnGplx) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedGplxTracker).stakedAmounts(_account);

        IRewardTracker(feeGplxTracker).unstakeForAccount(_account, bonusGplxTracker, _amount, _account);
        IRewardTracker(bonusGplxTracker).unstakeForAccount(_account, stakedGplxTracker, _amount, _account);
        IRewardTracker(stakedGplxTracker).unstakeForAccount(_account, _token, _amount, _account);

        if (_shouldReduceBnGplx) {
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
        }

        emit UnstakeGplx(_account, _token, _amount);
    }
}
