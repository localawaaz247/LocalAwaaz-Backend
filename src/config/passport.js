const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
require('dotenv').config();
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback",
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const email = profile.emails?.[0]?.value;
                if (!email) {
                    return done(
                        new Error('Google account does not provide an email'),
                        null
                    );
                }
                let user = await User.findOne({
                    $or: [{ googleId: profile.id }, { "contact.email": email }],
                });

                if (user) {
                    if (!user.googleId) {
                        user.googleId = profile.id;
                        user.contact.email = email;
                        await user.save();
                    }
                } else {
                    user = await User.create({
                        name: profile.displayName,
                        contact: { email },
                        googleId: profile.id,
                        profilePic: profile.photos?.[0]?.value,
                        isVerified: !!email,
                        isProfileComplete: false,
                    });
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    )
);

// REQUIRED
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    const user = await User.findById(id);
    done(null, user);
});

module.exports = passport;
