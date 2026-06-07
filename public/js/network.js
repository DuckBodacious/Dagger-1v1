// v2 — added sendPlayerReady
import { CONFIG } from './config.js?v=4';

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
        this.onGatewayEvent = null;
        this.onLobbyState = null;
        this.onPromotedToHost = null;
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
                this.displayId = msg.displayId;
                if (this.onConnected) this.onConnected(msg.playerId, msg.isHost, msg.displayId);
                break;

            case 'promoted_to_host':
                if (this.onPromotedToHost) this.onPromotedToHost();
                break;

            case 'lobby_state':
                if (this.onLobbyState) this.onLobbyState(msg);
                break;

            case 'full':
                console.warn('[Network] Server is full or game in progress');
                document.querySelector('.connecting-text').textContent = 'Lobby full or game in progress. Reload to retry.';
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

            case 'gateway_placed':
            case 'gateway_linked':
            case 'gateway_expired':
            case 'gateway_teleport':
                if (this.onGatewayEvent) this.onGatewayEvent(msg);
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

    sendLobbyConfig(config) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'lobby_config', ...config }));
    }

    sendPlayerColor(color) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'player_color', color }));
    }

    sendPlayerReady(ready) {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'player_ready', ready }));
    }

    sendStartGame() {
        if (!this.connected) return;
        this.ws.send(JSON.stringify({ type: 'start_game' }));
    }

    // Get inputs that haven't been acknowledged by server yet
    getUnacknowledgedInputs(lastProcessedSeq) {
        return this.pendingInputs.filter(p => p.seq > lastProcessedSeq);
    }
}
