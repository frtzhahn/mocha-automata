# Windows Deployment Guide: PowerShell & Windows Terminal

This guide outlines the complete setup procedure for deploying Mocha Automata agents on Windows 10 and Windows 11 workstations or Windows Server environments.

---

## 1. System Architecture & Layer Boundaries

Understanding the Windows NT architecture and power management behavior ensures reliable continuous operation:

* **Software Layer (Windows NT Operating System):**
  The Windows NT Executive kernel manages process scheduling, object security identifiers (SIDs), and asynchronous I/O via I/O Completion Ports (IOCPs), which Node.js interfaces through `libuv`. Background processes started in standard interactive PowerShell consoles terminate when the user logs off or closes the terminal session unless wrapped in a dedicated Windows Service or task scheduler daemon.
* **Hardware Layer (UEFI & ACPI Modern Standby):**
  Modern Windows laptops and workstations frequently employ **Modern Standby (`S0 Low Power Idle`)** instead of legacy ACPI `S3` sleep. Under Modern Standby, Windows may suspend desktop app threads and place the CPU into low-power states while keeping the screen off. To run a 24/7 Discord bot on Windows hardware, configure Windows Power settings to prevent sleep while plugged into AC power:
  `Settings > System > Power & battery > Screen and sleep > When plugged in, put my device to sleep after: Never`.

---

## 2. Toolchain Installation

The recommended method to install developer dependencies on modern Windows systems is through the official Windows Package Manager (`winget`) within an elevated PowerShell prompt.

### Install Node.js LTS and Git

Launch PowerShell as Administrator and run:

* **Command:**
  ```powershell
  winget install OpenJS.NodeJS.LTS
  winget install Git.Git
  ```
* **Purpose:** Downloads and silently installs the verified LTS MSI package for Node.js and Git for Windows through the Windows Package Manager.
* **Use Case:** Clean, reproducible installation of developer dependencies on modern Windows systems.
* **Distribution Availability:** Windows 10 (version 1809+) and Windows 11.

*Note: After installation finishes, close and reopen your PowerShell or Windows Terminal window to refresh the system `$env:PATH` environment variable.*

Verify installations:

```powershell
node --version
npm --version
git --version
```

---

## 3. Repository Setup & Dependencies

Clone the monorepo using PowerShell:

```powershell
# Navigate to preferred projects folder
cd $HOME\Documents

# Clone repository
git clone https://github.com/frtzhahn/mocha-automata.git
cd mocha-automata\packages\mocha-copiloto

# Install npm dependencies
npm install
```

---

## 4. Environment Configuration (`.env`)

Create your `.env` configuration file from `.env.example`. When creating `.env` files in Windows, ensure they are saved using **UTF-8 (without BOM)** encoding to prevent Node.js environment parsers from failing on invisible byte-order marks.

In PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

Populate the configuration values:

```ini
DISCORD_BOT_TOKEN="your-discord-bot-token"
DISCORD_CLIENT_ID="your-client-id"
OPENROUTER_API_KEY="your-openrouter-api-key"
GIPHY_API_KEY="your-optional-giphy-key"
LLM_MODEL="openrouter/free"
VISION_MODEL="openrouter/free"
VAULT_DIR="C:/Users/username/Documents/ObsidianVault"
LOG_CHANNELS="123456789012345678"
```

*Note: In Windows paths within `.env`, you may use standard Windows backslashes (e.g., `C:\Users\...`) or forward slashes (`C:/Users/...`). Node.js's `path` module resolves both formats correctly.*

---

## 5. Execution & Verification

### Static Syntax Check

Always verify the syntax prior to launch:

* **Command:**
  ```powershell
  node --check bot.js
  ```
* **Purpose:** Validates the ECMAScript modules and parsing syntax using Node.js without initializing the Discord client.
* **Use Case:** Pre-flight smoke testing before executing the bot.
* **Distribution Availability:** All systems running Node.js.

### Interactive Execution

Start the bot directly within PowerShell:

```powershell
node bot.js
```

Observe the initialization output:

```
==================================================
[Gateway] Mocha El Copiloto online! Logged in as Mocha#1234
[Vault] Root: C:\Users\username\Documents\ObsidianVault
...
```

---

## 6. Background Service Persistence (Production)

To keep the bot running continuously in the background after closing PowerShell or across reboots, select one of the following process supervision approaches:

> **Persistence Notice:** Option A (PM2) runs in interactive user sessions and starts upon user login. For headless servers where the bot must persist through user logoff or launch before Windows user login, use Option B (NSSM).

### Option A: PM2 Process Manager

Install PM2 globally and configure it as a continuous Windows daemon:

* **Command:**
  ```powershell
  npm install -g pm2
  npm install -g pm2-windows-startup
  pm2-startup install
  pm2 start bot.js --name "mocha-copiloto"
  pm2 save
  ```
* **Purpose:** Registers PM2 as a persistent background daemon that starts automatically on Windows user login and restarts the bot on unexpected crashes.
* **Use Case:** Lightweight production hosting on personal Windows PCs or development workstations.
* **Distribution Availability:** Global npm registry on all Node.js platforms.

### Option B: Non-Sucking Service Manager (NSSM)

For Windows Server or headless operation where the process must run at boot prior to user login:

1. Download NSSM from `https://nssm.cc/download` and place `nssm.exe` in `C:\Windows\System32` or your PATH.
2. Open Administrator PowerShell and install the service:
   ```powershell
   nssm install MochaCopiloto "C:\Program Files\nodejs\node.exe" "C:\Users\username\Documents\mocha-automata\packages\mocha-copiloto\bot.js"
   nssm set MochaCopiloto AppDirectory "C:\Users\username\Documents\mocha-automata\packages\mocha-copiloto"
   nssm set MochaCopiloto Start SERVICE_AUTO_START
   nssm start MochaCopiloto
   ```
3. Monitor logs via the Windows Event Viewer or configure NSSM file redirection for standard output.
