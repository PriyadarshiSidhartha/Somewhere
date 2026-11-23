// server.js — Main entry point.
//
// Responsibilities:
//   - Express HTTP server (static files + auth routes + API routes)
//   - Socket.IO real-time server (movement, blocks, chat)
//   - Ties together: auth.js, simulation.js, worldState.js, db.js

require("dotenv").config();

const express    = require("express");
const http       = require("http");
const path       = require("path");
const passport   = require("passport");
const { Server } = require("socket.io");

const { createSessionMiddleware, mountAuthRoutes } = require("./auth");
const {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    simulateTick,
    createSnapshot,
} = require("./simulation");
const world = require("./worldState");
const prisma = require("./db");
const blockCatalog = require("./blockCatalog");

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 3000;

// --------------------------------------------------
// MIDDLEWARE
// --------------------------------------------------

app.use(express.json());

// Session middleware (must come before passport).
const sessionMiddleware = createSessionMiddleware();
app.use(sessionMiddleware);

// Passport authentication.
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from /public (the Three.js frontend).
app.use(express.static(path.join(__dirname, "../public")));

// --------------------------------------------------
// AUTH ROUTES  (/auth/google, /auth/logout, /api/me)
// --------------------------------------------------

mountAuthRoutes(app);

// Block catalogue endpoint
app.get("/api/blocks", (req, res) => {
    res.json({
        blocks: blockCatalog.getAllBlocks(),
        defaultRecent: blockCatalog.DEFAULT_RECENT_BLOCKS,
    });
});

// Health check
app.get("/health", (req, res) => {
    res.json({ status: "ok", name: "Somewhere" });
});

// --------------------------------------------------
// SHARE SESSION WITH SOCKET.IO
// --------------------------------------------------
// This lets Socket.IO handlers read req.session and req.user,
// so we can verify who the connected player is.

const wrap = (middleware) => (socket, next) =>
    middleware(socket.request, socket.request.res || {}, next);

io.use(wrap(sessionMiddleware));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));

// Gate: reject socket connections from unauthenticated users.
io.use((socket, next) => {
    if (socket.request.user) {
        return next();
    }
    next(new Error("Not authenticated"));
});

// --------------------------------------------------
// IN-MEMORY PLAYER STATE
// --------------------------------------------------

// Map: socketId -> player object
const players = new Map();

// --------------------------------------------------
// SIMULATION + BROADCAST LOOPS
// --------------------------------------------------

let lastSimTime = performance.now();

const simulationInterval = setInterval(() => {
    const now = performance.now();
    const dt  = (now - lastSimTime) / 1000;
    lastSimTime = now;

    if (players.size > 0) {
        simulateTick(players.values(), dt);
    }
}, 1000 / WORLD_CONFIG.simulationTickRate);

const snapshotInterval = setInterval(() => {
    if (players.size === 0) return;
    // Broadcast the positions of ALL players to everyone.
    io.emit("movement_snapshot", createSnapshot(players.values()));
}, 1000 / WORLD_CONFIG.snapshotRate);

// --------------------------------------------------
// SOCKET.IO EVENT HANDLERS
// --------------------------------------------------

io.on("connection", async (socket) => {
    // The authenticated user is on socket.request.user (set by Passport).
    const dbUser = socket.request.user;

    // Create the in-memory player using saved DB position.
    const player = createPlayer(socket.id, dbUser.displayName, {
        x: dbUser.posX,
        y: dbUser.posY,
        z: dbUser.posZ,
    });
    player.userId = dbUser.id;

    players.set(socket.id, player);

    console.log(`${player.name} connected (userId: ${dbUser.id})`);

    // 1. Tell this client who they are + world config.
    const initialRecent = (dbUser.recentBlocks && dbUser.recentBlocks.length > 0)
        ? dbUser.recentBlocks
        : blockCatalog.DEFAULT_RECENT_BLOCKS;

    socket.emit("welcome", {
        player: getPublicPlayerState(player),
        world: WORLD_CONFIG,
        recentBlocks: initialRecent,
    });

    // 2. Send the full block world to this new client.
    socket.emit("world_state", { blocks: world.getAllBlocks() });

    // 3. Send the list of other players currently connected.
    const otherPlayers = [];
    for (const [id, p] of players) {
        if (id !== socket.id) {
            otherPlayers.push(getPublicPlayerState(p));
        }
    }
    socket.emit("players_state", { players: otherPlayers });

    // 4. Tell all OTHER players that this person joined.
    socket.broadcast.emit("player_joined", getPublicPlayerState(player));

    // --------------------------------------------------
    // MOVEMENT INPUT
    // --------------------------------------------------

    socket.on("movement_input", (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        const ok = setPlayerMovementInput(p, data);
        if (!ok) {
            socket.emit("request_rejected", {
                action: "movement_input",
                reason: "Invalid movement input.",
            });
        }
    });

    // --------------------------------------------------
    // BLOCK: PLACE
    // --------------------------------------------------

    socket.on("block:place", async (data) => {
        if (!data) return;

        const { x, y, z, type } = data;

        // Validate on the server — never trust the client.
        if (!world.isValidBlockCoord(x, y, z)) {
            socket.emit("request_rejected", {
                action: "block:place",
                reason: "Invalid block coordinates.",
            });
            return;
        }

        const blockType = type || "dirt";
        const resolvedBlock = blockCatalog.getBlock(blockType);
        if (!resolvedBlock || !world.isValidBlockType(blockType)) {
            socket.emit("request_rejected", {
                action: "block:place",
                reason: "Invalid block type.",
            });
            return;
        }

        try {
            const newBlock = await world.placeBlock(x, y, z, resolvedBlock.id);
            if (!newBlock) {
                socket.emit("request_rejected", {
                    action: "block:place",
                    reason: "A block already exists there.",
                });
                return;
            }

            // Broadcast to ALL clients (including the sender, so their local
            // prediction is confirmed by the server).
            io.emit("block:placed", { x, y, z, type: resolvedBlock.id });
            console.log(`${player.name} placed ${resolvedBlock.id} at (${x},${y},${z})`);
        } catch (err) {
            console.error("block:place error:", err);
        }
    });

    // --------------------------------------------------
    // PLAYER: UPDATE RECENT BLOCKS (Profile Persistence)
    // --------------------------------------------------

    socket.on("player:recent_blocks", async (data) => {
        if (!data || !Array.isArray(data.recentBlocks)) return;

        const validIds = data.recentBlocks
            .filter((id) => blockCatalog.isValidBlockId(id))
            .slice(0, 10);

        try {
            await prisma.user.update({
                where: { id: player.userId },
                data: { recentBlocks: validIds },
            });
        } catch (err) {
            console.error(`Failed to update recent blocks for ${player.name}:`, err);
        }
    });

    // --------------------------------------------------
    // BLOCK: REMOVE
    // --------------------------------------------------

    socket.on("block:remove", async (data) => {
        if (!data) return;

        const { x, y, z } = data;

        if (!world.isValidBlockCoord(x, y, z)) {
            socket.emit("request_rejected", {
                action: "block:remove",
                reason: "Invalid block coordinates.",
            });
            return;
        }

        try {
            const removed = await world.removeBlock(x, y, z);
            if (!removed) {
                socket.emit("request_rejected", {
                    action: "block:remove",
                    reason: "No block found at that position.",
                });
                return;
            }

            io.emit("block:removed", { x, y, z });
            console.log(`${player.name} removed block at (${x},${y},${z})`);
        } catch (err) {
            console.error("block:remove error:", err);
        }
    });

    // --------------------------------------------------
    // CHAT
    // --------------------------------------------------

    socket.on("chat:message", (data) => {
        if (!data || typeof data.message !== "string") return;

        const message = data.message.trim();
        if (message.length === 0 || message.length > 500) return;

        const chatPayload = {
            playerId:   player.id,
            playerName: player.name,
            message,
            timestamp:  Date.now(),
        };

        // Broadcast to everyone (including sender).
        io.emit("chat:message", chatPayload);

        // Clear any typing indicator for this player.
        socket.broadcast.emit("chat:typing", { playerId: player.id, text: "" });

        console.log(`[Chat] ${player.name}: ${message}`);
    });

    // Real-time typing broadcast (so others see text as you type).
    socket.on("chat:typing", (data) => {
        if (!data || typeof data.text !== "string") return;
        const text = data.text.slice(0, 100); // cap at max length
        socket.broadcast.emit("chat:typing", {
            playerId: player.id,
            text,
        });
    });

    // --------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------

    socket.on("disconnect", async (reason) => {
        const p = players.get(socket.id);
        if (!p) return;

        resetPlayerMovementInput(p);

        // Save the player's last position to MongoDB.
        try {
            await prisma.user.update({
                where: { id: p.userId },
                data: {
                    posX: p.position.x,
                    posY: p.position.y,
                    posZ: p.position.z,
                },
            });
        } catch (err) {
            console.error(`Failed to save position for ${p.name}:`, err);
        }

        players.delete(socket.id);

        // Tell all other clients this player left.
        socket.broadcast.emit("player_left", { playerId: socket.id, name: p.name });

        console.log(`${p.name} disconnected. Reason: ${reason}`);
    });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

async function start() {
    // Load the block world from MongoDB (or seed it if empty).
    await world.loadWorld();

    httpServer.listen(PORT, () => {
        console.log(`Somewhere server running → http://localhost:${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});

module.exports = { app, httpServer };
