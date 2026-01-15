const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
require('dotenv').config();

/**
 * ============================
 * GOOGLE OAUTH PASSPORT STRATEGY
 * ============================
 * Purpose:
 * - Authenticate users using Google OAuth
 * - Link Google account with existing users if email matches
 * - Create new user if none exists
 */
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,           // Google OAuth client ID
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,   // Google OAuth client secret
            callbackURL: "/auth/google/callback",            // URL Google redirects to after login
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Extract email from Google profile
                const email = profile.emails?.[0]?.value;
                if (!email) {
                    return done(
                        new Error('Google account does not provide an email'),
                        null
                    );
                }

                // Check if user already exists:
                // - Either linked with GoogleId
                // - Or email matches existing account
                let user = await User.findOne({
                    $or: [{ googleId: profile.id }, { "contact.email": email }],
                });

                if (user) {
                    // Existing user without GoogleId → link account
                    if (!user.googleId) {
                        user.googleId = profile.id;
                        user.contact.email = email; // ensure email is stored
                        await user.save();
                    }
                } else {
                    // New user → create user record
                    user = await User.create({
                        name: profile.displayName,
                        contact: { email },
                        googleId: profile.id,
                        profilePic: profile.photos?.[0]?.value,
                        isVerified: !!email,           // mark verified if email exists
                        isProfileComplete: false,      // force profile completion later
                    });
                }

                // Continue Passport flow
                return done(null, user);

            } catch (err) {
                // Pass error to Passport
                return done(err);
            }
        }
    )
);

/**
 * ----------------------------
 * SERIALIZE & DESERIALIZE USER
 * ----------------------------
 * Required for Passport session support.
 */

// Serialize user ID into session cookie
passport.serializeUser((user, done) => done(null, user.id));

// Deserialize user from session cookie into req.user
passport.deserializeUser(async (id, done) => {
    const user = await User.findById(id);
    done(null, user);
});

module.exports = passport;
