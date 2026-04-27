import { CONFIG } from './config.js';

export class NetworkClient {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.playerId = null;
        this.inputSequence = 0;
        this.pendingInputs = [];

        // Callbacks
        this.onConnected = null;
        this.onGameState = null;
        this.onPlayerJoined = null;
        this.onPlayerLeft = null;
        this.onHitConfirm = null;
        this.onKillFeed = null;
        this.onGameStart = null;
        this.onDestruction = null;
        this.onJumpPadEvent = null;
        this.onObjectEvent = null;
    }

    connect(url) {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            console.log('[Network] Connected to server');
            this.connected = true;
        };

        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
        };

        this.ws.onerror = (err) => {
            console.error('[Network] WebSocket error:', err);
        };

        this.ws.onclose = () => {
            console.log('[Network] Disconnected');
            this.connected = false;
        };

        this.ws.onerror = (err) => {
            console.error('[Network] Error:', err);
        };
    }

    handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                this.playerId = msg.playerId;
                if (this.onConnected) this.onConnected(msg.playerId);
                break;

            case 'full':
                console.warn('[Network] Server is full — try again when a slot opens');
                document.querySelector('.connecting-text').textContent = 'Server is full (2/2). Reload to retry.';
                break;

            case 'game_state':
                if (this.onGameState) this.onGameState(msg.state);
                break;

            case 'player_joined':
                if (this.onPlayerJoined) this.onPlayerJoined(msg.playerId);
                break;

            case 'player_left':
                if (this.onPlayerLeft) this.onPlayerLeft(msg.playerId);
                break;

            case 'hit_confirm':
                if (this.onHitConfirm) this.onHitConfirm(msg);
                break;

            case 'kill_feed':
                if (this.onKillFeed) this.onKillFeed(msg);
                break;

            case 'game_start':
                if (this.onGameStart) this.onGameStart(msg);
                break;

            case 'destruction':
                if (this.onDestruction) this.onDestruction(msg);
                break;

            case 'jumppad_placed':
            case 'jumppad_removed':
            case 'jumppad_triggered':
                if (this.onJumpPadEvent) this.onJumpPadEvent(msg);
                break;

            case 'object_picked_up':
            case 'object_dropped':
            case 'object_thrown':
            case 'object_landed':
                if (this.onObjectEvent) this.onObjectEvent(msg);
                break;
        }
    }

    sendRaw(msg) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify(msg));
    }

    sendInput(input) {
        if (!this.connected) return;

        this.inputSequence++;
        const inputMsg = {
            type: 'input',
            seq: this.inputSequence,
            ...input,
        };

        // Store for client prediction reconciliation
        this.pendingInputs.push({
            seq: this.inputSequence,
            input: { ...input },
        });

        // Trim old inputs (keep last 120 = 2 seconds worth)
        if (this.pendingInputs.length > 120) {
            this.pendingInputs.shift();
        }

        this.ws.send(JSON.stringify(inputMsg));
    }

    sendReady(killGoal, gameMode) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({
            type: 'ready',
            killGoal: killGoal || 10,
            gameMode: gameMode || 'multiplayer',
        }));
    }

    // Get inputs that haven't been acknowledged by server yet
    getUnacknowledgedInputs(lastProcessedSeq) {
        return this.pendingInputs.filter(p => p.seq > lastProcessedSeq);
    }
}
