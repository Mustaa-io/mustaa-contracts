// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title AllowList - Centralized registry for allowlisted addresses
 * @dev Manages a global allowlist that other contracts can reference
 */
contract AllowList is 
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    /**
     * @dev Allowed status of addresses. True if allowed, False otherwise.
     */
    mapping(address => bool) private _allowed;

    /**
     * @dev Emitted when a `user` is allowed.
     */
    event UserAllowed(address indexed user);

    /**
     * @dev Emitted when a user is disallowed.
     */
    event UserDisallowed(address indexed user);

    /**
     * @dev Initialize the contract
     * @param owner_ The owner who will manage the allowlist
     */
    function initialize(address owner_) public initializer {
        // Initialize parent contracts
        __Ownable_init();
        __UUPSUpgradeable_init();
        
        // Transfer ownership
        _transferOwnership(owner_);
    }

    /**
     * @dev Function that authorizes upgrades to the contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Returns the allowed status of an account
     * @param account The address to check
     * @return True if the address is allowed, false otherwise
     */
    function isAllowed(address account) public view returns (bool) {
        return _allowed[account];
    }

    /**
     * @dev Allow a user to participate in the ecosystem
     * @param user The address to allow
     */
    function allowUser(address user) public onlyOwner {
        if (!_allowed[user]) {
            _allowed[user] = true;
            emit UserAllowed(user);
        }
    }

    /**
     * @dev Disallow a user from participating in the ecosystem
     * @param user The address to disallow
     */
    function disallowUser(address user) public onlyOwner {
        if (_allowed[user]) {
            _allowed[user] = false;
            emit UserDisallowed(user);
        }
    }

    /**
     * @dev Allow multiple users at once
     * @param users Array of addresses to allow
     */
    function allowUsers(address[] calldata users) external onlyOwner {
        for (uint i = 0; i < users.length; i++) {
            if (!_allowed[users[i]]) {
                _allowed[users[i]] = true;
                emit UserAllowed(users[i]);
            }
        }
    }

    /**
     * @dev Disallow multiple users at once
     * @param users Array of addresses to disallow
     */
    function disallowUsers(address[] calldata users) external onlyOwner {
        for (uint i = 0; i < users.length; i++) {
            if (_allowed[users[i]]) {
                _allowed[users[i]] = false;
                emit UserDisallowed(users[i]);
            }
        }
    }
}
