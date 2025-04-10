import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";

describe("TimeToken", function () {
  let timeToken: any;
  let yachtToken: any;
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
  const YACHT_TOKEN_NAME = "Yacht Token";
  const YACHT_TOKEN_SYMBOL = "YACHT";
  const STARTING_YEAR = 2024;
  const MAX_SUPPLY = ethers.parseEther("1000"); // 1000 tokens

  beforeEach(async function () {
    // Get the signers
    [owner, mustaa, owner1, owner2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    mustaaAddress = await mustaa.getAddress();
    owner1Address = await owner1.getAddress();
    owner2Address = await owner2.getAddress();

    // First deploy YachtOwnership
    const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
    yachtToken = await upgrades.deployProxy(
      YachtOwnership,
      [
        YACHT_TOKEN_NAME,
        YACHT_TOKEN_SYMBOL,
        ownerAddress,
        MAX_SUPPLY
      ],
      { initializer: 'initialize' }
    );

    // Allow users and mint yacht tokens
    await yachtToken.allowUser(owner1Address);
    await yachtToken.allowUser(owner2Address);
    await yachtToken.allowUser(mustaaAddress);
    // Mint 50-50 ownership to owner1 and owner2
    await yachtToken.mint(owner1Address, ethers.parseEther("500"), true, "0x");
    await yachtToken.mint(owner2Address, ethers.parseEther("500"), true, "0x");

    // Then deploy TimeToken
    const TimeToken = await ethers.getContractFactory("TimeToken");
    timeToken = await upgrades.deployProxy(
      TimeToken,
      [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        ownerAddress,
        mustaaAddress,
        [owner1Address, owner2Address],
        await yachtToken.getAddress(),
        STARTING_YEAR,
        5
      ],
      { initializer: 'initialize' }
    );
  });

  describe("Proxy Deployment", function () {
    it("Should deploy via proxy and initialize correctly", async function () {
      // Check that implementation address exists
      const implementationAddress = await upgrades.erc1967.getImplementationAddress(
        await timeToken.getAddress()
      );
      expect(implementationAddress).to.be.properAddress;
      
      // Verify initialization worked
      const decimalsFactor = BigInt(10) ** BigInt(1);
      // Mustaa should get 282 tokens (leap year 2024)
      expect(await timeToken.yearlyBalances(2024, mustaaAddress))
        .to.equal(BigInt(282) * decimalsFactor);
      
      // Each owner should get 42 tokens (50% of 84 tokens)
      expect(await timeToken.yearlyBalances(2024, owner1Address))
        .to.equal(BigInt(42) * decimalsFactor);
      expect(await timeToken.yearlyBalances(2024, owner2Address))
        .to.equal(BigInt(42) * decimalsFactor);
    });

    it("Should initialize with correct yacht ownership contract", async function () {
      expect(await timeToken.yachtOwnership()).to.equal(await yachtToken.getAddress());
    });

    it("Should mint tokens for 5 years based on yacht ownership", async function () {
      const decimalsFactor = BigInt(10) ** BigInt(1);
      
      // Check balances for all 5 years
      for (let year = STARTING_YEAR; year < STARTING_YEAR + 5; year++) {
        const isLeapYear = await timeToken.isLeapYear(year);
        const mustaaShare = isLeapYear ? 282 : 281;
        
        // Check Mustaa's balance
        expect(await timeToken.yearlyBalances(year, mustaaAddress))
          .to.equal(BigInt(mustaaShare) * decimalsFactor);
        
        // Check owners' balances (42 tokens each - 50% of 84)
        expect(await timeToken.yearlyBalances(year, owner1Address))
          .to.equal(BigInt(42) * decimalsFactor);
        expect(await timeToken.yearlyBalances(year, owner2Address))
          .to.equal(BigInt(42) * decimalsFactor);
      }
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade to TimeTokenV2 and use new discount functionality", async function () {
      // Deploy the V2 implementation
      const TimeTokenV2 = await ethers.getContractFactory("TimeTokenV2");
      const upgradedToken = await upgrades.upgradeProxy(await timeToken.getAddress(), TimeTokenV2);
      
      // Check version function (new in V2)
      expect(await upgradedToken.version()).to.equal("v2.0");
      
      // Test discount functionality
      // Set a 20% discount for Mustaa
      await upgradedToken.setDiscount(mustaaAddress, 20);
      expect(await upgradedToken.discountRates(mustaaAddress)).to.equal(20);
      
      // Calculate tokens needed before booking
      const year = 2024;
      const daysToBook = 5;
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const initialBalance = await upgradedToken.yearlyBalances(year, mustaaAddress);
      
      // Book days - with 20% discount, should use 4 tokens for 5 days
      await upgradedToken.connect(mustaa).book(daysToBook, year);
      
      // Should use 80% of tokens (20% discount)
      const discountedTokenAmount = BigInt(daysToBook) * decimalsFactor * BigInt(80) / BigInt(100);
      const expectedFinalBalance = initialBalance - discountedTokenAmount;
      
      expect(await upgradedToken.yearlyBalances(year, mustaaAddress)).to.equal(expectedFinalBalance);
    });
  });

  describe("Initialization validation", function () {
    it("Should revert if trying to initialize with non-yacht-owners", async function () {
      const nonOwner = (await ethers.getSigners())[4];
      const TimeToken = await ethers.getContractFactory("TimeToken");
      
      await expect(
        upgrades.deployProxy(
          TimeToken,
          [
            TOKEN_NAME,
            TOKEN_SYMBOL,
            ownerAddress,
            mustaaAddress,
            [nonOwner.address], // Using non-owner address
            await yachtToken.getAddress(),
            STARTING_YEAR,
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "InvalidOwnership")
        .withArgs(nonOwner.address, 0);
    });

    it("Should revert if total ownership percentage is not 100%", async function () {
      // Deploy a new yacht token where we can control the percentages
      const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
      const testYachtToken = await upgrades.deployProxy(
        YachtOwnership,
        [
          "Test Yacht", 
          "TEST", 
          ownerAddress, 
          MAX_SUPPLY
        ],
        { initializer: 'initialize' }
      );
      
      // Allow owners but mint a split that doesn't equal 100%
      await testYachtToken.allowUser(owner1Address);
      await testYachtToken.allowUser(owner2Address);
      
      // Mint 90% to owner1 and only 5% to owner2 (total 95%)
      await testYachtToken.mint(owner1Address, ethers.parseEther("900"), true, "0x");
      await testYachtToken.mint(owner2Address, ethers.parseEther("50"), true, "0x");
      
      // Now try to initialize with these owners (both valid, but total != 100%)
      const TimeToken = await ethers.getContractFactory("TimeToken");
      await expect(
        upgrades.deployProxy(
          TimeToken,
          [
            TOKEN_NAME,
            TOKEN_SYMBOL,
            ownerAddress,
            mustaaAddress,
            [owner1Address, owner2Address],
            await testYachtToken.getAddress(), // Use our test yacht token
            STARTING_YEAR,
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "TotalOwnershipPercentageInvalid");
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

  describe("Year-specific transfer functionality", function () {
    let nonAllowedUser: any;
    
    beforeEach(async function () {
      // Set up a non-allowed user for testing
      nonAllowedUser = (await ethers.getSigners())[5];
    });
    
    it("Should revert when using the standard transfer function", async function () {
      await expect(
        timeToken.connect(mustaa).transfer(
          mustaaAddress,
          owner1Address,
          ethers.parseEther("1"),
          true,
          "0x"
        )
      ).to.be.revertedWith("Use transferForYear instead");
    });
    
    it("Should allow transferring tokens for a specific year", async function () {
      const year = 2024;
      const transferAmount = BigInt(5); // 0.5 tokens (with 1 decimal)
      const decimalsFactor = BigInt(10);
      
      const mustaaInitialBalance = await timeToken.yearlyBalances(year, mustaaAddress);
      const owner1InitialBalance = await timeToken.yearlyBalances(year, owner1Address);
      
      // Transfer from Mustaa to owner1
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        owner1Address,
        transferAmount * decimalsFactor,
        year,
        true,
        "0x"
      );
      
      // Check balances were updated correctly
      expect(await timeToken.yearlyBalances(year, mustaaAddress))
        .to.equal(mustaaInitialBalance - (transferAmount * decimalsFactor));
      expect(await timeToken.yearlyBalances(year, owner1Address))
        .to.equal(owner1InitialBalance + (transferAmount * decimalsFactor));
    });
    
    it("Should revert when transferring more tokens than available for a specific year", async function () {
      const year = 2024;
      const tooManyTokens = BigInt(300); // More than Mustaa's allocation
      const decimalsFactor = BigInt(10);
      
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          owner1Address,
          tooManyTokens * decimalsFactor,
          year, 
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "YearlyBalanceInsufficient");
    });
    
    it("Should revert when transferring to a non-allowed recipient", async function () {
      const year = 2024;
      const transferAmount = BigInt(5);
      const decimalsFactor = BigInt(10);
      
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          nonAllowedUser.address,
          transferAmount * decimalsFactor,
          year,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership")
        .withArgs(nonAllowedUser.address);
    });
    
    it("Should allow operators to transfer on behalf of token owners", async function () {
      const year = 2024;
      const transferAmount = BigInt(5);
      const decimalsFactor = BigInt(10);
      const operatorAllowance = BigInt(10) * decimalsFactor;
      
      // Mustaa authorizes owner as operator
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress,
        operatorAllowance,
        "0x"
      );
      
      // Owner transfers on behalf of Mustaa
      await timeToken.connect(owner).transferForYear(
        mustaaAddress,
        owner1Address,
        transferAmount * decimalsFactor,
        year,
        true,
        "0x"
      );
      
      // Verify balances
      const mustaaBalance = await timeToken.yearlyBalances(year, mustaaAddress);
      const owner1Balance = await timeToken.yearlyBalances(year, owner1Address);
      const expectedMustaaBalance = BigInt(282) * decimalsFactor - (transferAmount * decimalsFactor);
      
      expect(mustaaBalance).to.equal(expectedMustaaBalance);
    });
    
    it("Should support batch transfers for different years", async function () {
      const years = [2024, 2025];
      const amounts = [BigInt(2), BigInt(3)];
      const decimalsFactor = BigInt(10);
      
      const mustaa2024Initial = await timeToken.yearlyBalances(years[0], mustaaAddress);
      const mustaa2025Initial = await timeToken.yearlyBalances(years[1], mustaaAddress);
      const owner12024Initial = await timeToken.yearlyBalances(years[0], owner1Address);
      const owner12025Initial = await timeToken.yearlyBalances(years[1], owner1Address);
      
      // Perform batch transfer
      await timeToken.connect(mustaa).transferBatchForYears(
        [mustaaAddress, mustaaAddress],
        [owner1Address, owner1Address],
        [amounts[0] * decimalsFactor, amounts[1] * decimalsFactor],
        years,
        [true, true],
        ["0x", "0x"]
      );
      
      // Verify balances for both years
      expect(await timeToken.yearlyBalances(years[0], mustaaAddress))
        .to.equal(mustaa2024Initial - (amounts[0] * decimalsFactor));
      expect(await timeToken.yearlyBalances(years[1], mustaaAddress))
        .to.equal(mustaa2025Initial - (amounts[1] * decimalsFactor));
      expect(await timeToken.yearlyBalances(years[0], owner1Address))
        .to.equal(owner12024Initial + (amounts[0] * decimalsFactor));
      expect(await timeToken.yearlyBalances(years[1], owner1Address))
        .to.equal(owner12025Initial + (amounts[1] * decimalsFactor));
    });
    
    it("Should maintain year-specific balances separately", async function () {
      // Transfer tokens for different years
      const years = [2024, 2025];
      const amounts = [BigInt(5), BigInt(7)];
      const decimalsFactor = BigInt(10);
      
      // Initial balances
      const mustaaInitial2024 = await timeToken.yearlyBalances(years[0], mustaaAddress);
      const mustaaInitial2025 = await timeToken.yearlyBalances(years[1], mustaaAddress);
      
      // Transfer for year 2024
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        owner1Address,
        amounts[0] * decimalsFactor,
        years[0],
        true,
        "0x"
      );
      
      // Verify only 2024 balance changed, 2025 unchanged
      expect(await timeToken.yearlyBalances(years[0], mustaaAddress))
        .to.equal(mustaaInitial2024 - (amounts[0] * decimalsFactor));
      expect(await timeToken.yearlyBalances(years[1], mustaaAddress))
        .to.equal(mustaaInitial2025);
      
      // Transfer for year 2025
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        owner1Address,
        amounts[1] * decimalsFactor,
        years[1],
        true,
        "0x"
      );
      
      // Verify both balances are now updated correctly
      expect(await timeToken.yearlyBalances(years[0], mustaaAddress))
        .to.equal(mustaaInitial2024 - (amounts[0] * decimalsFactor));
      expect(await timeToken.yearlyBalances(years[1], mustaaAddress))
        .to.equal(mustaaInitial2025 - (amounts[1] * decimalsFactor));
    });
    
    it("Should revert when cancelling a booking to a non-allowed recipient", async function () {
      const daysToBook = 3;
      const year = 2024;
      
      // Book days
      await timeToken.connect(mustaa).book(daysToBook, year);
      
      // Try to cancel and send to non-allowed user
      await expect(
        timeToken.connect(mustaa).cancelBooking(daysToBook, year, nonAllowedUser.address)
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership")
        .withArgs(nonAllowedUser.address);
    });
  });

  describe("YachtOwnership Integration", function () {
    let nonAllowedUser;
    
    beforeEach(async function () {
      nonAllowedUser = (await ethers.getSigners())[5];
    });
    
    it("Should prevent transferring to addresses not allowed in YachtOwnership", async function () {
      // Try to transfer to a non-allowed address
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          nonAllowedUser.address,
          100,
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
    });
    
    it("Should allow transfers after recipient is allowed in YachtOwnership", async function () {
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Initially expect transfer to fail
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          nonAllowedUser.address,
          transferAmount,
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
      
      // Now allow the user in YachtOwnership
      await yachtToken.allowUser(nonAllowedUser.address);
      
      // Transfer should now succeed
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        nonAllowedUser.address,
        transferAmount,
        2024,
        true,
        "0x"
      );
      
      expect(await timeToken.yearlyBalances(2024, nonAllowedUser.address)).to.equal(transferAmount);
    });
    
    it("Should prevent transfers if user is disallowed in YachtOwnership", async function () {
      // First allow the user
      await yachtToken.allowUser(nonAllowedUser.address);
      
      // Transfer some tokens
      const transferAmount = BigInt(5) * BigInt(10);
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        nonAllowedUser.address,
        transferAmount,
        2024,
        true,
        "0x"
      );
      
      // Now disallow the user
      await yachtToken.disallowUser(nonAllowedUser.address);
      
      // User should have tokens but not be able to transfer them
      expect(await timeToken.yearlyBalances(2024, nonAllowedUser.address)).to.equal(transferAmount);
      
      // Try to transfer to an allowed address - should fail
      await expect(
        timeToken.connect(nonAllowedUser).transferForYear(
          nonAllowedUser.address,
          owner1Address,
          transferAmount,
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
    });
  });

  describe("Dynamic Allowlist Behavior", function () {
    it("Should reflect allowlist changes from YachtOwnership in real-time", async function () {
      const newUser = (await ethers.getSigners())[6];
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Initially user is not allowed
      expect(await yachtToken.allowed(newUser.address)).to.equal(false);
      
      // Allow the user
      await yachtToken.allowUser(newUser.address);
      
      // User should now be able to receive tokens
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        newUser.address,
        transferAmount,
        2024,
        true,
        "0x"
      );
      
      // Disallow the user
      await yachtToken.disallowUser(newUser.address);
      
      // User should no longer be able to transfer tokens
      await expect(
        timeToken.connect(newUser).transferForYear(
          newUser.address,
          owner1Address,
          transferAmount,
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
    });
  });

  describe("Booking Permissions", function () {
    it("Should allow only allowed users to book days", async function () {
      const nonAllowedUser = (await ethers.getSigners())[5];
      const allowedUser = owner1;
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Allow user and transfer tokens
      await yachtToken.allowUser(nonAllowedUser.address);
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        nonAllowedUser.address,
        transferAmount,
        2024,
        true,
        "0x"
      );
      
      // Disallow the user
      await yachtToken.disallowUser(nonAllowedUser.address);
      
      // User should have tokens but not be allowed to book
      expect(await timeToken.yearlyBalances(2024, nonAllowedUser.address)).to.equal(transferAmount);
      
      // Try to book - should fail due to allowed check in _update
      await expect(
        timeToken.connect(nonAllowedUser).book(1, 2024)
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
    });
    
    it("Should prevent canceling bookings to non-allowed recipients", async function () {
      // Book as allowed user
      await timeToken.connect(mustaa).book(2, 2024);
      
      // Try to cancel and redirect to non-allowed user
      const nonAllowedUser = (await ethers.getSigners())[5];
      await expect(
        timeToken.connect(mustaa).cancelBooking(2, 2024, nonAllowedUser.address)
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
      
      // Now allow the user
      await yachtToken.allowUser(nonAllowedUser.address);
      
      // Should now succeed
      await timeToken.connect(mustaa).cancelBooking(2, 2024, nonAllowedUser.address);
      
      // Check balance
      expect(await timeToken.yearlyBalances(2024, nonAllowedUser.address)).to.equal(BigInt(2) * BigInt(10));
    });
  });

  describe("YachtOwnership Upgrades", function () {
    it("Should respect new allowlist rules after YachtOwnership is upgraded", async function () {
      // Upgrade YachtOwnership
      const YachtOwnershipV2 = await ethers.getContractFactory("YachtOwnershipV2");
      const upgradedYachtToken = await upgrades.upgradeProxy(
        await yachtToken.getAddress(),
        YachtOwnershipV2
      );
      
      // Set a random user as VIP
      const newUser = (await ethers.getSigners())[7];
      await upgradedYachtToken.setVIPStatus(newUser.address, true);
      
      // But they're not allowed yet, so transfers should fail
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          newUser.address,
          BigInt(10),
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
      
      // Now allow them
      await upgradedYachtToken.allowUser(newUser.address);
      
      // Transfer should now work
      await timeToken.connect(mustaa).transferForYear(
        mustaaAddress,
        newUser.address,
        BigInt(10),
        2024,
        true,
        "0x"
      );
      
      expect(await timeToken.yearlyBalances(2024, newUser.address)).to.equal(BigInt(10));
    });
  });

  describe("Security Edge Cases", function () {
    it("Should not allow transfer to address(0)", async function () {
      await expect(
        timeToken.connect(mustaa).transferForYear(
          mustaaAddress,
          ethers.ZeroAddress,
          BigInt(10),
          2024,
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "RecipientNotAllowedInYachtOwnership");
    });
    
    it("Should not allow booking with zero days", async function () {
      await expect(
        timeToken.connect(mustaa).book(0, 2024)
      ).to.be.reverted; // Specific error depends on implementation
    });
    
    it("Should verify YachtOwnership contract at initialization", async function () {
      const TimeToken = await ethers.getContractFactory("TimeToken");
      
      await expect(
        upgrades.deployProxy(
          TimeToken,
          [
            TOKEN_NAME,
            TOKEN_SYMBOL,
            ownerAddress,
            mustaaAddress,
            [owner1Address, owner2Address],
            ethers.ZeroAddress, // Invalid yacht ownership address
            STARTING_YEAR,
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "OwnershipContractNotSet");
    });
  });

  describe("Token expiry and burning", function () {
    it("Should allow owner to burn expired tokens from any past year", async function () {
        const currentYear = Math.floor(Date.now() / (365 * 24 * 60 * 60 * 1000)) + 1970;
        const pastYear = 2024; // Using 2024 since we know tokens were minted for this year
        
        // Get initial balance for past year
        const initialBalance = await timeToken.yearlyBalances(pastYear, mustaaAddress);
        expect(initialBalance).to.be.gt(0); // Verify we have tokens to burn
        
        // Get initial supply
        const initialSupply = await timeToken.yearlySupply(pastYear);
        
        // Should be able to burn past year's tokens
        await timeToken.burnExpiredTokens(mustaaAddress, pastYear);
        
        // Check balances are updated
        expect(await timeToken.yearlyBalances(pastYear, mustaaAddress)).to.equal(0);
        expect(await timeToken.yearlySupply(pastYear)).to.equal(
            initialSupply - initialBalance // Using BigInt subtraction
        );
    });

    it("Should not allow burning current year tokens", async function () {
        const currentYear = Math.floor(Date.now() / (365 * 24 * 60 * 60 * 1000)) + 1970;
        
        await expect(
            timeToken.burnExpiredTokens(mustaaAddress, currentYear)
        ).to.be.revertedWithCustomError(timeToken, "TokensNotExpired")
          .withArgs(currentYear, currentYear);
    });

    it("Should allow batch burning of expired tokens", async function () {
        const pastYear = 2024; // Using 2024 since we know tokens were minted for this year
        
        // Get initial balances
        const initialBalanceMustaa = await timeToken.yearlyBalances(pastYear, mustaaAddress);
        const initialBalanceOwner1 = await timeToken.yearlyBalances(pastYear, owner1Address);
        
        expect(initialBalanceMustaa).to.be.gt(0); // Verify we have tokens to burn
        expect(initialBalanceOwner1).to.be.gt(0); // Verify we have tokens to burn
        
        // Get initial supply
        const initialSupply = await timeToken.yearlySupply(pastYear);
        
        // Batch burn
        await timeToken.batchBurnExpiredTokens(
            [mustaaAddress, owner1Address],
            pastYear
        );
        
        // Check all balances are updated
        expect(await timeToken.yearlyBalances(pastYear, mustaaAddress)).to.equal(0);
        expect(await timeToken.yearlyBalances(pastYear, owner1Address)).to.equal(0);
        
        // Check yearly supply is updated
        expect(await timeToken.yearlySupply(pastYear)).to.equal(
            initialSupply - initialBalanceMustaa - initialBalanceOwner1 // Using BigInt subtraction
        );
    });

    it("Should only allow owner to burn expired tokens", async function () {
        const pastYear = 2024;
        
        await expect(
            timeToken.connect(mustaa).burnExpiredTokens(mustaaAddress, pastYear)
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
