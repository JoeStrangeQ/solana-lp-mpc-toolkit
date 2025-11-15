import { usePrivy } from "@privy-io/react-auth";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MNM_SERVER_API_KEY } from "~/env";
import { MnMServerClient } from "~/services/mnmServer/mnmServerClient";

const SERVER_URL = "ws://localhost:8787";
export function useMnMServerClient() {
  const { getAccessToken } = usePrivy();

  const { data: client } = useSuspenseQuery({
    queryKey: ["mnm-server-client"],
    queryFn: async () => {
      const privyToken = await getAccessToken();
      console.log("Privy Token", privyToken);
      if (!privyToken) throw new Error("No Privy token found");

      return new MnMServerClient({
        privyToken,
        apiKey: MNM_SERVER_API_KEY,
        serverUrl: SERVER_URL,
        debug: false,
      });
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return client;
}
