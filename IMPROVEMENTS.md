# Arena FPS — Improvement Ideas

## Bot AI

- **Difficulty tiers:** Expose bot aggressiveness/reaction thresholds as a difficulty setting (easy/medium/hard).
- **Teammate awareness:** If multiple bots are in a match, prevent them from all converging on the same target simultaneously.
- **Smarter cover:** Improve `coverPos` selection to prefer cover that also blocks line of sight, not just nearby props.
- **Adaptive kiting:** Bot should re-evaluate `kite` exit more dynamically — currently timer-based, could use distance + HP delta.
- **Goo wall follow-up:** After throwing a goo wall (`gooGoal`), bot should reposition to use the wall as cover before re-engaging.
- **Aerial abort tuning:** Safety timeouts in `aerial_attack` phases could be tightened to reduce wasted air time on failed attempts.

## Gameplay

- **Spectator mode:** Allow a third player to spectate without joining.
- **Round system:** Best-of-X rounds with win tracking between matches.
- **Killcam:** Brief replay of how the killing blow landed.
- **Hit indicators:** On-screen directional indicator showing where damage came from.
- **Object interaction feedback:** Visual/audio cue when picking up or throwing carriable objects.

## Map / Stage

- **Additional maps:** New layouts with different vertical complexity (e.g., fully open arena, mirrored building).
- **Destructible props:** Barrels and crates that can be broken by primary fire regardless of explosive type.
- **Jump pad persistence:** Option for placed jump pads to remain until destroyed, not just single-use.
- **Roof access variety:** Add a second route to the roof so roof camping is less dominant.

## UI / UX

- **Bot status display:** Show bot FSM state in a debug overlay (dev mode toggle).
- **Damage numbers:** Floating numbers on hit for quick feedback.
- **Match summary screen:** Post-match stats — damage dealt, kills, ability uses.
- **Pause menu:** Suspend the match mid-game with a resume/quit option.

## Technical

- **Server tick rate config:** Make server tick rate adjustable without code changes.
- **Lag compensation:** Basic server-side hit validation to handle client latency.
- **Bot count config:** Expose number of bots as a server startup argument.
- **Reconnect support:** Allow a disconnected player to rejoin an in-progress match.
