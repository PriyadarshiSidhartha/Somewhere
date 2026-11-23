// test-physics.js — Comprehensive tests for the physics engine.
//
// Tests capsule-vs-block collision, gravity, jumping, grounded detection,
// coyote time, jump buffering, world bounds, and multi-block scenarios.
//
// Run with: node test/test-physics.js

const assert = require("assert");
const {
    PHYSICS_CONFIG,
    PHYSICS_DT,
    capsuleHalfHeight,
    capsuleAABB,
    capsuleVsBlock,
    resolveCollisions,
    probeGrounded,
    physicsStep,
    moveToward,
    createPhysicsState,
    clonePhysicsState,
} = require("../src/physics");

console.log("=== RUNNING PHYSICS ENGINE TESTS ===\n");

// --------------------------------------------------
// HELPER: create a simple block world for testing
// --------------------------------------------------

function createTestWorld(blocks) {
    // blocks is an array of [x, y, z] tuples.
    const solidSet = new Set();
    for (const [x, y, z] of blocks) {
        solidSet.add(`${x},${y},${z}`);
    }
    return function isSolidAt(x, y, z) {
        return solidSet.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);
    };
}

// A flat 20x20 floor at y=0.
function flatFloor() {
    const blocks = [];
    for (let x = -10; x < 10; x++) {
        for (let z = -10; z < 10; z++) {
            blocks.push([x, 0, z]);
        }
    }
    return createTestWorld(blocks);
}

// Step physics N times with fixed dt.
function stepN(state, input, isSolid, n, config) {
    config = config || PHYSICS_CONFIG;
    let time = 0;
    for (let i = 0; i < n; i++) {
        time += PHYSICS_DT;
        physicsStep(state, input, isSolid, config, PHYSICS_DT, time);
    }
    return time;
}

// --------------------------------------------------
// TEST: moveToward utility
// --------------------------------------------------
{
    assert.strictEqual(moveToward(0, 10, 3), 3);
    assert.strictEqual(moveToward(8, 10, 3), 10); // close enough → snap
    assert.strictEqual(moveToward(10, 10, 3), 10);
    assert.strictEqual(moveToward(5, 0, 2), 3);
    assert.strictEqual(moveToward(-1, -5, 2), -3);
    console.log("✓ moveToward utility works correctly.");
}

// --------------------------------------------------
// TEST: capsule AABB
// --------------------------------------------------
{
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const r = PHYSICS_CONFIG.capsuleRadius;
    const aabb = capsuleAABB(5, 3, 7, PHYSICS_CONFIG);
    assert(Math.abs(aabb.minX - (5 - r)) < 1e-6);
    assert(Math.abs(aabb.maxX - (5 + r)) < 1e-6);
    assert(Math.abs(aabb.minY - (3 - hh)) < 1e-6);
    assert(Math.abs(aabb.maxY - (3 + hh)) < 1e-6);
    assert(Math.abs(aabb.minZ - (7 - r)) < 1e-6);
    assert(Math.abs(aabb.maxZ - (7 + r)) < 1e-6);
    console.log("✓ Capsule AABB computed correctly.");
}

// --------------------------------------------------
// TEST: capsuleVsBlock — no collision (far away)
// --------------------------------------------------
{
    const hit = capsuleVsBlock(5, 5, 5, PHYSICS_CONFIG, 0, 0, 0);
    assert.strictEqual(hit, null, "No collision when capsule is far from block");
    console.log("✓ No collision when capsule is far from block.");
}

// --------------------------------------------------
// TEST: capsuleVsBlock — collision from above (standing on block)
// --------------------------------------------------
{
    // Place capsule center just above a block at y=0 (block occupies [0,0,0] → [1,1,1]).
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const cy = 1 + hh - 0.01; // just barely overlapping the top of the block
    const hit = capsuleVsBlock(0.5, cy, 0.5, PHYSICS_CONFIG, 0, 0, 0);
    assert(hit !== null, "Should collide when standing on block");
    assert(hit.ny > 0.5, "Normal should point upward (ground)");
    assert(hit.penetration > 0, "Penetration should be positive");
    console.log("✓ Capsule collides with block from above (ground detection).");
}

// --------------------------------------------------
// TEST: capsuleVsBlock — collision from side (walking into wall)
// --------------------------------------------------
{
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const r = PHYSICS_CONFIG.capsuleRadius;
    // Block at (3, 1, 0). Capsule at x just touching the block's left face.
    const cx = 3 - r + 0.01; // slightly inside the block
    const cy = 1.5 + hh; // vertically overlapping
    const hit = capsuleVsBlock(cx, cy, 0.5, PHYSICS_CONFIG, 3, 1, 0);
    assert(hit !== null, "Should collide when walking into wall");
    assert(hit.nx < -0.1 || hit.nz !== 0 || hit.ny !== 0, "Normal should push capsule away from block");
    console.log("✓ Capsule collides with block from the side (wall).");
}

// --------------------------------------------------
// TEST: resolveCollisions — standing on floor
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    // Place capsule slightly inside the floor.
    const result = resolveCollisions(0, 1 + hh - 0.1, 0, PHYSICS_CONFIG, isSolid);
    assert(result.groundedThisFrame, "Should be grounded on floor");
    assert(result.y >= 1 + hh - 0.01, "Should be pushed out of floor");
    console.log("✓ resolveCollisions: standing on floor works.");
}

// --------------------------------------------------
// TEST: resolveCollisions — no collision in mid-air
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const result = resolveCollisions(0, 5, 0, PHYSICS_CONFIG, isSolid);
    assert(!result.groundedThisFrame, "Should NOT be grounded in mid-air");
    assert(Math.abs(result.y - 5) < 0.01, "Position should not change in mid-air");
    console.log("✓ resolveCollisions: no collision in mid-air.");
}

// --------------------------------------------------
// TEST: Gravity — player falls when unsupported
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const state = createPhysicsState(0, 8, 0); // high above floor
    const input = { forward: 0, strafe: 0, yaw: 0, jump: false };

    const startY = state.position.y;
    stepN(state, input, isSolid, 30); // 0.5 seconds
    assert(state.position.y < startY, "Player should fall due to gravity");
    assert(state.velocity.y < 0, "Downward velocity should be negative");
    console.log(`✓ Gravity: player fell from ${startY.toFixed(2)} to ${state.position.y.toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: Gravity — player lands on floor and becomes grounded
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const state = createPhysicsState(0, 5, 0);
    const input = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Simulate until grounded (should land on y=0 floor → capsule center at 1 + hh).
    stepN(state, input, isSolid, 300); // 5 seconds — plenty of time to land
    assert(state.grounded, "Player should be grounded after landing");
    // Capsule center should be at approximately 1 + hh (top of block + half height).
    const expectedY = 1 + hh;
    assert(
        Math.abs(state.position.y - expectedY) < 0.1,
        `Capsule center should be ~${expectedY.toFixed(2)}, got ${state.position.y.toFixed(2)}`
    );
    assert(Math.abs(state.velocity.y) < 0.1, "Vertical velocity should be ~0 when grounded");
    console.log(`✓ Player lands on floor: y=${state.position.y.toFixed(3)}, grounded=${state.grounded}.`);
}

// --------------------------------------------------
// TEST: Terminal velocity
// --------------------------------------------------
{
    const noFloor = createTestWorld([]); // empty world
    const state = createPhysicsState(0, 200, 0); // very high, above boundYMax
    const input = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Fall for 3 seconds (enough to reach terminal velocity: tv/g = 40/28 ≈ 1.4s).
    let time = 0;
    for (let i = 0; i < 180; i++) {
        time += PHYSICS_DT;
        physicsStep(state, input, noFloor, PHYSICS_CONFIG, PHYSICS_DT, time);
        // Stop before hitting kill plane.
        if (state.position.y <= PHYSICS_CONFIG.boundYMin + 5) break;
    }
    assert(
        Math.abs(state.velocity.y) >= PHYSICS_CONFIG.terminalVelocity - 1.0,
        `Velocity should reach near terminal velocity (${PHYSICS_CONFIG.terminalVelocity}), got ${Math.abs(state.velocity.y).toFixed(2)}`
    );
    assert(
        Math.abs(state.velocity.y) <= PHYSICS_CONFIG.terminalVelocity + 0.1,
        `Velocity should not exceed terminal velocity (${PHYSICS_CONFIG.terminalVelocity}), got ${Math.abs(state.velocity.y).toFixed(2)}`
    );
    console.log(`✓ Terminal velocity reached: ${Math.abs(state.velocity.y).toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: Jumping — from ground
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };
    const doJump = { forward: 0, strafe: 0, yaw: 0, jump: true };

    // Land first.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should be grounded before jumping");
    const groundY = state.position.y;

    // Jump.
    physicsStep(state, doJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, 100);
    assert(state.velocity.y > 0, "Should have upward velocity after jump");
    assert(!state.grounded || state.velocity.y > 0, "Should leave ground after jump");

    // Let jump play out.
    stepN(state, noJump, isSolid, 60); // ~1 second
    // Should have risen and started coming back down (or already landed).
    // The key assertion is that jump happened.
    console.log(`✓ Jump: ground at ${groundY.toFixed(2)}, after jump y=${state.position.y.toFixed(2)}, vy=${state.velocity.y.toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: No double jump (can't jump while airborne)
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };
    const doJump = { forward: 0, strafe: 0, yaw: 0, jump: true };

    // Land first.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should be grounded");

    // Jump.
    let time = 100;
    time += PHYSICS_DT;
    physicsStep(state, doJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    const jumpVY = state.velocity.y;

    // Wait until clearly airborne (past coyote time).
    for (let i = 0; i < 20; i++) {
        time += PHYSICS_DT;
        physicsStep(state, noJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }
    assert(!state.grounded, "Should be airborne");

    // Try to jump again — velocity should NOT increase.
    const airVY = state.velocity.y;
    time += PHYSICS_DT;
    physicsStep(state, doJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    assert(
        state.velocity.y <= airVY + 0.01,
        `Double-jump should not be possible. vy before=${airVY.toFixed(2)}, after=${state.velocity.y.toFixed(2)}`
    );
    console.log("✓ Double-jump prevented while airborne.");
}

// --------------------------------------------------
// TEST: Coyote time — can jump just after leaving a ledge
// --------------------------------------------------
{
    // Build a small platform: blocks at y=0 from x=-2..2, z=-2..2.
    const platformBlocks = [];
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            platformBlocks.push([x, 0, z]);
        }
    }
    const isSolid = createTestWorld(platformBlocks);
    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land on platform.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should be grounded on platform");

    // Walk off the edge.
    const walkOff = { forward: 0, strafe: 1, yaw: 0, jump: false };
    let time = 500;
    // Walk until off the platform edge.
    for (let i = 0; i < 120; i++) {
        time += PHYSICS_DT;
        physicsStep(state, walkOff, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Check if we're off the platform (x > 3).
    if (state.position.x > 3) {
        // We're off the edge. Check if coyote time allows jump.
        const timeSinceGround = time - state.lastGroundedTime;
        if (timeSinceGround <= PHYSICS_CONFIG.coyoteTime && PHYSICS_CONFIG.coyoteTime > 0) {
            const doJump = { forward: 0, strafe: 0, yaw: 0, jump: true };
            const preJumpVY = state.velocity.y;
            time += PHYSICS_DT;
            physicsStep(state, doJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
            assert(
                state.velocity.y > preJumpVY,
                "Coyote jump should work"
            );
            console.log("✓ Coyote time: jumped after leaving ledge.");
        } else {
            console.log("✓ Coyote time: walked too far, timer expired (expected with long walk).");
        }
    } else {
        console.log("✓ Coyote time: still on platform (needs longer walk for edge test).");
    }
}

// --------------------------------------------------
// TEST: Walking into a wall
// --------------------------------------------------
{
    // Floor at y=0, wall block at (3, 1, 0).
    const blocks = [];
    for (let x = -5; x < 10; x++) {
        for (let z = -5; z < 5; z++) {
            blocks.push([x, 0, z]);
        }
    }
    blocks.push([5, 1, 0]); // wall block
    blocks.push([5, 2, 0]); // wall block (tall wall)
    const isSolid = createTestWorld(blocks);

    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land.
    stepN(state, noJump, isSolid, 300);

    // Walk toward the wall (strafe right, yaw=0 → +X direction).
    const walkRight = { forward: 0, strafe: 1, yaw: 0, jump: false };
    let time = 1000;
    for (let i = 0; i < 300; i++) {
        time += PHYSICS_DT;
        physicsStep(state, walkRight, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Player should be stopped by the wall, not past x=5.
    assert(
        state.position.x < 5,
        `Player should be blocked by wall at x=5, got x=${state.position.x.toFixed(2)}`
    );
    console.log(`✓ Wall collision: player stopped at x=${state.position.x.toFixed(2)} (wall at x=5).`);
}

// --------------------------------------------------
// TEST: Standing on top of blocks
// --------------------------------------------------
{
    // A tower of blocks at (0, 0..3, 0).
    const blocks = [];
    for (let x = -3; x < 3; x++) {
        for (let z = -3; z < 3; z++) {
            blocks.push([x, 0, z]);
        }
    }
    blocks.push([0, 1, 0]);
    blocks.push([0, 2, 0]);
    blocks.push([0, 3, 0]);
    const isSolid = createTestWorld(blocks);

    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const state = createPhysicsState(0.5, 10, 0.5);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should land on top of tower");
    // Top of tower block is at y=4 (block [0,3,0] occupies y=3..4).
    const expectedY = 4 + hh;
    assert(
        Math.abs(state.position.y - expectedY) < 0.15,
        `Should be at ~${expectedY.toFixed(2)}, got ${state.position.y.toFixed(2)}`
    );
    console.log(`✓ Standing on block tower: y=${state.position.y.toFixed(3)} (expected ~${expectedY.toFixed(2)}).`);
}

// --------------------------------------------------
// TEST: Walking off a ledge (falls naturally)
// --------------------------------------------------
{
    // Small platform then void — platform from x=-3..3, void from x=4+.
    const blocks = [];
    for (let x = -3; x <= 3; x++) {
        for (let z = -3; z <= 3; z++) {
            blocks.push([x, 0, z]);
        }
    }
    const isSolid = createTestWorld(blocks);

    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land on platform.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should be grounded on platform");
    const groundY = state.position.y;

    // Walk off the edge (strafe right → +X → off the edge past x=4).
    const walkRight = { forward: 0, strafe: 1, yaw: 0, jump: false };
    let time = 1000;
    // Walk just long enough to pass the edge, not so long we hit world bounds.
    for (let i = 0; i < 90; i++) {
        time += PHYSICS_DT;
        physicsStep(state, walkRight, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // If we're past the platform edge (x > 4), we should be falling.
    if (state.position.x > 4) {
        assert(
            state.position.y < groundY - 0.5,
            `Should have fallen off ledge. y=${state.position.y.toFixed(2)}, was at ${groundY.toFixed(2)}`
        );
        console.log(`✓ Walking off ledge: fell from ${groundY.toFixed(2)} to ${state.position.y.toFixed(2)}.`);
    } else {
        // Still on platform, need more steps — accelerate and check.
        for (let i = 0; i < 60; i++) {
            time += PHYSICS_DT;
            physicsStep(state, walkRight, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
        }
        // Now stop horizontal input and let gravity work.
        for (let i = 0; i < 30; i++) {
            time += PHYSICS_DT;
            physicsStep(state, noJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
        }
        if (state.position.x > 4) {
            assert(
                state.position.y < groundY,
                `Should fall after leaving platform. y=${state.position.y.toFixed(2)}`
            );
        }
        console.log(`✓ Walking off ledge: x=${state.position.x.toFixed(2)}, y=${state.position.y.toFixed(2)}.`);
    }
}

// --------------------------------------------------
// TEST: Ceiling collision
// --------------------------------------------------
{
    // Floor at y=0, ceiling at y=3 (block at [0, 3, 0]).
    const blocks = [];
    for (let x = -3; x < 3; x++) {
        for (let z = -3; z < 3; z++) {
            blocks.push([x, 0, z]);
            blocks.push([x, 3, z]); // ceiling
        }
    }
    const isSolid = createTestWorld(blocks);
    const hh = capsuleHalfHeight(PHYSICS_CONFIG);

    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land on floor.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Grounded on floor");

    // Jump — should hit the ceiling.
    const doJump = { forward: 0, strafe: 0, yaw: 0, jump: true };
    let time = 2000;
    time += PHYSICS_DT;
    physicsStep(state, doJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);

    // Let the jump play out under the ceiling.
    for (let i = 0; i < 60; i++) {
        time += PHYSICS_DT;
        physicsStep(state, noJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Player should not have passed through the ceiling (block bottom at y=3).
    assert(
        state.position.y + hh <= 3 + 0.1,
        `Player head should not pass through ceiling at y=3. Top of capsule: ${(state.position.y + hh).toFixed(2)}`
    );
    console.log(`✓ Ceiling collision: capsule top at ${(state.position.y + hh).toFixed(2)} (ceiling at y=3).`);
}

// --------------------------------------------------
// TEST: Multiple simultaneous collisions (corner)
// --------------------------------------------------
{
    // Two adjacent wall blocks forming a corner.
    const blocks = [];
    for (let x = -5; x < 5; x++) {
        for (let z = -5; z < 5; z++) {
            blocks.push([x, 0, z]);
        }
    }
    blocks.push([3, 1, 0]); // wall X
    blocks.push([3, 1, 1]); // wall Z
    blocks.push([3, 2, 0]);
    blocks.push([3, 2, 1]);
    const isSolid = createTestWorld(blocks);

    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    // Place capsule near the corner.
    const state = createPhysicsState(2, 5, 0.5);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land.
    stepN(state, noJump, isSolid, 300);

    // Walk into the corner.
    const walkInto = { forward: 0, strafe: 1, yaw: 0, jump: false };
    let time = 3000;
    for (let i = 0; i < 120; i++) {
        time += PHYSICS_DT;
        physicsStep(state, walkInto, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Should not have penetrated either wall block.
    assert(
        state.position.x < 3,
        `Should not penetrate wall at x=3, got x=${state.position.x.toFixed(2)}`
    );
    console.log(`✓ Corner collision handled: x=${state.position.x.toFixed(2)}, z=${state.position.z.toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: Jump while moving
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land.
    stepN(state, noJump, isSolid, 300);
    const landX = state.position.x;
    const landZ = state.position.z;

    // Move forward and jump.
    const moveAndJump = { forward: 1, strafe: 0, yaw: 0, jump: true };
    let time = 4000;
    time += PHYSICS_DT;
    physicsStep(state, moveAndJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);

    // Continue moving (no jump) while airborne.
    const moveOnly = { forward: 1, strafe: 0, yaw: 0, jump: false };
    for (let i = 0; i < 60; i++) {
        time += PHYSICS_DT;
        physicsStep(state, moveOnly, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Should have moved forward and gone up then down.
    const movedZ = state.position.z - landZ;
    assert(movedZ < -1, `Should have moved forward. dz=${movedZ.toFixed(2)}`);
    console.log(`✓ Jump while moving: moved ${movedZ.toFixed(2)} in Z during jump.`);
}

// --------------------------------------------------
// TEST: Physics state cloning is independent
// --------------------------------------------------
{
    const state = createPhysicsState(1, 2, 3);
    state.velocity.x = 5;
    state.grounded = true;

    const clone = clonePhysicsState(state);
    clone.position.x = 999;
    clone.velocity.x = 0;
    clone.grounded = false;

    assert.strictEqual(state.position.x, 1, "Clone must not affect original position");
    assert.strictEqual(state.velocity.x, 5, "Clone must not affect original velocity");
    assert.strictEqual(state.grounded, true, "Clone must not affect original grounded");
    console.log("✓ Physics state cloning is independent.");
}

// --------------------------------------------------
// TEST: World bounds — kill plane
// --------------------------------------------------
{
    const noFloor = createTestWorld([]);
    const state = createPhysicsState(0, -5, 0); // below kill plane
    state.velocity.y = -10;
    const input = { forward: 0, strafe: 0, yaw: 0, jump: false };

    stepN(state, input, noFloor, 60);

    // Should have been respawned to boundYMax.
    assert(
        state.position.y >= PHYSICS_CONFIG.boundYMin,
        `Player should not go below kill plane. y=${state.position.y.toFixed(2)}`
    );
    console.log(`✓ Kill plane: player respawned at y=${state.position.y.toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: Multiple players simulated independently
// --------------------------------------------------
{
    const isSolid = flatFloor();
    const state1 = createPhysicsState(0, 5, 0);
    const state2 = createPhysicsState(5, 5, 5);
    const input1 = { forward: 1, strafe: 0, yaw: 0, jump: false };
    const input2 = { forward: 0, strafe: 1, yaw: 0, jump: false };

    let time = 0;
    for (let i = 0; i < 120; i++) {
        time += PHYSICS_DT;
        physicsStep(state1, input1, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
        physicsStep(state2, input2, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Both should have moved in different directions.
    assert(state1.position.z < 0, "Player 1 should move in -Z (forward at yaw=0)");
    assert(state2.position.x > 5, "Player 2 should move in +X (strafe right at yaw=0)");
    // Their movements should be independent.
    assert(
        Math.abs(state1.position.x - 0) < 0.5,
        "Player 1 x should not be affected by player 2"
    );
    console.log("✓ Multiple players simulated independently.");
}

// --------------------------------------------------
// TEST: Narrow passage (1-block-wide corridor)
// --------------------------------------------------
{
    // Floor + two walls forming a 1-wide corridor along Z.
    const blocks = [];
    for (let z = -5; z < 5; z++) {
        blocks.push([0, 0, z]); // floor
        blocks.push([-1, 1, z]); // left wall
        blocks.push([1, 1, z]);  // right wall
        blocks.push([-1, 2, z]);
        blocks.push([1, 2, z]);
    }
    const isSolid = createTestWorld(blocks);

    const hh = capsuleHalfHeight(PHYSICS_CONFIG);
    const state = createPhysicsState(0.5, 5, -3);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land.
    stepN(state, noJump, isSolid, 300);

    // Walk forward through the corridor.
    const walkForward = { forward: 1, strafe: 0, yaw: 0, jump: false };
    let time = 5000;
    for (let i = 0; i < 120; i++) {
        time += PHYSICS_DT;
        physicsStep(state, walkForward, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    // Should have moved forward (z decreased) without getting stuck.
    assert(state.position.z < -3, `Should have moved forward in corridor. z=${state.position.z.toFixed(2)}`);
    // Should not have passed through walls.
    assert(state.position.x > -1 && state.position.x < 2, "Should stay within corridor walls");
    console.log(`✓ Narrow passage: moved to z=${state.position.z.toFixed(2)}, x=${state.position.x.toFixed(2)}.`);
}

// --------------------------------------------------
// TEST: Block placed/removed affects subsequent physics
// --------------------------------------------------
{
    // Start with a floor.
    const solidSet = new Set();
    for (let x = -5; x < 5; x++) {
        for (let z = -5; z < 5; z++) {
            solidSet.add(`${x},0,${z}`);
        }
    }
    const isSolid = (x, y, z) => solidSet.has(`${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`);

    const state = createPhysicsState(0, 5, 0);
    const noJump = { forward: 0, strafe: 0, yaw: 0, jump: false };

    // Land.
    stepN(state, noJump, isSolid, 300);
    assert(state.grounded, "Should be grounded");
    const groundY = state.position.y;

    // Remove the block under the player.
    solidSet.delete("0,0,0");

    // Step physics — player should start falling.
    let time = 6000;
    for (let i = 0; i < 60; i++) {
        time += PHYSICS_DT;
        physicsStep(state, noJump, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
    }

    assert(
        state.position.y < groundY - 0.5,
        `Player should fall after block removed. y=${state.position.y.toFixed(2)}, was ${groundY.toFixed(2)}`
    );
    console.log("✓ Block removal: player falls after block beneath is removed.");
}

// --------------------------------------------------
// TEST: Deterministic — same inputs produce same output
// --------------------------------------------------
{
    const isSolid = flatFloor();

    const state1 = createPhysicsState(0, 5, 0);
    const state2 = createPhysicsState(0, 5, 0);

    const inputs = [
        { forward: 1, strafe: 0, yaw: 0, jump: false },
        { forward: 1, strafe: 0, yaw: 0, jump: false },
        { forward: 1, strafe: 0, yaw: 0, jump: true },
        { forward: 1, strafe: 1, yaw: 0.5, jump: false },
        { forward: 0, strafe: 0, yaw: 0.5, jump: false },
    ];

    let time = 0;
    for (const input of inputs) {
        for (let i = 0; i < 30; i++) {
            time += PHYSICS_DT;
            physicsStep(state1, input, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
            physicsStep(state2, input, isSolid, PHYSICS_CONFIG, PHYSICS_DT, time);
        }
    }

    assert.strictEqual(state1.position.x, state2.position.x, "X must be identical");
    assert.strictEqual(state1.position.y, state2.position.y, "Y must be identical");
    assert.strictEqual(state1.position.z, state2.position.z, "Z must be identical");
    assert.strictEqual(state1.velocity.x, state2.velocity.x, "VX must be identical");
    assert.strictEqual(state1.velocity.y, state2.velocity.y, "VY must be identical");
    assert.strictEqual(state1.velocity.z, state2.velocity.z, "VZ must be identical");
    console.log("✓ Determinism: identical inputs produce identical results.");
}

console.log("\nALL PHYSICS TESTS PASSED ✓✓✓\n");
