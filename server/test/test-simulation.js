const assert = require("assert");
const {
    WORLD_CONFIG,
    WORLD_BOUNDS,
    DEFAULT_SPAWN,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    updatePlayerPosition,
    simulateTick,
    createDimensionSnapshots
} = require("../src/simulation");

console.log("=== RUNNING SIMULATION & MOVEMENT UNIT TESTS ===\n");

// TEST: World Configuration and Boundaries
assert.strictEqual(WORLD_CONFIG.width, 800, "World width should be 800");
assert.strictEqual(WORLD_CONFIG.height, 400, "World height should be 400");
assert.strictEqual(WORLD_CONFIG.moveSpeed, 180, "Move speed should be 180 units/sec");
assert.strictEqual(WORLD_BOUNDS.minX, 12, "minX bound should be 12");
assert.strictEqual(WORLD_BOUNDS.maxX, 788, "maxX bound should be 788");
assert.strictEqual(WORLD_BOUNDS.minY, 12, "minY bound should be 12");
assert.strictEqual(WORLD_BOUNDS.maxY, 388, "maxY bound should be 388");
console.log("✓ World config and bounds verified.");

// TEST: Player Creation & Public State Isolation
const p1 = createPlayer("socket-1", "Alice", "main", { x: 200, y: 200 });
assert.strictEqual(p1.id, "socket-1");
assert.strictEqual(p1.name, "Alice");
assert.strictEqual(p1.dimensionId, "main");
assert.strictEqual(p1.position.x, 200);
assert.strictEqual(p1.position.y, 200);
assert.strictEqual(p1.input.x, 0);
assert.strictEqual(p1.input.y, 0);

const pubState = getPublicPlayerState(p1);
assert.strictEqual(pubState.id, p1.id);
assert.strictEqual(pubState.position.x, 200);
assert.strictEqual(pubState.input, undefined, "Public state must NEVER expose internal input");

// Mutating public state copy must not mutate internal state
pubState.position.x = 999;
assert.strictEqual(p1.position.x, 200, "Internal player position must not be mutable via public state");
console.log("✓ Player creation and state encapsulation verified.");

// TEST: Input Validation & Malformed Input Rejection (TEST 4)
assert.strictEqual(isValidMovementInput({ x: 0, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: 1, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: -1, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: 0, y: 1 }), true);
assert.strictEqual(isValidMovementInput({ x: 0, y: -1 }), true);
assert.strictEqual(isValidMovementInput({ x: 1, y: 1 }), true);
assert.strictEqual(isValidMovementInput({ x: -1, y: -1 }), true);

// Invalid payloads
assert.strictEqual(isValidMovementInput(null), false, "null should be rejected");
assert.strictEqual(isValidMovementInput(undefined), false, "undefined should be rejected");
assert.strictEqual(isValidMovementInput("move"), false, "string should be rejected");
assert.strictEqual(isValidMovementInput({}), false, "empty object should be rejected");
assert.strictEqual(isValidMovementInput({ x: 1 }), false, "missing y should be rejected");
assert.strictEqual(isValidMovementInput({ y: -1 }), false, "missing x should be rejected");
assert.strictEqual(isValidMovementInput({ x: NaN, y: 0 }), false, "NaN should be rejected");
assert.strictEqual(isValidMovementInput({ x: 0, y: Infinity }), false, "Infinity should be rejected");

// Out of range (attempted direct coordinates injection)
assert.strictEqual(isValidMovementInput({ x: 500, y: 200 }), false, "Large x coordinate must be rejected");
assert.strictEqual(isValidMovementInput({ x: -2, y: 0 }), false, "x < -1 must be rejected");
assert.strictEqual(isValidMovementInput({ x: 0, y: 1.5 }), false, "y > 1 must be rejected");

// Test that setPlayerMovementInput rejects invalid input without touching state
const pInputTest = createPlayer("s-test", "Tester");
const rejected = setPlayerMovementInput(pInputTest, { x: 500, y: 500, position: { x: 999, y: 999 } });
assert.strictEqual(rejected, false);
assert.strictEqual(pInputTest.input.x, 0);
assert.strictEqual(pInputTest.input.y, 0);
assert.strictEqual(pInputTest.position.x, 200);
assert.strictEqual(pInputTest.position.y, 200);
console.log("✓ Input validation and rejection of coordinate injection verified.");

// TEST: Diagonal Speed Normalization (TEST 3)
// 1. Horizontal movement for 1 second
const pHoriz = createPlayer("p-h", "Horiz", "main", { x: 200, y: 200 });
setPlayerMovementInput(pHoriz, { x: 1, y: 0 });
updatePlayerPosition(pHoriz, 1.0);
const horizDist = pHoriz.position.x - 200;
assert(Math.abs(horizDist - 180) < 0.001, `Horizontal distance should be 180, got ${horizDist}`);

// 2. Vertical movement for 1 second
const pVert = createPlayer("p-v", "Vert", "main", { x: 200, y: 200 });
setPlayerMovementInput(pVert, { x: 0, y: 1 });
updatePlayerPosition(pVert, 1.0);
const vertDist = pVert.position.y - 200;
assert(Math.abs(vertDist - 180) < 0.001, `Vertical distance should be 180, got ${vertDist}`);

// 3. Diagonal movement for 1 second
const pDiag = createPlayer("p-d", "Diag", "main", { x: 200, y: 200 });
setPlayerMovementInput(pDiag, { x: 1, y: 1 });
updatePlayerPosition(pDiag, 1.0);
const diagDist = Math.hypot(pDiag.position.x - 200, pDiag.position.y - 200);
assert(Math.abs(diagDist - 180) < 0.001, `Diagonal distance should be 180, got ${diagDist}`);
console.log(`✓ Speed normalization verified: Horizontal = ${horizDist}, Vertical = ${vertDist}, Diagonal = ${diagDist.toFixed(4)}.`);

// TEST: World Boundary Clamping
const pClamp = createPlayer("p-clamp", "Clamp", "main", { x: 780, y: 380 });
setPlayerMovementInput(pClamp, { x: 1, y: 1 });
// Move for 10 seconds to hit the wall
for (let i = 0; i < 300; i++) {
    updatePlayerPosition(pClamp, 1 / 30);
}
assert.strictEqual(pClamp.position.x, WORLD_BOUNDS.maxX, "Position x should be clamped to maxX (788)");
assert.strictEqual(pClamp.position.y, WORLD_BOUNDS.maxY, "Position y should be clamped to maxY (388)");

// Move left and up to hit min bounds
setPlayerMovementInput(pClamp, { x: -1, y: -1 });
for (let i = 0; i < 300; i++) {
    updatePlayerPosition(pClamp, 1 / 30);
}
assert.strictEqual(pClamp.position.x, WORLD_BOUNDS.minX, "Position x should be clamped to minX (12)");
assert.strictEqual(pClamp.position.y, WORLD_BOUNDS.minY, "Position y should be clamped to minY (12)");
console.log("✓ World boundary clamping verified.");

// TEST: Event-Loop Stall Protection (Excessive Delta Capping)
const pStall = createPlayer("p-stall", "Stall", "main", { x: 200, y: 200 });
setPlayerMovementInput(pStall, { x: 1, y: 0 });
// Simulate 10-second stall
simulateTick([pStall], 10.0);
// With 0.1s max cap, maximum movement is 0.1 * 180 = 18 units (from 200 to 218)
assert(pStall.position.x <= 218.01, `Position should be capped at 218, got ${pStall.position.x}`);
console.log(`✓ Event-loop stall capping verified: moved ${pStall.position.x - 200} units during simulated 10s stall.`);

// TEST: Dimension Snapshot Isolation
const pDim1 = createPlayer("p-dim1", "Player1", "main", { x: 100, y: 100 });
const pDim2 = createPlayer("p-dim2", "Player2", "main", { x: 150, y: 150 });
const pOtherDim = createPlayer("p-other", "PlayerOther", "secret-room", { x: 300, y: 300 });

const snapshots = createDimensionSnapshots([pDim1, pDim2, pOtherDim]);
assert.strictEqual(snapshots.length, 2, "Should create snapshots for 2 distinct dimensions");

const mainSnapshot = snapshots.find(s => s.dimensionId === "main");
assert(mainSnapshot, "Main dimension snapshot must exist");
assert.strictEqual(mainSnapshot.snapshot.players.length, 2, "Main dimension must only contain 2 players");
assert(mainSnapshot.snapshot.players.some(p => p.id === "p-dim1"));
assert(mainSnapshot.snapshot.players.some(p => p.id === "p-dim2"));
assert(!mainSnapshot.snapshot.players.some(p => p.id === "p-other"), "PlayerOther must NOT be in main snapshot");

const secretSnapshot = snapshots.find(s => s.dimensionId === "secret-room");
assert(secretSnapshot, "Secret room snapshot must exist");
assert.strictEqual(secretSnapshot.snapshot.players.length, 1);
assert.strictEqual(secretSnapshot.snapshot.players[0].id, "p-other");
console.log("✓ Dimension snapshot isolation verified.");

console.log("\nALL UNIT TESTS PASSED SUCCESSFULLY! ✓✓✓\n");
