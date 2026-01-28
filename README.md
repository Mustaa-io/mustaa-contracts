# Mustaa Contracts

Smart contracts for yacht ownership and time-based token management on LUKSO Network.

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run build

# Run tests
npm test

# Start local node
npm run node
```

## Environment Setup

Create a `.env` file:

```env
CONTRACT_VERIFICATION_TESTNET_PK=your_private_key_here
```

## Core Contracts

- **TimeToken** - LSP7-based time token for yacht usage rights with yearly distribution
- **YachtOwnership** - LSP7-based NFT for yacht ownership management
- **AllowList** - Access control for permitted users

## Network Configuration

### Local Development
```bash
npm run node
```

### LUKSO Testnet
- **Chain ID**: 4201
- **RPC**: https://rpc.testnet.lukso.network
- **Explorer**: https://explorer.execution.testnet.lukso.network/

Deploy to testnet:
```bash
npx hardhat run scripts/deploy.ts --network luksoTestnet
```

## Built With

- [Hardhat](https://hardhat.org/) - Development environment
- [OpenZeppelin](https://www.openzeppelin.com/contracts) v4.9.6 - Secure contracts
- [LUKSO LSP Standards](https://docs.lukso.tech/standards/introduction) - Token standards
- [TypeScript](https://www.typescriptlang.org/) - Type safety

## License

MIT

This project uses MIT licensed contracts from OpenZeppelin and Apache-2.0 licensed contracts from LUKSO.

