import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

describe("YachtOwnership", function () {
  let yachtToken: any;
  let owner: any;
  let user1: any;
  let user2: any;
  let ownerAddress: string;
  let user1Address: string;
  let user2Address: string;
  let _LSP4_TOKEN_NAME_KEY = 0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1;
  
  const TOKEN_NAME = "Yacht Token";
  const TOKEN_SYMBOL = "YACHT";
  const MAX_SUPPLY = ethers.parseEther("1000"); // 1000 tokens

  beforeEach(async function () {
    // Get the signers
    [owner, user1, user2] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();

    // Deploy the token contract
    const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
    yachtToken = await YachtOwnership.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      ownerAddress,
      MAX_SUPPLY
    );
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const nameKey = "0xdeba1e292f8ba88238e10ab3c7f88bd4be4fac56cad5194b6ecceaf653468af1";
      const symbolKey = "0x2f0a68ab07768e01943a599e73362a0e17a63a72e94dd2e384d2c1d4db932756";
      
      const storedName = await yachtToken.getData(nameKey);
      const storedSymbol = await yachtToken.getData(symbolKey);
      
      expect(ethers.hexlify(storedName)).to.equal(ethers.hexlify(ethers.toUtf8Bytes(TOKEN_NAME)));
      expect(ethers.hexlify(storedSymbol)).to.equal(ethers.hexlify(ethers.toUtf8Bytes(TOKEN_SYMBOL)));
    });

    it("Should set the correct owner", async function () {
      expect(await yachtToken.owner()).to.equal(ownerAddress);
    });

    it("Should set the correct max supply", async function () {
      expect(await yachtToken.tokenSupplyCap()).to.equal(MAX_SUPPLY);
    });

    it("Should have zero initial supply", async function () {
      expect(await yachtToken.totalSupply()).to.equal(0);
    });
  });

  describe("Allowlist", function () {
    it("Users should not be allowed by default", async function () {
      expect(await yachtToken.allowed(user1Address)).to.equal(false);
      expect(await yachtToken.allowed(user2Address)).to.equal(false);
    });

    it("Owner can allow users", async function () {
      await yachtToken.allowUser(user1Address);
      expect(await yachtToken.allowed(user1Address)).to.equal(true);
    });

    it("Owner can disallow users", async function () {
      await yachtToken.allowUser(user1Address);
      expect(await yachtToken.allowed(user1Address)).to.equal(true);
      
      await yachtToken.disallowUser(user1Address);
      expect(await yachtToken.allowed(user1Address)).to.equal(false);
    });

    it("Non-owners cannot allow users", async function () {
      await expect(
        yachtToken.connect(user1).allowUser(user2Address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Non-owners cannot disallow users", async function () {
      await yachtToken.allowUser(user2Address);
      await expect(
        yachtToken.connect(user1).disallowUser(user2Address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should emit UserAllowed event when allowing a user", async function () {
      await expect(yachtToken.allowUser(user1Address))
        .to.emit(yachtToken, "UserAllowed")
        .withArgs(user1Address);
    });

    it("Should emit UserDisallowed event when disallowing a user", async function () {
      await yachtToken.allowUser(user1Address);
      await expect(yachtToken.disallowUser(user1Address))
        .to.emit(yachtToken, "UserDisallowed")
        .withArgs(user1Address);
    });
  });

  describe("Minting", function () {
    it("Owner can mint tokens to allowed users", async function () {
      await yachtToken.allowUser(user1Address);
      const mintAmount = ethers.parseEther("100");
      
      await yachtToken.mint(user1Address, mintAmount, true, "0x");
      expect(await yachtToken.balanceOf(user1Address)).to.equal(mintAmount);
    });

    it("Cannot mint tokens to non-allowed users", async function () {
      const mintAmount = ethers.parseEther("100");
      
      await expect(
        yachtToken.mint(user1Address, mintAmount, true, "0x")
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(user1Address);
    });

    it("Cannot mint beyond the max supply", async function () {
      await yachtToken.allowUser(user1Address);
      const oversupplyAmount = MAX_SUPPLY + BigInt(1);
      
      await expect(
        yachtToken.mint(user1Address, oversupplyAmount, true, "0x")
      ).to.be.revertedWithCustomError(yachtToken, "LSP7CappedSupplyCannotMintOverCap");
    });

    it("Non-owners cannot mint tokens", async function () {
      await yachtToken.allowUser(user1Address);
      const mintAmount = ethers.parseEther("100");
      
      await expect(
        yachtToken.connect(user1).mint(user1Address, mintAmount, true, "0x")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Can mint up to exactly the max supply", async function () {
      await yachtToken.allowUser(user1Address);
      
      await yachtToken.mint(user1Address, MAX_SUPPLY, true, "0x");
      expect(await yachtToken.totalSupply()).to.equal(MAX_SUPPLY);
    });
  });

  describe("Transfers", function () {
    beforeEach(async function () {
      // Allow user1 and mint them tokens
      await yachtToken.allowUser(user1Address);
      await yachtToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
    });

    it("Allowed users can receive transfers", async function () {
      await yachtToken.allowUser(user2Address);
      
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
      await expect(
        yachtToken.connect(user1).transfer(
          user1Address,
          user2Address,
          ethers.parseEther("50"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(user2Address);
    });

    it("Non-allowed users cannot send tokens", async function () {
      await yachtToken.allowUser(user2Address);
      await yachtToken.connect(user1).transfer(
        user1Address,
        user2Address,
        ethers.parseEther("50"),
        true,
        "0x"
      );
      
      // Disallow user2
      await yachtToken.disallowUser(user2Address);
      
      await expect(
        yachtToken.connect(user2).transfer(
          user2Address,
          user1Address,
          ethers.parseEther("25"),
          true,
          "0x"
        )
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(user2Address);
    });
  });

  describe("Operators", function () {
    beforeEach(async function () {
      // Allow users and mint tokens to user1
      await yachtToken.allowUser(user1Address);
      await yachtToken.allowUser(user2Address);
      await yachtToken.mint(user1Address, ethers.parseEther("100"), true, "0x");
    });

    it("Allowed users can authorize operators", async function () {
      await yachtToken.connect(user1).authorizeOperator(
        user2Address,
        ethers.parseEther("50"),
        "0x"
      );
      
      expect(await yachtToken.authorizedAmountFor(user2Address, user1Address))
        .to.equal(ethers.parseEther("50"));
    });

    it("Operators can transfer on behalf of token owners", async function () {
      await yachtToken.connect(user1).authorizeOperator(
        user2Address,
        ethers.parseEther("50"),
        "0x"
      );
      
      await yachtToken.connect(user2).transfer(
        user1Address,
        user2Address,
        ethers.parseEther("25"),
        true,
        "0x"
      );
      
      expect(await yachtToken.balanceOf(user1Address))
        .to.equal(ethers.parseEther("75"));
      expect(await yachtToken.balanceOf(user2Address))
        .to.equal(ethers.parseEther("25"));
    });

    it("Non-allowed users cannot become operators", async function () {
      // Disallow user2
      await yachtToken.disallowUser(user2Address);
      
      await expect(
        yachtToken.connect(user1).authorizeOperator(
          user2Address,
          ethers.parseEther("50"),
          "0x"
        )
      ).to.be.revertedWithCustomError(yachtToken, "LSP7Disallowed").withArgs(user2Address);
    });
  });

  describe("Edge cases", function () {
    it("Cannot deploy with zero max supply", async function () {
      const YachtOwnership = await ethers.getContractFactory("YachtOwnership");
      await expect(
        YachtOwnership.deploy(TOKEN_NAME, TOKEN_SYMBOL, ownerAddress, 0)
      ).to.be.revertedWithCustomError(yachtToken, "LSP7CappedSupplyRequired");
    });

    it("Owner is automatically allowed", async function () {
        expect(await yachtToken.allowed(ownerAddress)).to.equal(true);
        // Owner should be able to mint to themselves since they're allowed
        await yachtToken.mint(ownerAddress, 100, true, "0x");
        expect(await yachtToken.balanceOf(ownerAddress)).to.equal(100);
      });
  });
});