require("@nomiclabs/hardhat-waffle")
require("@nomiclabs/hardhat-etherscan")
require("hardhat-contract-sizer")
require('@typechain/hardhat')

const {
  PULSE_URL,
  PULSE_DEPLOY_KEY,
  PULSESCAN_API_KEY
} = require("./env.json")

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners()

  for (const account of accounts) {
    console.info(account.address)
  }
})

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    localhost: {
      url: 'http://127.0.0.1:7545/',
      timeout: 120000,
      accounts: {
        mnemonic: "",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 10,
        passphrase: ""
      }
    },
    hardhat: {
      allowUnlimitedContractSize: true
    },
    pulse: {
      url: PULSE_URL,
      gasPrice: 1000000000000000,
      chainId: 369,
      accounts: [PULSE_DEPLOY_KEY]
    },
  },
  etherscan: {
    apiKey: {
      pulse: PULSESCAN_API_KEY,
    },
    customChains: [
      {
        network: "Pulsechain",
        chainId: 369,
        urls: {
          apiURL: "https://scan.pulsechain.com/api",
          browserURL: "https://scan.pulsechain.com/",
        },
      },
    ]
  },
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 10
      }
    }
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
}
