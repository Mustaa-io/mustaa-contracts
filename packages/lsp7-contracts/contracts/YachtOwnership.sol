// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAssetInitAbstract} from "./LSP7DigitalAssetInitAbstract.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title YachtOwnership - A controlled digital asset contract for yacht ownership
 * @dev Extension of {LSP7} that implements a controlled ownership system for yacht tokens
 * with an allowlist mechanism managed by an authorized account (owner).
 *
 * This contract is designed specifically for tokenizing yacht ownership, where:
 * - Each token represents a share/ownership in a yacht
 * - The total supply is capped to prevent dilution
 * - Only approved (allowlisted) addresses can hold, transfer, or receive tokens
 * - The contract owner (e.g., a DAO or multisig) controls who can participate
 *
 * The allowlist mechanism ensures that yacht ownership transfers are restricted
 * to verified and approved parties, providing compliance and control over
 * the ownership ecosystem. Users must be explicitly allowed through {_allowUser}
 * before they can participate in any token operations, and can be removed
 * via {_disallowUser} if needed.
 */
contract YachtOwnership is 
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    LSP7DigitalAssetInitAbstract
{
    /**
     * @dev Allowed status of addresses. True if allowed, False otherwise.
     */
    mapping(address => bool) private _allowed;

    /**
     * @dev Is owner mapping. True if address has non-zero balance.
     */
    mapping(address => bool) private _isOwner;

    /**
     * @dev Emitted when a `user` is allowed to transfer and approve.
     */
    event UserAllowed(address indexed user);

    /**
     * @dev Emitted when a user is disallowed.
     */
    event UserDisallowed(address indexed user);

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

    /**
     * @notice The `tokenSupplyCap` must be set and cannot be `0`.
     * @dev Reverts when setting `0` for the {tokenSupplyCap}. The max token supply MUST be set to a number greater than 0.
     */
    error LSP7CappedSupplyRequired();

    /**
     * @notice Cannot mint anymore as total supply reached the maximum cap.
     * @dev Reverts when trying to mint tokens but the {totalSupply} has reached the maximum {tokenSupplyCap}.
     */
    error LSP7CappedSupplyCannotMintOverCap();

    // --- Storage
    uint256 private _tokenSupplyCap;
    uint256 private _ownerCount;
    
    // Add a gap to prevent storage clashes in future upgrades
    uint256[50] private __gap;

    /**
     * @notice Deploying a `LSP7Mintable` token contract with: token name = `name_`, token symbol = `symbol_`, and
     * address `newOwner_` as the token contract owner.
     *
     * @param name_ The name of the token.
     * @param symbol_ The symbol of the token.
     * @param newOwner_ The owner of the token contract.
     * 
     * @notice Deploying a `LSP7CappedSupply` token contract with max token supply cap set to `tokenSupplyCap_`.
     * @dev Deploy a `LSP7CappedSupply` token contract and set the maximum token supply token cap up to which
     * it is not possible to mint more tokens.
     *
     * @param tokenSupplyCap_ The maximum token supply.
     *
     * @custom:requirements
     * - `tokenSupplyCap_` MUST NOT be 0.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        uint256 tokenSupplyCap_
    ) public virtual initializer {
        // Initialize parent contracts
        __Ownable_init();
        __UUPSUpgradeable_init();

        _initialize(
            name_,
            symbol_,
            newOwner_,
            0, // lsp4TokenType
            false // isNonDivisible
        );
        
        if (tokenSupplyCap_ == 0) {
            revert LSP7CappedSupplyRequired();
        }

        _tokenSupplyCap = tokenSupplyCap_;
        _allowUser(newOwner_);
    }

    /**
     * @dev Function that authorizes upgrades to the contract.
     * Only the contract owner can upgrade the implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Check if an address is an owner (has non-zero balance)
     * @param account The address to check
     * @return True if the address has a non-zero token balance
     */
    function isOwner(address account) public view returns (bool) {
        return _isOwner[account];
    }

    /**
     * @notice Get the total number of owners
     * @return The count of addresses with non-zero balances
     */
    function getOwnerCount() public view returns (uint256) {
        return _ownerCount;
    }

    /**
     * @notice Calculate an address's ownership percentage in basis points (1/100 of percent)
     * @param account The address to calculate percentage for
     * @return Percentage in basis points (100 = 1%, 10000 = 100%)
     */
    function getOwnershipPercentage(address account) public view returns (uint256) {
        if (!_isOwner[account]) return 0;
        
        uint256 totalTokens = totalSupply();
        if (totalTokens == 0) return 0;
        
        return (balanceOf(account) * 10000) / totalTokens;
    }

    /**
     * @dev Internal function to update ownership status
     * @param account The address to update
     */
    function _updateOwnershipStatus(address account) internal {
        uint256 balance = balanceOf(account);
        bool isCurrentlyOwner = _isOwner[account];
        
        if (balance > 0 && !isCurrentlyOwner) {
            _isOwner[account] = true;
            _ownerCount++;
            emit OwnershipAcquired(account);
        } else if (balance == 0 && isCurrentlyOwner) {
            _isOwner[account] = false;
            _ownerCount--;
            emit OwnershipLost(account);
        }
    }

    /**
     * @notice The maximum supply amount of tokens allowed to exist is `_TOKEN_SUPPLY_CAP`.
     *
     * @dev Get the maximum number of tokens that can exist to circulate. Once {totalSupply} reaches
     * reaches {totalSupplyCap}, it is not possible to mint more tokens.
     *
     * @return The maximum number of tokens that can exist in the contract.
     */
    function tokenSupplyCap() public view virtual returns (uint256) {
        return _tokenSupplyCap;
    }

    /**
     * @dev Returns the allowed status of an account.
     */
    function allowed(address account) public view virtual returns (bool) {
        return _allowed[account];
    }

    /**
     * @dev Allows a user to receive and transfer tokens, including minting and burning.
     */
    function _allowUser(address user) internal virtual returns (bool) {
        bool isAllowed = allowed(user);
        if (!isAllowed) {
            _allowed[user] = true;
            emit UserAllowed(user);
        }
        return isAllowed;
    }

    /**
     * @dev Disallows a user from receiving and transferring tokens, including minting and burning.
     */
    function _disallowUser(address user) internal virtual returns (bool) {
        bool isAllowed = allowed(user);
        if (isAllowed) {
            _allowed[user] = false;
            emit UserDisallowed(user);
        }
        return isAllowed;
    }

    /**
     * @dev See {LSP7-_update}.
     */
    function _update(address from, address to, uint256 amount, bool force, bytes memory data) internal virtual override {
        if (from != address(0) && !allowed(from)) revert LSP7Disallowed(from);
        if (to != address(0) && !allowed(to)) revert LSP7Disallowed(to);
        super._update(from, to, amount, force, data);

        // Update ownership status after balance changes
        if (from != address(0)) {
            _updateOwnershipStatus(from);
        }
        
        if (to != address(0)) {
            _updateOwnershipStatus(to);
        }
    }

    /**
     * @dev See {LSP7-_updateOperator}.
     */
    function _updateOperator(address tokenOwner, address operator, uint256 allowance, bool notified, bytes memory operatorNotificationData) internal virtual override {
        if (!allowed(tokenOwner)) revert LSP7Disallowed(tokenOwner);
        if (!allowed(operator)) revert LSP7Disallowed(operator);
        super._updateOperator(tokenOwner, operator, allowance, notified, operatorNotificationData);
    }

    /**
     * @dev Same as {_mint} but allows to mint only if the {totalSupply} does not exceed the {tokenSupplyCap}
     * after `amount` of tokens have been minted.
     *
     * @custom:requirements
     * - {tokenSupplyCap} - {totalSupply} must be greater than zero.
     * - `to` cannot be the zero address.
     */
    function _mint(
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) internal virtual override {
        if (totalSupply() + amount > tokenSupplyCap()) {
            revert LSP7CappedSupplyCannotMintOverCap();
        }

        super._mint(to, amount, force, data);

        _updateOwnershipStatus(to);
    }

    /**
     * @dev Public {_mint} function callable only by the contract owner.
     * The token supply cap check is handled by the internal _mint function,
     * and the allowlist check is handled by the _update function.
     * 
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data to include with the transfer
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
     * @dev Public function to allow a user.
     */
    function allowUser(address user) public virtual onlyOwner {
        _allowUser(user);
    }

    /**
     * @dev Public function to disallow a user.
     */
    function disallowUser(address user) public virtual onlyOwner {
        _disallowUser(user);
    }
}