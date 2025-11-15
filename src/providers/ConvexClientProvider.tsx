import { usePrivy } from '@privy-io/react-auth'
import {
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { ConvexProvider, ConvexReactClient, useConvex } from 'convex/react'
import {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from 'convex/server'
import { ReactNode } from 'react'

export const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!)

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const { getAccessToken } = usePrivy()

  convex.setAuth(async () => {
    const a = await getAccessToken()
    console.log(a)
    return a
  })
  return <ConvexProvider client={convex}>{children}</ConvexProvider>
}

type ConvexSuspenseQueryOptions<Query extends FunctionReference<'query'>> =
  Omit<
    UseSuspenseQueryOptions<
      FunctionReturnType<Query>, // TQueryFnData
      Error, // TError
      FunctionReturnType<Query>, // TData
      [string, OptionalRestArgs<Query>] // TQueryKey
    >,
    'queryKey' | 'queryFn'
  >

// Params object for the hook
export interface ConvexSuspenseQueryParams<
  Query extends FunctionReference<'query'>,
> {
  queryKey: string
  convexQuery: { query: Query; args: Query['_args'] }
  options?: ConvexSuspenseQueryOptions<Query>
}

export function useConvexSuspenseQuery<
  Query extends FunctionReference<'query'>,
>(
  params: ConvexSuspenseQueryParams<Query>,
): UseSuspenseQueryResult<Query['_returnType'], Error> {
  const convex = useConvex()
  const {
    queryKey,
    convexQuery: { args, query },
    options,
  } = params

  return useSuspenseQuery({
    queryKey: [queryKey, args],
    queryFn: async () => convex.query(query, args),
    ...options,
  })
}
