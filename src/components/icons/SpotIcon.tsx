import clsx from "clsx";

export const SpotIcon = ({
  className = "w-9 h-9",
  colored = false,
}: {
  className?: string;
  colored?: boolean;
}) => {
  const leftFill = colored ? "#B6D162" : "#FFFFFF";
  const rightFill = colored ? "#A866DD" : "#FFFFFF";
  const transitionStyle = { transition: "fill 0.3s ease-in-out" };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={clsx(className)}
      viewBox="0 0 63 26"
      fill="none"
    >
      {/* Center bar (always white) */}
      <rect
        x="30"
        width="3"
        height="26"
        fill="#fff"
        rx="1"
        style={transitionStyle}
      />

      {/* Left side */}
      <rect
        x="15"
        width="3"
        height="26"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="20"
        width="3"
        height="26"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="25"
        width="3"
        height="26"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="10"
        y="18"
        width="3"
        height="8"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="5"
        y="18"
        width="3"
        height="8"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />

      {/* Right side (mirrored) */}
      <rect
        transform="matrix(-1 0 0 1 48 0)"
        width="3"
        height="26"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 43 0)"
        width="3"
        height="26"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 38 0)"
        width="3"
        height="26"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 53 18)"
        width="3"
        height="8"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 58 18)"
        width="3"
        height="8"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 63 18)"
        width="3"
        height="8"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />

      {/* Outer sidebars (static white) */}
      <rect
        transform="matrix(-1 0 0 1 3 18)"
        width="3"
        height="8"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
    </svg>
  );
};
