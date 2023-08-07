const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print, newWallet } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")
const { initVault, getBnbConfig, getBtcConfig, getDaiConfig } = require("../core/Vault/helpers")
const { ADDRESS_ZERO } = require("@uniswap/v3-sdk")

use(solidity)

describe("RewardRouter", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()

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

    rewardRouter = await deployContract("RewardRouter", [])
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
      gplpManager.address
    )

    // allow rewardRouter to stake in stakedGplxTracker
    await stakedGplxTracker.setHandler(rewardRouter.address, true)
    // allow bonusGplxTracker to stake stakedGplxTracker
    await stakedGplxTracker.setHandler(bonusGplxTracker.address, true)
    // allow rewardRouter to stake in bonusGplxTracker
    await bonusGplxTracker.setHandler(rewardRouter.address, true)
    // allow bonusGplxTracker to stake feeGplxTracker
    await bonusGplxTracker.setHandler(feeGplxTracker.address, true)
    await bonusGplxDistributor.setBonusMultiplier(10000)
    // allow rewardRouter to stake in feeGplxTracker
    await feeGplxTracker.setHandler(rewardRouter.address, true)
    // allow feeGplxTracker to stake bnGplx
    await bnGplx.setHandler(feeGplxTracker.address, true)
    // allow rewardRouter to burn bnGplx
    await bnGplx.setMinter(rewardRouter.address, true)

    // allow rewardRouter to mint in gplpManager
    await gplpManager.setHandler(rewardRouter.address, true)
    // allow rewardRouter to stake in feeGplpTracker
    await feeGplpTracker.setHandler(rewardRouter.address, true)
    // allow stakedGplpTracker to stake feeGplpTracker
    await feeGplpTracker.setHandler(stakedGplpTracker.address, true)
    // allow rewardRouter to sake in stakedGplpTracker
    await stakedGplpTracker.setHandler(rewardRouter.address, true)
    // allow feeGplpTracker to stake gplp
    await gplp.setHandler(feeGplpTracker.address, true)

    // mint esGplx for distributors
    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(stakedGplxDistributor.address, expandDecimals(50000, 18))
    await stakedGplxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second
    await esGplx.mint(stakedGplpDistributor.address, expandDecimals(50000, 18))
    await stakedGplpDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second

    await esGplx.setInPrivateTransferMode(true)
    await esGplx.setHandler(stakedGplxDistributor.address, true)
    await esGplx.setHandler(stakedGplpDistributor.address, true)
    await esGplx.setHandler(stakedGplxTracker.address, true)
    await esGplx.setHandler(stakedGplpTracker.address, true)
    await esGplx.setHandler(rewardRouter.address, true)

    // mint bnGplx for distributor
    await bnGplx.setMinter(wallet.address, true)
    await bnGplx.mint(bonusGplxDistributor.address, expandDecimals(1500, 18))
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
      gplpManager.address
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

    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(user2.address, expandDecimals(500, 18))
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
})
