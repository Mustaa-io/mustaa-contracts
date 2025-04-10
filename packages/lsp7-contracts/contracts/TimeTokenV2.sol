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
     * @notice Books the yacht with discount applied if available
     * @dev Overrides the original book function to apply discounts
     * @param numDays The number of days to book
     * @param year The year for which to book
     */
    function book(uint256 numDays, uint256 year) public override nonReentrant {
        // Check if sender is allowed
        if (!yachtOwnership.allowed(msg.sender)) {
            revert RecipientNotAllowedInYachtOwnership(msg.sender);
        }
        
        // Check if days is valid
        if (numDays == 0) {
            revert InvalidDays();
        }
        
        uint256 decimalsFactor = 10 ** decimals();
        uint256 discountRate = discountRates[msg.sender];
        uint256 tokenAmount = numDays * decimalsFactor;
        
        // Apply discount if exists
        if (discountRate > 0) {
            tokenAmount = (tokenAmount * (100 - discountRate)) / 100;
        }
        
        if (yearlyBalances[year][msg.sender] < tokenAmount) 
            revert InsufficientBalance(year, yearlyBalances[year][msg.sender], tokenAmount);
        
        yearlyBalances[year][msg.sender] -= tokenAmount;
        _yearlySupply[year] -= tokenAmount;

        emit YachtBooked(msg.sender, year, numDays, tokenAmount);
    }

    /**
     * @notice Returns the version of the contract
     * @return The version string
     */
    function version() public pure returns (string memory) {
        return "v2.0";
    }
}
