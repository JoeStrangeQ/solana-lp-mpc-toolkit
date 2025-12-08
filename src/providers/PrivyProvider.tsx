import { PrivyProvider } from "@privy-io/react-auth";
import { ReactNode } from "react";

import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { PRIVY_APP_ID } from "~/env";

interface PrivyProviderWrapperProps {
  children: ReactNode;
}

export function PrivyProviderWrapper({ children }: PrivyProviderWrapperProps) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID!}
      config={{
        embeddedWallets: {
          solana: {
            createOnLogin: "all-users",
          },
        },
        appearance: {
          theme: "#202020",
          accentColor: "#B6D162",
          showWalletLoginFirst: false,
          walletChainType: "solana-only",
          walletList: ["detected_wallets", "phantom", "solflare", "backpack"],
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        loginMethods: ["email", "wallet", "discord", "google", "twitter"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
