const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();

const {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    simulateTick,
    createDimensionSnapshots
} = require("./simulation");

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

// --------------------------------------------------
// HTTP
// --------------------------------------------------

app.use(express.json());

app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        name: "Somewhere"
    });
});

// --------------------------------------------------
// WORLD STATE
// --------------------------------------------------

const players = new Map();

const DEFAULT_DIMENSION = "main";

function getDimensionRoom(dimensionId) {
    return `dimension:${dimensionId}`;
}

function getPlayersInDimension(dimensionId, excludedPlayerId = null) {
    return Array.from(players.values())
        .filter(player =>
            player.dimensionId === dimensionId &&
            player.id !== excludedPlayerId
        )
        .map(getPublicPlayerState);
}

// --------------------------------------------------
// DIMENSION VALIDATION
// --------------------------------------------------

function isValidDimensionId(dimensionId) {
    return (
        typeof dimensionId === "string" &&
        /^[a-zA-Z0-9_-]{1,40}$/.test(dimensionId)
    );
}

// --------------------------------------------------
// SIMULATION & BROADCAST LOOPS
// --------------------------------------------------

// 1. Simulation loop: 30 ticks per second
let lastSimulationTime = performance.now();
const simulationInterval = setInterval(() => {
    const now = performance.now();
    const deltaTime = (now - lastSimulationTime) / 1000;
    lastSimulationTime = now;

    if (players.size > 0) {
        simulateTick(players.values(), deltaTime);
    }
}, 1000 / WORLD_CONFIG.simulationTickRate);

// 2. Broadcast loop: 20 snapshots per second
const snapshotInterval = setInterval(() => {
    if (players.size === 0) {
        return;
    }

    const dimensionSnapshots = createDimensionSnapshots(players.values());
    for (const { dimensionId, snapshot } of dimensionSnapshots) {
        io.to(getDimensionRoom(dimensionId)).emit("movement_snapshot", snapshot);
    }
}, 1000 / WORLD_CONFIG.snapshotRate);

// --------------------------------------------------
// SOCKET CONNECTIONS
// --------------------------------------------------

io.on("connection", (socket) => {
    const player = createPlayer(socket.id, `Player-${socket.id.slice(0, 6)}`, DEFAULT_DIMENSION);

    players.set(player.id, player);

    const initialRoom = getDimensionRoom(player.dimensionId);

    // Join the default dimension room.
    socket.join(initialRoom);

    console.log(
        `${player.name} connected to dimension: ${player.dimensionId}`
    );

    // Tell this client who they are, their authoritative initial position, and world config.
    socket.emit("welcome", {
        player: getPublicPlayerState(player),
        world: WORLD_CONFIG
    });

    // Give this client the existing players in its dimension.
    socket.emit("dimension_state", {
        dimensionId: player.dimensionId,
        players: getPlayersInDimension(
            player.dimensionId,
            player.id
        )
    });

    // Tell other players in this dimension about the new arrival.
    socket.to(initialRoom).emit(
        "player_joined",
        getPublicPlayerState(player)
    );

    // --------------------------------------------------
    // CHANGE DIMENSION
    // --------------------------------------------------

    socket.on("change_dimension", (data) => {
        if (!data || !isValidDimensionId(data.dimensionId)) {
            socket.emit("request_rejected", {
                action: "change_dimension",
                reason: "Invalid dimension ID."
            });

            return;
        }

        const targetDimensionId = data.dimensionId;
        const oldDimensionId = player.dimensionId;

        // Reset movement input on dimension transition.
        resetPlayerMovementInput(player);

        // Nothing to do if the player is already there.
        if (targetDimensionId === oldDimensionId) {
            socket.emit("dimension_changed", {
                dimensionId: oldDimensionId,
                players: getPlayersInDimension(
                    oldDimensionId,
                    player.id
                )
            });

            return;
        }

        const oldRoom = getDimensionRoom(oldDimensionId);
        const newRoom = getDimensionRoom(targetDimensionId);

        // Notify the old dimension before removing the player.
        socket.to(oldRoom).emit("player_left", {
            playerId: player.id,
            name: player.name,
            dimensionId: oldDimensionId,
            reason: "dimension_changed"
        });

        // Leave the old room.
        socket.leave(oldRoom);

        // Update authoritative server state.
        player.dimensionId = targetDimensionId;

        // Join the new room.
        socket.join(newRoom);

        console.log(
            `${player.name} moved from ${oldDimensionId} to ${targetDimensionId}`
        );

        // Give the player the new dimension's current state.
        socket.emit("dimension_changed", {
            dimensionId: targetDimensionId,
            players: getPlayersInDimension(
                targetDimensionId,
                player.id
            )
        });

        // Notify existing players in the new dimension.
        socket.to(newRoom).emit(
            "player_joined",
            getPublicPlayerState(player)
        );
    });

    // --------------------------------------------------
    // TEST MESSAGE
    // --------------------------------------------------

    socket.on("ping_server", (data) => {
        console.log(`Message from ${player.name}:`, data);

        socket.emit("pong_server", {
            message: "Message received!",
            received: data
        });
    });

    // --------------------------------------------------
    // DIMENSION CHAT
    // --------------------------------------------------

    socket.on("chat_message", (data) => {
        // Validate the message payload.
        if (!data || typeof data.message !== "string") {
            socket.emit("request_rejected", {
                action: "chat_message",
                reason: "Invalid message."
            });

            return;
        }

        // Normalize and validate the message.
        const message = data.message.trim();

        if (message.length === 0) {
            return;
        }

        if (message.length > 500) {
            socket.emit("request_rejected", {
                action: "chat_message",
                reason: "Message cannot exceed 500 characters."
            });

            return;
        }

        // Construct the message using authoritative server state.
        const chatMessage = {
            playerId: player.id,
            playerName: player.name,
            dimensionId: player.dimensionId,
            message: message,
            timestamp: Date.now()
        };

        // Broadcast to everyone in this dimension, including the sender.
        io.to(getDimensionRoom(player.dimensionId)).emit(
            "chat_message",
            chatMessage
        );

        console.log(
            `[Chat: ${player.dimensionId}] ${player.name}: ${message}`
        );
    });

    // --------------------------------------------------
    // SERVER-AUTHORITATIVE MOVEMENT INPUT
    // --------------------------------------------------

    socket.on("movement_input", (data) => {
        const activePlayer = players.get(socket.id);
        if (!activePlayer) {
            return;
        }

        const success = setPlayerMovementInput(activePlayer, data);
        if (!success) {
            socket.emit("request_rejected", {
                action: "movement_input",
                reason: "Malformed or out-of-range directional input."
            });
        }
    });

    // Explicitly reject any legacy or malicious direct position update attempts
    socket.on("move", () => {
        socket.emit("request_rejected", {
            action: "move",
            reason: "Client-authoritative position updates are rejected. Use movement_input."
        });
    });

    // --------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------

    socket.on("disconnect", (reason) => {
        const activePlayer = players.get(socket.id);
        if (!activePlayer) {
            return;
        }

        // Stop input immediately
        resetPlayerMovementInput(activePlayer);

        const room = getDimensionRoom(activePlayer.dimensionId);

        // Notify players who share this dimension.
        socket.to(room).emit("player_left", {
            playerId: activePlayer.id,
            name: activePlayer.name,
            dimensionId: activePlayer.dimensionId,
            reason: "disconnected"
        });

        // Remove the player from server state.
        players.delete(activePlayer.id);

        console.log(
            `${activePlayer.name} disconnected from ${activePlayer.dimensionId}. Reason: ${reason}`
        );
    });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

httpServer.listen(PORT, () => {
    console.log(`Somewhere server running on port ${PORT}`);
});

module.exports = {
    app,
    httpServer,
    players,
    simulationInterval,
    snapshotInterval
};