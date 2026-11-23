// test-block-catalog.js — Unit tests for Centralized Block Database & Search.
//
// Run with: node test/test-block-catalog.js

const assert = require("assert");
const {
    BLOCK_CATALOG,
    DEFAULT_RECENT_BLOCKS,
    getBlock,
    isValidBlockId,
    getAllBlocks,
    searchBlocks,
} = require("../src/blockCatalog");
const world = require("../src/worldState");

console.log("=== RUNNING BLOCK CATALOG & DISCOVERY UNIT TESTS ===\n");

// TEST 1: Catalogue integrity
assert(Array.isArray(BLOCK_CATALOG), "Catalogue must be an array");
assert(BLOCK_CATALOG.length >= 20, `Catalogue should have at least 20 blocks, got ${BLOCK_CATALOG.length}`);

const ids = new Set();
for (const b of BLOCK_CATALOG) {
    assert(typeof b.id === "string" && b.id.length > 0, "Block must have valid id");
    assert(typeof b.name === "string" && b.name.length > 0, "Block must have valid name");
    assert(typeof b.color === "number", "Block must have numeric color");
    assert(typeof b.hex === "string" && b.hex.startsWith("#"), "Block must have CSS hex");
    assert(!ids.has(b.id), `Duplicate block id detected: ${b.id}`);
    ids.add(b.id);
}
console.log(`✓ Block catalogue integrity: ${BLOCK_CATALOG.length} unique blocks verified.`);

// TEST 2: Block retrieval
const dirt = getBlock("dirt");
assert(dirt !== null, "dirt must be in catalogue");
assert.strictEqual(dirt.name, "Dirt");

const planks = getBlock("wood_planks");
assert(planks !== null, "wood_planks must be in catalogue");
assert.strictEqual(planks.name, "Wood Planks");

// Alias resolution
const legacyWood = getBlock("wood");
assert(legacyWood !== null, "legacy 'wood' alias must resolve");
assert.strictEqual(legacyWood.id, "wood_planks");

// Non-existent blocks
assert.strictEqual(getBlock("non_existent_block_999"), null);
assert.strictEqual(getBlock(""), null);
assert.strictEqual(getBlock(null), null);
console.log("✓ Block retrieval and alias resolution verified.");

// TEST 3: Validation helpers
assert.strictEqual(isValidBlockId("dirt"), true);
assert.strictEqual(isValidBlockId("diamond_block"), true);
assert.strictEqual(isValidBlockId("wood"), true); // alias
assert.strictEqual(isValidBlockId("fake_block"), false);
assert.strictEqual(isValidBlockId(""), false);
assert.strictEqual(isValidBlockId(123), false);

// World validation integration
assert.strictEqual(world.isValidBlockType("grass"), true);
assert.strictEqual(world.isValidBlockType("diamond_block"), true);
assert.strictEqual(world.isValidBlockType("wood_planks"), true);
assert.strictEqual(world.isValidBlockType("unknown_xyz"), false);
console.log("✓ Validation helpers verified.");

// TEST 4: Default 10 recent blocks
assert.strictEqual(DEFAULT_RECENT_BLOCKS.length, 10, "Must have exactly 10 default blocks");
for (const id of DEFAULT_RECENT_BLOCKS) {
    assert(isValidBlockId(id), `Default block ${id} must exist in catalogue`);
}
console.log("✓ Default 10 recent block shortcuts verified.");

// TEST 5: Search engine
// Case-insensitive & partial match
const woodResults = searchBlocks("wood");
assert(woodResults.length >= 2, "Searching 'wood' should find Wood Planks and Wood Log");
assert(woodResults.some((b) => b.id === "wood_planks"));
assert(woodResults.some((b) => b.id === "wood_log"));

// Case insensitivity
const capResults = searchBlocks("DIAMOND");
assert.strictEqual(capResults.length, 1);
assert.strictEqual(capResults[0].id, "diamond_block");

// Limit capping
const allResults = searchBlocks("e", 5);
assert(allResults.length <= 5, "Search must respect limit param");

// Empty / invalid queries
assert.deepStrictEqual(searchBlocks(""), []);
assert.deepStrictEqual(searchBlocks("   "), []);
assert.deepStrictEqual(searchBlocks(null), []);
assert.deepStrictEqual(searchBlocks("zzzzzzzzzzzznotfound"), []);
console.log("✓ Dynamic search engine verified.");

console.log("\nALL BLOCK CATALOG TESTS PASSED ✓✓✓\n");
