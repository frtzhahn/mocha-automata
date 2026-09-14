# Linux Deployment Guide: Arch, CachyOS, and Ubuntu

This guide details the procedure for deploying and managing the Mocha Automata multi-agent Discord bot suite on Linux workstations and dedicated servers. It covers toolchain installation, process persistence via systemd user services, and terminal multiplexing with tmux.

---

## 1. System Architecture & Layer Boundaries

Understanding the division of responsibility between the software stack and underlying hardware ensures continuous uptime and prevents unexpected process terminations.

* **Software Layer (Operating System & Kernel):**
  The Linux kernel manages execution scheduling, process isolation, memory allocations via the virtual memory manager, and socket communication across network interfaces. The `systemd` init system orchestrates background daemon lifecycles through user control groups (`cgroups`), automatically restarting crashed processes and routing standard I/O streams to the system journal (`journald`).
* **Hardware Layer (BIOS/UEFI & Power States):**
  The motherboard firmware (UEFI/BIOS) and the Advanced Configuration and Power Interface (ACPI) dictate system sleep states (`S0ix` Modern Standby or `S3` Suspend-to-RAM). If the host machine enters a hardware sleep state, the CPU halts clock cycles, suspending network interfaces and dropping Discord WebSocket Gateway heartbeats. Servers and local hosting machines must disable hardware sleep states in firmware or system power configuration to maintain continuous connection.

---

## 2. Toolchain Installation

The runtime environment requires Node.js (version 18.0.0 or higher), npm, Git, and optionally tmux for interactive session management.

### Arch Linux / CachyOS

* **Command:**
  ```bash
  sudo pacman -S nodejs npm git tmux
  ```
* **Purpose:** Installs the V8 JavaScript runtime engine, Node Package Manager, version control system, and terminal multiplexer from official Arch repositories.
* **Use Case:** Initial host provisioning on rolling-release Arch Linux or optimized kernel environments like CachyOS.
* **Distribution Availability:** Arch Linux, CachyOS, Manjaro, EndeavourOS.

### Ubuntu / Debian LTS

* **Command:**
  ```bash
  sudo apt update && sudo apt install -y curl git tmux
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
* **Purpose:** Adds NodeSource repository for Node.js LTS (20.x) and installs necessary build and runtime utilities via `apt`.
* **Use Case:** Initial host provisioning on Debian-family server and desktop distributions where system repositories may carry outdated Node.js versions.
* **Distribution Availability:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, Debian 11/12.

---

## 3. Repository Setup & Dependencies

Clone the monorepo and install the required dependencies for the target package:

```bash
# Clone the repository
git clone https://github.com/frtzhahn/mocha-automata.git
cd mocha-automata

# Navigate to desired package directory (e.g., mocha-copiloto)
cd packages/mocha-copiloto

# Install production dependencies
npm install
```

---

## 4. Environment Configuration

Create a `.env` file within the respective package directory using the provided template:

```bash
cp .env.example .env
chmod 600 .env
```

Edit the `.env` file with appropriate credentials:

```ini
DISCORD_BOT_TOKEN="your-bot-token"
DISCORD_CLIENT_ID="your-client-id"
OPENROUTER_API_KEY="your-openrouter-api-key"
GIPHY_API_KEY="your-optional-giphy-key"
LLM_MODEL="openrouter/free"
VISION_MODEL="openrouter/free"
VAULT_DIR="/path/to/your/obsidian-vault"
LOG_CHANNELS="123456789012345678"
```

*Note: Restricting `.env` file permissions to `600` (`chmod 600 .env`) ensures that only the executing user account can read the secrets.*

---

## 5. Process Supervision: Systemd User Service (Recommended)

Running the bot as a systemd user unit ensures automatic restart on failure, boot-time execution without requiring root privileges, and persistent logging.

### Enable User Session Lingering

By default, systemd user services terminate when the user logs out. Lingering allows user units to start at boot and persist across session terminations.

* **Command:**
  ```bash
  loginctl enable-linger $USER
  ```
* **Purpose:** Enables systemd user manager instantiation at boot for the specified non-root user.
* **Use Case:** Production deployment of daemon processes under a standard user account.
* **Distribution Availability:** All systemd-based distributions (Arch, Debian, Ubuntu, Fedora).

### Create Service Unit

Create the user unit directory and definition:

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/mocha-copiloto.service
```

Paste the following unit configuration (adjusting absolute paths accordingly):

```ini
[Unit]
Description=Mocha El Copiloto Study Assistant Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/mocha-automata/packages/mocha-copiloto
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

# Resource confinement via Linux cgroups
MemoryMax=1G
TasksMax=100

[Install]
WantedBy=default.target
```

### Manage the Service

* **Reload Daemon Configuration:**
  ```bash
  systemctl --user daemon-reload
  ```
  *Purpose:* Informs systemd of newly created or altered unit files.

* **Enable and Start Service:**
  ```bash
  systemctl --user enable --now mocha-copiloto.service
  ```
  *Purpose:* Enables auto-start on boot and starts the bot process immediately.

* **Inspect Live Journal Logs:**
  ```bash
  journalctl --user -u mocha-copiloto.service -f
  ```
  *Purpose:* Streams standard output and standard error logs in real-time.

* **Check Runtime Status:**
  ```bash
  systemctl --user status mocha-copiloto.service
  ```
  *Purpose:* Displays process state, active PID, memory consumption, and recent log lines.

---

## 6. Process Supervision: Tmux Session (Alternative)

For manual testing, development, or environments without systemd user sessions, use `tmux` to keep processes alive across SSH disconnections.

* **Create New Named Session:**
  ```bash
  tmux new -s mocha-copiloto
  ```
  *Purpose:* Spawns a persistent virtual terminal session named `mocha-copiloto`.

* **Launch Application:**
  ```bash
  cd ~/mocha-automata/packages/mocha-copiloto
  node bot.js
  ```

* **Detach Session:**
  Press `Ctrl + B`, then press `D`.
  *Purpose:* Detaches the client terminal from the session while leaving the background process executing.

* **Re-attach Session:**
  ```bash
  tmux attach -t mocha-copiloto
  ```
  *Purpose:* Re-attaches standard I/O to the executing background session.

---

## 7. Verification

Verify that the JavaScript syntax is valid prior to starting:

```bash
node --check bot.js
```
