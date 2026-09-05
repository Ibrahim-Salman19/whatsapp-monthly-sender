# Zero-Cost Remote Access with Cloudflare Tunnel (100% Free)

You can securely access your WhatsApp Monthly Sender dashboard from your mobile phone or outside your home network without paying a single cent ($0), without opening any router ports, and without having a static IP.

---

## Option 1: Instant Quick Tunnel (No Account Needed, 30 Seconds)

Cloudflare provides free on-demand tunnels (`trycloudflare.com`) with full HTTPS encryption.

1. **Install `cloudflared` on WSL**:
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   rm cloudflared.deb
   ```

2. **Launch the Tunnel**:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

3. Look at the terminal output for your free public HTTPS URL:
   ```
   Your quick Tunnel has been created! Visit it at:
   https://random-words-here.trycloudflare.com
   ```
4. Open that URL on your phone to view the dashboard, scan the QR code, or check send status!

---

## Option 2: Permanent Free Tunnel with Your Own Domain (Zero Trust Free Tier)

If you have a domain managed on Cloudflare (which is free to manage):

1. Login to the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) (Free plan for up to 50 users).
2. Go to **Networks** → **Tunnels** → **Create a Tunnel**.
3. Select **Cloudflared** and follow the 1-command installer for Debian/Ubuntu on WSL.
4. Route the tunnel traffic to:
   - Service: `HTTP`
   - URL: `localhost:3000`
5. You now have a permanent URL like `https://wa.yourdomain.com` with automated SSL and 24/7 access at $0 cost!

---

## Option 3: Local Network Access (Home Wi-Fi)

To open the dashboard on your phone while connected to the same Wi-Fi:
1. In Windows PowerShell, run: `ipconfig` (find your IPv4 address, e.g., `192.168.1.50`).
2. WSL2 port forwarding to Windows host:
   WSL2 mirrors `localhost` to Windows by default in Windows 11 (`.wslconfig` with `networkingMode=mirrored` or via Windows portproxy).
3. Open `http://192.168.1.50:3000` on your phone browser.
