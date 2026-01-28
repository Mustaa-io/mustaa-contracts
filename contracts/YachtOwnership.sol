// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {LSP7DigitalAssetInitAbstract} from "@lukso/lsp7-contracts/contracts/LSP7DigitalAssetInitAbstract.sol";
import {LSP7CappedSupplyInitAbstract} from "@lukso/lsp7-contracts/contracts/extensions/LSP7CappedSupplyInitAbstract.sol";
import {AllowList} from "./AllowList.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title YachtOwnership
 * @author Mustaa
 * @notice A controlled digital asset contract implementing LSP7 standard for yacht ownership tokenization
 * @dev Extension of {LSP7CappedSupplyInitAbstract} that implements a controlled ownership system
 *      with an allowlist mechanism managed by an authorized account (owner).
 *
 * This contract is designed specifically for tokenizing yacht ownership, where:
 * - Each token represents a share/ownership in a yacht
 * - The total supply is capped to prevent dilution
 * - Only approved (allowlisted) addresses can hold, transfer, or receive tokens
 * - The contract owner (e.g., a DAO or multisig) controls who can participate
 *
 * The allowlist mechanism ensures that yacht ownership transfers are restricted
 * to verified and approved parties, providing compliance and control over
 * the ownership ecosystem. Users must be explicitly allowed through the AllowList
 * contract before they can participate in any token operations, and can be removed
 * if needed.
 *
 * @custom:security This contract uses the UUPS upgradeable pattern. The implementation
 *                  contract cannot be initialized directly due to constructor restrictions.
 */
contract YachtOwnership is 
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    LSP7CappedSupplyInitAbstract
{
    /**
     * @dev Constructor that disables initialization of the implementation contract.
     * @notice This prevents the implementation contract from being initialized directly,
     *         which is a security best practice for upgradeable contracts following
     *         OpenZeppelin's upgradeable pattern. The contract should only be
     *         initialized through a proxy deployment.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Is owner mapping. True if address has non-zero balance.
     */
    mapping(address => bool) private _isOwner;

    /**
     * @dev Emitted when a user acquires ownership tokens (balance > 0).
     */
    event OwnershipAcquired(address indexed owner);

    /**
     * @dev Emitted when a user loses ownership tokens (balance == 0).
     */
    event OwnershipLost(address indexed previousOwner);
 
    /**
     * @dev The operation failed because the user is not allowed.
     */
    error LSP7Disallowed(address user);

    // --- Storage
    uint256 private _ownerCount;

    /**
     * @dev Reference to the AllowList contract for permission checks
     */
    AllowList public allowList;
    
    /**
     * @dev Storage gap for future upgrades.
     * @notice This array reserves storage slots to prevent storage layout conflicts
     *         when upgrading the contract implementation.
     */
    uint256[49] private __gap;

    /**
     * @notice Initializes the YachtOwnership token contract.
     * @dev Sets up the token with name, symbol, owner, supply cap, and allowlist reference.
     *      This function should be called atomically during proxy deployment via
     *      OpenZeppelin's upgradeable plugin to prevent front-running attacks.
     *
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param newOwner_ The address that will own the token contract
     * @param tokenSupplyCap_ The maximum token supply cap (must be greater than 0)
     * @param allowListAddress_ The address of the AllowList contract for permission checks
     *
     * @custom:requirements
     * - `tokenSupplyCap_` MUST NOT be 0
     * - `allowListAddress_` MUST be a valid contract address
     * @custom:security This function is protected by the `initializer` modifier and should
     *                  only be called atomically during proxy deployment to prevent front-running.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        uint256 tokenSupplyCap_,
        address allowListAddress_
    ) public virtual initializer {
        __Ownable_init();
        __UUPSUpgradeable_init();

        LSP7DigitalAssetInitAbstract._initialize(
            name_,
            symbol_,
            newOwner_,
            0,
            false
        );
        
        LSP7CappedSupplyInitAbstract._initialize(tokenSupplyCap_);
        
        allowList = AllowList(allowListAddress_);
    }

    /**
     * @dev Authorizes an upgrade to a new implementation contract.
     * @notice Only the contract owner can authorize upgrades.
     * @param newImplementation The address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Checks if an address is a yacht owner.
     * @dev An address is considered an owner if it has a non-zero token balance.
     * @param account The address to check
     * @return True if the address has a non-zero token balance, false otherwise
     */
    function isOwner(address account) public view returns (bool) {
        return _isOwner[account];
    }

    /**
     * @notice Returns the total number of yacht owners.
     * @dev Counts all addresses that currently have a non-zero token balance.
     * @return The count of addresses with non-zero balances
     */
    function getOwnerCount() public view returns (uint256) {
        return _ownerCount;
    }

    /**
     * @notice Calculates an address's ownership percentage in basis points.
     * @dev Returns the percentage of total supply owned by the given address.
     *      Basis points represent 1/100 of a percent (e.g., 100 = 1%, 10000 = 100%).
     * @param account The address to calculate the ownership percentage for
     * @return The ownership percentage in basis points (0-10000), or 0 if the account
     *         is not an owner or if total supply is zero
     */
    function getOwnershipPercentage(address account) public view returns (uint256) {
        if (!_isOwner[account]) return 0;
        
        uint256 totalTokens = totalSupply();
        if (totalTokens == 0) return 0;
        
        return (balanceOf(account) * 10000) / totalTokens;
    }

    /**
     * @dev Updates the ownership status for a given account.
     * @notice Tracks when addresses acquire or lose ownership tokens and emits
     *         corresponding events. Updates the internal owner count accordingly.
     * @param account The address whose ownership status should be updated
     */
    function _updateOwnershipStatus(address account) internal {
        uint256 balance = balanceOf(account);
        bool isCurrentlyOwner = _isOwner[account];
        
        if (balance > 0 && !isCurrentlyOwner) {
            _isOwner[account] = true;
            ++_ownerCount;
            emit OwnershipAcquired(account);
        } else if (balance == 0 && isCurrentlyOwner) {
            _isOwner[account] = false;
            --_ownerCount;
            emit OwnershipLost(account);
        }
    }

    /**
     * @dev See {LSP7-_update}.
     * @notice Handles token transfers with allowlist validation and ownership tracking.
     * @dev Validates that both sender and recipient are allowed in the allowlist
     *      (except for minting and burning operations). Updates ownership status
     *      for both addresses after the transfer.
     *
     * @param from The address tokens are transferred from (address(0) for minting)
     * @param to The address tokens are transferred to (address(0) for burning)
     * @param amount The amount of tokens to transfer
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data to include with the transfer
     *
     * @custom:requirements
     * - If `from` is not address(0), it MUST be allowed in the allowlist
     * - If `to` is not address(0), it MUST be allowed in the allowlist
     */
    function _update(address from, address to, uint256 amount, bool force, bytes memory data) internal virtual override {
        if (from != address(0) && !allowed(from)) revert LSP7Disallowed(from);
        if (to != address(0) && !allowed(to)) revert LSP7Disallowed(to);
        super._update(from, to, amount, force, data);

        if (from != address(0)) {
            _updateOwnershipStatus(from);
        }
        
        if (to != address(0)) {
            _updateOwnershipStatus(to);
        }
    }

    /**
     * @dev See {LSP7-_updateOperator}.
     * @notice Updates operator allowances with allowlist validation.
     * @dev If an operator is not allowed (has been disallowed from the allowlist),
     *      their allowance is automatically set to zero to prevent the use of stale
     *      allowances. This ensures that disallowed operators cannot leverage
     *      previously granted permissions.
     *
     * @param tokenOwner The address that owns the tokens
     * @param operator The address being granted or revoked operator permissions
     * @param allowance The amount of tokens the operator is allowed to transfer
     * @param notified Whether the operator has been notified
     * @param operatorNotificationData Additional data for operator notification
     *
     * @custom:requirements
     * - `tokenOwner` MUST be allowed in the allowlist
     * - If `operator` is not allowed, `allowance` will be set to zero
     */
    function _updateOperator(address tokenOwner, address operator, uint256 allowance, bool notified, bytes memory operatorNotificationData) internal virtual override {
        if (!allowed(tokenOwner)) revert LSP7Disallowed(tokenOwner);
        
        // Automatically revoke allowance if operator is not allowed
        // This prevents disallowed operators from using previously granted allowances
        if (!allowed(operator)) {
            allowance = 0;
        }
        
        super._updateOperator(tokenOwner, operator, allowance, notified, operatorNotificationData);
    }

    /**
     * @dev See {LSP7-_mint}.
     * @notice Mints tokens and updates ownership status.
     * @dev Calls the parent mint function to handle capped supply logic,
     *      then updates the ownership status for the recipient.
     *
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data to include with the mint
     */
    function _mint(
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) internal virtual override {
        super._mint(to, amount, force, data);
        _updateOwnershipStatus(to);
    }

    /**
     * @notice Mints new tokens to a specified address.
     * @dev Only callable by the contract owner. The token supply cap check is handled
     *      by the parent LSP7CappedSupplyInitAbstract, and the allowlist check is
     *      handled by the _update function.
     *
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data to include with the transfer
     *
     * @custom:requirements
     * - Caller MUST be the contract owner
     * - `to` MUST be allowed in the allowlist
     * - Total supply after minting MUST NOT exceed the supply cap
     */
    function mint(
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) public virtual onlyOwner {
        _mint(to, amount, force, data);
    }

    /**
     * @notice Checks if an address is allowed in the allowlist.
     * @dev Queries the AllowList contract to determine if an address has permission
     *      to participate in token operations.
     * @param account The address to check
     * @return True if the address is allowed, false otherwise
     */
    function allowed(address account) public view virtual returns (bool) {
        return allowList.isAllowed(account);
    }
}
