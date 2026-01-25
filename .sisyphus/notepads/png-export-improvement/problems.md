# Problems - PNG Export Improvement

## Unresolved Blockers

_Issues that need attention_

---

## [2026-01-25T02:07] BLOCKER: Browserbase WebSocket Connection Timeout

### Issue
`chromium.connectOverCDP(session.connectUrl)` times out after 30s when connecting to Browserbase.

### Evidence
```
🚀 Starting Browserbase + Excalidraw export spike...
📡 Creating Browserbase session...
✅ Session created: 984a8b42-14f5-4a35-9497-1ac0bad2424f
🌐 Connecting to remote browser via CDP...
❌ TimeoutError: overCDP: Timeout 30000ms exceeded.
Call log:
  - <ws connecting> wss://connect.usw2.browserbase.com/
```

### What Works
- ✅ Browserbase SDK installed correctly
- ✅ Env vars load from .env.local
- ✅ Session creation via API succeeds
- ✅ Spike code has no TypeScript errors

### What Fails
- ❌ WebSocket connection to Browserbase CDP endpoint
- Attempts to connect to: `wss://connect.usw2.browserbase.com/`
- Timeout: 30 seconds

### Possible Causes
1. **Corporate firewall** blocking WebSocket connections
2. **VPN** interfering with WSS connections
3. **Local network restrictions** (router/ISP blocking port 443 WSS)
4. **Browserbase service issue** (unlikely - session creation works)
5. **macOS firewall** blocking outbound WSS connections

### Next Steps
**User Action Required**:
1. Check if VPN is active (disable and retry)
2. Check corporate firewall settings (allow WSS to *.browserbase.com)
3. Test from different network (mobile hotspot, etc.)
4. Check macOS firewall settings: System Preferences → Security & Privacy → Firewall

**Alternative Approach** (if network issue persists):
- Use local Playwright with export harness (fallback to original plan)
- Deploy to environment without network restrictions (CI/CD, cloud)
- Use different browser automation service (Browserless.io, Cloudflare)

### Status
**BLOCKED** - Cannot proceed with Browserbase approach until WebSocket connectivity is resolved.

