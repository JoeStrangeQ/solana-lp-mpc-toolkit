import clsx from "clsx";

export const CurveIcon = ({
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
      {/* Left Side */}
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
        x="15"
        y="13"
        width="3"
        height="13"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="20"
        y="5"
        width="3"
        height="21"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        x="25"
        y="2"
        width="3"
        height="24"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />

      {/* Right Side (mirrored transforms) */}
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
        transform="matrix(-1 0 0 1 48 13)"
        width="3"
        height="13"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 43 5)"
        width="3"
        height="21"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 38 2)"
        width="3"
        height="24"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />

      {/* Center bar */}
      <rect
        transform="matrix(-1 0 0 1 33 0)"
        width="3"
        height="26"
        fill="#fff"
        rx="1"
        style={transitionStyle}
      />

      {/* Outer bars (white always) */}
      <rect
        x="5"
        y="21"
        width="3"
        height="5"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 58 21)"
        width="3"
        height="5"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        y="21"
        width="3"
        height="5"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        transform="matrix(-1 0 0 1 63 21)"
        width="3"
        height="5"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
    </svg>
  );
};
