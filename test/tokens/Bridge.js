const { expect, use } = require("chai")
const { solidity } = require("ethereum-waffle")
const { deployContract } = require("../shared/fixtures")
const { expandDecimals, getBlockTime, increaseTime, mineBlock, reportGasUsed } = require("../shared/utilities")

use(solidity)

describe("Bridge", function () {
  const provider = waffle.provider
  const [wallet, user0, user1, user2, user3] = provider.getWallets()
  let gplx
  let wgplx
  let bridge

  beforeEach(async () => {
    gplx = await deployContract("GPLX", [])
    wgplx = await deployContract("GPLX", [])
    bridge = await deployContract("Bridge", [gplx.address, wgplx.address])
  })

  it("wrap, unwrap", async () => {
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(user0.address, 100)
    await gplx.connect(user0).approve(bridge.address, 100)
    await expect(bridge.connect(user0).wrap(200, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds allowance")

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await wgplx.setMinter(wallet.address, true)
    await wgplx.mint(bridge.address, 50)

    await expect(bridge.connect(user0).wrap(100, user1.address))
      .to.be.revertedWith("BaseToken: transfer amount exceeds balance")

    await wgplx.mint(bridge.address, 50)

    expect(await gplx.balanceOf(user0.address)).eq(100)
    expect(await gplx.balanceOf(bridge.address)).eq(0)
    expect(await wgplx.balanceOf(user1.address)).eq(0)
    expect(await wgplx.balanceOf(bridge.address)).eq(100)

    await bridge.connect(user0).wrap(100, user1.address)

    expect(await gplx.balanceOf(user0.address)).eq(0)
    expect(await gplx.balanceOf(bridge.address)).eq(100)
    expect(await wgplx.balanceOf(user1.address)).eq(100)
    expect(await wgplx.balanceOf(bridge.address)).eq(0)

    await wgplx.connect(user1).approve(bridge.address, 100)

    expect(await gplx.balanceOf(user2.address)).eq(0)
    expect(await gplx.balanceOf(bridge.address)).eq(100)
    expect(await wgplx.balanceOf(user1.address)).eq(100)
    expect(await wgplx.balanceOf(bridge.address)).eq(0)

    await bridge.connect(user1).unwrap(100, user2.address)

    expect(await gplx.balanceOf(user2.address)).eq(100)
    expect(await gplx.balanceOf(bridge.address)).eq(0)
    expect(await wgplx.balanceOf(user1.address)).eq(0)
    expect(await wgplx.balanceOf(bridge.address)).eq(100)
  })

  it("withdrawToken", async () => {
    await gplx.setMinter(wallet.address, true)
    await gplx.mint(bridge.address, 100)

    await expect(bridge.connect(user0).withdrawToken(gplx.address, user1.address, 100))
      .to.be.revertedWith("Governable: forbidden")

    await expect(bridge.connect(user0).setGov(user0.address))
      .to.be.revertedWith("Governable: forbidden")

    await bridge.connect(wallet).setGov(user0.address)

    expect(await gplx.balanceOf(user1.address)).eq(0)
    expect(await gplx.balanceOf(bridge.address)).eq(100)
    await bridge.connect(user0).withdrawToken(gplx.address, user1.address, 100)
    expect(await gplx.balanceOf(user1.address)).eq(100)
    expect(await gplx.balanceOf(bridge.address)).eq(0)
  })
})
