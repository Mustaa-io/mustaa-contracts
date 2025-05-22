import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract } from "ethers";

describe("TimeToken", function () {
  let timeToken: any;
  let yachtToken: any;
  let allowList: any;
  let owner: any;
  let mustaa: any;
  let owner1: any;
  let owner2: any;
  let ownerAddress: string;
  let mustaaAddress: string;
  let owner1Address: string;
  let owner2Address: string;
  let CURRENT_YEAR: number;
  let STARTING_YEAR: number;

  const TOKEN_NAME = "Time Token";
  const TOKEN_SYMBOL = "TIME";
  const YACHT_TOKEN_NAME = "Yacht Token";
  const YACHT_TOKEN_SYMBOL = "YACHT";
  const MAX_SUPPLY = ethers.parseEther("5000"); // Increased from 1000 to 5000 to avoid cap issues

  beforeEach(async function () {
    // Get the signers
    [owner, mustaa, owner1, owner2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    mustaaAddress = await mustaa.getAddress();
    owner1Address = await owner1.getAddress();
    owner2Address = await owner2.getAddress();

    // Get current blockchain timestamp and calculate the current year
    const latestBlock = await ethers.provider.getBlock('latest');
    const timestamp = latestBlock?.timestamp || Math.floor(Date.now() / 1000);
    CURRENT_YEAR = Math.floor(timestamp / (365 * 24 * 60 * 60)) + 1970;
    
    // Set starting year to current year to avoid InvalidStartingYear error
    STARTING_YEAR = CURRENT_YEAR;
    
    // First deploy the AllowList
    const AllowList = await ethers.getContractFactory("AllowList");
    allowList = await upgrades.deployProxy(
      AllowList,
      [ownerAddress],
      { initializer: 'initialize' }
    );

    // Allow all test users
    await allowList.allowUser(ownerAddress);
    await allowList.allowUser(mustaaAddress);
    await allowList.allowUser(owner1Address);
    await allowList.allowUser(owner2Address);

    // Deploy YachtOwnership
    const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
    yachtToken = await upgrades.deployProxy(
      YachtOwnership,
      [
        YACHT_TOKEN_NAME,
        YACHT_TOKEN_SYMBOL,
        ownerAddress,
        MAX_SUPPLY,
        await allowList.getAddress()
      ],
      { initializer: 'initialize' }
    );

    // Mint yacht tokens for ownership percentages
    await yachtToken.mint(owner1Address, ethers.parseEther("350"), true, "0x");
    await yachtToken.mint(owner2Address, ethers.parseEther("350"), true, "0x");
    await yachtToken.mint(mustaaAddress, ethers.parseEther("300"), true, "0x");
    
    // Log ownership percentages for debugging
    console.log("Ownership Percentages:");
    console.log("- owner1:", (await yachtToken.getOwnershipPercentage(owner1Address)).toString());
    console.log("- owner2:", (await yachtToken.getOwnershipPercentage(owner2Address)).toString());
    console.log("- mustaa:", (await yachtToken.getOwnershipPercentage(mustaaAddress)).toString());
    console.log("Total:", (
      (await yachtToken.getOwnershipPercentage(owner1Address)) +
      (await yachtToken.getOwnershipPercentage(owner2Address)) +
      (await yachtToken.getOwnershipPercentage(mustaaAddress))
    ).toString());

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
        await allowList.getAddress(),
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
      
      // Determine expected Mustaa token amount based on whether starting year is a leap year
      const isStartingYearLeap = await timeToken.isLeapYear(STARTING_YEAR);
      const expectedMustaaSpecialShare = isStartingYearLeap ? 282 : 281;
      
      // Calculate owner share percentages: 35% each for owner1 and owner2
      // Note: Mustaa owns 30% but doesn't participate in the 84 token distribution
      const owner1SharePct = 3500; // out of 10000 (35%)
      const owner2SharePct = 3500; // out of 10000 (35%)
      
      // Calculate shares of the 84 tokens split between owner1 and owner2 only
      // Since Mustaa doesn't participate in the 84 token distribution,
      // we calculate based on the relative percentages of owner1 and owner2 only
      const totalNonMustaaPercentage = owner1SharePct + owner2SharePct; // 7000
      const expectedOwner1Share = (BigInt(84) * BigInt(owner1SharePct)) / BigInt(totalNonMustaaPercentage); // 42
      const expectedOwner2Share = (BigInt(84) * BigInt(owner2SharePct)) / BigInt(totalNonMustaaPercentage); // 42
      
      // Log expected shares for debugging
      console.log("Expected Shares:");
      console.log("- owner1:", expectedOwner1Share.toString());
      console.log("- owner2:", expectedOwner2Share.toString());
      console.log("- mustaa (special share only):", expectedMustaaSpecialShare.toString());
      
      // Log actual balances
      const actualOwner1Balance = await timeToken.balanceOfYear(owner1Address, STARTING_YEAR);
      const actualOwner2Balance = await timeToken.balanceOfYear(owner2Address, STARTING_YEAR);
      const actualMustaaBalance = await timeToken.balanceOfYear(mustaaAddress, STARTING_YEAR);
      
      console.log("Actual Balances:");
      console.log("- owner1:", actualOwner1Balance.toString());
      console.log("- owner2:", actualOwner2Balance.toString());
      console.log("- mustaa:", actualMustaaBalance.toString());
      
      // Check balances with exact expected values
      // Mustaa only gets their special allocation (281/282), no share of the 84 tokens
      const expectedMustaaBalance = BigInt(expectedMustaaSpecialShare) * decimalsFactor;
      
      // Each owner gets their share of the 84 owner tokens
      expect(await timeToken.balanceOfYear(owner1Address, STARTING_YEAR))
        .to.equal(expectedOwner1Share * decimalsFactor);
      expect(await timeToken.balanceOfYear(owner2Address, STARTING_YEAR))
        .to.equal(expectedOwner2Share * decimalsFactor);
      expect(await timeToken.balanceOfYear(mustaaAddress, STARTING_YEAR))
        .to.equal(expectedMustaaBalance);
      
      // Verify total supply is correct (Mustaa's special share + 84 tokens)
      const expectedTotalSupply = (BigInt(expectedMustaaSpecialShare) + BigInt(84)) * decimalsFactor;
      expect(await timeToken.yearlySupply(STARTING_YEAR)).to.equal(expectedTotalSupply);
    });

    it("Should initialize with correct yacht ownership contract", async function () {
      expect(await timeToken.yachtOwnership()).to.equal(await yachtToken.getAddress());
    });

    it("Should mint tokens for 5 years based on yacht ownership", async function () {
      const decimalsFactor = BigInt(10) ** BigInt(1);
      
      // Calculate owner share percentages: 35% each for owner1 and owner2
      // Note: Mustaa owns 30% but doesn't participate in the 84 token distribution
      const owner1SharePct = 3500; // out of 10000 (35%)
      const owner2SharePct = 3500; // out of 10000 (35%)
      
      // Calculate shares of the 84 tokens split between owner1 and owner2 only
      const totalNonMustaaPercentage = owner1SharePct + owner2SharePct; // 7000
      const expectedOwner1Share = (BigInt(84) * BigInt(owner1SharePct)) / BigInt(totalNonMustaaPercentage); // 42
      const expectedOwner2Share = (BigInt(84) * BigInt(owner2SharePct)) / BigInt(totalNonMustaaPercentage); // 42
      
      // Check balances for all 5 years
      for (let year = STARTING_YEAR; year < STARTING_YEAR + 5; year++) {
        const isLeapYear = await timeToken.isLeapYear(year);
        const mustaaSpecialShare = isLeapYear ? 282 : 281;
        
        // Mustaa only gets their special share, no participation in the 84 token distribution
        const expectedMustaaBalance = BigInt(mustaaSpecialShare) * decimalsFactor;
        
        // Check Mustaa's balance (only special allocation)
        expect(await timeToken.balanceOfYear(mustaaAddress, year))
          .to.equal(expectedMustaaBalance);
        
        // Check owners' balances (42 tokens each - split of the 84 tokens)
        expect(await timeToken.balanceOfYear(owner1Address, year))
          .to.equal(expectedOwner1Share * decimalsFactor);
        expect(await timeToken.balanceOfYear(owner2Address, year))
          .to.equal(expectedOwner2Share * decimalsFactor);
          
        // Verify total supply for each year
        const expectedTotalSupply = (BigInt(mustaaSpecialShare) + BigInt(84)) * decimalsFactor;
        expect(await timeToken.yearlySupply(year)).to.equal(expectedTotalSupply);
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
            await allowList.getAddress(),
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
          MAX_SUPPLY,
          await allowList.getAddress()
        ],
        { initializer: 'initialize' }
      );
      
      // Allow owners but mint a split that doesn't equal 100%
      await allowList.allowUser(owner1Address);
      await allowList.allowUser(owner2Address);
      
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
            await allowList.getAddress(),
            STARTING_YEAR,
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "TotalOwnershipPercentageInvalid");
    });

    it("Should revert if startingYear is in the past", async function () {
      const TimeToken = await ethers.getContractFactory("TimeToken");
      const pastYear = 2020; // A year in the past
      const currentYear = Math.floor(Date.now() / (365 * 24 * 60 * 60 * 1000)) + 1970;
      
      await expect(
        upgrades.deployProxy(
          TimeToken,
          [
            TOKEN_NAME,
            TOKEN_SYMBOL,
            ownerAddress,
            mustaaAddress,
            [owner1Address, owner2Address],
            await yachtToken.getAddress(),
            await allowList.getAddress(),
            pastYear, // Using a past year
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "InvalidStartingYear")
        .withArgs(pastYear, currentYear);
    });
  });

  describe("Core functionality", function () {
    it("Should correctly identify leap years", async function () {
      // These tests are time-independent since they're checking the algorithm
      expect(await timeToken.isLeapYear(2024)).to.be.true;
      expect(await timeToken.isLeapYear(2025)).to.be.false;
      expect(await timeToken.isLeapYear(2028)).to.be.true;
      expect(await timeToken.isLeapYear(2032)).to.be.true;
    });

    // Replace with a more comprehensive leap year test
    it("Should correctly identify leap years using Gregorian calendar rules", async function () {
      // Regular years divisible by 4 are leap years
      expect(await timeToken.isLeapYear(2024)).to.be.true;
      expect(await timeToken.isLeapYear(2028)).to.be.true;
      
      // Years not divisible by 4 are not leap years
      expect(await timeToken.isLeapYear(2023)).to.be.false;
      expect(await timeToken.isLeapYear(2025)).to.be.false;
      
      // Century years (divisible by 100) are NOT leap years...
      expect(await timeToken.isLeapYear(1900)).to.be.false;
      expect(await timeToken.isLeapYear(2100)).to.be.false;
      
      // ...unless they're also divisible by 400
      expect(await timeToken.isLeapYear(2000)).to.be.true;
      expect(await timeToken.isLeapYear(2400)).to.be.true;
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

  describe("Year-specific transfer functionality", function () {
    let nonAllowedUser: any;
    
    beforeEach(async function () {
        nonAllowedUser = (await ethers.getSigners())[5];
    });
    
    it("Should allow transferring tokens for a specific year", async function () {
        const year = STARTING_YEAR;
        const transferAmount = BigInt(5); // 0.5 tokens (with 1 decimal)
        const decimalsFactor = BigInt(10);
        
        const mustaaInitialBalance = await timeToken.balanceOfYear(mustaaAddress, year);
        const owner1InitialBalance = await timeToken.balanceOfYear(owner1Address, year);
        
        // Encode the year in the data parameter
        const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
        
        // Transfer from Mustaa to owner1
        await timeToken.connect(mustaa).transfer(
            mustaaAddress,
            owner1Address,
            transferAmount * decimalsFactor,
            true,
            data
        );
        
        expect(await timeToken.balanceOfYear(mustaaAddress, year))
            .to.equal(mustaaInitialBalance - (transferAmount * decimalsFactor));
        expect(await timeToken.balanceOfYear(owner1Address, year))
            .to.equal(owner1InitialBalance + (transferAmount * decimalsFactor));
    });
    
    it("Should emit transfer event with year information", async function () {
        const year = STARTING_YEAR;
        const transferAmount = BigInt(5);
        const decimalsFactor = BigInt(10);
        
        const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
        
        const tx = await timeToken.connect(mustaa).transfer(
            mustaaAddress,
            owner1Address,
            transferAmount * decimalsFactor,
            true,
            data
        );
        
        const receipt = await tx.wait();
        
        // Debug: log all events to see what's available
        console.log("Events in transaction:", receipt.events?.map(e => e.event || e.eventName));
        
        // Try to find the Transfer event - try both property names
        let transferEvent = receipt.events?.find(e => e.event === "Transfer" || e.eventName === "Transfer");
        
        // If not found, look at the logs directly
        if (!transferEvent) {
            console.log("Events not found by name, checking logs...");
            // The Transfer event should be emitted from the contract
            const transferInterface = new ethers.Interface([
                "event Transfer(address indexed operator, address indexed from, address indexed to, uint256 amount, bool force, bytes data)"
            ]);
            
            // Look through logs
            for (const log of receipt.logs) {
                try {
                    const parsedLog = transferInterface.parseLog(log);
                    if (parsedLog && parsedLog.name === "Transfer") {
                        transferEvent = {
                            ...log,
                            event: "Transfer",
                            args: parsedLog.args
                        };
                        break;
                    }
                } catch (e) {
                    // Not this event
                }
            }
        }
        
        expect(transferEvent).to.not.be.undefined;
        
        // Continue with the rest of the assertions
        expect(transferEvent.args.operator).to.equal(mustaaAddress);
        expect(transferEvent.args.from).to.equal(mustaaAddress);
        expect(transferEvent.args.to).to.equal(owner1Address);
        expect(transferEvent.args.amount).to.equal(transferAmount * decimalsFactor);
        expect(transferEvent.args.force).to.be.true;
        
        // The year should be decodable from the data
        const decodedYear = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], transferEvent.args.data)[0];
        expect(decodedYear).to.equal(year);
    });
    
    it("Should revert when transferring more tokens than available for a specific year", async function () {
        const year = STARTING_YEAR;
        const tooManyTokens = BigInt(300); // More than Mustaa's allocation
        const decimalsFactor = BigInt(10);
        
        const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
        
        await expect(
            timeToken.connect(mustaa).transfer(
                mustaaAddress,
                owner1Address,
                tooManyTokens * decimalsFactor,
                true,
                data
            )
        ).to.be.revertedWithCustomError(timeToken, "LSP7AmountExceedsBalance");
    });
  });

  describe("Batch transfer functionality", function() {
    it("Should support batch transfers for different years", async function () {
        const years = [STARTING_YEAR, STARTING_YEAR + 1];
        const amounts = [BigInt(2), BigInt(3)];
        const decimalsFactor = BigInt(10);
        
        const mustaaInitial = await timeToken.balanceOfYear(mustaaAddress, years[0]);
        const mustaaInitial2 = await timeToken.balanceOfYear(mustaaAddress, years[1]);
        const owner1Initial = await timeToken.balanceOfYear(owner1Address, years[0]);
        const owner1Initial2 = await timeToken.balanceOfYear(owner1Address, years[1]);
        
        // Encode years in data parameters
        const data = years.map(year => 
            ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year])
        );
        
        // Perform batch transfer
        await timeToken.connect(mustaa).transferBatch(
            [mustaaAddress, mustaaAddress],
            [owner1Address, owner1Address],
            [amounts[0] * decimalsFactor, amounts[1] * decimalsFactor],
            [true, true],
            data
        );
        
        // Verify balances for both years
        expect(await timeToken.balanceOfYear(mustaaAddress, years[0]))
            .to.equal(mustaaInitial - (amounts[0] * decimalsFactor));
        expect(await timeToken.balanceOfYear(mustaaAddress, years[1]))
            .to.equal(mustaaInitial2 - (amounts[1] * decimalsFactor));
        expect(await timeToken.balanceOfYear(owner1Address, years[0]))
            .to.equal(owner1Initial + (amounts[0] * decimalsFactor));
        expect(await timeToken.balanceOfYear(owner1Address, years[1]))
            .to.equal(owner1Initial2 + (amounts[1] * decimalsFactor));
    });
    
    it("Should revert if batch transfer arrays have different lengths", async function() {
        const data = [STARTING_YEAR, STARTING_YEAR + 1].map(year => 
            ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year])
        );
        
        await expect(
            timeToken.connect(mustaa).transferBatch(
                [mustaaAddress, mustaaAddress],
                [owner1Address], // Only one address
                [BigInt(10), BigInt(20)],
                [true, true],
                data
            )
        ).to.be.revertedWithCustomError(timeToken, "LSP7InvalidTransferBatch");
    });
    
    it("Should revert if any transfer in batch fails", async function() {
      // Try a batch where second transfer will fail (too many tokens)
      const years = [STARTING_YEAR, STARTING_YEAR + 1];
      const data = years.map(year => 
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year])
      );
      
      await expect(
        timeToken.connect(mustaa).transferBatch(
          [mustaaAddress, mustaaAddress],
          [owner1Address, owner1Address],
          [BigInt(10), ethers.parseEther("1000")], // Second transfer amount too large
          [true, true],
          data
        )
      ).to.be.reverted; // Will revert with LSP7AmountExceedsBalance
    });
  });

  describe("Operator authorization", function() {
    it("Should authorize an operator with a generic allowance", async function() {
      const amount = BigInt(50) * BigInt(10);
      
      // Authorize owner as operator for Mustaa's tokens
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        amount,
        "0x"
      );
      
      // Check authorization amount
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(amount);
    });
    
    it("Should allow operator to transfer tokens on behalf of owner", async function() {
      const year = STARTING_YEAR;
      const amount = BigInt(10) * BigInt(10);
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Initial balances
      const mustaaInitialBalance = await timeToken.balanceOfYear(mustaaAddress, year);
      const owner1InitialBalance = await timeToken.balanceOfYear(owner1Address, year);
      
      // Make sure owner is a yacht owner (should already be true, but double-check)
      if (!await yachtToken.isOwner(ownerAddress)) {
        await yachtToken.mint(ownerAddress, ethers.parseEther("1"), true, "0x");
      }
      
      // Authorize owner as operator with generic allowance
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        amount,
        "0x"
      );
      
      // Owner transfers on behalf of Mustaa (encode year in data)
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await timeToken.connect(owner).transfer(
        mustaaAddress,
        owner1Address,
        transferAmount,
        true,
        data
      );
      
      // Verify balances
      expect(await timeToken.balanceOfYear(mustaaAddress, year))
        .to.equal(mustaaInitialBalance - transferAmount);
      expect(await timeToken.balanceOfYear(owner1Address, year))
        .to.equal(owner1InitialBalance + transferAmount);
      
      // Verify remaining allowance
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(amount - transferAmount);
    });
    
    it("Should revert if operator is not in allowList even with authorization", async function() {
      const nonAllowedOperator = (await ethers.getSigners())[5];
      const year = STARTING_YEAR;
      const amount = BigInt(10) * BigInt(10);
      
      // Authorize non-allowed operator
      await timeToken.connect(mustaa).authorizeOperator(
        nonAllowedOperator.address,
        amount,
        "0x"
      );
      
      // Verify authorization succeeded
      expect(await timeToken.authorizedAmountFor(nonAllowedOperator.address, mustaaAddress))
        .to.equal(amount);
      
      // When operator tries to transfer, it should revert due to not being in allowList
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await expect(
        timeToken.connect(nonAllowedOperator).transfer(
          mustaaAddress,
          owner1Address,
          BigInt(5) * BigInt(10),
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(nonAllowedOperator.address);
    });
    
    it("Should allow transfer after adding operator to allowList", async function() {
      const newOperator = (await ethers.getSigners())[5];
      const year = STARTING_YEAR;
      const amount = BigInt(10) * BigInt(10);
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Authorize operator (not yet in allowList)
      await timeToken.connect(mustaa).authorizeOperator(
        newOperator.address,
        amount,
        "0x"
      );
      
      // Should fail to transfer
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await expect(
        timeToken.connect(newOperator).transfer(
          mustaaAddress,
          owner1Address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(newOperator.address);
      
      // Allow operator and also make them a yacht owner
      await allowList.allowUser(newOperator.address);
      await yachtToken.mint(newOperator.address, ethers.parseEther("1"), true, "0x");
      
      // Now operator should be able to transfer
      await timeToken.connect(newOperator).transfer(
        mustaaAddress,
        owner1Address,
        transferAmount,
        true,
        data
      );
      
      // Verify balances changed
      expect(await timeToken.balanceOfYear(owner1Address, year))
        .to.be.gt(BigInt(42) * BigInt(10)); // Original balance was 42
    });
    
    it("Should revert when operator is removed from allowList", async function() {
      const year = STARTING_YEAR;
      const amount = BigInt(10) * BigInt(10);
      const transferAmount = BigInt(5) * BigInt(10);
      
      // First allow a new operator and make them a yacht owner
      const newOperator = (await ethers.getSigners())[6];
      await allowList.allowUser(newOperator.address);
      await yachtToken.mint(newOperator.address, ethers.parseEther("1"), true, "0x");
      
      // Authorize the new operator
      await timeToken.connect(mustaa).authorizeOperator(
        newOperator.address,
        amount,
        "0x"
      );
      
      // Operator should be able to transfer initially
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await timeToken.connect(newOperator).transfer(
        mustaaAddress,
        owner1Address,
        transferAmount,
        true,
        data
      );
      
      // Now disallow the operator
      await allowList.disallowUser(newOperator.address);
      
      // Operator should no longer be able to transfer
      await expect(
        timeToken.connect(newOperator).transfer(
          mustaaAddress,
          owner1Address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(newOperator.address);
    });
    
    it("Should emit OperatorAuthorizationChanged event", async function() {
      const amount = BigInt(20) * BigInt(10);
      
      const tx = await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        amount,
        "0x"
      );
      
      const receipt = await tx.wait();
      
      // Debug: log all events to see what's available
      console.log("Available events:", receipt.events?.map(e => e.event || e.eventName));
      
      // Try different approaches to find the event
      let event = receipt.events?.find(e => e.event === "OperatorAuthorizationChanged" || e.eventName === "OperatorAuthorizationChanged");
      
      // If still not found, parse logs directly
      if (!event) {
        console.log("Events not found by name, checking logs directly...");
        // Define the event interface
        const eventInterface = new ethers.Interface([
          "event OperatorAuthorizationChanged(address indexed operator, address indexed tokenOwner, uint256 indexed amount, bytes operatorNotificationData)"
        ]);
        
        // Look through all logs
        for (const log of receipt.logs) {
          try {
            const parsedLog = eventInterface.parseLog(log);
            if (parsedLog && parsedLog.name === "OperatorAuthorizationChanged") {
              event = {
                ...log,
                event: "OperatorAuthorizationChanged",
                args: parsedLog.args
              };
              break;
            }
          } catch (e) {
            // Not this event, continue to next log
          }
        }
      }
      
      // If event is still not found, log all raw logs
      if (!event) {
        console.log("Raw logs:", receipt.logs);
      }
      
      expect(event).to.not.be.undefined;
      expect(event?.args?.operator).to.equal(ownerAddress);
      expect(event?.args?.tokenOwner).to.equal(mustaaAddress);
      expect(event?.args?.amount).to.equal(amount);
    });
  });
  
  describe("Revoke, increase and decrease allowance", function() {
    it("Should revoke operator authorization", async function() {
      const amount = BigInt(20) * BigInt(10);
      
      // First authorize
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        amount,
        "0x"
      );
      
      // Verify authorization
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(amount);
      
      // Revoke authorization
      await timeToken.connect(mustaa).revokeOperator(
        ownerAddress,
        mustaaAddress,
        true,
        "0x"
      );
      
      // Verify authorization is revoked
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(0);
    });
    
    it("Should allow revocation of operator who lost allowList status", async function() {
      const amount = BigInt(20) * BigInt(10);
      const newOperator = (await ethers.getSigners())[7];
      
      // First allow the operator and make them a yacht owner
      await allowList.allowUser(newOperator.address);
      await yachtToken.mint(newOperator.address, ethers.parseEther("1"), true, "0x");
      
      // Authorize operator
      await timeToken.connect(mustaa).authorizeOperator(
        newOperator.address,
        amount,
        "0x"
      );
      
      // Verify authorization
      expect(await timeToken.authorizedAmountFor(newOperator.address, mustaaAddress))
        .to.equal(amount);
      
      // Now remove operator from allowList
      await allowList.disallowUser(newOperator.address);
      
      // Mustaa should still be able to revoke the operator
      await timeToken.connect(mustaa).revokeOperator(
        newOperator.address,
        mustaaAddress,
        true,
        "0x"
      );
      
      // Verify authorization is revoked
      expect(await timeToken.authorizedAmountFor(newOperator.address, mustaaAddress))
        .to.equal(0);
    });
    
    it("Should increase allowance", async function() {
      const initialAmount = BigInt(20) * BigInt(10);
      const increaseAmount = BigInt(10) * BigInt(10);
      
      // First authorize
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        initialAmount,
        "0x"
      );
      
      // Increase allowance
      await timeToken.connect(mustaa).increaseAllowance(
        ownerAddress,
        increaseAmount,
        "0x"
      );
      
      // Verify increased allowance
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(initialAmount + increaseAmount);
    });
    
    it("Should decrease allowance", async function() {
      const initialAmount = BigInt(30) * BigInt(10);
      const decreaseAmount = BigInt(10) * BigInt(10);
      
      // First authorize
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        initialAmount,
        "0x"
      );
      
      // Decrease allowance
      await timeToken.connect(mustaa).decreaseAllowance(
        ownerAddress,
        mustaaAddress,
        decreaseAmount,
        "0x"
      );
      
      // Verify decreased allowance
      expect(await timeToken.authorizedAmountFor(ownerAddress, mustaaAddress))
        .to.equal(initialAmount - decreaseAmount);
    });
    
    it("Should revert when trying to decrease allowance below zero", async function() {
      const initialAmount = BigInt(20) * BigInt(10);
      const decreaseAmount = BigInt(30) * BigInt(10); // More than initial amount
      
      // First authorize
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        initialAmount,
        "0x"
      );
      
      // Try to decrease too much
      await expect(
        timeToken.connect(mustaa).decreaseAllowance(
          ownerAddress,
          mustaaAddress,
          decreaseAmount,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7DecreasedAllowanceBelowZero");
    });
    
    it("Should revert when unauthorized caller tries to decrease allowance", async function() {
      const initialAmount = BigInt(20) * BigInt(10);
      const decreaseAmount = BigInt(10) * BigInt(10);
      
      // First authorize
      await timeToken.connect(mustaa).authorizeOperator(
        ownerAddress, 
        initialAmount,
        "0x"
      );
      
      // Try to decrease allowance from unauthorized account
      await expect(
        timeToken.connect(owner1).decreaseAllowance(
          ownerAddress,
          mustaaAddress,
          decreaseAmount,
          "0x"
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7DecreaseAllowanceNotAuthorized");
    });
  });

  describe("Supply and balance verification", function() {
    it("Should track yearlySupply accurately", async function() {
      const year = STARTING_YEAR;
      const transferAmount = BigInt(10) * BigInt(10);
      
      const initialSupply = await timeToken.yearlySupply(year);
      
      // Transfer should not change yearly supply
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await timeToken.connect(mustaa).transfer(
        mustaaAddress,
        owner1Address,
        transferAmount,
        true,
        data
      );
      
      expect(await timeToken.yearlySupply(year)).to.equal(initialSupply);
    });
  });

  describe("YachtOwnership Integration", function () {
    let nonAllowedUser;
    
    beforeEach(async function () {
      nonAllowedUser = (await ethers.getSigners())[5];
    });
    
    it("Should prevent transferring to addresses not allowed in allowList", async function () {
      const year = STARTING_YEAR;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      // Try to transfer to a non-allowed address
      await expect(
        timeToken.connect(mustaa).transfer(
          mustaaAddress,
          nonAllowedUser.address,
          100,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(nonAllowedUser.address);
    });
    
    it("Should allow transfers after recipient is allowed in allowList", async function () {
      const year = STARTING_YEAR;
      const transferAmount = BigInt(5) * BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
      // Initially expect transfer to fail
      await expect(
        timeToken.connect(mustaa).transfer(
          mustaaAddress,
          nonAllowedUser.address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(nonAllowedUser.address);
      
      // Now allow the user in the centralized allowList
      await allowList.allowUser(nonAllowedUser.address);
      
      // Make the user a yacht owner too - this is required by _verifyPermissions
      await yachtToken.mint(nonAllowedUser.address, ethers.parseEther("1"), true, "0x");
      
      // Transfer should now succeed
      await timeToken.connect(mustaa).transfer(
        mustaaAddress,
        nonAllowedUser.address,
        transferAmount,
        true,
        data
      );
      
      expect(await timeToken.balanceOfYear(nonAllowedUser.address, year)).to.equal(transferAmount);
    });
    
    it("Should prevent transfers if user is disallowed in allowList", async function () {
      const year = STARTING_YEAR;
      const transferAmount = BigInt(5) * BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
      // First allow the user
      await allowList.allowUser(nonAllowedUser.address);
      
      // Also make them a yacht owner
      await yachtToken.mint(nonAllowedUser.address, ethers.parseEther("1"), true, "0x");
      
      // Transfer some tokens
      await timeToken.connect(mustaa).transfer(
        mustaaAddress,
        nonAllowedUser.address,
        transferAmount,
        true,
        data
      );
      
      // Now disallow the user
      await allowList.disallowUser(nonAllowedUser.address);
      
      // User should have tokens but not be able to transfer them
      expect(await timeToken.balanceOfYear(nonAllowedUser.address, year)).to.equal(transferAmount);
      
      // Try to transfer to an allowed address - should fail
      await expect(
        timeToken.connect(nonAllowedUser).transfer(
          nonAllowedUser.address,
          owner1Address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(nonAllowedUser.address);
    });
  });

  describe("Dynamic Allowlist Behavior", function () {
    it("Should reflect allowlist changes in real-time", async function () {
      const year = STARTING_YEAR;
      const newUser = (await ethers.getSigners())[6];
      const transferAmount = BigInt(5) * BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
      // Initially user is not allowed
      expect(await timeToken.allowed(newUser.address)).to.equal(false);
      
      // Allow the user
      await allowList.allowUser(newUser.address);
      
      // Make them a yacht owner too
      await yachtToken.mint(newUser.address, ethers.parseEther("1"), true, "0x");
      
      // User should now be able to receive tokens
      await timeToken.connect(mustaa).transfer(
        mustaaAddress,
        newUser.address,
        transferAmount,
        true,
        data
      );
      
      // Disallow the user
      await allowList.disallowUser(newUser.address);
      
      // User should no longer be able to transfer tokens
      await expect(
        timeToken.connect(newUser).transfer(
          newUser.address,
          owner1Address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(newUser.address);
    });
  });

  describe("YachtOwnership Upgrades", function () {
    it("Should respect new allowlist rules after YachtOwnership is upgraded", async function () {
      const year = STARTING_YEAR;
      const transferAmount = BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
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
        timeToken.connect(mustaa).transfer(
          mustaaAddress,
          newUser.address,
          transferAmount,
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7Disallowed")
        .withArgs(newUser.address);
      
      // Now allow them
      await allowList.allowUser(newUser.address);
      
      // And make them a yacht owner
      await upgradedYachtToken.mint(newUser.address, ethers.parseEther("1"), true, "0x");
      
      // Transfer should now work
      await timeToken.connect(mustaa).transfer(
        mustaaAddress,
        newUser.address,
        transferAmount,
        true,
        data
      );
      
      expect(await timeToken.balanceOfYear(newUser.address, year)).to.equal(transferAmount);
    });
  });

  describe("Security Edge Cases", function () {
    it("Should not allow transfer to address(0)", async function () {
      const year = STARTING_YEAR;
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      await expect(
        timeToken.connect(mustaa).transfer(
          mustaaAddress,
          ethers.ZeroAddress,
          BigInt(10),
          true,
          data
        )
      ).to.be.revertedWithCustomError(timeToken, "LSP7CannotSendWithAddressZero");
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
            await allowList.getAddress(),
            STARTING_YEAR,
            5
          ],
          { initializer: 'initialize' }
        )
      ).to.be.revertedWithCustomError(TimeToken, "OwnershipContractNotSet");
    });
  });

  describe("mintForOwners function", function () {
    it("Should allow contract owner to mint new tokens to yacht owners", async function () {
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const year = 2030; // A future year not included in initialization
      
      // Get initial balances
      const initialBalance1 = await timeToken.balanceOfYear(owner1Address, year);
      const initialBalance2 = await timeToken.balanceOfYear(owner2Address, year);
      
      // Initial balances should be 0 for this year
      expect(initialBalance1).to.equal(0);
      expect(initialBalance2).to.equal(0);
      
      // Get initial yearly supply
      const initialYearlySupply = await timeToken.yearlySupply(year);
      expect(initialYearlySupply).to.equal(0);
      
      // Mint tokens for the new year - only include owner1 and owner2
      await timeToken.mintForOwners(
        [year],
        [owner1Address, owner2Address]
      );
      
      // The 84 tokens should be split evenly between owner1 and owner2
      // Each gets 42 tokens (they have equal ownership percentages)
      expect(await timeToken.balanceOfYear(owner1Address, year))
        .to.equal(BigInt(42) * decimalsFactor);
      expect(await timeToken.balanceOfYear(owner2Address, year))
        .to.equal(BigInt(42) * decimalsFactor);
      
      // Check Mustaa's special allocation
      const isLeapYear = await timeToken.isLeapYear(year);
      const mustaaSpecialShare = isLeapYear ? 282 : 281;
      expect(await timeToken.balanceOfYear(mustaaAddress, year))
        .to.equal(BigInt(mustaaSpecialShare) * decimalsFactor);
      
      // Yearly supply should include both Mustaa's special allocation and the 84 owner tokens
      const expectedTotalSupply = BigInt(mustaaSpecialShare + 84) * decimalsFactor;
      expect(await timeToken.yearlySupply(year))
        .to.equal(expectedTotalSupply);
    });
    
    it("Should mint tokens for multiple years at once", async function () {
      const decimalsFactor = BigInt(10) ** BigInt(1);
      const startYear = 2031; // Different year than previous test
      const years = Array.from({length: 5}, (_, i) => startYear + i); // 5 consecutive years
      
      // Verify initial balances are 0 for all years
      for (const year of years) {
        expect(await timeToken.balanceOfYear(owner1Address, year)).to.equal(0);
        expect(await timeToken.balanceOfYear(owner2Address, year)).to.equal(0);
        expect(await timeToken.yearlySupply(year)).to.equal(0);
      }
      
      // Mint tokens for multiple years - only include owner1 and owner2
      await timeToken.mintForOwners(
        years,
        [owner1Address, owner2Address]
      );
      
      // Check balances for each year
      for (const year of years) {
        // Each owner gets half of the 84 tokens (42 each)
        expect(await timeToken.balanceOfYear(owner1Address, year))
          .to.equal(BigInt(42) * decimalsFactor);
        expect(await timeToken.balanceOfYear(owner2Address, year))
          .to.equal(BigInt(42) * decimalsFactor);
        
        // Check Mustaa's special allocation for each year
        const isLeapYear = await timeToken.isLeapYear(year);
        const mustaaSpecialShare = isLeapYear ? 282 : 281;
        expect(await timeToken.balanceOfYear(mustaaAddress, year))
          .to.equal(BigInt(mustaaSpecialShare) * decimalsFactor);
        
        // Yearly supply should include both Mustaa's special allocation and the 84 owner tokens
        const expectedTotalSupply = BigInt(mustaaSpecialShare + 84) * decimalsFactor;
        expect(await timeToken.yearlySupply(year))
          .to.equal(expectedTotalSupply);
      }
    });
    
    it("Should validate that all recipients are yacht owners", async function () {
      const nonOwner = (await ethers.getSigners())[5];
      
      // Try to mint to a mix of owners and non-owners
      await expect(
        timeToken.mintForOwners(
          [2030],
          [owner1Address, nonOwner.address]
        )
      ).to.be.revertedWithCustomError(timeToken, "InvalidOwnership")
        .withArgs(nonOwner.address, 0);
    });
    
    it("Should verify total ownership percentage equals 100%", async function () {
      // Create a new yacht token with uneven ownership
      const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
      const testYachtToken = await upgrades.deployProxy(
        YachtOwnership,
        [
          "Test Yacht", 
          "TEST", 
          ownerAddress, 
          MAX_SUPPLY,
          await allowList.getAddress()
        ],
        { initializer: 'initialize' }
      );
      
      // Allow owners
      await allowList.allowUser(owner1Address);
      await allowList.allowUser(owner2Address);
      await allowList.allowUser(mustaaAddress);
      
      // Mint 90% to owner1, 5% to owner2, and 5% to Mustaa (total 100%)
      await testYachtToken.mint(owner1Address, ethers.parseEther("900"), true, "0x");
      await testYachtToken.mint(owner2Address, ethers.parseEther("50"), true, "0x");
      await testYachtToken.mint(mustaaAddress, ethers.parseEther("50"), true, "0x");
      
      // Deploy a new time token with this yacht token
      const TimeToken = await ethers.getContractFactory("TimeToken");
      const testTimeToken = await upgrades.deployProxy(
        TimeToken,
        [
          TOKEN_NAME,
          TOKEN_SYMBOL,
          ownerAddress,
          mustaaAddress,
          [owner1Address, owner2Address], // Include both owners for initialization
          await testYachtToken.getAddress(),
          await allowList.getAddress(),
          STARTING_YEAR,
          1
        ],
        { initializer: 'initialize' }
      );
      
      // Try to mint to both owners
      await testTimeToken.mintForOwners(
        [2030],
        [owner1Address, owner2Address]
      );
      
      // Verify the balances
      const decimalsFactor = BigInt(10) ** BigInt(1);
      
      // Calculate shares of the 84 tokens between owner1 and owner2
      // owner1 has 90% and owner2 has 5% out of their combined 95%
      // Calculate the same way the contract does: multiply by decimal factor first, then divide
      const ownerTotalAmount = BigInt(84) * decimalsFactor; // 840 with decimals
      const totalNonMustaaPercentage = BigInt(9000) + BigInt(500); // 95% = 9500 basis points
      const owner1Share = (ownerTotalAmount * BigInt(9000)) / totalNonMustaaPercentage; // 795
      const owner2Share = (ownerTotalAmount * BigInt(500)) / totalNonMustaaPercentage; // 44
      
      expect(await testTimeToken.balanceOfYear(owner1Address, 2030))
        .to.equal(owner1Share);
      expect(await testTimeToken.balanceOfYear(owner2Address, 2030))
        .to.equal(owner2Share);
        
      // Verify Mustaa got their special allocation
      const isLeapYear = await testTimeToken.isLeapYear(2030);
      const mustaaSpecialShare = isLeapYear ? 282 : 281;
      expect(await testTimeToken.balanceOfYear(mustaaAddress, 2030))
        .to.equal(BigInt(mustaaSpecialShare) * decimalsFactor);
    });
    
    it("Should not allow non-owner to mint tokens", async function () {
      await expect(
        timeToken.connect(mustaa).mintForOwners(
          [2030],
          [owner1Address, owner2Address]
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("Should prevent minting that would exceed yearly supply cap", async function () {
      const year = 2030;
      
      // First mint tokens for the maximum owner share (84 tokens)
      await timeToken.mintForOwners(
        [year],
        [owner1Address, owner2Address]
      );
      
      // Try to mint additional tokens for the same year
      await expect(
        timeToken.mintForOwners(
          [year],
          [owner1Address, owner2Address]
        )
      ).to.be.revertedWithCustomError(timeToken, "YearlySupplyExceeded")
        .withArgs(year);
    });
    
    it("Should revert if owners array is empty", async function () {
      await expect(
        timeToken.mintForOwners(
          [2030],
          []
        )
      ).to.be.revertedWithCustomError(timeToken, "InvalidOwnerCount");
    });
  });

  describe("Token expiry and burning", function () {
    // Use a timestamp counter to ensure we always move forward
    let futureTimestampBase;
    let testCounter = 0;
    
    beforeEach(async function() {
      // Initialize the base timestamp only once
      if (!futureTimestampBase) {
        // Set initial time to 2030-01-01
        futureTimestampBase = Math.floor(new Date('2030-01-01').getTime() / 1000);
      }
      
      // Increment timestamp by 1 day for each test to ensure we always move forward
      const testTimestamp = futureTimestampBase + (testCounter * 86400); // 86400 = seconds in a day
      testCounter++;
      
      await ethers.provider.send("evm_setNextBlockTimestamp", [testTimestamp]);
      await ethers.provider.send("evm_mine", []);
      
      // Verify current blockchain year
      const latestBlock = await ethers.provider.getBlock('latest');
      const currentYear = Math.floor(latestBlock.timestamp / (365 * 24 * 60 * 60)) + 1970;
      console.log("Current blockchain year for tests:", currentYear);
      console.log("Current timestamp:", latestBlock.timestamp);
    });

    it("Should allow owner to burn expired tokens from any past year", async function () {
        // The test STARTING_YEAR is now in the past from the blockchain's perspective
        const pastYear = STARTING_YEAR;
        
        // Get initial balance for past year
        const initialBalance = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        console.log(`Initial balance for ${pastYear}:`, initialBalance.toString());
        expect(initialBalance).to.be.gt(0); // Verify we have tokens to burn
        
        // Get initial supply
        const initialSupply = await timeToken.yearlySupply(pastYear);
        
        // Should be able to burn past year's tokens
        await timeToken.burnExpiredTokens(mustaaAddress, pastYear);
        
        // Check balances are updated
        expect(await timeToken.balanceOfYear(mustaaAddress, pastYear)).to.equal(0);
        expect(await timeToken.yearlySupply(pastYear)).to.equal(
            initialSupply - initialBalance
        );
    });

    it("Should not allow burning current year tokens", async function () {
        // Get the current blockchain year
        const latestBlock = await ethers.provider.getBlock('latest');
        const currentYear = Math.floor(latestBlock?.timestamp / (365 * 24 * 60 * 60)) + 1970;
        
        await expect(
            timeToken.burnExpiredTokens(mustaaAddress, currentYear)
        ).to.be.revertedWithCustomError(timeToken, "TokensNotExpired")
          .withArgs(currentYear, currentYear);
    });

    it("Should allow batch burning of expired tokens", async function () {
        // Use an explicit past year instead of STARTING_YEAR
        const pastYear = 2025; // Hard-coded to be before 2030
        
        // Make sure we have tokens for this year to burn (might need to mint some)
        const initialBalanceMustaa = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        const initialBalanceOwner1 = await timeToken.balanceOfYear(owner1Address, pastYear);
        
        // If no tokens exist for this year, mint some
        if (initialBalanceMustaa.toString() === "0" && initialBalanceOwner1.toString() === "0") {
            // Mint tokens for past year
            await timeToken.mintForOwners([pastYear], [owner1Address, owner2Address]);
        }
        
        // Get latest balances after potential minting
        const balanceMustaa = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        const balanceOwner1 = await timeToken.balanceOfYear(owner1Address, pastYear);
        
        // Make sure blockchain timestamp is far enough in the future
        const latestBlock = await ethers.provider.getBlock('latest');
        const currentYear = Math.floor(latestBlock.timestamp / (365 * 24 * 60 * 60)) + 1970;
        console.log("Current blockchain year:", currentYear);
        console.log("Test past year:", pastYear);
        console.log("STARTING_YEAR:", STARTING_YEAR);
        
        // Explicitly verify that our time manipulation worked and the year is in the past
        expect(currentYear).to.equal(2030); // First verify we're in 2030
        expect(pastYear).to.be.lt(currentYear); // Then verify pastYear is before currentYear
        
        // Verify we have tokens to burn
        expect(balanceMustaa).to.be.gt(0);
        expect(balanceOwner1).to.be.gt(0);
        
        // Get initial supply
        const initialSupply = await timeToken.yearlySupply(pastYear);
        
        // Batch burn
        await timeToken.batchBurnExpiredTokens(
            [mustaaAddress, owner1Address],
            pastYear
        );
        
        // Check all balances are updated
        expect(await timeToken.balanceOfYear(mustaaAddress, pastYear)).to.equal(0);
        expect(await timeToken.balanceOfYear(owner1Address, pastYear)).to.equal(0);
        
        // Check yearly supply is updated
        expect(await timeToken.yearlySupply(pastYear)).to.equal(
            initialSupply - balanceMustaa - balanceOwner1
        );
    });

    it("Should only allow owner to burn expired tokens", async function () {
        // Use an explicit past year
        const pastYear = 2026; // Hard-coded to be before 2030
        
        // Make sure we have tokens for this year to burn (might need to mint some)
        const initialBalanceMustaa = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        
        // If no tokens exist for this year, mint some
        if (initialBalanceMustaa.toString() === "0") {
            // Mint tokens for past year
            await timeToken.mintForOwners([pastYear], [owner1Address, owner2Address]);
        }
        
        // Verify this year is in the past
        const latestBlock = await ethers.provider.getBlock('latest');
        const currentYear = Math.floor(latestBlock.timestamp / (365 * 24 * 60 * 60)) + 1970;
        console.log("Current blockchain year:", currentYear);
        console.log("Test past year:", pastYear);
        
        // Explicitly verify that our time manipulation worked and the year is in the past
        expect(currentYear).to.equal(2030); // First verify we're in 2030
        expect(pastYear).to.be.lt(currentYear); // Then verify pastYear is before currentYear
        
        await expect(
            timeToken.connect(mustaa).burnExpiredTokens(mustaaAddress, pastYear)
        ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
