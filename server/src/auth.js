// auth.js — Google OAuth + session setup.
//
// We use Passport.js with the Google OAuth 2.0 strategy.
// When a user logs in with Google, we upsert (create or update) their User
// record in MongoDB and store their database ID in the session cookie.
//
// The session cookie is HTTP-only (JavaScript can't read it),
// and sessions are stored in MongoDB via connect-mongo so they
// survive server restarts.

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const prisma = require("./db");

// --------------------------------------------------
// PASSPORT: Google Strategy
// --------------------------------------------------

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
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// --------------------------------------------------
// SESSION MIDDLEWARE FACTORY
// --------------------------------------------------

function createSessionMiddleware() {
    return session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        // Store sessions in MongoDB so they survive server restarts.
        store: MongoStore.create({
            mongoUrl: process.env.DATABASE_URL,
            dbName: "somewhere",
            collectionName: "sessions",
        }),
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

    // API: who is currently logged in?
    // The frontend calls this to decide whether to show the login screen or the game.
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
        } else {
            res.json({ loggedIn: false });
        }
    });
}

module.exports = { createSessionMiddleware, mountAuthRoutes };
