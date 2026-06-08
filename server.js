import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
    SERVER_TICK_RATE: 60,
    NETWORK_SEND_RATE: 20,

    SPRINT_SPEED: 6.8,
    WALK_SPEED: 4.5,
    CROUCH_SPEED: 2.8,
    BACKWARD_SPEED: 3.8,
    SLIDE_INITIAL_SPEED: 13.0,
    SLIDE_MIN_SPEED: 3.5,
    SLIDE_DURATION: 1.1,
    SLIDE_COOLDOWN: 0.4,
    SLIDE_FRICTION: 2.17,
    SLIDE_JUMP_BOOST: 1.15,
    JUMP_VELOCITY: 5.4,
    GRAVITY: 18.0,
    AIR_CONTROL: 0.75,
    MAX_FALL_SPEED: 22.0,
    FAST_FALL_SPEED: 28.0,
    GROUND_FRICTION: 25.0,
    GROUND_ACCEL: 45.0,
    AIR_ACCEL: 18.0,

    MANTLE_REACH: 1.6,
    MANTLE_DURATION: 0.35,
    MANTLE_CHECK_DISTANCE: 0.7,
    MANTLE_FORWARD_BOOST: 2.0,

    PLAYER_HEIGHT: 1.35,
    PLAYER_CROUCH_HEIGHT: 0.75,
    PLAYER_RADIUS: 0.3,
    CAMERA_HEIGHT: 1.2,
    CAMERA_CROUCH_HEIGHT: 0.6,

    PRIMARY_DAMAGE: 60,
    PRIMARY_RANGE: 1.7,
    PRIMARY_DURATION: 0.3,
    PRIMARY_COOLDOWN: 0.4,

    CHARGED_DAMAGE_FRONT: 70,
    CHARGED_DAMAGE_BACK: 150,
    CHARGED_RANGE: 2.2,
    CHARGE_TIME: 0.7,
    CHARGED_DURATION: 0.65,

    ELBOW_DAMAGE: 40,
    ELBOW_RANGE: 1.3,
    ELBOW_DURATION: 0.2,
    ELBOW_COOLDOWN: 0.5,

    PLAYER_HP: 150,
    RESPAWN_TIME: 3.0,

    DASH_CHARGES: 3,
    DASH_COOLDOWN: 5.0,
    DASH_DISTANCE: 5.95,
    DASH_DURATION: 0.2833,
    DASH_SPEED: 21.0,

    ARENA_SIZE: 40.0,

    BUILDING_WIDTH: 14.0,
    BUILDING_DEPTH: 10.0,
    FLOOR_HEIGHT: 3.5,
    STEP_HEIGHT: 0.42,

    JUMP_PAD_LAUNCH_UP: 20.0,
    JUMP_PAD_LAUNCH_FORWARD: 5.0,
    JUMP_PAD_WALL_SPEED: 16.0,
    JUMP_PAD_WALL_UP: 18.0,
    JUMP_PAD_COOLDOWN: 10.0,
    JUMP_PAD_TRIGGER_RADIUS: 0.9,
    JUMP_PAD_RETRIGGER_DELAY: 3.0,

    GATEWAY_DURATION: 20.0,
    GATEWAY_COOLDOWN: 30.0,
    GATEWAY_INTERACT_RADIUS: 1.5,

    EXPLOSIVE_DAMAGE: 80,
    EXPLOSIVE_RADIUS: 4.0,
    EXPLOSIVE_BARREL_HP: 30,
    GOO_HEIGHT: 2.0,
    GOO_RADIUS: 1.5,
    GOO_DURATION: 30.0,
    GOO_BARREL_HP: 20,
};

const SPAWN_POINTS = [
    { x: -15, z: -15 },
    { x:  15, z:  15 },
    { x: -15, z:  15 },
    { x:  15, z: -15 },
];

// Selectable character colors (must match the client palette in main.js)
const PLAYER_COLORS = [
    '#22c55e', // green
    '#92400e', // brown
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#a855f7', // purple
    '#06b6d4', // cyan
    '#1e3a8a', // dark blue
    '#ec4899', // pink
    '#14b8a6', // teal
    '#84cc16', // lime
    '#e5e7eb', // white
];

// Picks the first palette color not already taken by another human player.
function firstFreeColor() {
    const taken = new Set(Array.from(players.values()).filter(p => !p.isBot && p.color).map(p => p.color));
    return PLAYER_COLORS.find(c => !taken.has(c)) || PLAYER_COLORS[0];
}

// Returns the spawn point furthest from all living enemies of excludeId.
function getBestSpawn(excludeId) {
    let best = SPAWN_POINTS[0];
    let bestDist = -1;
    for (const sp of SPAWN_POINTS) {
        let minEnemyDist = Infinity;
        for (const p of players.values()) {
            if (p.id === excludeId || !p.alive) continue;
            const dx = p.x - sp.x, dz = p.z - sp.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < minEnemyDist) minEnemyDist = d;
        }
        if (minEnemyDist > bestDist) {
            bestDist = minEnemyDist;
            best = sp;
        }
    }
    return best;
}

const COLLISION_BOXES = [];

function buildServerCollisionBoxes() {
    COLLISION_BOXES.length = 0;
    const bw = CONFIG.BUILDING_WIDTH;
    const bd = CONFIG.BUILDING_DEPTH;
    const fh = CONFIG.FLOOR_HEIGHT;
    const wallThick = 0.3;
    const floorThick = 0.25;
    const bx = -bw / 2;
    const bz = -bd / 2;

    function box(x, y, z, w, h, d, type, barrelType) {
        COLLISION_BOXES.push({ minX: x, minY: y, minZ: z, maxX: x + w, maxY: y + h, maxZ: z + d, type: type || 'wall', barrelType });
    }

    box(bx, 0, bz, 4.0, fh, wallThick);
    box(bx + 4.0, fh - 1.0, bz, 2.0, 1.0, wallThick);
    box(bx + 6.0, 0, bz, 2.0, fh, wallThick);
    box(bx + 8.0, fh - 1.0, bz, 2.0, 1.0, wallThick);
    box(bx + 10.0, 0, bz, 4.0, fh, wallThick);

    box(bx, 0, bz + bd - wallThick, 5.5, fh, wallThick);
    box(bx + 5.5, fh - 1.0, bz + bd - wallThick, 3.0, 1.0, wallThick);
    box(bx + 8.5, 0, bz + bd - wallThick, 5.5, fh, wallThick);

    box(bx, 0, bz + wallThick, wallThick, fh, bd - wallThick * 2);

    box(bx + bw - wallThick, 0, bz + wallThick, wallThick, 1.2, bd - wallThick * 2);
    box(bx + bw - wallThick, fh - 0.8, bz + wallThick, wallThick, 0.8, bd - wallThick * 2);
    box(bx + bw - wallThick, 1.2, bz + wallThick, wallThick, fh - 2.0, 0.5);
    box(bx + bw - wallThick, 1.2, bz + bd / 2 - 0.25, wallThick, fh - 2.0, 0.5);
    box(bx + bw - wallThick, 1.2, bz + bd - wallThick - 0.5, wallThick, fh - 2.0, 0.5);

    box(bx + wallThick, 0, bz + bd * 0.55, bw * 0.4, fh, wallThick);
    box(bx + bw * 0.4 + wallThick + 1.5, 0, bz + bd * 0.55, bw * 0.6 - wallThick - 1.5, fh, wallThick);
    box(bx + bw * 0.4 + wallThick, fh - 1.0, bz + bd * 0.55, 1.5, 1.0, wallThick);

    const stairWidth = 1.5, stairDepth = 3.0, numSteps = 10;
    const stepHeight = fh / numSteps, stepDepth = stairDepth / numSteps;
    const stairStartZ = bz + bd * 0.2;
    for (let i = 0; i < numSteps; i++) {
        box(bx + wallThick + 0.2, i * stepHeight, stairStartZ + i * stepDepth, stairWidth, stepHeight, stepDepth, 'stair_step');
    }

    box(bx, fh - floorThick, bz, bw, floorThick, bd * 0.18);
    box(bx + wallThick + stairWidth + 0.5, fh - floorThick, bz + bd * 0.18, bw - wallThick - stairWidth - 0.5, floorThick, stairDepth + 0.5);
    box(bx, fh - floorThick, bz + bd * 0.18 + stairDepth + 0.5, bw, floorThick, bd - bd * 0.18 - stairDepth - 0.5);

    box(bx, fh, bz, 3.0, fh, wallThick);
    box(bx + 3.0, fh + fh - 0.8, bz, 8.0, 0.8, wallThick);
    box(bx + 3.0, fh, bz, 8.0, 1.0, wallThick);
    box(bx + 11.0, fh, bz, 3.0, fh, wallThick);
    box(bx, fh, bz + bd - wallThick, bw, fh, wallThick);
    box(bx, fh, bz + wallThick, wallThick, fh, bd - wallThick * 2);
    box(bx + bw - wallThick, fh, bz + wallThick, wallThick, 1.2, bd - wallThick * 2);
    box(bx + bw - wallThick, fh + fh - 0.8, bz + wallThick, wallThick, 0.8, bd - wallThick * 2);
    box(bx + bw - wallThick, fh + 1.2, bz + bd / 2 - 0.25, wallThick, fh - 2.0, 0.5);
    box(bx + bw * 0.5, fh, bz + wallThick, wallThick, fh, bd * 0.4);
    box(bx + bw * 0.5, fh, bz + bd * 0.4 + wallThick + 1.2, wallThick, fh, bd * 0.6 - wallThick - 1.2);
    box(bx + bw * 0.5, fh + fh - 1.0, bz + bd * 0.4 + wallThick, wallThick, 1.0, 1.2);

    for (let i = 0; i < numSteps; i++) {
        box(bx + bw - wallThick - stairWidth - 0.2, fh + i * stepHeight, bz + bd - wallThick - stairDepth - 0.3 + i * stepDepth, stairWidth, stepHeight, stepDepth, 'stair_step');
    }

    box(bx, fh * 2 - floorThick, bz, bw - wallThick - stairWidth - 0.7, floorThick, bd);
    box(bx + bw - wallThick - stairWidth - 0.7, fh * 2 - floorThick, bz, stairWidth + 0.7 + wallThick, floorThick, bd - wallThick - stairDepth - 0.8);

    const parapetH = 1.0;
    box(bx, fh * 2, bz, bw, parapetH, wallThick);
    box(bx, fh * 2, bz + bd - wallThick, bw, parapetH, wallThick);
    box(bx, fh * 2, bz + wallThick, wallThick, parapetH, bd - wallThick * 2);
    box(bx + bw - wallThick, fh * 2, bz + wallThick, wallThick, parapetH, bd - wallThick * 2);

    box(bx + 2, fh * 2, bz + 2, 1.5, 1.2, 1.0);
    box(bx + bw - 4, fh * 2, bz + bd - 3, 2.0, 0.8, 1.5);

    box(-10, 0, -8, 2.0, 1.0, 0.4);
    box(10, 0, -8, 2.0, 1.0, 0.4);
    box(-10, 0, 8, 2.0, 1.0, 0.4);
    box(10, 0, 8, 2.0, 1.0, 0.4);
    box(-2, 0, -7, 3.0, 1.0, 0.4);
    box(2, 0, 7, 3.0, 1.0, 0.4);

    box(-14, 0, 0, 0.3, 1.6, 4.0);
    box(14, 0, 0, 0.3, 1.6, 4.0);
    box(0, 0, -14, 4.0, 1.6, 0.3);
    box(0, 0, 14, 4.0, 1.6, 0.3);

    box(-12, 0, -4, 1.0, 1.0, 1.0, 'crate');
    box(-12, 1.0, -4, 1.0, 1.0, 1.0, 'crate');
    box(12, 0, 4, 1.0, 1.0, 1.0, 'crate');
    box(12, 1.0, 4, 1.0, 1.0, 1.0, 'crate');
    box(-8, 0, 12, 1.2, 1.2, 1.2, 'crate');
    box(8, 0, -12, 1.2, 1.2, 1.2, 'crate');
    box(-5, 0, -12, 0.8, 0.8, 0.8, 'crate');
    box(5, 0, 12, 0.8, 0.8, 0.8, 'crate');

    const br = 0.35, bh = 0.9;
    [[-4,-9],[4,9],[-13,5],[13,-5],[bx+3,bz+bd*0.3],[bx+bw-2,bz+bd*0.7]].forEach(([x,z]) => {
        box(x - br, 0, z - br, br * 2, bh, br * 2, 'barrel', 'explosive');
    });
    [[-9,-2],[9,2],[0,12]].forEach(([x,z]) => {
        box(x - br, 0, z - br, br * 2, bh, br * 2, 'barrel', 'goo');
    });

    console.log(`[Server] Built ${COLLISION_BOXES.length} collision boxes`);
    buildServerDestructibles();
}

function serverCheckCollision(player, newX, newY, newZ) {
    const r = CONFIG.PLAYER_RADIUS;
    const halfH = player.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2;

    let resolvedX = newX;
    let resolvedY = newY;
    let resolvedZ = newZ;
    let groundHit = false;
    let ceilingHit = false;
    let wallHit = false;
    let wallHitX = false;
    let wallHitZ = false;
    let wallTopY = 0;

    if (resolvedY - halfH <= 0) {
        resolvedY = halfH;
        groundHit = true;
    }

    const half = CONFIG.ARENA_SIZE / 2;
    if (resolvedX - r < -half) { resolvedX = -half + r; wallHitX = true; }
    if (resolvedX + r > half) { resolvedX = half - r; wallHitX = true; }
    if (resolvedZ - r < -half) { resolvedZ = -half + r; wallHitZ = true; }
    if (resolvedZ + r > half) { resolvedZ = half - r; wallHitZ = true; }

    for (const box of COLLISION_BOXES) {
        const pMX = resolvedX - r;
        const pPX = resolvedX + r;
        const pMY = resolvedY - halfH;
        const pPY = resolvedY + halfH;
        const pMZ = resolvedZ - r;
        const pPZ = resolvedZ + r;

        if (pPX <= box.minX || pMX >= box.maxX) continue;
        if (pPZ <= box.minZ || pMZ >= box.maxZ) continue;

        // Swept-Y: catch fast-moving players (e.g. jump pad) passing through thin floors in one tick
        const prevFeetY = player.y - halfH;
        const prevHeadY = player.y + halfH;
        if (player.vy < 0 && prevFeetY >= box.maxY && pMY < box.maxY) {
            // Feet swept downward through box top — land on top
            if (resolvedY > box.maxY + halfH || !groundHit) {
                resolvedY = box.maxY + halfH;
                groundHit = true;
            }
            continue;
        }
        if (player.vy > 0 && prevHeadY <= box.minY && pPY > box.minY) {
            // Head swept upward through box bottom — ceiling hit
            resolvedY = box.minY - halfH;
            ceilingHit = true;
            continue;
        }

        if (pPY <= box.minY || pMY > box.maxY) continue;

        if (box.type === 'stair_step') {
            const stepTop = box.maxY;
            const playerFeetY = resolvedY - halfH;
            if (stepTop > playerFeetY &&
                stepTop <= newY - halfH + CONFIG.STEP_HEIGHT &&
                player.vy <= 0) {
                resolvedY = stepTop + halfH;
                groundHit = true;
            }
            continue;
        }

        const overlapLeft = pPX - box.minX;
        const overlapRight = box.maxX - pMX;
        const overlapBottom = pPY - box.minY;
        const overlapTop = box.maxY - pMY;
        const overlapFront = pPZ - box.minZ;
        const overlapBack = box.maxZ - pMZ;

        const minOverlap = Math.min(overlapLeft, overlapRight, overlapBottom, overlapTop, overlapFront, overlapBack);

        if (minOverlap === overlapBottom && player.vy <= 0) {
            resolvedY = box.maxY + halfH;
            groundHit = true;
        } else if (minOverlap === overlapBottom && player.vy > 0) {
            resolvedY = box.minY - halfH;
            ceilingHit = true;
        } else if (minOverlap === overlapTop && resolvedY < box.minY) {
            // Hitting the underside of a box from below (deep penetration)
            resolvedY = box.minY - halfH;
            ceilingHit = true;
        } else if (minOverlap === overlapTop) {
            // Landing on / sinking through the top surface — snap onto box
            resolvedY = box.maxY + halfH;
            groundHit = true;
        } else if (minOverlap === overlapLeft) {
            resolvedX = box.minX - r;
            wallHit = true; wallHitX = true;
            wallTopY = box.maxY;
        } else if (minOverlap === overlapRight) {
            resolvedX = box.maxX + r;
            wallHit = true; wallHitX = true;
            wallTopY = box.maxY;
        } else if (minOverlap === overlapFront) {
            resolvedZ = box.minZ - r;
            wallHit = true; wallHitZ = true;
            wallTopY = box.maxY;
        } else if (minOverlap === overlapBack) {
            resolvedZ = box.maxZ + r;
            wallHit = true; wallHitZ = true;
            wallTopY = box.maxY;
        }
    }

    return { x: resolvedX, y: resolvedY, z: resolvedZ, groundHit, ceilingHit, wallHit, wallHitX, wallHitZ, wallTopY };
}

class ServerPlayer {
    constructor(id) {
        this.id = id;
        this.x = 0; this.y = 0; this.z = 0;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.yaw = 0; this.pitch = 0;
        this.grounded = false;
        this.crouching = false;
        this.sliding = false;
        this.slideTime = 0;
        this.dashing = false;
        this.dashTime = 0;
        this.dashCharges = CONFIG.DASH_CHARGES;
        this.dashRechargeTimer = 0;
        this.dashInputConsumed = false;
        this.mantling = false;
        this.mantleTime = 0;
        this.mantleStartX = 0;
        this.mantleStartY = 0;
        this.mantleStartZ = 0;
        this.mantleTargetX = 0;
        this.mantleTargetY = 0;
        this.mantleTargetZ = 0;

        this.hp = CONFIG.PLAYER_HP;
        this.alive = true;
        this.respawnTimer = 0;
        this.kills = 0;
        this.deaths = 0;

        this.attackState = 'idle';
        this.attackTime = 0;
        this.chargeTimer = 0;
        this.elbowCooldown = 0;
        this.primaryCooldown = 0;
        this.attackHitRegistered = false;

        this.regenTimer = 0;
        this.ready = false;
        this.color = null; // chosen lobby color (hex string e.g. '#22c55e')
        this.ws = null;

        this.lastInput = null;
        this.lastProcessedInput = 0;
        this.respawnProtect = 0; // ticks to ignore client-reported position after respawn

        this.carriedObjectId = null;
        this.jumpPadCooldown = 0;

        this.gatewayCooldown = 0;  // seconds until player can throw gateways again
        this.gatewayCount = 0;     // 0=none, 1=one placed, 2=both placed

        this.isBot = false;
        this.botAI = null;
    }

    serialize() {
        return {
            id: this.id, hp: this.hp, alive: this.alive,
            x: this.x, y: this.y, z: this.z,
            yaw: this.yaw, pitch: this.pitch,
            vx: this.vx, vy: this.vy, vz: this.vz,
            grounded: this.grounded, crouching: this.crouching,
            sliding: this.sliding, dashing: this.dashing,
            mantling: this.mantling,
            attackState: this.attackState, chargeTimer: this.chargeTimer,
            dashCharges: this.dashCharges,
            dashRechargeTimer: this.dashRechargeTimer,
            kills: this.kills, deaths: this.deaths,
            respawnTimer: this.respawnTimer,
            lastProcessedInput: this.lastProcessedInput,
            regenActive: this.regenTimer >= 5.0 && this.hp < CONFIG.PLAYER_HP,
            carriedObjectId: this.carriedObjectId,
            gatewayCooldown: this.gatewayCooldown,
            gatewayCount: this.gatewayCount,
            color: this.color,
        };
    }
}

const destructibles = [];

function buildServerDestructibles() {
    destructibles.length = 0;
    let id = 0;
    for (let i = 0; i < COLLISION_BOXES.length; i++) {
        const box = COLLISION_BOXES[i];
        if (box.type === 'crate' || box.type === 'barrel') {
            destructibles.push({
                id: id++,
                type: box.barrelType || 'crate',
                hp: box.barrelType === 'explosive' ? CONFIG.EXPLOSIVE_BARREL_HP :
                    box.barrelType === 'goo' ? CONFIG.GOO_BARREL_HP : 50,
                alive: true,
                collisionIndex: i,
                x: (box.minX + box.maxX) / 2,
                y: (box.minY + box.maxY) / 2,
                z: (box.minZ + box.maxZ) / 2,
            });
        }
    }
    console.log(`[Server] Registered ${destructibles.length} destructibles`);
}
// Note: buildServerDestructibles() is called inside buildServerCollisionBoxes(), after boxes are built.

function damageDestructible(destId, damage) {
    const dest = destructibles[destId];
    if (!dest || !dest.alive) return;

    dest.hp -= damage;
    if (dest.hp <= 0) {
        dest.alive = false;
        const box = COLLISION_BOXES[dest.collisionIndex];
        if (box) {
            box.minX = 0; box.maxX = 0;
            box.minY = 0; box.maxY = 0;
            box.minZ = 0; box.maxZ = 0;
        }

        if (dest.type === 'explosive') {
            broadcast({ type: 'destruction', action: 'explode', id: destId, x: dest.x, y: dest.y, z: dest.z });
            applyExplosion(dest.x, dest.y, dest.z);
        } else if (dest.type === 'goo') {
            broadcast({ type: 'destruction', action: 'goo', id: destId, x: dest.x, y: 0, z: dest.z });
            COLLISION_BOXES.push({
                minX: dest.x - CONFIG.GOO_RADIUS,
                minY: 0,
                minZ: dest.z - CONFIG.GOO_RADIUS,
                maxX: dest.x + CONFIG.GOO_RADIUS,
                maxY: CONFIG.GOO_HEIGHT,
                maxZ: dest.z + CONFIG.GOO_RADIUS,
                type: 'goo',
                expireAt: Date.now() + CONFIG.GOO_DURATION * 1000,
            });
        } else {
            broadcast({ type: 'destruction', action: 'destroy', id: destId, x: dest.x, y: dest.y, z: dest.z });
        }
    }
}

function applyExplosion(ex, ey, ez) {
    const r = CONFIG.EXPLOSIVE_RADIUS;
    for (const player of players.values()) {
        if (!player.alive) continue;
        const dx = player.x - ex;
        const dy = player.y - ey;
        const dz = player.z - ez;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < r) {
            const falloff = 1 - dist / r;
            const dmg = Math.round(CONFIG.EXPLOSIVE_DAMAGE * falloff);
            player.hp -= dmg;
            player.regenTimer = 0;
            if (player.hp <= 0) {
                player.hp = 0;
                player.alive = false;
                player.respawnTimer = CONFIG.RESPAWN_TIME;
                player.deaths++;
                broadcast({ type: 'kill_feed', killerId: -1, killerDisplayId: -1, victimId: player.id, victimDisplayId: getDisplayId(player.id), weapon: 'explosion' });
            }
        }
    }

    for (const dest of destructibles) {
        if (!dest.alive) continue;
        const dx = dest.x - ex;
        const dy = dest.y - ey;
        const dz = dest.z - ez;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < r) {
            damageDestructible(dest.id, CONFIG.EXPLOSIVE_DAMAGE * 0.5);
        }
    }
}

const thrownObjects = new Map();
let thrownIdCounter = 0;

function applyExplosionAt(ex, ey, ez, maxDamage) {
    const r = CONFIG.EXPLOSIVE_RADIUS;
    for (const player of players.values()) {
        if (!player.alive) continue;
        const dx = player.x - ex;
        const dy = player.y - ey;
        const dz = player.z - ez;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < r) {
            const falloff = 1 - dist / r;
            const dmg = Math.round(maxDamage * falloff);
            player.hp -= dmg;
            player.regenTimer = 0;
            if (player.hp <= 0) {
                player.hp = 0;
                player.alive = false;
                player.respawnTimer = CONFIG.RESPAWN_TIME;
                player.deaths++;
                broadcast({ type: 'kill_feed', killerId: -1, killerDisplayId: -1, victimId: player.id, victimDisplayId: getDisplayId(player.id), weapon: 'explosion' });
            }
        }
    }
}

function thrownHitPlayer(thrown, target) {
    thrownObjects.delete(thrown.id);
    const dest = destructibles[thrown.destId];
    if (dest) { dest.alive = false; dest.carriedBy = null; }

    if (thrown.objType === 'explosive') {
        target.hp -= 100;
        target.regenTimer = 0;
        if (target.hp <= 0) {
            target.hp = 0; target.alive = false;
            target.respawnTimer = CONFIG.RESPAWN_TIME; target.deaths++;
            broadcast({ type: 'kill_feed', killerId: thrown.ownerId, killerDisplayId: getDisplayId(thrown.ownerId), victimId: target.id, victimDisplayId: getDisplayId(target.id), weapon: 'explosion' });
        }
        applyExplosionAt(thrown.x, thrown.y, thrown.z, 50);
        broadcast({ type: 'object_landed', id: thrown.id, action: 'explode', x: thrown.x, y: thrown.y, z: thrown.z });
    } else if (thrown.objType === 'goo') {
        createGooWall(thrown.x, thrown.y, thrown.z, 0, 1, 0);
        broadcast({ type: 'object_landed', id: thrown.id, action: 'goo_wall', x: thrown.x, y: thrown.y, z: thrown.z, nx: 0, ny: 1, nz: 0 });
    } else {
        target.hp -= 50;
        target.regenTimer = 0;
        if (target.hp <= 0) {
            target.hp = 0; target.alive = false;
            target.respawnTimer = CONFIG.RESPAWN_TIME; target.deaths++;
            broadcast({ type: 'kill_feed', killerId: thrown.ownerId, killerDisplayId: getDisplayId(thrown.ownerId), victimId: target.id, victimDisplayId: getDisplayId(target.id), weapon: 'explosion' });
        }
        broadcast({ type: 'object_landed', id: thrown.id, action: 'destroy', x: thrown.x, y: thrown.y, z: thrown.z });
    }
}

function thrownHitSurface(thrown, nx, ny, nz) {
    thrownObjects.delete(thrown.id);
    const dest = destructibles[thrown.destId];
    if (dest) { dest.alive = false; dest.carriedBy = null; }

    if (thrown.objType === 'explosive') {
        applyExplosionAt(thrown.x, thrown.y, thrown.z, 50);
        broadcast({ type: 'object_landed', id: thrown.id, action: 'explode', x: thrown.x, y: thrown.y, z: thrown.z });
    } else if (thrown.objType === 'goo') {
        createGooWall(thrown.x, thrown.y, thrown.z, nx, ny, nz);
        broadcast({ type: 'object_landed', id: thrown.id, action: 'goo_wall', x: thrown.x, y: thrown.y, z: thrown.z, nx, ny, nz });
    } else {
        broadcast({ type: 'object_landed', id: thrown.id, action: 'destroy', x: thrown.x, y: thrown.y, z: thrown.z });
    }
}

function createGooWall(x, y, z, nx, ny, nz) {
    const H = CONFIG.PLAYER_HEIGHT;
    const W = 3 * CONFIG.PLAYER_RADIUS * 2;
    const D = 0.5;

    let minX, maxX, minY, maxY, minZ, maxZ;

    if (Math.abs(ny) > 0.7) {
        minX = x - W / 2; maxX = x + W / 2;
        minY = y;          maxY = y + H;
        minZ = z - D / 2;  maxZ = z + D / 2;
    } else if (Math.abs(nx) > Math.abs(nz)) {
        minX = x - D / 2;  maxX = x + D / 2;
        minY = y - H / 2;  maxY = y + H / 2;
        minZ = z - W / 2;  maxZ = z + W / 2;
    } else {
        minX = x - W / 2;  maxX = x + W / 2;
        minY = y - H / 2;  maxY = y + H / 2;
        minZ = z - D / 2;  maxZ = z + D / 2;
    }

    COLLISION_BOXES.push({ minX, minY, minZ, maxX, maxY, maxZ, type: 'goo_wall' });

    setTimeout(() => {
        for (let i = COLLISION_BOXES.length - 1; i >= 0; i--) {
            const b = COLLISION_BOXES[i];
            if (b.type === 'goo' && Math.abs(b.minX - minX) < 0.01 && Math.abs(b.minY - minY) < 0.01 && Math.abs(b.minZ - minZ) < 0.01) {
                b.minX = 0; b.maxX = 0;
                b.minY = 0; b.maxY = 0;
                b.minZ = 0; b.maxZ = 0;
                break;
            }
        }
    }, 30000);
}


// ─── Bot AI ───────────────────────────────────────────────────────────────────

function botPickupObject(botId) {
    const player = players.get(botId);
    if (!player || !player.alive || player.carriedObjectId !== null) return;
    let nearest = null, nearestDist = 5.0;
    for (const dest of destructibles) {
        if (!dest.alive || dest.carriedBy != null) continue;
        const dx = dest.x - player.x, dz = dest.z - player.z;
        const dy = Math.abs(dest.y - player.y);
        const hd = Math.sqrt(dx * dx + dz * dz);
        if (hd < nearestDist && dy < 3.0) { nearestDist = hd; nearest = dest; }
    }
    if (!nearest) return;
    const box = COLLISION_BOXES[nearest.collisionIndex];
    if (box) {
        nearest._savedBox = { minX: box.minX, minY: box.minY, minZ: box.minZ, maxX: box.maxX, maxY: box.maxY, maxZ: box.maxZ };
        box.minX = 0; box.maxX = 0; box.minY = 0; box.maxY = 0; box.minZ = 0; box.maxZ = 0;
    }
    nearest.carriedBy = botId;
    player.carriedObjectId = nearest.id;
    broadcast({ type: 'object_picked_up', destId: nearest.id, playerId: botId });
}

function botThrowObject(botId) {
    const player = players.get(botId);
    if (!player || !player.alive || player.carriedObjectId === null) return;
    const dest = destructibles[player.carriedObjectId];
    if (!dest) { player.carriedObjectId = null; return; }
    dest.carriedBy = null;
    player.carriedObjectId = null;
    const cosP = Math.cos(player.pitch);
    const vx = -Math.sin(player.yaw) * cosP * 18;
    const vy = Math.sin(player.pitch) * 18 + 3;
    const vz = -Math.cos(player.yaw) * cosP * 18;
    const startX = player.x - Math.sin(player.yaw) * 0.8;
    const startY = player.y + CONFIG.PLAYER_HEIGHT / 2 - 0.3;
    const startZ = player.z - Math.cos(player.yaw) * 0.8;
    const thrownId = ++thrownIdCounter;
    thrownObjects.set(thrownId, { id: thrownId, objType: dest.type, destId: dest.id, ownerId: botId, x: startX, y: startY, z: startZ, vx, vy, vz });
    broadcast({ type: 'object_thrown', id: thrownId, objType: dest.type, destId: dest.id, x: startX, y: startY, z: startZ, vx, vy, vz, ownerId: botId });
}

function botPlaceJumpPad(botId) {
    const player = players.get(botId);
    if (!player || !player.alive || player.jumpPadCooldown > 0) return null;
    if (JUMP_PADS.has(botId)) {
        const old = JUMP_PADS.get(botId);
        broadcast({ type: 'jumppad_removed', id: old.id });
        JUMP_PADS.delete(botId);
    }
    const pad = {
        id: ++jumpPadIdCounter, ownerId: botId,
        x: player.x, y: player.y - CONFIG.PLAYER_HEIGHT / 2, z: player.z,
        nx: 0, ny: 1, nz: 0, triggerCooldowns: new Map(),
    };
    JUMP_PADS.set(botId, pad);
    player.jumpPadCooldown = CONFIG.JUMP_PAD_COOLDOWN;
    broadcast({ type: 'jumppad_placed', id: pad.id, ownerId: botId, x: pad.x, y: pad.y, z: pad.z, nx: 0, ny: 1, nz: 0 });
    return pad;
}

// Nav waypoints for floor-aware routing through the building's staircases and doors
const BOT_NAV = {
    // Ground-floor door approaches
    frontDoorLeft:      { x: -2.0, z: -4.3 },
    frontDoorRight:     { x:  2.0, z: -4.3 },
    interiorDoor:       { x: -0.4, z:  0.8 },
    backDoor:           { x:  0.0, z:  4.3 },
    // Staircase routing
    groundStairBot:     { x: -5.5, z: -2.0 },
    upperStairBot:      { x:  5.5, z:  2.5 },
    // Window / parapet exit — bot aims here then jumps to mantle out
    // Works for both upper-floor front window (sill at y≈4.5) and roof parapet (y≈8.0)
    exitBuildingFront:  { x:  0.0, z: -4.8, jump: true },
};

class BotAI {
    constructor(bot) {
        this.bot = bot;
        this.reset();
    }

    reset() {
        this.fsm = 'approach';
        this.timer = 0;
        this.passiveNext = 8 + Math.random() * 12;
        this.dashBehindTarget = null;
        this.dashFired = false;
        this.comboPhase = 0;
        this.comboTimer = 0;
        this.stuckTimer = 0;
        this.stuckCheckTimer = 0;
        this.lastCheckPos = { x: this.bot.x, z: this.bot.z };
        this.jumpCooldown = 0;
        this.pickupTarget = null;
        this.padActive = false;
        this.padPos = null;
        this.throwTimer = 0;
        this.stuckStrafeDir = 1;
        this.stuckStrafeTimer = 0;
        this.dodgeCooldown = 0;
        this.dodgedThisEngagement = false;  // only dodge once per engagement
        this.stabWasBackstab = false;       // was the last charged attack from behind?
        this.aerialPhase = null;
        this.navQueue = [];  // ordered list of waypoints to walk through
        this.barrelTarget = null;   // explosive barrel being aimed at for a shot
        this.coverPos = null;       // cover position to navigate to while kiting
        this.gooGoal = false;       // true when carrying a goo barrel to throw as cover
    }

    idleInput() {
        return { forward: false, backward: false, left: false, right: false, jump: false, crouch: false, dash: false, primaryAttack: false, chargedAttack: false, elbow: false, mouseDeltaX: 0, mouseDeltaY: 0 };
    }

    // Returns the yaw needed for bot to face toward (tx, tz)
    faceToward(tx, tz) {
        return Math.atan2(this.bot.x - tx, this.bot.z - tz);
    }

    smoothAim(targetYaw, dt) {
        let diff = targetYaw - this.bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxTurn = 6.5 * dt;
        this.bot.yaw += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
    }

    findNearbyCarriable() {
        const bot = this.bot;
        let nearest = null, nearestDist = 7.0;
        for (const dest of destructibles) {
            if (!dest.alive || dest.carriedBy != null) continue;
            const dx = dest.x - bot.x, dz = dest.z - bot.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) { nearestDist = d; nearest = dest; }
        }
        return nearest;
    }

    // Returns nearest explosive barrel within 7m of bot (prioritised for carrying/throwing)
    findNearbyExplosiveBarrel() {
        const bot = this.bot;
        let nearest = null, nearestDist = 7.0;
        for (const dest of destructibles) {
            if (!dest.alive || dest.type !== 'explosive' || dest.carriedBy != null) continue;
            const dx = dest.x - bot.x, dz = dest.z - bot.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) { nearestDist = d; nearest = dest; }
        }
        return nearest;
    }

    // Returns an explosive barrel near the target that would deal lethal damage if triggered
    findLethalExplosiveNearTarget(target) {
        for (const dest of destructibles) {
            if (!dest.alive || dest.type !== 'explosive' || dest.carriedBy != null) continue;
            const dx = dest.x - target.x, dz = dest.z - target.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < CONFIG.EXPLOSIVE_RADIUS) {
                const dmg = Math.round((1 - dist / CONFIG.EXPLOSIVE_RADIUS) * CONFIG.EXPLOSIVE_DAMAGE);
                if (dmg >= target.hp) return dest;
            }
        }
        return null;
    }

    // Returns nearest alive goo barrel within 8m of bot
    findGooBarrelNearBot() {
        const bot = this.bot;
        let nearest = null, nearestDist = 8.0;
        for (const dest of destructibles) {
            if (!dest.alive || dest.type !== 'goo' || dest.carriedBy != null) continue;
            const dx = dest.x - bot.x, dz = dest.z - bot.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) { nearestDist = d; nearest = dest; }
        }
        return nearest;
    }

    // Plan a route through building doors/windows when walls block the direct path.
    // Returns an ordered array of BOT_NAV waypoints, or null if no routing needed.
    planRoute(bot, target) {
        const FH = CONFIG.FLOOR_HEIGHT; // 3.5

        // ── Upper floor → enemy is outside at ground level: exit through front window ──
        if (bot.y > FH - 0.3 && bot.y < FH * 2 - 0.3 && target.y < FH - 0.3) {
            // Only if target is outside the building (not just on the ground floor inside)
            const BZ_FRONT = -4.7, BZ_BACK = 4.7;
            if (target.z < BZ_FRONT || target.z > BZ_BACK) {
                return [BOT_NAV.exitBuildingFront];
            }
        }

        // ── Roof → enemy not on roof: mantle off front parapet ──
        if (bot.y >= FH * 2 - 0.3 && target.y < FH * 2 - 0.3) {
            return [BOT_NAV.exitBuildingFront];
        }

        // Ground-floor only below this point
        if (bot.y > FH - 0.3 || target.y > FH - 0.3) return null;

        // Building X bounds — if both are well outside, no walls to worry about
        const BX0 = -6.5, BX1 = 6.5;
        if (Math.min(bot.x, target.x) > BX1 + 2 || Math.max(bot.x, target.x) < BX0 - 2) return null;

        const FRONT_Z  = -4.7;   // inside edge of front wall
        const BACK_Z   =  4.7;   // inside edge of back wall
        const INT_Z    =  0.8;   // past interior dividing wall

        const bFront = bot.z    < FRONT_Z;
        const bBack  = bot.z    > BACK_Z;
        const bNear  = !bFront && !bBack && bot.z    < INT_Z;  // inside, front half
        const bFar   = !bFront && !bBack && bot.z   >= INT_Z;  // inside, back half

        const tFront = target.z < FRONT_Z;
        const tBack  = target.z > BACK_Z;
        const tNear  = !tFront && !tBack && target.z < INT_Z;
        const tFar   = !tFront && !tBack && target.z >= INT_Z;

        // Already same zone — no routing needed
        if ((bFront && tFront) || (bBack && tBack) ||
            (bNear  && tNear ) || (bFar  && tFar )) return null;

        // Pick the front door closest to whoever is near the front
        const refX = (bFront || bNear) ? bot.x : target.x;
        const frontDoor = Math.abs(refX - BOT_NAV.frontDoorLeft.x) <= Math.abs(refX - BOT_NAV.frontDoorRight.x)
            ? BOT_NAV.frontDoorLeft : BOT_NAV.frontDoorRight;

        if (bFront) {
            // Outside front → inside near half
            if (tNear)  return [frontDoor];
            // Outside front → inside far half or outside back
            if (tFar)   return [frontDoor, BOT_NAV.interiorDoor];
            if (tBack)  return [frontDoor, BOT_NAV.interiorDoor, BOT_NAV.backDoor];
        }
        if (bBack) {
            // Outside back → inside far half
            if (tFar)   return [BOT_NAV.backDoor];
            // Outside back → inside near half or outside front
            if (tNear)  return [BOT_NAV.backDoor, BOT_NAV.interiorDoor];
            if (tFront) return [BOT_NAV.backDoor, BOT_NAV.interiorDoor, frontDoor];
        }
        if (bNear) {
            // Inside front half → across interior wall
            if (tFar)   return [BOT_NAV.interiorDoor];
            if (tBack)  return [BOT_NAV.interiorDoor, BOT_NAV.backDoor];
            if (tFront) return [frontDoor];
        }
        if (bFar) {
            // Inside back half → across interior wall
            if (tNear)  return [BOT_NAV.interiorDoor];
            if (tFront) return [BOT_NAV.interiorDoor, frontDoor];
            if (tBack)  return [BOT_NAV.backDoor];
        }
        return null;
    }

    // Returns a position behind the nearest cover object (crate/barrel) relative to the player
    findCoverPosition(target) {
        const bot = this.bot;
        let nearest = null, nearestDist = 6.0;
        for (const dest of destructibles) {
            if (!dest.alive || dest.carriedBy != null) continue;
            const dx = dest.x - bot.x, dz = dest.z - bot.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < nearestDist) { nearestDist = d; nearest = dest; }
        }
        if (!nearest) return null;
        // Compute direction from player to cover object, step 1.5m behind it
        const toCoverX = nearest.x - target.x, toCoverZ = nearest.z - target.z;
        const len = Math.sqrt(toCoverX * toCoverX + toCoverZ * toCoverZ) || 1;
        return { x: nearest.x + (toCoverX / len) * 1.5, z: nearest.z + (toCoverZ / len) * 1.5 };
    }

    update(dt, players) {
        const bot = this.bot;

        // Find the closest alive enemy (any player that isn't this bot)
        let target = null;
        let targetDist = Infinity;
        for (const p of players.values()) {
            if (p.id === bot.id || !p.alive) continue;
            const dx = p.x - bot.x, dz = p.z - bot.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < targetDist) { target = p; targetDist = dist; }
        }
        if (!target) return this.idleInput();

        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const distH = Math.sqrt(dx * dx + dz * dz);
        const hpFraction = bot.hp / CONFIG.PLAYER_HP;
        const isAggressive = hpFraction > 0.55;
        const isDefensive = hpFraction < 0.30;
        const toTargetYaw = this.faceToward(target.x, target.z);

        // Mutual-facing check (required for flickstab trigger)
        const botFwdX = -Math.sin(bot.yaw), botFwdZ = -Math.cos(bot.yaw);
        const toDX = distH > 0.01 ? dx / distH : 0, toDZ = distH > 0.01 ? dz / distH : 0;
        const botFacingPlayer = botFwdX * toDX + botFwdZ * toDZ > 0.65;
        const playerFwdX = -Math.sin(target.yaw), playerFwdZ = -Math.cos(target.yaw);
        const playerFacingBotDot = playerFwdX * (-toDX) + playerFwdZ * (-toDZ);
        const playerFacingBot = playerFacingBotDot > 0.45;
        const playerBackExposed = playerFacingBotDot < -0.5; // player clearly facing away
        const mutualFacing = botFacingPlayer && playerFacingBot;

        this.passiveNext -= dt;
        if (this.jumpCooldown > 0) this.jumpCooldown -= dt;
        if (this.throwTimer > 0) this.throwTimer -= dt;
        if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;

        // Stuck detection (check every 0.5s)
        this.stuckCheckTimer += dt;
        if (this.stuckCheckTimer >= 0.5) {
            this.stuckCheckTimer = 0;
            const moved = Math.sqrt((bot.x - this.lastCheckPos.x) ** 2 + (bot.z - this.lastCheckPos.z) ** 2);
            if (moved < 0.25 && (this.fsm === 'approach' || this.fsm === 'pickup') && distH > 1.5) {
                this.stuckTimer += 0.5;
            } else {
                this.stuckTimer = Math.max(0, this.stuckTimer - 0.5);
            }
            this.lastCheckPos = { x: bot.x, z: bot.z };
        }

        let input = this.idleInput();

        // Backstab dodge: only once per engagement — dash sideways when player charges close
        if (target.attackState === 'charged_charging' && distH < 4.5 &&
            bot.dashCharges >= 2 && !bot.dashing && !this.dodgedThisEngagement &&
            this.fsm !== 'flickstab_dash' && this.fsm !== 'flickstab_release' && this.fsm !== 'aerial_attack') {
            const dodgeDir = Math.random() < 0.5 ? 1 : -1;
            bot.yaw = toTargetYaw + (Math.PI / 2) * dodgeDir;
            this.dodgedThisEngagement = true;  // no more dodges this engagement
            this.fsm = 'approach';
            return { ...this.idleInput(), dash: true, chargedAttack: true };
        }

        // Auto-throw carried object when in range and not busy with flickstab
        if (bot.carriedObjectId !== null && distH < 8.0 && this.throwTimer <= 0 &&
            this.fsm !== 'flickstab_charge' && this.fsm !== 'flickstab_dash' && this.fsm !== 'flickstab_release') {
            if (this.gooGoal) {
                // Throw goo barrel BEHIND the bot to create a cover wall between bot and player
                bot.yaw = toTargetYaw + Math.PI;  // face away from player
                bot.pitch = 0.2;                  // slight upward arc
                botThrowObject(bot.id);
                this.gooGoal = false;
                this.throwTimer = 1.0;
            } else {
                // Throw toward player (normal carry)
                const pitchToTarget = Math.atan2(target.y - bot.y, distH) + 0.15;
                this.smoothAim(toTargetYaw, dt);
                bot.pitch = Math.max(-0.4, Math.min(0.7, pitchToTarget));
                botThrowObject(bot.id);
                this.throwTimer = 1.0;
            }
        }

        switch (this.fsm) {

            case 'approach': {
                // Always pre-charge so the flickstab fires instantly on trigger
                input.chargedAttack = true;

                // ── Waypoint-queue routing ────────────────────────────────────────
                // Populate queue when empty: vertical (stairs/roof) takes priority,
                // then horizontal door routing, then direct approach.
                if (this.navQueue.length === 0) {
                    const needsStairs = (target.y - bot.y) > 2.5 && bot.y < 3.5;
                    const needsRoof   = (target.y - bot.y) > 6.0 && bot.y > 2.5 && bot.y < 6.5;
                    if (needsStairs) {
                        this.navQueue = [BOT_NAV.frontDoorLeft, BOT_NAV.groundStairBot];
                    } else if (needsRoof) {
                        this.navQueue = [BOT_NAV.upperStairBot];
                    } else {
                        const route = this.planRoute(bot, target);
                        if (route) this.navQueue = route;
                    }
                }

                // Advance queue when current waypoint is reached
                if (this.navQueue.length > 0) {
                    const wp = this.navQueue[0];
                    const wdx = wp.x - bot.x, wdz = wp.z - bot.z;
                    const wpDistH = Math.sqrt(wdx * wdx + wdz * wdz);

                    if (wp.jump) {
                        // Exit waypoint: clear only once the bot has actually left the building
                        // (z past the front wall, or dropped back to ground level)
                        const FH = CONFIG.FLOOR_HEIGHT;
                        if (bot.z < -5.3 || (bot.y < FH - 0.5 && bot.z < -3.0)) {
                            this.navQueue.shift();
                        }
                        // Commit jump early — start jumping 3.5m before the wall
                        if (wpDistH < 3.5 && bot.grounded && this.jumpCooldown <= 0) {
                            input.jump = true;
                            this.jumpCooldown = 0.4;
                        }
                    } else {
                        if (wpDistH < 1.8) this.navQueue.shift();
                    }
                }

                // Clear stair waypoints once bot is on the same floor as target
                if (this.navQueue.length > 0 && Math.abs(bot.y - target.y) < 2.0) {
                    if (this.navQueue[0] === BOT_NAV.groundStairBot ||
                        this.navQueue[0] === BOT_NAV.upperStairBot) {
                        this.navQueue = [];
                    }
                }

                const aimTarget = this.navQueue.length > 0
                    ? { x: this.navQueue[0].x, z: this.navQueue[0].z }
                    : { x: target.x, z: target.z };
                this.smoothAim(this.faceToward(aimTarget.x, aimTarget.z), dt);
                if (distH > 2.5) input.forward = true;

                // ── Corner stuck: reroute through nearest door ───────────────────
                // Check this BEFORE the jump/strafe unstick so stuckTimer isn't zeroed prematurely
                if (this.stuckTimer >= 1.5) {
                    const FH = CONFIG.FLOOR_HEIGHT;
                    const inBuilding = bot.x > -7.0 && bot.x < 7.0 &&
                                       bot.z > -5.2 && bot.z < 5.2 &&
                                       bot.y < FH * 2;
                    if (inBuilding) {
                        const doors = [BOT_NAV.frontDoorLeft, BOT_NAV.frontDoorRight,
                                       BOT_NAV.interiorDoor, BOT_NAV.backDoor];
                        let best = doors[0], bestDist = Infinity;
                        for (const d of doors) {
                            const dx = d.x - bot.x, dz = d.z - bot.z;
                            const dist = Math.sqrt(dx * dx + dz * dz);
                            if (dist < bestDist) { bestDist = dist; best = d; }
                        }
                        this.navQueue = [best]; // override whatever was queued
                        this.stuckTimer = 0;
                    }
                }

                // ── Unstick: jump first, then lateral strafe if still stuck ──────
                if (this.stuckStrafeTimer > 0) {
                    this.stuckStrafeTimer -= dt;
                    if (this.stuckStrafeDir > 0) input.right = true; else input.left = true;
                    if (this.stuckStrafeTimer <= 0) this.stuckStrafeDir *= -1; // flip for next bout
                } else if (bot.grounded && this.jumpCooldown <= 0 && this.stuckTimer >= 0.5) {
                    input.jump = true;
                    this.jumpCooldown = 0.9;
                    if (this.stuckTimer >= 1.0) this.stuckStrafeTimer = 0.5; // stuck too long — also strafe
                    // Do NOT reset stuckTimer here — let it keep accumulating to hit 1.5s threshold
                }
                // Hold jump while airborne and descending → triggers mantle
                if (!bot.grounded && bot.vy <= 0) input.jump = true;

                // Quick primary if right on top of player
                if (distH < 1.8 && bot.attackState === 'idle' && bot.primaryCooldown <= 0) {
                    input.primaryAttack = true;
                }

                // Direct backstab: player has back turned — dash in and release immediately
                if (playerBackExposed && isAggressive && !bot.mantling && distH < 9 && bot.dashCharges >= 1) {
                    this.fsm = 'direct_backstab';
                    this.dashFired = false;
                    this.timer = 0;
                    break;
                }

                // Lethal primary dash: player is low enough to die to a primary but out of melee range
                if (isAggressive && target.hp <= CONFIG.PRIMARY_DAMAGE &&
                    distH > CONFIG.PRIMARY_RANGE && distH < 9 &&
                    bot.dashCharges >= 1 && bot.attackState === 'idle') {
                    this.fsm = 'dash_primary';
                    this.dashFired = false;
                    this.timer = 0;
                    break;
                }

                // Flickstab trigger: mutual facing, close range, aggressive
                if (distH < 7.0 && mutualFacing && isAggressive && !bot.mantling && bot.grounded) {
                    this.fsm = 'flickstab_charge';
                    this.timer = 0;
                    this.dashFired = false;
                    break;
                }

                // Lethal barrel shot: if an explosive barrel near the player would kill them, go shoot it
                if (isAggressive && bot.carriedObjectId === null && bot.attackState === 'idle' && distH < 12) {
                    const lethalBarrel = this.findLethalExplosiveNearTarget(target);
                    if (lethalBarrel) {
                        this.barrelTarget = lethalBarrel;
                        this.fsm = 'barrel_shoot';
                        this.timer = 0;
                        break;
                    }
                }

                // Pick up a carriable to throw — prefer explosive barrels over random crates
                if (isAggressive && bot.carriedObjectId === null && distH > 4) {
                    const explosive = this.findNearbyExplosiveBarrel();
                    const c = explosive || this.findNearbyCarriable();
                    if (c && Math.random() < (explosive ? 0.008 : 0.004)) {
                        this.pickupTarget = c;
                        this.fsm = 'pickup';
                        this.timer = 6.0;
                        break;
                    }
                }

                // Aerial flickstab: launch up on a pad and drop a backstab from above (~0.5%/tick)
                if (isAggressive && bot.jumpPadCooldown <= 0 && !this.padActive &&
                    bot.grounded && distH < 12 && bot.dashCharges >= 2 && Math.random() < 0.005) {
                    this.fsm = 'aerial_attack';
                    this.aerialPhase = 'placing';
                    this.timer = 0;
                    break;
                }

                // Jump pad if player is on roof — trigger once within 7m of building
                const distToBuilding = Math.max(0, Math.max(Math.abs(bot.x) - 7, Math.abs(bot.z) - 5));
                if (target.y > 6.5 && bot.y < 4 && !this.padActive &&
                    bot.jumpPadCooldown <= 0 && distToBuilding < 7) {
                    this.fsm = 'jumppad';
                    this.timer = 0;
                    break;
                }

                // Own pad on cooldown — seek a pad placed by another player to reach the roof
                if (target.y > 6.5 && bot.y < 4 && bot.jumpPadCooldown > 0 && distToBuilding < 7) {
                    let nearestPad = null;
                    let nearestPadDist = 20;
                    for (const [ownerId, pad] of JUMP_PADS) {
                        if (ownerId === bot.id) continue;
                        const dx = pad.x - bot.x, dz = pad.z - bot.z;
                        const dist = Math.sqrt(dx * dx + dz * dz);
                        if (dist < nearestPadDist) {
                            nearestPadDist = dist;
                            nearestPad = pad;
                        }
                    }
                    if (nearestPad && this.navQueue.length === 0) {
                        this.navQueue = [{ x: nearestPad.x, z: nearestPad.z }];
                    }
                }

                // Kite when low HP — reset engagement so bot can dodge again next fight
                if (isDefensive) {
                    this.fsm = 'kite';
                    this.timer = 3 + Math.random() * 2;
                    this.coverPos = this.findCoverPosition(target);
                    this.dodgedThisEngagement = false;
                    break;
                }

                // Occasional passive pause — also resets engagement dodge
                if (this.passiveNext <= 0 && distH > 6) {
                    this.fsm = 'passive';
                    this.timer = 1.5 + Math.random() * 3;
                    this.passiveNext = 10 + Math.random() * 14;
                    this.dodgedThisEngagement = false;
                    break;
                }
                break;
            }

            case 'flickstab_charge': {
                this.smoothAim(toTargetYaw, dt);
                input.chargedAttack = true;
                this.timer += dt;

                // Slowly close distance while charging
                if (distH > 2.8) input.forward = true;

                // Charge complete → compute dash-behind and trigger it
                if (bot.chargeTimer >= CONFIG.CHARGE_TIME - 0.01) {
                    // "Behind" the player = opposite of their forward direction
                    const behindX = target.x + Math.sin(target.yaw) * 2.0;
                    const behindZ = target.z + Math.cos(target.yaw) * 2.0;
                    this.dashBehindTarget = { x: behindX, z: behindZ };
                    // Rotate bot to face that position for the dash
                    bot.yaw = this.faceToward(behindX, behindZ);
                    this.fsm = 'flickstab_dash';
                    this.dashFired = false;
                    this.timer = 0;
                    break;
                }

                // Abort if target escapes or bot gets hurt and goes defensive
                if (this.timer > 3.5 || distH > 10 || isDefensive) {
                    this.fsm = isDefensive ? 'kite' : 'approach';
                    if (isDefensive) this.timer = 3 + Math.random() * 3;
                    break;
                }
                break;
            }

            case 'flickstab_dash': {
                // Keep holding charge so it doesn't release early
                input.chargedAttack = true;

                if (!this.dashFired) {
                    input.dash = true;
                    this.dashFired = true;
                    this.timer = 0;
                }

                this.timer += dt;

                // Dash complete → spin 180° to face player, then release
                if (this.dashFired && !bot.dashing && this.timer > 0.05) {
                    bot.yaw = this.faceToward(target.x, target.z);
                    // Record whether the bot is actually behind the player at release time
                    this.stabWasBackstab = playerFacingBotDot < -0.3;
                    this.fsm = 'flickstab_release';
                    this.timer = 0;
                    break;
                }

                // Timeout safety
                if (this.timer > 1.2) {
                    this.fsm = 'approach';
                    break;
                }
                break;
            }

            case 'flickstab_release': {
                // Release: setting chargedAttack = false fires the charged attack server-side
                input.chargedAttack = false;
                this.timer += dt;

                // Wait a couple ticks so attackHitRegistered has been set by processCombat
                if (this.timer > 0.08) {
                    const hit = bot.attackHitRegistered;

                    if (hit && !this.stabWasBackstab) {
                        // Hit the front — follow up with primary + elbow to finish them off
                        this.fsm = 'combo';
                        this.comboPhase = 0;
                        this.comboTimer = 0;
                    } else if (hit && this.stabWasBackstab) {
                        // Backstab landed — full damage dealt, re-engage
                        this.fsm = 'approach';
                    } else {
                        // Missed — reposition and try again
                        if (bot.dashCharges >= 2) {
                            // Dash back to create space, then charge another flickstab
                            this.fsm = 'dash_back_reposition';
                            this.dashFired = false;
                            this.timer = 0;
                        } else {
                            // Low on charges — immediately start charging another attempt
                            this.fsm = 'flickstab_charge';
                            this.timer = 0;
                            this.dashFired = false;
                        }
                    }
                }
                break;
            }

            case 'direct_backstab': {
                // Player has back turned — close the gap with a dash and release the pre-charged backstab
                input.chargedAttack = true; // keep holding charge
                this.smoothAim(toTargetYaw, dt);
                this.timer += dt;

                // Abort if player turns around or timeout
                if (playerFacingBotDot > 0.1 || this.timer > 2.5 || isDefensive) {
                    this.fsm = isDefensive ? 'kite' : 'approach';
                    if (isDefensive) this.timer = 3 + Math.random() * 2;
                    break;
                }

                // Dash toward player once to close distance quickly (if not already in range)
                if (!this.dashFired && distH > 3.0 && bot.dashCharges >= 1) {
                    input.dash = true;
                    this.dashFired = true;
                }

                // Walk in if dash wasn't enough or wasn't needed
                if (distH > CONFIG.CHARGED_RANGE * 0.85) input.forward = true;

                // Release backstab once in range and charge is full
                if (distH < CONFIG.CHARGED_RANGE * 0.9 && bot.chargeTimer >= CONFIG.CHARGE_TIME - 0.01) {
                    this.fsm = 'flickstab_release'; // reuse the release → combo chain
                    this.timer = 0;
                }
                break;
            }

            case 'dash_primary': {
                // Player is near-dead — dash in and land a killing primary
                input.chargedAttack = true; // stay pre-charged in case backstab opens up
                this.smoothAim(toTargetYaw, dt);
                this.timer += dt;

                // Abort if player is no longer killable by primary (regen'd) or bot goes defensive
                if (target.hp > CONFIG.PRIMARY_DAMAGE || isDefensive || this.timer > 2.5) {
                    this.fsm = isDefensive ? 'kite' : 'approach';
                    if (isDefensive) this.timer = 3 + Math.random() * 2;
                    break;
                }

                // Dash toward player once to close the gap
                if (!this.dashFired && distH > CONFIG.PRIMARY_RANGE && bot.dashCharges >= 1) {
                    input.dash = true;
                    this.dashFired = true;
                }

                // Walk in if still not close enough
                if (distH > CONFIG.PRIMARY_RANGE * 0.9) input.forward = true;

                // Fire primary when in range
                if (distH <= CONFIG.PRIMARY_RANGE && bot.attackState === 'idle' && bot.primaryCooldown <= 0) {
                    input.primaryAttack = true;
                    this.fsm = 'approach';
                }
                break;
            }

            case 'dash_back_reposition': {
                // Missed the stab — dash away to create space, then immediately charge another flickstab
                input.chargedAttack = true; // start building charge during reposition
                this.timer += dt;

                if (!this.dashFired) {
                    bot.yaw = toTargetYaw + Math.PI; // face away from player
                    input.dash = true;
                    this.dashFired = true;
                }

                // Once dash is done (or after brief delay), go straight into charging another stab
                if (this.dashFired && !bot.dashing && this.timer > 0.1) {
                    this.fsm = 'flickstab_charge';
                    this.timer = 0;
                    this.dashFired = false;
                }

                if (this.timer > 1.5) { this.fsm = 'approach'; } // safety timeout
                break;
            }

            case 'combo': {
                // Primary → elbow follow-up (the "failstab combo")
                this.smoothAim(toTargetYaw, dt);
                if (distH > 2.0) input.forward = true;
                this.comboTimer += dt;

                if (this.comboPhase === 0) {
                    if (bot.attackState === 'idle' && bot.primaryCooldown <= 0) {
                        input.primaryAttack = true;
                        this.comboPhase = 1;
                        this.comboTimer = 0;
                    } else if (this.comboTimer > 0.7) {
                        this.comboPhase = 1; this.comboTimer = 0; // couldn't land, skip
                    }
                } else if (this.comboPhase === 1) {
                    if (this.comboTimer > 0.25 && bot.attackState === 'idle' && bot.elbowCooldown <= 0) {
                        input.elbow = true;
                        this.comboPhase = 2;
                        this.comboTimer = 0;
                    } else if (this.comboTimer > 0.9) {
                        this.comboPhase = 2;
                    }
                } else {
                    if (this.comboTimer > 0.4) this.fsm = 'approach';
                }
                break;
            }

            case 'kite': {
                input.chargedAttack = true; // stay armed while kiting
                this.timer -= dt;

                // Escape dash: player closing in fast — dash directly away
                if (distH < 3.5 && bot.dashCharges >= 2 && !bot.dashing) {
                    bot.yaw = toTargetYaw + Math.PI; // face away
                    return { ...this.idleInput(), dash: true, chargedAttack: true };
                }

                // ── Goo barrel cover: pick one up and throw it behind bot as a wall ──
                if (bot.carriedObjectId === null && !this.gooGoal && Math.random() < 0.003) {
                    const goo = this.findGooBarrelNearBot();
                    if (goo) {
                        this.pickupTarget = goo;
                        this.gooGoal = true;
                        this.fsm = 'pickup';
                        this.timer = 5.0;
                        break;
                    }
                }

                // ── Cover-aware movement: sidestep toward cover object ──
                if (this.coverPos) {
                    const cdx = this.coverPos.x - bot.x, cdz = this.coverPos.z - bot.z;
                    const coverDist = Math.sqrt(cdx * cdx + cdz * cdz);
                    if (coverDist > 1.5) {
                        this.smoothAim(this.faceToward(this.coverPos.x, this.coverPos.z), dt);
                        input.forward = true;
                    } else {
                        this.coverPos = null; // reached cover — switch to normal retreat
                    }
                } else {
                    // Normal retreat: face player, back away
                    this.smoothAim(toTargetYaw, dt);
                    if (distH < 7) input.backward = true;
                    else if (distH > 14) this.fsm = 'approach'; // don't run forever
                }

                // Self-defense poke if they get too close
                if (distH < 2.0 && bot.attackState === 'idle' && bot.primaryCooldown <= 0) {
                    input.primaryAttack = true;
                }

                // Defensive jump pad: occasional repositioning hop (~0.8%/tick)
                if (bot.jumpPadCooldown <= 0 && !this.padActive && bot.grounded && Math.random() < 0.008) {
                    const pad = botPlaceJumpPad(bot.id);
                    if (pad) {
                        this.padActive = true;
                        this.padPos = { x: pad.x, z: pad.z };
                    }
                }
                if (this.padActive && this.padPos) {
                    const pdx = this.padPos.x - bot.x, pdz = this.padPos.z - bot.z;
                    if (Math.sqrt(pdx * pdx + pdz * pdz) > 0.5) {
                        this.smoothAim(this.faceToward(this.padPos.x, this.padPos.z), dt);
                        input.forward = true;
                    }
                    if (bot.vy > 3) { this.padActive = false; this.padPos = null; }
                }

                // Exit after fixed timer only
                if (this.timer <= 0) { this.coverPos = null; this.fsm = 'approach'; }
                break;
            }

            case 'passive': {
                input.chargedAttack = true; // pre-charge while waiting
                // Just watch the player — no movement
                this.smoothAim(toTargetYaw, dt);
                this.timer -= dt;
                if (this.timer <= 0 || distH < 2.5) this.fsm = 'approach';
                break;
            }

            case 'pickup': {
                input.chargedAttack = true; // pre-charge while fetching
                const pt = this.pickupTarget;
                if (!pt || !pt.alive || pt.carriedBy != null || bot.carriedObjectId !== null) {
                    this.fsm = 'approach'; break;
                }
                this.timer -= dt;
                if (this.timer <= 0) { this.fsm = 'approach'; break; }

                const pdx = pt.x - bot.x, pdz = pt.z - bot.z;
                const pdist = Math.sqrt(pdx * pdx + pdz * pdz);
                this.smoothAim(this.faceToward(pt.x, pt.z), dt);

                if (pdist > 1.5) {
                    input.forward = true;
                    if (bot.grounded && this.jumpCooldown <= 0 && this.stuckTimer >= 0.5) {
                        input.jump = true; this.jumpCooldown = 0.9; this.stuckTimer = 0;
                    }
                    if (!bot.grounded && bot.vy <= 0) input.jump = true;
                } else {
                    botPickupObject(bot.id);
                    this.throwTimer = 0.8; // brief hold before throw
                    this.fsm = 'approach';
                }
                break;
            }

            case 'jumppad': {
                input.chargedAttack = true; // pre-charge while setting up pad
                this.timer += dt;

                if (!this.padActive) {
                    const pad = botPlaceJumpPad(bot.id);
                    if (pad) {
                        this.padActive = true;
                        this.padPos = { x: pad.x, z: pad.z };
                    } else {
                        this.fsm = 'approach'; break;
                    }
                }

                // Walk over the pad to trigger it
                if (this.padPos) {
                    const padDx = this.padPos.x - bot.x, padDz = this.padPos.z - bot.z;
                    const padDist = Math.sqrt(padDx * padDx + padDz * padDz);
                    this.smoothAim(this.faceToward(this.padPos.x, this.padPos.z), dt);
                    if (padDist > 0.5) input.forward = true;
                }

                // After launch, resume approach
                if (bot.vy > 3) {
                    this.padActive = false; this.padPos = null;
                    this.fsm = 'approach';
                }

                // Timeout or player came down
                if (this.timer > 12 || target.y < 4) {
                    this.padActive = false; this.padPos = null;
                    this.fsm = 'approach';
                }
                break;
            }

            case 'aerial_attack': {
                // Offensive aerial flickstab: place pad → launch up → dash behind target → backstab from above
                input.chargedAttack = true; // hold charge throughout

                this.timer += dt;

                if (this.aerialPhase === 'placing') {
                    // Place a jump pad at bot's current position
                    if (!this.padActive) {
                        const pad = botPlaceJumpPad(bot.id);
                        if (pad) {
                            this.padActive = true;
                            this.padPos = { x: pad.x, z: pad.z };
                        } else {
                            this.fsm = 'approach'; break; // couldn't place pad
                        }
                    }
                    // Walk onto the pad
                    if (this.padPos) {
                        const pdx = this.padPos.x - bot.x, pdz = this.padPos.z - bot.z;
                        if (Math.sqrt(pdx * pdx + pdz * pdz) > 0.4) {
                            this.smoothAim(this.faceToward(this.padPos.x, this.padPos.z), dt);
                            input.forward = true;
                        }
                    }
                    if (bot.vy > 3) {
                        // Launched — clear pad refs and move to airborne phase
                        this.padActive = false; this.padPos = null;
                        this.aerialPhase = 'airborne';
                        this.dashFired = false;
                        this.timer = 0;
                    }
                    if (this.timer > 6) { this.fsm = 'approach'; break; } // abort if stuck
                }

                else if (this.aerialPhase === 'airborne') {
                    // While rising/at peak, aim at target and wait until above them
                    this.smoothAim(toTargetYaw, dt);
                    if (!bot.grounded && bot.y > target.y + 1.5 && bot.dashCharges >= 1) {
                        // Compute behind-player position for the aerial dash
                        const behindX = target.x + Math.sin(target.yaw) * 2.0;
                        const behindZ = target.z + Math.cos(target.yaw) * 2.0;
                        bot.yaw = this.faceToward(behindX, behindZ);
                        this.aerialPhase = 'dashing';
                        this.dashFired = false;
                        this.timer = 0;
                    }
                    if (this.timer > 4 || (bot.grounded && this.timer > 0.3)) {
                        // Didn't get above target in time — fall back to approach
                        this.fsm = 'approach'; break;
                    }
                }

                else if (this.aerialPhase === 'dashing') {
                    input.chargedAttack = true;
                    if (!this.dashFired) {
                        input.dash = true;
                        this.dashFired = true;
                        this.timer = 0;
                    }
                    this.timer += dt;
                    // Dash complete → spin to face player and release backstab
                    if (this.dashFired && !bot.dashing && this.timer > 0.05) {
                        bot.yaw = this.faceToward(target.x, target.z);
                        this.aerialPhase = 'releasing';
                        this.timer = 0;
                    }
                    if (this.timer > 1.0) { this.fsm = 'combo'; this.comboPhase = 0; this.comboTimer = 0; }
                }

                else if (this.aerialPhase === 'releasing') {
                    // Release the charged backstab
                    input.chargedAttack = false;
                    this.timer += dt;
                    if (this.timer > 0.15) {
                        this.fsm = 'combo';
                        this.comboPhase = 0;
                        this.comboTimer = 0;
                    }
                }
                break;
            }

            case 'barrel_shoot': {
                // Bot approaches an explosive barrel near the player and shoots it for burst damage
                const bt = this.barrelTarget;
                if (!bt || !bt.alive || bt.carriedBy != null) {
                    // Barrel gone — abort
                    this.barrelTarget = null;
                    this.fsm = 'approach';
                    break;
                }

                this.timer += dt;
                if (this.timer > 4.0) { this.barrelTarget = null; this.fsm = 'approach'; break; }

                // Move toward barrel
                const bdx = bt.x - bot.x, bdz = bt.z - bot.z;
                const bDist = Math.sqrt(bdx * bdx + bdz * bdz);
                const barrelYaw = this.faceToward(bt.x, bt.z);
                this.smoothAim(barrelYaw, dt);
                if (bDist > CONFIG.PRIMARY_RANGE * 0.9) {
                    input.forward = true;
                    // Unstick jump if needed
                    if (bot.grounded && this.jumpCooldown <= 0 && this.stuckTimer >= 0.5) {
                        input.jump = true; this.jumpCooldown = 0.9; this.stuckTimer = 0;
                    }
                    if (!bot.grounded && bot.vy <= 0) input.jump = true;
                } else {
                    // In range — check facing and fire
                    const nx = bdx / bDist, nz = bdz / bDist;
                    const fwdDot = (-Math.sin(bot.yaw)) * nx + (-Math.cos(bot.yaw)) * nz;
                    if (fwdDot > 0.8 && bot.attackState === 'idle' && bot.primaryCooldown <= 0) {
                        input.primaryAttack = true;
                        this.barrelTarget = null;
                        this.fsm = 'approach';
                    }
                }
                break;
            }
        }

        return input;
    }
}

function spawnBot() {
    const botId = nextPlayerId++;
    const bot = new ServerPlayer(botId);
    bot.isBot = true;
    bot.ws = null;
    bot.ready = true;
    const spawnIdx = players.size; // all current players (humans + prior bots) = next spawn slot
    bot.x = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length].x;
    bot.z = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length].z;
    bot.yaw = spawnIdx === 0 ? 0 : Math.PI;
    bot.y = CONFIG.PLAYER_HEIGHT / 2;
    bot.color = firstFreeColor(); // give bots an unused color too
    bot.botAI = new BotAI(bot);
    players.set(botId, bot);
    console.log(`[Server] Bot spawned as Player ${botId}`);
}

// ─────────────────────────────────────────────────────────────────────────────

const players = new Map();
let gameActive = false;
let killGoal = 10;
let killFeed = [];
let nextPlayerId = 1;
let playerCount = 0; // tracks connected human count for display numbers

// ─── Lobby state ───
let lobbyHostId = null;
let lobbyConfig = { humanSlots: 1, botCount: 1, killGoal: 10 };

function broadcastLobbyState() {
    const playerList = Array.from(players.values())
        .filter(p => !p.isBot)
        .map(p => ({
            id: p.id,
            displayId: p.displayId,
            isHost: p.id === lobbyHostId,
            ready: p.id === lobbyHostId ? true : !!p.ready, // host counts as always ready
            color: p.color,
        }));
    broadcast({
        type: 'lobby_state',
        hostId: lobbyHostId,
        humanSlots: lobbyConfig.humanSlots,
        botCount: lobbyConfig.botCount,
        killGoal: lobbyConfig.killGoal,
        players: playerList,
    });
}

const app = express();
app.get('/version', (_req, res) => res.json({ version: 'colors-v6', colorPicker: true }));
app.use(express.static(join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store');
    }
}));
const server = createServer(app);
const wss = new WebSocketServer({ server });

// ─── Heartbeat: detect abruptly closed tabs (no clean WebSocket close frame) ───
setInterval(() => {
    wss.clients.forEach((client) => {
        if (!client.isAlive) {
            client.terminate(); // triggers 'close' event
            return;
        }
        client.isAlive = false;
        client.ping();
    });
}, 5000);

function handleDisconnect(playerId) {
    if (!players.has(playerId)) return; // already cleaned up
    const leavingPlayer = players.get(playerId);
    if (!leavingPlayer.isBot) playerCount--;
    console.log(`[Server] Player ${playerId} disconnected`);
    players.delete(playerId);

    // Remove any jump pad placed by this player
    if (JUMP_PADS.has(playerId)) {
        const pad = JUMP_PADS.get(playerId);
        broadcast({ type: 'jumppad_removed', id: pad.id });
        JUMP_PADS.delete(playerId);
    }

    // Remove any gateways placed by this player
    if (GATEWAYS.has(playerId)) {
        const gw = GATEWAYS.get(playerId);
        if (gw.a || gw.b) {
            broadcast({ type: 'gateway_expired', ownerId: playerId, aId: gw.a?.id, bId: gw.b?.id });
        }
        GATEWAYS.delete(playerId);
    }

    // Remove all bots (game reset on any disconnect)
    const botIds = Array.from(players.values()).filter(p => p.isBot).map(p => p.id);
    for (const botId of botIds) {
        if (JUMP_PADS.has(botId)) {
            const pad = JUMP_PADS.get(botId);
            broadcast({ type: 'jumppad_removed', id: pad.id });
            JUMP_PADS.delete(botId);
        }
        players.delete(botId);
    }

    // Always end the game when someone disconnects
    gameActive = false;

    // If host left, promote next human player to host
    if (playerId === lobbyHostId) {
        const nextHuman = Array.from(players.values()).find(p => !p.isBot);
        if (nextHuman) {
            lobbyHostId = nextHuman.id;
            nextHuman.ws?.send(JSON.stringify({ type: 'promoted_to_host' }));
            console.log(`[Server] Player ${nextHuman.id} promoted to host`);
        } else {
            lobbyHostId = null;
        }
    }

    // Reset remaining players so they can start a fresh game
    for (const p of players.values()) {
        p.ready = false;
        p.alive = true;
        p.hp = CONFIG.PLAYER_HP;
        p.attackState = 'idle';
        p.chargeTimer = 0;
        p.attackHitRegistered = false;
        p.mantling = false;
        p.sliding = false;
        p.dashing = false;
        p.dashCharges = CONFIG.DASH_CHARGES;
        p.dashRechargeTimer = 0;
        p.kills = 0;
        p.deaths = 0;
    }

    killFeed = [];
    broadcast({ type: 'player_left', playerId });

    // If lobby is now empty, reset host
    const remainingHumans = Array.from(players.values()).filter(p => !p.isBot);
    if (remainingHumans.length === 0) {
        lobbyHostId = null;
    }

    broadcastLobbyState();
    console.log(`[Server] Game reset — waiting for players to reconnect`);
}

wss.on('connection', (ws) => {
    // Count only human (non-bot) players
    const humanCount = Array.from(players.values()).filter(p => !p.isBot).length;
    if (gameActive || humanCount >= lobbyConfig.humanSlots) {
        ws.send(JSON.stringify({ type: 'full', message: 'Lobby is full or game in progress.' }));
        ws.close();
        return;
    }

    const playerId = nextPlayerId++;
    playerCount++;
    const player = new ServerPlayer(playerId);
    player.displayId = playerCount; // stable display number for this session
    const spawnIdx = humanCount; // use current human count before adding
    player.x = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length].x;
    player.z = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length].z;
    player.yaw = spawnIdx === 0 ? 0 : Math.PI;
    player.ws = ws;
    player.color = firstFreeColor(); // assign a default unused color
    players.set(playerId, player);

    // First human player becomes host
    const isHost = lobbyHostId === null;
    if (isHost) {
        lobbyHostId = playerId;
    }

    // Heartbeat tracking
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    console.log(`[Server] Player ${playerId} connected (${players.size} players)`);

    ws.send(JSON.stringify({ type: 'welcome', playerId, displayId: player.displayId, isHost }));

    // Broadcast updated lobby state to all (including the new player)
    broadcastLobbyState();

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            handleMessage(playerId, msg);
        } catch (e) {
            console.error('[Server] Message parse error:', e);
        }
    });

    ws.on('close', () => handleDisconnect(playerId));
    ws.on('error', () => handleDisconnect(playerId));
});

function getDisplayId(playerId) {
    const p = players.get(playerId);
    return p ? (p.displayId ?? playerId) : playerId;
}

function broadcast(msg, excludeId = null) {
    const data = JSON.stringify(msg);
    for (const p of players.values()) {
        if (p.id !== excludeId && p.ws && p.ws.readyState === 1) {
            p.ws.send(data);
        }
    }
}

function handleMessage(playerId, msg) {
    const player = players.get(playerId);
    if (!player) return;
    switch (msg.type) {
        case 'input':
            player.lastInput = msg;
            // Do NOT update lastProcessedInput here — update it in the game loop
            // after the input is actually applied to the player's position.
            // Marking it processed on receive causes the client to discard the
            // input from its unacknowledged list before the server has moved the
            // player, leading to large posError and position snaps (teleporting).
            break;

        case 'trigger_jumppad': {
            // Client detected it walked over a pad (client-side proximity check).
            // Apply launch velocity server-side and broadcast to all.
            const pad = JUMP_PADS.get([...JUMP_PADS.keys()].find(k => {
                const p = JUMP_PADS.get(k);
                return p && p.id === msg.padId;
            }));
            if (pad && player.alive) {
                const retrigger = pad.triggerCooldowns.get(playerId) || 0;
                if (Date.now() / 1000 - retrigger > CONFIG.JUMP_PAD_RETRIGGER_DELAY) {
                    pad.triggerCooldowns.set(playerId, Date.now() / 1000);
                    const len = Math.sqrt(pad.nx * pad.nx + pad.ny * pad.ny + pad.nz * pad.nz);
                    if (pad.ny < 0.5) {
                        player.vx = (pad.nx / len) * CONFIG.JUMP_PAD_WALL_SPEED;
                        player.vz = (pad.nz / len) * CONFIG.JUMP_PAD_WALL_SPEED;
                    }
                    player.vy = CONFIG.JUMP_PAD_WALL_UP;
                    broadcast({ type: 'jumppad_triggered', id: pad.id, playerId, vx: player.vx, vy: player.vy, vz: player.vz });
                }
            }
            break;
        }

        case 'lobby_config':
            // Only host can change lobby settings
            if (playerId !== lobbyHostId) break;
            if (msg.humanSlots !== undefined) {
                lobbyConfig.humanSlots = Math.max(1, Math.min(4, msg.humanSlots));
            }
            if (msg.botCount !== undefined) {
                lobbyConfig.botCount = Math.max(0, Math.min(3, msg.botCount));
                // Clamp total to 4
                if (lobbyConfig.humanSlots + lobbyConfig.botCount > 4) {
                    lobbyConfig.botCount = 4 - lobbyConfig.humanSlots;
                }
            }
            if (msg.killGoal !== undefined) {
                lobbyConfig.killGoal = Math.max(1, Math.min(100, msg.killGoal));
            }
            console.log(`[Server] Host updated config: ${lobbyConfig.humanSlots}H + ${lobbyConfig.botCount}B, goal ${lobbyConfig.killGoal}`);
            broadcastLobbyState();
            break;

        case 'player_ready':
            if (gameActive) break;
            if (playerId === lobbyHostId) break;
            player.ready = !!msg.ready;
            broadcastLobbyState();
            break;

        case 'player_color': {
            if (gameActive) break;
            // Reject if invalid or already taken by another human
            if (!PLAYER_COLORS.includes(msg.color)) break;
            const colorTaken = Array.from(players.values())
                .some(p => !p.isBot && p.id !== playerId && p.color === msg.color);
            if (colorTaken) break;
            player.color = msg.color;
            broadcastLobbyState();
            break;
        }

        case 'start_game': {
            // Only host can start
            if (playerId !== lobbyHostId) break;
            if (gameActive) break;
            // All non-host humans must have readied up
            const notReady = Array.from(players.values())
                .filter(p => !p.isBot && p.id !== lobbyHostId && !p.ready);
            if (notReady.length > 0) {
                broadcastLobbyState(); // re-enable the host's Start button
                break;
            }
            killGoal = lobbyConfig.killGoal;
            console.log(`[Server] Host starting game (goal: ${killGoal})`);

            // Remove any leftover bots from previous game
            for (const [pid, p] of players) {
                if (p.isBot) players.delete(pid);
            }

            // Mark all humans ready
            for (const p of players.values()) {
                if (!p.isBot) p.ready = true;
            }

            // Spawn requested number of bots
            for (let i = 0; i < lobbyConfig.botCount; i++) {
                spawnBot();
            }

            checkGameStart();
            break;
        }

        case 'pickup_object': {
            if (!player.alive) break;
            if (player.carriedObjectId !== null) break;

            let nearest = null;
            let nearestDist = 5.0;
            for (const dest of destructibles) {
                if (!dest.alive || dest.carriedBy != null) continue;
                const dx = dest.x - player.x;
                const dz = dest.z - player.z;
                const dy = Math.abs(dest.y - player.y);
                const hDist = Math.sqrt(dx * dx + dz * dz);
                if (hDist < nearestDist && dy < 3.0) {
                    nearestDist = hDist;
                    nearest = dest;
                }
            }

            if (!nearest) break;

            const box = COLLISION_BOXES[nearest.collisionIndex];
            if (box) {
                nearest._savedBox = { minX: box.minX, minY: box.minY, minZ: box.minZ, maxX: box.maxX, maxY: box.maxY, maxZ: box.maxZ };
                box.minX = 0; box.maxX = 0;
                box.minY = 0; box.maxY = 0;
                box.minZ = 0; box.maxZ = 0;
            }

            nearest.carriedBy = playerId;
            player.carriedObjectId = nearest.id;
            broadcast({ type: 'object_picked_up', destId: nearest.id, playerId });
            break;
        }

        case 'throw_object': {
            if (!player.alive) break;
            if (player.carriedObjectId === null) break;

            const dest = destructibles[player.carriedObjectId];
            if (!dest) { player.carriedObjectId = null; break; }

            dest.carriedBy = null;
            player.carriedObjectId = null;

            const cosP = Math.cos(player.pitch);
            const vx = -Math.sin(player.yaw) * cosP * 18;
            const vy = Math.sin(player.pitch) * 18 + 3;
            const vz = -Math.cos(player.yaw) * cosP * 18;

            const startX = player.x - Math.sin(player.yaw) * 0.8;
            const startY = player.y + (player.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2) - 0.3;
            const startZ = player.z - Math.cos(player.yaw) * 0.8;

            const thrownId = ++thrownIdCounter;
            thrownObjects.set(thrownId, {
                id: thrownId,
                objType: dest.type,
                destId: dest.id,
                ownerId: playerId,
                x: startX, y: startY, z: startZ,
                vx, vy, vz,
            });

            broadcast({ type: 'object_thrown', id: thrownId, objType: dest.type, destId: dest.id, x: startX, y: startY, z: startZ, vx, vy, vz, ownerId: playerId });
            break;
        }

        case 'drop_object': {
            if (!player.alive) break;
            if (player.carriedObjectId === null) break;

            const dest = destructibles[player.carriedObjectId];
            if (dest) {
                dest.alive = false;
                dest.carriedBy = null;
            }
            const prevCarried = player.carriedObjectId;
            player.carriedObjectId = null;
            broadcast({ type: 'object_dropped', destId: prevCarried, playerId });
            break;
        }

        case 'place_jumppad': {
            if (!player.alive) break;
            if (player.jumpPadCooldown > 0) break;
            const half = CONFIG.ARENA_SIZE / 2;
            if (Math.abs(msg.x) > half + 2 || Math.abs(msg.z) > half + 2) break;

            if (JUMP_PADS.has(playerId)) {
                const old = JUMP_PADS.get(playerId);
                broadcast({ type: 'jumppad_removed', id: old.id });
                JUMP_PADS.delete(playerId);
            }

            const pad = {
                id: ++jumpPadIdCounter,
                ownerId: playerId,
                x: msg.x, y: msg.y, z: msg.z,
                nx: msg.nx, ny: msg.ny, nz: msg.nz,
                triggerCooldowns: new Map(),
            };
            JUMP_PADS.set(playerId, pad);
            player.jumpPadCooldown = CONFIG.JUMP_PAD_COOLDOWN;

            broadcast({
                type: 'jumppad_placed',
                id: pad.id, ownerId: pad.ownerId,
                x: pad.x, y: pad.y, z: pad.z,
                nx: pad.nx, ny: pad.ny, nz: pad.nz,
            });
            break;
        }

        case 'throw_gateway': {
            if (!player.alive) break;
            if (player.gatewayCooldown > 0) break;

            const half = CONFIG.ARENA_SIZE / 2 + 2;
            if (Math.abs(msg.x) > half || Math.abs(msg.z) > half) break;

            let gw = GATEWAYS.get(playerId) || { a: null, b: null, timer: 0 };

            if (!gw.a) {
                // Place first (unlinked) gateway
                const id = ++gatewayIdCounter;
                gw.a = { id, x: msg.x, y: msg.y, z: msg.z };
                GATEWAYS.set(playerId, gw);
                player.gatewayCount = 1;
                broadcast({ type: 'gateway_placed', id, ownerId: playerId, x: msg.x, y: msg.y, z: msg.z, linked: false });
            } else if (!gw.b) {
                // Place second gateway — link both and start timers
                const id = ++gatewayIdCounter;
                gw.b = { id, x: msg.x, y: msg.y, z: msg.z };
                gw.timer = CONFIG.GATEWAY_DURATION;
                GATEWAYS.set(playerId, gw);
                player.gatewayCount = 2;
                player.gatewayCooldown = CONFIG.GATEWAY_COOLDOWN;
                broadcast({ type: 'gateway_placed', id, ownerId: playerId, x: msg.x, y: msg.y, z: msg.z, linked: true });
                broadcast({ type: 'gateway_linked', ownerId: playerId, aId: gw.a.id });
            }
            break;
        }

        case 'use_gateway': {
            if (!player.alive) break;

            for (const [ownerId, gw] of GATEWAYS) {
                if (!gw.a || !gw.b || gw.timer <= 0) continue;

                const distA = Math.sqrt((player.x-gw.a.x)**2 + (player.y-gw.a.y)**2 + (player.z-gw.a.z)**2);
                const distB = Math.sqrt((player.x-gw.b.x)**2 + (player.y-gw.b.y)**2 + (player.z-gw.b.z)**2);

                let dest = null;
                if (distA < CONFIG.GATEWAY_INTERACT_RADIUS) dest = gw.b;
                else if (distB < CONFIG.GATEWAY_INTERACT_RADIUS) dest = gw.a;

                if (dest) {
                    player.x = dest.x;
                    player.y = dest.y + CONFIG.PLAYER_HEIGHT / 2;
                    player.z = dest.z;
                    player.vx = 0; player.vy = 0; player.vz = 0;
                    player.respawnProtect = 0.6; // suppress stale client position
                    broadcast({ type: 'gateway_teleport', playerId, toX: dest.x, toY: dest.y, toZ: dest.z });
                    break;
                }
            }
            break;
        }
    }
}

function checkGameStart() {
    if (gameActive) return;
    let allReady = true;
    if (players.size < 2) return;
    for (const p of players.values()) {
        if (!p.ready) { allReady = false; break; }
    }
    if (allReady) {
        gameActive = true;
        // Assign each player the spawn point furthest from already-placed players
        const usedSpawns = [];
        for (const p of players.values()) {
            // Pick the point furthest from used spawns
            let best = SPAWN_POINTS[0], bestDist = -1;
            for (const sp of SPAWN_POINTS) {
                let minUsed = Infinity;
                for (const u of usedSpawns) {
                    const dx = u.x - sp.x, dz = u.z - sp.z;
                    minUsed = Math.min(minUsed, Math.sqrt(dx * dx + dz * dz));
                }
                if (minUsed > bestDist) { bestDist = minUsed; best = sp; }
            }
            usedSpawns.push(best);
            p.x = best.x;
            p.z = best.z;
            p.yaw = best.z < 0 ? 0 : Math.PI; // face toward building
            p.y = CONFIG.PLAYER_HEIGHT / 2;
            p.vx = 0; p.vy = 0; p.vz = 0;
            p.hp = CONFIG.PLAYER_HP;
            p.alive = true;
            p.kills = 0;
            p.deaths = 0;
            p.dashCharges = CONFIG.DASH_CHARGES;
            p.carriedObjectId = null;
            p.respawnProtect = 2.0;
        }

        for (const dest of destructibles) {
            dest.alive = true;
            dest.carriedBy = null;
            dest.hp = dest.type === 'explosive' ? CONFIG.EXPLOSIVE_BARREL_HP :
                     dest.type === 'goo' ? CONFIG.GOO_BARREL_HP : 50;
            const box = COLLISION_BOXES[dest.collisionIndex];
            if (box && dest._savedBox) {
                box.minX = dest._savedBox.minX;
                box.minY = dest._savedBox.minY;
                box.minZ = dest._savedBox.minZ;
                box.maxX = dest._savedBox.maxX;
                box.maxY = dest._savedBox.maxY;
                box.maxZ = dest._savedBox.maxZ;
            }
        }

        killFeed = [];

        // Reset bot AI state for the fresh round
        for (const p of players.values()) {
            if (p.isBot && p.botAI) p.botAI.reset();
        }

        clearGateways();
        broadcast({ type: 'game_start', killGoal });
        console.log(`[Server] Game started! Kill goal: ${killGoal}`);
    }
}

const JUMP_PADS = new Map();
let jumpPadIdCounter = 0;

// ─── Gateway system ─────────────────────────────────────────────────────────
// playerId → { a: {id,x,y,z}|null, b: {id,x,y,z}|null, timer: seconds }
const GATEWAYS = new Map();
let gatewayIdCounter = 0;

function updateGateways(dt) {
    for (const [ownerId, gw] of GATEWAYS) {
        const owner = players.get(ownerId);

        // Tick cooldown on owner
        if (owner && owner.gatewayCooldown > 0) {
            owner.gatewayCooldown = Math.max(0, owner.gatewayCooldown - dt);
        }

        // Tick portal lifetime (only when both are placed)
        if (gw.a && gw.b && gw.timer > 0) {
            gw.timer -= dt;
            if (gw.timer <= 0) {
                gw.timer = 0;
                broadcast({ type: 'gateway_expired', ownerId, aId: gw.a.id, bId: gw.b.id });
                gw.a = null;
                gw.b = null;
                if (owner) owner.gatewayCount = 0;
            }
        }

        // Clean up stale entries with no portals and no cooldown
        if (!gw.a && !gw.b && (!owner || owner.gatewayCooldown <= 0)) {
            GATEWAYS.delete(ownerId);
        }
    }
}

function clearGateways() {
    for (const gw of GATEWAYS.values()) {
        if (gw.a || gw.b) {
            const aId = gw.a?.id, bId = gw.b?.id;
            if (aId !== undefined || bId !== undefined) {
                broadcast({ type: 'gateway_expired', aId, bId });
            }
        }
    }
    GATEWAYS.clear();
    for (const p of players.values()) {
        p.gatewayCooldown = 0;
        p.gatewayCount = 0;
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function updateJumpPads(dt) {
    for (const pad of JUMP_PADS.values()) {
        // Track which players are currently inside the trigger zone
        if (!pad.playersInZone) pad.playersInZone = new Set();
        const nowInZone = new Set();

        for (const player of players.values()) {
            if (!player.alive) continue;
            const dx = player.x - pad.x;
            const dz = player.z - pad.z;
            const hDist = Math.sqrt(dx * dx + dz * dz);

            const isFloorPad = Math.abs(pad.ny) > 0.7;
            const feetY = player.y - CONFIG.PLAYER_HEIGHT / 2;
            const vertInRange = isFloorPad
                ? (feetY - pad.y >= -0.3 && feetY - pad.y < CONFIG.PLAYER_HEIGHT)
                : Math.abs(player.y - pad.y) < CONFIG.JUMP_PAD_TRIGGER_RADIUS * 2;
            const inZone = isFloorPad
                ? (hDist < CONFIG.JUMP_PAD_TRIGGER_RADIUS && vertInRange)
                : (Math.sqrt(dx * dx + (player.y - pad.y) ** 2 + dz * dz) < CONFIG.JUMP_PAD_TRIGGER_RADIUS);

            if (inZone) {
                nowInZone.add(player.id);

                // Rising-edge: only fire when player ENTERS the zone, not while staying in it.
                // Require grounded for floor pads so that a player falling back down
                // after launch doesn't re-trigger (grounded is false while airborne).
                const justEntered = !pad.playersInZone.has(player.id);
                const padOk = isFloorPad ? player.grounded : true;

                if (justEntered && padOk) {
                    player.grounded = false; // immediately airborne so friction doesn't eat the launch
                    if (isFloorPad) {
                        player.vy = CONFIG.JUMP_PAD_LAUNCH_UP;
                        player.vx += pad.nx * CONFIG.JUMP_PAD_LAUNCH_FORWARD;
                        player.vz += pad.nz * CONFIG.JUMP_PAD_LAUNCH_FORWARD;
                    } else {
                        const len = Math.sqrt(pad.nx * pad.nx + pad.nz * pad.nz);
                        if (len > 0.01) {
                            player.vx = (pad.nx / len) * CONFIG.JUMP_PAD_WALL_SPEED;
                            player.vz = (pad.nz / len) * CONFIG.JUMP_PAD_WALL_SPEED;
                        }
                        player.vy = CONFIG.JUMP_PAD_WALL_UP;
                    }
                    broadcast({ type: 'jumppad_triggered', id: pad.id, playerId: player.id, vx: player.vx, vy: player.vy, vz: player.vz });
                }
            }
        }

        pad.playersInZone = nowInZone;
    }
}

function processPlayerInput(player, input, dt) {
    if (!player.alive) return;

    // Look input always applies
    if (input.mouseDeltaX) {
        player.yaw -= input.mouseDeltaX;
    }
    if (input.mouseDeltaY) {
        player.pitch -= input.mouseDeltaY;
        player.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, player.pitch));
    }

    // === MANTLE: tick in progress, skip all other physics ===
    if (player.mantling) {
        player.mantleTime += dt;
        const t = Math.min(player.mantleTime / CONFIG.MANTLE_DURATION, 1);
        const s = 1 - Math.pow(1 - t, 3); // ease-out cubic
        player.x = player.mantleStartX + (player.mantleTargetX - player.mantleStartX) * s;
        player.z = player.mantleStartZ + (player.mantleTargetZ - player.mantleStartZ) * s;
        player.y = player.mantleStartY + (player.mantleTargetY + CONFIG.PLAYER_HEIGHT / 2 - player.mantleStartY) * s;
        if (t >= 1) {
            player.mantling = false;
            player.grounded = true;
            player.vy = 0;
            player.vx = -Math.sin(player.yaw) * CONFIG.MANTLE_FORWARD_BOOST;
            player.vz = -Math.cos(player.yaw) * CONFIG.MANTLE_FORWARD_BOOST;
        }
        return; // skip all movement physics during mantle
    }

    // === DASH: tick active dash first, then check for new dash ===
    // Must come before movement physics so we can gate on player.dashing.
    if (player.dashing) {
        player.dashTime += dt;
        if (player.dashTime >= CONFIG.DASH_DURATION) {
            player.dashing = false;
            player.vx *= 0.5;
            player.vz *= 0.5;
        }
    }

    // Fire new dash on rising edge of input
    if (input.dash && player.dashCharges > 0 && !player.dashing && !player.dashInputConsumed) {
        player.dashing = true;
        player.dashTime = 0;
        // Only start the recharge timer on the FIRST dash from full charges.
        // Subsequent dashes within the window don't reset it — so using dash at T=0,
        // another at T=3 means all charges return at T=5, not T=8.
        if (player.dashCharges === CONFIG.DASH_CHARGES) {
            player.dashRechargeTimer = CONFIG.DASH_COOLDOWN;
        }
        player.dashCharges--;
        player.dashInputConsumed = true;

        const cosP = Math.cos(player.pitch);
        const dashDirX = -Math.sin(player.yaw) * cosP;
        const dashDirZ = -Math.cos(player.yaw) * cosP;
        player.vx = dashDirX * CONFIG.DASH_SPEED;
        player.vy = Math.sin(player.pitch) * CONFIG.DASH_SPEED * 0.3;
        player.vz = dashDirZ * CONFIG.DASH_SPEED;
    }
    if (!input.dash) player.dashInputConsumed = false;

    // Shared recharge timer — when it expires all spent charges come back at once
    if (player.dashCharges < CONFIG.DASH_CHARGES && player.dashRechargeTimer > 0) {
        player.dashRechargeTimer -= dt;
        if (player.dashRechargeTimer <= 0) {
            player.dashCharges = CONFIG.DASH_CHARGES;
            player.dashRechargeTimer = 0;
        }
    }

    // === MOVEMENT (skip entirely during dash — preserve dash velocity) ===
    if (!player.dashing) {
        if (!player.sliding) {
            const SPEED = player.crouching ? CONFIG.CROUCH_SPEED :
                          input.backward ? CONFIG.BACKWARD_SPEED :
                          (input.forward || input.left || input.right) ? CONFIG.SPRINT_SPEED : 0;

            const forward = input.forward ? 1 : (input.backward ? -1 : 0);
            const strafe = input.right ? 1 : (input.left ? -1 : 0);

            let targetVx = 0, targetVz = 0;
            if (forward !== 0 || strafe !== 0) {
                const cosY = Math.cos(player.yaw);
                const sinY = Math.sin(player.yaw);
                targetVx = (-sinY * forward + cosY * strafe) * SPEED;
                targetVz = (-cosY * forward - sinY * strafe) * SPEED;
            }

            const accel = player.grounded ? CONFIG.GROUND_ACCEL : CONFIG.AIR_ACCEL;
            const friction = CONFIG.GROUND_FRICTION;

            if (forward === 0 && strafe === 0 && player.grounded) {
                player.vx -= player.vx * friction * dt;
                player.vz -= player.vz * friction * dt;
            } else {
                player.vx += (targetVx - player.vx) * accel * dt;
                player.vz += (targetVz - player.vz) * accel * dt;
            }
        }
        // (If sliding, friction is applied in the slide tick block below)
    }

    // Slide start
    if (input.crouch && player.grounded && !player.sliding && !player.dashing) {
        player.sliding = true;
        player.slideTime = 0;
        const cosP = Math.cos(player.pitch);
        const speed = CONFIG.SLIDE_INITIAL_SPEED;
        player.vx = -Math.sin(player.yaw) * cosP * speed;
        player.vz = -Math.cos(player.yaw) * cosP * speed;
    }

    // Slide tick
    if (player.sliding) {
        player.slideTime += dt;
        player.vx -= player.vx * CONFIG.SLIDE_FRICTION * dt;
        player.vz -= player.vz * CONFIG.SLIDE_FRICTION * dt;

        const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        if (speed < CONFIG.SLIDE_MIN_SPEED || player.slideTime > CONFIG.SLIDE_DURATION) {
            player.sliding = false;
            player.crouching = true;
        }
    }

    if (!input.crouch && player.crouching && !player.sliding) {
        player.crouching = false;
    }

    if (input.jump && player.grounded && !player.mantling) {
        if (player.sliding) {
            player.vy = CONFIG.JUMP_VELOCITY * CONFIG.SLIDE_JUMP_BOOST;
            player.sliding = false;
        } else {
            player.vy = CONFIG.JUMP_VELOCITY;
        }
        player.grounded = false;
    }

    if (!player.grounded) {
        player.vy -= CONFIG.GRAVITY * dt;
        if (player.vy < -CONFIG.MAX_FALL_SPEED) {
            player.vy = -CONFIG.MAX_FALL_SPEED;
        }
        if (input.crouch && player.vy < 0) {
            player.vy = -CONFIG.FAST_FALL_SPEED;
        }
    }

    const nextX = player.x + player.vx * dt;
    const nextY = player.y + player.vy * dt;
    const nextZ = player.z + player.vz * dt;

    const collision = serverCheckCollision(player, nextX, nextY, nextZ);

    if (collision.groundHit && player.vy <= 0) {
        player.vy = 0;
        player.grounded = true;
    } else if (!collision.groundHit) {
        // No surface underfoot — player is airborne (walked off ledge, launched, etc.)
        player.grounded = false;
    }
    if (collision.ceilingHit && player.vy > 0) {
        player.vy = 0;
    }

    player.x = collision.x;
    player.y = collision.y;
    player.z = collision.z;

    // Mantle detection: airborne, falling/hovering, holding jump, near a wall ledge
    if (!player.mantling && input.jump && !player.grounded && player.vy <= 0) {
        const fwdX = -Math.sin(player.yaw);
        const fwdZ = -Math.cos(player.yaw);
        const checkX = player.x + fwdX * CONFIG.MANTLE_CHECK_DISTANCE;
        const checkZ = player.z + fwdZ * CONFIG.MANTLE_CHECK_DISTANCE;
        const wallCol = serverCheckCollision(player, checkX, player.y, checkZ);
        if (wallCol.wallHit && wallCol.wallTopY > 0) {
            const feetY = player.y - CONFIG.PLAYER_HEIGHT / 2;
            const heightDiff = wallCol.wallTopY - feetY;
            if (heightDiff <= CONFIG.MANTLE_REACH && heightDiff > 0.3) {
                player.mantling = true;
                player.mantleTime = 0;
                player.mantleStartX = player.x;
                player.mantleStartY = player.y;
                player.mantleStartZ = player.z;
                player.mantleTargetX = checkX + fwdX * 0.3;
                player.mantleTargetY = wallCol.wallTopY;
                player.mantleTargetZ = checkZ + fwdZ * 0.3;
                player.vx = 0; player.vy = 0; player.vz = 0;
                player.grounded = false;
            }
        }
    }

    player.crouching = player.crouching || (input.crouch && player.grounded && !player.sliding);

    if (player.carriedObjectId !== null) {
        return;
    }

    if (player.primaryCooldown > 0) player.primaryCooldown -= dt;
    if (player.elbowCooldown > 0) player.elbowCooldown -= dt;

    // Attack state machine — mirrors combat.js on the client.
    // New attacks only start from 'idle' to prevent one attack interrupting another.
    // chargeTimer is always reset when a new charge begins (fixes carry-over instant-charge bug).
    if (player.attackState === 'charged_charging') {
        if (input.chargedAttack) {
            player.chargeTimer += dt;
        } else {
            // Released — fire only if fully charged
            if (player.chargeTimer >= CONFIG.CHARGE_TIME) {
                player.attackState = 'charged_attack';
                player.attackTime = 0;
                player.chargeTimer = 0;
            } else {
                player.attackState = 'idle';
                player.chargeTimer = 0;
            }
        }
    } else if (player.attackState === 'charged_attack') {
        player.attackTime += dt;
        if (player.attackTime >= CONFIG.CHARGED_DURATION) {
            player.attackState = 'idle';
            player.chargeTimer = 0;
        }
    } else if (player.attackState === 'primary') {
        player.attackTime += dt;
        if (player.attackTime >= CONFIG.PRIMARY_DURATION) {
            player.attackState = 'idle';
        }
    } else if (player.attackState === 'elbow') {
        player.attackTime += dt;
        if (player.attackTime >= CONFIG.ELBOW_DURATION) {
            player.attackState = 'idle';
        }
    } else {
        // idle — accept new attack inputs
        if (input.chargedAttack) {
            player.attackState = 'charged_charging';
            player.chargeTimer = 0;  // Always reset when starting a fresh charge
        } else if (input.primaryAttack && player.primaryCooldown <= 0) {
            player.attackState = 'primary';
            player.attackTime = 0;
            player.primaryCooldown = CONFIG.PRIMARY_COOLDOWN;
        } else if (input.elbow && player.elbowCooldown <= 0) {
            player.attackState = 'elbow';
            player.attackTime = 0;
            player.elbowCooldown = CONFIG.ELBOW_COOLDOWN;
        }
    }
}

function processCombat(player, input) {
    if (!player.alive || player.carriedObjectId !== null) return;

    // Reset hit flag when a new attack begins (attackTime just rolled to 0)
    if (player.attackState !== 'idle' && player.attackTime === 0) {
        player.attackHitRegistered = false;
    }
    // Also reset when returning to idle
    if (player.attackState === 'idle') {
        player.attackHitRegistered = false;
    }

    // Only register one hit per attack swing
    if (player.attackHitRegistered) return;
    if (player.attackState === 'idle' || player.attackState === 'charged_charging') return;

    let hitPlayerId = null;
    let hitDamage = 0;
    let isBackstab = false;

    if (player.attackState === 'primary') {
        for (const other of players.values()) {
            if (other.id === player.id || !other.alive) continue;
            const dx = other.x - player.x;
            const dy = other.y - player.y;
            const dz = other.z - player.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < CONFIG.PRIMARY_RANGE) {
                // Dot product: target must be within ~60° cone in front of attacker
                const nx = dx / dist, nz = dz / dist;
                const fwdDot = (-Math.sin(player.yaw)) * nx + (-Math.cos(player.yaw)) * nz;
                if (fwdDot > 0.5) {
                    hitPlayerId = other.id;
                    hitDamage = CONFIG.PRIMARY_DAMAGE;
                    other.hp -= hitDamage;
                    other.regenTimer = 0;
                    break;
                }
            }
        }
    }

    if (player.attackState === 'charged_attack') {
        for (const other of players.values()) {
            if (other.id === player.id || !other.alive) continue;
            const dx = other.x - player.x;
            const dy = other.y - player.y;
            const dz = other.z - player.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < CONFIG.CHARGED_RANGE) {
                // Attacker must be roughly facing the target (~75° cone)
                const nx = dx / dist, nz = dz / dist;
                const fwdDot = (-Math.sin(player.yaw)) * nx + (-Math.cos(player.yaw)) * nz;
                if (fwdDot <= 0.25) break; // not facing target — miss

                // Backstab: dot of target's forward with direction-from-target-to-attacker
                const toAttX = player.x - other.x;
                const toAttZ = player.z - other.z;
                const toAttLen = Math.sqrt(toAttX * toAttX + toAttZ * toAttZ);
                const targetFwdX = -Math.sin(other.yaw);
                const targetFwdZ = -Math.cos(other.yaw);
                const backDot = toAttLen > 0.01
                    ? (targetFwdX * (toAttX / toAttLen) + targetFwdZ * (toAttZ / toAttLen))
                    : 1;
                isBackstab = backDot < 0.0; // ±90° from behind (25% wider than default ±72.5°)

                hitDamage = isBackstab ? CONFIG.CHARGED_DAMAGE_BACK : CONFIG.CHARGED_DAMAGE_FRONT;
                hitPlayerId = other.id;
                other.hp -= hitDamage;
                other.regenTimer = 0;
                break;
            }
        }
    }

    if (player.attackState === 'elbow') {
        for (const other of players.values()) {
            if (other.id === player.id || !other.alive) continue;
            const dx = other.x - player.x;
            const dy = other.y - player.y;
            const dz = other.z - player.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < CONFIG.ELBOW_RANGE) {
                // Dot product: wider ~80° cone for the up-close elbow strike
                const nx = dx / dist, nz = dz / dist;
                const fwdDot = (-Math.sin(player.yaw)) * nx + (-Math.cos(player.yaw)) * nz;
                if (fwdDot > 0.3) {
                    hitPlayerId = other.id;
                    hitDamage = CONFIG.ELBOW_DAMAGE;
                    other.hp -= hitDamage;
                    other.regenTimer = 0;
                    break;
                }
            }
        }
    }

    if (hitPlayerId !== null) {
        player.attackHitRegistered = true;
        const target = players.get(hitPlayerId);
        if (target && target.hp <= 0) {
            target.hp = 0;
            target.alive = false;
            target.respawnTimer = CONFIG.RESPAWN_TIME;
            target.deaths++;
            player.kills++;
            killFeed.push({ killerId: player.id, victimId: target.id, time: 5 });
            broadcast({ type: 'kill_feed', killerId: player.id, killerDisplayId: getDisplayId(player.id), victimId: target.id, victimDisplayId: getDisplayId(target.id), weapon: player.attackState });
        }
        broadcast({ type: 'hit_confirm', attackerId: player.id, targetId: hitPlayerId,
            damage: hitDamage, backstab: isBackstab });
    }
}

function updateGame(dt) {
    if (!gameActive) return;

    for (const player of players.values()) {
        if (!player.alive) {
            player.respawnTimer -= dt;
            if (player.respawnTimer <= 0) {
                player.alive = true;
                player.hp = CONFIG.PLAYER_HP;
                player.respawnTimer = 0;
                const sp = getBestSpawn(player.id);
                player.x = sp.x;
                player.z = sp.z;
                player.y = CONFIG.PLAYER_HEIGHT / 2;
                player.respawnProtect = 2.0; // ignore client position for 2s after spawn
                player.vx = 0; player.vy = 0; player.vz = 0;
                player.dashCharges = CONFIG.DASH_CHARGES;
                player.dashRechargeTimer = 0;
                player.dashInputConsumed = false;
                player.carriedObjectId = null;
                player.attackState = 'idle';
                player.attackTime = 0;
                player.chargeTimer = 0;
                player.attackHitRegistered = false;
                player.mantling = false;
            }
            continue;
        }

        player.regenTimer += dt;
        if (player.regenTimer >= 5.0 && player.hp < CONFIG.PLAYER_HP) {
            player.hp = Math.min(player.hp + 20 * dt, CONFIG.PLAYER_HP);
        }

        if (player.jumpPadCooldown > 0) {
            player.jumpPadCooldown -= dt;
        }
    }

    for (const [id, thrown] of thrownObjects) {
        thrown.vy -= CONFIG.GRAVITY * dt;
        thrown.x += thrown.vx * dt;
        thrown.y += thrown.vy * dt;
        thrown.z += thrown.vz * dt;

        if (thrown.y <= 0) {
            thrownHitSurface(thrown, 0, 1, 0);
            continue;
        }

        for (const box of COLLISION_BOXES) {
            if (thrown.x >= box.minX && thrown.x <= box.maxX &&
                thrown.y >= box.minY && thrown.y <= box.maxY &&
                thrown.z >= box.minZ && thrown.z <= box.maxZ) {
                const nx = (thrown.x < (box.minX + box.maxX) / 2) ? -1 : 1;
                const ny = (thrown.y < (box.minY + box.maxY) / 2) ? -0.5 : 0.5;
                const nz = (thrown.z < (box.minZ + box.maxZ) / 2) ? -1 : 1;
                thrownHitSurface(thrown, nx, ny, nz);
                break;
            }
        }

        for (const player of players.values()) {
            if (!player.alive) continue;
            const dx = player.x - thrown.x;
            const dy = player.y - thrown.y;
            const dz = player.z - thrown.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < 0.6) {
                thrownHitPlayer(thrown, player);
                break;
            }
        }
    }

    updateJumpPads(dt);
    updateGateways(dt);

    // Generate bot inputs before processing all players
    for (const player of players.values()) {
        if (player.isBot && player.botAI && player.alive) {
            player.lastInput = player.botAI.update(dt, players);
        }
    }

    for (const player of players.values()) {
        if (player.respawnProtect > 0) player.respawnProtect -= dt;

        if (player.lastInput) {
            // Sync server position from client-reported values before processing.
            // Skip during respawnProtect window — the server just placed the player at
            // a spawn point and the client is still sending stale death-position inputs.
            if (player.lastInput.px !== undefined && player.ws !== null && player.respawnProtect <= 0) {
                player.x = player.lastInput.px;
                player.y = player.lastInput.py;
                player.z = player.lastInput.pz;
                player.yaw = player.lastInput.pyaw;
            }
            processPlayerInput(player, player.lastInput, dt);
            processCombat(player, player.lastInput);
            player.lastProcessedInput = player.lastInput.seq; // mark processed only after applying
            player.lastInput = null;
        }
    }

    for (let i = killFeed.length - 1; i >= 0; i--) {
        killFeed[i].time -= dt;
        if (killFeed[i].time <= 0) {
            killFeed.splice(i, 1);
        }
    }

    const scores = Array.from(players.values()).map(p => ({ id: p.id, displayId: p.displayId ?? p.id, kills: p.kills, deaths: p.deaths }));

    for (const p of players.values()) {
        if (p.kills >= killGoal) {
            gameActive = false;
            broadcast({ type: 'game_over', winnerId: p.id, scores });
            console.log(`[Server] Game over! Winner: Player ${p.id}`);
            // Remove bots, reset human players to lobby
            const botIds2 = Array.from(players.values()).filter(b => b.isBot).map(b => b.id);
            for (const bid of botIds2) players.delete(bid);
            for (const p2 of players.values()) {
                p2.ready = false;
            }
            for (const pad of JUMP_PADS.values()) {
                broadcast({ type: 'jumppad_removed', id: pad.id });
            }
            JUMP_PADS.clear();
            clearGateways();
            broadcastLobbyState();
            break;
        }
    }

    const state = {
        gameActive,
        killGoal,
        players: Array.from(players.values()).map(p => p.serialize()),
        killFeed: killFeed.map(k => ({ killerId: k.killerId, victimId: k.victimId, weapon: k.weapon })),
    };
    broadcast({ type: 'game_state', state });
}

setInterval(() => {
    updateGame(1 / CONFIG.SERVER_TICK_RATE);
}, 1000 / CONFIG.SERVER_TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    buildServerCollisionBoxes(); // also calls buildServerDestructibles() internally
});