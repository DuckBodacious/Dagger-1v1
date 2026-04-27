// All gameplay constants — single source of truth
export const CONFIG = {
    // ─── Server ───
    SERVER_TICK_RATE: 60,           // Hz
    NETWORK_SEND_RATE: 20,         // Hz (snapshots per second)

    // ─── Movement — THE FINALS Light Class (approximated) ───
    SPRINT_SPEED: 6.8,             // m/s (auto-sprint when moving forward) — Light is fastest class
    WALK_SPEED: 4.5,               // m/s (strafe / backward)
    CROUCH_SPEED: 2.8,             // m/s
    BACKWARD_SPEED: 3.8,           // m/s (slower moving backward)
    SLIDE_INITIAL_SPEED: 13.0,     // m/s — THE FINALS slides feel fast
    SLIDE_MIN_SPEED: 3.5,          // m/s — slide ends when decaying below this
    SLIDE_DURATION: 1.1,           // seconds
    SLIDE_COOLDOWN: 0.4,           // seconds — Light has quick slide recovery
    SLIDE_FRICTION: 2.17,          // deceleration during slide (m/s²)
    SLIDE_JUMP_BOOST: 1.15,        // multiplier for jump velocity out of slide

    JUMP_VELOCITY: 5.4,            // m/s upward (~1.4m jump height) — Light jumps slightly higher
    GRAVITY: 18.0,                 // m/s²
    AIR_CONTROL: 0.75,             // fraction of ground speed — Light has good air control
    MAX_FALL_SPEED: 22.0,          // m/s
    FAST_FALL_SPEED: 28.0,         // m/s — press crouch while airborne and falling
    GROUND_FRICTION: 25.0,         // deceleration when no input (m/s²) — snappy stops
    GROUND_ACCEL: 45.0,            // acceleration toward target speed (m/s²) — snappy starts
    AIR_ACCEL: 18.0,               // air acceleration (m/s²) — responsive but not instant
    SPEED_THRESHOLD_SPRINT: 0.5,   // minimum input magnitude to trigger sprint

    // ─── Mantle ───
    MANTLE_REACH: 1.6,             // meters above feet — Light can mantle pretty high
    MANTLE_DURATION: 0.35,         // seconds to complete mantle
    MANTLE_CHECK_DISTANCE: 0.7,    // how far forward to check for ledge (m)
    MANTLE_FORWARD_BOOST: 2.0,     // m/s forward velocity after mantle completes

    // ─── Player Dimensions ───
    PLAYER_HEIGHT: 1.8,            // meters
    PLAYER_CROUCH_HEIGHT: 1.0,     // meters
    PLAYER_RADIUS: 0.4,            // capsule radius
    CAMERA_HEIGHT: 1.6,            // eye level from feet
    CAMERA_CROUCH_HEIGHT: 0.8,     // eye level when crouching
    STEP_HEIGHT: 0.42,             // max auto-step-up height (slightly > one stair step at 0.35m)

    // ─── Combat — Dagger ───
    PRIMARY_DAMAGE: 60,
    PRIMARY_RANGE: 1.7,            // meters
    PRIMARY_DURATION: 0.3,         // swing time (seconds)
    PRIMARY_COOLDOWN: 0.4,         // seconds between attacks

    CHARGED_DAMAGE_FRONT: 70,
    CHARGED_DAMAGE_BACK: 150,      // backstab
    CHARGED_RANGE: 2.2,            // meters
    CHARGE_TIME: 0.7,              // seconds to fully charge
    CHARGED_DURATION: 0.35,        // attack animation time

    ELBOW_DAMAGE: 40,
    ELBOW_RANGE: 1.3,              // meters
    ELBOW_DURATION: 0.2,           // seconds
    ELBOW_COOLDOWN: 0.5,           // seconds

    PLAYER_HP: 150,
    RESPAWN_TIME: 3.0,             // seconds

    // ─── Dash — Evasive Dash ───
    DASH_CHARGES: 3,
    DASH_COOLDOWN: 5.0,            // seconds per charge
    DASH_DISTANCE: 7.0,            // meters
    DASH_DURATION: 0.25,           // seconds
    DASH_SPEED: 28.0,              // 7m / 0.25s = 28 m/s
    DASH_TRAIL_DURATION: 0.5,      // seconds trail persists

    // ─── Barrels ───
    EXPLOSIVE_DAMAGE: 80,
    EXPLOSIVE_RADIUS: 4.0,         // meters
    EXPLOSIVE_BARREL_HP: 30,

    GOO_HEIGHT: 2.0,               // meters
    GOO_RADIUS: 1.5,               // meters
    GOO_DURATION: 30.0,            // seconds
    GOO_BARREL_HP: 20,

    // ─── Arena ───
    ARENA_SIZE: 40.0,              // meters (square)
    BUILDING_WIDTH: 14.0,          // meters
    BUILDING_DEPTH: 10.0,          // meters
    FLOOR_HEIGHT: 3.5,             // meters per floor
    NUM_FLOORS: 3,

    // ─── HUD ───
    CROSSHAIR_SIZE: 20,            // pixels
    CROSSHAIR_GAP: 6,              // pixels
    CROSSHAIR_THICKNESS: 2,        // pixels
    HIT_MARKER_DURATION: 0.3,      // seconds
    KILL_FEED_DURATION: 5.0,       // seconds per entry

    // ─── Audio ───
    MASTER_VOLUME: 0.6,
    FOOTSTEP_INTERVAL_SPRINT: 0.28,  // seconds between footsteps at sprint speed
    FOOTSTEP_INTERVAL_WALK: 0.35,
    FOOTSTEP_INTERVAL_CROUCH: 0.45,
    REMOTE_FOOTSTEP_INTERVAL: 0.35,  // remote player footstep rate

    // ─── Jump Pad ───
    JUMP_PAD_LAUNCH_UP: 20.0,        // upward velocity when launched from floor pad
    JUMP_PAD_LAUNCH_FORWARD: 5.0,    // extra forward push from floor pad
    JUMP_PAD_WALL_SPEED: 16.0,       // horizontal speed away from wall pad
    JUMP_PAD_WALL_UP: 10.0,          // vertical velocity from wall pad
    JUMP_PAD_COOLDOWN: 10.0,         // seconds before you can place again
    JUMP_PAD_TRIGGER_RADIUS: 0.9,    // meters — player proximity to trigger
    JUMP_PAD_RETRIGGER_DELAY: 1.0,   // seconds before same player can re-trigger

    // ─── Mouse ───
    MOUSE_SENSITIVITY: 0.002,      // radians per pixel
};
