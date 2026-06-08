import { CONFIG } from './config.js?v=5';

// Process movement for a player given their input — used on both client and server
export function processMovement(player, input, dt, collisionCheck) {
    if (!player.alive) return;
    // ─── Look (always applied, even during dash/mantle) ───
    player.yaw -= input.mouseDeltaX;
    player.pitch -= input.mouseDeltaY;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));

    if (player.mantling) {
        processMantling(player, dt);
        return;
    }
    if (player.dashing) {
        processDash(player, dt, collisionCheck);
        return;
    }

    // ─── Crouch / Slide ───
    handleCrouchAndSlide(player, input, dt);

    // ─── Horizontal movement ───
    if (!player.sliding) {
        applyGroundOrAirMovement(player, input, dt);
    } else {
        applySlidePhysics(player, input, dt);
    }

    // ─── Jump (including slide-jump) ───
    if (input.jump && player.grounded) {
        let jumpVel = CONFIG.JUMP_VELOCITY;
        if (player.sliding) {
            // Slide-jump: boost and preserve slide momentum
            jumpVel *= CONFIG.SLIDE_JUMP_BOOST;
            player.sliding = false;
            player.slideCooldownTimer = CONFIG.SLIDE_COOLDOWN;
        }
        player.vy = jumpVel;
        player.grounded = false;

        // Cap horizontal speed to sprint on every jump — pad gives one big arc but hopping resets momentum
        const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        if (hSpeed > CONFIG.SPRINT_SPEED) {
            player.vx = (player.vx / hSpeed) * CONFIG.SPRINT_SPEED;
            player.vz = (player.vz / hSpeed) * CONFIG.SPRINT_SPEED;
        }
    }

    // ─── Fast fall: press crouch while airborne and falling ───
    if (input.crouch && !player.grounded && player.vy < 0) {
        if (player.vy > -CONFIG.FAST_FALL_SPEED) {
            player.vy -= CONFIG.GRAVITY * 2.5 * dt; // extra pull-down
            if (player.vy < -CONFIG.FAST_FALL_SPEED) {
                player.vy = -CONFIG.FAST_FALL_SPEED;
            }
        }
    }

    // ─── Gravity ───
    if (!player.grounded) {
        player.vy -= CONFIG.GRAVITY * dt;
        if (player.vy < -CONFIG.MAX_FALL_SPEED && !input.crouch) {
            player.vy = -CONFIG.MAX_FALL_SPEED;
        }
    }

    // ─── Mantle check: hold jump while airborne near a ledge ───
    if (input.jump && !player.grounded && player.vy <= 0) {
        const mantleResult = checkMantle(player, collisionCheck);
        if (mantleResult) {
            player.mantling = true;
            player.mantleTimer = CONFIG.MANTLE_DURATION;
            player.mantleStartY = player.y;
            player.mantleTargetY = mantleResult.targetY;
            player.mantleStartX = player.x;
            player.mantleStartZ = player.z;
            player.mantleTargetX = mantleResult.targetX;
            player.mantleTargetZ = mantleResult.targetZ;
            player.vx = 0;
            player.vy = 0;
            player.vz = 0;
            return;
        }
    }

    // ─── Dash ───
    if (input.dash && !player.dashing && player.dashCharges > 0 && !player.dashInputConsumed) {
        startDash(player, input);
        player.dashInputConsumed = true;
    }
    if (!input.dash) {
        player.dashInputConsumed = false;
    }

    // Shared recharge timer — all spent charges come back at once
    if (player.dashCharges < CONFIG.DASH_CHARGES && player.dashRechargeTimer > 0) {
        player.dashRechargeTimer -= dt;
        if (player.dashRechargeTimer <= 0) {
            player.dashCharges = CONFIG.DASH_CHARGES;
            player.dashRechargeTimer = 0;
        }
    }

    // ─── Apply velocity ───
    applyVelocity(player, dt, collisionCheck);
}

// ─── Crouch & Slide State Machine ───
function handleCrouchAndSlide(player, input, dt) {
    if (input.crouch && player.grounded) {
        const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);

        // Initiate slide if moving fast enough and not already sliding
        if (!player.crouching && !player.sliding && speed > CONFIG.WALK_SPEED * 0.8 && player.slideCooldownTimer <= 0) {
            player.sliding = true;
            player.slideTimer = CONFIG.SLIDE_DURATION;
            player.crouching = true;

            // Boost in current velocity direction
            if (speed > 0.1) {
                const norm = 1 / speed;
                player.vx = player.vx * norm * CONFIG.SLIDE_INITIAL_SPEED;
                player.vz = player.vz * norm * CONFIG.SLIDE_INITIAL_SPEED;
            } else {
                // Slide in facing direction if nearly still
                const fwd = player.getForward();
                player.vx = fwd.x * CONFIG.SLIDE_INITIAL_SPEED;
                player.vz = fwd.z * CONFIG.SLIDE_INITIAL_SPEED;
            }
        } else if (!player.sliding) {
            player.crouching = true;
        }
    } else if (!input.crouch) {
        if (player.sliding) {
            player.sliding = false;
            player.slideCooldownTimer = CONFIG.SLIDE_COOLDOWN;
        }
        player.crouching = false;
    }

    // Slide timer tick
    if (player.sliding) {
        player.slideTimer -= dt;
        const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        // End slide if timer expires or speed drops too low
        if (player.slideTimer <= 0 || speed < CONFIG.SLIDE_MIN_SPEED) {
            player.sliding = false;
            player.slideCooldownTimer = CONFIG.SLIDE_COOLDOWN;
        }
    }
    if (player.slideCooldownTimer > 0) {
        player.slideCooldownTimer -= dt;
    }
}

// ─── Ground / Air Movement with Proper Acceleration ───
function applyGroundOrAirMovement(player, input, dt) {
    const forward = player.getForward();
    const right = player.getRight();

    let moveX = 0;
    let moveZ = 0;

    if (input.forward) { moveX += forward.x; moveZ += forward.z; }
    if (input.backward) { moveX -= forward.x; moveZ -= forward.z; }
    if (input.left) { moveX -= right.x; moveZ -= right.z; }
    if (input.right) { moveX += right.x; moveZ += right.z; }

    const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLen > 0) {
        moveX /= moveLen;
        moveZ /= moveLen;
    }

    // Determine target speed
    let targetSpeed = 0;
    if (moveLen > 0) {
        if (player.crouching) {
            targetSpeed = CONFIG.CROUCH_SPEED;
        } else if (input.backward && !input.forward) {
            targetSpeed = CONFIG.BACKWARD_SPEED;
        } else if (input.forward) {
            targetSpeed = CONFIG.SPRINT_SPEED;  // auto-sprint
        } else {
            targetSpeed = CONFIG.WALK_SPEED;    // pure strafe
        }
    }

    const isGrounded = player.grounded;

    // ─── Air momentum decay (always runs when airborne, regardless of input) ───
    // Bleeds excess speed above sprint speed at 75%/s — prevents infinite bunny-hop
    if (!isGrounded) {
        const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        const decayBase = CONFIG.SPRINT_SPEED;
        if (hSpeed > decayBase) {
            const excess = hSpeed - decayBase;
            const decayedExcess = excess * Math.exp(-0.288 * dt); // 75% retained/s
            const decayedSpeed = decayBase + decayedExcess;
            player.vx = (player.vx / hSpeed) * decayedSpeed;
            player.vz = (player.vz / hSpeed) * decayedSpeed;
        }
    }

    if (moveLen > 0) {
        if (isGrounded) {
            // Ground: accelerate toward target speed
            const factor = 1 - Math.exp(-CONFIG.GROUND_ACCEL * dt / targetSpeed);
            const targetVx = moveX * targetSpeed;
            const targetVz = moveZ * targetSpeed;
            player.vx += (targetVx - player.vx) * factor;
            player.vz += (targetVz - player.vz) * factor;

            // Decay excess speed on ground
            const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
            if (hSpeed > targetSpeed) {
                const excess = hSpeed - targetSpeed;
                const decayFactor = Math.exp(-CONFIG.GROUND_FRICTION * 0.5 * dt);
                const newSpeed = targetSpeed + excess * decayFactor;
                player.vx = (player.vx / hSpeed) * newSpeed;
                player.vz = (player.vz / hSpeed) * newSpeed;
            }
        } else {
            // Airborne with input: steer gently without re-inflating speed
            const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
            if (hSpeed > targetSpeed) {
                const steerFactor = 1 - Math.exp(-CONFIG.AIR_ACCEL * 0.3 * dt);
                player.vx += moveX * targetSpeed * steerFactor;
                player.vz += moveZ * targetSpeed * steerFactor;
                const newSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
                if (newSpeed > hSpeed * 1.05) {
                    const s = (hSpeed * 1.05) / newSpeed;
                    player.vx *= s; player.vz *= s;
                }
            } else {
                // Below target speed — normal air accel
                const factor = 1 - Math.exp(-CONFIG.AIR_ACCEL * dt / Math.max(targetSpeed, 0.1));
                player.vx += (moveX * targetSpeed - player.vx) * factor;
                player.vz += (moveZ * targetSpeed - player.vz) * factor;
            }
        }
    } else if (isGrounded) {
        // No input — apply friction to stop quickly
        const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        if (hSpeed > 0.05) {
            const decayFactor = Math.exp(-CONFIG.GROUND_FRICTION * dt);
            player.vx *= decayFactor;
            player.vz *= decayFactor;
        } else {
            player.vx = 0;
            player.vz = 0;
        }
    }
    // In air with no input: keep current velocity (air drift)
}

// ─── Slide Physics ───
function applySlidePhysics(player, input, dt) {
    const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);

    // Gradual deceleration during slide
    if (hSpeed > CONFIG.SLIDE_MIN_SPEED) {
        const decayFactor = Math.exp(-CONFIG.SLIDE_FRICTION * dt);
        player.vx *= decayFactor;
        player.vz *= decayFactor;
    }

    // Allow slight steering during slide (THE FINALS lets you turn slides a bit)
    const right = player.getRight();
    let steerX = 0, steerZ = 0;
    if (input.left) { steerX -= right.x; steerZ -= right.z; }
    if (input.right) { steerX += right.x; steerZ += right.z; }
    const steerLen = Math.sqrt(steerX * steerX + steerZ * steerZ);
    if (steerLen > 0) {
        const steerForce = 3.0; // subtle steering
        player.vx += (steerX / steerLen) * steerForce * dt;
        player.vz += (steerZ / steerLen) * steerForce * dt;
    }
}

// ─── Mantle ───
function processMantling(player, dt) {
    player.mantleTimer -= dt;
    const t = 1 - (player.mantleTimer / CONFIG.MANTLE_DURATION);
    // Ease-out cubic for a natural pull-up feel
    const smoothT = 1 - Math.pow(1 - t, 3);

    const halfHeight = CONFIG.PLAYER_HEIGHT / 2;
    player.y = player.mantleStartY + (player.mantleTargetY + halfHeight - player.mantleStartY) * smoothT;

    // Move forward during mantle
    if (player.mantleTargetX !== undefined) {
        player.x = player.mantleStartX + (player.mantleTargetX - player.mantleStartX) * smoothT;
        player.z = player.mantleStartZ + (player.mantleTargetZ - player.mantleStartZ) * smoothT;
    } else {
        const forward = player.getForward();
        player.x += forward.x * CONFIG.MANTLE_CHECK_DISTANCE * dt / CONFIG.MANTLE_DURATION;
        player.z += forward.z * CONFIG.MANTLE_CHECK_DISTANCE * dt / CONFIG.MANTLE_DURATION;
    }

    if (player.mantleTimer <= 0) {
        player.mantling = false;
        player.grounded = true;
        player.vy = 0;
        // Give a small forward boost after mantle for smooth flow
        const forward = player.getForward();
        player.vx = forward.x * CONFIG.MANTLE_FORWARD_BOOST;
        player.vz = forward.z * CONFIG.MANTLE_FORWARD_BOOST;
    }
}

// ─── Dash ───
function processDash(player, dt, collisionCheck) {
    player.dashTimer -= dt;

    if (collisionCheck) {
        // Sub-step to prevent tunneling through walls at dash speed
        const steps = 4;
        const stepDt = dt / steps;
        let blocked = false;
        for (let i = 0; i < steps; i++) {
            const newX = player.x + player.dashDirX * CONFIG.DASH_SPEED * stepDt;
            const newZ = player.z + player.dashDirZ * CONFIG.DASH_SPEED * stepDt;
            const result = collisionCheck(player, newX, player.y, newZ);
            player.x = result.x;
            player.y = result.y;
            player.z = result.z;
            if (result.wallHitX || result.wallHitZ) {
                player.dashing = false;
                player.vx = 0;
                player.vz = 0;
                blocked = true;
                break;
            }
        }
        if (blocked) return;
    } else {
        player.x += player.dashDirX * CONFIG.DASH_SPEED * dt;
        player.z += player.dashDirZ * CONFIG.DASH_SPEED * dt;
        const half = CONFIG.ARENA_SIZE / 2;
        player.x = Math.max(-half, Math.min(half, player.x));
        player.z = Math.max(-half, Math.min(half, player.z));
    }

    // Keep Y stable during dash (horizontal only) but still apply gravity lightly
    if (!player.grounded) {
        player.vy -= CONFIG.GRAVITY * 0.3 * dt; // reduced gravity during dash
        player.y += player.vy * dt;
    }

    if (player.dashTimer <= 0) {
        player.dashing = false;
        // Preserve momentum in dash direction
        player.vx = player.dashDirX * CONFIG.SPRINT_SPEED * 0.8;
        player.vz = player.dashDirZ * CONFIG.SPRINT_SPEED * 0.8;
    }
}

function startDash(player, input) {
    player.dashing = true;
    player.dashTimer = CONFIG.DASH_DURATION;

    // Determine dash direction from movement input, fallback to facing direction
    const forward = player.getForward();
    const right = player.getRight();
    let dirX = 0, dirZ = 0;

    if (input.forward) { dirX += forward.x; dirZ += forward.z; }
    if (input.backward) { dirX -= forward.x; dirZ -= forward.z; }
    if (input.left) { dirX -= right.x; dirZ -= right.z; }
    if (input.right) { dirX += right.x; dirZ += right.z; }

    const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dirLen > 0.1) {
        player.dashDirX = dirX / dirLen;
        player.dashDirZ = dirZ / dirLen;
    } else {
        // No movement input — dash in facing direction
        player.dashDirX = forward.x;
        player.dashDirZ = forward.z;
    }

    // Use a charge — only start the recharge timer on the FIRST dash from full charges
    if (player.dashCharges === CONFIG.DASH_CHARGES) {
        player.dashRechargeTimer = CONFIG.DASH_COOLDOWN;
    }
    player.dashCharges--;

    // Reduce vertical velocity during dash (not zero — allows slight drift)
    player.vy *= 0.2;
}

// ─── Mantle Detection ───
function checkMantle(player, collisionCheck) {
    if (!collisionCheck) return null;

    const forward = player.getForward();
    const checkDist = CONFIG.MANTLE_CHECK_DISTANCE;
    const checkX = player.x + forward.x * checkDist;
    const checkZ = player.z + forward.z * checkDist;
    const feetY = player.getFeetY();

    // Check if there's a wall in front at body level
    const wallCheck = collisionCheck(player, checkX, player.y, checkZ);
    if (wallCheck.wallHit) {
        const ledgeY = wallCheck.wallTopY || (feetY + CONFIG.MANTLE_REACH);
        const heightDiff = ledgeY - feetY;

        // Must be within mantle reach and not too small (avoid mantling tiny bumps)
        if (heightDiff <= CONFIG.MANTLE_REACH && heightDiff > 0.4) {
            return {
                targetY: ledgeY,
                targetX: checkX + forward.x * 0.3,
                targetZ: checkZ + forward.z * 0.3,
            };
        }
    }
    return null;
}

// ─── Velocity Application + Collision ───
function applyVelocity(player, dt, collisionCheck) {
    // Sub-step based on total speed to prevent tunneling through thin floors/walls.
    // Divisor of 3 ensures each sub-step moves ≤ 0.05m at max speeds (floor slab is 0.25m thick)
    const hSpeed = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
    const totalSpeed = Math.sqrt(hSpeed * hSpeed + player.vy * player.vy);
    const steps = Math.max(1, Math.ceil(totalSpeed / 3));
    const stepDt = dt / steps;

    for (let step = 0; step < steps; step++) {
        const newX = player.x + player.vx * stepDt;
        const newY = player.y + player.vy * stepDt;
        const newZ = player.z + player.vz * stepDt;

        if (collisionCheck) {
            const wasGrounded = player.grounded;
            const landingVy = player.vy;
            const result = collisionCheck(player, newX, newY, newZ);
            player.x = result.x;
            player.y = result.y;
            player.z = result.z;
            if (result.groundHit) {
                // Landing: bleed excess horizontal speed so bunny-hopping drains momentum
                if (!wasGrounded && landingVy < -1) {
                    const hs = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
                    if (hs > CONFIG.SPRINT_SPEED) {
                        const excess = hs - CONFIG.SPRINT_SPEED;
                        const newHs = CONFIG.SPRINT_SPEED + excess * 0.35; // keep 35% of excess on landing
                        player.vx = (player.vx / hs) * newHs;
                        player.vz = (player.vz / hs) * newHs;
                    }
                }
                player.grounded = true;
                if (player.vy < 0) player.vy = 0;
            } else {
                player.grounded = false;
            }
            if (result.ceilingHit && player.vy > 0) player.vy = 0;
            if (result.wallHitX) player.vx = 0;
            if (result.wallHitZ) player.vz = 0;
        } else {
            player.x = newX;
            player.y = newY;
            player.z = newZ;

            // Simple ground check (flat ground at y=0)
            const halfHeight = player.crouching ? CONFIG.PLAYER_CROUCH_HEIGHT / 2 : CONFIG.PLAYER_HEIGHT / 2;
            if (player.y - halfHeight <= 0) {
                player.y = halfHeight;
                player.grounded = true;
                if (player.vy < 0) player.vy = 0;
            } else {
                player.grounded = false;
            }

            // Arena boundary clamping
            const half = CONFIG.ARENA_SIZE / 2;
            if (player.x < -half) { player.x = -half; player.vx = 0; }
            if (player.x > half) { player.x = half; player.vx = 0; }
            if (player.z < -half) { player.z = -half; player.vz = 0; }
            if (player.z > half) { player.z = half; player.vz = 0; }
        }

        // No horizontal velocity left — no point continuing sub-steps
        if (player.vx === 0 && player.vz === 0) break;
    }
}
