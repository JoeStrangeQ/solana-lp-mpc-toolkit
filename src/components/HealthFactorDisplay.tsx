/**
 * Health Factor Display Component
 * Shows position health with visual indicators
 */

import React from "react";

interface HealthFactorDisplayProps {
  healthFactor: number;
  liquidationThreshold?: number;
  showBar?: boolean;
  size?: "sm" | "md" | "lg";
}

const HealthFactorDisplay: React.FC<HealthFactorDisplayProps> = ({
  healthFactor,
  liquidationThreshold = 1.0,
  showBar = true,
  size = "md",
}) => {
  // Determine status based on health factor
  const getStatus = () => {
    if (healthFactor <= liquidationThreshold) return "liquidatable";
    if (healthFactor < 1.1) return "danger";
    if (healthFactor < 1.3) return "warning";
    return "healthy";
  };

  const status = getStatus();

  // Color mapping
  const colors = {
    healthy: {
      text: "text-green-400",
      bg: "bg-green-500",
      border: "border-green-500",
      glow: "shadow-green-500/50",
    },
    warning: {
      text: "text-yellow-400",
      bg: "bg-yellow-500",
      border: "border-yellow-500",
      glow: "shadow-yellow-500/50",
    },
    danger: {
      text: "text-orange-400",
      bg: "bg-orange-500",
      border: "border-orange-500",
      glow: "shadow-orange-500/50",
    },
    liquidatable: {
      text: "text-red-500",
      bg: "bg-red-500",
      border: "border-red-500",
      glow: "shadow-red-500/50",
    },
  };

  const currentColors = colors[status];

  // Size mapping
  const sizes = {
    sm: {
      text: "text-sm",
      bar: "h-1",
      icon: "w-3 h-3",
    },
    md: {
      text: "text-base",
      bar: "h-2",
      icon: "w-4 h-4",
    },
    lg: {
      text: "text-lg",
      bar: "h-3",
      icon: "w-5 h-5",
    },
  };

  const currentSize = sizes[size];

  // Calculate bar fill percentage (capped at 2x for visual)
  const fillPercentage = Math.min((healthFactor / 2) * 100, 100);

  // Status labels
  const statusLabels = {
    healthy: "Healthy",
    warning: "Warning",
    danger: "Danger",
    liquidatable: "Liquidatable!",
  };

  return (
    <div className="space-y-2">
      {/* Main display */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Animated dot indicator */}
          <div
            className={`${currentSize.icon} rounded-full ${currentColors.bg} ${
              status === "liquidatable" ? "animate-pulse" : ""
            }`}
          />

          <span className={`${currentSize.text} text-gray-400`}>
            Health Factor
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`${currentSize.text} font-mono font-bold ${currentColors.text}`}
          >
            {healthFactor.toFixed(2)}
          </span>

          <span
            className={`text-xs px-2 py-0.5 rounded ${currentColors.bg}/20 ${currentColors.text}`}
          >
            {statusLabels[status]}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {showBar && (
        <div className="relative">
          {/* Background bar */}
          <div
            className={`w-full ${currentSize.bar} bg-gray-700 rounded-full overflow-hidden`}
          >
            {/* Fill bar */}
            <div
              className={`${currentSize.bar} ${currentColors.bg} rounded-full transition-all duration-500 ${
                status === "liquidatable" ? "animate-pulse" : ""
              }`}
              style={{ width: `${fillPercentage}%` }}
            />
          </div>

          {/* Threshold markers */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
            {/* Liquidation threshold (1.0) */}
            <div
              className="absolute top-0 h-full w-0.5 bg-red-500"
              style={{ left: "50%" }}
              title="Liquidation Threshold"
            />

            {/* Warning threshold (1.3) */}
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-500/50"
              style={{ left: "65%" }}
              title="Warning Threshold"
            />
          </div>

          {/* Labels */}
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0</span>
            <span className="text-red-400">1.0 (Liq)</span>
            <span>2.0+</span>
          </div>
        </div>
      )}

      {/* Warning message for low health */}
      {status === "danger" && (
        <div className="flex items-center gap-2 text-orange-400 text-sm bg-orange-500/10 rounded-lg p-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>
            Position at risk! Consider adding collateral or reducing debt.
          </span>
        </div>
      )}

      {status === "liquidatable" && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 rounded-lg p-2 animate-pulse">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          <span>LIQUIDATION IMMINENT! Take action immediately!</span>
        </div>
      )}
    </div>
  );
};

export default HealthFactorDisplay;
