// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

// modules
import {LSP7DigitalAsset} from "./LSP7DigitalAsset.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title TimeToken - A time-based token system for yacht usage rights
 * @dev Implementation of LSP7 that manages time-based tokens for yacht booking,
 * with yearly allocations capped at 365 tokens per year
 */
contract TimeToken is LSP7DigitalAsset, ReentrancyGuard {
    mapping(uint256 => mapping(address => uint256)) public yearlyBalances;
    mapping(uint256 => uint256) private _yearlySupply;

    error InvalidOwnerCount();
    error TokensAlreadyMinted(uint256 year, address owner);
    error InvalidDayRange();
    error InsufficientYearlyTokens(uint256 year);
    error YearlySupplyExceeded(uint256 year);
    error InsufficientBalance(uint256 year, uint256 available, uint256 required);
    error InvalidRecipient(address recipient);

    uint256 private constant REGULAR_YEAR_SUPPLY = 365;
    uint256 private constant LEAP_YEAR_SUPPLY = 366;
    
    // Mustaa gets 281 in regular years, 282 in leap years
    uint256 private constant MUSTAA_REGULAR_SHARE = 281;
    uint256 private constant MUSTAA_LEAP_SHARE = 282;
    
    // Owners always get 84 tokens to share
    uint256 private constant OWNER_TOTAL_SHARE = 84;

    // Add these events at the contract level
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

    /**
     * @notice Initializes the TimeToken contract with initial distributions
     * @dev Mints tokens for two consecutive years to Mustaa and owners
     * @param name_ The name of the token
     * @param symbol_ The symbol of the token
     * @param newOwner_ The contract owner address
     * @param mustaa_ The Mustaa address that receives 281 tokens per year
     * @param owners_ Array of owner addresses that share 84 tokens per year
     * @param startingYear_ The first year to mint tokens for
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address newOwner_,
        address mustaa_,
        address[] memory owners_,
        uint256 startingYear_
    )
        LSP7DigitalAsset(
            name_,
            symbol_,
            newOwner_,
            0,
            false
        )
    {
        if (owners_.length == 0) revert InvalidOwnerCount();

        uint256 decimalsFactor = 10 ** decimals();
        
        for (uint256 year = startingYear_; year < startingYear_ + 2; year++) {
            // Use correct share based on year type
            uint256 mustaaPerYear = (isLeapYear(year) ? MUSTAA_LEAP_SHARE : MUSTAA_REGULAR_SHARE) * decimalsFactor;
            uint256 ownerTotalPerYear = OWNER_TOTAL_SHARE * decimalsFactor;
            uint256 ownerShare = ownerTotalPerYear / owners_.length;

            _mint(mustaa_, mustaaPerYear, true, "Annual allocation for Mustaa");
            yearlyBalances[year][mustaa_] = mustaaPerYear;
            _yearlySupply[year] += mustaaPerYear;

            for (uint256 i = 0; i < owners_.length; i++) {
                address owner = owners_[i];
                _mint(owner, ownerShare, true, "Annual allocation for owner");
                yearlyBalances[year][owner] += ownerShare;
                _yearlySupply[year] += ownerShare;
            }
        }
    }

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
     * @dev Internal function to mint tokens while respecting the yearly supply cap
     * @param to The address to receive the tokens
     * @param amount The amount of tokens to mint
     * @param year The year for which tokens are being minted
     * @param force Whether to force the transfer if the recipient is a contract
     * @param data Additional data to be passed along with the mint
     */
    function _mintWithYearlyCap(
        address to,
        uint256 amount,
        uint256 year,
        bool force,
        bytes memory data
    ) internal virtual {
        if (_yearlySupply[year] + amount > yearlySupplyCap(year)) {
            revert YearlySupplyExceeded(year);
        }

        _mint(to, amount, force, data);
        _yearlySupply[year] += amount;
    }

    /**
     * @notice Mints the annual token allocation for a specific year
     * @dev Handles different allocations for leap years vs regular years
     * @param year The year to mint tokens for
     * @param owners Array of owner addresses to receive their shares
     * @param mustaa The Mustaa address to receive their share
     */
    function mintAnnualTokens(uint256 year, address[] memory owners, address mustaa) public onlyOwner {
        if (owners.length == 0) revert InvalidOwnerCount();
        
        uint256 decimalsFactor = 10 ** decimals();
        uint256 mustaaAmount = (isLeapYear(year) ? MUSTAA_LEAP_SHARE : MUSTAA_REGULAR_SHARE) * decimalsFactor;
        uint256 ownerTotalAmount = OWNER_TOTAL_SHARE * decimalsFactor;
        uint256 ownerShare = ownerTotalAmount / owners.length;

        // Mint Mustaa's share
        _mintWithYearlyCap(mustaa, mustaaAmount, year, true, "Annual allocation for Mustaa");
        yearlyBalances[year][mustaa] = mustaaAmount;

        // Mint each owner's share
        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            if (yearlyBalances[year][owner] != 0) revert TokensAlreadyMinted(year, owner);
            
            _mintWithYearlyCap(owner, ownerShare, year, true, "Annual allocation for owner");
            yearlyBalances[year][owner] = ownerShare;
        }
    }

    /**
     * @notice Books the yacht for a specified number of days
     * @dev Each day costs exactly 1 token
     * @param numDays The number of days to book (1 token per day)
     * @param year The year for which to book
     */
    function book(uint256 numDays, uint256 year) public nonReentrant {
        uint256 decimalsFactor = 10 ** decimals();
        uint256 tokenAmount = numDays * decimalsFactor;
        
        if (yearlyBalances[year][msg.sender] < tokenAmount) 
            revert InsufficientBalance(year, yearlyBalances[year][msg.sender], tokenAmount);
        
        yearlyBalances[year][msg.sender] -= tokenAmount;
        _yearlySupply[year] -= tokenAmount;

        emit YachtBooked(msg.sender, year, numDays, tokenAmount);
    }

    /**
     * @notice Cancels a booking and returns the tokens
     * @dev Each day equals one token
     * @param numDays The number of days to unbook (1 token per day)
     * @param year The year of the booking
     * @param to The address to receive the returned tokens
     */
    function cancelBooking(uint256 numDays, uint256 year, address to) public nonReentrant {
        if (to == address(0)) revert InvalidRecipient(to);
        
        uint256 decimalsFactor = 10 ** decimals();
        uint256 tokenAmount = numDays * decimalsFactor;
        
        _yearlySupply[year] += tokenAmount;
        yearlyBalances[year][to] += tokenAmount;

        emit YachtBookingCancelled(msg.sender, to, year, numDays, tokenAmount);
    }
}