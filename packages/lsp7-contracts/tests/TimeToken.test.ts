import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

describe("TimeToken", function () {
  let timeToken: any;
  let owner: any;
  let mustaa: any;
  let owner1: any;
  let owner2: any;
  let ownerAddress: string;
  let mustaaAddress: string;
  let owner1Address: string;
  let owner2Address: string;

  const TOKEN_NAME = "Time Token";
  const TOKEN_SYMBOL = "TIME";
  const STARTING_YEAR = 2024;

  beforeEach(async function () {
    // Get the signers
    [owner, mustaa, owner1, owner2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    mustaaAddress = await mustaa.getAddress();
    owner1Address = await owner1.getAddress();
    owner2Address = await owner2.getAddress();

    // Deploy the token contract
    const TimeToken = await ethers.getContractFactory("TimeToken");
    timeToken = await TimeToken.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      ownerAddress,
      mustaaAddress,
      [owner1Address, owner2Address],
      STARTING_YEAR
    );
  });

  describe("Deployment", function () {
    it("Should mint correct initial tokens to Mustaa and owners", async function () {
      // For 2024 (leap year)
      // Mustaa should get 282 tokens
      expect(await timeToken.yearlyBalances(2024, mustaaAddress)).to.equal(BigInt(282) * BigInt(10) ** BigInt(1));
      
      // Each owner should get 42 tokens (84 split between 2 owners)
      expect(await timeToken.yearlyBalances(2024, owner1Address)).to.equal(BigInt(42) * BigInt(10) ** BigInt(1));
      expect(await timeToken.yearlyBalances(2024, owner2Address)).to.equal(BigInt(42) * BigInt(10) ** BigInt(1));

      // For 2025 (regular year)
      // Mustaa should get 281 tokens
      expect(await timeToken.yearlyBalances(2025, mustaaAddress)).to.equal(BigInt(281) * BigInt(10) ** BigInt(1));
      
      // Each owner should get 42 tokens
      expect(await timeToken.yearlyBalances(2025, owner1Address)).to.equal(BigInt(42) * BigInt(10) ** BigInt(1));
      expect(await timeToken.yearlyBalances(2025, owner2Address)).to.equal(BigInt(42) * BigInt(10) ** BigInt(1));
    });
  });

  describe("Core functionality", function () {
    it("Should correctly identify leap years", async function () {
      expect(await timeToken.isLeapYear(2024)).to.be.true;
      expect(await timeToken.isLeapYear(2025)).to.be.false;
      expect(await timeToken.isLeapYear(2028)).to.be.true;
      expect(await timeToken.isLeapYear(2032)).to.be.true;
    });

    it("Should have correct decimals and token units", async function () {
      expect(await timeToken.decimals()).to.equal(1);
      
      // 1.0 token should be represented as 10 in contract (1 * 10^1)
      const oneToken = BigInt(10);
      expect(oneToken).to.equal(BigInt(10) ** BigInt(1));
    });

    it("Should return correct yearly supply caps", async function () {
      expect(await timeToken.yearlySupplyCap(2024)).to.equal(366); // Leap year
      expect(await timeToken.yearlySupplyCap(2025)).to.equal(365); // Regular year
    });

    it("Should revert when non-owner tries to mint annual tokens", async function () {
      await expect(
        timeToken.connect(mustaa).mintAnnualTokens(
          2026,
          [owner1Address, owner2Address],
          mustaaAddress
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Booking functionality", function () {
    it("Should allow Mustaa to book days", async function () {
      const daysToBook = 5;
      const year = 2024;
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const initialBalance = await timeToken.yearlyBalances(year, mustaaAddress);

      await timeToken.connect(mustaa).book(daysToBook, year);

      const finalBalance = await timeToken.yearlyBalances(year, mustaaAddress);
      expect(finalBalance).to.equal(initialBalance - (BigInt(daysToBook) * decimalsFactor));
    });

    it("Should allow owner to book days", async function () {
      const daysToBook = 3;
      const year = 2024;
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const initialBalance = await timeToken.yearlyBalances(year, owner1Address);

      await timeToken.connect(owner1).book(daysToBook, year);

      const finalBalance = await timeToken.yearlyBalances(year, owner1Address);
      expect(finalBalance).to.equal(initialBalance - (BigInt(daysToBook) * decimalsFactor));
    });

    it("Should allow booking and cancellation with correct token return", async function () {
      const daysToBook = 5;
      const year = 2024;
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const initialBalance = await timeToken.yearlyBalances(year, mustaaAddress);

      // Book days
      await timeToken.connect(mustaa).book(daysToBook, year);
      
      // Cancel booking
      await timeToken.connect(mustaa).cancelBooking(daysToBook, year, mustaaAddress);

      // Check if balance is restored
      const finalBalance = await timeToken.yearlyBalances(year, mustaaAddress);
      expect(finalBalance).to.equal(initialBalance);
    });

    it("Should revert when trying to book more days than available", async function () {
      const year = 2024;
      const tooManyDays = 300;  // More than any single party's allocation
      const decimalsFactor = BigInt(10) ** BigInt(1);

      await expect(
        timeToken.connect(mustaa).book(tooManyDays, year)
      ).to.be.revertedWithCustomError(timeToken, "InsufficientBalance")
        .withArgs(year, await timeToken.yearlyBalances(year, mustaaAddress), BigInt(tooManyDays) * decimalsFactor);
    });
  });
});
