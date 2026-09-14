# Mocha Automata (Multi-Agent Discord & Obsidian Suite)

[![CI](https://github.com/frtzhahn/mocha-automata/actions/workflows/ci.yml/badge.svg)](https://github.com/frtzhahn/mocha-automata/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

**Mocha Automata** is a production-grade, multi-agent Discord bot suite and Obsidian vault companion engine built with modern Node.js (ECMAScript Modules) and discord.js v14.

It is engineered specifically for local-first autonomy, minimal resource consumption, and zero-cost inference via dynamic OpenRouter model cascades, lookahead speech sanitization, and atomic POSIX file system vault operations.

---

## Architecture Overview

The system operates as a lightweight local harness that maintains deterministic control over all LLM interactions, token ceilings, and file modifications:

```
+---------------------------------------------------------------------------------+
|                                 Discord Clients                                 |
|                       (Mobile, Desktop, Web Interactions)                       |
+----------------------------------------+----------------------------------------+
                                         |
                                         | WebSocket Gateway & REST API
                                         v
+---------------------------------------------------------------------------------+
|                        Local Node.js Autonomous Harness                         |
|                               (Mocha Automata)                                  |
|                                                                                 |
|  +-------------------+   +----------------------+   +------------------------+  |
|  |    disceptatio    |   |        eeper         |   |     mocha-copiloto     |  |
|  | Dialectical Arena |   | Low-Energy Companion |   | Vault & Study Partner  |  |
|  +---------+---------+   +----------+-----------+   +-----------+------------+  |
|            |                        |                           |               |
|            +------------------------+---------------------------+               |
|                                     |                                           |
|         +---------------------------+---------------------------+               |
|         |                                                       |               |
|         v                                                       v               |
|  +-------------------------------+              +----------------------------+  |
|  | Speech Sanitizer & Guardrails |              | Vault Safety Engine        |  |
|  | - Strips <think> / plain CoT  |              | - Atomic .tmp -> rename    |  |
|  | - Moderation filter leaks     |              | - Regex heading insertion  |  |
|  +---------------+---------------+              +-------------+--------------+  |
+------------------|--------------------------------------------|-----------------+
                   |                                            |
                   | HTTPS POST                                 | POSIX FS Syscalls
                   v                                            v
+--------------------------------------+       +----------------------------------+
|    OpenRouter Model Cascade Pool     |       |          Obsidian Vault          |
|  (Dynamic Free Zero-Cost Discovery)  |       |  (Daily Schedules, Memos, Notes) |
| - Nemotron, Ling, Nex-AGI, LFM, etc. |       |  Markdown Frontmatter AST Engine |
+--------------------------------------+       +----------------------------------+
```

---

## Package Ecosystem

The monorepo contains three specialized autonomous agents inside `packages/`:

### 1. `packages/disceptatio`
An automated 3-round dialectical debate arena bot for Discord.
- **Thesis vs. Antithesis:** Coordinates structured intellectual debates between opposing AI viewpoints or community participants.
- **Debate Synthesis:** Condenses argumentative points into a neutral conclusion.
- **Failover Cascade:** Dynamic discovery of active zero-cost text models with automatic retry logic.

### 2. `packages/eeper`
A low-energy, deadpan study companion and conversational peer.
- **Sliding Buffer Context:** Maintains rolling conversation memory capped at 10 items to prevent context sprawl and quota exhaustion.
- **Speech Sanitizer:** Strips XML chain-of-thought blocks (`<think>`, `<thought>`), plain-text drafting traces, and provider safety leaks.
- **Multimodal Vision:** Analyzes incoming image attachments and synthesizes visual descriptions directly into context.

### 3. `packages/mocha-copiloto`
The flagship Gen-Z Obsidian study partner and personal knowledge management companion.
- **Obsidian Vault Integration:** Read-only indexing of notes (`Main-Notes`, `school-notes`, `schdules/daily`) and atomic section writing (`/write`).
- **Dynamic Persona Switcher (`/persona switch`):** Hot-swappable communication calibrations (`mocha`, `academic`, `friendly`) sourced dynamically from markdown frontmatter templates.
- **The Memo Engine (`/memo`):** Structured research scratchpad management (`create`, `append`, `read`) with frontmatter AST synchronization.
- **Interactive Quiz Engine (`/quiz`):** Two-stage concept and coding evaluation with TTL expiration.
- **Automated Midnight Debriefs:** Background 60-second scheduler that analyzes completed vs. pending tasks at 12:00 AM and publishes reports to Discord and the vault.
- **Lively Interactions:** In-character Discord emoji reactions and context-aware Giphy meme responses.

---

## Quickstart Guide

### Prerequisites
- Node.js LTS (version 18.0.0 or higher)
- npm or pnpm
- Git

### 1. Clone the Monorepo
```bash
git clone https://github.com/frtzhahn/mocha-automata.git
cd mocha-automata
```

### 2. Select and Configure a Package
Navigate to the desired agent directory:
```bash
cd packages/mocha-copiloto
cp .env.example .env
```

Populate the `.env` file with your credentials:
```ini
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_CLIENT_ID="your-client-id"
OPENROUTER_API_KEY="your-openrouter-key"
LLM_MODEL="openrouter/free"
VAULT_DIR="/path/to/your/obsidian/vault"
LOG_CHANNELS="123456789012345678"
```

### 3. Install Dependencies and Run
```bash
npm install
node bot.js
```

---

## Cross-Platform Deployment Documentation

Dedicated, zero-fluff setup and background service guides are provided for each supported host environment:

- [Linux Deployment Guide (Arch, CachyOS, Ubuntu)](docs/setup-linux.md): Native Node.js, `systemd` user units, and `tmux`.
- [Android Termux Guide](docs/setup-termux.md): Mobile hosting, `termux-wake-lock`, storage permissions, and memory management.
- [Windows Deployment Guide](docs/setup-windows.md): PowerShell, winget, Modern Standby power configuration, and PM2/NSSM services.

---

## Contributing

Please review [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) when submitting pull requests. All contributions must pass continuous integration syntax checks across Node.js 18.x, 20.x, and 22.x:

```bash
node --check packages/disceptatio/bot.js
node --check packages/eeper/bot.js
node --check packages/mocha-copiloto/bot.js
```
