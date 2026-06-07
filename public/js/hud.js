import { CONFIG } from './config.js?v=4';

export class HUD {
    constructor() {
        this.container = document.getElementById('hud');
        this.hitMarkerTimer = 0;
        this.killFeedEntries = [];
        this.damageIndicators = [];
        this.damageNumbers = [];
        this.damageVignetteTimer = 0;
        this.lowHpPulsePhase = 0;
        this.respawnCountdown = 0;
        this.createElements();
    }

    createElements() {
        this.crosshair = document.getElementById('crosshair');
        this.hitMarker = document.getElementById('hit-marker');
        this.healthFill = document.getElementById('health-fill');
        this.healthText = document.getElementById('health-text');
        this.dashPips = document.querySelectorAll('.dash-pip');
        this.scoreDisplay = document.getElementById('score-display');
        this.killFeed = document.getElementById('kill-feed');
        this.chargeBar = document.getElementById('charge-bar');
        this.chargeFill = document.getElementById('charge-fill');
        this.damageVignette = document.getElementById('damage-vignette');
        this.damageDirectionContainer = document.getElementById('damage-direction');
        this.damageNumberContainer = document.getElementById('damage-numbers');
        this.lowHpOverlay = document.getElementById('low-hp-overlay');
        this.respawnFade = document.getElementById('respawn-fade');
        this.respawnTimerEl = document.getElementById('respawn-timer');
        this.padCooldownFill = document.getElementById('pad-cooldown-fill');
        this.padCooldownText = document.getElementById('pad-cooldown-text');
        this.gatewayCooldownFill = document.getElementById('gateway-cooldown-fill');
        this.gatewayCooldownText = document.getElementById('gateway-cooldown-text');
        this.gatewayCountEl = document.getElementById('gateway-count');
        this.gatewayInteractPrompt = document.getElementById('gateway-interact-prompt');
        this.regenIndicator = document.getElementById('regen-indicator');
    }

    updateGatewayCooldown(remaining, count, total, nearGateway) {
        // Cooldown bar
        if (this.gatewayCooldownFill) {
            if (remaining <= 0) {
                this.gatewayCooldownFill.style.width = '100%';
                this.gatewayCooldownText.textContent = count === 0 ? 'READY' : count === 1 ? '1 PLACED' : 'LINKED';
            } else {
                const pct = Math.max(0, 1 - remaining / total) * 100;
                this.gatewayCooldownFill.style.width = `${pct}%`;
                this.gatewayCooldownText.textContent = `${remaining.toFixed(1)}s`;
            }
        }
        // Portals placed indicator
        if (this.gatewayCountEl) {
            this.gatewayCountEl.textContent = count > 0 ? `⬡`.repeat(count) : '';
        }
        // E-key interact prompt
        if (this.gatewayInteractPrompt) {
            this.gatewayInteractPrompt.style.display = nearGateway ? 'block' : 'none';
        }
    }

    showRegenIndicator(active) {
        if (!this.regenIndicator) return;
        this.regenIndicator.style.display = active ? 'inline' : 'none';
    }

    updateJumpPadCooldown(remaining, total) {
        if (!this.padCooldownFill) return;
        if (remaining <= 0) {
            this.padCooldownFill.style.width = '100%';
            this.padCooldownText.textContent = 'READY';
        } else {
            const pct = Math.max(0, 1 - remaining / total) * 100;
            this.padCooldownFill.style.width = `${pct}%`;
            this.padCooldownText.textContent = `${remaining.toFixed(1)}s`;
        }
    }

    update(localPlayer, allPlayers, dt) {
        if (!localPlayer) return;

        // ─── Health ───
        const hpPercent = (localPlayer.hp / CONFIG.PLAYER_HP) * 100;
        this.healthFill.style.width = `${hpPercent}%`;
        this.healthText.textContent = Math.ceil(localPlayer.hp);

        if (hpPercent > 60) this.healthFill.style.background = 'linear-gradient(90deg, #22c55e, #4ade80)';
        else if (hpPercent > 30) this.healthFill.style.background = 'linear-gradient(90deg, #eab308, #facc15)';
        else this.healthFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';

        // ─── Low HP overlay pulse ───
        if (hpPercent <= 30 && localPlayer.alive) {
            this.lowHpPulsePhase += dt * 3;
            const pulse = (Math.sin(this.lowHpPulsePhase) + 1) * 0.5;
            this.lowHpOverlay.style.opacity = `${0.05 + pulse * 0.15}`;
            this.lowHpOverlay.style.display = 'block';
        } else {
            this.lowHpOverlay.style.display = 'none';
            this.lowHpPulsePhase = 0;
        }

        // ─── Dash charges ───
        const rechargeProgress = localPlayer.dashRechargeTimer > 0
            ? 1 - localPlayer.dashRechargeTimer / CONFIG.DASH_COOLDOWN
            : 0;
        this.dashPips.forEach((pip, i) => {
            if (i < localPlayer.dashCharges) {
                pip.classList.add('active');
                pip.style.opacity = '1';
            } else {
                pip.classList.remove('active');
                // All empty pips show the same shared recharge fill
                pip.style.opacity = rechargeProgress > 0 ? `${rechargeProgress}` : '0.3';
            }
        });

        // ─── Charge bar (backstab) ───
        if (localPlayer.attackState === 'charged_charging') {
            const chargePercent = Math.min(1, localPlayer.chargeTimer / CONFIG.CHARGE_TIME);
            this.chargeBar.style.display = 'block';
            this.chargeFill.style.width = `${chargePercent * 100}%`;
            if (chargePercent >= 1) {
                this.chargeFill.style.background = 'linear-gradient(90deg, #ef4444, #ff6b6b)';
                this.chargeBar.classList.add('charged');
            } else {
                this.chargeFill.style.background = 'linear-gradient(90deg, #fbbf24, #f59e0b)';
                this.chargeBar.classList.remove('charged');
            }
        } else {
            this.chargeBar.style.display = 'none';
            this.chargeBar.classList.remove('charged');
        }

        // ─── Score ───
        if (allPlayers && allPlayers.length >= 2) {
            this.scoreDisplay.textContent = allPlayers.map(p => p.kills).join(' — ');
        }

        // ─── Hit marker fade ───
        if (this.hitMarkerTimer > 0) {
            this.hitMarkerTimer -= dt;
            this.hitMarker.style.opacity = Math.min(1, this.hitMarkerTimer / 0.1);
            this.hitMarker.style.display = 'block';
        } else {
            this.hitMarker.style.display = 'none';
        }

        // ─── Damage vignette fade ───
        if (this.damageVignetteTimer > 0) {
            this.damageVignetteTimer -= dt;
            const t = this.damageVignetteTimer / 0.4;
            this.damageVignette.style.opacity = `${t * 0.6}`;
            this.damageVignette.style.display = 'block';
        } else {
            this.damageVignette.style.display = 'none';
        }

        // ─── Damage direction indicators ───
        this._updateDamageDirections(dt);

        // ─── Floating damage numbers ───
        this._updateDamageNumbers(dt);

        // ─── Kill feed cleanup ───
        const now = performance.now() / 1000;
        this.killFeedEntries = this.killFeedEntries.filter(e => now - e.time < CONFIG.KILL_FEED_DURATION);

        // ─── Crosshair attack state feedback ───
        this._updateCrosshairState(localPlayer);
    }

    // ─── Crosshair changes based on attack state ───
    _updateCrosshairState(player) {
        const ch = this.crosshair;
        if (player.attackState === 'primary' || player.attackState === 'elbow') {
            ch.classList.add('attacking');
        } else if (player.attackState === 'charged_charging') {
            ch.classList.add('charging');
            ch.classList.remove('attacking');
        } else if (player.attackState === 'charged_attack') {
            ch.classList.add('attacking');
            ch.classList.remove('charging');
        } else {
            ch.classList.remove('attacking', 'charging');
        }
    }

    // ─── Hit Marker ───
    showHitMarker(backstab, damage) {
        this.hitMarkerTimer = CONFIG.HIT_MARKER_DURATION;
        if (backstab) {
            this.hitMarker.className = 'backstab';
        } else {
            this.hitMarker.className = '';
        }
        this.hitMarker.style.display = 'block';
        this.hitMarker.style.opacity = '1';

        // Show damage number at crosshair
        if (damage) {
            this.spawnDamageNumber(damage, backstab);
        }
    }

    // ─── Floating Damage Numbers ───
    spawnDamageNumber(damage, isCrit) {
        const el = document.createElement('div');
        el.className = `damage-number ${isCrit ? 'crit' : ''}`;
        el.textContent = damage;

        // Random offset from center
        const offsetX = (Math.random() - 0.5) * 60;
        el.style.left = `calc(50% + ${offsetX}px)`;
        el.style.top = '45%';

        this.damageNumberContainer.appendChild(el);

        this.damageNumbers.push({
            el,
            lifetime: 0.8,
            vy: -80, // pixels per second upward
        });
    }

    _updateDamageNumbers(dt) {
        for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
            const dn = this.damageNumbers[i];
            dn.lifetime -= dt;
            dn.vy -= 50 * dt; // slow down

            const currentTop = parseFloat(dn.el.style.top);
            dn.el.style.top = `${currentTop + dn.vy * dt}%`;
            dn.el.style.opacity = `${Math.max(0, dn.lifetime / 0.8)}`;

            if (dn.lifetime <= 0) {
                dn.el.remove();
                this.damageNumbers.splice(i, 1);
            }
        }
    }

    // ─── Damage Vignette (when taking damage) ───
    showDamageVignette() {
        this.damageVignetteTimer = 0.4;
    }

    // ─── Damage Direction Indicator ───
    showDamageDirection(attackerYaw, localYaw) {
        // Calculate angle from local player's perspective to attacker
        let angle = attackerYaw - localYaw;
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;

        const el = document.createElement('div');
        el.className = 'damage-dir-arc';
        el.style.transform = `rotate(${angle}rad)`;
        this.damageDirectionContainer.appendChild(el);

        this.damageIndicators.push({
            el,
            lifetime: 1.0,
        });
    }

    _updateDamageDirections(dt) {
        for (let i = this.damageIndicators.length - 1; i >= 0; i--) {
            const di = this.damageIndicators[i];
            di.lifetime -= dt;
            di.el.style.opacity = `${Math.max(0, di.lifetime / 1.0)}`;

            if (di.lifetime <= 0) {
                di.el.remove();
                this.damageIndicators.splice(i, 1);
            }
        }
    }

    // ─── Kill Feed ───
    addKillFeedEntry(killerName, victimName, weapon) {
        const entry = {
            killer: killerName,
            victim: victimName,
            weapon,
            time: performance.now() / 1000,
        };
        this.killFeedEntries.push(entry);

        this.killFeed.innerHTML = '';
        for (const e of this.killFeedEntries.slice(-5)) {
            const div = document.createElement('div');
            div.className = 'kill-feed-entry';
            div.innerHTML = `<span class="killer">${e.killer}</span> <span class="weapon">[${e.weapon}]</span> <span class="victim">${e.victim}</span>`;
            this.killFeed.appendChild(div);
        }
    }

    showDeathScreen(show, respawnTime = 0) {
        const el = document.getElementById('death-screen');
        el.style.display = show ? 'flex' : 'none';

        // Update respawn countdown
        if (show && this.respawnTimerEl) {
            this.respawnTimerEl.textContent = Math.max(0, Math.ceil(respawnTime));
        }
    }

    // Update respawn fade overlay (called from game loop)
    updateRespawnFade(opacity) {
        if (this.respawnFade) {
            if (opacity > 0.01) {
                this.respawnFade.style.display = 'block';
                this.respawnFade.style.opacity = `${opacity}`;
            } else {
                this.respawnFade.style.display = 'none';
            }
        }
    }

    showGameOver(winnerId, localId, scores) {
        const el = document.getElementById('game-over');
        const isWinner = winnerId === localId;
        el.querySelector('.result').textContent = isWinner ? 'VICTORY' : 'DEFEAT';
        el.querySelector('.result').style.color = isWinner ? '#22c55e' : '#ef4444';

        // Build score display
        const scoresEl = document.getElementById('final-scores');
        if (scoresEl && scores) {
            scoresEl.innerHTML = scores.map(s => {
                const isMe = s.id === localId;
                const isW = s.id === winnerId;
                const cls = isW ? 'winner' : 'loser';
                const label = isMe ? 'You' : `Player ${s.displayId ?? s.id}`;
                return `<div class="score-row">
                    <span class="player-name ${cls}">${label}</span>
                    <span class="player-stats">${s.kills} kills / ${s.deaths} deaths</span>
                </div>`;
            }).join('');
        }

        el.style.display = 'flex';
    }

    showLobby(show) {
        document.getElementById('lobby').style.display = show ? 'flex' : 'none';
    }

    showConnecting(show) {
        document.getElementById('connecting').style.display = show ? 'flex' : 'none';
    }
}
