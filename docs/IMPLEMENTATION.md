# NFTMarket — Complete Implementation Guide

## 1. Project Overview

A full-stack NFT marketplace dApp on Ethereum Sepolia testnet. Users trade NFTs using MTK (ERC20) tokens with support for both traditional 2-transaction and optimized 1-transaction (ERC20 callback) purchase flows. The frontend uses **Reown AppKit** (WalletConnect) for wallet authentication.

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.25, Foundry, OpenZeppelin |
| Frontend | Next.js 15 (App Router), React 19, TypeScript |
| Blockchain SDK | wagmi 2.x, viem 2.x |
| Wallet Auth | Reown AppKit 1.8 (WalletConnect) |
| Styling | Tailwind CSS 3 |
| Network | Ethereum Sepolia (Chain ID: 11155111) |

---

## 2. Project Structure

```
nft-project/
├── src/                              # Solidity contracts
│   ├── MyNFT.sol                     # ERC-721 NFT (Ownable, mint by owner)
│   ├── MyToken.sol                   # ERC-20 token with callback transfer
│   ├── NFTMarket.sol                 # Marketplace: list / unlist / buy
│   └── interfaces/
│       └── ITokenReceiver.sol        # ERC20 callback interface
├── test/
│   └── NFTMarket.t.sol               # 32 Foundry tests
├── script/
│   ├── DeployMyNFT.s.sol             # Deploy NFT + mint 3 NFTs
│   └── DeployNFTMarket.s.sol         # Deploy all 3 contracts
├── scripts/
│   ├── interact.ts                   # CLI: mint/list/buy/unlist/status
│   ├── upload_to_ipfs.js             # Upload assets to Pinata IPFS
│   ├── compute_ipfs_cids.mjs         # Compute IPFS CIDs locally
│   └── generate_assets.sh            # Generate SVG + metadata files
├── listener/
│   └── monitor.ts                    # Event monitor for marketplace events
├── frontend/                         # Next.js 15 frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx            # Root layout with SSR cookie hydration
│   │   │   ├── page.tsx              # Main page: Marketplace + List tabs
│   │   │   ├── providers.tsx         # Wagmi + AppKit + Toast providers
│   │   │   └── globals.css           # Tailwind + animations
│   │   ├── components/
│   │   │   ├── ConnectButton.tsx     # Wallet connect/disconnect
│   │   │   ├── MarketplaceGrid.tsx   # Grid of all NFTs
│   │   │   ├── NFTCard.tsx           # Single NFT card with buy/unlist
│   │   │   ├── ListNFTForm.tsx       # Form to list an NFT for sale
│   │   │   └── ToastContainer.tsx    # Toast notification overlay
│   │   ├── contracts/
│   │   │   ├── addresses.ts          # Contract addresses (replaceable)
│   │   │   └── abis/                 # ABI JSON files
│   │   │       ├── MyNFT.json
│   │   │       ├── MyToken.json
│   │   │       └── NFTMarket.json
│   │   ├── context/
│   │   │   └── ToastContext.tsx      # Global toast state management
│   │   ├── hooks/
│   │   │   └── useNFTMetadata.ts     # Fetch NFT metadata from IPFS
│   │   └── lib/
│   │       └── config.ts             # WagmiAdapter + AppKit configuration
│   ├── .env.local                    # Reown Project ID + RPC URL
│   ├── .env.example                  # Template for environment variables
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── deployments/
│   └── sepolia.json                  # Deployed contract addresses
├── images/                           # NFT artwork SVGs (1.svg, 2.svg, 3.svg)
├── metadata/                         # NFT metadata JSONs (1.json, 2.json, 3.json)
├── foundry.toml
└── package.json                      # Root package (CLI scripts)
```

---

## 3. Smart Contract Design

### 3.1 MyNFT.sol — ERC-721 NFT Contract

- Inherits: `ERC721`, `ERC721URIStorage`, `Ownable` (OpenZeppelin)
- Only owner can mint: `mint(address to, string memory uri)`
- Auto-incrementing token IDs from 0
- `nextTokenId()` returns the next token ID to be minted

### 3.2 MyToken.sol — ERC-20 Token Contract

- Standard ERC20 with 18 decimals, symbol "MTK"
- Constructor mints 1,000,000 MTK to deployer
- Public `mint(address to, uint256 amount)` for testing
- **Callback transfer**: `transfer(address to, uint256 amount, bytes calldata data)` calls `tokensReceived()` on the recipient if it's a contract — enables one-transaction NFT purchases

### 3.3 NFTMarket.sol — Marketplace Contract

- Implements `ITokenReceiver` for ERC20 callback purchases
- Constructor: `NFTMarket(address _nft, address _token, address _signer)`
- Immutable state: `nft`, `token`, `signer` (EIP-712 permit signer)
- Data: `Listing { address seller; uint256 price; bool active; }` per tokenId
- Replay protection: `mapping(bytes32 => bool) usedDigests`

**Core Functions:**

| Function | Description |
|----------|------------|
| `list(tokenId, price)` | Transfer NFT to market, create listing |
| `unlist(tokenId)` | Return NFT to seller, deactivate listing |
| `buyNFT(tokenId, amount)` | Approve-based purchase (requires prior token approval) |
| `permitBuy(tokenId, amount, deadline, signature)` | Whitelist purchase with EIP-712 offline signature |
| `tokensReceived(from, amount, data)` | Callback: one-transaction atomic purchase |
| `listings(tokenId)` | View listing info (seller, price, active) |
| `buildPermitDigest(buyer, tokenId, amount, deadline)` | Build EIP-712 digest for off-chain signing |

**Events:** `Listed`, `Unlisted`, `Bought`

### 3.4 Purchase Flows

**Standard (2 transactions):**
1. Buyer approves MTK spending to NFTMarket via `token.approve(market, price)`
2. Buyer calls `market.buyNFT(tokenId, price)`

**Callback (1 transaction):**
1. Buyer calls `token.transfer(market, price, abi.encode(tokenId))`
2. Market receives tokens via `tokensReceived()` and completes the swap atomically

**Whitelist Permit (off-chain signature):**
1. Backend signs EIP-712 permit for `(buyer, tokenId, amount, deadline)` using `signer` private key
2. Buyer receives signature off-chain
3. Buyer approves MTK spending to NFTMarket
4. Buyer calls `market.permitBuy(tokenId, amount, deadline, signature)`
5. Contract verifies: signature matches `signer` → not expired → not replayed → executes purchase

---

## 4. Frontend Architecture

### 4.1 Wallet Connection (AppKit / WalletConnect)

**Configuration** (`src/lib/config.ts`):
```typescript
const wagmiAdapter = new WagmiAdapter({
  projectId,        // from Reown Cloud
  networks: [sepolia],
  customRpcUrls: { "eip155:11155111": [{ url: sepoliaRpc }] },
});
```

**Provider Setup** (`src/app/providers.tsx`):
- `WagmiProvider` — blockchain state
- `QueryClientProvider` — React Query caching
- `ToastProvider` — notification toasts
- `createAppKit()` — Reown AppKit singleton (WalletConnect modal)

**SSR Hydration** (`src/app/layout.tsx`):
- Reads `cookieToInitialState(wagmiConfig, cookie)` server-side
- Passes to `WagmiProvider` for instant auth state on page load

### 4.2 Components

#### MarketplaceGrid
- Reads `nextTokenId` from MyNFT to determine total NFTs
- Queries each token's listing from NFTMarket via individual `useReadContract`
- Renders `NFTCard` for each token with its listing status
- Loading skeleton while data is fetching
- Refresh button to re-query

#### NFTCard
- Shows NFT image from IPFS metadata (fetched via `useNFTMetadata` hook)
- Shows NFT name, description, token ID
- For active listings:
  - **Seller** sees "Delist" button
  - **Buyer** sees two purchase methods:
    - **Approve + Buy**: auto-checks allowance, auto-chains approve→buy
    - **One-Click Buy**: single transaction via ERC20 callback
- Status badges: "Listed" (green), "Sold / Delisted" (gray)
- Loading skeleton while metadata is fetching
- Toast notifications for all transaction states

#### ListNFTForm
- Shows user's MTK balance with "Get Test Tokens" button (mints 1000 MTK)
- Token ID selector grid — checks ownership in real-time
- NFT metadata preview (image + name) when a token is selected
- Price input in MTK
- Auto-chained approve → list flow
- Toast notifications for each step

#### ToastContainer
- Fixed bottom-right overlay
- Supports: info, success, error, pending states
- Pending toasts stay until updated; others auto-dismiss after 8 seconds
- Includes Etherscan link for confirmed transactions
- Slide-in animation

### 4.3 Custom Hooks

#### useNFTMetadata
- Reads `tokenURI(tokenId)` from MyNFT contract
- Fetches metadata JSON from IPFS (tries multiple gateways with fallback)
- In-memory cache per URI
- Returns: `metadata`, `loading`, `imageUrl` (IPFS→HTTP converted)

#### useToast (context)
- `addToast({ type, title, message, txHash })` → returns toast ID
- `updateToast(id, updates)` — for transitioning pending→success/error
- `removeToast(id)` — manual dismiss

---

## 5. How to Replace Contracts / ABI / Frontend

This project is designed as a **reference template**. To use it for your own NFT marketplace:

### 5.1 Replace Contract Addresses

Edit `frontend/src/contracts/addresses.ts`:
```typescript
export const CONTRACTS = {
  MyNFT: "0xYOUR_NFT_ADDRESS" as `0x${string}`,
  MyToken: "0xYOUR_TOKEN_ADDRESS" as `0x${string}`,
  NFTMarket: "0xYOUR_MARKET_ADDRESS" as `0x${string}`,
} as const;

export const CHAIN_ID = 11155111; // Change to your chain ID
```

### 5.2 Replace ABIs

Replace the JSON files in `frontend/src/contracts/abis/`:
- `MyNFT.json` — your NFT contract ABI
- `MyToken.json` — your token contract ABI
- `NFTMarket.json` — your marketplace contract ABI

Generate ABIs from Foundry:
```bash
# In your Foundry project
forge build
# Copy from out/ directory:
cp out/MyNFT.sol/MyNFT.json frontend/src/contracts/abis/
cp out/MyToken.sol/MyToken.json frontend/src/contracts/abis/
cp out/NFTMarket.sol/NFTMarket.json frontend/src/contracts/abis/
```

### 5.3 Change Network

Edit `frontend/src/lib/config.ts`:
```typescript
import { mainnet, sepolia, polygon } from "@reown/appkit/networks";
// Change to your target network
```

Edit `frontend/src/app/providers.tsx`:
```typescript
import { mainnet } from "@reown/appkit/networks";
// Update networks array and defaultNetwork
```

### 5.4 Change Frontend Pages

- Modify `page.tsx` for layout changes
- Add/remove components as needed
- Update styling in `tailwind.config.ts` and `globals.css`
- Update metadata in `layout.tsx`

### 5.5 Environment Variables

Create `frontend/.env.local`:
```
NEXT_PUBLIC_REOWN_PROJECT_ID=your_project_id
NEXT_PUBLIC_SEPOLIA_RPC_URL=your_rpc_url
```

Get a Reown Project ID from https://cloud.reown.com

---

## 6. Deployment Guide

### 6.1 Deploy Contracts (Foundry)

```bash
# Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.drpc.org"
export ETHERSCAN_API_KEY="your_key"

# Option A: Deploy with private key
forge script script/DeployNFTMarket.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify

# Option B: Deploy with Foundry keystore
forge script script/DeployNFTMarket.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --keystore ~/.foundry/keystores/my-key \
  --broadcast \
  --verify
```

### 6.2 Update Frontend Addresses

Copy the deployed addresses from `deployments/sepolia.json` to `frontend/src/contracts/addresses.ts`.

### 6.3 Deploy Frontend

```bash
cd frontend
npm install
npm run build    # Verify build passes
npm run start    # Start production server
# Or deploy to Vercel / Netlify
```

---

## 7. Testing & Verification

### 7.1 Smart Contract Tests

```bash
forge test -vvv
# 32 tests covering: list, unlist, buy, permitBuy (whitelist + EIP-712), callback purchase, access control, edge cases
```

### 7.2 CLI Interaction Testing

```bash
npm run interact status   # Check all listings
npm run interact mint     # Mint test tokens
npm run interact list     # List an NFT
npm run interact buy      # Buy via approve+buy
npm run interact unlist   # Unlist an NFT
```

### 7.3 Frontend Testing

1. Start dev server: `cd frontend && npm run dev`
2. Open http://localhost:3000
3. Connect wallet via AppKit (WalletConnect supported)
4. **List flow:** Switch to "List NFT" tab → select token → set price → confirm 2 transactions
5. **Buy flow:** Switch wallets → go to "Marketplace" tab → click buy → confirm transaction(s)
6. **Verify:** Check listings refresh, NFT transfers, token balance changes

### 7.4 Cross-Account Purchase Verification

1. Account A mints NFT and lists it on marketplace
2. Account B connects (different wallet)
3. Account B sees the listing in Marketplace
4. Account B purchases using MTK tokens
5. Verify: NFT transfers to Account B, MTK transfers to Account A

---

## 8. Key Design Decisions

### 8.1 Why Multiple Purchase Methods?
- **Approve+Buy**: Familiar UX, two-step, requires prior MTK approval
- **One-Click (ERC20 Callback)**: Single transaction, saves gas, requires `transferWithData` support
- **PermitBuy (Whitelist)**: Backend-controlled access, EIP-712 off-chain signature, enables gated sales (e.g., only approved addresses can purchase specific NFTs)

### 8.2 Why Individual Listing Queries?
Each NFT card queries its own listing independently. This avoids the need for a bulk-listing view function in the contract and simplifies the frontend. React Query deduplicates and caches results.

### 8.3 SSR Cookie Hydration
The layout reads wagmi state from cookies server-side and passes it as `initialState`. This means the connected wallet state persists across page reloads without a flash of "not connected."

---

## 9. Deployed Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| MyNFT | `0x86bD3a04b287208267B8ac795807A128e6B156A1` |
| MyToken | `0xc07Aa8ab04Fcf817A4A76aaCf761Fe5d27D349e2` |
| NFTMarket | `0x2503E57BF29bD1b32425361840FE6Bb0d6CCc7F7` |

---

## 10. Screenshots

### Marketplace View
![Marketplace](screenshots/marketplace.png)
*Main marketplace showing listed NFTs with prices and purchase buttons.*

### List NFT View
![List NFT](screenshots/list-nft.png)
*Form to list an NFT for sale with token selection and price input.*

### Wallet Connection
![Wallet Connect](screenshots/wallet-connect.png)
*Reown AppKit modal for WalletConnect login.*

### Transaction Toast
![Transaction](screenshots/transaction.png)
*Toast notifications showing transaction status with Etherscan links.*

---

## 11. Future Enhancements

- [ ] Auction mechanism support
- [ ] Collection-level offers
- [ ] Royalty support (ERC-2981)
- [ ] Multi-chain deployment
- [ ] Indexed events for faster frontend loading
- [ ] Subgraph (The Graph) integration for event indexing

---

## 12. EIP-712 PermitBuy — Backend Signing Guide

### Signing Parameters

The backend signs an EIP-712 typed data structure:

```
PermitBuy(address buyer,uint256 tokenId,uint256 amount,uint256 deadline)
```

Domain:
```
EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
  name:    "NFTMarket Permit"
  version: "1"
```

### JavaScript (ethers.js v6)

```javascript
const domain = {
  name: "NFTMarket Permit",
  version: "1",
  chainId: 11155111,
  verifyingContract: "0xMARKET_ADDRESS"
};

const types = {
  PermitBuy: [
    { name: "buyer", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

const value = {
  buyer: "0xBOB_ADDRESS",
  tokenId: 0,
  amount: 100000000000000000000n, // 100 MTK in wei
  deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour
};

const signature = await signer.signTypedData(domain, types, value);
// signature is 65 bytes (r + s + v), pass to frontend
```

### Contract Verification

The contract verifies:
1. `block.timestamp <= deadline` — signature not expired
2. `!usedDigests[digest]` — not already used (replay protection)
3. `ecrecover(digest, signature) == signer` — signed by authorized backend
4. Listing is active and amount matches listing price
