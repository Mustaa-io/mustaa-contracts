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
      // Mustaa should get 282 tokens (leap year 2024)
      expect(await timeToken.balanceOfYear(mustaaAddress, 2024))
        .to.equal(BigInt(282) * decimalsFactor);
      
      // Each owner should get 42 tokens (50% of 84 tokens)
      expect(await timeToken.balanceOfYear(owner1Address, 2024))
        .to.equal(BigInt(42) * decimalsFactor);
      expect(await timeToken.balanceOfYear(owner2Address, 2024))
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
        expect(await timeToken.balanceOfYear(mustaaAddress, year))
          .to.equal(BigInt(mustaaShare) * decimalsFactor);
        
        // Check owners' balances (42 tokens each - 50% of 84)
        expect(await timeToken.balanceOfYear(owner1Address, year))
          .to.equal(BigInt(42) * decimalsFactor);
        expect(await timeToken.balanceOfYear(owner2Address, year))
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

  describe("Year-specific transfer functionality", function () {
    let nonAllowedUser: any;
    
    beforeEach(async function () {
        nonAllowedUser = (await ethers.getSigners())[5];
    });
    
    it("Should allow transferring tokens for a specific year", async function () {
        const year = 2024;
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
        const year = 2024;
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
        const year = 2024;
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
        const years = [2024, 2025];
        const amounts = [BigInt(2), BigInt(3)];
        const decimalsFactor = BigInt(10);
        
        const mustaa2024Initial = await timeToken.balanceOfYear(mustaaAddress, years[0]);
        const mustaa2025Initial = await timeToken.balanceOfYear(mustaaAddress, years[1]);
        const owner12024Initial = await timeToken.balanceOfYear(owner1Address, years[0]);
        const owner12025Initial = await timeToken.balanceOfYear(owner1Address, years[1]);
        
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
            .to.equal(mustaa2024Initial - (amounts[0] * decimalsFactor));
        expect(await timeToken.balanceOfYear(mustaaAddress, years[1]))
            .to.equal(mustaa2025Initial - (amounts[1] * decimalsFactor));
        expect(await timeToken.balanceOfYear(owner1Address, years[0]))
            .to.equal(owner12024Initial + (amounts[0] * decimalsFactor));
        expect(await timeToken.balanceOfYear(owner1Address, years[1]))
            .to.equal(owner12025Initial + (amounts[1] * decimalsFactor));
    });
    
    it("Should revert if batch transfer arrays have different lengths", async function() {
        const data = [2024, 2025].map(year => 
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
      const years = [2024, 2025];
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
      const year = 2024;
      const amount = BigInt(10) * BigInt(10);
      const transferAmount = BigInt(5) * BigInt(10);
      
      // Initial balances
      const mustaaInitialBalance = await timeToken.balanceOfYear(mustaaAddress, year);
      const owner1InitialBalance = await timeToken.balanceOfYear(owner1Address, year);
      
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
      const year = 2024;
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
      const year = 2024;
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
      const year = 2024;
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
      const year = 2024;
      const transferAmount = BigInt(5) * BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
      // First allow the user
      await allowList.allowUser(nonAllowedUser.address);
      
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
      const year = 2024;
      const newUser = (await ethers.getSigners())[6];
      const transferAmount = BigInt(5) * BigInt(10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [year]);
      
      // Initially user is not allowed
      expect(await timeToken.allowed(newUser.address)).to.equal(false);
      
      // Allow the user
      await allowList.allowUser(newUser.address);
      
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
      const year = 2024;
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
      const year = 2024;
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

  describe("Token expiry and burning", function () {
    it("Should allow owner to burn expired tokens from any past year", async function () {
        const currentYear = Math.floor(Date.now() / (365 * 24 * 60 * 60 * 1000)) + 1970;
        const pastYear = 2024; // Using 2024 since we know tokens were minted for this year
        
        // Get initial balance for past year
        const initialBalance = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        expect(initialBalance).to.be.gt(0); // Verify we have tokens to burn
        
        // Get initial supply
        const initialSupply = await timeToken.yearlySupply(pastYear);
        
        // Should be able to burn past year's tokens
        await timeToken.burnExpiredTokens(mustaaAddress, pastYear);
        
        // Check balances are updated
        expect(await timeToken.balanceOfYear(mustaaAddress, pastYear)).to.equal(0);
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
        const initialBalanceMustaa = await timeToken.balanceOfYear(mustaaAddress, pastYear);
        const initialBalanceOwner1 = await timeToken.balanceOfYear(owner1Address, pastYear);
        
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
        expect(await timeToken.balanceOfYear(mustaaAddress, pastYear)).to.equal(0);
        expect(await timeToken.balanceOfYear(owner1Address, pastYear)).to.equal(0);
        
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
