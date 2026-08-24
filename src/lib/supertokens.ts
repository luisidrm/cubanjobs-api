import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import EmailVerification from "supertokens-node/recipe/emailverification";
import { createUserProfile } from "../modules/users/users.queries";
import { AppError } from "./AppError";
import { sendEmail, buildAppLink } from "./email";
import type { UserRole } from "../../db/schema/users";

/**
 * Deletes an orphaned SuperTokens user (signup succeeded but our app-level
 * profile row failed to create). Retries once — the alternative is a
 * SuperTokens account with no matching `users` row, which breaks every
 * subsequent login via requireAuth's getUserBySupertokensId lookup.
 */
async function rollbackSuperTokensUser(userId: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await supertokens.deleteUser(userId);
      return;
    } catch (rollbackErr) {
      if (attempt === 2) {
        console.error(
          `CRITICAL: rollback of orphaned SuperTokens user ${userId} failed after retry — manual cleanup required:`,
          rollbackErr
        );
      }
    }
  }
}

export function initSupertokens() {
  const websiteDomain = process.env.WEBSITE_DOMAIN ?? process.env.APP_DOMAIN;

  supertokens.init({
    framework: "express",
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_URL ?? "http://localhost:3567",
      ...(process.env.SUPERTOKENS_API_KEY ? { apiKey: process.env.SUPERTOKENS_API_KEY } : {}),
    },
    appInfo: {
      appName: "Cuban Jobs",
      apiDomain: process.env.API_DOMAIN ?? "http://localhost:5000",
      ...(websiteDomain ? { websiteDomain } : {}),
      apiBasePath: "/auth",
      websiteBasePath: "/auth",
    },
    recipeList: [
      EmailPassword.init({
        signUpFeature: {
          formFields: [{ id: "role" }],
        },
        emailDelivery: {
          override: (originalImplementation) => ({
            ...originalImplementation,
            sendEmail: async (input) => {
              if (input.type !== "PASSWORD_RESET") {
                return originalImplementation.sendEmail(input);
              }

              // SuperTokens builds passwordResetLink against appInfo.websiteDomain,
              // which isn't a real hosted page here — extract just the token and
              // point the email at the mobile app's own deep-linkable route instead.
              const token = new URL(input.passwordResetLink).searchParams.get("token") ?? "";
              const link = buildAppLink("/reset-password", { token });

              await sendEmail({
                to: input.user.email,
                subject: "Reset your Cuban Jobs password",
                html: `<p>Someone requested a password reset for this email.</p>
                  <p><a href="${link}">Tap here to set a new password</a></p>
                  <p>If you didn't request this, you can ignore this email.</p>`,
              });
            },
          }),
        },
        override: {
          // NOTE: the "role" form field only survives to the API layer
          // (signUpPOST) in this SDK version — the function-layer signUp
          // override no longer receives formFields, so the role must be
          // read here before delegating to the original implementation.
          apis: (originalImpl) => ({
            ...originalImpl,
            signUpPOST: async (input) => {
              if (!originalImpl.signUpPOST) {
                throw new Error("signUpPOST is not available on the original implementation");
              }

              const response = await originalImpl.signUpPOST(input);

              if (response.status === "OK") {
                const roleField = input.formFields.find((f) => f.id === "role");
                const role: UserRole =
                  roleField?.value === "employer" ? "employer" : "employee";

                try {
                  await createUserProfile({
                    supertokensUserId: response.user.id,
                    email: response.user.emails[0]!,
                    role,
                  });
                } catch (err) {
                  console.error(
                    "Failed to create user profile after signup, rolling back:",
                    err
                  );
                  await rollbackSuperTokensUser(response.user.id);
                  throw new AppError(500, "Failed to complete registration. Please try again.");
                }

                // Fire-and-forget: don't fail signup if the verification email
                // can't be sent, the user can request a new one later.
                EmailVerification.sendEmailVerificationEmail(
                  input.tenantId,
                  response.user.id,
                  response.user.loginMethods[0]!.recipeUserId
                ).catch((err) => {
                  console.error("Failed to send verification email after signup:", err);
                });
              }

              return response;
            },
          }),
        },
      }),
      EmailVerification.init({
        // OPTIONAL, not REQUIRED: verifySession() must keep working for
        // unverified users everywhere — routes that should actually require
        // a verified email use the separate requireVerifiedEmail middleware
        // (src/middleware/auth.ts) instead of a blanket session claim.
        mode: "OPTIONAL",
        emailDelivery: {
          override: (originalImplementation) => ({
            ...originalImplementation,
            sendEmail: async (input) => {
              if (input.type !== "EMAIL_VERIFICATION") {
                return originalImplementation.sendEmail(input);
              }

              const token = new URL(input.emailVerifyLink).searchParams.get("token") ?? "";
              const link = buildAppLink("/verify-email", { token });

              await sendEmail({
                to: input.user.email,
                subject: "Verify your Cuban Jobs email",
                html: `<p>Welcome to Cuban Jobs!</p>
                  <p><a href="${link}">Tap here to verify your email</a></p>`,
              });
            },
          }),
        },
      }),
      Session.init(),
    ],
  });
}

export { supertokens };