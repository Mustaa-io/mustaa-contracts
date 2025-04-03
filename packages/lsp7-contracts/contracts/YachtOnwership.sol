// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAsset} from "./LSP7DigitalAsset.sol";

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
contract YachtOwnership is LSP7DigitalAsset {
    /**
     * @dev Allowed status of addresses. True if allowed, False otherwise.
     */
    mapping(address => bool) private _allowed;

    /**
     * @dev Emitted when a `user` is allowed to transfer and approve.
     */
    event UserAllowed(address indexed user);

    /**
     * @dev Emitted when a user is disallowed.
     */
    event UserDisallowed(address indexed user);

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
    uint256 private immutable _TOKEN_SUPPLY_CAP;

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
    constructor(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        uint256 tokenSupplyCap_
    )
        LSP7DigitalAsset(
            name_,
            symbol_,
            newOwner_,
            0,
            false
        )
    {
        if (tokenSupplyCap_ == 0) {
            revert LSP7CappedSupplyRequired();
        }

        _TOKEN_SUPPLY_CAP = tokenSupplyCap_;
        _allowUser(newOwner_);
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
        return _TOKEN_SUPPLY_CAP;
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