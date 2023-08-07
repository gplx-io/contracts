const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed, print } = require("../shared/utilities")
const { toChainlinkPrice } = require("../shared/chainlink")
const { toUsd, toNormalizedPrice } = require("../shared/units")

use(solidity)

const secondsPerYear = 365 * 24 * 60 * 60
const { AddressZero } = ethers.constants

describe("Vester", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3, user4] = provider.getWallets()
  let gplx
  let esGplx
  let bnGplx
  let eth

  beforeEach(async () => {
    gplx = await deployContract("GPLX", []);
    esGplx = await deployContract("EsGPLX", []);
    bnGplx = await deployContract("MintableBaseToken", ["Bonus GPLX", "bnGPLX", 0]);
    eth = await deployContract("Token", [])

    await esGplx.setMinter(wallet.address, true)
    await gplx.setMinter(wallet.address, true)
  })

  it("inits", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])

    expect(await vester.name()).eq("Vested GPLX")
    expect(await vester.symbol()).eq("veGPLX")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esGplx.address)
    expect(await vester.pairToken()).eq(AddressZero)
    expect(await vester.claimableToken()).eq(gplx.address)
    expect(await vester.rewardTracker()).eq(AddressZero)
    expect(await vester.hasPairToken()).eq(false)
    expect(await vester.hasRewardTracker()).eq(false)
    expect(await vester.hasMaxVestableAmount()).eq(false)
  })

  it("setTransferredAverageStakedAmounts", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])

    await expect(vester.setTransferredAverageStakedAmounts(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.transferredAverageStakedAmounts(user0.address)).eq(0)
    await vester.setTransferredAverageStakedAmounts(user0.address, 200)
    expect(await vester.transferredAverageStakedAmounts(user0.address)).eq(200)
  })

  it("setTransferredCumulativeRewards", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])

    await expect(vester.setTransferredCumulativeRewards(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.transferredCumulativeRewards(user0.address)).eq(0)
    await vester.setTransferredCumulativeRewards(user0.address, 200)
    expect(await vester.transferredCumulativeRewards(user0.address)).eq(200)
  })

  it("setCumulativeRewardDeductions", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])

    await expect(vester.setCumulativeRewardDeductions(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.cumulativeRewardDeductions(user0.address)).eq(0)
    await vester.setCumulativeRewardDeductions(user0.address, 200)
    expect(await vester.cumulativeRewardDeductions(user0.address)).eq(200)
  })

  it("setBonusRewards", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])

    await expect(vester.setBonusRewards(user0.address, 200))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(wallet.address, true)

    expect(await vester.bonusRewards(user0.address)).eq(0)
    await vester.setBonusRewards(user0.address, 200)
    expect(await vester.bonusRewards(user0.address)).eq(200)
  })

  it("deposit, claim, withdraw", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])
    await esGplx.setMinter(vester.address, true)

    await expect(vester.connect(user0).deposit(0))
      .to.be.revertedWith("Vester: invalid _amount")

    await expect(vester.connect(user0).deposit(expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await esGplx.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    await expect(vester.connect(user0).deposit(expandDecimals(1000, 18)))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esGplx.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await gplx.mint(vester.address, expandDecimals(2000, 18))

    await vester.connect(user0).claim()
    blockTime = await getBlockTime(provider)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).gt("2730000000000000000")
    expect(await gplx.balanceOf(user0.address)).lt("2750000000000000000")

    let gplxAmount = await gplx.balanceOf(user0.address)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18).sub(gplxAmount))

    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 48 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimable(user0.address)).gt("5478000000000000000") // 1000 / 365 * 2 => ~5.479
    expect(await vester.claimable(user0.address)).lt("5480000000000000000")

    await increaseTime(provider, (parseInt(365 / 2 - 1)) * 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimable(user0.address)).gt(expandDecimals(500, 18)) // 1000 / 2 => 500
    expect(await vester.claimable(user0.address)).lt(expandDecimals(502, 18))

    await vester.connect(user0).claim()
    blockTime = await getBlockTime(provider)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).gt(expandDecimals(503, 18))
    expect(await gplx.balanceOf(user0.address)).lt(expandDecimals(505, 18))

    gplxAmount = await gplx.balanceOf(user0.address)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18).sub(gplxAmount))

    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimedAmounts(user0.address)).eq(gplxAmount)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    // vesting rate should be the same even after claiming
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")

    await esGplx.mint(user0.address, expandDecimals(500, 18))
    await esGplx.connect(user0).approve(vester.address, expandDecimals(500, 18))
    await vester.connect(user0).deposit(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.claimable(user0.address)).gt("6840000000000000000") // 1000 / 365 + 1500 / 365 => 6.849
    expect(await vester.claimable(user0.address)).lt("6860000000000000000")

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).eq(gplxAmount)

    await vester.connect(user0).withdraw()

    expect(await esGplx.balanceOf(user0.address)).gt(expandDecimals(989, 18))
    expect(await esGplx.balanceOf(user0.address)).lt(expandDecimals(990, 18))
    expect(await gplx.balanceOf(user0.address)).gt(expandDecimals(510, 18))
    expect(await gplx.balanceOf(user0.address)).lt(expandDecimals(512, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esGplx.connect(user0).approve(vester.address, expandDecimals(1000, 18))
    await esGplx.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))
    blockTime = await getBlockTime(provider)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await vester.connect(user0).claim()
  })

  it("depositForAccount, claimForAccount", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])
    await esGplx.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    await esGplx.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esGplx.mint(user0.address, expandDecimals(1000, 18))

    await expect(vester.connect(user2).depositForAccount(user0.address, expandDecimals(1000, 18)))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(user2.address, true)
    await vester.connect(user2).depositForAccount(user0.address, expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await gplx.mint(vester.address, expandDecimals(2000, 18))

    await expect(vester.connect(user3).claimForAccount(user0.address, user4.address))
      .to.be.revertedWith("Vester: forbidden")

    await vester.setHandler(user3.address, true)

    await vester.connect(user3).claimForAccount(user0.address, user4.address)
    blockTime = await getBlockTime(provider)

    expect(await esGplx.balanceOf(user4.address)).eq(0)
    expect(await gplx.balanceOf(user4.address)).gt("2730000000000000000")
    expect(await gplx.balanceOf(user4.address)).lt("2750000000000000000")

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).gt(expandDecimals(996, 18))
    expect(await vester.balanceOf(user0.address)).lt(expandDecimals(998, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).gt("2730000000000000000")
    expect(await vester.cumulativeClaimAmounts(user0.address)).lt("2750000000000000000")
    expect(await vester.claimedAmounts(user0.address)).gt("2730000000000000000")
    expect(await vester.claimedAmounts(user0.address)).lt("2750000000000000000")
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)
  })

  it("handles multiple deposits", async () => {
    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      AddressZero,
      gplx.address,
      AddressZero
    ])
    await esGplx.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    await esGplx.connect(user0).approve(vester.address, expandDecimals(1000, 18))

    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)

    await esGplx.mint(user0.address, expandDecimals(1000, 18))
    await vester.connect(user0).deposit(expandDecimals(1000, 18))

    let blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1000, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0)
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("2730000000000000000") // 1000 / 365 => ~2.739
    expect(await vester.claimable(user0.address)).lt("2750000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await expect(vester.connect(user0).claim())
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await gplx.mint(vester.address, expandDecimals(2000, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await vester.balanceOf(user0.address)).eq(expandDecimals(1000, 18))

    await esGplx.mint(user0.address, expandDecimals(500, 18))
    await esGplx.connect(user0).approve(vester.address, expandDecimals(500, 18))
    await vester.connect(user0).deposit(expandDecimals(500, 18))
    blockTime = await getBlockTime(provider)

    expect(await vester.balanceOf(user0.address)).gt(expandDecimals(1494, 18))
    expect(await vester.balanceOf(user0.address)).lt(expandDecimals(1496, 18))
    expect(await vester.getTotalVested(user0.address)).eq(expandDecimals(1500, 18))
    expect(await vester.cumulativeClaimAmounts(user0.address)).gt("5470000000000000000") // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await vester.cumulativeClaimAmounts(user0.address)).lt("5490000000000000000") // 5.49
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).gt("5470000000000000000")
    expect(await vester.claimable(user0.address)).lt("5490000000000000000")
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(blockTime)

    await vester.connect(user0).withdraw()

    expect(await esGplx.balanceOf(user0.address)).gt(expandDecimals(1494, 18))
    expect(await esGplx.balanceOf(user0.address)).lt(expandDecimals(1496, 18))
    expect(await gplx.balanceOf(user0.address)).gt("5470000000000000000")
    expect(await gplx.balanceOf(user0.address)).lt("5490000000000000000")
    expect(await vester.balanceOf(user0.address)).eq(0)
    expect(await vester.getTotalVested(user0.address)).eq(0)
    expect(await vester.cumulativeClaimAmounts(user0.address)).eq(0) // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await vester.claimedAmounts(user0.address)).eq(0)
    expect(await vester.claimable(user0.address)).eq(0)
    expect(await vester.pairAmounts(user0.address)).eq(0)
    expect(await vester.lastVestingTimes(user0.address)).eq(0)
  })

  it("handles pairing", async () => {
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

    await stakedGplxTracker.setInPrivateTransferMode(true)
    await stakedGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateTransferMode(true)
    await bonusGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateClaimingMode(true)
    await feeGplxTracker.setInPrivateTransferMode(true)
    await feeGplxTracker.setInPrivateStakingMode(true)

    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(stakedGplxDistributor.address, expandDecimals(50000 * 12, 18))
    await stakedGplxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second

    const rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
      eth.address,
      gplx.address,
      esGplx.address,
      bnGplx.address,
      AddressZero,
      stakedGplxTracker.address,
      bonusGplxTracker.address,
      feeGplxTracker.address,
      AddressZero,
      AddressZero,
      AddressZero
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
    // allow stakedGplxTracker to stake esGplx
    await esGplx.setHandler(stakedGplxTracker.address, true)
    // allow feeGplxTracker to stake bnGplx
    await bnGplx.setHandler(feeGplxTracker.address, true)
    // allow rewardRouter to burn bnGplx
    await bnGplx.setMinter(rewardRouter.address, true)

    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      feeGplxTracker.address,
      gplx.address,
      stakedGplxTracker.address
    ])
    await esGplx.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    expect(await vester.name()).eq("Vested GPLX")
    expect(await vester.symbol()).eq("veGPLX")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esGplx.address)
    expect(await vester.pairToken()).eq(feeGplxTracker.address)
    expect(await vester.claimableToken()).eq(gplx.address)
    expect(await vester.rewardTracker()).eq(stakedGplxTracker.address)
    expect(await vester.hasPairToken()).eq(true)
    expect(await vester.hasRewardTracker()).eq(true)
    expect(await vester.hasMaxVestableAmount()).eq(true)

    // allow vester to transfer feeGplxTracker tokens
    await feeGplxTracker.setHandler(vester.address, true)
    // allow vester to transfer esGplx tokens
    await esGplx.setHandler(vester.address, true)

    await gplx.mint(vester.address, expandDecimals(2000, 18))

    await gplx.mint(user0.address, expandDecimals(1000, 18))
    await gplx.mint(user1.address, expandDecimals(500, 18))
    await gplx.connect(user0).approve(stakedGplxTracker.address, expandDecimals(1000, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(500, 18))

    await rewardRouter.connect(user0).stakeGplx(expandDecimals(1000, 18))
    await rewardRouter.connect(user1).stakeGplx(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedGplxTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).gt(expandDecimals(594, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user1.address)).eq(0)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user2.address)).eq(0)
    expect(await esGplx.balanceOf(user3.address)).eq(0)

    await stakedGplxTracker.connect(user0).claim(user2.address)
    await stakedGplxTracker.connect(user1).claim(user3.address)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(1190, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(1191, 18))
    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(594, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(1191, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(594, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(596, 18))
    expect(await vester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user3.address)).eq(0)

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 1000 / 1190 => ~0.84
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 500 / 595 => ~0.84
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user2.address, expandDecimals(1, 18))).eq(0)
    expect(await vester.getPairAmount(user3.address, expandDecimals(1, 18))).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedGplxTracker.connect(user0).claim(user2.address)
    await stakedGplxTracker.connect(user1).claim(user3.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1189, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    await esGplx.mint(user0.address, expandDecimals(2385, 18))
    await expect(vester.connect(user0).deposit(expandDecimals(2385, 18)))
      .to.be.revertedWith("RewardTracker: transfer amount exceeds balance")

    await gplx.mint(user0.address, expandDecimals(500, 18))
    await gplx.connect(user0).approve(stakedGplxTracker.address, expandDecimals(500, 18))
    await rewardRouter.connect(user0).stakeGplx(expandDecimals(500, 18))

    await expect(vester.connect(user0).deposit(expandDecimals(2385, 18)))
      .to.be.revertedWith("Vester: max vestable amount exceeded")

    await gplx.mint(user2.address, expandDecimals(1, 18))
    await expect(vester.connect(user2).deposit(expandDecimals(1, 18)))
      .to.be.revertedWith("Vester: max vestable amount exceeded")

    expect(await esGplx.balanceOf(user0.address)).eq(expandDecimals(2385, 18))
    expect(await esGplx.balanceOf(vester.address)).eq(0)
    expect(await feeGplxTracker.balanceOf(user0.address)).eq(expandDecimals(1500, 18))
    expect(await feeGplxTracker.balanceOf(vester.address)).eq(0)

    await vester.connect(user0).deposit(expandDecimals(2380, 18))

    expect(await esGplx.balanceOf(user0.address)).eq(expandDecimals(5, 18))
    expect(await esGplx.balanceOf(vester.address)).eq(expandDecimals(2380, 18))
    expect(await feeGplxTracker.balanceOf(user0.address)).gt(expandDecimals(499, 18))
    expect(await feeGplxTracker.balanceOf(user0.address)).lt(expandDecimals(501, 18))
    expect(await feeGplxTracker.balanceOf(vester.address)).gt(expandDecimals(999, 18))
    expect(await feeGplxTracker.balanceOf(vester.address)).lt(expandDecimals(1001, 18))

    await rewardRouter.connect(user1).unstakeGplx(expandDecimals(499, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedGplxTracker.connect(user0).claim(user2.address)
    await stakedGplxTracker.connect(user1).claim(user3.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(4164, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(4166, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1192, 18))

    // (1000 * 2380 / 4164) + (1500 * 1784 / 4164) => 1214.21709894
    // 1214.21709894 / 4164 => ~0.29

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("280000000000000000") // 0.28
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("300000000000000000") // 0.30
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    await increaseTime(provider, 30 * 24 * 60 * 60)
    await mineBlock(provider)

    await vester.connect(user0).withdraw()

    expect(await feeGplxTracker.balanceOf(user0.address)).eq(expandDecimals(1500, 18))
    expect(await gplx.balanceOf(user0.address)).gt(expandDecimals(201, 18)) // 2380 / 12 = ~198
    expect(await gplx.balanceOf(user0.address)).lt(expandDecimals(203, 18))
    expect(await esGplx.balanceOf(user0.address)).gt(expandDecimals(2182, 18)) // 5 + 2380 - 202  = 2183
    expect(await esGplx.balanceOf(user0.address)).lt(expandDecimals(2183, 18))
  })

  it("handles existing pair tokens", async () => {
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

    await stakedGplxTracker.setInPrivateTransferMode(true)
    await stakedGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateTransferMode(true)
    await bonusGplxTracker.setInPrivateStakingMode(true)
    await bonusGplxTracker.setInPrivateClaimingMode(true)
    await feeGplxTracker.setInPrivateTransferMode(true)
    await feeGplxTracker.setInPrivateStakingMode(true)

    await esGplx.setMinter(wallet.address, true)
    await esGplx.mint(stakedGplxDistributor.address, expandDecimals(50000 * 12, 18))
    await stakedGplxDistributor.setTokensPerInterval("20667989410000000") // 0.02066798941 esGplx per second

    const rewardRouter = await deployContract("RewardRouter", [])
    await rewardRouter.initialize(
      eth.address,
      gplx.address,
      esGplx.address,
      bnGplx.address,
      AddressZero,
      stakedGplxTracker.address,
      bonusGplxTracker.address,
      feeGplxTracker.address,
      AddressZero,
      AddressZero,
      AddressZero
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
    // allow stakedGplxTracker to stake esGplx
    await esGplx.setHandler(stakedGplxTracker.address, true)
    // allow feeGplxTracker to stake bnGplx
    await bnGplx.setHandler(feeGplxTracker.address, true)
    // allow rewardRouter to burn bnGplx
    await bnGplx.setMinter(rewardRouter.address, true)

    const vester = await deployContract("Vester", [
      "Vested GPLX",
      "veGPLX",
      secondsPerYear,
      esGplx.address,
      feeGplxTracker.address,
      gplx.address,
      stakedGplxTracker.address
    ])
    await esGplx.setMinter(vester.address, true)
    await vester.setHandler(wallet.address, true)

    expect(await vester.name()).eq("Vested GPLX")
    expect(await vester.symbol()).eq("veGPLX")
    expect(await vester.vestingDuration()).eq(secondsPerYear)
    expect(await vester.esToken()).eq(esGplx.address)
    expect(await vester.pairToken()).eq(feeGplxTracker.address)
    expect(await vester.claimableToken()).eq(gplx.address)
    expect(await vester.rewardTracker()).eq(stakedGplxTracker.address)
    expect(await vester.hasPairToken()).eq(true)
    expect(await vester.hasRewardTracker()).eq(true)
    expect(await vester.hasMaxVestableAmount()).eq(true)

    // allow vester to transfer feeGplxTracker tokens
    await feeGplxTracker.setHandler(vester.address, true)
    // allow vester to transfer esGplx tokens
    await esGplx.setHandler(vester.address, true)

    await gplx.mint(vester.address, expandDecimals(2000, 18))

    await gplx.mint(user0.address, expandDecimals(1000, 18))
    await gplx.mint(user1.address, expandDecimals(500, 18))
    await gplx.connect(user0).approve(stakedGplxTracker.address, expandDecimals(1000, 18))
    await gplx.connect(user1).approve(stakedGplxTracker.address, expandDecimals(500, 18))

    await rewardRouter.connect(user0).stakeGplx(expandDecimals(1000, 18))
    await rewardRouter.connect(user1).stakeGplx(expandDecimals(500, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedGplxTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).gt(expandDecimals(594, 18))
    expect(await stakedGplxTracker.claimable(user1.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user1.address)).eq(0)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user2.address)).eq(0)
    expect(await esGplx.balanceOf(user3.address)).eq(0)

    await stakedGplxTracker.connect(user0).claim(user2.address)
    await stakedGplxTracker.connect(user1).claim(user3.address)

    expect(await esGplx.balanceOf(user0.address)).eq(0)
    expect(await esGplx.balanceOf(user1.address)).eq(0)
    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(1190, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(1191, 18))
    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(594, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(596, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(1190, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(1191, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(594, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(596, 18))
    expect(await vester.getMaxVestableAmount(user2.address)).eq(0)
    expect(await vester.getMaxVestableAmount(user3.address)).eq(0)

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 1000 / 1190 => ~0.84
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("830000000000000000") // 0.83, 500 / 595 => ~0.84
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("850000000000000000") // 0.85
    expect(await vester.getPairAmount(user2.address, expandDecimals(1, 18))).eq(0)
    expect(await vester.getPairAmount(user3.address, expandDecimals(1, 18))).eq(0)

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    await stakedGplxTracker.connect(user0).claim(user2.address)
    await stakedGplxTracker.connect(user1).claim(user3.address)

    expect(await esGplx.balanceOf(user2.address)).gt(expandDecimals(2380, 18))
    expect(await esGplx.balanceOf(user2.address)).lt(expandDecimals(2382, 18))
    expect(await esGplx.balanceOf(user3.address)).gt(expandDecimals(1189, 18))
    expect(await esGplx.balanceOf(user3.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).gt(expandDecimals(1189, 18))
    expect(await vester.getMaxVestableAmount(user1.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user0.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).gt("410000000000000000") // 0.41, 1000 / 2380 => ~0.42
    expect(await vester.getPairAmount(user1.address, expandDecimals(1, 18))).lt("430000000000000000") // 0.43

    expect(await vester.getPairAmount(user0.address, expandDecimals(2380, 18))).gt(expandDecimals(999, 18))
    expect(await vester.getPairAmount(user0.address, expandDecimals(2380, 18))).lt(expandDecimals(1000, 18))
    expect(await vester.getPairAmount(user1.address, expandDecimals(1189, 18))).gt(expandDecimals(499, 18))
    expect(await vester.getPairAmount(user1.address, expandDecimals(1189, 18))).lt(expandDecimals(500, 18))

    expect(await feeGplxTracker.balanceOf(user0.address)).eq(expandDecimals(1000, 18))
    await esGplx.mint(user0.address, expandDecimals(2380, 18))
    await vester.connect(user0).deposit(expandDecimals(2380, 18))

    expect(await feeGplxTracker.balanceOf(user0.address)).gt(0)
    expect(await feeGplxTracker.balanceOf(user0.address)).lt(expandDecimals(1, 18))

    await increaseTime(provider, 24 * 60 * 60)
    await mineBlock(provider)

    expect(await stakedGplxTracker.claimable(user0.address)).gt(expandDecimals(1190, 18))
    expect(await stakedGplxTracker.claimable(user0.address)).lt(expandDecimals(1191, 18))

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(2380, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(2382, 18))

    await stakedGplxTracker.connect(user0).claim(user2.address)

    expect(await vester.getMaxVestableAmount(user0.address)).gt(expandDecimals(3571, 18))
    expect(await vester.getMaxVestableAmount(user0.address)).lt(expandDecimals(3572, 18))

    expect(await vester.getPairAmount(user0.address, expandDecimals(3570, 18))).gt(expandDecimals(999, 18))
    expect(await vester.getPairAmount(user0.address, expandDecimals(3570, 18))).lt(expandDecimals(1000, 18))

    const feeGplxTrackerBalance = await feeGplxTracker.balanceOf(user0.address)

    await esGplx.mint(user0.address, expandDecimals(1190, 18))
    await vester.connect(user0).deposit(expandDecimals(1190, 18))

    expect(feeGplxTrackerBalance).eq(await feeGplxTracker.balanceOf(user0.address))

    await expect(rewardRouter.connect(user0).unstakeGplx(expandDecimals(2, 18)))
      .to.be.revertedWith("RewardTracker: burn amount exceeds balance")

    await vester.connect(user0).withdraw()

    await rewardRouter.connect(user0).unstakeGplx(expandDecimals(2, 18))
  })
})
