import clsx from 'clsx'

export const BidAskIcon = ({
  className = 'w-9 h-9',
  colored = false,
}: {
  className?: string
  colored?: boolean
}) => {
  const leftFill = colored ? '#B6D162' : '#FFFFFF'
  const rightFill = colored ? '#A866DD' : '#FFFFFF'
  const transitionStyle = { transition: 'fill 0.3s ease-in-out' }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={clsx(className)}
      viewBox="0 0 63 26"
      fill="none"
    >
      {/* Left Side (mirrored) */}
      <rect
        width="3"
        height="14"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 18 12)"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="16"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 13 10)"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="21"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 8 5)"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="26"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 3 0)"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="9"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 23 17)"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="7"
        fill={leftFill}
        fillOpacity="0.7"
        rx="1"
        transform="matrix(-1 0 0 1 28 19)"
        style={transitionStyle}
      />

      {/* Right Side */}
      <rect
        width="3"
        height="14"
        x="45"
        y="12"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="16"
        x="50"
        y="10"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="21"
        x="55"
        y="5"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="26"
        x="60"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="9"
        x="40"
        y="17"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />
      <rect
        width="3"
        height="7"
        x="35"
        y="19"
        fill={rightFill}
        fillOpacity="0.7"
        rx="1"
        style={transitionStyle}
      />

      {/* Center stays white */}
      <rect width="3" height="5" x="30" y="21" fill="#fff" rx="1" />
    </svg>
  )
}
