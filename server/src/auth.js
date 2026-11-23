// auth.js — Google OAuth + session setup (modified for offline dev).
//
// In offline development we may not have Google OAuth credentials or a MongoDB instance.
// This version falls back to dummy credentials and an in‑memory session store.
// It also provides a simple fake login route when OAuth is not configured.

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
// Use MemoryStore when no MongoDB connection is configured.
let sessionStore;
if (process.env.DATABASE_URL) {
    const { MongoStore } = require("connect-mongo");
    sessionStore = MongoStore.create({
        mongoUrl: process.env.DATABASE_URL,
        dbName: "somewhere",
        collectionName: "sessions",
    });
} else {
    // In‑memory store – not suitable for production but fine for local testing.
    sessionStore = new session.MemoryStore();
}
const prisma = require("./db");

// Dummy user for authentication and profile endpoints.
const dummyUser = {
    id: "dev-user",
    displayName: "Dev Player",
    avatar: null,
    showWorldToFriends: false,
    lastActive: new Date(),
    posX: 0,
    posY: 0,
    posZ: 0,
    recentBlocks: [],
    googleId: null,
};

// Determine whether real Google OAuth credentials are available.
const useFakeAuth = !(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// --------------------------------------------------
// PASSPORT: Google Strategy (only if credentials exist)
// --------------------------------------------------

if (!useFakeAuth) {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                // This URL must match what you registered in Google Cloud Console.
                callbackURL: "http://localhost:3000/auth/google/callback",
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    // Check if user exists to preserve customized displayName/avatar
                    const existing = await prisma.user.findUnique({
                        where: { googleId: profile.id },
                    });

                    let user;
                    if (existing) {
                        user = await prisma.user.update({
                            where: { id: existing.id },
                            data: { lastActive: new Date() },
                        });
                    } else {
                        const avatarUrl = (profile.photos && profile.photos[0]) ? profile.photos[0].value : null;
                        user = await prisma.user.create({
                            data: {
                                googleId: profile.id,
                                displayName: profile.displayName || "Player",
                                avatar: avatarUrl,
                                lastActive: new Date(),
                            },
                        });
                    }
                    // Pass the full user record to serializeUser.
                    return done(null, user);
                } catch (err) {
                    return done(err, null);
                }
            }
        )
    );
}

// --------------------------------------------------
// PASSPORT: Serialize / Deserialize
// --------------------------------------------------

// serializeUser: decides what to store in the session cookie.
// We store just the database ID (a small string).
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// deserializeUser: on each request, turn the session ID back into a user object.
passport.deserializeUser(async (id, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        // If the real DB is missing and we get null, fall back to dummyUser.
        done(null, user || dummyUser);
    } catch (err) {
        done(err, null);
    }
});

// --------------------------------------------------
// SESSION MIDDLEWARE FACTORY
// --------------------------------------------------

function createSessionMiddleware() {
    return session({
        secret: process.env.SESSION_SECRET || "dev-secret",
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            httpOnly: true,   // JavaScript cannot access this cookie — more secure.
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        },
    });
}

// --------------------------------------------------
// AUTH ROUTES — call mountAuthRoutes(app) in server.js
// --------------------------------------------------

function mountAuthRoutes(app) {
    if (useFakeAuth) {
        // Simple fake login for offline development.
        app.get("/auth/login", (req, res, next) => {
            req.login(dummyUser, (err) => {
                if (err) return next(err);
                res.redirect("/");
            });
        });
        // Logout works the same.
        app.get("/auth/logout", (req, res, next) => {
            req.logout((err) => {
                if (err) return next(err);
                res.redirect("/");
            });
        });
    } else {
        // Step 1: redirect the user to Google's login page.
        app.get(
            "/auth/google",
            passport.authenticate("google", { scope: ["profile"] })
        );

        // Step 2: Google redirects back here after login.
        app.get(
            "/auth/google/callback",
            passport.authenticate("google", {
                failureRedirect: "/?error=auth_failed",
                successRedirect: "/",
            })
        );

        // Logout: clear the session and redirect to home.
        app.get("/auth/logout", (req, res, next) => {
            req.logout((err) => {
                if (err) return next(err);
                res.redirect("/");
            });
        });
    }

    // API: who is currently logged in? – used by the client to decide UI.
    app.get("/api/me", (req, res) => {
        if (req.isAuthenticated()) {
            res.json({
                loggedIn: true,
                user: {
                    id: req.user.id,
                    displayName: req.user.displayName,
                    avatar: req.user.avatar || null,
                    showWorldToFriends: !!req.user.showWorldToFriends,
                    lastActive: req.user.lastActive,
                    // Send last saved position so the client can resume from there.
                    position: {
                        x: req.user.posX,
                        y: req.user.posY,
                        z: req.user.posZ,
                    },
                    recentBlocks: req.user.recentBlocks || [],
                },
            });
        } else if (useFakeAuth) {
            // In dev mode without OAuth, auto-report as logged in with the dummy user.
            res.json({
                loggedIn: true,
                user: {
                    id: dummyUser.id,
                    displayName: dummyUser.displayName,
                    avatar: dummyUser.avatar,
                    showWorldToFriends: dummyUser.showWorldToFriends,
                    lastActive: dummyUser.lastActive,
                    position: {
                        x: dummyUser.posX,
                        y: dummyUser.posY,
                        z: dummyUser.posZ,
                    },
                    recentBlocks: dummyUser.recentBlocks,
                },
            });
        } else {
            res.json({ loggedIn: false });
        }
    });
}

module.exports = { createSessionMiddleware, mountAuthRoutes };
