// worldState.js — Block world management.
//
// The authoritative block world lives in this module.
// On server startup, we load all blocks from MongoDB.
// When a block changes, we immediately save to MongoDB.
//
// Blocks are stored in a Map keyed by "x,y,z" strings for fast lookup.
// The initial world (a flat grass floor with some raised blocks) is seeded
// once if the database is empty.

const prisma = require("./db");
const blockCatalog = require("./blockCatalog");

// In-memory store: "x,y,z" -> { x, y, z, type, id }
const blocks = new Map();

// --------------------------------------------------
// KEY HELPER
// --------------------------------------------------

function key(x, y, z) {
    return `${x},${y},${z}`;
}

// --------------------------------------------------
// INITIAL WORLD SEED
// --------------------------------------------------

// Called once when the database is empty.
// Creates a 20x20 flat floor of grass blocks at y=0,
// plus a few raised "stone" blocks for decoration.
async function seedInitialWorld() {
    console.log("No blocks found — seeding initial world...");

    const blocksToCreate = [];

    // 20 x 20 flat floor at y = 0
    for (let x = -10; x < 10; x++) {
        for (let z = -10; z < 10; z++) {
            blocksToCreate.push({ x, y: 0, z, type: "grass" });
        }
    }

    // A small raised platform in the center for demonstration
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            blocksToCreate.push({ x, y: 1, z, type: "stone" });
        }
    }

    // A few "wood" blocks sticking up
    blocksToCreate.push({ x: 0, y: 2, z: 0, type: "wood" });
    blocksToCreate.push({ x: 0, y: 3, z: 0, type: "wood" });

    // Insert all at once
    await prisma.block.createMany({ data: blocksToCreate });

    console.log(`Seeded ${blocksToCreate.length} blocks.`);
}

// --------------------------------------------------
// LOAD FROM DATABASE
// --------------------------------------------------

async function loadWorld() {
    // Clear in-memory state
    blocks.clear();

    const dbBlocks = await prisma.block.findMany();

    if (dbBlocks.length === 0) {
        // First run — create a starter world.
        await seedInitialWorld();
        // Load again after seeding.
        const seeded = await prisma.block.findMany();
        for (const b of seeded) {
            blocks.set(key(b.x, b.y, b.z), b);
        }
    } else {
        for (const b of dbBlocks) {
            blocks.set(key(b.x, b.y, b.z), b);
        }
    }

    console.log(`World loaded: ${blocks.size} blocks.`);
}

// --------------------------------------------------
// PLACE A BLOCK
// --------------------------------------------------

// Returns the new block object on success, null if position is already occupied.
async function placeBlock(x, y, z, type = "dirt") {
    const k = key(x, y, z);
    if (blocks.has(k)) {
        return null; // Already a block here.
    }

    // Save to database first.
    const dbBlock = await prisma.block.create({
        data: { x, y, z, type },
    });

    // Then update in-memory state.
    blocks.set(k, dbBlock);

    return dbBlock;
}

// --------------------------------------------------
// REMOVE A BLOCK
// --------------------------------------------------

// Returns true if the block existed and was removed, false otherwise.
async function removeBlock(x, y, z) {
    const k = key(x, y, z);
    const existing = blocks.get(k);

    if (!existing) {
        return false; // Nothing to remove.
    }

    // Delete from database.
    await prisma.block.delete({ where: { id: existing.id } });

    // Update in-memory state.
    blocks.delete(k);

    return true;
}

// --------------------------------------------------
// GET ALL BLOCKS (for sending initial world state to new clients)
// --------------------------------------------------

function getAllBlocks() {
    return Array.from(blocks.values()).map((b) => ({
        x: b.x,
        y: b.y,
        z: b.z,
        type: b.type,
    }));
}

// --------------------------------------------------
// COORDINATE VALIDATION
// --------------------------------------------------

// Reasonable limits to prevent griefing or malformed data.
// The world is a 60x20x60 box centered at origin.
const WORLD_LIMIT_XZ = 30; // x and z must be in [-30, 30]
const WORLD_LIMIT_Y_MIN = 0; // can't place underground
const WORLD_LIMIT_Y_MAX = 20; // can't build too high

function isValidBlockCoord(x, y, z) {
    return (
        Number.isInteger(x) &&
        Number.isInteger(y) &&
        Number.isInteger(z) &&
        x >= -WORLD_LIMIT_XZ && x <= WORLD_LIMIT_XZ &&
        y >= WORLD_LIMIT_Y_MIN && y <= WORLD_LIMIT_Y_MAX &&
        z >= -WORLD_LIMIT_XZ && z <= WORLD_LIMIT_XZ
    );
}

function isValidBlockType(type) {
    return blockCatalog.isValidBlockId(type);
}

module.exports = {
    loadWorld,
    getAllBlocks,
    placeBlock,
    removeBlock,
    isValidBlockCoord,
    isValidBlockType,
};