const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("BonusDistributor", function () {
  const provider = waffle.provider
  const [wallet, rewardRouter, user0, user1, user2, user3] = provider.getWallets()
  let gplx
  let esGplx
  let bnGplx
  let stakedGplxTracker
  let stakedGplxDistributor
  let bonusGplxTracker
  let bonusGplxDistributor

  beforeEach(async () => {
    gplx = await deployContract("GPLX", []);
    esGplx = await deployContract("EsGPLX", []);
    bnGplx = await deployContract("MintableBaseToken", ["Bonus GPLX", "bnGPLX", 0]);

    stakedGplxTracker = await deployContract("RewardTracker", ["Staked GPLX", "stGPLX"])
    stakedGplxDistributor = await deployContract("RewardDistributor", [esGplx.address, stakedGplxTracker.address])
    await stakedGplxDistributor.updateLastDistributionTime()

    bonusGplxTracker = await deployContract("RewardTracker", ["Staked + Bonus GPLX", "sbGPLX"])
    bonusGplxDistributor = await deployContract("BonusDistributor", [bnGplx.address, bonusGplxTracker.address])
    await bonusGplxDistributor.updateLastDistributionTime()

    await stakedGplxTracker.initialize([gplx.address, esGplx.address], stakedGplxDistributor.address)
    await bonusGplxTracker.initialize([stakedGplxTracker.address], bonusGplxDistributor.address)

    await stakedGplxTracker.setInPrivateTransferMode(true)
    await stakedGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateTransferMode(true)
    await bonusGplxTracker.setInPrivateStakingMode(true)

    await stakedGplxTracker.setHandler(rewardRouter.address, true)
    await stakedGplxTracker.setHandler(bonusGplxTracker.address, true)
    await bonusGplxTracker.setHandler(rewardRouter.address, true)
    await bonusGplxDistributor.setBonusMultiplier(10000)
  })

  it("distributes bonus", async () => {
    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(stakedGplxDistributor.address, expandDecimals(50000, 18))
    await bnGplx.setMinter(wallet.address, true)
    await bnGplx.mint(bonusGplxDistributor.address, expandDecimals(1500, 18))
    await stakedGplxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(user0.address, expandDecimals(1000, 18))

    await gplx.connect(user0).approve(stakedGplxTracker.address, expandDecimals(1001, 18))
    await expect(stakedGplxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, gplx.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")
    await stakedGplxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, gplx.address, expandDecimals(1000, 18))
    await expect(bonusGplxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedGplxTracker.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")
    await bonusGplxTracker.connect(rewardRouter).stakeForAccount(user0.address, user0.address, stakedGplxTracker.address, expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await stakedGplxTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))
    expect(await bonusGplxTracker.claimable(user0.address)).gt("2730000000000000000") // 2.73, 1000 / 365 => ~2.74
    expect(await bonusGplxTracker.claimable(user0.address)).lt("2750000000000000000") // 2.75

    await esGplx.mint(user1.address, expandDecimals(500, 18))
    await esGplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(500, 18))
    await stakedGplxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, esGplx.address, expandDecimals(500, 18))
    await bonusGplxTracker.connect(rewardRouter).stakeForAccount(user1.address, user1.address, stakedGplxTracker.address, expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await stakedGplxTracker.claimable(user0.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await stakedGplxTracker.claimable(user1.address)).gt(expandDecimals(595, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await bonusGplxTracker.claimable(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusGplxTracker.claimable(user0.address)).lt("5490000000000000000") // 5.49

    expect(await bonusGplxTracker.claimable(user1.address)).gt("1360000000000000000") // 1.36, 500 / 365 => ~1.37
    expect(await bonusGplxTracker.claimable(user1.address)).lt("1380000000000000000") // 1.38
  })
})
