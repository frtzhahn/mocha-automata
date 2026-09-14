# Mocha Automata (My Personal Multi-Agent Discord & Obsidian Suite)

<p align="center">
<img width="490" height="276" alt="project banner" src="https://github.com/user-attachments/assets/576fa9d2-32fe-4872-b8eb-c172a9c3c77c" />
</p>

[![CI](https://github.com/frtzhahn/mocha-automata/actions/workflows/ci.yml/badge.svg)](https://github.com/frtzhahn/mocha-automata/actions/workflows/ci.yml)[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)[![OpenRouter](https://img.shields.io/badge/OpenRouter-Free%20Cascade-6566F1)](https://openrouter.ai)[![Obsidian](https://img.shields.io/badge/Obsidian-Vault%20Engine-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md)[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Mocha Automata** is my personal multi-agent Discord bot suite integrated with an Obsidian vault companion engine, built with modern Node.js (ECMAScript Modules) and discord.js v14.

This is built specifically for my own local first autonomy, minimal resource consumption, and zero-cost inference via dynamic OpenRouter model cascades, lookahead speech sanitization, and atomic POSIX file system vault operations.

---

## Architecture Overview

The system operates as a lightweight local harness (mini agent harness) that maintains deterministic control over all LLM interactions, token ceilings, and file modifications:

```mermaid
flowchart TD
    %% Theme-Agnostic High-Contrast Node Styles (WCAG AA Compliant)
    classDef client fill:#5865F2,stroke:#3C45A5,stroke-width:2px,color:#FFFFFF;
    classDef agent fill:#2B2D31,stroke:#5865F2,stroke-width:2px,color:#FFFFFF;
    classDef engine fill:#D97706,stroke:#92400E,stroke-width:2px,color:#FFFFFF;
    classDef external fill:#059669,stroke:#065F46,stroke-width:2px,color:#FFFFFF;
    classDef vault fill:#7C3AED,stroke:#5B21B6,stroke-width:2px,color:#FFFFFF;

    %% Ingress Gateway
    Clients["<b>Discord Clients</b><br/>(Desktop • Mobile • Web)"]:::client

    %% Core Harness Boundary (Transparent container renders crisp in Light & Dark mode)
    subgraph Harness ["<b>Local Node.js Autonomous Harness (Mocha Automata)</b>"]
        direction TB

        %% Row 1: Autonomous Agents (Evenly distributed across 3 horizontal columns)
        D["<b>disceptatio</b><br/>Dialectical Arena"]:::agent
        E["<b>eeper</b><br/>Study Companion"]:::agent
        M["<b>mocha-copiloto</b><br/>Vault Assistant"]:::agent

        %% Row 2: Guardrails & Storage
        SS["<b>Speech Sanitizer & Guardrails</b><br/>• CoT & &lt;think&gt; filter<br/>• Moderation shield"]:::engine
        VS["<b>Vault Safety Engine</b><br/>• Atomic .tmp → rename<br/>• AST frontmatter sync"]:::engine

        %% Internal Cross-Wiring
        D & E & M --> SS
        D & E & M --> VS
    end

    %% Transparent background adapts cleanly to GitHub Light, Dark, and Mobile
    style Harness fill:none,stroke:#5865F2,stroke-width:2px,stroke-dasharray: 5 5

    %% Target Backends
    OR["<b>OpenRouter Cascade Pool</b><br/>(Free Dynamic Discovery)<br/>Nemotron • Ling • Nex-AGI • LFM"]:::external
    OV["<b>Obsidian Vault</b><br/>(Local Storage Engine)<br/>Schedules • Memos • Debriefs"]:::vault

    %% Ingress & Egress Connections
    Clients -->|WebSocket Gateway & REST API| Harness
    SS -->|HTTPS POST| OR
    VS -->|POSIX FS Syscalls| OV
```


---

## Package Ecosystem

The monorepo contains three specialized autonomous agents inside `packages/`:

### 1. `packages/disceptatio`
An automated 3 round dialectical debate arena bot for Discord.
- **Thesis vs. Antithesis:** Coordinates structured intellectual debates between opposing AI viewpoints or community participants.
- **Debate Synthesis:** Condenses argumentative points into a neutral conclusion.
- **Failover Cascade:** Dynamic discovery of active zero-cost text models with automatic retry logic.

### 2. `packages/eeper`
A low-energy, cat companion and conversational peer.
- **Sliding Buffer Context:** Maintains rolling conversation memory capped at 10 items to prevent context sprawl and quota exhaustion.
- **Speech Sanitizer:** Strips XML chain-of-thought blocks (`<think>`, `<thought>`), plain-text drafting traces, and provider safety leaks.
- **Multimodal Vision:** Analyzes incoming image attachments and synthesizes visual descriptions directly into context.

### 3. `packages/mocha-copiloto`
My curated Obsidian study buddy and personal knowledge management companion.
- **Obsidian Vault Integration:** Read-only indexing of notes (`mocha-vault/` or external vault) and atomic section writing (`/write`).
- **Dynamic Persona Switcher (`/persona switch`):** Hot-swappable communication calibrations (`mocha`, `academic`, `friendly`) sourced dynamically from markdown frontmatter templates.
- **The Memo Engine (`/memo`):** Structured research scratchpad management (`create`, `append`, `read`) with frontmatter AST synchronization.
- **Interactive Quiz Engine (`/quiz`):** Two-stage concept and coding evaluation with TTL expiration.
- **Automated Midnight Debriefs:** Background 60-second scheduler that analyzes completed vs. pending tasks at 12:00 AM and publishes reports to Discord and the vault.
- **Lively Interactions:** In character Discord emoji reactions and context-aware Giphy meme responses.

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

### 2. Install Workspace Dependencies
Install dependencies across all packages in a single command from the monorepo root:
```bash
npm install
```

### 3. Configure Your Agent
Navigate to your chosen agent package and copy the environment template:
```bash
# Example: Configuring mocha-copiloto
cd packages/mocha-copiloto
cp .env.example .env
```

Populate the `.env` file with your credentials:
```ini
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_CLIENT_ID="your-client-id"
OPENROUTER_API_KEY="your-openrouter-key"
LLM_MODEL="openrouter/free"
VISION_MODEL="openrouter/free"
VAULT_DIR="./mocha-vault"
LOG_CHANNELS="123456789012345678"
```

### 4. Run the Agent
Start the agent from within its directory:
```bash
npm start
```
Or launch any agent directly from the monorepo root:
```bash
npm run start:mocha
# or: npm run start:disceptatio
# or: npm run start:eeper
```

---

## Cross-Platform Deployment Documentation

Setup and background service guides are provided for each supported host environment:

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


---

## License

This project is licensed under the terms of the [GNU General Public License v3.0](LICENSE).



