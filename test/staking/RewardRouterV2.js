const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")

use(solidity)

describe("RewardRouterV2", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4, tokenManager] = provider.getWallets()

  const vestingDuration = 365 * 24 * 60 * 60

  let timelock

  let vault
  let gplpManager
  let gplp
  let usdg
  let router
  let vaultPriceFeed
  let bnb
  let bnbPriceFeed
  let btc
  let btcPriceFeed
  let eth
  let ethPriceFeed
  let dai
  let daiPriceFeed
  let busd
  let busdPriceFeed

  let gplx
  let esGplx
  let bnGplx

  let stakedGplxTracker
  let stakedGplxDistributor
  let bonusGplxTracker
  let bonusGplxDistributor
  let feeGplxTracker
  let feeGplxDistributor

  let feeGplpTracker
  let feeGplpDistributor
  let stakedGplpTracker
  let stakedGplpDistributor

  let gplxVester
  let gplpVester

  let rewardRouter

  beforeEach(async () => {
    bnb = await deployContract("Token", [])
    bnbPriceFeed = await deployContract("PriceFeed", [])

    btc = await deployContract("Token", [])
    btcPriceFeed = await deployContract("PriceFeed", [])

    eth = await deployContract("Token", [])
    ethPriceFeed = await deployContract("PriceFeed", [])

    dai = await deployContract("Token", [])
    daiPriceFeed = await deployContract("PriceFeed", [])

    busd = await deployContract("Token", [])
    busdPriceFeed = await deployContract("PriceFeed", [])

    vault = await deployContract("Vault", [])
    usdg = await deployContract("USDG", [vault.address])
    router = await deployContract("Router", [vault.address, usdg.address, bnb.address])
    vaultPriceFeed = await deployContract("VaultPriceFeed", [])
    gplp = await deployContract("GPLP", [])

    await initVault(vault, router, usdg, vaultPriceFeed)
    gplpManager = await deployContract("GplpManager", [vault.address, usdg.address, gplp.address, ethers.constants.AddressZero, 24 * 60 * 60])

    timelock = await deployContract("Timelock", [
      wallet.address, // _admin
      10, // _buffer
      tokenManager.address, // _tokenManager
      tokenManager.address, // _mintReceiver
      gplpManager.address, // _gplpManager
      user0.address, // _rewardRouter
      expandDecimals(1000000, 18), // _maxTokenSupply
      10, // marginFeeBasisPoints
      100 // maxMarginFeeBasisPoints
    ])

    await vaultPriceFeed.setTokenConfig(bnb.address, bnbPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(btc.address, btcPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(eth.address, ethPriceFeed.address, 8, false)
    await vaultPriceFeed.setTokenConfig(dai.address, daiPriceFeed.address, 8, false)

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1))
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed))

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000))
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed))

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300))
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed))

    await gplp.setInPrivateTransferMode(true)
    await gplp.setMinter(gplpManager.address, true)
    await gplpManager.setInPrivateMode(true)

    gplx = await deployContract("GPLX", []);
    esGplx = await deployContract("EsGPLX", []);
    bnGplx = await deployContract("MintableBaseToken", ["Bonus GPLX", "bnGPLX", 0]);

    // GPLX
    stakedGplxTracker = await deployContract("RewardTracker", ["Staked GPLX", "sGPLX"])
    stakedGplxDistributor = await deployContract("RewardDistributor", [esGplx.address, stakedGplxTracker.address])
    await stakedGplxTracker.initialize([gplx.address, esGplx.address], stakedGplxDistributor.address)
    await stakedGplxDistributor.updateLastDistributionTime()

    bonusGplxTracker = await deployContract("RewardTracker", ["Staked + Bonus GPLX", "sbGPLX"])
    bonusGplxDistributor = await deployContract("BonusDistributor", [bnGplx.address, bonusGplxTracker.address])
    await bonusGplxTracker.initialize([stakedGplxTracker.address], bonusGplxDistributor.address)
    await bonusGplxDistributor.updateLastDistributionTime()

    feeGplxTracker = await deployContract("RewardTracker", ["Staked + Bonus + Fee GPLX", "sbfGPLX"])
    feeGplxDistributor = await deployContract("RewardDistributor", [eth.address, feeGplxTracker.address])
    await feeGplxTracker.initialize([bonusGplxTracker.address, bnGplx.address], feeGplxDistributor.address)
    await feeGplxDistributor.updateLastDistributionTime()

    // GPLP
    feeGplpTracker = await deployContract("RewardTracker", ["Fee GPLP", "fGPLP"])
    feeGplpDistributor = await deployContract("RewardDistributor", [eth.address, feeGplpTracker.address])
    await feeGplpTracker.initialize([gplp.address], feeGplpDistributor.address)
    await feeGplpDistributor.updateLastDistributionTime()

    stakedGplpTracker = await deployContract("RewardTracker", ["Fee + Staked GPLP", "fsGPLP"])
    stakedGplpDistributor = await deployContract("RewardDistributor", [esGplx.address, stakedGplpTracker.address])
    await stakedGplpTracker.initialize([feeGplpTracker.address], stakedGplpDistributor.address)
    await stakedGplpDistributor.updateLastDistributionTime()

    gplxVester = await deployContract("Vester", [
      "Vested GPLX", // _name
      "vGPLX", // _symbol
      vestingDuration, // _vestingDuration
      esGplx.address, // _esToken
      feeGplxTracker.address, // _pairToken
      gplx.address, // _claimableToken
      stakedGplxTracker.address, // _rewardTracker
    ])

    gplpVester = await deployContract("Vester", [
      "Vested GPLP", // _name
      "vGPLP", // _symbol
      vestingDuration, // _vestingDuration
      esGplx.address, // _esToken
      stakedGplpTracker.address, // _pairToken
      gplx.address, // _claimableToken
      stakedGplpTracker.address, // _rewardTracker
    ])

    await stakedGplxTracker.setInPrivateTransferMode(true)
    await stakedGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateTransferMode(true)
    await bonusGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateClaimingMode(true)
    await feeGplxTracker.setInPrivateTransferMode(true)
    await feeGplxTracker.setInPrivateStakingMode(true)

    await feeGplpTracker.setInPrivateTransferMode(true)
    await feeGplpTracker.setInPrivateStakingMode(true)
    await stakedGplpTracker.setInPrivateTransferMode(true)
    await stakedGplpTracker.setInPrivateStakingMode(true)

    await esGplx.setInPrivateTransferMode(true)

    rewardRouter = await deployContract("RewardRouterV2", [])
    await rewardRouter.initialize(
      bnb.address,
      gplx.address,
      esGplx.address,
      bnGplx.address,
      gplp.address,
      stakedGplxTracker.address,
      bonusGplxTracker.address,
      feeGplxTracker.address,
      feeGplpTracker.address,
      stakedGplpTracker.address,
      gplpManager.address,
      gplxVester.address,
      gplpVester.address
    )

    // allow bonusGplxTracker to stake stakedGplxTracker
    await stakedGplxTracker.setHandler(bonusGplxTracker.address, true)
    // allow bonusGplxTracker to stake feeGplxTracker
    await bonusGplxTracker.setHandler(feeGplxTracker.address, true)
    await bonusGplxDistributor.setBonusMultiplier(10000)
    // allow feeGplxTracker to stake bnGplx
    await bnGplx.setHandler(feeGplxTracker.address, true)

    // allow stakedGplpTracker to stake feeGplpTracker
    await feeGplpTracker.setHandler(stakedGplpTracker.address, true)
    // allow feeGplpTracker to stake gplp
    await gplp.setHandler(feeGplpTracker.address, true)

    // mint esGplx for distributors
    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(stakedGplxDistributor.address, expandDecimals(50000, 18))
    await stakedGplxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second
    await esGplx.mint(stakedGplpDistributor.address, expandDecimals(50000, 18))
    await stakedGplpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second

    // mint bnGplx for distributor
    await bnGplx.setMinter(wallet.address, true)
    await bnGplx.mint(bonusGplxDistributor.address, expandDecimals(1500, 18))

    await esGplx.setHandler(tokenManager.address, true)
    await gplxVester.setHandler(wallet.address, true)

    await esGplx.setHandler(rewardRouter.address, true)
    await esGplx.setHandler(stakedGplxDistributor.address, true)
    await esGplx.setHandler(stakedGplpDistributor.address, true)
    await esGplx.setHandler(stakedGplxTracker.address, true)
    await esGplx.setHandler(stakedGplpTracker.address, true)
    await esGplx.setHandler(gplxVester.address, true)
    await esGplx.setHandler(gplpVester.address, true)

    await gplpManager.setHandler(rewardRouter.address, true)
    await stakedGplxTracker.setHandler(rewardRouter.address, true)
    await bonusGplxTracker.setHandler(rewardRouter.address, true)
    await feeGplxTracker.setHandler(rewardRouter.address, true)
    await feeGplpTracker.setHandler(rewardRouter.address, true)
    await stakedGplpTracker.setHandler(rewardRouter.address, true)

    await esGplx.setHandler(rewardRouter.address, true)
    await bnGplx.setMinter(rewardRouter.address, true)
    await esGplx.setMinter(gplxVester.address, true)
    await esGplx.setMinter(gplpVester.address, true)

    await gplxVester.setHandler(rewardRouter.address, true)
    await gplpVester.setHandler(rewardRouter.address, true)

    await feeGplxTracker.setHandler(gplxVester.address, true)
    await stakedGplpTracker.setHandler(gplpVester.address, true)

    await gplpManager.setGov(timelock.address)
    await stakedGplxTracker.setGov(timelock.address)
    await bonusGplxTracker.setGov(timelock.address)
    await feeGplxTracker.setGov(timelock.address)
    await feeGplpTracker.setGov(timelock.address)
    await stakedGplpTracker.setGov(timelock.address)
    await stakedGplxDistributor.setGov(timelock.address)
    await stakedGplpDistributor.setGov(timelock.address)
    await esGplx.setGov(timelock.address)
    await bnGplx.setGov(timelock.address)
    await gplxVester.setGov(timelock.address)
    await gplpVester.setGov(timelock.address)
  })

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true)

    expect(await rewardRouter.weth()).eq(bnb.address)
    expect(await rewardRouter.gplx()).eq(gplx.address)
    expect(await rewardRouter.esGplx()).eq(esGplx.address)
    expect(await rewardRouter.bnGplx()).eq(bnGplx.address)

    expect(await rewardRouter.gplp()).eq(gplp.address)

    expect(await rewardRouter.stakedGplxTracker()).eq(stakedGplxTracker.address)
    expect(await rewardRouter.bonusGplxTracker()).eq(bonusGplxTracker.address)
    expect(await rewardRouter.feeGplxTracker()).eq(feeGplxTracker.address)

    expect(await rewardRouter.feeGplpTracker()).eq(feeGplpTracker.address)
    expect(await rewardRouter.stakedGplpTracker()).eq(stakedGplpTracker.address)

    expect(await rewardRouter.gplpManager()).eq(gplpManager.address)

    expect(await rewardRouter.gplxVester()).eq(gplxVester.address)
    expect(await rewardRouter.gplpVester()).eq(gplpVester.address)

    await expect(rewardRouter.initialize(
      bnb.address,
      gplx.address,
      esGplx.address,
      bnGplx.address,
      gplp.address,
      stakedGplxTracker.address,
      bonusGplxTracker.address,
      feeGplxTracker.address,
      feeGplpTracker.address,
      stakedGplpTracker.address,
      gplpManager.address,
      gplxVester.address,
      gplpVester.address
    )).to.be.revertedWith("RewardRouter: already initialized")
  })

  it("stakeGplxForAccount, stakeGplx, stakeEsGplx, unstakeGplx, unstakeEsGplx, claimEsGplx, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeGplxDistributor.address, expandDecimals(100, 18))
    await feeGplxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await gplx.setMinter(wallet.address, true)
    await gplx.mint(user0.address, expandDecimals(1500, 18))
    expect(await gplx.balanceOf(user0.address)).eq(expandDecimals(1500, 18))

    await gplx.connect(user0).approve(stakedGplxTracker.address, expandDecimals(1000, 18))
    await expect(rewardRouter.connect(user0).stakeGplxForAccount(user1.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Governable: forbidden")

    await rewardRouter.setGov(user0.address)
    await rewardRouter.connect(user0).stakeGplxForAccount(user1.address, expandDecimals(800, 18))
    expect(await gplx.balanceOf(user0.address)).eq(expandDecimals(700, 18))

    await gplx.mint(user1.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)

    expect(await stakedGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user0.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(1000, 18))

    expect(await bonusGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusGplxTracker.depositBalances(user0.address, stakedGplxTracker.address)).eq(0)
    expect(await bonusGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusGplxTracker.depositBalances(user1.address, stakedGplxTracker.address)).eq(expandDecimals(1000, 18))

    expect(await feeGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user0.address, bonusGplxTracker.address)).eq(0)
    expect(await feeGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).eq(0)
    expect(await stakedGplxTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedGplxTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    expect(await bonusGplxTracker.claimable(user0.address)).eq(0)
    expect(await bonusGplxTracker.claimable(user1.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusGplxTracker.claimable(user1.address)).lt("2750000000000000000") // 2.75

    expect(await feeGplxTracker.claimable(user0.address)).eq(0)
    expect(await feeGplxTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeGplxTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    await timelock.signalMint(esGplx.address, tokenManager.address, expandDecimals(500, 18))
    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.processMint(esGplx.address, tokenManager.address, expandDecimals(500, 18))
    await esGplx.connect(tokenManager).transferFrom(tokenManager.address, user2.address, expandDecimals(500, 18))
    await rewardRouter.connect(user2).stakeEsGplx(expandDecimals(500, 18))

    expect(await stakedGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user0.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedGplxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await stakedGplxTracker.depositBalances(user2.address, esGplx.address)).eq(expandDecimals(500, 18))

    expect(await bonusGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await bonusGplxTracker.depositBalances(user0.address, stakedGplxTracker.address)).eq(0)
    expect(await bonusGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await bonusGplxTracker.depositBalances(user1.address, stakedGplxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await bonusGplxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await bonusGplxTracker.depositBalances(user2.address, stakedGplxTracker.address)).eq(expandDecimals(500, 18))

    expect(await feeGplxTracker.stakedAmounts(user0.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user0.address, bonusGplxTracker.address)).eq(0)
    expect(await feeGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).eq(expandDecimals(1000, 18))
    expect(await feeGplxTracker.stakedAmounts(user2.address)).eq(expandDecimals(500, 18))
    expect(await feeGplxTracker.depositBalances(user2.address, bonusGplxTracker.address)).eq(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).eq(0)
    expect(await stakedGplxTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedGplxTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedGplxTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await bonusGplxTracker.claimable(user0.address)).eq(0)
    expect(await bonusGplxTracker.claimable(user1.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusGplxTracker.claimable(user1.address)).lt("5490000000000000000")
    expect(await bonusGplxTracker.claimable(user2.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusGplxTracker.claimable(user2.address)).lt("1380000000000000000")

    expect(await feeGplxTracker.claimable(user0.address)).eq(0)
    expect(await feeGplxTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeGplxTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeGplxTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeGplxTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await esGplx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsGplx()
    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esGplx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsGplx()
    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx0 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx0, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx1 = await rewardRouter.connect(user0).batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await stakedGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(1000, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3643, 18))
    expect(await bonusGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3645, 18))

    expect(await feeGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3657, 18))
    expect(await feeGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3659, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).gt(expandDecimals(3643, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).lt(expandDecimals(3645, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("14100000000000000000") // 14.1
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("14300000000000000000") // 14.3

    expect(await gplx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).unstakeGplx(expandDecimals(300, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(300, 18))

    expect(await stakedGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await stakedGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(700, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(2643, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(2645, 18))

    expect(await bonusGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3343, 18))
    expect(await bonusGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3345, 18))

    expect(await feeGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(3357, 18))
    expect(await feeGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(3359, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).gt(expandDecimals(3343, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).lt(expandDecimals(3345, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("13000000000000000000") // 13
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("13100000000000000000") // 13.1

    const esGplxBalance1 = await esGplx.balanceOf(user1.address)
    const esGplxUnstakeBalance1 = await stakedGplxTracker.depositBalances(user1.address, esGplx.address)
    await rewardRouter.connect(user1).unstakeEsGplx(esGplxUnstakeBalance1)
    expect(await esGplx.balanceOf(user1.address)).eq(esGplxBalance1.add(esGplxUnstakeBalance1))

    expect(await stakedGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(700, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).eq(0)

    expect(await bonusGplxTracker.stakedAmounts(user1.address)).eq(expandDecimals(700, 18))

    expect(await feeGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(702, 18))
    expect(await feeGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(703, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).eq(expandDecimals(700, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("2720000000000000000") // 2.72
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("2740000000000000000") // 2.74

    await expect(rewardRouter.connect(user1).unstakeEsGplx(expandDecimals(1, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance")
  })

  it("mintAndStakeGplp, unstakeAndRedeemGplp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeGplpDistributor.address, expandDecimals(100, 18))
    await feeGplpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(1, 18))
    const tx0 = await rewardRouter.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )
    await reportGasUsed(provider, tx0, "mintAndStakeGplp gas used")

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))

    await bnb.mint(user1.address, expandDecimals(2, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(2, 18))
    await rewardRouter.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(2, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await increaseTime(provider, 24 * 60 * 60 + 1)
    await mineBlock(provider)

    expect(await feeGplpTracker.claimable(user1.address)).gt("3560000000000000000") // 3.56, 100 / 28 => ~3.57
    expect(await feeGplpTracker.claimable(user1.address)).lt("3580000000000000000") // 3.58

    expect(await stakedGplpTracker.claimable(user1.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedGplpTracker.claimable(user1.address)).lt(expandDecimals(1786, 18))

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await expect(rewardRouter.connect(user2).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user2.address
    )).to.be.revertedWith("GplpManager: cooldown duration not yet passed")

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq("897300000000000000000") // 897.3
    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq("897300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq(0)

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    )
    await reportGasUsed(provider, tx1, "unstakeAndRedeemGplp gas used")

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeGplpTracker.claimable(user1.address)).gt("5940000000000000000") // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeGplpTracker.claimable(user1.address)).lt("5960000000000000000")
    expect(await feeGplpTracker.claimable(user2.address)).gt("1180000000000000000") // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeGplpTracker.claimable(user2.address)).lt("1200000000000000000")

    expect(await stakedGplpTracker.claimable(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedGplpTracker.claimable(user1.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await stakedGplpTracker.claimable(user2.address)).gt(expandDecimals(595, 18))
    expect(await stakedGplpTracker.claimable(user2.address)).lt(expandDecimals(596, 18))

    expect(await esGplx.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimEsGplx()
    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await eth.balanceOf(user1.address)).eq(0)
    await rewardRouter.connect(user1).claimFees()
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000")
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000")

    expect(await esGplx.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimEsGplx()
    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(595, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(596, 18))

    expect(await eth.balanceOf(user2.address)).eq(0)
    await rewardRouter.connect(user2).claimFees()
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000")
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx2 = await rewardRouter.connect(user1).compound()
    await reportGasUsed(provider, tx2, "compound gas used")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const tx3 = await rewardRouter.batchCompoundForAccounts([user1.address, user2.address])
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used")

    expect(await stakedGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await stakedGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(4165, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(4167, 18))

    expect(await bonusGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4165, 18))
    expect(await bonusGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4167, 18))

    expect(await feeGplxTracker.stakedAmounts(user1.address)).gt(expandDecimals(4179, 18))
    expect(await feeGplxTracker.stakedAmounts(user1.address)).lt(expandDecimals(4180, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).gt(expandDecimals(4165, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bonusGplxTracker.address)).lt(expandDecimals(4167, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("12900000000000000000") // 12.9
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("13100000000000000000") // 13.1

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq("598300000000000000000") // 598.3
    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq("598300000000000000000")
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666") // ~0.99
  })

  it("mintAndStakeGplpETH, unstakeAndRedeemGplpETH", async () => {
    const receiver0 = newWallet()
    await expect(rewardRouter.connect(user0).mintAndStakeGplpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: 0 }))
      .to.be.revertedWith("RewardRouter: invalid msg.value")

    await expect(rewardRouter.connect(user0).mintAndStakeGplpETH(expandDecimals(300, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("GplpManager: insufficient USDG output")

    await expect(rewardRouter.connect(user0).mintAndStakeGplpETH(expandDecimals(299, 18), expandDecimals(300, 18), { value: expandDecimals(1, 18) }))
      .to.be.revertedWith("GplpManager: insufficient GPLP output")

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(0)
    expect(await bnb.totalSupply()).eq(0)
    expect(await provider.getBalance(bnb.address)).eq(0)
    expect(await stakedGplpTracker.balanceOf(user0.address)).eq(0)

    await rewardRouter.connect(user0).mintAndStakeGplpETH(expandDecimals(299, 18), expandDecimals(299, 18), { value: expandDecimals(1, 18) })

    expect(await bnb.balanceOf(user0.address)).eq(0)
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18))
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18))
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18))
    expect(await stakedGplpTracker.balanceOf(user0.address)).eq("299100000000000000000") // 299.1

    await expect(rewardRouter.connect(user0).unstakeAndRedeemGplpETH(expandDecimals(300, 18), expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await expect(rewardRouter.connect(user0).unstakeAndRedeemGplpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("GplpManager: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)

    await expect(rewardRouter.connect(user0).unstakeAndRedeemGplpETH("299100000000000000000", expandDecimals(1, 18), receiver0.address))
      .to.be.revertedWith("GplpManager: insufficient output")

    await rewardRouter.connect(user0).unstakeAndRedeemGplpETH("299100000000000000000", "990000000000000000", receiver0.address)
    expect(await provider.getBalance(receiver0.address)).eq("994009000000000000") // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000") // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000")
    expect(await bnb.totalSupply()).eq("5991000000000000")
  })

  it("gplx: signalTransfer, acceptTransfer", async () =>{
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(user1.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)

    await gplx.mint(user2.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user2).approve(stakedGplxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).claim()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedGplxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await gplxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedGplxTracker.depositBalances(user2.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user2.address, esGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user2.address, bnGplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).eq(0)
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await gplxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.bonusRewards(user3.address)).eq(0)
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedGplxTracker.depositBalances(user2.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user2.address, esGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user2.address, bnGplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).gt(expandDecimals(892, 18))
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).lt(expandDecimals(893, 18))
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).gt("547000000000000000") // 0.547
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).lt("549000000000000000") // 0.548
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await gplxVester.bonusRewards(user2.address)).eq(0)
    expect(await gplxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await gplx.connect(user3).approve(stakedGplxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user3).signalTransfer(user4.address)
    await rewardRouter.connect(user4).acceptTransfer(user3.address)

    expect(await stakedGplxTracker.depositBalances(user3.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user4.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user4.address, esGplx.address)).gt(expandDecimals(892, 18))
    expect(await stakedGplxTracker.depositBalances(user4.address, esGplx.address)).lt(expandDecimals(893, 18))
    expect(await feeGplxTracker.depositBalances(user4.address, bnGplx.address)).gt("547000000000000000") // 0.547
    expect(await feeGplxTracker.depositBalances(user4.address, bnGplx.address)).lt("549000000000000000") // 0.548
    expect(await gplxVester.transferredAverageStakedAmounts(user4.address)).gt(expandDecimals(200, 18))
    expect(await gplxVester.transferredAverageStakedAmounts(user4.address)).lt(expandDecimals(201, 18))
    expect(await gplxVester.transferredCumulativeRewards(user4.address)).gt(expandDecimals(892, 18))
    expect(await gplxVester.transferredCumulativeRewards(user4.address)).lt(expandDecimals(894, 18))
    expect(await gplxVester.bonusRewards(user3.address)).eq(0)
    expect(await gplxVester.bonusRewards(user4.address)).eq(expandDecimals(100, 18))
    expect(await stakedGplxTracker.averageStakedAmounts(user3.address)).gt(expandDecimals(1092, 18))
    expect(await stakedGplxTracker.averageStakedAmounts(user3.address)).lt(expandDecimals(1094, 18))
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user4.address)).gt(expandDecimals(200, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user4.address)).lt(expandDecimals(201, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user4.address)).gt(expandDecimals(992, 18))
    expect(await gplxVester.getMaxVestableAmount(user4.address)).lt(expandDecimals(993, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user4.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await gplxVester.getPairAmount(user4.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))

    await expect(rewardRouter.connect(user4).acceptTransfer(user3.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")
  })

  it("gplx, gplp: signalTransfer, acceptTransfer", async () =>{
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(gplxVester.address, expandDecimals(10000, 18))
    await gplx.mint(gplpVester.address, expandDecimals(10000, 18))
    await eth.mint(feeGplpDistributor.address, expandDecimals(100, 18))
    await feeGplpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await bnb.mint(user2.address, expandDecimals(1, 18))
    await bnb.connect(user2).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user2).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await gplx.mint(user1.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(200, 18))
    await rewardRouter.connect(user1).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)

    await gplx.mint(user2.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user2.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user2).approve(stakedGplxTracker.address, expandDecimals(400, 18))
    await rewardRouter.connect(user2).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user2.address)).eq(0)

    await rewardRouter.connect(user2).signalTransfer(user1.address)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user2).signalTransfer(user1.address)
    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user2).signalTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: stakedGplxTracker.averageStakedAmounts > 0")

    await rewardRouter.connect(user2).signalTransfer(user3.address)

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await gplxVester.setBonusRewards(user2.address, expandDecimals(100, 18))

    expect(await stakedGplxTracker.depositBalances(user2.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user2.address, esGplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).eq(0)

    expect(await feeGplxTracker.depositBalances(user2.address, bnGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).eq(0)

    expect(await feeGplpTracker.depositBalances(user2.address, gplp.address)).eq("299100000000000000000") // 299.1
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(0)

    expect(await stakedGplpTracker.depositBalances(user2.address, feeGplpTracker.address)).eq("299100000000000000000") // 299.1
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(0)

    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(0)
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).eq(0)
    expect(await gplxVester.bonusRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.bonusRewards(user3.address)).eq(0)
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).eq(0)
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).eq(0)
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(892, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(892, 18))).eq(0)

    await rewardRouter.connect(user3).acceptTransfer(user2.address)

    expect(await stakedGplxTracker.depositBalances(user2.address, gplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user2.address, esGplx.address)).eq(0)
    expect(await stakedGplxTracker.depositBalances(user3.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).gt(expandDecimals(1785, 18))
    expect(await stakedGplxTracker.depositBalances(user3.address, esGplx.address)).lt(expandDecimals(1786, 18))

    expect(await feeGplxTracker.depositBalances(user2.address, bnGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).gt("547000000000000000") // 0.547
    expect(await feeGplxTracker.depositBalances(user3.address, bnGplx.address)).lt("549000000000000000") // 0.548

    expect(await feeGplpTracker.depositBalances(user2.address, gplp.address)).eq(0)
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq("299100000000000000000") // 299.1

    expect(await stakedGplpTracker.depositBalances(user2.address, feeGplpTracker.address)).eq(0)
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq("299100000000000000000") // 299.1

    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await gplxVester.bonusRewards(user2.address)).eq(0)
    expect(await gplxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(992, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(993, 18))
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(199, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(200, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(199, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(200, 18))

    await rewardRouter.connect(user1).compound()

    await expect(rewardRouter.connect(user3).acceptTransfer(user1.address))
      .to.be.revertedWith("RewardRouter: transfer not signalled")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouter.connect(user1).claim()
    await rewardRouter.connect(user2).claim()
    await rewardRouter.connect(user3).claim()

    expect(await gplxVester.getCombinedAverageStakedAmount(user1.address)).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user1.address)).lt(expandDecimals(1094, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1094, 18))

    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1885, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1887, 18))
    expect(await gplxVester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1785, 18))
    expect(await gplxVester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1787, 18))

    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(1885, 18))).lt(expandDecimals(1094, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(1785, 18))).lt(expandDecimals(1094, 18))

    await rewardRouter.connect(user1).compound()
    await rewardRouter.connect(user3).compound()

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(1992, 18))
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(1993, 18))

    await gplxVester.connect(user1).deposit(expandDecimals(1785, 18))

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(1991 - 1092, 18)) // 899
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(1993 - 1092, 18)) // 901

    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt(expandDecimals(4, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt(expandDecimals(6, 18))

    await rewardRouter.connect(user1).unstakeGplx(expandDecimals(200, 18))
    await expect(rewardRouter.connect(user1).unstakeEsGplx(expandDecimals(699, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await rewardRouter.connect(user1).unstakeEsGplx(expandDecimals(599, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(97, 18))
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(99, 18))

    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(599, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(601, 18))

    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(200, 18))

    await gplxVester.connect(user1).withdraw()

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18)) // 1190 - 98 => 1092
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(2378, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(2380, 18))

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    expect(await gplpVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1785, 18))
    expect(await gplpVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1787, 18))

    expect(await gplpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).gt(expandDecimals(298, 18))
    expect(await gplpVester.getPairAmount(user3.address, expandDecimals(1785, 18))).lt(expandDecimals(300, 18))

    expect(await stakedGplpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(1785, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(1787, 18))

    expect(await gplx.balanceOf(user3.address)).eq(0)

    await gplpVester.connect(user3).deposit(expandDecimals(1785, 18))

    expect(await stakedGplpTracker.balanceOf(user3.address)).gt(0)
    expect(await stakedGplpTracker.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await esGplx.balanceOf(user3.address)).gt(0)
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(1, 18))

    expect(await gplx.balanceOf(user3.address)).eq(0)

    await expect(rewardRouter.connect(user3).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(1, 18),
      0,
      user3.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await gplpVester.connect(user3).withdraw()

    expect(await stakedGplpTracker.balanceOf(user3.address)).eq("299100000000000000000")

    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(1785 - 5, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(1787 - 5, 18))

    expect(await gplx.balanceOf(user3.address)).gt(expandDecimals(4, 18))
    expect(await gplx.balanceOf(user3.address)).lt(expandDecimals(6, 18))

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(2379, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(2381, 18))

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await gplxVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(743, 18)) // 1190 - 743 => 447
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(754, 18))

    expect(await gplxVester.claimable(user1.address)).eq(0)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await gplxVester.claimable(user1.address)).gt("3900000000000000000") // 3.9
    expect(await gplxVester.claimable(user1.address)).lt("4100000000000000000") // 4.1

    await gplxVester.connect(user1).deposit(expandDecimals(365, 18))

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(522, 18)) // 743 - 522 => 221
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(524, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await gplxVester.claimable(user1.address)).gt("9900000000000000000") // 9.9
    expect(await gplxVester.claimable(user1.address)).lt("10100000000000000000") // 10.1

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(204, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(206, 18))

    await gplxVester.connect(user1).claim()

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(214, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(216, 18))

    await gplxVester.connect(user1).deposit(expandDecimals(365, 18))
    expect(await gplxVester.balanceOf(user1.address)).gt(expandDecimals(1449, 18)) // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await gplxVester.balanceOf(user1.address)).lt(expandDecimals(1451, 18))
    expect(await gplxVester.getVestedAmount(user1.address)).eq(expandDecimals(1460, 18))

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(303, 18)) // 522 - 303 => 219
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(304, 18))

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await gplxVester.claimable(user1.address)).gt("7900000000000000000") // 7.9
    expect(await gplxVester.claimable(user1.address)).lt("8100000000000000000") // 8.1

    await gplxVester.connect(user1).withdraw()

    expect(await feeGplxTracker.balanceOf(user1.address)).gt(expandDecimals(1190, 18))
    expect(await feeGplxTracker.balanceOf(user1.address)).lt(expandDecimals(1191, 18))

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(222, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(224, 18))

    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(2360, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(2362, 18))

    await gplxVester.connect(user1).deposit(expandDecimals(365, 18))

    await increaseTime(provider, 500 * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await gplxVester.claimable(user1.address)).eq(expandDecimals(365, 18))

    await gplxVester.connect(user1).withdraw()

    expect(await gplx.balanceOf(user1.address)).gt(expandDecimals(222 + 365, 18))
    expect(await gplx.balanceOf(user1.address)).lt(expandDecimals(224 + 365, 18))

    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(2360 - 365, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(2362 - 365, 18))

    expect(await gplxVester.transferredAverageStakedAmounts(user2.address)).eq(0)
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.cumulativeRewards(user2.address)).gt(expandDecimals(892, 18))
    expect(await stakedGplxTracker.cumulativeRewards(user2.address)).lt(expandDecimals(893, 18))
    expect(await stakedGplxTracker.cumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await stakedGplxTracker.cumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893, 18))
    expect(await gplxVester.bonusRewards(user2.address)).eq(0)
    expect(await gplxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).eq(expandDecimals(200, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(1092, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(1093, 18))
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await gplxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886, 18))
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(992, 18))).eq(0)
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).gt(expandDecimals(574, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(992, 18))).lt(expandDecimals(575, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(892, 18))).gt(expandDecimals(545, 18))
    expect(await gplxVester.getPairAmount(user1.address, expandDecimals(892, 18))).lt(expandDecimals(546, 18))

    const esGplxBatchSender = await deployContract("EsGplxBatchSender", [esGplx.address])

    await timelock.signalSetHandler(esGplx.address, esGplxBatchSender.address, true)
    await timelock.signalSetHandler(gplxVester.address, esGplxBatchSender.address, true)
    await timelock.signalSetHandler(gplpVester.address, esGplxBatchSender.address, true)
    await timelock.signalMint(esGplx.address, wallet.address, expandDecimals(1000, 18))

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setHandler(esGplx.address, esGplxBatchSender.address, true)
    await timelock.setHandler(gplxVester.address, esGplxBatchSender.address, true)
    await timelock.setHandler(gplpVester.address, esGplxBatchSender.address, true)
    await timelock.processMint(esGplx.address, wallet.address, expandDecimals(1000, 18))

    await esGplxBatchSender.connect(wallet).send(
      gplxVester.address,
      4,
      [user2.address, user3.address],
      [expandDecimals(100, 18), expandDecimals(200, 18)]
    )

    expect(await gplxVester.transferredAverageStakedAmounts(user2.address)).gt(expandDecimals(37648, 18))
    expect(await gplxVester.transferredAverageStakedAmounts(user2.address)).lt(expandDecimals(37649, 18))
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).gt(expandDecimals(12810, 18))
    expect(await gplxVester.transferredAverageStakedAmounts(user3.address)).lt(expandDecimals(12811, 18))
    expect(await gplxVester.transferredCumulativeRewards(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).gt(expandDecimals(892 + 200, 18))
    expect(await gplxVester.transferredCumulativeRewards(user3.address)).lt(expandDecimals(893 + 200, 18))
    expect(await gplxVester.bonusRewards(user2.address)).eq(0)
    expect(await gplxVester.bonusRewards(user3.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).gt(expandDecimals(3971, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user2.address)).lt(expandDecimals(3972, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).gt(expandDecimals(7943, 18))
    expect(await gplxVester.getCombinedAverageStakedAmount(user3.address)).lt(expandDecimals(7944, 18))
    expect(await gplxVester.getMaxVestableAmount(user2.address)).eq(expandDecimals(100, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).gt(expandDecimals(1884 + 200, 18))
    expect(await gplxVester.getMaxVestableAmount(user3.address)).lt(expandDecimals(1886 + 200, 18))
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(100, 18))).gt(expandDecimals(3971, 18))
    expect(await gplxVester.getPairAmount(user2.address, expandDecimals(100, 18))).lt(expandDecimals(3972, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).gt(expandDecimals(7936, 18))
    expect(await gplxVester.getPairAmount(user3.address, expandDecimals(1884 + 200, 18))).lt(expandDecimals(7937, 18))

    expect(await gplpVester.transferredAverageStakedAmounts(user4.address)).eq(0)
    expect(await gplpVester.transferredCumulativeRewards(user4.address)).eq(0)
    expect(await gplpVester.bonusRewards(user4.address)).eq(0)
    expect(await gplpVester.getCombinedAverageStakedAmount(user4.address)).eq(0)
    expect(await gplpVester.getMaxVestableAmount(user4.address)).eq(0)
    expect(await gplpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(0)

    await esGplxBatchSender.connect(wallet).send(
      gplpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await gplpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(3200, 18))
    expect(await gplpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(10, 18))
    expect(await gplpVester.bonusRewards(user4.address)).eq(0)
    expect(await gplpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(3200, 18))
    expect(await gplpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(10, 18))
    expect(await gplpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))

    await esGplxBatchSender.connect(wallet).send(
      gplpVester.address,
      320,
      [user4.address],
      [expandDecimals(10, 18)]
    )

    expect(await gplpVester.transferredAverageStakedAmounts(user4.address)).eq(expandDecimals(6400, 18))
    expect(await gplpVester.transferredCumulativeRewards(user4.address)).eq(expandDecimals(20, 18))
    expect(await gplpVester.bonusRewards(user4.address)).eq(0)
    expect(await gplpVester.getCombinedAverageStakedAmount(user4.address)).eq(expandDecimals(6400, 18))
    expect(await gplpVester.getMaxVestableAmount(user4.address)).eq(expandDecimals(20, 18))
    expect(await gplpVester.getPairAmount(user4.address, expandDecimals(10, 18))).eq(expandDecimals(3200, 18))
  })

  it("handleRewards", async () => {
    const timelockV2 = wallet

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = await deployContract("RewardRouterV2", [])
    await rewardRouterV2.initialize(
      eth.address,
      gplx.address,
      esGplx.address,
      bnGplx.address,
      gplp.address,
      stakedGplxTracker.address,
      bonusGplxTracker.address,
      feeGplxTracker.address,
      feeGplpTracker.address,
      stakedGplpTracker.address,
      gplpManager.address,
      gplxVester.address,
      gplpVester.address
    )

    await timelock.signalSetGov(gplpManager.address, timelockV2.address)
    await timelock.signalSetGov(stakedGplxTracker.address, timelockV2.address)
    await timelock.signalSetGov(bonusGplxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeGplxTracker.address, timelockV2.address)
    await timelock.signalSetGov(feeGplpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedGplpTracker.address, timelockV2.address)
    await timelock.signalSetGov(stakedGplxDistributor.address, timelockV2.address)
    await timelock.signalSetGov(stakedGplpDistributor.address, timelockV2.address)
    await timelock.signalSetGov(esGplx.address, timelockV2.address)
    await timelock.signalSetGov(bnGplx.address, timelockV2.address)
    await timelock.signalSetGov(gplxVester.address, timelockV2.address)
    await timelock.signalSetGov(gplpVester.address, timelockV2.address)

    await increaseTime(provider, 20)
    await mineBlock(provider)

    await timelock.setGov(gplpManager.address, timelockV2.address)
    await timelock.setGov(stakedGplxTracker.address, timelockV2.address)
    await timelock.setGov(bonusGplxTracker.address, timelockV2.address)
    await timelock.setGov(feeGplxTracker.address, timelockV2.address)
    await timelock.setGov(feeGplpTracker.address, timelockV2.address)
    await timelock.setGov(stakedGplpTracker.address, timelockV2.address)
    await timelock.setGov(stakedGplxDistributor.address, timelockV2.address)
    await timelock.setGov(stakedGplpDistributor.address, timelockV2.address)
    await timelock.setGov(esGplx.address, timelockV2.address)
    await timelock.setGov(bnGplx.address, timelockV2.address)
    await timelock.setGov(gplxVester.address, timelockV2.address)
    await timelock.setGov(gplpVester.address, timelockV2.address)

    await esGplx.setHandler(rewardRouterV2.address, true)
    await esGplx.setHandler(stakedGplxDistributor.address, true)
    await esGplx.setHandler(stakedGplpDistributor.address, true)
    await esGplx.setHandler(stakedGplxTracker.address, true)
    await esGplx.setHandler(stakedGplpTracker.address, true)
    await esGplx.setHandler(gplxVester.address, true)
    await esGplx.setHandler(gplpVester.address, true)

    await gplpManager.setHandler(rewardRouterV2.address, true)
    await stakedGplxTracker.setHandler(rewardRouterV2.address, true)
    await bonusGplxTracker.setHandler(rewardRouterV2.address, true)
    await feeGplxTracker.setHandler(rewardRouterV2.address, true)
    await feeGplpTracker.setHandler(rewardRouterV2.address, true)
    await stakedGplpTracker.setHandler(rewardRouterV2.address, true)

    await esGplx.setHandler(rewardRouterV2.address, true)
    await bnGplx.setMinter(rewardRouterV2.address, true)
    await esGplx.setMinter(gplxVester.address, true)
    await esGplx.setMinter(gplpVester.address, true)

    await gplxVester.setHandler(rewardRouterV2.address, true)
    await gplpVester.setHandler(rewardRouterV2.address, true)

    await feeGplxTracker.setHandler(gplxVester.address, true)
    await stakedGplpTracker.setHandler(gplpVester.address, true)

    await eth.deposit({ value: expandDecimals(10, 18) })

    await gplx.setMinter(wallet.address, true)
    await gplx.mint(gplxVester.address, expandDecimals(10000, 18))
    await gplx.mint(gplpVester.address, expandDecimals(10000, 18))

    await eth.mint(feeGplpDistributor.address, expandDecimals(50, 18))
    await feeGplpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await eth.mint(feeGplxDistributor.address, expandDecimals(50, 18))
    await feeGplxDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouterV2.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    await gplx.mint(user1.address, expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(200, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(200, 18))
    await rewardRouterV2.connect(user1).stakeGplx(expandDecimals(200, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).eq(0)

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).eq(0)
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).eq(0)

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimGplx
      true, // _shouldStakeGplx
      true, // _shouldClaimEsGplx
      true, // _shouldStakeEsGplx
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(3572, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("540000000000000000") // 0.54
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    const ethBalance0 = await provider.getBalance(user1.address)

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimGplx
      false, // _shouldStakeGplx
      false, // _shouldClaimEsGplx
      false, // _shouldStakeEsGplx
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true // _shouldConvertWethToEth
    )

    const ethBalance1 = await provider.getBalance(user1.address)

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(3572, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("540000000000000000") // 0.54
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("560000000000000000") // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimGplx
      false, // _shouldStakeGplx
      true, // _shouldClaimEsGplx
      false, // _shouldStakeEsGplx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(3571, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(3572, 18))
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(3572, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("540000000000000000") // 0.54
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("560000000000000000") // 0.56

    await gplxVester.connect(user1).deposit(expandDecimals(365, 18))
    await gplpVester.connect(user1).deposit(expandDecimals(365 * 2, 18))

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(3572, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("540000000000000000") // 0.54
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("560000000000000000") // 0.56

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimGplx
      false, // _shouldStakeGplx
      false, // _shouldClaimEsGplx
      false, // _shouldStakeEsGplx
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    )

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18))
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18))
    expect(await gplx.balanceOf(user1.address)).gt("2900000000000000000") // 2.9
    expect(await gplx.balanceOf(user1.address)).lt("3100000000000000000") // 3.1
    expect(await esGplx.balanceOf(user1.address)).gt(expandDecimals(3571 - 365 * 3, 18))
    expect(await esGplx.balanceOf(user1.address)).lt(expandDecimals(3572 - 365 * 3, 18))
    expect(await bnGplx.balanceOf(user1.address)).eq(0)
    expect(await gplp.balanceOf(user1.address)).eq(0)
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18))
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18))

    expect(await stakedGplxTracker.depositBalances(user1.address, gplx.address)).eq(expandDecimals(200, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).gt(expandDecimals(3571, 18))
    expect(await stakedGplxTracker.depositBalances(user1.address, esGplx.address)).lt(expandDecimals(3572, 18))
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).gt("540000000000000000") // 0.54
    expect(await feeGplxTracker.depositBalances(user1.address, bnGplx.address)).lt("560000000000000000") // 0.56
  })

  it("StakedGplp", async () => {
    await eth.mint(feeGplpDistributor.address, expandDecimals(100, 18))
    await feeGplpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))

    const stakedGplp = await deployContract("StakedGplp", [gplp.address, gplpManager.address, stakedGplpTracker.address, feeGplpTracker.address])

    await expect(stakedGplp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedGplp: transfer amount exceeds allowance")

    await stakedGplp.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(stakedGplp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("StakedGplp: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(stakedGplp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(stakedGplpTracker.address, stakedGplp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedGplpTracker.address, stakedGplp.address, true)

    await expect(stakedGplp.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await timelock.signalSetHandler(feeGplpTracker.address, stakedGplp.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(feeGplpTracker.address, stakedGplp.address, true)

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(0)

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(0)

    await stakedGplp.connect(user2).transferFrom(user1.address, user3. address, expandDecimals(2991, 17))

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(0)

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(0)
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(0)

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))

    await expect(stakedGplp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("StakedGplp: transfer amount exceeds allowance")

    await stakedGplp.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(stakedGplp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(3000, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    await stakedGplp.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(1000, 17))

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(1000, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(1000, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(1000, 17))

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(expandDecimals(1991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(1991, 17))
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(expandDecimals(1991, 17))

    await stakedGplp.connect(user3).transfer(user1.address, expandDecimals(1500, 17))

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2500, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2500, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2500, 17))

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(expandDecimals(491, 17))

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(expandDecimals(491, 17))
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(expandDecimals(491, 17))

    await expect(stakedGplp.connect(user3).transfer(user1.address, expandDecimals(492, 17)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333")

    await usdg.addVault(gplpManager.address)

    expect(await bnb.balanceOf(user3.address)).eq("0")

    await rewardRouter.connect(user3).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address
    )

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666")
  })

  it("FeeGplp", async () => {
    await eth.mint(feeGplpDistributor.address, expandDecimals(100, 18))
    await feeGplpDistributor.setTokensPerInterval("41335970000000") // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18))
    await bnb.connect(user1).approve(gplpManager.address, expandDecimals(1, 18))
    await rewardRouter.connect(user1).mintAndStakeGplp(
      bnb.address,
      expandDecimals(1, 18),
      expandDecimals(299, 18),
      expandDecimals(299, 18)
    )

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))

    const gplpBalance = await deployContract("GplpBalance", [gplpManager.address, stakedGplpTracker.address])

    await expect(gplpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("GplpBalance: transfer amount exceeds allowance")

    await gplpBalance.connect(user1).approve(user2.address, expandDecimals(2991, 17))

    await expect(gplpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("GplpBalance: cooldown duration not yet passed")

    await increaseTime(provider, 24 * 60 * 60 + 10)
    await mineBlock(provider)

    await expect(gplpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds allowance")

    await timelock.signalSetHandler(stakedGplpTracker.address, gplpBalance.address, true)
    await increaseTime(provider, 20)
    await mineBlock(provider)
    await timelock.setHandler(stakedGplpTracker.address, gplpBalance.address, true)

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.balanceOf(user1.address)).eq(expandDecimals(2991, 17))

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(0)

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(0)
    expect(await stakedGplpTracker.balanceOf(user3.address)).eq(0)

    await gplpBalance.connect(user2).transferFrom(user1.address, user3.address, expandDecimals(2991, 17))

    expect(await feeGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await feeGplpTracker.depositBalances(user1.address, gplp.address)).eq(expandDecimals(2991, 17))

    expect(await stakedGplpTracker.stakedAmounts(user1.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.depositBalances(user1.address, feeGplpTracker.address)).eq(expandDecimals(2991, 17))
    expect(await stakedGplpTracker.balanceOf(user1.address)).eq(0)

    expect(await feeGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await feeGplpTracker.depositBalances(user3.address, gplp.address)).eq(0)

    expect(await stakedGplpTracker.stakedAmounts(user3.address)).eq(0)
    expect(await stakedGplpTracker.depositBalances(user3.address, feeGplpTracker.address)).eq(0)
    expect(await stakedGplpTracker.balanceOf(user3.address)).eq(expandDecimals(2991, 17))

    await expect(rewardRouter.connect(user1).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )).to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await gplpBalance.connect(user3).approve(user2.address, expandDecimals(3000, 17))

    await expect(gplpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2992, 17)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await gplpBalance.connect(user2).transferFrom(user3.address, user1.address, expandDecimals(2991, 17))

    expect(await bnb.balanceOf(user1.address)).eq(0)

    await rewardRouter.connect(user1).unstakeAndRedeemGplp(
      bnb.address,
      expandDecimals(2991, 17),
      "0",
      user1.address
    )

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000")
  })
})
