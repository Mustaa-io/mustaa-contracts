import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";

describe("YachtOwnership", function () {
  let yachtToken: any;
  let allowList: any;
  let owner: Signer;
  let user1: Signer;
  let user2: Signer;
  let ownerAddress: string;
  let user1Address: string;
  let user2Address: string;
  
  const TOKEN_NAME = "Yacht Token";
  const TOKEN_SYMBOL = "YACHT";
  const MAX_SUPPLY = ethers.parseEther("1000"); // 1000 tokens

  beforeEach(async function () {
    // Get the signers
    [owner, user1, user2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();

    // First deploy the AllowList
    const AllowList = await ethers.getContractFactory("AllowList");
    // Note: 'constructor' flag is required because the contract has a constructor
    // that calls _disableInitializers() - this is the recommended OpenZeppelin pattern
    // The warning is expected and safe in this context.
    allowList = await upgrades.deployProxy(
      AllowList,
      [ownerAddress], // owner
      { 
        initializer: 'initialize',
        unsafeAllow: ['constructor']
      }
    );

    // Deploy the token contract using proxy pattern
    const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
    
    // Deploy as proxy with initialization
    // Note: 'delegatecall' and 'constructor' flags are required for UUPS upgradeable contracts.
    // - 'delegatecall': Required because UUPS uses delegatecall in upgrade mechanism (standard pattern)
    // - 'constructor': Required because the contract has a constructor that calls _disableInitializers()
    // The warnings are expected and safe - they're informational, not errors.
    yachtToken = await upgrades.deployProxy(
      YachtOwnership,
      [
        TOKEN_NAME,
        TOKEN_SYMBOL,
        ownerAddress,
        MAX_SUPPLY,
        await allowList.getAddress()
      ],
      { 
        initializer: 'initialize',
        unsafeAllow: ['delegatecall', 'constructor']
      }
    );

    // Allow users for the tests (owner should be already allowed)
    await allowList.allowUser(ownerAddress);
    await allowList.allowUser(user1Address);
    await allowList.allowUser(user2Address);
    
    // We don't mint tokens here to avoid supply issues
    // Tests that need tokens will mint them individually
  });

  describe("Proxy Deployment", function () {
    it("Should deploy via proxy and initialize correctly", async function () {
      // Check that implementation address exists
      const implementationAddress = await upgrades.erc1967.getImplementationAddress(
        await yachtToken.getAddress()
      );
      expect(implementationAddress).to.be.properAddress;
      
      // Verify initialization worked
      expect(await yachtToken.owner()).to.equal(ownerAddress);
      expect(await yachtToken.tokenSupplyCap()).to.equal(MAX_SUPPLY);
    });
    
    it("Should have zero initial supply", async function () {
      expect(await yachtToken.totalSupply()).to.equal(0);
    });
    
    it("Owner should be allowed by default", async function () {
      expect(await yachtToken.allowed(ownerAddress)).to.equal(true);
    });

    it("Should prevent direct initialization of implementation contract", async function () {
      // Deploy implementation contract directly (not via proxy)
      const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
      const implementation = await YachtOwnership.deploy();
      
      // Try to initialize the implementation directly - should fail
      await expect(
        implementation.initialize(
          TOKEN_NAME,
          TOKEN_SYMBOL,
          ownerAddress,
          MAX_SUPPLY,
          await allowList.getAddress()
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Allowlist", function () {
    it("Users should not be allowed by default", async function () {
      const randomUser = ethers.Wallet.createRandom().address;
      expect(await yachtToken.allowed(randomUser)).to.equal(false);
    });

    it("Owner can allow users through allowList", async function () {
      const randomUser = ethers.Wallet.createRandom().address;
      expect(await yachtToken.allowed(randomUser)).to.equal(false);
      
      await allowList.allowUser(randomUser);
      expect(await yachtToken.allowed(randomUser)).to.equal(true);
    });

    it("Should emit UserAllowed event when allowing a user", async function () {
      const randomUser = ethers.Wallet.createRandom().address;
      await expect(allowList.allowUser(randomUser))
        .to.emit(allowList, "UserAllowed")
        .withArgs(randomUser);
    });
  });

  describe("Minting", function () {
    it("Owner can mint tokens to allowed users", async function () {
      const mintAmount = ethers.parseEther("100");
      
      await yachtToken.mint(user1Address, mintAmount, true, "0x");
      expect(await yachtToken.balanceOf(user1Address)).to.equal(mintAmount);
    });

    it("Cannot mint tokens to non-allowed users", async function () {
      const randomUser = ethers.Wallet.createRandom().address;
      const mintAmount = ethers.parseEther("100");
      
      await expect(
        yachtToken.mint(randomUser, mintAmount, true, "0x")
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(randomUser);
    });

    it("Can mint up to exactly the max supply", async function () {
      // Mint the whole supply to user1
      await yachtToken.mint(user1Address, MAX_SUPPLY, true, "0x");
      expect(await yachtToken.totalSupply()).to.equal(MAX_SUPPLY);
      
      // Try to mint 1 more token - should fail
      await expect(
        yachtToken.mint(user1Address, 1, true, "0x")
      ).to.be.revertedWithCustomError(yachtToken, "LSP7CappedSupplyCannotMintOverCap");
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      // Mint tokens to user1 for transfer tests
      await yachtToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
    });

    it("Allowed users can receive transfers", async function () {
      await yachtToken.connect(user1).transfer(
        user1Address,
        user2Address,
        ethers.parseEther("50"),
        true,
        "0x"
      );
      
      expect(await yachtToken.balanceOf(user2Address)).to.equal(ethers.parseEther("50"));
    });

    it("Cannot transfer to non-allowed users", async function () {
      const randomUser = ethers.Wallet.createRandom().address;
      
      await expect(
        yachtToken.connect(user1).transfer(
          user1Address,
          randomUser,
          ethers.parseEther("50"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(randomUser);
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade to YachtOwnershipV2 and use new functionality", async function () {
      // Deploy the V2 implementation and upgrade
      const YachtOwnershipV2 = await ethers.getContractFactory("YachtOwnershipV2");
      const upgradedToken = await upgrades.upgradeProxy(
        await yachtToken.getAddress(), 
        YachtOwnershipV2,
        { unsafeAllow: ['delegatecall', 'constructor'] }
      );
      
      // Check version function (new in V2)
      expect(await upgradedToken.version()).to.equal("v2.0");
      
      // Test VIP functionality (new in V2)
      expect(await upgradedToken.isVIP(user1Address)).to.equal(false);
      await upgradedToken.setVIPStatus(user1Address, true);
      expect(await upgradedToken.isVIP(user1Address)).to.equal(true);
      
      // Test minting in V2 with the correct function signature
      // Note: We need the right arguments based on what's in YachtOwnershipV2
      await upgradedToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
      
      // Check the balance after minting
      expect(await upgradedToken.balanceOf(user1Address)).to.equal(ethers.parseEther("100"));
    });
  });

  it("Only owner can disallow users", async function () {
    await expect(
      allowList.connect(user1).disallowUser(user2Address)
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  describe("Security: Operator Allowance Revocation", function () {
    beforeEach(async function () {
      // Mint tokens to user1 for operator tests
      await yachtToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
    });

    it("Should automatically zero operator allowance when operator is disallowed", async function () {
      const operator = user2Address;
      const allowanceAmount = ethers.parseEther("50");
      
      // user1 authorizes user2 as an operator
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount,
        "0x"
      );
      
      // Verify the allowance was set
      expect(await yachtToken.authorizedAmountFor(operator, user1Address))
        .to.equal(allowanceAmount);
      
      // Now disallow the operator from the allowlist
      await allowList.disallowUser(operator);
      
      // Try to update the operator allowance - should automatically zero it
      // This simulates what happens when _updateOperator is called
      // The allowance should be zeroed because operator is not allowed
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount, // Try to set allowance again
        "0x"
      );
      
      // The allowance should be zero because operator is disallowed
      expect(await yachtToken.authorizedAmountFor(operator, user1Address))
        .to.equal(0);
    });

    it("Should prevent disallowed operator from using existing allowance to transfer", async function () {
      const operator = user2Address;
      const allowanceAmount = ethers.parseEther("50");
      
      // user1 authorizes user2 as an operator
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount,
        "0x"
      );
      
      // Verify the allowance was set
      expect(await yachtToken.authorizedAmountFor(operator, user1Address))
        .to.equal(allowanceAmount);
      
      // Now disallow the operator from the allowlist
      await allowList.disallowUser(operator);
      
      // Try to use the allowance - should fail because operator is not allowed
      await expect(
        yachtToken.connect(user2).transfer(
          user1Address,
          user2Address,
          ethers.parseEther("30"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(operator);
    });

    it("Should not restore previous allowance when re-allowing a user", async function () {
      const operator = user2Address;
      const allowanceAmount = ethers.parseEther("50");
      
      // user1 authorizes user2 as an operator
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount,
        "0x"
      );
      
      // Disallow the operator
      await allowList.disallowUser(operator);
      
      // Try to set allowance - should be zeroed
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount,
        "0x"
      );
      
      // Allow the operator again
      await allowList.allowUser(operator);
      
      // Previous allowance should still be zero (not restored)
      expect(await yachtToken.authorizedAmountFor(operator, user1Address))
        .to.equal(0);
      
      // Now can set a new allowance
      await yachtToken.connect(user1).authorizeOperator(
        operator,
        allowanceAmount,
        "0x"
      );
      
      expect(await yachtToken.authorizedAmountFor(operator, user1Address))
        .to.equal(allowanceAmount);
    });
  });

  it("Should calculate ownership percentage correctly", async function () {
    // Mint 300 tokens to user1 and 700 to user2
    await yachtToken.mint(user1Address, ethers.parseEther("300"), true, "0x");
    await yachtToken.mint(user2Address, ethers.parseEther("700"), true, "0x");
    
    // user1 should have 30% (3000 basis points)
    expect(await yachtToken.getOwnershipPercentage(user1Address)).to.equal(3000);
    
    // user2 should have 70% (7000 basis points)
    expect(await yachtToken.getOwnershipPercentage(user2Address)).to.equal(7000);
  });

  it("Should track owner count correctly", async function () {
    expect(await yachtToken.getOwnerCount()).to.equal(0);
    
    // Add first owner
    await yachtToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
    expect(await yachtToken.getOwnerCount()).to.equal(1);
    
    // Add second owner
    await yachtToken.mint(user2Address, ethers.parseEther("100"), true, "0x");
    expect(await yachtToken.getOwnerCount()).to.equal(2);
    
    // Remove first owner
    await yachtToken.connect(user1).transfer(
      user1Address,
      user2Address,
      ethers.parseEther("100"),
      true,
      "0x"
    );
    expect(await yachtToken.getOwnerCount()).to.equal(1);
  });
});