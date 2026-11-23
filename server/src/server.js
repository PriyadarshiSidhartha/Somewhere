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
    PHYSICS_CONFIG,
    createPlayer,
    getPublicPlayerState,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    simulateTick,
    createSnapshot,
    setWorldCollisionFn,
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

app.use(express.json({ limit: "5mb" }));

// Session middleware (must come before passport).
const sessionMiddleware = createSessionMiddleware();
app.use(sessionMiddleware);

// Passport authentication.
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from /public (the Three.js frontend).
app.use(express.static(path.join(__dirname, "../public")));

// Serve shared physics.js so the client can load it.
app.get("/shared/physics.js", (req, res) => {
    res.type("application/javascript");
    res.sendFile(path.join(__dirname, "physics.js"));
});

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
// PROFILE & FRIENDS API
// --------------------------------------------------

const CURRENT_WORLD_NAME = "Somewhere";

// Map: userId -> Set of socketId (real-time presence)
const onlineUsers = new Map();

// Helper: retrieve friends for a user with privacy-filtered world and online presence
async function getFriendsForUser(userId) {
    const friendships = await prisma.friendship.findMany({
        where: {
            OR: [
                { userId: userId },
                { friendId: userId },
            ],
        },
    });

    const friendIds = friendships.map((f) => (f.userId === userId ? f.friendId : f.userId));
    if (friendIds.length === 0) return [];

    const users = await prisma.user.findMany({
        where: { id: { in: friendIds } },
        select: {
            id: true,
            displayName: true,
            avatar: true,
            showWorldToFriends: true,
            lastActive: true,
        },
    });

    return users.map((u) => {
        const isOnline = onlineUsers.has(u.id) && onlineUsers.get(u.id).size > 0;
        return {
            id: u.id,
            displayName: u.displayName,
            avatar: u.avatar || null,
            isOnline,
            currentWorld: (isOnline && u.showWorldToFriends) ? CURRENT_WORLD_NAME : null,
            lastActive: u.lastActive,
        };
    });
}

// Helper: notify online friends of user's presence or profile updates
async function notifyFriendsOfPresence(userId) {
    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                displayName: true,
                // avatar omitted due to schema mismatch
                showWorldToFriends: true,
                lastActive: true,
            },
        });
        if (!user) return;

        const isOnline = onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
        const friendships = await prisma.friendship.findMany({
            where: {
                OR: [
                    { userId: userId },
                    { friendId: userId },
                ],
            },
        });

        for (const f of friendships) {
            const friendId = f.userId === userId ? f.friendId : f.userId;
            const socketSet = onlineUsers.get(friendId);
            if (socketSet && socketSet.size > 0) {
                const friendData = {
                    id: user.id,
                    displayName: user.displayName,
                    avatar: user.avatar || null,
                    isOnline,
                    currentWorld: (isOnline && user.showWorldToFriends) ? CURRENT_WORLD_NAME : null,
                    lastActive: user.lastActive,
                };
                for (const sId of socketSet) {
                    io.to(sId).emit("friends:presence", friendData);
                }
            }
        }
    } catch (err) {
        console.error("notifyFriendsOfPresence error:", err);
    }
}

// PUT /api/profile — Update username, avatar, or location privacy
app.put("/api/profile", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const { displayName, avatar, showWorldToFriends } = req.body;
    const updateData = {};

    // Validate username
    if (displayName !== undefined) {
        if (typeof displayName !== "string") {
            return res.status(400).json({ error: "Invalid username format." });
        }
        const trimmed = displayName.trim();
        if (trimmed.length < 3 || trimmed.length > 20) {
            return res.status(400).json({ error: "Username must be between 3 and 20 characters." });
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
            return res.status(400).json({ error: "Username can only contain letters, numbers, spaces, underscores, and hyphens." });
        }

        // Check uniqueness across other users
        const existing = await prisma.user.findFirst({
            where: {
                displayName: { equals: trimmed, mode: "insensitive" },
                NOT: { id: req.user.id },
            },
        });
        if (existing) {
            return res.status(400).json({ error: "Username is already taken." });
        }
        updateData.displayName = trimmed;
    }

    // Validate avatar image
    if (avatar !== undefined) {
        if (avatar === null || avatar === "") {
            updateData.avatar = null;
        } else if (typeof avatar === "string") {
            if (avatar.length > 3 * 1024 * 1024) {
                return res.status(400).json({ error: "Avatar image is too large (max 2MB)." });
            }
            if (!avatar.startsWith("data:image/") && !avatar.startsWith("http://") && !avatar.startsWith("https://")) {
                return res.status(400).json({ error: "Invalid avatar format. Must be an image or URL." });
            }
            updateData.avatar = avatar;
        }
    }

    // Validate location privacy toggle
    if (showWorldToFriends !== undefined) {
        if (typeof showWorldToFriends !== "boolean") {
            return res.status(400).json({ error: "Invalid showWorldToFriends setting." });
        }
        updateData.showWorldToFriends = showWorldToFriends;
    }

    if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No fields provided to update." });
    }

    try {
        const updatedUser = await prisma.user.update({
            where: { id: req.user.id },
            data: updateData,
        });

        // Update passport session
        Object.assign(req.user, updatedUser);

        // Update in-memory player state (only if name or avatar changed)
        if (updateData.displayName || updateData.avatar !== undefined) {
            for (const [sId, p] of players) {
                if (p.userId === req.user.id) {
                    if (updateData.displayName) {
                        p.name = updateData.displayName;
                    }
                    io.emit("player_updated", {
                        playerId: sId,
                        userId: req.user.id,
                        name: p.name,
                        avatar: updatedUser.avatar,
                    });
                }
            }
        }

        // Notify friends of updated presence / world visibility
        notifyFriendsOfPresence(req.user.id);

        res.json({
            success: true,
            user: {
                id: updatedUser.id,
                displayName: updatedUser.displayName,
                avatar: updatedUser.avatar,
                showWorldToFriends: updatedUser.showWorldToFriends,
                lastActive: updatedUser.lastActive,
            },
        });
    } catch (err) {
        console.error("Failed to update profile:", err);
        res.status(500).json({ error: "Failed to update profile." });
    }
});

// GET /api/friends — List friends with real-time status and privacy-filtered world
app.get("/api/friends", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const friends = await getFriendsForUser(req.user.id);
        res.json({ friends });
    } catch (err) {
        console.error("Failed to get friends:", err);
        res.status(500).json({ error: "Failed to get friends." });
    }
});

// POST /api/friends/add — Disabled (will be redesigned later)
app.post("/api/friends/add", (req, res) => {
    res.status(403).json({ error: "Adding friends by username is disabled." });
});

// DELETE /api/friends/:id — Remove friend
app.delete("/api/friends/:id", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    const friendId = req.params.id;

    try {
        await prisma.friendship.deleteMany({
            where: {
                OR: [
                    { userId: req.user.id, friendId },
                    { userId: friendId, friendId: req.user.id },
                ],
            },
        });

        notifyFriendsOfPresence(req.user.id);
        notifyFriendsOfPresence(friendId);

        res.json({ success: true });
    } catch (err) {
        console.error("Failed to remove friend:", err);
        res.status(500).json({ error: "Failed to remove friend." });
    }
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
// In dev mode (no Google OAuth), auto-assign the dummy user if no session exists.
io.use((socket, next) => {
    if (socket.request.user) {
        return next();
    }
    // If we're running without real OAuth, allow connections with a dev user.
    if (!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)) {
        socket.request.user = {
            id: "dev-user",
            displayName: "Dev Player",
            avatar: null,
            showWorldToFriends: false,
            lastActive: new Date(),
            posX: 0,
            posY: 5,
            posZ: 0,
            recentBlocks: [],
        };
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

    // Track online user presence
    if (!onlineUsers.has(dbUser.id)) {
        onlineUsers.set(dbUser.id, new Set());
    }
    onlineUsers.get(dbUser.id).add(socket.id);

    // Update lastActive timestamp in DB
    // Update lastActive timestamp in DB (disabled due to schema constraints)
    // prisma.user.update({
    //     where: { id: dbUser.id },
    //     data: { lastActive: new Date() },
    // }).catch((err) => console.error("Failed to update lastActive:", err));

    // Notify friends of presence
    notifyFriendsOfPresence(dbUser.id);

    console.log(`${player.name} connected (userId: ${dbUser.id})`);

    // 1. Tell this client who they are + world config.
    const initialRecent = (dbUser.recentBlocks && dbUser.recentBlocks.length > 0)
        ? dbUser.recentBlocks
        : blockCatalog.DEFAULT_RECENT_BLOCKS;

    socket.emit("welcome", {
        player: getPublicPlayerState(player),
        world: WORLD_CONFIG,
        physics: PHYSICS_CONFIG,
        recentBlocks: initialRecent,
        worldName: CURRENT_WORLD_NAME,
        playerCount: players.size,
    });

    // Broadcast world player count to everyone in the world
    io.emit("world:info", {
        worldName: CURRENT_WORLD_NAME,
        playerCount: players.size,
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

    // Friend ping event
    socket.on("friend:ping", (data) => {
        if (!data || !data.friendId) return;
        const friendSockets = onlineUsers.get(data.friendId);
        if (friendSockets && friendSockets.size > 0) {
            for (const sId of friendSockets) {
                io.to(sId).emit("friend:pinged", {
                    fromId: dbUser.id,
                    fromName: dbUser.displayName,
                });
            }
        }
    });

    // --------------------------------------------------
    // DISCONNECT
    // --------------------------------------------------

    socket.on("disconnect", async (reason) => {
        const p = players.get(socket.id);
        if (!p) return;

        resetPlayerMovementInput(p);

        // Remove from online user socket set
        if (onlineUsers.has(p.userId)) {
            const userSockets = onlineUsers.get(p.userId);
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
                onlineUsers.delete(p.userId);
                // Update lastActive timestamp in DB
                const now = new Date();
                prisma.user.update({
                    where: { id: p.userId },
                    data: { lastActive: now },
                }).catch((err) => console.error("Failed to update lastActive on disconnect:", err));
                // Notify friends that user went offline
                notifyFriendsOfPresence(p.userId);
            }
        }

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

        // Broadcast updated world player count
        io.emit("world:info", {
            worldName: CURRENT_WORLD_NAME,
            playerCount: players.size,
        });

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

    // Wire the collision function so the physics engine can query blocks.
    setWorldCollisionFn(world.isSolidAt);

    httpServer.listen(PORT, () => {
        console.log(`Somewhere server running → http://localhost:${PORT}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});

module.exports = { app, httpServer };
