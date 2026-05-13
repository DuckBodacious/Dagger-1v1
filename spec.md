# Bot AI Flow Spec

## Global Per-Tick Setup
Before the FSM runs each tick, the bot calculates:
- **Target** — closest living player (human or bot) by horizontal distance
- **distH** — horizontal distance to target
- **isAggressive** — HP > 55% (82.5 HP)
- **isDefensive** — HP < 30% (45 HP)
- **mutualFacing** — both players facing each other (dot product)
- **playerBackExposed** — player facing away from bot
- **Stuck detection** — tracks movement delta; if < 0.25m for 0.5s it bumps `stuckTimer`
- **Auto-throw** — if carrying an object and within 8m and `throwTimer` expired, throw it at target. If `gooGoal` is set, flip yaw 180° first (throws behind bot as a wall)
- **Jump pad trigger** — server auto-fires if bot walks within 0.9m of any placed pad

---

## FSM States

### `approach` *(default)*
Bot closes distance and looks for opportunities to commit to an attack.

**Navigation (navQueue)**
1. If queue empty, check vertical gaps first:
   - Target 2.5+ floors above, bot at ground → queue `[frontDoorLeft → groundStairBot]`
   - Target on roof, bot on 2nd floor → queue `[upperStairBot]`
   - Otherwise → `planRoute()` (door-based zone routing through the building)
2. Advance queue head when within 1.8m (or physically outside building for jump-type waypoints)
3. If on same floor as target, clear stair waypoints immediately
4. **Corner stuck** (1.5s with empty queue, inside building) → reroute to nearest door

**Attack Triggers** (checked in priority order)
| Priority | Condition | Transition |
|---|---|---|
| 1 | Back exposed, aggressive, < 9m, has dash | → `direct_backstab` |
| 2 | Target at killable HP, out of melee, < 9m | → `dash_primary` |
| 3 | Mutual facing, < 7m, aggressive, grounded | → `flickstab_charge` |
| 4 | Lethal explosive barrel near target, aggressive | → `barrel_shoot` |
| 5 | Aggressive, no carried object, > 4m away | → `pickup` (prefer explosive barrel) |
| 6 | Aggressive, ~0.5%/tick chance, pad ready | → `aerial_attack` |
| 7 | Target on roof, own pad ready, near building | → `jumppad` |
| 8 | Target on roof, **own pad on cooldown**, near building | → seek foreign pad via navQueue |
| 9 | HP < 30% | → `kite` |
| 10 | Random pause (~10–24s interval), > 6m from target | → `passive` |

Also fires a quick **primary** if standing on top of target (< 1.8m, idle).

**Unstick behavior**
- If stuck ≥ 0.5s and grounded: jump
- If stuck ≥ 1.5s: strafe left/right for 0.5s (direction alternates each bout)
- Hold jump while airborne and falling (triggers mantles)

---

### `flickstab_charge`
Pre-charges the backstab while slowly closing distance. When charge completes, computes a "behind the player" position, rotates to face it, then transitions.

- Abort → `kite` if defensive, `approach` if target runs > 10m away or timer > 3.5s
- Complete → `flickstab_dash`

### `flickstab_dash`
Fires the dash toward behind the player while holding charge. Once dash finishes, spins 180° to face the player.

- Complete → `flickstab_release`
- Timeout (1.2s) → `approach`

### `flickstab_release`
Releases the charged attack. Waits ~2 frames for hit registration.

- **Hit + front** → `combo` (primary + elbow follow-up)
- **Hit + backstab** → `approach`
- **Miss, has 2 dashes** → `dash_back_reposition`
- **Miss, low dashes** → `flickstab_charge` (retry immediately)

### `direct_backstab`
Player back is exposed — dashes in once and releases the pre-charged attack immediately.

- Abort if player turns around, timer > 2.5s, or bot goes defensive
- In range + charge full → `flickstab_release`

### `dash_primary`
Target is at killable HP but out of melee range. Dashes in and fires a primary.

- Abort if target regens above killable threshold or bot goes defensive
- In range → fire primary → `approach`

### `dash_back_reposition`
After a missed flickstab with charges to spare — dashes away from the player to create space, immediately starts building another charge.

- Dash complete → `flickstab_charge`
- Safety timeout (1.5s) → `approach`

### `combo`
Two-hit follow-up after landing a front-hit charged attack.

- Phase 0: fire **primary**
- Phase 1: wait 0.25s, fire **elbow**
- Phase 2: brief pause → `approach`
- Each phase has a skip timeout if the attack can't connect

---

### `kite`
Low HP retreat with defensive tools.

**Escape dash**: if target closes to < 3.5m and bot has 2 dashes → instant dash directly away

**Cover movement**:
- If `coverPos` exists (a point behind a nearby prop/crate): move toward it
- Once at cover or no cover found: face player and back away; if target > 14m away → `approach`

**Defensive tools** (opportunistic):
- ~0.3%/tick: pick up a nearby goo barrel → `pickup` with `gooGoal=true` (will be thrown behind bot as a wall)
- ~0.8%/tick: place a jump pad and step on it for repositioning

**Self-defense poke**: primary attack if target closes to < 2m

- Timer expires → `approach`

### `passive`
Brief intentional pause. Bot faces target, holds charge, doesn't move.

- Timer expires OR target closes to 2.5m → `approach`

---

### `pickup`
Bot walks to a specific carriable object (`pickupTarget`) and picks it up. Returns to `approach` immediately after; the auto-throw system handles delivery.

- Abort if object disappears, gets carried by someone else, or bot already has something
- 6s timeout → `approach`

---

### `jumppad` *(roof pursuit)*
Places bot's own jump pad and steps on it to reach the roof.

- Places pad at current position
- Walks to pad until launched (`vy > 3`) → `approach`
- Timeout (12s) or target comes down (y < 4) → cancel → `approach`

### `aerial_attack` *(offensive)*
Four-phase airborne flickstab from above.

1. **placing** — place pad, walk onto it until launched
2. **airborne** — rise until > 1.5m above target, compute behind-position, rotate for dash
3. **dashing** — fire horizontal dash, wait for completion, spin to face player
4. **releasing** — drop charge attack → `combo`

Safety timeouts on each phase. Aborts to `approach` or `combo` if timing fails.

---

### `barrel_shoot`
Walks to an explosive barrel near the player and shoots it for lethal splash damage.

- Approach barrel, aim (`fwdDot > 0.8`), fire primary when in range
- Barrel destroyed or gone → `approach`
- 4s timeout → `approach`

---

## `planRoute()` — Zone-Based Door Routing
Divides the map into 4 Z-zones and returns the minimum door waypoints to get from bot's zone to target's zone:

| Bot zone | Target zone | Waypoint chain |
|---|---|---|
| Front exterior | Building front | `[frontDoor]` |
| Front exterior | Building back | `[frontDoor → interiorDoor → backDoor]` |
| Front exterior | Back exterior | `[frontDoor → interiorDoor → backDoor]` |
| Building back | Front exterior | `[interiorDoor → frontDoor]` |
| *etc.* | | mirrors above |
| Upper floor + enemy outside | — | `[exitBuildingFront]` *(jump-type)* |
| Roof + enemy not on roof | — | `[exitBuildingFront]` *(jump-type)* |

Returns `null` if already in the same zone (direct path, no waypoints needed).
