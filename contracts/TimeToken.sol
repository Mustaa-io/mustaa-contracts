// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {LSP7DigitalAssetInitAbstract} from "@lukso/lsp7-contracts/contracts/LSP7DigitalAssetInitAbstract.sol";
import {AllowList} from "./AllowList.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {YachtOwnership} from "./YachtOwnership.sol";
import {
    LSP7InvalidTransferBatch,
    LSP7CannotSendWithAddressZero,
    LSP7AmountExceedsBalance
} from "@lukso/lsp7-contracts/contracts/LSP7Errors.sol";

/**
 * @title TimeToken
 * @author Mustaa
 * @notice A time-based token system implementing LSP7 standard for yacht usage rights
 * @dev Implementation of LSP7 that manages time-based tokens with yearly allocations
 *
 * This contract implements a time-based tokenization system for yacht usage rights where:
 * - Yearly token distribution (365/366 tokens per year)
 * - Mustaa receives 281/282 tokens (regular/leap year)
 * - Yacht owners share 84 tokens proportionally based on ownership percentage
 * - Token transfers are year-specific and tracked separately
 * - Expired tokens can be burned by the contract owner
 * - Integration with YachtOwnership for access control and ownership validation
 *
 * The system ensures:
 * - Only allowed users can participate in token operations
 * - Tokens are tracked per year with separate balances
 * - Proper distribution based on yacht ownership percentages
 * - Operator allowances are automatically revoked when operators are disallowed
 *
 * @custom:security This contract uses the UUPS upgradeable pattern. The implementation
 *                  contract cannot be initialized directly due to constructor restrictions.
 */
contract TimeToken is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    LSP7DigitalAssetInitAbstract
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

    // --- Errors

    error InvalidOwnerCount();
    error YearlySupplyExceeded(uint256 year);
    error InvalidOwnership(address owner, uint256 percentage);
    error OwnershipContractNotSet();
    error AllowListNotSet();
    error TotalOwnershipPercentageInvalid();
    error LSP7NotAnOwner(address recipient);
    error TokensNotExpired(uint256 year, uint256 currentYear);

    /**
     * @dev The operation failed because the user is not allowed.
     */
    error LSP7Disallowed(address user);

    /**
     * @dev The operation failed because the starting year is in the past.
     */
    error InvalidStartingYear(uint256 providedYear, uint256 currentYear);

    // --- Constants

    /**
     * @dev Number of tokens for regular years (365 days)
     */
    uint256 private constant REGULAR_YEAR_SUPPLY = 365;

    /**
     * @dev Number of tokens for leap years (366 days)
     */
    uint256 private constant LEAP_YEAR_SUPPLY = 366;
    
    /**
     * @dev Mustaa's share for regular years
     */
    uint256 private constant MUSTAA_REGULAR_SHARE = 281;

    /**
     * @dev Mustaa's share for leap years
     */
    uint256 private constant MUSTAA_LEAP_SHARE = 282;
    
    /**
     * @dev Total tokens to be shared among owners
     */
    uint256 private constant OWNER_TOTAL_SHARE = 84;

    // --- Yearly Tracking Storage (custom addition to base LSP7)

    /**
     * @dev Mapping from `year` to `tokenOwner` to yearly balance
     */
    mapping(uint256 => mapping(address => uint256)) internal _tokenOwnerYearlyBalances;

    /**
     * @dev Mapping from `year` to total yearly supply
     */
    mapping(uint256 => uint256) internal _yearlySupply;

    // --- References

    /**
     * @dev Reference to the YachtOwnership contract for permission checks
     */
    YachtOwnership public yachtOwnership;

    /**
     * @dev Reference to the AllowList contract for permission checks
     */
    AllowList public allowList;

    /**
     * @dev Special address that receives fixed yearly allocation
     */
    address public mustaaAddress;

    /**
     * @dev Storage gap for future upgrades.
     * @notice This array reserves storage slots to prevent storage layout conflicts
     *         when upgrading the contract implementation.
     */
    uint256[47] private __gap;

    /**
     * @dev Helper struct to hold ownership validation results
     */
    struct OwnershipData {
        uint256[] percentages;
        uint256 totalPercentage;
        uint256 mustaaPercentage;
    }

    /**
     * @dev Validates yacht owners and calculates ownership percentages.
     * @notice Validates that all provided addresses are yacht owners, calculates their
     *         ownership percentages, and ensures the total ownership (including Mustaa
     *         if applicable) equals 100%.
     *
     * @param owners Array of owner addresses to validate
     * @return OwnershipData containing validated percentages and totals
     *
     * @custom:requirements
     * - `owners` array must not be empty
     * - All addresses in `owners` must be yacht owners with non-zero ownership
     * - Total ownership percentage (including Mustaa if applicable) must equal 10000 basis points
     */
    function _validateOwnership(
        address[] memory owners
    ) internal view returns (OwnershipData memory) {
        if (owners.length == 0) revert InvalidOwnerCount();
        
        OwnershipData memory data;
        data.percentages = new uint256[](owners.length);
        
        if (yachtOwnership.isOwner(mustaaAddress)) {
            data.mustaaPercentage = yachtOwnership.getOwnershipPercentage(mustaaAddress);
        }
        
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            if (!yachtOwnership.isOwner(owner)) revert InvalidOwnership(owner, 0);
            
            uint256 percentage = yachtOwnership.getOwnershipPercentage(owner);
            if (percentage == 0) revert InvalidOwnership(owner, percentage);
            
            data.percentages[i] = percentage;
            data.totalPercentage += percentage;
        }
        
        if (data.totalPercentage + data.mustaaPercentage != 10000) revert TotalOwnershipPercentageInvalid();
        
        return data;
    }

    /**
     * @dev Mints tokens for a specific year to Mustaa and yacht owners.
     * @notice Distributes tokens for a given year: Mustaa receives their fixed allocation
     *         (281/282 tokens for regular/leap years), and the remaining 84 tokens are
     *         distributed proportionally among yacht owners based on their ownership percentages.
     *
     * @param year The year to mint tokens for
     * @param owners Array of yacht owner addresses to receive tokens
     * @param ownershipData Validated ownership data containing percentages
     *
     * @custom:requirements
     * - Yearly supply for the given year must be zero (not already minted)
     * - Total tokens to be minted must not exceed the yearly supply cap
     */
    function _mintYearlyTokens(
        uint256 year,
        address[] memory owners,
        OwnershipData memory ownershipData
    ) internal {
        uint256 decimalsFactor = 10 ** decimals();
        uint256 mustaaPerYear = (isLeapYear(year) ? MUSTAA_LEAP_SHARE : MUSTAA_REGULAR_SHARE) * decimalsFactor;
        uint256 ownerTotalAmount = OWNER_TOTAL_SHARE * decimalsFactor;
        
        uint256 currentYearlySupply = _yearlySupply[year];
        if (currentYearlySupply > 0 || (mustaaPerYear + ownerTotalAmount > yearlySupplyCap(year) * decimalsFactor)) {
            revert YearlySupplyExceeded(year);
        }
        
        _mint(mustaaAddress, mustaaPerYear, true, abi.encode(year, "Annual allocation for Mustaa"));
        
        uint256 nonMustaaTotal = ownershipData.totalPercentage;
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 ownerShare = (ownerTotalAmount * ownershipData.percentages[i]) / nonMustaaTotal;
            _mint(owners[i], ownerShare, true, abi.encode(year, "Annual allocation for owner"));
        }
    }

    /**
     * @notice Initializes the TimeToken contract with initial distributions
     * @dev Mints tokens for specified years to Mustaa and owners based on yacht ownership.
     *      This function should be called atomically during proxy deployment via
     *      OpenZeppelin's upgradeable plugin to prevent front-running attacks.
     * 
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param newOwner_ The contract owner address
     * @param mustaa_ The Mustaa address that receives 281/282 tokens per year
     * @param owners_ Array of owner addresses that share 84 tokens per year
     * @param yachtOwnershipAddress_ The address of the YachtOwnership contract
     * @param allowListAddress_ The address of the AllowList contract
     * @param startingYear_ The first year to mint tokens for
     * @param yearCount_ Number of consecutive years to pre-mint tokens for
     *
     * @custom:requirements
     * - owners_ must not be empty
     * - yachtOwnershipAddress_ must not be zero address
     * - All owners must have valid ownership percentages
     * - Total ownership percentage must equal 100%
     * @custom:security This function is protected by the `initializer` modifier and should
     *                  only be called atomically during proxy deployment to prevent front-running.
     */
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
    ) public virtual initializer {
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _initialize(
            name_,
            symbol_,
            newOwner_,
            0,
            false
        );

        if (yachtOwnershipAddress_ == address(0)) revert OwnershipContractNotSet();
        yachtOwnership = YachtOwnership(payable(yachtOwnershipAddress_));

        if (allowListAddress_ == address(0)) revert AllowListNotSet();
        allowList = AllowList(payable(allowListAddress_));
        
        mustaaAddress = mustaa_;

        OwnershipData memory ownershipData = _validateOwnership(owners_);

        uint256 currentYear = block.timestamp / 365 days + 1970;
        if (startingYear_ < currentYear) revert InvalidStartingYear(startingYear_, currentYear);

        for (uint256 year = startingYear_; year < startingYear_ + yearCount_; year++) {
            _mintYearlyTokens(year, owners_, ownershipData);
        }
    }

    /**
     * @dev Authorizes an upgrade to a new implementation contract.
     * @notice Only the contract owner can authorize upgrades.
     * @param newImplementation The address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Determines if a given year is a leap year according to the Gregorian calendar.
     * @dev Implements the standard leap year calculation rules:
     *      - Years divisible by 4 are leap years
     *      - Exception: Century years (divisible by 100) are NOT leap years
     *      - Exception to the exception: Century years divisible by 400 ARE leap years
     *
     * @param year The year to check
     * @return True if the year is a leap year, false otherwise
     */
    function isLeapYear(uint256 year) public pure returns (bool) {
        if (year % 4 != 0) {
            return false;
        }
        
        if (year % 100 == 0) {
            return year % 400 == 0;
        }
        
        return true;
    }

    /**
     * @notice Returns the maximum number of tokens that can be minted for a specific year
     * @dev Returns different caps for leap years vs regular years
     * @param year The year to get the supply cap for
     * @return The yearly supply cap (366 for leap years, 365 for regular years)
     */
    function yearlySupplyCap(uint256 year) public pure returns (uint256) {
        return isLeapYear(year) ? LEAP_YEAR_SUPPLY : REGULAR_YEAR_SUPPLY;
    }

    /**
     * @notice Burns tokens from a past year that have expired.
     * @dev Only the contract owner can call this function, and only for years
     *      before the current year. This allows cleanup of expired tokens.
     *
     * @param tokenOwner The address whose tokens to burn
     * @param year The year of tokens to burn (must be before the current year)
     *
     * @custom:requirements
     * - Caller MUST be the contract owner
     * - `year` MUST be before the current year
     */
    function burnExpiredTokens(address tokenOwner, uint256 year) public virtual onlyOwner {
        uint256 currentYear = block.timestamp / 365 days + 1970;
        if (year >= currentYear) revert TokensNotExpired(year, currentYear);
        
        uint256 amount = balanceOfYear(tokenOwner, year);
        if (amount > 0) {
            _burn(tokenOwner, amount, abi.encode(year, "Burning expired tokens"));
        }
    }

    /**
     * @notice Burns tokens from a past year for multiple addresses.
     * @dev Only the contract owner can call this function, and only for years
     *      before the current year. This allows batch cleanup of expired tokens.
     *
     * @param tokenOwners Array of addresses whose tokens to burn
     * @param year The year of tokens to burn (must be before the current year)
     *
     * @custom:requirements
     * - Caller MUST be the contract owner
     * - `year` MUST be before the current year
     */
    function batchBurnExpiredTokens(address[] memory tokenOwners, uint256 year) public virtual onlyOwner {
        uint256 currentYear = block.timestamp / 365 days + 1970;
        if (year >= currentYear) revert TokensNotExpired(year, currentYear);
        
        for (uint256 i = 0; i < tokenOwners.length; i++) {
            uint256 amount = balanceOfYear(tokenOwners[i], year);
            if (amount > 0) {
                _burn(tokenOwners[i], amount, abi.encode(year, "Burning expired tokens"));
            }
        }
    }

    /**
     * @notice Mints new tokens to a set of yacht owners for specific years.
     * @dev Only the contract owner can call this function. Validates ownership
     *      percentages and mints tokens according to the yearly distribution rules.
     *
     * @param tokenYears Array of years to mint tokens for
     * @param owners Array of yacht owner addresses to receive tokens
     *
     * @custom:requirements
     * - Caller MUST be the contract owner
     * - All owners must have valid ownership percentages
     * - Total ownership percentage must equal 100%
     * - Each year must not have been previously minted
     */
    function mintForOwners(
        uint256[] calldata tokenYears,
        address[] calldata owners
    ) public virtual onlyOwner {
        OwnershipData memory ownershipData = _validateOwnership(owners);
        
        for (uint256 y = 0; y < tokenYears.length; y++) {
            uint256 year = tokenYears[y];
            _mintYearlyTokens(year, owners, ownershipData);
        }
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

    /**
     * @dev Verifies if an address has the required permissions for token operations.
     * @notice Checks that the address is allowed in the allowlist and is either
     *         Mustaa (exempt from yacht ownership) or a yacht owner.
     *
     * @param account The address to check permissions for
     *
     * @custom:requirements
     * - `account` MUST be allowed in the allowlist
     * - `account` MUST be either Mustaa or a yacht owner
     */
    function _verifyPermissions(address account) internal view {
        if (!allowList.isAllowed(account)) revert LSP7Disallowed(account);
        
        if (account != mustaaAddress && !yachtOwnership.isOwner(account)) revert LSP7NotAnOwner(account);
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
        if (!allowList.isAllowed(tokenOwner)) revert LSP7Disallowed(tokenOwner);
        
        bool operatorAllowed = allowList.isAllowed(operator);
        
        if (!operatorAllowed) {
            allowance = 0;
        }
        
        super._updateOperator(tokenOwner, operator, allowance, notified, operatorNotificationData);
    }

    // --- LSP7 Overrides for Yearly Tracking ---

    /**
     * @notice Returns the number of decimals used by the token.
     * @dev Overrides the default LSP7 decimals to return 1 instead of 18.
     * @return The number of decimals (1 for divisible tokens, 0 for non-divisible)
     */
    function decimals() public view virtual override returns (uint8) {
        return _isNonDivisible ? 0 : 1;
    }

    /**
     * @notice Returns the total balance of tokens for an address across all years.
     * @dev Overrides the base implementation to sum yearly balances up to the current year.
     *      This provides a unified view of all tokens owned by an address regardless of year.
     *
     * @param tokenOwner The address to check the balance for
     * @return The total token balance across all years up to the current year
     */
    function balanceOf(
        address tokenOwner
    ) public view virtual override returns (uint256) {
        uint256 currentYear = block.timestamp / 365 days + 1970;
        uint256 totalBalance = 0;
        
        for (uint256 year = 1970; year <= currentYear; year++) {
            totalBalance += _tokenOwnerYearlyBalances[year][tokenOwner];
        }
        
        return totalBalance;
    }

    /**
     * @notice Returns the token balance for a specific address and year.
     * @dev Returns only the balance for the specified year, not the cumulative total.
     *
     * @param tokenOwner The address to check the balance for
     * @param year The year to check the balance for
     * @return The token balance for the specified address and year
     */
    function balanceOfYear(
        address tokenOwner,
        uint256 year
    ) public view virtual returns (uint256) {
        return _tokenOwnerYearlyBalances[year][tokenOwner];
    }

    /**
     * @notice Returns the total supply of tokens minted for a specific year.
     * @dev Returns the sum of all tokens minted for the given year across all addresses.
     *
     * @param year The year to check the supply for
     * @return The total number of tokens minted for the specified year
     */
    function yearlySupply(uint256 year) public view returns (uint256) {
        return _yearlySupply[year];
    }

    /**
     * @dev See {LSP7-_update}.
     * @notice Handles token transfers with year-specific tracking.
     * @dev Manages yearly balance tracking alongside base LSP7 storage. The `data` parameter
     *      must contain the year as the first 32 bytes. Updates yearly balances and supply
     *      accordingly for minting, burning, and transfers.
     *
     * @param from The address tokens are transferred from (address(0) for minting)
     * @param to The address tokens are transferred to (address(0) for burning)
     * @param amount The amount of tokens to transfer
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data containing the year (first 32 bytes)
     *
     * @custom:requirements
     * - `data` MUST contain at least 32 bytes with the year as the first element
     */
    function _update(
        address from,
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) internal virtual override {
        if (data.length < 32) {
            revert("LSP7Time: Invalid data format - year required");
        }

        uint256 year = uint256(bytes32(data));

        if (from == address(0)) {
            _tokenOwnerYearlyBalances[year][to] += amount;
            _yearlySupply[year] += amount;
        } else if (to == address(0)) {
            unchecked {
                _tokenOwnerYearlyBalances[year][from] -= amount;
                _yearlySupply[year] -= amount;
            }
        } else {
            unchecked {
                _tokenOwnerYearlyBalances[year][from] -= amount;
                _tokenOwnerYearlyBalances[year][to] += amount;
            }
        }
        super._update(from, to, amount, force, data);
    }

    /**
     * @dev See {LSP7-_beforeTokenTransfer}.
     * @notice Hook called before any token transfer to validate permissions and balances.
     * @dev Validates addresses and yearly balances based on operation type:
     *      - Minting: Validates only the recipient
     *      - Burning: Validates the sender and checks yearly balance
     *      - Transfer: Validates both addresses and checks yearly balance
     *
     * @param from The sender address (address(0) for minting)
     * @param to The recipient address (address(0) for burning)
     * @param amount The amount of tokens to transfer
     * @param data The data sent alongside the transfer (must contain year information)
     *
     * @custom:requirements
     * - For minting: `to` MUST be allowed and either Mustaa or a yacht owner
     * - For burning: `from` MUST be allowed and have sufficient yearly balance
     * - For transfers: Both `from` and `to` MUST be allowed, and `from` MUST have sufficient yearly balance
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount,
        bool /* force */,
        bytes memory data
    ) internal virtual override {
        if (from == address(0)) {
            _verifyPermissions(to);
        } else if (to == address(0)) {
            _verifyPermissions(from);
            
            if (data.length < 32) {
                revert("LSP7Time: Invalid data format - year required");
            }
            
            uint256 year = uint256(bytes32(data));
            uint256 fromBalance = _tokenOwnerYearlyBalances[year][from];
            if (fromBalance < amount) {
                revert LSP7AmountExceedsBalance(fromBalance, from, amount);
            }
        } else {
            _verifyPermissions(from);
            _verifyPermissions(to);
            
            if (data.length < 32) {
                revert("LSP7Time: Invalid data format - year required");
            }
            
            uint256 year = uint256(bytes32(data));
            uint256 fromBalance = _tokenOwnerYearlyBalances[year][from];
            if (fromBalance < amount) {
                revert LSP7AmountExceedsBalance(fromBalance, from, amount);
            }
        }
    }

    /**
     * @dev See {LSP7-transfer}.
     * @notice Transfers tokens with permission validation for operators.
     * @dev If the caller is not the token owner, validates that the caller is an authorized
     *      operator and spends the appropriate allowance.
     *
     * @param from The address tokens are transferred from
     * @param to The address tokens are transferred to
     * @param amount The amount of tokens to transfer
     * @param force Whether to force the transfer if the recipient doesn't implement LSP1
     * @param data Additional data to include with the transfer (must contain year information)
     *
     * @custom:requirements
     * - If `msg.sender != from`, `msg.sender` MUST be an authorized operator with sufficient allowance
     * - Both `from` and `to` MUST be allowed in the allowlist
     * - `from` MUST have sufficient yearly balance for the specified year
     */
    function transfer(
        address from,
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) public virtual override {
        if (msg.sender != from) {
            _verifyPermissions(msg.sender);
            _spendAllowance({
                operator: msg.sender,
                tokenOwner: from,
                amountToSpend: amount
            });
        }

        _transfer(from, to, amount, force, data);
    }
}
