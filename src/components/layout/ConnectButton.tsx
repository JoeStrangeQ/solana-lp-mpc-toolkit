import { useLogin, usePrivy, useSessionSigners, WalletWithMetadata } from "@privy-io/react-auth";
import { useConvexUser } from "~/providers/UserStates";
import { useAction } from "convex/react";
import { AnimatePresence } from "motion/react";
import { useState } from "react";
import { WalletSidebar } from "./WalletSidebar";
import { convex } from "~/providers/ConvexClientProvider";
import { Sidebar, useWalletSidebar } from "../ui/Sidebar";
import { api } from "../../../convex/_generated/api";
import { PRIVY_SIGNER_PUBLIC_KEY } from "~/env";
import { abbreviateAddress } from "~/utils/solana";
import { Button } from "../ui/Button";

export function ConnectButton() {
  const walletSidebar = useWalletSidebar();
  const { convexUser } = useConvexUser();
  const { isLoggedIn, ready, address, connectWallet } = useConnectWallet();

  const userAddress = convexUser?.address || address;

  return (
    <>
      <div className="flex items-center w-44 justify-end">
        <AnimatePresence mode="wait" initial={false}>
          {isLoggedIn && userAddress ? (
            <Button variant="liquidWhite" onClick={walletSidebar.open}>
              {abbreviateAddress(userAddress)}
            </Button>
          ) : (
            <Button variant="liquidPrimary" loading={!ready || !isLoggedIn || !userAddress} onClick={connectWallet}>
              {ready ? "Connect wallet" : "Connecting"}
            </Button>
          )}
        </AnimatePresence>
      </div>

      {convexUser && (
        <Sidebar isOpen={walletSidebar.isOpen} onClose={walletSidebar.close}>
          <WalletSidebar onClose={walletSidebar.close} user={convexUser} />
        </Sidebar>
      )}
    </>
  );
}

export function useConnectWallet() {
  const { signIn, signout } = useConvexUser();
  const { addSessionSigners } = useSessionSigners();
  const authenticate = useAction(api.privy.authenticate);
  const [address, setAddress] = useState<string | null>(null);

  const { ready, authenticated, getAccessToken, logout } = usePrivy();

  const { login } = useLogin({
    onComplete: async ({ user }) => {
      const embededWallet = user.linkedAccounts.find(
        (acc): acc is WalletWithMetadata & { connectorType: "embedded" } =>
          acc.type === "wallet" && acc.connectorType === "embedded"
      );

      if (!embededWallet) {
        throw new Error("User doesn't have privy embedded wallet");
      }

      const { address: userAddress } = embededWallet;
      setAddress(userAddress);

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Couldn't get privy access token");
      }

      const result = await authenticate({
        token,
        address: userAddress,
        privyUserId: user.id,
      });

      if (result.success && result.wasCreated) {
        await addSessionSigners({
          address: userAddress,
          signers: [
            {
              signerId: PRIVY_SIGNER_PUBLIC_KEY,
            },
          ],
        });
      }

      if (result.success && result.user) {
        signIn(result.user);
      } else if (!result.success) {
        console.error("Convex auth failed:", result.error);
        await logout();
        convex.clearAuth();
        signout();
      }
    },
    onError: async (err) => {
      console.error("Privy login failed", err);
      await logout();
      convex.clearAuth();
      signout();
    },
  });

  const loggedIn = ready && authenticated && address !== null;
  const handleConnect = () => {
    if (ready) login();
  };

  return {
    connectWallet: handleConnect,
    ready,
    address,
    isLoggedIn: loggedIn,
  };
}
