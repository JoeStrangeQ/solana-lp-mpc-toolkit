import { PRIVY_APP_ID } from "./convexEnv";

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: PRIVY_APP_ID,
      issuer: "privy.io",
      jwks: `https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`,
      algorithm: "ES256",
    },
  ],
};
