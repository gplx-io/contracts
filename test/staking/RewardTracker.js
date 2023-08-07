const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

describe("RewardTracker", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let rewardTracker
  let gplx
  let esGplx
  let rewardDistributor

  beforeEach(async () => {
    rewardTracker = await deployContract("RewardTracker", ["RT_NAME", "RT_SYMBOL"])
    gplx = await deployContract("GPLX", []);
    esGplx = await deployContract("EsGPLX", []);
    rewardDistributor = await deployContract("RewardDistributor", [esGplx.address, rewardTracker.address])
    await rewardDistributor.updateLastDistributionTime()

    await rewardTracker.initialize([gplx.address, esGplx.address], rewardDistributor.address)
  })

  it("inits", async () => {
    expect(await rewardTracker.isInitialized()).eq(true)
    expect(await rewardTracker.isDepositToken(wallet.address)).eq(false)
    expect(await rewardTracker.isDepositToken(gplx.address)).eq(true)
    expect(await rewardTracker.isDepositToken(esGplx.address)).eq(true)
    expect(await rewardTracker.distributor()).eq(rewardDistributor.address)
    expect(await rewardTracker.distributor()).eq(rewardDistributor.address)
    expect(await rewardTracker.rewardToken()).eq(esGplx.address)

    await expect(rewardTracker.initialize([gplx.address, esGplx.address], rewardDistributor.address))
      .to.be.revertedWith("RewardTracker: already initialized")
  })

  it("setDepositToken", async () => {
    await expect(rewardTracker.connect(user0).setDepositToken(user1.address, true))
      .to.be.revertedWith("Governable: forbidden")

    await rewardTracker.setGov(user0.address)

    expect(await rewardTracker.isDepositToken(user1.address)).eq(false)
    await rewardTracker.connect(user0).setDepositToken(user1.address, true)
    expect(await rewardTracker.isDepositToken(user1.address)).eq(true)
    await rewardTracker.connect(user0).setDepositToken(user1.address, false)
    expect(await rewardTracker.isDepositToken(user1.address)).eq(false)
  })

  it("setInPrivateTransferMode", async () => {
    await expect(rewardTracker.connect(user0).setInPrivateTransferMode(true))
      .to.be.revertedWith("Governable: forbidden")

    await rewardTracker.setGov(user0.address)

    expect(await rewardTracker.inPrivateTransferMode()).eq(false)
    await rewardTracker.connect(user0).setInPrivateTransferMode(true)
    expect(await rewardTracker.inPrivateTransferMode()).eq(true)
  })

  it("setInPrivateStakingMode", async () => {
    await expect(rewardTracker.connect(user0).setInPrivateStakingMode(true))
      .to.be.revertedWith("Governable: forbidden")

    await rewardTracker.setGov(user0.address)

    expect(await rewardTracker.inPrivateStakingMode()).eq(false)
    await rewardTracker.connect(user0).setInPrivateStakingMode(true)
    expect(await rewardTracker.inPrivateStakingMode()).eq(true)
  })

  it("setHandler", async () => {
    await expect(rewardTracker.connect(user0).setHandler(user1.address, true))
      .to.be.revertedWith("Governable: forbidden")

    await rewardTracker.setGov(user0.address)

    expect(await rewardTracker.isHandler(user1.address)).eq(false)
    await rewardTracker.connect(user0).setHandler(user1.address, true)
    expect(await rewardTracker.isHandler(user1.address)).eq(true)
  })

  it("withdrawToken", async () => {
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(rewardTracker.address, 2000)
    await expect(rewardTracker.connect(user0).withdrawToken(gplx.address, user1.address, 2000))
      .to.be.revertedWith("Governable: forbidden")

    await rewardTracker.setGov(user0.address)

    expect(await gplx.balanceOf(user1.address)).eq(0)
    await rewardTracker.connect(user0).withdrawToken(gplx.address, user1.address, 2000)
    expect(await gplx.balanceOf(user1.address)).eq(2000)
  })

  it("stake, unstake, claim", async () => {
    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(rewardDistributor.address, expandDecimals(50000, 18))
    await rewardDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(user0.address, expandDecimals(1000, 18))

    await rewardTracker.setInPrivateStakingMode(true)
    await expect(rewardTracker.connect(user0).stake(gplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("RewardTracker: action not enabled")

    await rewardTracker.setInPrivateStakingMode(false)

    await expect(rewardTracker.connect(user0).stake(user1.address, 0))
      .to.be.revertedWith("RewardTracker: invalid _amount")

    await expect(rewardTracker.connect(user0).stake(user1.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("RewardTracker: invalid _depositToken")

    await expect(rewardTracker.connect(user0).stake(gplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await gplx.connect(user0).approve(rewardTracker.address, expandDecimals(1000, 18))
    await rewardTracker.connect(user0).stake(gplx.address, expandDecimals(1000, 18))
    expect(await rewardTracker.stakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.depositBalances(user0.address, gplx.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await rewardTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await rewardTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))

    await esGplx.mint(user1.address, expandDecimals(500, 18))
    await esGplx.connect(user1).approve(rewardTracker.address, expandDecimals(500, 18))
    await rewardTracker.connect(user1).stake(esGplx.address, expandDecimals(500, 18))
    expect(await rewardTracker.stakedAmounts(user1.address)).eq(expandDecimals(500, 18))
    expect(await rewardTracker.stakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.depositBalances(user0.address, gplx.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.depositBalances(user0.address, esGplx.address)).eq(0)
    expect(await rewardTracker.depositBalances(user1.address, gplx.address)).eq(0)
    expect(await rewardTracker.depositBalances(user1.address, esGplx.address)).eq(expandDecimals(500, 18))
    expect(await rewardTracker.totalDepositSupply(gplx.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.totalDepositSupply(esGplx.address)).eq(expandDecimals(500, 18))

    expect(await rewardTracker.averageStakedAmounts(user0.address)).eq(0)
    expect(await rewardTracker.cumulativeRewards(user0.address)).eq(0)
    expect(await rewardTracker.averageStakedAmounts(user1.address)).eq(0)
    expect(await rewardTracker.cumulativeRewards(user1.address)).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await rewardTracker.claimable(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await rewardTracker.claimable(user0.address)).lt(expandDecimals(1786 + 1191, 18))

    expect(await rewardTracker.claimable(user1.address)).gt(expandDecimals(595, 18))
    expect(await rewardTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    await expect(rewardTracker.connect(user0).unstake(esGplx.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await expect(rewardTracker.connect(user0).unstake(esGplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");

    await expect(rewardTracker.connect(user0).unstake(gplx.address, expandDecimals(1001, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    expect(await gplx.balanceOf(user0.address)).eq(0)
    await rewardTracker.connect(user0).unstake(gplx.address, expandDecimals(1000, 18))
    expect(await gplx.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.totalDepositSupply(gplx.address)).eq(0)
    expect(await rewardTracker.totalDepositSupply(esGplx.address)).eq(expandDecimals(500, 18))

    expect(await rewardTracker.averageStakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).gt(expandDecimals(1785+ 1190, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).lt(expandDecimals(1786+ 1191, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).eq(0)
    expect(await rewardTracker.cumulativeRewards(user1.address)).eq(0)

    await expect(rewardTracker.connect(user0).unstake(gplx.address, 1))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    await rewardTracker.connect(user0).claim(user2.address)
    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(1786 + 1191, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await rewardTracker.claimable(user0.address)).eq(0)

    expect(await rewardTracker.claimable(user1.address)).gt(expandDecimals(595 + 1785, 18))
    expect(await rewardTracker.claimable(user1.address)).lt(expandDecimals(596 + 1786, 18))

    await gplx.mint(user1.address, expandDecimals(300, 18))
    await gplx.connect(user1).approve(rewardTracker.address, expandDecimals(300, 18))
    await rewardTracker.connect(user1).stake(gplx.address, expandDecimals(300, 18))
    expect(await rewardTracker.totalDepositSupply(gplx.address)).eq(expandDecimals(300, 18))
    expect(await rewardTracker.totalDepositSupply(esGplx.address)).eq(expandDecimals(500, 18))

    expect(await rewardTracker.averageStakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).gt(expandDecimals(1785+ 1190, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).lt(expandDecimals(1786+ 1191, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).eq(expandDecimals(500, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).gt(expandDecimals(595 + 1785, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).lt(expandDecimals(596 + 1786, 18))

    await expect(rewardTracker.connect(user1).unstake(gplx.address, expandDecimals(301, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");

    await expect(rewardTracker.connect(user1).unstake(esGplx.address, expandDecimals(501, 18)))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");

    await increaseTime(provider, 2 * 24 * 60 * 60)
    await mineBlock(provider)

    await rewardTracker.connect(user0).claim(user2.address)
    await rewardTracker.connect(user1).claim(user3.address)

    expect(await rewardTracker.averageStakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).gt(expandDecimals(679, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).lt(expandDecimals(681, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).gt(expandDecimals(595 + 1785 + 1785 * 2, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).lt(expandDecimals(596 + 1786 + 1786 * 2, 18))

    await increaseTime(provider, 2 * 24 * 60 * 60)
    await mineBlock(provider)

    await rewardTracker.connect(user0).claim(user2.address)
    await rewardTracker.connect(user1).claim(user3.address)

    expect(await rewardTracker.averageStakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).gt(expandDecimals(1785 + 1190, 18))
    expect(await rewardTracker.cumulativeRewards(user0.address)).lt(expandDecimals(1786 + 1191, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).gt(expandDecimals(724, 18))
    expect(await rewardTracker.averageStakedAmounts(user1.address)).lt(expandDecimals(726, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).gt(expandDecimals(595 + 1785 + 1785 * 4, 18))
    expect(await rewardTracker.cumulativeRewards(user1.address)).lt(expandDecimals(596 + 1786 + 1786 * 4, 18))

    expect(await esGplx.balanceOf(user2.address)).eq(await rewardTracker.cumulativeRewards(user0.address))
    expect(await esGplx.balanceOf(user3.address)).eq(await rewardTracker.cumulativeRewards(user1.address))

    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    await rewardTracker.connect(user1).unstake(gplx.address, expandDecimals(300, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(300, 18))
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    await rewardTracker.connect(user1).unstake(esGplx.address, expandDecimals(500, 18))
    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(300, 18))
    expect(await esGplx.balanceOf(user1.address)).eq(expandDecimals(500, 18))
    expect(await rewardTracker.totalDepositSupply(gplx.address)).eq(0)
    expect(await rewardTracker.totalDepositSupply(esGplx.address)).eq(0)

    await rewardTracker.connect(user0).claim(user2.address)
    await rewardTracker.connect(user1).claim(user3.address)

    const distributed = expandDecimals(50000, 18).sub(await esGplx.balanceOf(rewardDistributor.address))
    const cumulativeReward0 = await rewardTracker.cumulativeRewards(user0.address)
    const cumulativeReward1 = await rewardTracker.cumulativeRewards(user1.address)
    const totalCumulativeReward = cumulativeReward0.add(cumulativeReward1)

    expect(distributed).gt(totalCumulativeReward.sub(expandDecimals(1, 18)))
    expect(distributed).lt(totalCumulativeReward.add(expandDecimals(1, 18)))
  })

  it("stakeForAccount, unstakeForAccount, claimForAccount", async () => {
    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(rewardDistributor.address, expandDecimals(50000, 18))
    await rewardDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(wallet.address, expandDecimals(1000, 18))

    await rewardTracker.setInPrivateStakingMode(true)
    await expect(rewardTracker.connect(user0).stake(gplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("RewardTracker: action not enabled")

    await expect(rewardTracker.connect(user2).stakeForAccount(wallet.address, user0.address, gplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await rewardTracker.setHandler(user2.address, true)
    await expect(rewardTracker.connect(user2).stakeForAccount(wallet.address, user0.address, gplx.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await gplx.connect(wallet).approve(rewardTracker.address, expandDecimals(1000, 18))

    await rewardTracker.connect(user2).stakeForAccount(wallet.address, user0.address, gplx.address, expandDecimals(1000, 18))
    expect(await rewardTracker.stakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.depositBalances(user0.address, gplx.address)).eq(expandDecimals(1000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await rewardTracker.claimable(user0.address)).gt(expandDecimals(1785, 18)) // 50000 / 28 => ~1785
    expect(await rewardTracker.claimable(user0.address)).lt(expandDecimals(1786, 18))

    await rewardTracker.setHandler(user2.address, false)
    await expect(rewardTracker.connect(user2).unstakeForAccount(user0.address, esGplx.address, expandDecimals(1000, 18), user1.address))
      .to.be.revertedWith("RewardTracker: forbidden")

    await rewardTracker.setHandler(user2.address, true)

    await expect(rewardTracker.connect(user2).unstakeForAccount(user0.address, esGplx.address, expandDecimals(1000, 18), user1.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds depositBalance")

    await expect(rewardTracker.connect(user2).unstakeForAccount(user0.address, gplx.address, expandDecimals(1001, 18), user1.address))
      .to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount")

    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await rewardTracker.stakedAmounts(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.depositBalances(user0.address, gplx.address)).eq(expandDecimals(1000, 18))

    expect(await rewardTracker.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    await rewardTracker.connect(user0).transfer(user1.address, expandDecimals(50, 18))
    expect(await rewardTracker.balanceOf(user0.address)).eq(expandDecimals(950, 18))
    expect(await rewardTracker.balanceOf(user1.address)).eq(expandDecimals(50, 18))

    await rewardTracker.setInPrivateTransferMode(true)
    await expect(rewardTracker.connect(user0).transfer(user1.address, expandDecimals(50, 18)))
      .to.be.revertedWith("RewardTracker: forbidden")

    await rewardTracker.setHandler(user2.address, false)
    await expect(rewardTracker.connect(user2).transferFrom(user1.address, user0.address, expandDecimals(50, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds allowance")

    await rewardTracker.setHandler(user2.address, true)
    await rewardTracker.connect(user2).transferFrom(user1.address, user0.address, expandDecimals(50, 18))
    expect(await rewardTracker.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await rewardTracker.balanceOf(user1.address)).eq(0)

    await rewardTracker.connect(user2).unstakeForAccount(user0.address, gplx.address, expandDecimals(100, 18), user1.address)

    expect(await gplx.balanceOf(user1.address)).eq(expandDecimals(100, 18))
    expect(await rewardTracker.stakedAmounts(user0.address)).eq(expandDecimals(900, 18))
    expect(await rewardTracker.depositBalances(user0.address, gplx.address)).eq(expandDecimals(900, 18))

    await expect(rewardTracker.connect(user3).claimForAccount(user0.address, user3.address))
      .to.be.revertedWith("RewardTracker: forbidden")

    expect(await rewardTracker.claimable(user0.address)).gt(expandDecimals(1785, 18))
    expect(await rewardTracker.claimable(user0.address)).lt(expandDecimals(1787, 18))
    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user3.address)).eq(0)

    await rewardTracker.connect(user2).claimForAccount(user0.address, user3.address)

    expect(await rewardTracker.claimable(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(1785, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(1787, 18))
  })
})
