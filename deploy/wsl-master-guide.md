# WSL 24/7 Production Deployment & Anti-Ban Master Guide

This guide details how to run **WhatsApp Monthly Sender** completely **free ($0/month)** on **Windows Subsystem for Linux (WSL)** with 99.9% uptime, seamless background execution, zero-effort Windows startup, and state-of-the-art anti-ban protection.

---

## Why WSL on Your Home PC is Superior for WhatsApp Automation

1. **True Residential IP (Zero Cost)**: Cloud VPS providers (AWS, DigitalOcean, Hetzner, Oracle) use data center IP blocks that Meta/WhatsApp aggressively monitor and flag. Running on your home WSL machine routes all traffic through your natural residential ISP IP, which has the highest possible trust rating.
2. **$0 Infrastructure Cost**: No monthly server bills, no paid proxies, and no commercial API subscriptions.
3. **Hardware Isolation**: WSL2 runs a genuine Linux kernel with hardware virtualization, keeping SQLite I/O fast and independent from Windows updates.

---

## 1. WSL Optimization (`.wslconfig`)

To enable seamless port access and background systemd services, configure your Windows WSL profile:

1. Press `Win + R`, type `notepad %USERPROFILE%\.wslconfig`, and press Enter.
2. Paste the following optimal configuration:

```ini
[wsl2]
memory=4GB          # Limits WSL memory to keep Windows snappy
processors=2        # Allocates 2 virtual cores
localhostForwarding=true

[experimental]
autoMemoryReclaim=gradual
networkingMode=mirrored     # Allows instant access via localhost and LAN IP without port forwarding
dnsTunneling=true
```

3. Open PowerShell as Administrator and restart WSL to apply:
```powershell
wsl --shutdown
```

4. Enable **systemd** inside WSL (in `/etc/wsl.conf`):
```bash
sudo bash -c 'cat << "EOF" > /etc/wsl.conf
[boot]
systemd=true
EOF'
```

---

## 2. Preventing Windows / WSL Sleep for 24/7 Reliability

If you want automated monthly scheduled dispatches to trigger even while you are away:

1. **Windows Power & Sleep Settings**:
   - Go to **Windows Settings** → **System** → **Power & Sleep**.
   - Set **"When plugged in, PC goes to sleep after"** to **"Never"**.
   - (You can still turn off the screen/monitor after 10 minutes without affecting running WSL tasks).
2. **WSL Background Keep-Alive**:
   - Running as a Windows service or Startup task prevents the WSL virtual machine from unmounting.

---

## 3. 1-Click Windows Background Startup

We provide pre-built Windows batch and VBS scripts in the `deploy/windows/` folder:

| Script | Purpose |
| :--- | :--- |
| `deploy\windows\start-visible.bat` | Launches the server in a visible command window (great for viewing logs or initial QR scan). |
| `deploy\windows\start-background.vbs` | Launches the server in WSL completely silently in the background (0 windows). |
| `deploy\windows\install-startup.bat` | **Double-click this once!** Automatically registers `start-background.vbs` in your Windows Startup folder so it auto-boots with Windows. |
| `deploy\windows\open-dashboard.bat` | Instantly opens `http://localhost:3000` in your default Windows browser. |
| `deploy\windows\stop.bat` | Gracefully terminates the running server in WSL. |

---

## 4. Running as a Native Linux systemd Service

If you prefer pure Linux daemon management inside WSL:

```bash
# From project directory
sudo ./deploy/setup-service.sh

# Useful systemd commands
sudo systemctl status wa-sender    # Check live service status
sudo journalctl -u wa-sender -f     # Follow real-time system logs
sudo systemctl restart wa-sender   # Restart application
```

---

## 5. Free Remote Access via Cloudflare Tunnel ($0)

Want to check delivery status or add contacts from your mobile phone while away from home?

### Quick On-Demand Tunnel (No Account Required):
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb && rm cloudflared.deb
cloudflared tunnel --url http://localhost:3000
```
This generates a free `https://*.trycloudflare.com` URL accessible anywhere with end-to-end HTTPS encryption.

### Permanent Zero Trust Tunnel (Permanent Free Domain):
1. Sign up for free at [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) (free for up to 50 users).
2. Create a Tunnel pointing to `http://localhost:3000`.
3. Install the cloudflared service on WSL:
   ```bash
   sudo cloudflared service install <YOUR_TOKEN>
   ```
4. Access your dashboard at `https://wa.yourdomain.com` 24/7/365 at $0 cost!

---

## 6. WhatsApp Anti-Ban Operational Best Practices

### A. Spintax Message Variation
Never send byte-for-byte identical text to multiple recipients. Meta's spam filters detect identical strings across un-chatted numbers.
- **Example Template**:
  ```text
  {Assalam-o-Alaikum|Hello|Hi} {{name}}!
  {Here is your monthly invoice|Your statement for {{month}} is ready}.
  {Let us know if you have any questions|Feel free to reply if you need assistance}.
  {Best regards|Warm regards|Thanks},
  Support Team
  ```

### B. Smart Batching & Cooldown
- **Default Batch Size**: 15 messages.
- **Default Cooldown**: 120 seconds (2 minutes).
- **Random Jitter**: 10 to 35 seconds between consecutive messages.
- This distribution curve closely mimics natural human messaging behavior.

### C. Account Warm-Up Schedule (New or Infrequent Senders)
If sending from a fresh SIM or a number that has never done mass messaging:
- **Week 1**: Max 20 messages / day.
- **Week 2**: Max 50 messages / day.
- **Week 3**: Max 80 messages / day.
- **Week 4+**: 100+ messages / day.
- Adjust the **Daily Message Cap** under **Settings** in the web dashboard accordingly.

### D. Honor Opt-Outs Instantly
The engine automatically detects opt-out keywords (`STOP`, `UNSUBSCRIBE`, `ROK DEIN`, `MAT BHEJO`, etc.) and immediately marks contacts as `unsubscribed` to protect your sender reputation.
