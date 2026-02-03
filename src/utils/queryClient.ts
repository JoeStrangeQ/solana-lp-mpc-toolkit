import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // disable automatic refetching on tab switch
      retry: 1,
      staleTime: 1000 * 60 * 2, // cache data for 2 minutes
    },
  },
});
