# Termux Deployment Guide: Android Mobile Hosting

This guide outlines the complete procedure for running the Mocha Automata suite on Android devices using Termux. It addresses package installation, Android background process constraints, wake-lock acquisition, and internal storage access.

---

## 1. System Architecture & Mobile Power Governance

Hosting server applications on battery-powered mobile hardware presents unique architectural constraints compared to traditional Linux servers.

* **Software Layer (Android OS & Userspace):**
  Android employs a modified Linux kernel that runs userspace applications inside isolated Linux UIDs. To conserve battery life and system memory, Android incorporates aggressive process management daemons:
  - **Android Doze Mode:** Suspends network access and defers background jobs when the device is stationary and the screen is turned off.
  - **Phantom Process Killer (Android 12+):** System framework service that terminates child processes spawned by apps if total phantom processes exceed 32 or consume excessive CPU in the background.
  - **Low Memory Killer Daemon (`lmkd`):** Monitors available RAM and terminates background processes based on Out-Of-Memory (`oom_adj`) scores when memory pressure thresholds are crossed.
* **Hardware Layer (ARM SoC & Power Management IC):**
  Mobile ARM chipsets dynamically scale clock frequencies across big.LITTLE core clusters. When screen off is detected, the Power Management Integrated Circuit (PMIC) and kernel cpufreq governor place high-performance CPU cores into deep C-states (low power dormancy). Acquiring a Linux kernel wake lock prevents the SoC application processors from entering deep sleep states, maintaining active CPU instruction cycles and Wi-Fi interface power.

---

## 2. Termux Initial Setup & Storage Permissions

Ensure Termux is installed from F-Droid or GitHub Releases (do not use the obsolete Google Play Store build).

### Acquire Storage Permissions

Grant Termux access to shared device storage (necessary if reading or writing to Obsidian vaults stored in internal storage):

* **Command:**
  ```bash
  termux-setup-storage
  ```
* **Purpose:** Prompts the Android OS runtime permission dialog to grant Termux access to `/sdcard` and maps shared storage directories into `~/storage/shared`.
* **Use Case:** Initial setup when bots need to interact with Obsidian notes stored in phone storage.
* **Distribution Availability:** Termux userspace environment on Android 7.0+.

### Prevent Deep CPU Sleep (Wake Lock)

* **Command:**
  ```bash
  termux-wake-lock
  ```
* **Purpose:** Acquires a partial wake lock from the Android PowerManager service, preventing CPU idle sleep when the screen is powered off.
* **Use Case:** Mandatory for hosting network daemons that maintain continuous WebSocket connections (such as Discord Gateway).
* **Distribution Availability:** Termux package environment.

*Note: You must also disable Android's OS-level Battery Optimization for Termux in Android Settings (`Settings > Apps > Termux > Battery > Unrestricted`). On Android 12+, disable the Phantom Process Killer via ADB if hosting multiple concurrent processes: `adb shell "/system/bin/device_config put activity_manager max_phantom_processes 2147483647"`.*

---

## 3. Toolchain & Runtime Installation

Update Termux package repositories and install Node.js LTS and Git:

* **Command:**
  ```bash
  pkg update && pkg upgrade -y
  pkg install -y nodejs-lts git tmux
  ```
* **Purpose:** Synchronizes Termux mirrors and installs the long-term support release of Node.js, npm, Git version control, and tmux.
* **Use Case:** Initial development and runtime toolchain provisioning inside Termux.
* **Distribution Availability:** Official Termux APT mirrors.

Verify the installed versions:

```bash
node -v
npm -v
git --version
```

---

## 4. Repository Installation & Configuration

Clone the repository and install the chosen bot package:

```bash
# Clone the repository
git clone https://github.com/frtzhahn/mocha-automata.git
cd mocha-automata/packages/mocha-copiloto

# Install dependencies
npm install
```

### Configure Environment Variables

Create and edit the `.env` file using `nano`:

```bash
cp .env.example .env
nano .env
```

Populate the required credentials:

```ini
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_CLIENT_ID="your-client-id"
OPENROUTER_API_KEY="your-openrouter-key"
GIPHY_API_KEY="your-optional-giphy-key"
LLM_MODEL="openrouter/free"
VISION_MODEL="openrouter/free"
VAULT_DIR="/data/data/com.termux/files/home/storage/shared/Documents/ObsidianVault"
LOG_CHANNELS="123456789012345678"
```

Save and exit `nano` (`Ctrl + O`, `Enter`, `Ctrl + X`).

---

## 5. Process Execution & Background Persistence

To keep the bot running after exiting the Termux terminal app, run it inside a persistent `tmux` session.

### Start with Tmux

```bash
# Launch a dedicated tmux session
tmux new -s bot-session

# Navigate and start the application
cd ~/mocha-automata/packages/mocha-copiloto
node bot.js
```

Detach from the session by pressing `Ctrl + B`, followed by `D`.

### Reconnecting to the Session

To reattach and view live execution logs:

```bash
tmux attach -t bot-session
```

### Alternative: Running via Nohup

If `tmux` is not preferred, launch the process detached from the current controlling terminal using `nohup`:

* **Command:**
  ```bash
  nohup node bot.js > bot.log 2>&1 &
  ```
* **Purpose:** Executes the Node.js process with `SIGHUP` signals ignored and standard streams redirected to `bot.log`.
* **Use Case:** Simple background daemon execution in low-resource terminal environments.
* **Distribution Availability:** POSIX core utilities.

To monitor output:

```bash
tail -f bot.log
```

---

## 6. Resource Management & Memory Limits

Mobile hardware often operates under strict RAM limitations (3 GB to 8 GB shared between OS, baseband, GPU, and apps). To prevent the Android `lmkd` daemon from terminating the Node process:

1. Avoid running simultaneous heavy compilation or memory-intensive scripts on the mobile device.
2. Ensure sliding message history and note caches in the bot configuration remain at lightweight bounds (e.g., sliding window maximum of 10 messages).
3. If memory pressure occurs, enforce V8 heap limits during startup:
   ```bash
   node --max-old-space-size=256 bot.js
   ```
