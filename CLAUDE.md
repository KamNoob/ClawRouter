# CLAUDE.md

This file provides guidance for AI assistants working on the ClawRouter codebase.

## Project Overview

ClawRouter is a smart LLM router that automatically routes requests to the cheapest capable AI model across 30+ models from 6 providers (OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot). It is an OpenClaw plugin that achieves ~78% cost savings through intelligent 14-dimension weighted scoring that classifies requests into four tiers (SIMPLE, MEDIUM, COMPLEX, REASONING) and selects the cheapest model for each tier. Payments use x402 USDC micropayments on Base L2.

## Build & Development Commands

```bash
npm run build          # Build with tsup (ESM, outputs to dist/)
npm run dev            # Build in watch mode
npm run typecheck      # Type-check with tsc --noEmit
npm run lint           # Lint src/ with ESLint
npm run format         # Format all files with Prettier
npm run format:check   # Check formatting without writing
```

**CI runs (in order):** format check → lint → typecheck → build. All four must pass.

There is no test script in package.json. Tests are standalone TypeScript files run directly:

```bash
npx tsx test/e2e.ts        # Router classification + full routing (no wallet needed)
npx tsx test-balance.ts    # Balance monitoring, error classes, formatting
npx tsx test-retry.ts      # Retry logic, exponential backoff, isRetryable
npx tsx test-e2e.ts        # Live proxy + x402 payment (requires funded BLOCKRUN_WALLET_KEY)
```

## Architecture

```
src/
├── index.ts              # Plugin entry point — OpenClaw registration, wallet setup
├── provider.ts           # OpenClaw provider registration with dynamic proxy URL
├── proxy.ts              # Local HTTP proxy (localhost:8402/v1) — core request pipeline
├── models.ts             # 30+ model definitions in OpenClaw format
├── auth.ts               # Wallet key resolution (saved file → env var → auto-generate)
├── x402.ts               # EIP-712 USDC signing for x402 payment protocol
├── payment-cache.ts      # Cache 402 params to skip round trip (~200ms savings)
├── balance.ts            # USDC balance monitoring on Base L2 via viem
├── dedup.ts              # Response deduplication (SHA-256 hash, 30s TTL)
├── retry.ts              # Exponential backoff retry (429, 502, 503, 504)
├── errors.ts             # Typed error classes (InsufficientFunds, EmptyWallet, Rpc)
├── logger.ts             # JSON-line usage logging to ~/.openclaw/blockrun/logs/
├── types.ts              # OpenClaw plugin type definitions (duck-typed)
├── version.ts            # Reads version from package.json at runtime
└── router/               # Smart routing engine
    ├── index.ts           # route() entry point
    ├── rules.ts           # 14-dimension weighted scoring classifier (<1ms)
    ├── config.ts          # Default routing config (keywords, weights, tiers)
    ├── selector.ts        # Tier → model selection + cost calculation
    ├── llm-classifier.ts  # Fallback LLM-based classifier for ambiguous queries
    └── types.ts           # Tier, RoutingDecision, RoutingConfig types
```

### Key data flow

1. OpenClaw loads plugin (`index.ts`) → registers provider + starts local proxy
2. Proxy receives OpenAI-compatible requests at `http://localhost:8402/v1`
3. If model is `blockrun/auto`, the router classifies the request tier via rule-based scoring
4. Proxy forwards to BlockRun API, handles x402 payment flow (402 → sign USDC → retry)
5. Response streamed back via SSE with heartbeat to prevent timeout

### Four-tier classification

| Tier      | Primary Model     | Use Case                                   |
| --------- | ----------------- | ------------------------------------------ |
| SIMPLE    | Gemini 2.5 Flash  | Definitions, translations, factual lookups |
| MEDIUM    | DeepSeek Chat     | General Q&A, summaries, moderate code      |
| COMPLEX   | Claude Opus 4     | Large refactors, nuanced analysis          |
| REASONING | DeepSeek Reasoner | Proofs, multi-step math, formal logic      |

## Code Conventions

### TypeScript

- **Strict mode** enabled — all strict checks apply
- **Target**: ES2022, **Module**: ESNext, **Resolution**: bundler
- **ESM only** — use `.js` extensions in imports (e.g., `import { foo } from "./bar.js"`)
- Single production dependency: `viem` (Ethereum wallet library)
- Node.js >=20 required

### Style (enforced by Prettier + ESLint)

- **Double quotes** (not single)
- **Semicolons** required
- **Trailing commas** everywhere (`"all"`)
- **100-character** line width
- **2-space** indentation
- ESLint: flat config with `@eslint/js` recommended + `typescript-eslint` recommended
- ESLint ignores: `dist/`, `node_modules/`, `test/`

### Patterns used throughout

- **Custom error classes** with `readonly code` discriminants and companion type guards (`isInsufficientFundsError()`, etc.)
- **JSDoc comments** on public APIs and module-level doc blocks
- **Type-safe discriminated unions** for tiers: `"SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING"`
- **Graceful degradation** — errors in logging/monitoring never break the request pipeline
- **Singleton state** — `activeProxy` global tracks proxy lifecycle
- **Cache patterns** — `RequestDeduplicator` (30s TTL, 1MB body limit), `PaymentCache` (1h TTL, 1000 entry max), balance cache (30s TTL)
- **Header allowlist** — proxy forwards only `content-type`, `accept`, `accept-encoding`, `accept-language` to upstream
- **CJK-aware token estimation** — uses 2 chars/token for CJK text, 4 chars/token for Latin

### Wallet key resolution order

1. Saved file: `~/.openclaw/blockrun/wallet.key`
2. Environment variable: `BLOCKRUN_WALLET_KEY`
3. Auto-generate new wallet

## File Naming

- Source files use `kebab-case.ts` (e.g., `payment-cache.ts`, `llm-classifier.ts`)
- Test files are either in `test/` directory or at the project root with `test-` prefix
- Configuration files at project root follow standard naming conventions

## Dependencies

| Package                        | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `viem`                         | Ethereum wallet operations — private key to account, EIP-712 signing |
| `openclaw`                     | Peer dependency — plugin system, provider registration               |
| `tsup`                         | Build tool (ESM bundling, dts generation)                            |
| `typescript`                   | TypeScript 5.7 compiler                                              |
| `eslint` + `typescript-eslint` | Linting                                                              |
| `prettier`                     | Code formatting                                                      |

## Common Tasks

### Adding a new model

Edit `src/models.ts` — add an entry to the `BLOCKRUN_MODELS` array following the existing `ModelDefinitionConfig` pattern. Also update tier mappings in `src/router/config.ts` if the model should be a primary or fallback for a tier.

### Modifying routing behavior

- **Keywords/signals**: Edit `src/router/config.ts` (multilingual keyword lists). All keywords must be **lowercase** — the classifier lowercases input text but does not lowercase keywords at runtime for performance.
- **Scoring weights**: Edit `dimensionWeights` in `src/router/config.ts`. Every dimension in `rules.ts` **must** have a corresponding weight or the classifier throws at runtime.
- **Tier boundaries**: Edit `tierBoundaries` in `src/router/config.ts`
- **Scoring logic**: Edit `src/router/rules.ts` (the 14-dimension classifier)

### Adding a new error type

Follow the pattern in `src/errors.ts`: create a class extending `Error` with a `readonly code` discriminant and a companion `isFooError()` type guard.

## Security Constraints

- **Request body limit**: 10MB max (`MAX_REQUEST_BODY_SIZE` in `proxy.ts`) — returns 413 for oversized payloads
- **Response cache limit**: 10MB max per response (`MAX_DEDUP_CACHE_SIZE` in `proxy.ts`) — skips caching for large responses
- **Header allowlist**: Proxy only forwards `content-type`, `accept`, `accept-encoding`, `accept-language` to upstream — do not add headers without security review
- **Wallet key validation**: Must match `/^0x[0-9a-fA-F]{64}$/` (`HEX_KEY_PATTERN` in `auth.ts`) — length-only checks are insufficient
- **Wallet directory permissions**: `0o700` on `~/.openclaw/blockrun/`, `0o600` on `wallet.key`
- **Token estimation clamped**: `maxTokens` capped at 1M to avoid `Number` precision loss
- **LLM classifier cache**: Uses SHA-256 hashing (not weak 32-bit) to prevent collision-based cache poisoning

## Things to Avoid

- Do not add dependencies without strong justification — the project intentionally has a single production dependency (`viem`)
- Do not change the proxy port (8402) without updating all references
- Do not log secrets (wallet keys) — `auth.ts` and `proxy.ts` are careful about this
- Do not break SSE streaming format — the proxy must send headers and heartbeat comments immediately for OpenClaw compatibility
- Do not modify the x402 payment signing logic unless you understand EIP-712 and the Base L2 USDC contract
