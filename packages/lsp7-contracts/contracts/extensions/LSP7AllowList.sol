// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAsset} from "../LSP7DigitalAsset.sol";

/**
 * @dev Extension of {LSP7} that allows to implement an allowlist
 * mechanism that can be managed by an authorized account with the
 * {_disallowUser} and {_allowUser} functions.
 *
 * The allowlist provides the guarantee to the contract owner
 * (e.g. a DAO or a well-configured multisig) that any account won't be
 * able to execute transfers or approvals to other entities to operate
 * on its behalf if {_allowUser} was not called with such account as an
 * argument. Similarly, the account will be disallowed again if
 * {_disallowUser} is called.
 */
abstract contract LSP7Allowlist is LSP7DigitalAsset {
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
     * @dev Returns the allowed status of an account.
     */
    function allowed(address account) public virtual returns (bool) {
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
        super._updateOperator(tokenOwner, operator, allowance, notified, operatorNotificationData);
    }
}