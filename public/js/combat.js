import { CONFIG } from './config.js?v=5';

// Process combat inputs and state transitions for a player
export function processCombat(player, input, dt) {
    if (!player.alive) return;

    // Tick cooldowns
    if (player.primaryCooldownTimer > 0) player.primaryCooldownTimer -= dt;
    if (player.elbowCooldownTimer > 0) player.elbowCooldownTimer -= dt;

    // State machine for attacks
    switch (player.attackState) {
        case 'idle':
            if (input.primaryAttack && player.primaryCooldownTimer <= 0) {
                player.attackState = 'primary';
                player.attackTimer = CONFIG.PRIMARY_DURATION;
                player.attackHitRegistered = false;
            } else if (input.chargedAttack) {
                player.attackState = 'charged_charging';
                player.chargeTimer = 0;
            } else if (input.elbow && player.elbowCooldownTimer <= 0) {
                player.attackState = 'elbow';
                player.attackTimer = CONFIG.ELBOW_DURATION;
                player.attackHitRegistered = false;
            }
            break;

        case 'primary':
            player.attackTimer -= dt;
            if (player.attackTimer <= 0) {
                player.attackState = 'idle';
                player.primaryCooldownTimer = CONFIG.PRIMARY_COOLDOWN;
            }
            break;

        case 'charged_charging':
            if (input.chargedAttack) {
                player.chargeTimer += dt;
            } else {
                // Released right click
                if (player.chargeTimer >= CONFIG.CHARGE_TIME) {
                    // Fully charged — execute attack
                    player.attackState = 'charged_attack';
                    player.attackTimer = CONFIG.CHARGED_DURATION;
                    player.attackHitRegistered = false;
                } else {
                    // Released too early — reset
                    player.attackState = 'idle';
                    player.chargeTimer = 0;
                }
            }
            break;

        case 'charged_attack':
            player.attackTimer -= dt;
            if (player.attackTimer <= 0) {
                player.attackState = 'idle';
                player.chargeTimer = 0;
            }
            break;

        case 'elbow':
            player.attackTimer -= dt;
            if (player.attackTimer <= 0) {
                player.attackState = 'idle';
                player.elbowCooldownTimer = CONFIG.ELBOW_COOLDOWN;
            }
            break;
    }
}

// Check if an attack from attacker hits target
// Returns { hit: boolean, damage: number, backstab: boolean }
export function checkAttackHit(attacker, target) {
    if (!attacker.alive || !target.alive) return { hit: false };
    if (attacker.attackHitRegistered) return { hit: false };

    let range = 0;
    let damage = 0;
    let isBackstab = false;

    switch (attacker.attackState) {
        case 'primary':
            range = CONFIG.PRIMARY_RANGE;
            damage = CONFIG.PRIMARY_DAMAGE;
            break;
        case 'charged_attack':
            range = CONFIG.CHARGED_RANGE;
            // Check if hitting the back
            if (isAttackFromBehind(attacker, target)) {
                damage = CONFIG.CHARGED_DAMAGE_BACK;
                isBackstab = true;
            } else {
                damage = CONFIG.CHARGED_DAMAGE_FRONT;
            }
            break;
        case 'elbow':
            range = CONFIG.ELBOW_RANGE;
            damage = CONFIG.ELBOW_DAMAGE;
            break;
        default:
            return { hit: false };
    }

    // Distance check (3D)
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const dz = target.z - attacker.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > range) return { hit: false };

    // Cone check — is target roughly in front of attacker's aim?
    const aimX = -Math.sin(attacker.yaw) * Math.cos(attacker.pitch);
    const aimY = Math.sin(attacker.pitch);
    const aimZ = -Math.cos(attacker.yaw) * Math.cos(attacker.pitch);

    const toDirX = dx / dist;
    const toDirY = dy / dist;
    const toDirZ = dz / dist;

    const dot = aimX * toDirX + aimY * toDirY + aimZ * toDirZ;

    // ~60 degree cone for melee attacks
    if (dot < 0.5) return { hit: false };

    return { hit: true, damage, backstab: isBackstab };
}

// Check if attacker is behind the target (for backstab detection)
function isAttackFromBehind(attacker, target) {
    // Target's facing direction (horizontal)
    const targetForward = target.getForward();

    // Direction from target to attacker
    const dx = attacker.x - target.x;
    const dz = attacker.z - target.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.01) return false;

    const toAttackerX = dx / dist;
    const toAttackerZ = dz / dist;

    // If attacker is behind target, the dot product of target's forward and direction-to-attacker is negative
    const dot = targetForward.x * toAttackerX + targetForward.z * toAttackerZ;
    return dot < -0.3; // Behind threshold
}

// Apply damage to a player, return true if killed
export function applyDamage(player, damage) {
    if (!player.alive) return false;
    player.hp -= damage;
    if (player.hp <= 0) {
        player.hp = 0;
        player.alive = false;
        return true;
    }
    return false;
}

// Respawn player at given position
export function respawnPlayer(player, spawnX, spawnZ) {
    player.hp = CONFIG.PLAYER_HP;
    player.alive = true;
    player.x = spawnX;
    player.y = CONFIG.PLAYER_HEIGHT / 2;
    player.z = spawnZ;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    player.attackState = 'idle';
    player.chargeTimer = 0;
    player.dashCharges = CONFIG.DASH_CHARGES;
    player.dashRechargeTimer = 0;
    player.dashing = false;
    player.sliding = false;
    player.crouching = false;
    player.respawnTimer = 0;
}
