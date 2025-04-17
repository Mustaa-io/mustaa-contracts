// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {TimeToken} from "./TimeToken.sol";

/**
 * @title TimeTokenV2 - A version 2 of TimeToken with discount functionality
 * @dev Extends TimeToken with the ability to set discounts for specific users
 */
contract TimeTokenV2 is TimeToken {
    // New state variable for V2
    mapping(address => uint256) public discountRates;
    
    // New event for discount setting
    event DiscountSet(address indexed user, uint256 rate);
    
    // New error for V2
    error DiscountTooHigh(uint256 requested, uint256 maximum);

    function initialize(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        address mustaa_,
        address[] memory owners_,
        address yachtOwnershipAddress_,
        address allowListAddress_,
        uint256 startingYear_,
        uint256 yearCount_
    ) public override initializer {
        // Call the parent TimeToken initializer
        TimeToken.initialize(
            name_,
            symbol_,
            newOwner_,
            mustaa_,
            owners_,
            yachtOwnershipAddress_,
            allowListAddress_,
            startingYear_,
            yearCount_
        );
    }

    /**
     * @notice Sets a discount rate for a user
     * @dev Only callable by the contract owner
     * @param user The address to set the discount for
     * @param rate The discount rate (0-50)
     */
    function setDiscount(address user, uint256 rate) public onlyOwner {
        if (rate > 50) revert DiscountTooHigh(rate, 50);
        discountRates[user] = rate;
        emit DiscountSet(user, rate);
    }

    /**
     * @notice Returns the version of the contract
     * @return The version string
     */
    function version() public pure returns (string memory) {
        return "v2.0";
    }
}
