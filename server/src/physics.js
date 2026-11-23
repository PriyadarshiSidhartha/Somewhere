// physics.js — Shared physics configuration, capsule-vs-block collision solver,
// and deterministic physics step function.
//
// This module is the SINGLE SOURCE OF TRUTH for all physics parameters.
// It is used identically on the server (Node.js require) and the client
// (embedded inline). Both must produce the same results given the same inputs.
//
// Design decisions:
//   - Capsule collision shape (not point, not sphere, not AABB).
//   - Broad-phase: compute which block cells overlap the capsule's AABB.
//   - Narrow-phase: capsule-vs-axis-aligned-box overlap + penetration resolution.
//   - Iterative collision resolution (3 passes) handles corners and multi-contact.
//   - Fixed-timestep sub-stepping for determinism.
//   - No external physics engine — purpose-built for block worlds.

// --------------------------------------------------
// PHYSICS CONFIGURATION
// --------------------------------------------------

const PHYSICS_CONFIG = {
    // --- Movement ---
    moveSpeed:      8,      // Target horizontal speed (units/second)
    acceleration:   40,     // How quickly player reaches target speed (units/s²)
    deceleration:   30,     // How quickly player stops when no input (units/s²)

    // --- Gravity & Jumping ---
    gravity:          28,     // Downward acceleration (units/s²)
    jumpForce:        10,     // Initial upward velocity on jump (units/s)
    terminalVelocity: 40,     // Maximum falling speed (units/s)

    // --- Capsule Collision Shape ---
    capsuleRadius:  0.3,    // Radius of the capsule cylinder/hemispheres
    capsuleHeight:  1.8,    // Total height of the capsule (tip to tip)
    collisionSkin:  0.001,  // Small tolerance to prevent floating-point sticking

    // --- Jump Assists ---
    coyoteTime:     0.12,   // Grace period after leaving ledge where jump is still allowed (seconds)
    jumpBuffer:     0.10,   // Time window to register jump input before landing (seconds)

    // --- Simulation ---
    physicsTickRate: 60,    // Fixed physics timestep frequency (Hz)
    snapshotRate:    20,    // How often the server broadcasts state (Hz)

    // --- World Bounds ---
    boundXZ:        30,     // World XZ boundary (from -bound to +bound)
    boundYMin:     -10,     // Minimum Y (kill plane)
    boundYMax:      50,     // Maximum Y
};

// Derived constants (computed once)
const PHYSICS_DT = 1 / PHYSICS_CONFIG.physicsTickRate;

// --------------------------------------------------
// CAPSULE GEOMETRY HELPERS
// --------------------------------------------------

// A capsule is defined by its center position (the midpoint of the capsule),
// radius, and half-height (from center to hemisphere tip = capsuleHeight/2).
// The two hemisphere centers are at:
//   top    = center.y + halfHeight - radius
//   bottom = center.y - halfHeight + radius
// where halfHeight = capsuleHeight / 2.

function capsuleHalfHeight(config) {
    return config.capsuleHeight / 2;
}

// Get the AABB of the capsule for broad-phase.
// Position is the capsule CENTER (player position is typically feet-based,
// so we convert: center.y = feet.y + halfHeight).
function capsuleAABB(cx, cy, cz, config) {
    const hh = capsuleHalfHeight(config);
    const r = config.capsuleRadius;
    return {
        minX: cx - r,
        maxX: cx + r,
        minY: cy - hh,
        maxY: cy + hh,
        minZ: cz - r,
        maxZ: cz + r,
    };
}

// --------------------------------------------------
// CAPSULE VS AXIS-ALIGNED BOX COLLISION
// --------------------------------------------------

// Each block occupies [bx, bx+1] × [by, by+1] × [bz, bz+1] in world space.
// The block's integer coordinates (bx, by, bz) are its minimum corner.
//
// Collision test: find the closest point on the capsule's line segment
// to the box, then check if that distance is less than the capsule radius.
//
// Returns null if no collision, or { nx, ny, nz, penetration } if colliding.

function capsuleVsBlock(cx, cy, cz, config, bx, by, bz) {
    const r = config.capsuleRadius;
    const hh = capsuleHalfHeight(config);

    // Capsule line segment endpoints (the two hemisphere centers).
    const segTopY    = cy + hh - r;
    const segBottomY = cy - hh + r;

    // Block AABB: [bx, bx+1] × [by, by+1] × [bz, bz+1]
    const boxMinX = bx, boxMaxX = bx + 1;
    const boxMinY = by, boxMaxY = by + 1;
    const boxMinZ = bz, boxMaxZ = bz + 1;

    // Find the closest point on the capsule's vertical line segment
    // to the block AABB.
    //
    // The capsule segment is at (cx, t, cz) where t ∈ [segBottomY, segTopY].
    // We clamp t to the box's Y range to find the best Y on the segment
    // closest to the box.

    // Clamp the segment Y to the box Y range, then clamp that to the segment range.
    const closestSegY = Math.max(segBottomY, Math.min(segTopY,
        Math.max(boxMinY, Math.min(boxMaxY, (segBottomY + segTopY) / 2))
    ));

    // Now find closest point on the box to (cx, closestSegY, cz).
    // But we need to iterate: find the closest point on the box to the
    // segment, not just to the segment midpoint.

    // More robust approach: clamp box Y to segment, find closest on segment,
    // then find closest on box to that segment point.

    // Step 1: Clamp segment Y to box Y range → candidate Y on the box side.
    const boxClampedY = Math.max(boxMinY, Math.min(boxMaxY,
        Math.max(segBottomY, Math.min(segTopY, (boxMinY + boxMaxY) / 2))
    ));

    // Step 2: The closest point on the segment to the box in Y is:
    const segY = Math.max(segBottomY, Math.min(segTopY, boxClampedY));

    // Step 3: Closest point on the box AABB to (cx, segY, cz).
    const closestX = Math.max(boxMinX, Math.min(boxMaxX, cx));
    const closestY = Math.max(boxMinY, Math.min(boxMaxY, segY));
    const closestZ = Math.max(boxMinZ, Math.min(boxMaxZ, cz));

    // Distance from capsule segment point to closest box point.
    const dx = cx - closestX;
    const dy = segY - closestY;
    const dz = cz - closestZ;
    const distSq = dx * dx + dy * dy + dz * dz;

    const skinR = r + config.collisionSkin;

    if (distSq >= skinR * skinR) {
        return null; // No collision.
    }

    const dist = Math.sqrt(distSq);

    // Compute penetration normal and depth.
    let nx, ny, nz, penetration;

    if (dist < 1e-8) {
        // Capsule center is inside the box — use minimum separation axis.
        // Find the axis with least penetration and push out along it.
        const penXPos = boxMaxX - (cx - r);
        const penXNeg = (cx + r) - boxMinX;
        const penYPos = boxMaxY - (segY - r);
        const penYNeg = (segY + r) - boxMinY;
        const penZPos = boxMaxZ - (cz - r);
        const penZNeg = (cz + r) - boxMinZ;

        // Find minimum penetration.
        let minPen = penXPos;
        nx = 1; ny = 0; nz = 0;

        if (penXNeg < minPen) { minPen = penXNeg; nx = -1; ny = 0; nz = 0; }
        if (penYPos < minPen) { minPen = penYPos; nx = 0; ny = 1; nz = 0; }
        if (penYNeg < minPen) { minPen = penYNeg; nx = 0; ny = -1; nz = 0; }
        if (penZPos < minPen) { minPen = penZPos; nx = 0; ny = 0; nz = 1; }
        if (penZNeg < minPen) { minPen = penZNeg; nx = 0; ny = 0; nz = -1; }

        penetration = minPen;
    } else {
        // Normal case: push capsule out along the vector from closest point to segment.
        nx = dx / dist;
        ny = dy / dist;
        nz = dz / dist;
        penetration = skinR - dist;
    }

    return { nx, ny, nz, penetration };
}

// --------------------------------------------------
// COLLISION RESOLUTION
// --------------------------------------------------

// Given the player's capsule center position, check all nearby blocks
// and resolve collisions iteratively.
//
// `isSolidAt(x, y, z)` — function that returns true if integer block coords
// contain a solid block. This is provided by worldState on the server
// and by the client's block map.
//
// Returns: { x, y, z, groundedThisFrame }
// where x, y, z are the corrected capsule center position.

function resolveCollisions(cx, cy, cz, config, isSolidAt) {
    const r = config.capsuleRadius;
    const hh = capsuleHalfHeight(config);
    let groundedThisFrame = false;

    // We iterate collision resolution multiple times to handle corners
    // and multiple simultaneous contacts.
    const MAX_ITERATIONS = 4;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        // Broad phase: compute AABB of capsule, find overlapping block cells.
        const aabb = capsuleAABB(cx, cy, cz, config);

        const minBX = Math.floor(aabb.minX);
        const maxBX = Math.floor(aabb.maxX);
        const minBY = Math.floor(aabb.minY);
        const maxBY = Math.floor(aabb.maxY);
        const minBZ = Math.floor(aabb.minZ);
        const maxBZ = Math.floor(aabb.maxZ);

        let deepestPen = 0;
        let bestNx = 0, bestNy = 0, bestNz = 0;

        // Narrow phase: test each candidate block.
        for (let bx = minBX; bx <= maxBX; bx++) {
            for (let by = minBY; by <= maxBY; by++) {
                for (let bz = minBZ; bz <= maxBZ; bz++) {
                    if (!isSolidAt(bx, by, bz)) continue;

                    const hit = capsuleVsBlock(cx, cy, cz, config, bx, by, bz);
                    if (hit && hit.penetration > deepestPen) {
                        deepestPen = hit.penetration;
                        bestNx = hit.nx;
                        bestNy = hit.ny;
                        bestNz = hit.nz;
                    }
                }
            }
        }

        if (deepestPen <= 0) break; // No more collisions.

        // Resolve: push capsule out along the deepest penetration normal.
        cx += bestNx * deepestPen;
        cy += bestNy * deepestPen;
        cz += bestNz * deepestPen;

        // If the push-out normal points upward (ground), mark grounded.
        if (bestNy > 0.5) {
            groundedThisFrame = true;
        }
    }

    return { x: cx, y: cy, z: cz, groundedThisFrame };
}

// --------------------------------------------------
// GROUNDED CHECK (auxiliary — used for coyote time)
// --------------------------------------------------

// A quick probe: is there a solid block just below the player's feet?
// This supplements the collision-resolution grounded detection.
function probeGrounded(cx, cy, cz, config, isSolidAt) {
    const hh = capsuleHalfHeight(config);
    const r = config.capsuleRadius;
    const feetY = cy - hh;

    // Check a small distance below the capsule bottom.
    const probeDepth = 0.05;
    const probeY = feetY - probeDepth;

    // Check the block cells the capsule footprint overlaps at the probe Y.
    const minBX = Math.floor(cx - r);
    const maxBX = Math.floor(cx + r);
    const minBZ = Math.floor(cz - r);
    const maxBZ = Math.floor(cz + r);
    const by = Math.floor(probeY);

    for (let bx = minBX; bx <= maxBX; bx++) {
        for (let bz = minBZ; bz <= maxBZ; bz++) {
            if (isSolidAt(bx, by, bz)) return true;
        }
    }
    return false;
}

// --------------------------------------------------
// PHYSICS STEP (one fixed timestep)
// --------------------------------------------------

// Advances a player's physics state by one fixed timestep.
// This is called identically on server and client for determinism.
//
// playerState: { position: {x,y,z}, velocity: {x,y,z}, grounded, lastGroundedTime, jumpBufferTime }
// input: { forward, strafe, yaw, jump }
// isSolidAt: function(bx, by, bz) => boolean
// config: PHYSICS_CONFIG
// dt: fixed delta time
// time: current simulation time (for coyote/buffer timing)

function physicsStep(playerState, input, isSolidAt, config, dt, time) {
    const pos = playerState.position;
    const vel = playerState.velocity;

    // --- Horizontal movement (acceleration / deceleration) ---
    const { forward, strafe, yaw } = input;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    // Desired direction in world space.
    let wishX = -sinYaw * forward + cosYaw * strafe;
    let wishZ = -cosYaw * forward - sinYaw * strafe;

    // Normalize if diagonal.
    const wishMag = Math.hypot(wishX, wishZ);
    if (wishMag > 1) {
        wishX /= wishMag;
        wishZ /= wishMag;
    }

    const targetVX = wishX * config.moveSpeed;
    const targetVZ = wishZ * config.moveSpeed;

    // Accelerate or decelerate toward target.
    const hasInput = (forward !== 0 || strafe !== 0);
    const accelRate = hasInput ? config.acceleration : config.deceleration;

    vel.x = moveToward(vel.x, targetVX, accelRate * dt);
    vel.z = moveToward(vel.z, targetVZ, accelRate * dt);

    // --- Gravity ---
    if (!playerState.grounded) {
        vel.y -= config.gravity * dt;
        // Clamp to terminal velocity.
        if (vel.y < -config.terminalVelocity) {
            vel.y = -config.terminalVelocity;
        }
    }

    // --- Jumping ---
    // Track jump buffer: if jump was pressed, record time.
    if (input.jump) {
        playerState.jumpBufferTime = time;
    }

    const canCoyote = config.coyoteTime > 0 &&
        (time - playerState.lastGroundedTime) <= config.coyoteTime;
    const canBuffer = config.jumpBuffer > 0 &&
        (time - playerState.jumpBufferTime) <= config.jumpBuffer;
    const isGroundedOrCoyote = playerState.grounded || canCoyote;

    let justJumped = false;
    if (isGroundedOrCoyote && (input.jump || canBuffer)) {
        vel.y = config.jumpForce;
        playerState.grounded = false;
        justJumped = true;
        // Consume both timers to prevent double-jump.
        playerState.lastGroundedTime = -Infinity;
        playerState.jumpBufferTime = -Infinity;
    }

    // --- Apply velocity to position ---
    // We use the capsule CENTER as the physics position.
    // capsule center Y = feet Y + halfHeight
    const hh = capsuleHalfHeight(config);
    let cx = pos.x + vel.x * dt;
    let cy = pos.y + vel.y * dt;
    let cz = pos.z + vel.z * dt;

    // If we just jumped, nudge the capsule up by collisionSkin * 2 to clear
    // the floor surface before collision resolution runs. Without this,
    // the resolver re-detects the floor and pushes the capsule back down,
    // which then zeros the jump velocity.
    if (justJumped) {
        cy += config.collisionSkin * 4;
    }

    // --- Collision detection and resolution ---
    const result = resolveCollisions(cx, cy, cz, config, isSolidAt);
    cx = result.x;
    cy = result.y;
    cz = result.z;

    // If collision pushed us upward (ground), zero downward velocity.
    // Skip grounding on the jump frame — we just left the ground intentionally.
    if (result.groundedThisFrame && !justJumped) {
        if (vel.y < 0) vel.y = 0;
        playerState.grounded = true;
        playerState.lastGroundedTime = time;
    } else if (!justJumped) {
        // Also do auxiliary ground probe for edge cases
        // (e.g., standing still on flat ground where capsule barely touches).
        const probed = probeGrounded(cx, cy, cz, config, isSolidAt);
        if (probed && vel.y <= 0) {
            playerState.grounded = true;
            playerState.lastGroundedTime = time;
            if (vel.y < 0) vel.y = 0;
        } else if (!probed) {
            playerState.grounded = false;
        }
    }

    // --- Correct velocity from collision resolution ---
    // If position was adjusted by collision, adjust velocity to match.
    // This prevents velocity from accumulating into walls.

    // If the resolved position is different from what velocity predicted,
    // it means collision pushed us — dampen velocity on that axis.
    // Skip Y velocity correction on the jump frame to prevent the floor
    // collision from killing the jump impulse.
    const predictedX = pos.x + vel.x * dt;
    const predictedZ = pos.z + vel.z * dt;

    if (Math.abs(cx - predictedX) > config.collisionSkin) {
        vel.x = 0;
    }
    if (!justJumped) {
        const predictedY = pos.y + vel.y * dt;
        if (Math.abs(cy - predictedY) > config.collisionSkin) {
            // Only zero Y velocity in the blocked direction
            if ((cy > predictedY && vel.y < 0) || (cy < predictedY && vel.y > 0)) {
                vel.y = 0;
            }
        }
    }
    if (Math.abs(cz - predictedZ) > config.collisionSkin) {
        vel.z = 0;
    }

    // --- World bounds clamping ---
    const b = config.boundXZ;
    if (cx < -b) { cx = -b; vel.x = 0; }
    if (cx > b)  { cx = b;  vel.x = 0; }
    if (cz < -b) { cz = -b; vel.z = 0; }
    if (cz > b)  { cz = b;  vel.z = 0; }
    if (cy < config.boundYMin) {
        // Kill plane — reset to spawn.
        cy = config.boundYMax;
        vel.y = 0;
    }
    if (cy > config.boundYMax) { cy = config.boundYMax; vel.y = 0; }

    // --- Update position ---
    pos.x = cx;
    pos.y = cy;
    pos.z = cz;
}

// --------------------------------------------------
// UTILITY
// --------------------------------------------------

function moveToward(current, target, maxDelta) {
    if (Math.abs(target - current) <= maxDelta) {
        return target;
    }
    return current + Math.sign(target - current) * maxDelta;
}

// Create a fresh player physics state.
function createPhysicsState(spawnX, spawnY, spawnZ) {
    return {
        position: { x: spawnX || 0, y: spawnY || 5, z: spawnZ || 0 },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: false,
        lastGroundedTime: -Infinity,
        jumpBufferTime: -Infinity,
    };
}

// Clone a physics state (for prediction snapshots).
function clonePhysicsState(state) {
    return {
        position: { x: state.position.x, y: state.position.y, z: state.position.z },
        velocity: { x: state.velocity.x, y: state.velocity.y, z: state.velocity.z },
        grounded: state.grounded,
        lastGroundedTime: state.lastGroundedTime,
        jumpBufferTime: state.jumpBufferTime,
    };
}

// --------------------------------------------------
// EXPORTS
// --------------------------------------------------

// Support both CommonJS (Node.js server) and embedding in browser.
// When loaded via <script>, these are assigned to window.Physics.
const Physics = {
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
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = Physics;
}
if (typeof window !== "undefined") {
    window.Physics = Physics;
}
