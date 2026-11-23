// blockCatalog.js — Centralized Block Database & Catalogue.
//
// Single source of truth for all placeable block types in Somewhere.
// Every block has:
//   - id: Unique persistent identifier transmitted over the network
//   - name: Player-facing display name
//   - color: Numerical hex value for Three.js rendering
//   - hex: CSS hex string for 2D UI icons and swatches
//   - transparent / opacity: Optional material rendering flags
//   - category: Organizational category

const BLOCK_CATALOG = [
    {
        id: "grass",
        name: "Grass Block",
        color: 0x4a7c59,
        hex: "#4a7c59",
        category: "nature",
    },
    {
        id: "dirt",
        name: "Dirt",
        color: 0x866038,
        hex: "#866038",
        category: "nature",
    },
    {
        id: "stone",
        name: "Stone",
        color: 0x828282,
        hex: "#828282",
        category: "mineral",
    },
    {
        id: "cobblestone",
        name: "Cobblestone",
        color: 0x5e5e5e,
        hex: "#5e5e5e",
        category: "mineral",
    },
    {
        id: "wood_planks",
        name: "Wood Planks",
        color: 0x9c6d3b,
        hex: "#9c6d3b",
        category: "building",
    },
    {
        id: "wood_log",
        name: "Wood Log",
        color: 0x5c3d1e,
        hex: "#5c3d1e",
        category: "nature",
    },
    {
        id: "leaves",
        name: "Oak Leaves",
        color: 0x3b6e3b,
        hex: "#3b6e3b",
        category: "nature",
        transparent: true,
        opacity: 0.9,
    },
    {
        id: "sand",
        name: "Sand",
        color: 0xd6c585,
        hex: "#d6c585",
        category: "nature",
    },
    {
        id: "sandstone",
        name: "Sandstone",
        color: 0xcbb67a,
        hex: "#cbb67a",
        category: "building",
    },
    {
        id: "brick",
        name: "Red Bricks",
        color: 0x994132,
        hex: "#994132",
        category: "building",
    },
    {
        id: "glass",
        name: "Glass",
        color: 0xa8d5e5,
        hex: "#a8d5e5",
        category: "building",
        transparent: true,
        opacity: 0.55,
    },
    {
        id: "obsidian",
        name: "Obsidian",
        color: 0x211832,
        hex: "#211832",
        category: "mineral",
    },
    {
        id: "diamond_block",
        name: "Diamond Block",
        color: 0x4dedf4,
        hex: "#4dedf4",
        category: "mineral",
    },
    {
        id: "gold_block",
        name: "Gold Block",
        color: 0xf7cf31,
        hex: "#f7cf31",
        category: "mineral",
    },
    {
        id: "iron_block",
        name: "Iron Block",
        color: 0xdcdcdc,
        hex: "#dcdcdc",
        category: "mineral",
    },
    {
        id: "emerald_block",
        name: "Emerald Block",
        color: 0x2ed665,
        hex: "#2ed665",
        category: "mineral",
    },
    {
        id: "snow",
        name: "Snow Block",
        color: 0xf0f4f5,
        hex: "#f0f4f5",
        category: "nature",
    },
    {
        id: "clay",
        name: "Clay",
        color: 0x9aa3b2,
        hex: "#9aa3b2",
        category: "nature",
    },
    {
        id: "netherrack",
        name: "Netherrack",
        color: 0x6d1f1f,
        hex: "#6d1f1f",
        category: "building",
    },
    {
        id: "glowstone",
        name: "Glowstone",
        color: 0xf4be54,
        hex: "#f4be54",
        category: "building",
    },
];

// Map by ID for O(1) lookup
const BLOCK_MAP = new Map();
for (const b of BLOCK_CATALOG) {
    BLOCK_MAP.set(b.id, b);
}

// Aliases for backwards compatibility with legacy seed data / world blocks
const ALIASES = {
    wood: "wood_planks",
};

// Default 10 slots for new players
const DEFAULT_RECENT_BLOCKS = [
    "dirt",
    "grass",
    "stone",
    "wood_planks",
    "sand",
    "brick",
    "glass",
    "gold_block",
    "diamond_block",
    "leaves",
];

function getBlock(id) {
    if (!id || typeof id !== "string") return null;
    const resolvedId = ALIASES[id] || id;
    return BLOCK_MAP.get(resolvedId) || null;
}

function isValidBlockId(id) {
    if (!id || typeof id !== "string") return false;
    const resolvedId = ALIASES[id] || id;
    return BLOCK_MAP.has(resolvedId);
}

function getAllBlocks() {
    return BLOCK_CATALOG.slice();
}

// Case-insensitive search supporting partial matches in name or id
function searchBlocks(query, limit = 10) {
    if (!query || typeof query !== "string") {
        return [];
    }
    const q = query.trim().toLowerCase();
    if (q === "") return [];

    const matches = [];
    for (const block of BLOCK_CATALOG) {
        const nameMatch = block.name.toLowerCase().includes(q);
        const idMatch = block.id.toLowerCase().includes(q);
        if (nameMatch || idMatch) {
            // Prioritize prefix matches
            const startsWith = block.name.toLowerCase().startsWith(q) || block.id.toLowerCase().startsWith(q);
            matches.push({ block, score: startsWith ? 2 : 1 });
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map((m) => m.block);
}

module.exports = {
    BLOCK_CATALOG,
    DEFAULT_RECENT_BLOCKS,
    getBlock,
    isValidBlockId,
    getAllBlocks,
    searchBlocks,
};
