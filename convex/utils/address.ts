import bs58 from "bs58";
import z from "zod";

export const Base58Z = ({
  invalid_type_error,
  required_error,
  regex_error = "The string is not a Base58",
}: {
  invalid_type_error?: string | undefined;
  required_error?: string | undefined;
  regex_error?: string | undefined;
} = {}) =>
  z
    .string({ invalid_type_error, required_error })
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, regex_error)
    .brand<"Base58">();

export type Base58 = z.infer<ReturnType<typeof Base58Z>>;

export const zAddress = Base58Z({
  regex_error: "Invalid Solana address",
}).refine(
  (value) => {
    try {
      return bs58.decode(value).length === 32;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana address" }
);
export type Address = z.infer<typeof zAddress>;

export function toAddress(value: string) {
  return zAddress.parse(value);
}
