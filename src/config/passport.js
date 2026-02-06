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
            proxy: true
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // This is how profile looks like 
                //   {
                //     id: "googleId123",
                //     displayName: "John Doe",
                //     emails: [{ value: "user@gmail.com", verified: true }],
                //     photos: [{ value: "profilePicUrl" }]
                //   }
                const emailObj = profile.emails?.[0];

                // 1. SECURITY CHECK: Ensure Google has verified this email
                // This prevents the "Unverified Email Takeover" attack
                if (!emailObj || !emailObj.verified) {
                    return done(
                        new Error('Google account email is not verified.'),
                        null
                    );
                }

                const email = emailObj.value;

                // 2. Find user by Google ID first
                let user = await User.findOne({ googleId: profile.id });

                if (!user) {
                    // 3. If no user by Google ID, check if email exists
                    const emailUser = await User.findOne({ "contact.email": email });

                    if (emailUser) {
                        // 4. PREVENT MERGE CONFLICTS
                        // If this email user already has a DIFFERENT googleId linked, 
                        // we must stop. This means one email is trying to link to two 
                        // different Google accounts (rare, but possible).
                        if (emailUser.googleId) {
                            return done(
                                new Error("This email is already linked to another Google account"),
                                null
                            );
                        }

                        // Link the account
                        emailUser.googleId = profile.id;
                        // Optional: Update profile pic if they don't have one
                        if (!emailUser.profilePic) {
                            emailUser.profilePic = profile.photos?.[0]?.value;
                        }
                        user = await emailUser.save();

                    } else {
                        // 5. Create entirely new user
                        user = await User.create({
                            name: profile.displayName,
                            contact: { email },
                            googleId: profile.id,
                            profilePic: profile.photos?.[0]?.value,
                            isEmailVerified: true,
                            civilScore: 10,
                            isProfileComplete: false,
                        });
                    }
                }

                return done(null, user);

            } catch (err) {
                return done(err, null);
            }
        }
    )
);

module.exports = passport;