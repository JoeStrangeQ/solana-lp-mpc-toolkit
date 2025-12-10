import { usePrivy } from "@privy-io/react-auth";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MNM_SERVER_API_KEY, SERVER_URL } from "~/env";
import { MnMServerClient } from "~/services/mnmServer/mnmServerClient";

export function useMnMServerClient() {
  const { getAccessToken } = usePrivy();

  const { data: client } = useSuspenseQuery({
    queryKey: ["mnm-server-client"],
    queryFn: async () => {
      const privyToken = await getAccessToken();
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
