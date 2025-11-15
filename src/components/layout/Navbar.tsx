import { useNavigate } from "@tanstack/react-router";

import { Searchbar } from "./Searchbar";
import { ConnectButton } from "./ConnectButton";
import { MnMIcon } from "../icons/MnMIcon";

export function Navbar() {
  const navigate = useNavigate();

  return (
    <div className="relative flex flex-row h-min w-full items-center justify-between">
      <button onClick={() => navigate({ to: "/" })} className="flex flex-row items-center cursor-pointer z-10 w-44">
        <MnMIcon className="h-9 w-9" />
      </button>

      <Searchbar />

      <ConnectButton />
    </div>
  );
}
