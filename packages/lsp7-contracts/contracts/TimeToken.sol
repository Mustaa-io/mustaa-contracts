// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAssetInitAbstract} from "./LSP7DigitalAssetInitAbstract.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {YachtOwnership} from "./YachtOwnership.sol";
import {
    LSP7InvalidTransferBatch
} from "./LSP7Errors.sol";

/**
 * @title TimeToken - A time-based token system for yacht usage rights
 * @dev Implementation of LSP7 that manages time-based tokens for yacht booking,
 * with yearly allocations capped at 365 tokens per year
 */
contract TimeToken is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable,
    LSP7DigitalAssetInitAbstract
{
    mapping(uint256 => mapping(address => uint256)) public yearlyBalances;
    mapping(uint256 => uint256) internal _yearlySupply;

    error InvalidOwnerCount();
    error TokensAlreadyMinted(uint256 year, address owner);
    error InvalidDayRange();
    error InsufficientYearlyTokens(uint256 year);
    error YearlySupplyExceeded(uint256 year);
    error InsufficientBalance(uint256 year, uint256 available, uint256 required);
    error InvalidRecipient(address recipient);
    error InvalidOwnership(address owner, uint256 percentage);
    error OwnershipContractNotSet();
    error TotalOwnershipPercentageInvalid();
    error YearlyBalanceInsufficient(uint256 year, uint256 available, uint256 required);
    error RecipientNotAllowedInYachtOwnership(address recipient);
    error InvalidDays();
    error TokensNotExpired(uint256 year, uint256 currentYear);

    uint256 private constant REGULAR_YEAR_SUPPLY = 365;
    uint256 private constant LEAP_YEAR_SUPPLY = 366;
    
    // Mustaa gets 281 in regular years, 282 in leap years
    uint256 private constant MUSTAA_REGULAR_SHARE = 281;
    uint256 private constant MUSTAA_LEAP_SHARE = 282;
    
    // Owners always get 84 tokens to share
    uint256 private constant OWNER_TOTAL_SHARE = 84;
    YachtOwnership public yachtOwnership;

    event YachtBooked(
        address indexed booker,
        uint256 indexed year,
        uint256 numDays,
        uint256 totalTokens
    );

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
     * @notice Initializes the TimeToken contract with initial distributions
     * @dev Mints tokens for two consecutive years to Mustaa and owners
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param newOwner_ The contract owner address
     * @param mustaa_ The Mustaa address that receives 281 tokens per year
     * @param owners_ Array of owner addresses that share 84 tokens per year
     * @param yachtOwnershipAddress_ The address of the YachtOwnership contract
     * @param startingYear_ The first year to mint tokens for
     * @param yearCount_ Number of consecutive years to pre-mint tokens for
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        address mustaa_,
        address[] memory owners_,
        address yachtOwnershipAddress_,
        uint256 startingYear_,
        uint256 yearCount_
    ) public virtual initializer {
        // Initialize parent contracts
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

        if (owners_.length == 0) revert InvalidOwnerCount();
        if (yachtOwnershipAddress_ == address(0)) revert OwnershipContractNotSet();
        yachtOwnership = YachtOwnership(payable(yachtOwnershipAddress_));

        uint256 decimalsFactor = 10 ** decimals();
        
        // Validate all ownerships and calculate total percentage
        uint256[] memory percentages = new uint256[](owners_.length);
        uint256 totalPercentage = 0;
        
        for (uint256 i = 0; i < owners_.length; i++) {
            address owner = owners_[i];
            if (!yachtOwnership.isOwner(owner)) revert InvalidOwnership(owner, 0);
            
            uint256 percentage = yachtOwnership.getOwnershipPercentage(owner);
            if (percentage == 0) revert InvalidOwnership(owner, percentage);
            
            percentages[i] = percentage;
            totalPercentage += percentage;
        }

        // Verify total percentage adds up to 100%
        if (totalPercentage != 10000) revert TotalOwnershipPercentageInvalid();

        // Mint tokens for all specified years
        for (uint256 year = startingYear_; year < startingYear_ + yearCount_; year++) {
            // Calculate Mustaa's share for the year
            uint256 mustaaPerYear = (isLeapYear(year) ? MUSTAA_LEAP_SHARE : MUSTAA_REGULAR_SHARE) * decimalsFactor;
            
            // Verify yearly cap isn't exceeded
            uint256 ownerTotalAmount = OWNER_TOTAL_SHARE * decimalsFactor;
            if (mustaaPerYear + ownerTotalAmount > yearlySupplyCap(year) * decimalsFactor) {
                revert YearlySupplyExceeded(year);
            }
            
            // Mint Mustaa's tokens
            _mint(mustaa_, mustaaPerYear, true, "Annual allocation for Mustaa");
            yearlyBalances[year][mustaa_] = mustaaPerYear;
            _yearlySupply[year] += mustaaPerYear;

            // Mint owners' shares based on yacht ownership percentages
            for (uint256 i = 0; i < owners_.length; i++) {
                address owner = owners_[i];
                uint256 ownerShare = (ownerTotalAmount * percentages[i]) / 10000;
                
                _mint(owner, ownerShare, true, "Annual allocation for owner");
                yearlyBalances[year][owner] = ownerShare;
                _yearlySupply[year] += ownerShare;
            }
        }
    }

    /**
     * @dev Function that authorizes upgrades to the contract.
     * Only the contract owner can upgrade the implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Returns the number of decimal places for the token
     * @dev Overrides the default decimals function to return 1 for divisible tokens
     * @return uint8 The number of decimal places
     */
    function decimals() public view virtual override returns (uint8) {
        return _isNonDivisible ? 0 : 1;
    }

    /**
     * @notice Returns the total supply of tokens for a specific year
     * @dev Tracks the total tokens minted for each year
     * @param year The year to check the supply for
     * @return The total number of tokens minted for the specified year
     */
    function yearlySupply(uint256 year) public view returns (uint256) {
        return _yearlySupply[year];
    }

    /**
     * @dev Determines if a given year is a leap year
     * @param year The year to check
     * @return bool True if it's a leap year, false otherwise
     */
    function isLeapYear(uint256 year) public pure returns (bool) {
        return year == 2024 || year == 2028 || year == 2032;
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
     * @notice Transfer tokens for a specific year from one address to another
     * @param from The address to transfer tokens from
     * @param to The address to transfer tokens to
     * @param amount The amount of tokens to transfer
     * @param year The specific year the tokens belong to
     * @param force Whether to force the transfer to contracts not implementing LSP1
     * @param data Additional data for the transfer
     */
    function transferForYear(
        address from,
        address to,
        uint256 amount,
        uint256 year,
        bool force,
        bytes memory data
    ) public virtual {
        // Check if recipient is allowed in YachtOwnership
        if (!yachtOwnership.allowed(to)) {
            revert RecipientNotAllowedInYachtOwnership(to);
        }
        
        // Check if the sender has enough tokens for the specific year
        if (yearlyBalances[year][from] < amount) {
            revert YearlyBalanceInsufficient(year, yearlyBalances[year][from], amount);
        }
        
        // If sender is not the caller, check allowance
        if (msg.sender != from) {
            _spendAllowance({
                operator: msg.sender,
                tokenOwner: from,
                amountToSpend: amount
            });
        }
        
        // Update yearly balances
        yearlyBalances[year][from] -= amount;
        yearlyBalances[year][to] += amount;
        
        // Call the parent transfer implementation to handle the actual token transfer
        _transfer(from, to, amount, force, data);
    }

    /**
     * @notice Override the default transfer to disallow it
     * @dev This prevents users from transferring tokens without specifying a year
     */
    function transfer(
        address from,
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) public virtual override {
        revert("Use transferForYear instead");
    }

    /**
     * @notice Override _update to ensure yearly balances are maintained
     * @dev This ensures the base token operations still work with our yearly tracking
     */
    function _update(
        address from,
        address to,
        uint256 amount,
        bool force,
        bytes memory data
    ) internal virtual override {
        // Yearly balance updates are handled in transferForYear
        // This is called by _transfer which is called by transferForYear
        
        // Add YachtOwnership permission check here too for safety
        if (from != address(0)) {
            if (!yachtOwnership.allowed(from)) {
                revert RecipientNotAllowedInYachtOwnership(from);
            }
        }
        if (to != address(0)) {
            if (!yachtOwnership.allowed(to)) {
                revert RecipientNotAllowedInYachtOwnership(to);
            }
        }
        
        super._update(from, to, amount, force, data);
    }

    /**
     * @notice Create a batch of year-specific transfers
     * @param from Array of sender addresses
     * @param to Array of recipient addresses
     * @param amount Array of amounts to transfer
     * @param yearBalances Array of years for each transfer
     * @param force Array of force flags
     * @param data Array of additional data
     */
    function transferBatchForYears(
        address[] memory from,
        address[] memory to,
        uint256[] memory amount,
        uint256[] memory yearBalances,
        bool[] memory force,
        bytes[] memory data
    ) public virtual {
        uint256 fromLength = from.length;
        if (
            fromLength != to.length ||
            fromLength != amount.length ||
            fromLength != force.length ||
            fromLength != data.length ||
            fromLength != yearBalances.length
        ) {
            revert LSP7InvalidTransferBatch();
        }

        for (uint256 i; i < fromLength; ) {
            transferForYear(from[i], to[i], amount[i], yearBalances[i], force[i], data[i]);

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice Burns expired tokens from a specific year
     * @dev Only callable by owner, and only for years before current year
     * @param from The address to burn tokens from
     * @param year The year of tokens to burn
     */
    function burnExpiredTokens(address from, uint256 year) public onlyOwner {
        // Get current year
        uint256 currentYear = block.timestamp / 365 days + 1970;
        
        // Can only burn tokens from past years
        if (year >= currentYear) {
            revert TokensNotExpired(year, currentYear);
        }

        uint256 expiredBalance = yearlyBalances[year][from];
        if (expiredBalance > 0) {
            // Update yearly tracking
            yearlyBalances[year][from] = 0;
            _yearlySupply[year] -= expiredBalance;
            
            // Burn the tokens
            _burn(from, expiredBalance, "Expired tokens");
        }
    }

    /**
     * @notice Burns expired tokens from a specific year for multiple addresses
     * @dev Only callable by owner, and only for years before current year
     * @param addresses Array of addresses to burn tokens from
     * @param year The year of tokens to burn
     */
    function batchBurnExpiredTokens(address[] calldata addresses, uint256 year) public onlyOwner {
        for (uint256 i = 0; i < addresses.length; i++) {
            burnExpiredTokens(addresses[i], year);
        }
    }

    /**
     * @notice Book using tokens from a specific year
     * @param numDays The number of days to book
     * @param year The year from which to use tokens
     */
    function book(uint256 numDays, uint256 year) public virtual nonReentrant {
        // Check if sender is allowed
        if (!yachtOwnership.allowed(msg.sender)) {
            revert RecipientNotAllowedInYachtOwnership(msg.sender);
        }
        
        // Check if days is valid
        if (numDays == 0) {
            revert InvalidDays();
        }
        
        uint256 decimalsFactor = 10 ** decimals();
        uint256 tokenAmount = numDays * decimalsFactor;
        
        if (yearlyBalances[year][msg.sender] < tokenAmount) 
            revert InsufficientBalance(year, yearlyBalances[year][msg.sender], tokenAmount);
        
        yearlyBalances[year][msg.sender] -= tokenAmount;
        _yearlySupply[year] -= tokenAmount;

        emit YachtBooked(msg.sender, year, numDays, tokenAmount);
    }

    /**
     * @notice Cancel a booking and return tokens to a specific year's balance
     * @param numDays The number of days to unbook
     * @param year The year of the booking
     * @param to The address to receive the returned tokens
     */
    function cancelBooking(uint256 numDays, uint256 year, address to) public virtual nonReentrant {
        if (to == address(0)) revert InvalidRecipient(to);
        if (!yachtOwnership.allowed(to)) revert RecipientNotAllowedInYachtOwnership(to);
        
        uint256 decimalsFactor = 10 ** decimals();
        uint256 tokenAmount = numDays * decimalsFactor;
        
        _yearlySupply[year] += tokenAmount;
        yearlyBalances[year][to] += tokenAmount;

        emit YachtBookingCancelled(msg.sender, to, year, numDays, tokenAmount);
    }
}