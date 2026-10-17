const assert = require("assert");
const {
    WORLD_CONFIG,
    createPlayer,
    getPublicPlayerState,
    isValidMovementInput,
    setPlayerMovementInput,
    resetPlayerMovementInput,
    simulateTick,
    createDimensionSnapshots
} = require("../src/simulation");

console.log("=== RUNNING NETWORK PROTOCOL & SECURITY VERIFICATION ===\n");

// 1. Initial Player State Structure
const p = createPlayer("socket_abc123", "Player-Test", "main");
assert.deepStrictEqual(p.position, { x: 200, y: 200 }, "Initial position must be { x: 200, y: 200 }");
assert.deepStrictEqual(p.input, { x: 0, y: 0 }, "Initial input must be { x: 0, y: 0 }");

// 2. Public Player State Serialization
const pub = getPublicPlayerState(p);
assert.strictEqual(pub.id, "socket_abc123");
assert.strictEqual(pub.name, "Player-Test");
assert.strictEqual(pub.dimensionId, "main");
assert.deepStrictEqual(pub.position, { x: 200, y: 200 });
assert.strictEqual(pub.input, undefined, "Internal input vector must NEVER be exposed publicly");

// 3. Movement Input Protocol: directional intent validation
// Valid inputs
assert.strictEqual(isValidMovementInput({ x: 0, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: 1, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: -1, y: 0 }), true);
assert.strictEqual(isValidMovementInput({ x: 0, y: 1 }), true);
assert.strictEqual(isValidMovementInput({ x: 0, y: -1 }), true);
assert.strictEqual(isValidMovementInput({ x: 1, y: 1 }), true);
assert.strictEqual(isValidMovementInput({ x: -1, y: -1 }), true);

// Invalid payloads
const invalidPayloads = [
    null,
    undefined,
    "w",
    123,
    {},
    { x: 1 },
    { y: -1 },
    { x: "1", y: 0 },
    { x: 0, y: "up" },
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    // Coordinate injection attempts (e.g. attempting to jump to coordinates)
    { x: 500, y: 200 },
    { x: -10, y: 0 },
    { x: 0, y: 20 },
    { position: { x: 500, y: 200 } },
    { x: 0, y: 0, position: { x: 500, y: 200 } }
];

for (const payload of invalidPayloads) {
    if (payload && typeof payload === "object" && typeof payload.x === "number" && typeof payload.y === "number") {
        if (payload.x >= -1 && payload.x <= 1 && payload.y >= -1 && payload.y <= 1) {
            // If valid x and y are present, check that position field cannot overwrite player position
            const pTest = createPlayer("p1", "Test");
            setPlayerMovementInput(pTest, payload);
            assert.strictEqual(pTest.position.x, 200, "Position must NOT be modified by movement input payload");
            assert.strictEqual(pTest.position.y, 200, "Position must NOT be modified by movement input payload");
            continue;
        }
    }
    assert.strictEqual(isValidMovementInput(payload), false, `Payload ${JSON.stringify(payload)} should be rejected`);
}

// 4. Movement Simulation Rate & Step
// 30 Hz simulation -> tick interval ~33.33ms
const tickDelta = 1 / 30;
const pMove = createPlayer("p-move", "Mover");
setPlayerMovementInput(pMove, { x: 1, y: 0 });
simulateTick([pMove], tickDelta);
// 1 tick at 180 units/sec = 180 / 30 = 6 units
assert.strictEqual(Math.round(pMove.position.x), 206, "Player should move 6 units in 1 tick");

// 5. Snapshot Broadcast Protocol
const pSnap1 = createPlayer("s1", "P1", "main", { x: 206, y: 200 });
const pSnap2 = createPlayer("s2", "P2", "main", { x: 194, y: 200 });
const pSnap3 = createPlayer("s3", "P3", "other-dim", { x: 300, y: 300 });

const snapshots = createDimensionSnapshots([pSnap1, pSnap2, pSnap3]);
assert.strictEqual(snapshots.length, 2, "Should create 2 dimension snapshots");

const mainSnap = snapshots.find(s => s.dimensionId === "main").snapshot;
assert(typeof mainSnap.timestamp === "number");
assert.strictEqual(mainSnap.players.length, 2);
assert.deepStrictEqual(mainSnap.players[0], { id: "s1", position: { x: 206, y: 200 } });
assert.deepStrictEqual(mainSnap.players[1], { id: "s2", position: { x: 194, y: 200 } });

console.log("✓ Network protocol and payload invariants verified.");
console.log("\nALL TESTS PASSED! ✓✓✓\n");
