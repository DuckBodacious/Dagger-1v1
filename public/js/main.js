import * as THREE from 'three';
import { CONFIG } from './config.js?v=8';
import { InputManager } from './input.js?v=8';
import { PlayerState } from './player.js?v=8';
import { processMovement } from './movement.js?v=8';
import { processCombat } from './combat.js?v=8';
import { NetworkClient } from './network.js?v=8';
import { GameRenderer } from './renderer.js?v=8';
import { HUD } from './hud.js?v=8';
import { EffectsManager } from './effects.js?v=8';
import { checkCollision } from './arena.js?v=8';
import { DestructibleManager } from './destructible.js?v=8';
import { AudioManager } from './audio.js?v=8';
import { JumpPadManager } from './jumppad.js?v=8';
import { GatewayManager } from './gateway.js?v=8';

// ─── Game State ───
let localPlayer = null;
let remotePlayers = new Map();  // id → { state, prevState, renderState }
let gameActive = false;
let prevGameActive = false;
let killGoal = 10;
let prevLocalAttackState = 'idle';
let prevLocalHp = CONFIG.PLAYER_HP;
let localDashStart = null;  // { x, y, z } for dash trail
let prevLocalAlive = true;
let jumpPadCooldown = 0;
let padMode = false;       // true while player has the pad equipped
let padHeldMesh = null;    // the pad disc shown in hand while pad mode is active
let jumpPads = null;
let gateways = null;
let gatewayCooldown = 0;   // client-side mirror of server cooldown (for HUD only)
let gatewayCount = 0;      // 0=none, 1=first placed, 2=both placed
let gatewayMode = false;   // true while player is "holding" the gateway cube
let gatewayHeldMesh = null; // the black cube shown in hand during gateway mode

// ─── Lobby State ───
let isHost = false;
let localDisplayId = 1;
let lobbyState = { humanSlots: 1, botCount: 1, killGoal: 10, players: [] };

// ─── Carry State ───
let carriedObjectId = null;
let carriedObjectMesh = null;
let carriedObjectType = null; // 'crate' | 'explosive' | 'goo'

// ─── Initialize ───
const canvas = document.getElementById('game-canvas');
const renderer = new GameRenderer(canvas);
const input = new InputManager(canvas);
const network = new NetworkClient();
const hud = new HUD();
const effects = new EffectsManager(renderer.scene, renderer.camera);
const destructibles = new DestructibleManager(renderer.scene, effects);
destructibles.registerFromArena(renderer.arenaData?.meshes || []);
jumpPads = new JumpPadManager(renderer.scene);
gateways = new GatewayManager(renderer.scene);
const audio = new AudioManager();

// Initialize audio on first user interaction (browser autoplay policy)
const initAudio = () => {
    audio.init();
    document.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
};
document.addEventListener('click', initAudio);
document.addEventListener('keydown', initAudio);

// ─── Network Callbacks ───
network.onConnected = (playerId, hostFlag, displayId) => {
    localDisplayId = displayId ?? playerId;
    console.log(`[Client] Connected as Player ${localDisplayId} (host=${hostFlag})`);
    localPlayer = new PlayerState(playerId);
    isHost = !!hostFlag;
    hud.showConnecting(false);
    hud.showLobby(true);
    updateLobbyUI();
};

network.onGameState = (state) => {
    prevGameActive = gameActive;
    gameActive = state.gameActive;
    killGoal = state.killGoal;

    if (!localPlayer) return;

    const serverLocal = state.players.find(p => p.id === localPlayer.id);
    if (serverLocal) {
        // Sync position on game start (alive→alive transition skips the respawn check)
        if (gameActive && !prevGameActive) {
            localPlayer.x = serverLocal.x;
            localPlayer.y = serverLocal.y;
            localPlayer.z = serverLocal.z;
            localPlayer.vx = 0; localPlayer.vy = 0; localPlayer.vz = 0;
            localPlayer.yaw = serverLocal.yaw;
            localPlayer.pitch = 0;
            prevLocalAlive = false; // ensure respawn detection re-arms properly
            gateways?.clear();
            gatewayCooldown = 0;
            gatewayCount = 0;
            gatewayMode = false;
            if (gatewayHeldMesh) { renderer.scene.remove(gatewayHeldMesh); gatewayHeldMesh = null; }
        }

        // Detect HP change for damage effects
        if (serverLocal.hp < prevLocalHp && serverLocal.alive) {
            const damage = prevLocalHp - serverLocal.hp;
            hud.showDamageVignette();
            effects.triggerScreenShake(0.3 + damage / 150, 0.2);
            audio.playHitLocal(damage >= 100);

            // Find attacker for damage direction
            for (const ps of state.players) {
                if (ps.id !== localPlayer.id && ps.alive &&
                    (ps.attackState === 'primary' || ps.attackState === 'charged_attack' || ps.attackState === 'elbow')) {
                    const angle = Math.atan2(ps.x - localPlayer.x, ps.z - localPlayer.z);
                    hud.showDamageDirection(angle, localPlayer.yaw);
                    break;
                }
            }
        }
        // Detect death
        if (!serverLocal.alive && prevLocalHp > 0) {
            audio.playDeath();
        }
        prevLocalHp = serverLocal.hp;

        // Detect respawn (dead → alive) — hard sync position from server
        if (serverLocal.alive && !prevLocalAlive) {
            renderer.triggerRespawnFade();
            prevLocalHp = CONFIG.PLAYER_HP;
            jumpPadCooldown = 0;
            localPlayer.x = serverLocal.x;
            localPlayer.y = serverLocal.y;
            localPlayer.z = serverLocal.z;
            localPlayer.vx = 0; localPlayer.vy = 0; localPlayer.vz = 0;
            localPlayer.yaw = serverLocal.yaw;
            localPlayer.pitch = 0;
        }
        prevLocalAlive = serverLocal.alive;

        // Apply authoritative game state — non-positional only.
        // Position, velocity, and physics states (grounded/sliding/dashing) are
        // handled by local prediction. Syncing them from the server causes movement
        // bugs because the server only processes the last received input per tick
        // while the client applies every input at full frame rate.
        localPlayer.hp = serverLocal.hp;
        localPlayer.alive = serverLocal.alive;
        localPlayer.kills = serverLocal.kills;
        localPlayer.deaths = serverLocal.deaths;
        localPlayer.dashCharges = serverLocal.dashCharges;
        localPlayer.dashRechargeTimer = serverLocal.dashRechargeTimer ?? 0;
        localPlayer.attackState = serverLocal.attackState;
        localPlayer.chargeTimer = serverLocal.chargeTimer;
        localPlayer.regenActive = serverLocal.regenActive || false;
        localPlayer.crouching = serverLocal.crouching;
        gatewayCooldown = serverLocal.gatewayCooldown ?? 0;
        gatewayCount    = serverLocal.gatewayCount    ?? 0;

        // Sync carried object id from server
        const prevCarried = carriedObjectId;
        carriedObjectId = serverLocal.carriedObjectId ?? null;
        // If we dropped/threw the object on server side, clean up the mesh
        if (prevCarried !== null && carriedObjectId === null && carriedObjectMesh) {
            renderer.scene.remove(carriedObjectMesh);
            carriedObjectMesh.geometry.dispose();
            carriedObjectMesh.material.dispose();
            carriedObjectMesh = null;
            carriedObjectType = null;
        }
    }

    // Update remote players
    for (const ps of state.players) {
        if (ps.id === localPlayer.id) continue;
        if (!remotePlayers.has(ps.id)) {
            remotePlayers.set(ps.id, {
                state: new PlayerState(ps.id),
                prevState: { ...ps },
                renderState: { ...ps },
                prevAttackState: 'idle',
                prevDashing: false,
                prevHp: CONFIG.PLAYER_HP,
            });
        }
        // Apply chosen character color to the remote mesh
        if (ps.color) renderer.setPlayerColor(ps.id, ps.color);
        // Bots get a black identifying stripe
        if (ps.isBot) renderer.markAsBot(ps.id);
        const remote = remotePlayers.get(ps.id);
        remote.prevState = { ...remote.renderState };
        remote.state.deserialize(ps);

        // Detect remote player attack for audio + visual effects
        if (ps.attackState !== remote.prevAttackState) {
            const rrs = remote.renderState;
            const remotePos = new THREE.Vector3(rrs.x, rrs.y + 0.5, rrs.z);
            const remoteFwd = new THREE.Vector3(-Math.sin(ps.yaw), 0, -Math.cos(ps.yaw));
            if (ps.attackState === 'primary') {
                audio.play3D('swing', ps.x, ps.y, ps.z, 0.3, 0.95 + Math.random() * 0.1, 5);
                effects.spawnSlashTrail(remotePos.clone().add(remoteFwd.clone().multiplyScalar(0.5)), remoteFwd, false);
            } else if (ps.attackState === 'charged_attack') {
                audio.play3D('heavySwing', ps.x, ps.y, ps.z, 0.4, 0.85, 6);
                effects.spawnSlashTrail(remotePos.clone().add(remoteFwd.clone().multiplyScalar(0.7)), remoteFwd, true);
            } else if (ps.attackState === 'elbow') {
                audio.play3D('elbow', ps.x, ps.y, ps.z, 0.35, 1.0, 5);
                effects.spawnElbowEffect(remotePos.clone().add(remoteFwd.clone().multiplyScalar(0.4)));
            }
        }
        remote.prevAttackState = ps.attackState;

        // Detect remote dash start for trail + audio
        if (ps.dashing && !remote.prevDashing) {
            const startPos = new THREE.Vector3(remote.renderState.x, remote.renderState.y, remote.renderState.z);
            const fwd = remote.state.getForward();
            const endPos = new THREE.Vector3(
                startPos.x + fwd.x * CONFIG.DASH_DISTANCE,
                startPos.y,
                startPos.z + fwd.z * CONFIG.DASH_DISTANCE
            );
            effects.spawnDashTrail(startPos, endPos);
            audio.playDash3D(ps.x, ps.y, ps.z);
        }
        remote.prevDashing = ps.dashing;

    }
};

network.onLobbyState = (msg) => {
    lobbyState = msg;
    // Apply each player's chosen color to their in-world mesh (persists into the game)
    for (const p of msg.players || []) {
        if (p.color) renderer.setPlayerColor(p.id, p.color);
    }
    updateLobbyUI();
};

network.onPromotedToHost = () => {
    isHost = true;
    updateLobbyUI();
};

network.onPlayerJoined = (playerId) => {
    console.log(`[Client] Player ${playerId} joined`);
};

network.onPlayerLeft = (playerId) => {
    console.log(`[Client] Player ${playerId} left`);
    remotePlayers.delete(playerId);
    renderer.removePlayerMesh(playerId);

    // If the game was running, the opponent left — return to lobby
    if (gameActive) {
        gameActive = false;
        hud.showDeathScreen(false, 0);
        hud.showLobby(true);
        document.exitPointerLock();
        updateLobbyUI();
    }
};

network.onHitConfirm = (msg) => {
    hud.showHitMarker(msg.backstab, msg.damage);
    effects.triggerScreenShake(msg.backstab ? 0.5 : 0.15, msg.backstab ? 0.25 : 0.1);

    // Backstab sound plays immediately as 2D (doesn't need target position)
    if (msg.backstab) {
        audio.playHitLocal(true);
    }

    // Spawn particles at the target's position
    const remote = remotePlayers.get(msg.targetId);
    if (remote) {
        const pos = new THREE.Vector3(remote.renderState.x, remote.renderState.y + 0.5, remote.renderState.z);
        if (msg.backstab) {
            effects.spawnBackstabParticles(pos);
        } else {
            effects.spawnHitParticles(pos, 0xff4444, msg.damage > 50 ? 12 : 6);
            audio.playHit3D(remote.renderState.x, remote.renderState.y, remote.renderState.z, false);
        }
        // Flash the remote player's mesh white
        renderer.flashPlayerHit(msg.targetId);
    }
};

network.onKillFeed = (msg) => {
    const killerName = `Player ${msg.killerDisplayId ?? msg.killerId}`;
    const victimName = `Player ${msg.victimDisplayId ?? msg.victimId}`;
    hud.addKillFeedEntry(killerName, victimName, msg.weapon);
    // Play kill confirm if we got the kill
    if (localPlayer && msg.killerId === localPlayer.id) {
        audio.playKillConfirm();
    }
};

network.onDestruction = (msg) => {
    destructibles.applyDestruction(msg);
    // Spatial audio for destruction events
    if (msg.action === 'explode') {
        audio.playExplosion(msg.x, msg.y, msg.z);
    } else if (msg.action === 'goo') {
        audio.playGoo(msg.x, msg.y || 0, msg.z);
    }
};

network.onGatewayEvent = (msg) => {
    if (!gateways) return;
    if (msg.type === 'gateway_placed') {
        gateways.onGatewayPlaced(msg);
        if (msg.ownerId === localPlayer?.id) gatewayCount = msg.linked ? 2 : 1;
    } else if (msg.type === 'gateway_linked') {
        gateways.onGatewayLinked(msg.aId);
    } else if (msg.type === 'gateway_expired') {
        gateways.onGatewayExpired(msg.aId, msg.bId);
        if (msg.ownerId === localPlayer?.id) gatewayCount = 0;
    } else if (msg.type === 'gateway_teleport') {
        if (msg.playerId === localPlayer?.id && localPlayer) {
            // Snap local player to teleport destination
            localPlayer.x = msg.toX;
            localPlayer.y = msg.toY + CONFIG.PLAYER_HEIGHT / 2;
            localPlayer.z = msg.toZ;
            localPlayer.vx = 0; localPlayer.vy = 0; localPlayer.vz = 0;
        }
    }
};

network.onJumpPadEvent = (msg) => {
    if (!jumpPads) return;
    if (msg.type === 'jumppad_placed') {
        jumpPads.onPadPlaced(msg);
    } else if (msg.type === 'jumppad_removed') {
        jumpPads.onPadRemoved(msg.id);
    } else if (msg.type === 'jumppad_triggered') {
        jumpPads.onPadTriggered(msg.id);
        if (msg.playerId === localPlayer?.id) {
            audio.playJumpPad();
            // Apply launch velocity from server — jump pads fire server-side so
            // local prediction never sees the velocity without this explicit sync.
            if (localPlayer && msg.vx !== undefined) {
                localPlayer.vx = msg.vx;
                localPlayer.vy = msg.vy;
                localPlayer.vz = msg.vz;
                localPlayer.grounded = false;
            }
        }
    }
};

network.onObjectEvent = (msg) => {
    destructibles.handleObjectEvent(msg);
};

network.onGameStart = (msg) => {
    killGoal = msg.killGoal;
    // Do NOT set gameActive here — let onGameState set it so prevGameActive stays
    // false for the first snapshot, which triggers the position sync block below.
    prevLocalHp = CONFIG.PLAYER_HP;
    hud.showLobby(false);
    // Show pointer lock prompt if mouse isn't already locked
    if (clickToPlayEl && document.pointerLockElement !== canvas) {
        clickToPlayEl.style.display = 'flex';
    }
    console.log(`[Client] Game started! First to ${killGoal}`);
};

// Handle game over
const origOnMessage = network.handleMessage.bind(network);
network.handleMessage = (msg) => {
    origOnMessage(msg);
    if (msg.type === 'game_over' && localPlayer) {
        hud.showGameOver(msg.winnerId, localPlayer.id, msg.scores);
    }
    if (msg.type === 'lobby_state') {
        // Re-enable start button if it was disabled
        const btn = document.getElementById('start-btn');
        if (btn) { btn.textContent = 'START GAME'; btn.disabled = false; }
    }
};

// ─── Lobby UI ───

// Character color palette — must match PLAYER_COLORS in server.js
const COLORS = [
    { hex: '#22c55e', name: 'Green' },
    { hex: '#92400e', name: 'Brown' },
    { hex: '#ef4444', name: 'Red' },
    { hex: '#f97316', name: 'Orange' },
    { hex: '#eab308', name: 'Yellow' },
    { hex: '#a855f7', name: 'Purple' },
    { hex: '#06b6d4', name: 'Cyan' },
    { hex: '#1e3a8a', name: 'Dark Blue' },
    { hex: '#ec4899', name: 'Pink' },
    { hex: '#14b8a6', name: 'Teal' },
    { hex: '#84cc16', name: 'Lime' },
    { hex: '#e5e7eb', name: 'White' },
];

function buildColorSwatches(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const players = lobbyState.players || [];
    const myColor = players.find(p => p.id === localPlayer?.id)?.color;
    // Colors taken by OTHER players
    const takenByOthers = new Set(
        players.filter(p => p.id !== localPlayer?.id && p.color).map(p => p.color)
    );

    container.innerHTML = '';
    for (const c of COLORS) {
        const btn = document.createElement('button');
        btn.className = 'color-swatch' +
            (c.hex === myColor ? ' selected' : '') +
            (takenByOthers.has(c.hex) ? ' taken' : '');
        btn.style.background = c.hex;
        btn.title = c.name + (takenByOthers.has(c.hex) ? ' (taken)' : '');
        btn.disabled = takenByOthers.has(c.hex);
        btn.addEventListener('click', () => {
            if (takenByOthers.has(c.hex)) return;
            network.sendPlayerColor(c.hex);
        });
        container.appendChild(btn);
    }
}

function buildPlayerChip(p) {
    const chip  = document.createElement('div');
    const isYou = p.id === localPlayer?.id;
    const name  = isYou ? `You  P${p.displayId}` : `Player  P${p.displayId}`;

    chip.className = 'lobby-player-chip' +
        (isYou    ? ' is-you'  : '') +
        (p.isHost ? ' is-host' : '') +
        (p.ready && !p.isHost ? ' is-ready' : '');

    // Color dot showing the player's chosen character color
    if (p.color) {
        const colorDot = document.createElement('span');
        colorDot.className = 'player-color-dot';
        colorDot.style.background = p.color;
        chip.appendChild(colorDot);
    }

    if (p.isHost) {
        chip.appendChild(document.createTextNode(' ' + name + '  ★ HOST'));
    } else {
        const dot = document.createElement('span');
        dot.className   = 'ready-dot ' + (p.ready ? 'dot-ready' : 'dot-waiting');
        dot.textContent = p.ready ? ' ●' : ' ○';
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode('  ' + name + '  —  ' + (p.ready ? 'READY' : 'NOT READY')));
    }
    return chip;
}

function updateLobbyUI() {
    const hostConfig   = document.getElementById('host-config');
    const waitingPanel = document.getElementById('waiting-panel');
    const startBtn     = document.getElementById('start-btn');
    const readyBtn     = document.getElementById('ready-btn');

    const players      = lobbyState.players || [];
    const nonHosts     = players.filter(p => !p.isHost);
    const allReady     = nonHosts.length === 0 || nonHosts.every(p => p.ready);
    const me           = players.find(p => p.id === localPlayer?.id);
    const imReady      = me?.ready ?? false;

    if (isHost) {
        hostConfig.style.display   = 'block';
        waitingPanel.style.display = 'none';
        startBtn.style.display     = 'inline-block';

        // Counters
        document.getElementById('humans-display').textContent = lobbyState.humanSlots ?? 1;
        document.getElementById('bots-display').textContent   = lobbyState.botCount   ?? 1;
        document.getElementById('goal-display').textContent   = lobbyState.killGoal   ?? 10;

        // Start button — disabled until everyone is ready
        // Only update when not mid-launch ('Starting…' means we already sent the message)
        if (startBtn.textContent !== 'Starting...') {
            startBtn.disabled    = !allReady;
            startBtn.textContent = allReady ? 'START GAME' : 'WAITING FOR PLAYERS…';
        }

        // Color swatches
        buildColorSwatches('color-swatches-host');

        // Player list with ready indicators
        const list = document.getElementById('lobby-player-list');
        list.innerHTML = '';
        for (const p of players) list.appendChild(buildPlayerChip(p));

    } else {
        hostConfig.style.display   = 'none';
        waitingPanel.style.display = 'block';
        startBtn.style.display     = 'none';

        // Config summary
        const cfgDisplay = document.getElementById('lobby-config-display');
        if (cfgDisplay) cfgDisplay.textContent =
            `${lobbyState.humanSlots ?? '?'} Players  ·  ${lobbyState.botCount ?? '?'} Bots  ·  First to ${lobbyState.killGoal ?? '?'} kills`;

        // Ready button — grey/disabled when ready, normal when not
        if (readyBtn) {
            readyBtn.textContent = imReady ? 'READY ✓' : 'READY UP';
            readyBtn.disabled    = imReady;
            readyBtn.classList.toggle('is-ready', imReady);
        }

        // Color swatches
        buildColorSwatches('color-swatches-guest');

        // Player list with ready indicators
        const list = document.getElementById('lobby-player-list-nonhost');
        list.innerHTML = '';
        for (const p of players) list.appendChild(buildPlayerChip(p));
    }
}

// Counter buttons (host only)
function clampLobbyConfig() {
    const maxBots = 4 - lobbyState.humanSlots;
    if (lobbyState.botCount > maxBots) lobbyState.botCount = Math.max(0, maxBots);
}

document.getElementById('humans-minus')?.addEventListener('click', () => {
    if (!isHost) return;
    lobbyState.humanSlots = Math.max(1, (lobbyState.humanSlots || 1) - 1);
    clampLobbyConfig();
    network.sendLobbyConfig({ humanSlots: lobbyState.humanSlots, botCount: lobbyState.botCount });
    updateLobbyUI();
});
document.getElementById('humans-plus')?.addEventListener('click', () => {
    if (!isHost) return;
    const newVal = Math.min(4, (lobbyState.humanSlots || 1) + 1);
    if (newVal + (lobbyState.botCount || 0) > 4) return; // total cap
    lobbyState.humanSlots = newVal;
    network.sendLobbyConfig({ humanSlots: lobbyState.humanSlots });
    updateLobbyUI();
});
document.getElementById('bots-minus')?.addEventListener('click', () => {
    if (!isHost) return;
    lobbyState.botCount = Math.max(0, (lobbyState.botCount || 0) - 1);
    network.sendLobbyConfig({ botCount: lobbyState.botCount });
    updateLobbyUI();
});
document.getElementById('bots-plus')?.addEventListener('click', () => {
    if (!isHost) return;
    const newBots = Math.min(3, (lobbyState.botCount || 0) + 1);
    if ((lobbyState.humanSlots || 1) + newBots > 4) return; // total cap
    lobbyState.botCount = newBots;
    network.sendLobbyConfig({ botCount: lobbyState.botCount });
    updateLobbyUI();
});
document.getElementById('goal-minus')?.addEventListener('click', () => {
    if (!isHost) return;
    lobbyState.killGoal = Math.max(1, (lobbyState.killGoal || 10) - 1);
    network.sendLobbyConfig({ killGoal: lobbyState.killGoal });
    updateLobbyUI();
});
document.getElementById('goal-plus')?.addEventListener('click', () => {
    if (!isHost) return;
    lobbyState.killGoal = Math.min(100, (lobbyState.killGoal || 10) + 1);
    network.sendLobbyConfig({ killGoal: lobbyState.killGoal });
    updateLobbyUI();
});

// Start button (host only)
document.getElementById('start-btn')?.addEventListener('click', () => {
    if (!isHost) return;
    network.sendStartGame();
    const btn = document.getElementById('start-btn');
    if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }
});

// Ready button (non-host only)
document.getElementById('ready-btn')?.addEventListener('click', () => {
    if (isHost) return;
    const me = (lobbyState.players || []).find(p => p.id === localPlayer?.id);
    const imReady = me?.ready ?? false;
    const nextReady = !imReady;

    // Optimistically update local state — the server now echoes `ready` back in
    // lobby_state so this no longer flashes back to the old value.
    if (me) me.ready = nextReady;
    updateLobbyUI();

    network.sendPlayerReady(nextReady);
});

// Volume slider
document.getElementById('volume-slider')?.addEventListener('input', (e) => {
    audio.setMasterVolume(parseInt(e.target.value) / 100);
});

// ─── Pointer lock overlay ───
const clickToPlayEl = document.getElementById('click-to-play');

// Show "click to play" when game active and pointer not locked (e.g. after Escape)
document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (clickToPlayEl) {
        clickToPlayEl.style.display = (gameActive && !locked) ? 'flex' : 'none';
    }
    // Also reinitialize audio context if suspended (browser may suspend on focus loss)
    if (locked && audio.ctx?.state === 'suspended') {
        audio.ctx.resume();
    }
});

// Clicking the overlay requests pointer lock
clickToPlayEl?.addEventListener('click', () => {
    canvas.requestPointerLock();
});

// ─── Connect ───
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;
network.connect(wsUrl);
hud.showConnecting(true);

// ─── Game Loop ───
let lastTime = performance.now();

function gameLoop(currentTime) {
    requestAnimationFrame(gameLoop);

    const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
    lastTime = currentTime;

    if (!localPlayer) return;

    // ─── Pre-game: black screen, no inputs/audio/movement ───
    if (!gameActive) {
        // Drain any accumulated mouse deltas so first tick doesn't lurch
        input.getInputState();
        return;
    }

    // ─── Input ───
    const inputState = input.getInputState();

    // ─── Pickup / Throw / Drop intercept ───
    if (localPlayer?.alive) {
        if (inputState.interact && carriedObjectId === null) {
            // Pickup: send raw message, don't forward interact in normal input
            network.sendRaw({ type: 'pickup_object' });
        } else if (inputState.primaryAttack && carriedObjectId !== null) {
            // Throw: intercept left-click while carrying
            network.sendRaw({ type: 'throw_object' });
        } else if (inputState.rightClickJust && carriedObjectId !== null) {
            // Drop: intercept right-click while carrying
            network.sendRaw({ type: 'drop_object' });
        }
    }

    // Build the input to send to the server (suppress attacks while carrying).
    // Include client position + yaw so the server uses the correct position for
    // hit detection instead of its own drifted simulation.
    const serverInput = {
        ...((carriedObjectId !== null || gatewayMode || padMode)
            ? { ...inputState, primaryAttack: false, chargedAttack: false, elbow: false }
            : inputState),
        px: localPlayer.x,
        py: localPlayer.y,
        pz: localPlayer.z,
        pyaw: localPlayer.yaw,
    };

    if (network.connected) {
        network.sendInput(serverInput);
    }

    // ─── Jump Pad (toggle [2]) ───
    if (jumpPadCooldown > 0) jumpPadCooldown -= dt;

    // Toggle pad mode on/off with [2]
    if (inputState.digit2Just && localPlayer?.alive) {
        if (padMode) padMode = false;
        else if (jumpPadCooldown <= 0) {
            padMode = true;
            if (gatewayMode) { gatewayMode = false; if (gatewayHeldMesh) { renderer.scene.remove(gatewayHeldMesh); gatewayHeldMesh = null; } }
        }
    }
    // Auto-exit when not valid
    if (padMode && (!localPlayer?.alive || jumpPadCooldown > 0)) padMode = false;

    if (padMode) {
        // ── Held pad mesh ──────────────────────────────────────────────────────
        if (!padHeldMesh) {
            const group = new THREE.Group();
            const baseMat = new THREE.MeshStandardMaterial({
                color: 0x333333, emissive: 0x333333, emissiveIntensity: 0.4,
                metalness: 0.3, roughness: 0.5,
            });
            group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.07, 32), baseMat));
            const ringMat = new THREE.MeshStandardMaterial({
                color: 0x1a3a8f, emissive: 0x1a3a8f, emissiveIntensity: 0.7,
                metalness: 0.5, roughness: 0.3,
            });
            const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 12, 48), ringMat);
            outerRing.rotation.x = Math.PI / 2; outerRing.position.y = 0.06;
            group.add(outerRing);
            const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 12, 48), ringMat);
            innerRing.rotation.x = Math.PI / 2; innerRing.position.y = 0.06;
            group.add(innerRing);
            group.scale.setScalar(0.28);
            padHeldMesh = group;
            renderer.scene.add(padHeldMesh);
        }
        const cam   = renderer.camera;
        const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up    = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        padHeldMesh.position.copy(cam.position)
            .addScaledVector(fwd,   0.55)
            .addScaledVector(right, 0.22)
            .addScaledVector(up,   -0.18);
        padHeldMesh.rotation.copy(cam.rotation);

        // ── Raycast preview + placement ────────────────────────────────────────
        const hit = jumpPads.getPlacementTarget(renderer.camera);
        jumpPads.updatePreview(hit);
        if (inputState.leftClickJust && hit) {
            network.sendRaw({ type: 'place_jumppad', x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz });
            jumpPadCooldown = CONFIG.JUMP_PAD_COOLDOWN;
            padMode = false;
            jumpPads.updatePreview(null);
        }
    } else {
        jumpPads.updatePreview(null);
        if (padHeldMesh) { renderer.scene.remove(padHeldMesh); padHeldMesh = null; }
    }

    hud.updateJumpPadCooldown(Math.max(0, jumpPadCooldown), CONFIG.JUMP_PAD_COOLDOWN);

    // ─── Gateway mode toggle (Q) ───
    if (inputState.qKeyJust && localPlayer?.alive) {
        if (gatewayMode) {
            // Q again → exit mode
            gatewayMode = false;
        } else if (gatewayCooldown <= 0 && gatewayCount < 2 && !gateways.hasInFlight()) {
            gatewayMode = true;
            if (padMode) { padMode = false; if (padHeldMesh) { renderer.scene.remove(padHeldMesh); padHeldMesh = null; } }
        }
    }
    // Auto-exit mode when conditions are no longer valid
    if (gatewayMode && (!localPlayer?.alive || gatewayCooldown > 0 || gatewayCount >= 2)) {
        gatewayMode = false;
    }

    // ─── Held gateway cube (shown in first-person while in gateway mode) ───
    if (gatewayMode && localPlayer?.alive && !gateways.hasInFlight()) {
        if (!gatewayHeldMesh) {
            const geo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x0a0a0a,
                emissive: 0x000000,
                metalness: 0.9,
                roughness: 0.2,
            });
            gatewayHeldMesh = new THREE.Mesh(geo, mat);
            renderer.scene.add(gatewayHeldMesh);
        }
        // Position in front-right-below the camera (matching barrel carry)
        const cam  = renderer.camera;
        const fwd  = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up   = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        gatewayHeldMesh.position.copy(cam.position)
            .addScaledVector(fwd,   0.55)
            .addScaledVector(right, 0.22)
            .addScaledVector(up,   -0.18);
        gatewayHeldMesh.rotation.copy(cam.rotation);
        gatewayHeldMesh.rotation.y += Math.PI / 6; // slight yaw to look natural
    } else {
        // Remove held mesh when not in gateway mode
        if (gatewayHeldMesh) {
            renderer.scene.remove(gatewayHeldMesh);
            gatewayHeldMesh = null;
        }
    }

    // ─── Gateway throw (left-click while in gateway mode) ───
    if (gatewayMode && localPlayer?.alive && inputState.leftClickJust && !gateways.hasInFlight()) {
        gatewayMode = false; // exit mode immediately — cube flies off
        // Use camera's full 3D direction so pitch is respected (aimed up = stays airborne)
        const camDir = new THREE.Vector3();
        renderer.camera.getWorldDirection(camDir);
        gateways.startThrow(
            localPlayer.x, localPlayer.y, localPlayer.z,
            camDir.x, camDir.y, camDir.z,
            (landX, landY, landZ) => {
                network.sendRaw({ type: 'throw_gateway', x: landX, y: landY, z: landZ });
            }
        );
    }

    // Cancel in-flight throw if player died
    if (!localPlayer?.alive && gateways.hasInFlight()) {
        gateways.cancelInFlight();
    }

    // E key — teleport through nearest linked gateway
    if (localPlayer?.alive && inputState.useGateway) {
        if (gateways.isNearLinked(localPlayer.x, localPlayer.y, localPlayer.z)) {
            network.sendRaw({ type: 'use_gateway' });
        }
    }

    gateways.update(dt);
    hud.updateGatewayCooldown(gatewayCooldown, gatewayCount, CONFIG.GATEWAY_COOLDOWN,
        gateways.isNearLinked(localPlayer?.x ?? 0, localPlayer?.y ?? 0, localPlayer?.z ?? 0));
    hud.showRegenIndicator(!!(localPlayer && localPlayer.regenActive));

    // ─── Local prediction ───
    if (localPlayer.alive) {
        // Track dash start for local trail
        const wasDashing = localPlayer.dashing;
        const wasGrounded = localPlayer.grounded;
        const wasSliding = localPlayer.sliding;
        const prevVy = localPlayer.vy;

        processMovement(localPlayer, inputState, dt, checkCollision);
        processCombat(localPlayer, inputState, dt);

        // ─── Audio: Jump / Land ───
        if (!localPlayer.grounded && wasGrounded && localPlayer.vy > 0) {
            audio.playJump();
        }
        if (localPlayer.grounded && !wasGrounded && prevVy < -2) {
            audio.playLand(prevVy);
        }

        // ─── Audio: Slide start/stop ───
        if (localPlayer.sliding && !wasSliding) {
            audio.startSlideSound();
        }
        if (!localPlayer.sliding && wasSliding) {
            audio.stopSlideSound();
        }

        // ─── Audio: Footsteps ───
        audio.updateFootsteps(localPlayer, dt);

        // ─── Client-side jump pad detection ───────────────────────────────────
        // Server can't reliably trigger pads because local position is no longer
        // reconciled. Detect proximity here and ask the server to fire the pad.
        if (localPlayer.grounded && jumpPads) {
            const TRIGGER_R = CONFIG.JUMP_PAD_TRIGGER_RADIUS ?? 0.9;
            for (const [padId, entry] of jumpPads.pads) {
                const pd = entry.data;
                const dx = localPlayer.x - pd.x;
                const dz = localPlayer.z - pd.z;
                if (Math.sqrt(dx * dx + dz * dz) < TRIGGER_R) {
                    network.sendRaw({ type: 'trigger_jumppad', padId });
                    break;
                }
            }
        }

        // Detect local dash start
        if (localPlayer.dashing && !wasDashing) {
            localDashStart = { x: localPlayer.x, y: localPlayer.y, z: localPlayer.z };
            audio.playDash();
        }
        if (!localPlayer.dashing && wasDashing && localDashStart) {
            const startPos = new THREE.Vector3(localDashStart.x, localDashStart.y, localDashStart.z);
            const endPos = new THREE.Vector3(localPlayer.x, localPlayer.y, localPlayer.z);
            effects.spawnDashTrail(startPos, endPos);
            localDashStart = null;
        }

        // Detect local attack state changes for first-person effects + audio
        if (localPlayer.attackState !== prevLocalAttackState) {
            const camPos = renderer.camera.position.clone();
            const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(renderer.camera.quaternion);

            if (localPlayer.attackState === 'primary') {
                effects.spawnSlashTrail(camPos.add(camDir.multiplyScalar(0.5)), camDir, false);
                audio.playSwing();
            } else if (localPlayer.attackState === 'charged_attack') {
                effects.spawnSlashTrail(camPos.add(camDir.multiplyScalar(0.7)), camDir, true);
                effects.triggerScreenShake(0.2, 0.1);
                audio.playHeavySwing();
            } else if (localPlayer.attackState === 'elbow') {
                effects.spawnElbowEffect(camPos.add(camDir.multiplyScalar(0.4)));
                audio.playElbow();
            }
        }
        prevLocalAttackState = localPlayer.attackState;
    }

    // ─── Carried Object Mesh ───
    if (carriedObjectId !== null && localPlayer?.alive) {
        // Create mesh lazily or if type changed
        const serverLocal2 = null; // type is stored separately
        if (!carriedObjectMesh) {
            // We don't always know the type yet; destructibles manager may have it
            const destEntry = destructibles.getDestructible(carriedObjectId);
            const objType = destEntry?.type || 'crate';
            carriedObjectType = objType;

            let geo, color;
            if (objType === 'explosive') {
                geo = new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12);
                color = 0xdd4422;
            } else if (objType === 'goo') {
                geo = new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12);
                color = 0x44aa44;
            } else {
                geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                color = 0x8B6914;
            }
            const mat = new THREE.MeshStandardMaterial({
                color,
                emissive: color,
                emissiveIntensity: 0.15,
                roughness: 0.8,
            });
            carriedObjectMesh = new THREE.Mesh(geo, mat);
            carriedObjectMesh.castShadow = false;
            carriedObjectMesh.receiveShadow = false;
            renderer.scene.add(carriedObjectMesh);
        }

        // Position it in front-right-down of the camera
        const cam = renderer.camera;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const holdPos = cam.position.clone()
            .addScaledVector(fwd, 0.8)
            .addScaledVector(right, 0.25)
            .addScaledVector(up, -0.2);
        carriedObjectMesh.position.copy(holdPos);
        carriedObjectMesh.rotation.copy(cam.rotation);
    } else if (!carriedObjectId && carriedObjectMesh) {
        renderer.scene.remove(carriedObjectMesh);
        carriedObjectMesh.geometry.dispose();
        carriedObjectMesh.material.dispose();
        carriedObjectMesh = null;
        carriedObjectType = null;
    }

    // ─── Update camera ───
    renderer.updateCamera(localPlayer, dt);
    effects.applyShakeToCamera(renderer.camera);

    // ─── Update audio listener to match camera ───
    audio.updateListener(renderer.camera);

    // ─── Update effects + destructibles ───
    effects.update(dt);
    destructibles.update(dt);

    // ─── Update remote player visuals ───
    for (const [id, remote] of remotePlayers) {
        const target = remote.state;
        const rs = remote.renderState;

        // Smooth dt-based interpolation (converge in ~50ms = 1/NETWORK_SEND_RATE)
        const smoothing = 1 - Math.exp(-dt * 18); // ~90% convergence per 50ms snapshot
        rs.x = rs.x + (target.x - rs.x) * smoothing;
        rs.y = rs.y + (target.y - rs.y) * smoothing;
        rs.z = rs.z + (target.z - rs.z) * smoothing;
        rs.yaw = lerpAngle(rs.yaw, target.yaw, smoothing);
        rs.alive = target.alive;
        rs.crouching = target.crouching;
        rs.attackState = target.attackState;
        rs.dashing = target.dashing;

        // Snap position if too far (teleport / respawn)
        const dx = target.x - rs.x;
        const dy = target.y - rs.y;
        const dz = target.z - rs.z;
        if (dx * dx + dy * dy + dz * dz > 25) { // > 5m away = snap
            rs.x = target.x; rs.y = target.y; rs.z = target.z;
        }

        renderer.updatePlayerMesh(id, rs, false);

        // Remote footsteps (3D positioned)
        if (!remote.footstepTimer) remote.footstepTimer = 0;
        const remoteSpeed = Math.sqrt(
            (target.vx || 0) * (target.vx || 0) + (target.vz || 0) * (target.vz || 0)
        );
        if (target.alive && target.grounded && !target.sliding && !target.dashing && remoteSpeed > 1.5) {
            remote.footstepTimer += dt;
            if (remote.footstepTimer >= CONFIG.REMOTE_FOOTSTEP_INTERVAL) {
                remote.footstepTimer -= CONFIG.REMOTE_FOOTSTEP_INTERVAL;
                audio.playRemoteFootstep(rs.x, rs.y, rs.z);
            }
        } else {
            remote.footstepTimer = 0;
        }
    }

    // ─── HUD ───
    const allPlayerStates = [
        localPlayer.serialize(),
        ...[...remotePlayers.values()].map(r => r.state.serialize()),
    ];
    hud.update(localPlayer, allPlayerStates, dt);
    hud.showDeathScreen(!localPlayer.alive && gameActive, localPlayer.respawnTimer || 0);
    // Respawn fade-in overlay
    hud.updateRespawnFade(renderer.getRespawnFadeOpacity(dt));
    // Stop slide sound if dead
    if (!localPlayer.alive) audio.stopSlideSound();

    // ─── Render ───
    renderer.render(dt);
}

function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}

requestAnimationFrame(gameLoop);
