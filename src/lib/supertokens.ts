import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import EmailVerification from "supertokens-node/recipe/emailverification";
import { createUserProfile } from "../modules/users/users.queries";
import { AppError } from "./AppError";
import { sendEmail, buildAppLink } from "./email";
import type { UserRole } from "../../db/schema/users";
import { buildVerificationEmailHtml } from "./emailTemplate";
import { logger } from "./logger";

/**
 * Reads the caller's platform off the `x-platform` header the frontend sends
 * on every request (see front/src/lib/baseQuery.ts, mobile/src/lib/baseQuery.ts).
 * Used to pick which app domain emailed links (password reset, email
 * verification) should point at. Defaults to native so behavior is unchanged
 * for any caller that doesn't send the header.
 */
function readPlatform(req: { getHeaderValue: (key: string) => string | undefined }): "web" | "native" {
  return req.getHeaderValue("x-platform") === "web" ? "web" : "native";
}

/**
 * Deletes an orphaned SuperTokens user (signup succeeded but our app-level
 * profile row failed to create). Retries once — the alternative is a
 * SuperTokens account with no matching `users` row, which breaks every
 * subsequent login via requireAuth's getUserBySupertokensId lookup.
 */
export async function rollbackSuperTokensUser(userId: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await supertokens.deleteUser(userId);
      return;
    } catch (rollbackErr) {
      if (attempt === 2) {
        logger.error(
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
      appName: "Brújula",
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
              // point the email at the right app's own route instead. platform
              // comes from generatePasswordResetTokenPOST below via userContext.
              const token = new URL(input.passwordResetLink).searchParams.get("token") ?? "";
              const link = buildAppLink("/reset-password", { token }, input.userContext.platform);

              await sendEmail({
                to: input.user.email,
                subject: "Reset your Brújula password",
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
            // Stashes platform into userContext so the PASSWORD_RESET
            // sendEmail override above (which no longer has access to the
            // live request) knows which app domain to link to.
            generatePasswordResetTokenPOST: async (input) => {
              if (!originalImpl.generatePasswordResetTokenPOST) {
                throw new Error(
                  "generatePasswordResetTokenPOST is not available on the original implementation"
                );
              }
              input.userContext.platform = readPlatform(input.options.req);
              return originalImpl.generatePasswordResetTokenPOST(input);
            },
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
                  logger.error(
                    "Failed to create user profile after signup, rolling back:",
                    err
                  );
                  await rollbackSuperTokensUser(response.user.id);
                  // Retrying with the SAME email is always safe here, whether or
                  // not the rollback above actually succeeded — a different email
                  // would create a second orphan if it silently did succeed.
                  throw new AppError(
                    500,
                    "We couldn't finish setting up your account. Please wait a moment and try again with the same email — if it still fails, contact support rather than trying a different email."
                  );
                }

                // Fire-and-forget: don't fail signup if the verification email
                // can't be sent, the user can request a new one later. Platform
                // rides along in userContext for the EMAIL_VERIFICATION
                // sendEmail override below to pick the right app domain.
                EmailVerification.sendEmailVerificationEmail(
                  input.tenantId,
                  response.user.id,
                  response.user.loginMethods[0]!.recipeUserId,
                  undefined,
                  { platform: readPlatform(input.options.req) }
                ).catch((err) => {
                  logger.error("Failed to send verification email after signup:", err);
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
              if (input.type === "EMAIL_VERIFICATION") {
                // input.emailVerifyLink is built against appInfo.websiteDomain,
                // which isn't a real hosted page here — extract just the token
                // and point the email at the right app's own route instead,
                // same as the PASSWORD_RESET override above. platform rides
                // along via userContext, set in signUpPOST.
                const token = new URL(input.emailVerifyLink).searchParams.get("token") ?? "";
                const verificationUrl = buildAppLink("/verify-email", { token }, input.userContext.platform);

                await sendEmail({
                  to: input.user.email,
                  subject: "Verifica tu correo - Brújula",
                  html: buildVerificationEmailHtml(verificationUrl),
                });
                return;
              }

              await originalImplementation.sendEmail(input);
            }
          }),
        },
      }),
      Session.init(),
    ],
  });
}

export { supertokens };