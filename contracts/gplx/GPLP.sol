// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract GPLP is MintableBaseToken {
    constructor(string memory _name, string memory _symbol) public MintableBaseToken(_name, _symbol, 0) { // "GPLX LP", "GPLP"
    }

    function id() external view returns (string memory _name) {
        return symbol;
    }
}
