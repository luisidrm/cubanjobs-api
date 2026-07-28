import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import { createUserProfile } from "../modules/users/users.queries";
import { AppError } from "./AppError";
import type { UserRole } from "../../db/schema/users";

export function initSupertokens() {
  supertokens.init({
    framework: "express",
    supertokens: {
      connectionURI: process.env.SUPERTOKENS_URL ?? "http://localhost:3567",
      apiKey: process.env.SUPERTOKENS_API_KEY,
    },
    appInfo: {
      appName: "Cuban Jobs",
      apiDomain: process.env.API_DOMAIN ?? "http://localhost:3000",
      websiteDomain: process.env.WEBSITE_DOMAIN ?? "http://localhost:5173",
      apiBasePath: "/auth",
      websiteBasePath: "/auth",
    },
    recipeList: [
      EmailPassword.init({
        signUpFeature: {
          formFields: [{ id: "role" }],
        },
        override: {
          functions: (originalImpl) => ({
            ...originalImpl,
            signUp: async (input) => {
              const result = await originalImpl.signUp(input);

              if (result.status === "OK") {
                const roleField = input.formFields.find((f) => f.id === "role");
                const role: UserRole =
                  roleField?.value === "employer" ? "employer" : "employee";

                try {
                  await createUserProfile({
                    supertokensUserId: result.user.id,
                    email: result.user.emails[0],
                    role,
                  });
                } catch (err) {
                  console.error(
                    "Failed to create user profile after signup, rolling back:",
                    err
                  );
                  await supertokens.deleteUser(result.user.id).catch((rollbackErr) => {
                    console.error(
                      "CRITICAL: rollback of orphaned SuperTokens user failed:",
                      rollbackErr
                    );
                  });
                  throw new AppError(500, "Failed to complete registration. Please try again.");
                }
              }

              return result;
            },
          }),
        },
      }),
      Session.init(),
    ],
  });
}

export { supertokens };