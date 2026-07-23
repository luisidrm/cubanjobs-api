import supertokens from "supertokens-node";
import Session from "supertokens-node/recipe/session";
import EmailPassword from "supertokens-node/recipe/emailpassword";
import { createUserProfile } from "../modules/users/users.queries";
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
        // Clients send a "role" form field ("employer" | "employee") at signup.
        // SuperTokens passes it through to the override below.
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

                await createUserProfile({
                  supertokensUserId: result.user.id,
                  email: result.user.emails[0],
                  role,
                });
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
