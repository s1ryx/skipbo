# Security Audit Report

**Audit Date:** 2026-02-26
**Scope:** Full server and client codebase, deployment configuration

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 7 |
| Low | 4 |
| Info | 2 |

## Critical

### 1. Session Hijacking via Reconnect

**Files:** `server/gameCoordinator.js:110-178`

The `handleReconnect` method accepts `oldPlayerId` from the client with zero
authentication. Anyone who knows a `roomId` and `oldPlayerId` (which is just a
Socket.IO socket ID) can hijack another player's session.

**Attack:** Player A disconnects. Attacker sends `reconnect` with Player A's
`oldPlayerId`. The server updates `player.id` to the attacker's connection and
sends them Player A's full state.

**Fix:** Issue a cryptographically random session token (UUID v4) at room
creation/join. Require the client to present this token during reconnection.

### 2. No Rate Limiting on Any Socket Events

**Files:** `server/transport/SocketIOTransport.js:39-51`, `server/gameCoordinator.js:30-55`

Every incoming socket message is processed immediately with no throttling or
per-connection limits.

**Attack scenarios:**
- Room creation flood: thousands of `createRoom` events per second exhaust memory
  (no limit on total rooms, only on pending deletions)
- Chat spam: unlimited broadcast to all room members
- Game action spam: amplified via state broadcasts to all players

**Fix:** Per-connection rate limiting with different limits per event type.

## High

### 3. Full Stockpile Leaked in getPlayerState()

**File:** `server/gameLogic.js:297-308`

`getPlayerState()` returns the entire `stockpile` array. In Skip-Bo, only the
top card should be visible. A player inspecting network traffic sees every
upcoming stockpile card in order.

**Fix:** Only send `stockpileCount` and `stockpileTop`, not the full array.

### 4. Wildcard CORS in Production

**Files:** `server/transport/SocketIOTransport.js:31-37`, `deployment/docker/docker-compose.yml:15`

CORS defaults to `origin: '*'` with `credentials: true`. The docker-compose
hardcodes `CORS_ORIGIN=*`. While browsers reject `credentials: true` with
`origin: *` for XHR, WebSocket transport bypasses CORS entirely.

**Fix:** Set specific allowed origin in production. Remove `credentials: true`
if not using cookies.

### 5. No Server-Side Validation of Player Names

**Files:** `server/gameCoordinator.js:57,76,110`, `server/gameLogic.js:39-53`

Player names are accepted with no validation of type, length, or content.
An attacker could send megabyte-long names or non-string values.

**Fix:** Validate string type, trim, enforce 1-30 character length.

### 6. No Server-Side Validation of Chat Messages

**File:** `server/gameCoordinator.js:300-318`

Client has `maxLength={200}` but the server only calls `message.trim()`.
A raw Socket.IO connection can send arbitrarily large messages or non-strings
(causing `.trim()` to throw).

**Fix:** Validate string type, enforce max length (e.g., 500 chars).

### 7. Missing Bounds Validation on buildingPileIndex / source

**File:** `server/gameLogic.js:135-148, 150, 175-176`

`buildingPileIndex` is used without bounds checking. `this.buildingPiles[-1]`
returns `undefined`, crashing `getNextCardValue`. The `source` string
parsing (`parseInt(source.replace('discard', ''))`) can produce `NaN`.

**Fix:** Validate `buildingPileIndex` is integer in [0,3]. Validate `source`
against whitelist: `['hand', 'stockpile', 'discard0'-'discard3']`.

## Medium

### 8. Chat XSS (Defense-in-Depth)

**Files:** `client/src/components/Chat.js:82-85`

React escapes JSX content, preventing current XSS. But no server-side
sanitization exists as defense-in-depth against future `dangerouslySetInnerHTML`
or non-React consumers.

**Fix:** Strip/reject HTML tags in player names and messages server-side.

### 9. Room ID Predictability and Collision

**File:** `server/gameCoordinator.js:424-433`

Room IDs are 6 chars from 24-char alphabet (~191M combinations) using
`Math.random()` (not cryptographic). No collision check — a duplicate ID
overwrites the existing room.

**Fix:** Use `crypto.randomBytes()`. Check for collision before inserting.
Consider 8+ character IDs.

### 10. No Limit on Total Room Count

**File:** `server/gameCoordinator.js:57-73`

`MAX_PENDING_ROOMS=50` only limits empty rooms awaiting deletion. No limit on
active rooms. Thousands of `createRoom` events exhaust memory.

**Fix:** Add max total rooms limit. Add per-IP limits.

### 11. stablePlayerId is Client-Controlled

**Files:** `server/gameCoordinator.js:313`, `client/src/useGameConnection.js:5-17`

The server blindly relays client-supplied `stablePlayerId` in chat messages.
An attacker can impersonate another player's chat identity.

**Fix:** Generate stable IDs server-side, or ignore client-supplied values.

### 12. No Authorization on startGame

**File:** `server/gameCoordinator.js:180-204`

Any player in the room can start the game — no host-only check.

**Fix:** Track room creator, restrict `startGame` to host.

### 13. Unvalidated maxPlayers and stockpileSize

**Files:** `server/gameCoordinator.js:59`, `server/gameLogic.js:78-82`

No upper bound on `maxPlayers` (could be `Infinity`). `stockpileSize` could be
`NaN` or negative, causing empty stockpiles or crashes.

**Fix:** Validate `maxPlayers` integer in [2,6], `stockpileSize` integer in [5,30].

### 14. Math.random() for Deck Shuffling

**File:** `server/gameLogic.js:31-37`

`Math.random()` (xorshift128+) is predictable. An attacker observing enough
cards could reconstruct PRNG state and predict the deck order.

**Fix:** Use `crypto.randomInt()` for competitive play.

## Low

### 15. Crash via Crafted source String

**File:** `server/gameLogic.js:175-176`

`source: "discard__proto__"` → `parseInt("__proto__")` → `NaN` →
`player.discardPiles[NaN]` → `undefined` → crash on `.length`.

**Fix:** Whitelist valid source values.

### 16. Connection IDs Leaked to All Players

**File:** `server/gameLogic.js:279-280`

`getGameState()` includes raw Socket.IO socket IDs, making session hijacking
(Finding 1) easier for same-room attackers.

**Fix:** Use opaque, game-specific player identifiers in public state.

### 17. No TLS Enforcement

**Files:** `deployment/nginx/default.conf`, `deployment/docker/docker-compose.yml`

Default nginx serves HTTP. No redirect to HTTPS. All traffic is plaintext.

**Fix:** Configure TLS, add HTTP→HTTPS redirect.

### 18. No Cleanup of Completed Games

**File:** `server/gameCoordinator.js:229-234`

Games in `gameOver` state persist in memory until players explicitly leave.
Gradual memory leak on long-running servers.

**Fix:** TTL-based cleanup for completed games.

## Info

### 19. Session in Predictable localStorage Keys

**File:** `client/src/useGameConnection.js:11-14`

Session stored in `localStorage` under `skipBoSession` — readable by any script
on the same origin or subsequent user on a shared computer.

**Fix:** Consider `sessionStorage` or encrypt sensitive values.

### 20. User-Supplied Data in Server Logs

**File:** `server/gameCoordinator.js:73,107,177,318`

`console.log` includes unsanitized player names and chat messages. Enables
log injection with newlines or ANSI escape codes.

**Fix:** Use structured logging (Winston, Pino) or sanitize before logging.
