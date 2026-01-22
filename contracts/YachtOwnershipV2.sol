// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {YachtOwnership} from "./YachtOwnership.sol";

/**
 * @title YachtOwnershipV2 - A version 2 of YachtOwnership with VIP status
 * @dev Extends YachtOwnership with the ability to assign VIP status to users
 */
contract YachtOwnershipV2 is YachtOwnership {
    /**
     * @dev Constructor that disables initialization of the implementation contract.
     * This prevents the implementation contract from being initialized directly,
     * which is a security best practice for upgradeable contracts.
     * The contract should only be initialized through a proxy.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Mapping of user addresses to their VIP status.
     * @notice VIP status grants special privileges to users.
     */
    mapping(address => bool) public isVIP;
    
    /**
     * @dev Emitted when VIP status is changed for a user.
     * @param user The address whose VIP status was changed
     * @param status The new VIP status (true for VIP, false for non-VIP)
     */
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