import { CONFIG } from './config.js?v=4';

// Player state used on both client (prediction) and server (authority)
export class PlayerState {
    constructor(id) {
        this.id = id;
        this.hp = CONFIG.PLAYER_HP;
        this.alive = true;

        // Position & rotation
        this.x = 0;
        this.y = CONFIG.PLAYER_HEIGHT / 2;  // center of capsule
        this.z = 0;
        this.yaw = 0;     // horizontal look (radians)
        this.pitch = 0;   // vertical look (radians)

        // Velocity
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;

        // Movement state
        this.grounded = false;
        this.crouching = false;
        this.sliding = false;
        this.slideTimer = 0;
        this.slideCooldownTimer = 0;
        this.mantling = false;
        this.mantleTimer = 0;
        this.mantleTargetY = 0;
        this.mantleStartY = 0;
        this.mantleStartX = 0;
        this.mantleStartZ = 0;
        this.mantleTargetX = 0;
        this.mantleTargetZ = 0;

        // Combat state
        this.attackState = 'idle';   // idle, primary, charged_charging, charged_attack, elbow
        this.attackTimer = 0;
        this.chargeTimer = 0;
        this.primaryCooldownTimer = 0;
        this.elbowCooldownTimer = 0;
        this.attackHitRegistered = false;

        // Dash state
        this.dashCharges = CONFIG.DASH_CHARGES;
        this.dashRechargeTimer = 0;
        this.dashing = false;
        this.dashTimer = 0;
        this.dashDirX = 0;
        this.dashDirZ = 0;
        this.dashInputConsumed = false;

        // Respawn
        this.respawnTimer = 0;

        // Stats
        this.kills = 0;
        this.deaths = 0;

        // Input sequence for client prediction
        this.lastProcessedInput = 0;
    }

    // Get eye position (for camera / raycast origin)
    getEyeY() {
        const baseY = this.y - (this.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2);
        return baseY + (this.crouching ? CONFIG.CAMERA_CROUCH_HEIGHT : CONFIG.CAMERA_HEIGHT);
    }

    // Get feet Y position
    getFeetY() {
        return this.y - (this.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2);
    }

    // Get forward direction vector (horizontal only)
    getForward() {
        return {
            x: -Math.sin(this.yaw),
            z: -Math.cos(this.yaw)
        };
    }

    // Get right direction vector
    getRight() {
        return {
            x: Math.cos(this.yaw),
            z: -Math.sin(this.yaw)
        };
    }

    // Serialize for network transmission
    serialize() {
        return {
            id: this.id,
            hp: this.hp,
            alive: this.alive,
            x: this.x,
            y: this.y,
            z: this.z,
            yaw: this.yaw,
            pitch: this.pitch,
            vx: this.vx,
            vy: this.vy,
            vz: this.vz,
            grounded: this.grounded,
            crouching: this.crouching,
            sliding: this.sliding,
            dashing: this.dashing,
            attackState: this.attackState,
            chargeTimer: this.chargeTimer,
            dashCharges: this.dashCharges,
            kills: this.kills,
            deaths: this.deaths,
            lastProcessedInput: this.lastProcessedInput,
        };
    }

    // Apply serialized state
    deserialize(data) {
        for (const key of Object.keys(data)) {
            if (key in this) {
                this[key] = data[key];
            }
        }
    }
}
