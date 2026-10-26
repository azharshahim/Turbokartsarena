/**
 * Turbo Karts Arena — icônes de l'interface.
 *
 * SVG inline générés en composants React (aucune police d'icônes, aucun CDN) :
 * indispensable pour la preview web sandboxée et pour garder l'APK léger.
 * L'app Android consomme exactement les mêmes composants.
 */

import React from 'react';

export type IconName =
  | 'play'
  | 'pause'
  | 'gear'
  | 'chevronLeft'
  | 'chevronRight'
  | 'flame'
  | 'drift'
  | 'bolt'
  | 'trophy'
  | 'flag'
  | 'speed'
  | 'gyro'
  | 'touch'
  | 'volume'
  | 'mute'
  | 'close'
  | 'check'
  | 'star'
  | 'refresh'
  | 'shield'
  | 'wheel';

interface Props {
  name: IconName;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}

export const Icon: React.FC<Props> = ({ name, size = 24, color = '#ffffff', style, strokeWidth = 2 }) => {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style,
  };
  switch (name) {
    case 'play':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
          <path d="M8 5.5v13l11-6.5z" fill={color} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );
    case 'pause':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
          <rect x="6.5" y="5" width="3.6" height="14" rx="1.4" fill={color} />
          <rect x="14" y="5" width="3.6" height="14" rx="1.4" fill={color} />
        </svg>
      );
    case 'gear':
      return (
        <svg {...p} style={style}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.05A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.05A1.7 1.7 0 0 0 20.95 10H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
        </svg>
      );
    case 'chevronLeft':
      return (
        <svg {...p} style={style}>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      );
    case 'chevronRight':
      return (
        <svg {...p} style={style}>
          <path d="M9 5l7 7-7 7" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...p} style={style}>
          <path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.7.7-3.2 1.6-4.4C9.9 8 12 6 12 2z" fill={color} fillOpacity={0.25} />
          <path d="M12 21a4 4 0 0 0 4-4c0-2.5-2.4-4.6-4-7-1.6 2.4-4 4.5-4 7a4 4 0 0 0 4 4z" fill={color} />
        </svg>
      );
    case 'drift':
      return (
        <svg {...p} style={style}>
          <path d="M3 17c3.5 0 4-9 8-9s4.5 9 8 9" />
          <path d="M16 5.5l3 2.5-3 2.5" />
          <circle cx="6.5" cy="19.5" r="1.6" fill={color} />
          <circle cx="17.5" cy="19.5" r="1.6" fill={color} />
        </svg>
      );
    case 'bolt':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
          <path d="M13.5 2L5 13.5h5L9.5 22 19 10h-5.5z" fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...p} style={style}>
          <path d="M8 4h8v5a4 4 0 0 1-8 0z" fill={color} fillOpacity={0.2} />
          <path d="M8 5H5.5a2.5 2.5 0 0 0 0 5H8M16 5h2.5a2.5 2.5 0 0 1 0 5H16" />
          <path d="M12 13v4M9 20h6M10 17h4l.6 3h-5.2z" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...p} style={style}>
          <path d="M5 3v18" />
          <path d="M5 4h13l-2.2 4L18 12H5z" fill={color} fillOpacity={0.2} />
        </svg>
      );
    case 'speed':
      return (
        <svg {...p} style={style}>
          <path d="M4 18a8 8 0 1 1 16 0" />
          <path d="M12 18l4-6" />
          <circle cx="12" cy="18" r="1.4" fill={color} />
        </svg>
      );
    case 'gyro':
      return (
        <svg {...p} style={style}>
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M3 9a10 10 0 0 1 3-4M21 9a10 10 0 0 0-3-4" />
          <circle cx="12" cy="12" r="2.4" />
        </svg>
      );
    case 'touch':
      return (
        <svg {...p} style={style}>
          <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
          <circle cx="9" cy="16" r="1.6" fill={color} />
          <circle cx="15" cy="16" r="1.6" fill={color} />
        </svg>
      );
    case 'volume':
      return (
        <svg {...p} style={style}>
          <path d="M4 10v4h3l4 3.5v-11L7 10z" fill={color} fillOpacity={0.25} />
          <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
        </svg>
      );
    case 'mute':
      return (
        <svg {...p} style={style}>
          <path d="M4 10v4h3l4 3.5v-11L7 10z" fill={color} fillOpacity={0.25} />
          <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...p} style={style}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p} style={style}>
          <path d="M5 13l4.5 4.5L19 7" />
        </svg>
      );
    case 'star':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={style}>
          <path d="M12 3l2.6 5.7 6.2.7-4.6 4.2 1.3 6.1L12 16.8 6.5 19.7l1.3-6.1L3.2 9.4l6.2-.7z" fill={color} />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...p} style={style}>
          <path d="M20 11a8 8 0 1 0-2.3 5.7" />
          <path d="M20 4.5V11h-6.2" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...p} style={style}>
          <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" fill={color} fillOpacity={0.18} />
          <path d="M9 12l2.2 2.2L15.5 10" />
        </svg>
      );
    case 'wheel':
      return (
        <svg {...p} style={style}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="2.8" fill={color} />
          <path d="M12 4.5v4.7M4.3 14.5l4.4-1.6M19.7 14.5l-4.4-1.6" />
        </svg>
      );
    default:
      return null;
  }
};

export default Icon;
