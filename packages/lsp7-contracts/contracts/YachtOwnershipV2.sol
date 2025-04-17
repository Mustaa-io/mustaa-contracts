// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {YachtOwnership} from "./YachtOwnership.sol";

/**
 * @title YachtOwnershipV2 - A version 2 of YachtOwnership with VIP status
 * @dev Extends YachtOwnership with the ability to assign VIP status to users
 */
contract YachtOwnershipV2 is YachtOwnership {
    // Mapping to track VIP status of users
    mapping(address => bool) public isVIP;
    
    // Event for VIP status changes
    event VIPStatusChanged(address indexed user, bool status);

    function initialize(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        uint256 tokenSupplyCap_,
        address allowListAddress_
    ) public override initializer {
        YachtOwnership.initialize(name_, symbol_, newOwner_, tokenSupplyCap_, allowListAddress_);
    }
    
    /**
     * @notice Sets VIP status for a user
     * @dev Only callable by the contract owner
     * @param user The address to set VIP status for
     * @param status True to grant VIP status, false to remove it
     */
    function setVIPStatus(address user, bool status) public onlyOwner {
        isVIP[user] = status;
        emit VIPStatusChanged(user, status);
    }
    
    /**
     * @notice Returns the version of the contract
     * @return The version string
     */
    function version() public pure returns (string memory) {
        return "v2.0";
    }
}