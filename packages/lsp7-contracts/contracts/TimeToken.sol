// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAssetInitAbstractTime} from "./LSP7DigitalAssetInitAbstractTime.sol";
import {AllowList} from "./AllowList.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {YachtOwnership} from "./YachtOwnership.sol";
import {
    LSP7InvalidTransferBatch,
    LSP7CannotSendWithAddressZero
} from "./LSP7Errors.sol";

/**
 * @title TimeToken - A time-based token system for yacht usage rights
 * @dev Implementation of LSP7 that manages time-based tokens for yacht booking,
 * @author Mustaa
 * with yearly allocations based on ownership percentages and specific rules:
 * 
 * Key features:
 * - Yearly token distribution (365/366 tokens per year)
 * - Mustaa receives 281/282 tokens (regular/leap year)
 * - Yacht owners share 84 tokens proportionally
 * - Token transfers are year-specific
 * - Booking system for yacht usage
 * - Expired tokens can be burned
 * - Integration with YachtOwnership for access control
 *
 * The system ensures:
 * - Only allowed users can participate
 * - Tokens are tracked per year
 * - Proper distribution based on ownership
 */
contract TimeToken is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    LSP7DigitalAssetInitAbstractTime
{

    // --- Errors

    error InvalidOwnerCount();
    error InvalidDayRange();
    error InsufficientYearlyTokens(uint256 year);
    error YearlySupplyExceeded(uint256 year);
    error InsufficientBalance(uint256 year, uint256 available, uint256 required);
    error InvalidRecipient(address recipient);
    error InvalidOwnership(address owner, uint256 percentage);
    error OwnershipContractNotSet();
    error AllowListNotSet();
    error TotalOwnershipPercentageInvalid();
    error YearlyBalanceInsufficient(uint256 year, uint256 available, uint256 required);
    error LSP7NotAnOwner(address recipient);
    error InvalidDays();
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

    // --- Events

    /**
     * @dev Emitted when yacht days are booked
     */
    event YachtBooked(
        address indexed booker,
        uint256 indexed year,
        uint256 numDays,
        uint256 totalTokens
    );

    /**
     * @dev Emitted when a booking is cancelled
     */
    event YachtBookingCancelled(
        address indexed booker,
        address indexed recipient,
        uint256 indexed year,
        uint256 numDays,
        uint256 totalTokens
    );

    // Add a gap to prevent storage clashes in future upgrades
    uint256[50] private __gap;

    /**
     * @dev Helper struct to hold ownership validation results
     */
    struct OwnershipData {
        uint256[] percentages;
        uint256 totalPercentage;
        uint256 mustaaPercentage;
    }

    /**
     * @dev Validates owners and calculates ownership percentages
     * @param owners Array of owner addresses to validate
     * @return OwnershipData containing validated percentages and totals
     */
    function _validateOwnership(
        address[] memory owners
    ) internal view returns (OwnershipData memory) {
        if (owners.length == 0) revert InvalidOwnerCount();
        
        OwnershipData memory data;
        data.percentages = new uint256[](owners.length);
        
        // Check if Mustaa is a yacht owner and account for its percentage
        if (yachtOwnership.isOwner(mustaaAddress)) {
            data.mustaaPercentage = yachtOwnership.getOwnershipPercentage(mustaaAddress);
        }
        
        // Validate all owners and their percentages
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            if (!yachtOwnership.isOwner(owner)) revert InvalidOwnership(owner, 0);
            
            uint256 percentage = yachtOwnership.getOwnershipPercentage(owner);
            if (percentage == 0) revert InvalidOwnership(owner, percentage);
            
            data.percentages[i] = percentage;
            data.totalPercentage += percentage;
        }
        
        // Include Mustaa's percentage in the total validation
        if (data.totalPercentage + data.mustaaPercentage != 10000) revert TotalOwnershipPercentageInvalid();
        
        return data;
    }

    /**
     * @dev Mints tokens for a specific year to Mustaa and other owners
     * @param year The year to mint tokens for
     * @param owners Array of owner addresses
     * @param ownershipData Validated ownership data
     */
    function _mintYearlyTokens(
        uint256 year,
        address[] memory owners,
        OwnershipData memory ownershipData
    ) internal {
        uint256 decimalsFactor = 10 ** decimals();
        uint256 mustaaPerYear = (isLeapYear(year) ? MUSTAA_LEAP_SHARE : MUSTAA_REGULAR_SHARE) * decimalsFactor;
        uint256 ownerTotalAmount = OWNER_TOTAL_SHARE * decimalsFactor;
        
        // Check existing yearly supply and total supply cap
        uint256 currentYearlySupply = _yearlySupply[year];
        if (currentYearlySupply > 0 || (mustaaPerYear + ownerTotalAmount > yearlySupplyCap(year) * decimalsFactor)) {
            revert YearlySupplyExceeded(year);
        }
        
        // Mint Mustaa's special allocation
        _mint(mustaaAddress, mustaaPerYear, true, abi.encode(year, "Annual allocation for Mustaa"));
        
        // Distribute tokens among other owners
        uint256 nonMustaaTotal = ownershipData.totalPercentage;
        for (uint256 i = 0; i < owners.length; i++) {
            uint256 ownerShare = (ownerTotalAmount * ownershipData.percentages[i]) / nonMustaaTotal;
            _mint(owners[i], ownerShare, true, abi.encode(year, "Annual allocation for owner"));
        }
    }

    /**
     * @notice Initializes the TimeToken contract with initial distributions
     * @dev Mints tokens for specified years to Mustaa and owners based on yacht ownership
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
            0, // lsp4TokenType
            false // isNonDivisible
        );

        if (yachtOwnershipAddress_ == address(0)) revert OwnershipContractNotSet();
        yachtOwnership = YachtOwnership(payable(yachtOwnershipAddress_));

        if (allowListAddress_ == address(0)) revert AllowListNotSet();
        allowList = AllowList(payable(allowListAddress_));
        
        mustaaAddress = mustaa_;

        // Validate ownership and get percentages
        OwnershipData memory ownershipData = _validateOwnership(owners_);

        // Ensure startingYear_ is not in the past
        uint256 currentYear = block.timestamp / 365 days + 1970;
        if (startingYear_ < currentYear) revert InvalidStartingYear(startingYear_, currentYear);

        // Mint tokens for each year
        for (uint256 year = startingYear_; year < startingYear_ + yearCount_; year++) {
            _mintYearlyTokens(year, owners_, ownershipData);
        }
    }

    /**
     * @dev Function that authorizes upgrades to the contract.
     * Only the contract owner can upgrade the implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @dev Determines if a given year is a leap year according to the Gregorian calendar
     * @param year The year to check
     * @return bool True if it's a leap year, false otherwise
     * 
     * The rules are:
     * 1. Years divisible by 4 are leap years
     * 2. Exception: Century years (divisible by 100) are NOT leap years
     * 3. Exception to the exception: Century years divisible by 400 ARE leap years
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
     * @notice Burns tokens from a past year that have expired
     * @dev Only owner can call this function, and only for years before the current year
     * @param tokenOwner The address whose tokens to burn
     * @param year The year of tokens to burn
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
     * @notice Burns tokens from a past year for multiple addresses
     * @dev Only owner can call this function, and only for years before the current year
     * @param tokenOwners Array of addresses whose tokens to burn
     * @param year The year of tokens to burn
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
     * @notice Mints new tokens to a set of yacht owners for specific years
     * @dev Only contract owner can call this function
     * @param tokenYears Array of years to mint tokens for
     * @param owners Array of yacht owner addresses to receive tokens
     */
    function mintForOwners(
        uint256[] calldata tokenYears,
        address[] calldata owners
    ) public virtual onlyOwner {
        // Validate ownership and get percentages
        OwnershipData memory ownershipData = _validateOwnership(owners);
        
        // Mint tokens for each year
        for (uint256 y = 0; y < tokenYears.length; y++) {
            uint256 year = tokenYears[y];
            _mintYearlyTokens(year, owners, ownershipData);
        }
    }

    function allowed(address account) public view virtual returns (bool) {
        return allowList.isAllowed(account);
    }

    /**
     * @dev Helper function to verify if an address has the required permissions
     * @param account The address to check permissions for
     */
    function _verifyPermissions(address account) internal view {
        if (!allowList.isAllowed(account)) revert LSP7Disallowed(account);
        
        // Mustaa is exempt from yacht ownership requirement
        if (account != mustaaAddress && !yachtOwnership.isOwner(account)) revert LSP7NotAnOwner(account);
    }

    /**
     * @dev Hook that is called before any token transfer, including minting and burning.
     * Validates addresses based on operation type:
     * - Minting (from = address(0)): Check only recipient
     * - Burning (to = address(0)): Check only sender
     * - Regular Transfer: Check both addresses
     *
     * @param from The sender address
     * @param to The recipient address
     * @param amount The amount of token to transfer
     * @param force A boolean that describe if transfer to a `to` address that does not support LSP1 is allowed or not.
     * @param data The data sent alongside the transfer
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) internal virtual override {
        if (from == address(0)) {
            _verifyPermissions(to);
        } else if (to == address(0)) {
            _verifyPermissions(from);
        } else {
            _verifyPermissions(from);
            _verifyPermissions(to);
        }
    }

    /**
     * @inheritdoc LSP7DigitalAssetInitAbstractTime
     * @dev Override to add permission check for operators
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