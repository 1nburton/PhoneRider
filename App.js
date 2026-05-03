import 'react-native-gesture-handler';

/**
 * Line Rider — React Native Version
 *
 * Install dependencies:
 *   expo install react-native-svg react-native-gesture-handler
 *
 * Wrap your app root with <GestureHandlerRootView style={{flex:1}}>
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Dimensions, Alert, ScrollView, Modal, TextInput,
  StyleSheet, StatusBar, Platform,
} from 'react-native';
import Svg, {
  Path, Circle, Ellipse, G, Line, Rect, Polygon,
  Defs, LinearGradient, RadialGradient, Stop,
} from 'react-native-svg';
import {
  GestureDetector, Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { Audio } from 'expo-av';

const { width: SW, height: SH } = Dimensions.get('window');
const CANVAS_H = SH - 160;
const GRAVITY = 0.4;
const FRICTION = 0.995;
const BOUNCE = 0.3;
const RIDER_RADIUS = 6;
const TRACK_WIDTH = 3;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const TAP_TRACK_THRESHOLD = 28;
const MINIMAP_W = 128;
const MINIMAP_H = 92;
const EDGE_PAN_MARGIN = 84;
const EDGE_PAN_SPEED = 24;
const CAMERA_PAN_MULT = 1.45;
const EDIT_NUDGE_STEP = 24;
const STALL_SPEED_THRESHOLD = 0.16;
const STALL_MILLISECONDS = 3000;
const NO_LANDING_WIPEOUT_DELAY_MS = 1400;
const PORTAL_TRIGGER_RADIUS = 24;
const PORTAL_COOLDOWN_FRAMES = 45;
const TRAMPOLINE_BOUNCE = 1.55;
const TRAMPOLINE_MIN_LAUNCH = 10;
const TRACK_SAVE_STORAGE_KEY = 'phone-rider-track-slots-v1';
const TRACK_SAVE_SLOT_COUNT = 3;
const AD_PLAY_COUNT_STORAGE_KEY = 'phone-rider-ad-play-count-v1';
const AD_PLAY_FREQUENCY = 5;
const AD_LOAD_WAIT_MS = 2800;
const AD_LOAD_POLL_MS = 120;
const ADMOB_TEST_INTERSTITIAL_IDS = {
  ios: 'ca-app-pub-3940256099942544/4411468910',
  android: 'ca-app-pub-3940256099942544/1033173712',
};
const ADMOB_PRODUCTION_INTERSTITIAL_IDS = {
  ios: 'ca-app-pub-5292803742086445/3424398394',
  android: 'ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx',
};
const CHARACTER_SHOP_ENABLED = false;
const BOOST_WEEEE_COOLDOWN_MS = 2800;
const AIR_YIPPEE_DELAY_MS = 450;
const AIR_YIPPEE_COOLDOWN_MS = 5200;

const memoryStorage = {};
let trackStorage = null;
let riderStoreApi = null;
let googleMobileAdsApi = null;

function getRiderStoreApi() {
  if (riderStoreApi) return riderStoreApi;
  try {
    riderStoreApi = require('react-native-iap');
    return riderStoreApi;
  } catch (_) {
    return null;
  }
}

function getGoogleMobileAdsApi() {
  if (googleMobileAdsApi) return googleMobileAdsApi;
  try {
    googleMobileAdsApi = require('react-native-google-mobile-ads');
    return googleMobileAdsApi;
  } catch (_) {
    return null;
  }
}

function getInterstitialAdUnitId(adsApi) {
  if (__DEV__) {
    return adsApi?.TestIds?.INTERSTITIAL || ADMOB_TEST_INTERSTITIAL_IDS[Platform.OS] || ADMOB_TEST_INTERSTITIAL_IDS.ios;
  }
  const productionId = ADMOB_PRODUCTION_INTERSTITIAL_IDS[Platform.OS] || ADMOB_PRODUCTION_INTERSTITIAL_IDS.ios;
  return productionId.includes('xxxxxxxx') ? null : productionId;
}

function getTrackStorage() {
  if (trackStorage) return trackStorage;

  if (Platform.OS === 'web' && globalThis?.localStorage) {
    trackStorage = {
      getItem: async (key) => globalThis.localStorage.getItem(key),
      setItem: async (key, value) => globalThis.localStorage.setItem(key, value),
    };
    return trackStorage;
  }

  try {
    const FileSystem = require('expo-file-system');
    if (FileSystem?.documentDirectory && FileSystem?.readAsStringAsync && FileSystem?.writeAsStringAsync) {
      trackStorage = {
        getItem: async (key) => {
          const uri = `${FileSystem.documentDirectory}${encodeURIComponent(key)}.json`;
          try {
            return await FileSystem.readAsStringAsync(uri);
          } catch (_) {
            return null;
          }
        },
        setItem: async (key, value) => {
          const uri = `${FileSystem.documentDirectory}${encodeURIComponent(key)}.json`;
          await FileSystem.writeAsStringAsync(uri, value);
        },
      };
      return trackStorage;
    }
  } catch (_) {
    // Fall back below when FileSystem is unavailable in the current runtime.
  }

  trackStorage = {
    getItem: async (key) => memoryStorage[key] || null,
    setItem: async (key, value) => {
      memoryStorage[key] = value;
    },
  };
  return trackStorage;
}

const RIDER_TYPES = [
  {
    id: 'classic',
    name: 'Female Skier',
    productId: null,
    priceUsd: 0,
    color: '#66d7ff',
    accent: '#ffd8ec',
    launchSpeed: 1.5,
    topSpeed: 20,
    icon: '⛷️',
    blurb: 'Balanced starter with smooth control and reliable landings.',
    motion: { pace: 0.95, bob: 1.0, sway: 0.9, suspension: 0.45, airTilt: 0.75 },
  },
  {
    id: 'snowboarder',
    name: 'Snowboarder',
    productId: null,
    priceUsd: 0,
    color: '#7effa1',
    accent: '#e6ffd1',
    launchSpeed: 1.55,
    topSpeed: 20.5,
    icon: '🏂',
    blurb: 'Free rider with stable edge control and soft transitions.',
    motion: { pace: 1.05, bob: 0.9, sway: 1.15, suspension: 0.35, airTilt: 0.9 },
  },
  {
    id: 'sled',
    name: 'Sled',
    productId: null,
    priceUsd: 0,
    color: '#ffc169',
    accent: '#fff4ce',
    launchSpeed: 1.6,
    topSpeed: 21,
    icon: '🛷',
    blurb: 'Low profile and forgiving glide, perfect for long tracks.',
    motion: { pace: 1.1, bob: 0.8, sway: 1.25, suspension: 0.2, airTilt: 1.1 },
  },
  {
    id: 'comet',
    name: 'Abominable Snowman',
    productId: 'rider_comet_1usd',
    priceUsd: 1,
    color: '#9ee8ff',
    accent: '#ffffff',
    launchSpeed: 1.8,
    topSpeed: 22,
    icon: '❄️',
    blurb: 'Massive stride and heavy bounce through rough sections.',
    motion: { pace: 1.0, bob: 1.05, sway: 1.25, suspension: 0.35, airTilt: 1.0 },
  },
  {
    id: 'blaze',
    name: 'Bigfoot',
    productId: 'rider_blaze_1usd',
    priceUsd: 1,
    color: '#9a6544',
    accent: '#f5cc9b',
    launchSpeed: 2.0,
    topSpeed: 23,
    icon: '🦶',
    blurb: 'Raw power and aggressive acceleration on steep drops.',
    motion: { pace: 0.86, bob: 1.5, sway: 0.75, suspension: 0.55, airTilt: 0.6 },
  },
  {
    id: 'nova',
    name: 'Fourwheeler',
    productId: 'rider_nova_1usd',
    priceUsd: 1,
    color: '#ff8a4d',
    accent: '#ffd65b',
    launchSpeed: 2.2,
    topSpeed: 24,
    icon: '🚙',
    blurb: 'Fast motorized grip with strong suspension response.',
    motion: { pace: 1.2, bob: 0.6, sway: 0.55, suspension: 1.8, airTilt: 0.5 },
  },
  {
    id: 'dirtbike',
    name: 'Dirtbike',
    productId: 'rider_dirtbike_1usd',
    priceUsd: 1,
    color: '#ff5f4a',
    accent: '#ffe36a',
    launchSpeed: 2.25,
    topSpeed: 24.5,
    icon: '🏍️',
    blurb: 'Quick throttle bursts and twitchy handling for jumps.',
    motion: { pace: 1.3, bob: 0.65, sway: 0.7, suspension: 1.6, airTilt: 0.7 },
  },
  {
    id: 'car',
    name: 'Car',
    productId: 'rider_car_1usd',
    priceUsd: 1,
    color: '#7ac8ff',
    accent: '#d8f2ff',
    launchSpeed: 2.05,
    topSpeed: 25,
    icon: '🚗',
    blurb: 'High top speed and planted feel on straight sections.',
    motion: { pace: 1.0, bob: 0.45, sway: 0.35, suspension: 1.35, airTilt: 0.45 },
  },
  {
    id: 'unicycle',
    name: 'Unicycle',
    productId: 'rider_unicycle_1usd',
    priceUsd: 1,
    color: '#d099ff',
    accent: '#f5dcff',
    launchSpeed: 2.1,
    topSpeed: 24,
    icon: '🎪',
    blurb: 'Chaotic balancing act with sharp lean corrections.',
    motion: { pace: 1.42, bob: 1.35, sway: 1.55, suspension: 0.15, airTilt: 1.5 },
  },
];

const LINE_TYPES = [
  { id: 'normal', label: 'Normal', color: '#7ce2ff', glow: 'rgba(124,226,255,0.2)', speedMult: 1,   speedDrag: 0,      collidable: true },
  { id: 'boost', label: 'Boost', color: '#31ff79', glow: 'rgba(49,255,121,0.24)', speedMult: 1.14, speedDrag: 0.05,   collidable: true },
  { id: 'brake', label: 'Brake', color: '#ffd64d', glow: 'rgba(255,214,77,0.24)', speedMult: 0.84, speedDrag: -0.02,  collidable: true },
  { id: 'scenery', label: 'Scenery', color: '#b58cff', glow: 'rgba(181,140,255,0.18)', speedMult: 1, speedDrag: 0,      collidable: false },
  { id: 'portal', label: 'Portal', color: '#ff67d8', glow: 'rgba(255,103,216,0.25)', speedMult: 1, speedDrag: 0, collidable: false, special: 'portal' },
  { id: 'trampoline', label: 'Trampoline', color: '#ff8e3c', glow: 'rgba(255,142,60,0.24)', speedMult: 1.04, speedDrag: 0.02, collidable: true, special: 'trampoline' },
];
const DRAW_LINE_TYPES = LINE_TYPES.filter((lineTypeEntry) => !lineTypeEntry.special);

const PRESET_LIBRARY = [
  {
    id: 'portal',
    label: 'Portal',
    type: 'portal',
    points: [
      { x: 0, y: -30 },
      { x: 0, y: 30 },
    ],
  },
  {
    id: 'trampoline',
    label: 'Trampoline',
    type: 'trampoline',
    points: [
      { x: -78, y: 18 },
      { x: -42, y: 30 },
      { x: 0, y: 34 },
      { x: 42, y: 30 },
      { x: 78, y: 18 },
    ],
  },
];

const DEMO_TRACK_LIBRARY = [
  {
    id: 'drop_off',
    name: 'Drop off',
    difficulty: 'Featured',
    description: 'A huge showcase run with drops, boosts, air time, a trampoline, and a portal replay finish.',
    recommendedRiderId: 'classic',
    lines: [
      {
        type: 'normal',
        points: [
          { x: -700, y: -380 },
          { x: -620, y: -350 },
          { x: -548, y: -285 },
          { x: -492, y: -178 },
          { x: -446, y: -42 },
          { x: -396, y: 105 },
          { x: -328, y: 220 },
          { x: -236, y: 292 },
        ],
      },
      {
        type: 'boost',
        points: [
          { x: -236, y: 292 },
          { x: -104, y: 330 },
          { x: 48, y: 338 },
          { x: 208, y: 318 },
          { x: 354, y: 278 },
        ],
      },
      {
        type: 'normal',
        points: [
          { x: 354, y: 278 },
          { x: 500, y: 226 },
          { x: 650, y: 206 },
          { x: 790, y: 232 },
          { x: 914, y: 284 },
          { x: 1032, y: 340 },
          { x: 1168, y: 368 },
        ],
      },
      {
        type: 'normal',
        points: [
          { x: 1168, y: 368 },
          { x: 1286, y: 360 },
          { x: 1398, y: 328 },
          { x: 1512, y: 322 },
          { x: 1626, y: 354 },
        ],
      },
      {
        type: 'boost',
        points: [
          { x: 1626, y: 354 },
          { x: 1740, y: 414 },
          { x: 1865, y: 468 },
          { x: 2000, y: 496 },
          { x: 2146, y: 486 },
          { x: 2282, y: 444 },
        ],
      },
      {
        type: 'trampoline',
        points: [
          { x: 2282, y: 444 },
          { x: 2348, y: 428 },
          { x: 2418, y: 430 },
          { x: 2492, y: 452 },
        ],
      },
      {
        type: 'normal',
        points: [
          { x: 2528, y: 472 },
          { x: 2650, y: 518 },
          { x: 2788, y: 544 },
          { x: 2940, y: 548 },
        ],
      },
      {
        type: 'boost',
        points: [
          { x: 2940, y: 548 },
          { x: 3060, y: 532 },
          { x: 3182, y: 518 },
          { x: 3305, y: 528 },
        ],
      },
      {
        type: 'brake',
        points: [
          { x: 3305, y: 528 },
          { x: 3424, y: 538 },
          { x: 3540, y: 548 },
          { x: 3650, y: 560 },
        ],
      },
      {
        type: 'normal',
        points: [
          { x: 3650, y: 560 },
          { x: 3770, y: 544 },
          { x: 3890, y: 532 },
          { x: 4024, y: 536 },
        ],
      },
      {
        type: 'portal',
        points: [
          { x: 4076, y: 488 },
          { x: 4076, y: 584 },
        ],
      },
      {
        type: 'scenery',
        points: [
          { x: -604, y: -468 },
          { x: -492, y: -540 },
          { x: -362, y: -472 },
          { x: -224, y: -552 },
          { x: -76, y: -474 },
          { x: 74, y: -536 },
          { x: 236, y: -458 },
        ],
      },
      {
        type: 'scenery',
        points: [
          { x: 642, y: 118 },
          { x: 782, y: 44 },
          { x: 926, y: 124 },
          { x: 1072, y: 52 },
          { x: 1218, y: 132 },
        ],
      },
      {
        type: 'scenery',
        points: [
          { x: 1860, y: 340 },
          { x: 1990, y: 272 },
          { x: 2125, y: 342 },
          { x: 2254, y: 276 },
          { x: 2394, y: 350 },
        ],
      },
      {
        type: 'scenery',
        points: [
          { x: 3030, y: 420 },
          { x: 3152, y: 364 },
          { x: 3288, y: 422 },
          { x: 3428, y: 374 },
          { x: 3580, y: 430 },
        ],
      },
    ],
  },
];

function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: x1, y: y1 };
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const cp = closestPointOnSegment(px, py, x1, y1, x2, y2);
  return Math.hypot(px - cp.x, py - cp.y);
}

function pointsToPath(pts) {
  if (pts.length < 2) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function linePoints(line) {
  return Array.isArray(line) ? line : line.points;
}

function lineType(line) {
  return Array.isArray(line) ? 'normal' : (line.type || 'normal');
}

function lineTypeConfig(typeId) {
  return LINE_TYPES.find((t) => t.id === typeId) || LINE_TYPES[0];
}

function riderConfig(riderId) {
  return RIDER_TYPES.find((r) => r.id === riderId) || RIDER_TYPES[0];
}

function riderIdFromProductId(productId) {
  const hit = RIDER_TYPES.find((r) => r.productId === productId);
  return hit ? hit.id : null;
}

function getStartAnchor(lines) {
  if (!lines.length) return null;
  const startLine = lines.find((line) => {
    const cfg = lineTypeConfig(lineType(line));
    return cfg.collidable && cfg.special !== 'portal' && linePoints(line).length;
  });
  const firstLine = linePoints(startLine || lines[0]);
  return firstLine.length ? firstLine[0] : null;
}

function getLinesBounds(lines) {
  if (!lines.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  lines.forEach((line) => {
    linePoints(line).forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
  });
  return { minX, minY, maxX, maxY };
}

function getLineBounds(line) {
  const pts = linePoints(line);
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

function getLineCenter(line) {
  const bounds = getLineBounds(line);
  if (!bounds) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function transformLinePoints(line, rotationDeg = 0, scale = 1) {
  const center = getLineCenter(line);
  if (!center) return line;
  const theta = (rotationDeg * Math.PI) / 180;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return {
    ...(Array.isArray(line) ? { type: 'normal' } : line),
    points: linePoints(line).map((p) => {
      const dx = (p.x - center.x) * scale;
      const dy = (p.y - center.y) * scale;
      return {
        x: center.x + dx * ct - dy * st,
        y: center.y + dx * st + dy * ct,
      };
    }),
  };
}

function getCollidableBounds(lines) {
  const collidable = lines.filter((line) => lineTypeConfig(lineType(line)).collidable);
  return getLinesBounds(collidable);
}

function hasReachableTrackBelow(lines, rider) {
  const downwardSpeed = Math.max(0, rider.vy || 0);
  const horizontalReach = 120 + Math.abs(rider.vx || 0) * 26 + downwardSpeed * 10;
  const verticalSearchDepth = 220 + downwardSpeed * 34;

  for (const line of lines) {
    const cfg = lineTypeConfig(lineType(line));
    if (!cfg.collidable) continue;

    const pts = linePoints(line);
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const segMinX = Math.min(p1.x, p2.x);
      const segMaxX = Math.max(p1.x, p2.x);
      const segMinY = Math.min(p1.y, p2.y);

      if (segMinY < rider.y - RIDER_RADIUS) continue;
      if (segMinY - rider.y > verticalSearchDepth) continue;
      if (rider.x < segMinX - horizontalReach || rider.x > segMaxX + horizontalReach) continue;

      return true;
    }
  }

  return false;
}

function renderCharacterSprite(riderTypeId, cfg, motion = {}) {
  const primary = cfg?.color || '#ff713a';
  const accent = cfg?.accent || '#ffffff';
  const bob = motion.bob || 0;
  const sway = motion.sway || 0;
  const suspension = motion.suspension || 0;
  const airTilt = motion.airTilt || 0;

  switch (riderTypeId) {
    case 'classic':
      return (
        <G>
          <Line x1={-14} y1={6 + bob * 0.4} x2={15} y2={6 - bob * 0.2} stroke="#d4b06f" strokeWidth={2.1} strokeLinecap="round" />
          <Line x1={-13} y1={8 + bob * 0.6} x2={14} y2={8 - bob * 0.3} stroke="#b08a54" strokeWidth={1.7} strokeLinecap="round" />
          <G translateY={-bob * 0.8}>
            <Polygon points="-8,3 8,3 10,-3 -7,-4" fill={primary} />
            <Circle cx={1} cy={-9} r={4.4} fill="#f1d1b4" />
            <Path d="M-4,-8 C-2,-13 5,-14 7,-9" stroke="#5c3f2d" strokeWidth={2.2} fill="none" />
            <Line x1={-4} y1={-1} x2={-10 + sway} y2={3} stroke={accent} strokeWidth={1.8} />
            <Line x1={4} y1={-1} x2={10 - sway} y2={3} stroke={accent} strokeWidth={1.8} />
          </G>
        </G>
      );
    case 'snowboarder':
      return (
        <G>
          <Line x1={-14} y1={7 + bob * 0.45} x2={14} y2={6.2 - bob * 0.2} stroke="#d6f5ff" strokeWidth={2.4} strokeLinecap="round" />
          <G translateY={-bob * 0.75}>
            <Path d="M-8,2 L8,3 L7,-3 L-7,-4 Z" fill={primary} />
            <Circle cx={0} cy={-10} r={4.1} fill="#f2d8c1" />
            <Path d="M-3,-13 C-1,-15 3,-15 5,-12" stroke="#2b3548" strokeWidth={1.9} fill="none" />
            <Line x1={-5} y1={-1} x2={-11 + sway} y2={3} stroke={accent} strokeWidth={1.6} />
            <Line x1={5} y1={-1} x2={11 - sway} y2={3} stroke={accent} strokeWidth={1.6} />
          </G>
        </G>
      );
    case 'sled':
      return (
        <G>
          <Path d="M-14,8 C-11,4 1,3 14,6" stroke="#f8d480" strokeWidth={2.2} fill="none" />
          <G translateY={-bob * 0.62}>
            <Path d="M-10,4 C-7,1 2,1 10,2 C9,5 3,7 -8,8 Z" fill={primary} />
            <Circle cx={-9} cy={2.4} r={2.4} fill="#f1d6bf" />
            <Line x1={-3} y1={4} x2={8 - sway * 0.4} y2={6} stroke={accent} strokeWidth={1.6} />
          </G>
        </G>
      );
    case 'comet':
      return (
        <G>
          <Line x1={-13} y1={7 + bob * 0.4} x2={13} y2={7 - bob * 0.3} stroke="#d9f5ff" strokeWidth={2} strokeLinecap="round" />
          <G translateY={-bob * 0.7}>
            <Path d="M-10,5 C-9,-2 -4,-8 3,-8 C10,-8 12,-2 10,5 Z" fill={primary} />
            <Circle cx={2} cy={-11} r={4.6} fill="#eefaff" />
            <Path d="M-2,-15 C1,-18 5,-18 8,-15" stroke="#c8f1ff" strokeWidth={2} fill="none" />
            <Line x1={-6} y1={-2} x2={-12 + sway * 0.6} y2={1} stroke="#ffffff" strokeWidth={1.8} />
            <Line x1={8} y1={-2} x2={13 - sway * 0.6} y2={1} stroke="#ffffff" strokeWidth={1.8} />
            <Circle cx={4} cy={-11} r={0.9} fill="#335" />
          </G>
        </G>
      );
    case 'blaze':
      return (
        <G>
          <Line x1={-14} y1={6 + bob * 0.35} x2={15} y2={6 - bob * 0.18} stroke="#d0ae72" strokeWidth={2.2} strokeLinecap="round" />
          <Line x1={-13} y1={8 + bob * 0.45} x2={14} y2={8 - bob * 0.22} stroke="#b38d58" strokeWidth={1.8} strokeLinecap="round" />
          <G translateY={-bob * 0.88}>
            <Path d="M-9,3 C-8,-3 -3,-7 4,-7 C10,-7 11,-1 9,4 Z" fill={primary} />
            <Circle cx={1} cy={-10.8} r={4.3} fill="#f0cfb0" />
            <Path d="M-2,-14 C1,-16 5,-16 7,-13" stroke="#5c3f2d" strokeWidth={2} fill="none" />
            <Line x1={-4} y1={-2} x2={-11 + sway * 0.75} y2={3} stroke={accent} strokeWidth={1.7} />
            <Line x1={6} y1={-2} x2={12 - sway * 0.75} y2={3} stroke={accent} strokeWidth={1.7} />
          </G>
        </G>
      );
    case 'nova':
      return (
        <G>
          <Path d="M-15,8 C-10,4 2,3 14,6" stroke="#ffd26a" strokeWidth={2.2} fill="none" />
          <G translateY={-bob * 0.55}>
            <Path d="M-11,5 C-8,1 2,0 10,2 C9,5 3,7 -8,8 Z" fill={primary} />
            <Circle cx={-10} cy={3} r={2.6} fill="#f1d4bf" />
            <Path d="M-11,1 C-7,-1 -3,-1 0,1" stroke="#293043" strokeWidth={1.6} fill="none" />
            <Line x1={-2} y1={4} x2={8 - sway * 0.5} y2={6} stroke={accent} strokeWidth={1.8} />
            <Line x1={-5} y1={3} x2={5} y2={5 + airTilt * 0.15} stroke="#d8ecff" strokeWidth={1.3} />
          </G>
        </G>
      );
    case 'dirtbike':
      return (
        <G>
          <Line x1={-14} y1={8} x2={14} y2={8} stroke="#7a818b" strokeWidth={2.6} strokeLinecap="round" />
          <Circle cx={-8} cy={8.2} r={2.2} fill="#3f4652" />
          <Circle cx={9} cy={8.2} r={2.2} fill="#3f4652" />
          <G translateY={-(suspension + bob * 0.28)}>
            <Path d="M-12,5 L-4,-2 L7,-2 L12,3 L8,6 L-11,6 Z" fill="#222a35" />
            <Path d="M-2,-5 L5,-5 L8,-2 L-1,-2 Z" fill={primary} />
            <Circle cx={0.8} cy={-10} r={4.0} fill="#f2d5bd" />
            <Line x1={3} y1={-6.5} x2={9 - sway * 0.35} y2={-3.5 + airTilt * 0.2} stroke={accent} strokeWidth={1.6} />
          </G>
        </G>
      );
    case 'car':
      return (
        <G>
          <Line x1={-14} y1={8} x2={14} y2={8} stroke="#8f959d" strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx={-8.2} cy={8.1} r={2.6} fill="#3f4652" />
          <Circle cx={8.7} cy={8.1} r={2.6} fill="#3f4652" />
          <G translateY={-(suspension * 0.8 + bob * 0.18)}>
            <Path d="M-13,4 L-6,-2 L8,-2 L13,3 L10,6 L-12,6 Z" fill={primary} />
            <Path d="M-4,-2 L4,-2 L6,1 L-3,1 Z" fill="#d8ecff" />
          </G>
        </G>
      );
    case 'unicycle':
      return (
        <G>
          <Circle cx={0} cy={8} r={5.8} fill="#3d424c" />
          <Circle cx={0} cy={8} r={2.5} fill="#a2a9b6" />
          <Line x1={0} y1={2.2} x2={0} y2={-6.5} stroke="#d9dce4" strokeWidth={1.6} />
          <G translateY={-bob * 0.75}>
            <Path d="M-4,-1 C-3,-5 1,-7 5,-6 C7,-3 6,1 3,3 Z" fill={primary} />
            <Circle cx={1.2} cy={-10.4} r={3.8} fill="#f1d5bd" />
            <Line x1={-1} y1={-2.5} x2={-7 + sway * 0.8} y2={2.5} stroke={accent} strokeWidth={1.5} />
            <Line x1={3.5} y1={-2.5} x2={8 - sway * 0.8} y2={2.5} stroke={accent} strokeWidth={1.5} />
          </G>
        </G>
      );
    default:
      return (
        <G>
          <Line x1={-14} y1={6 + bob * 0.35} x2={14} y2={6 - bob * 0.2} stroke="#d2b57d" strokeWidth={2.1} strokeLinecap="round" />
          <G translateY={-bob * 0.75}>
            <Path d="M-8,2 L8,2 L9,-3 L-7,-4 Z" fill={primary} />
            <Circle cx={1} cy={-10} r={4.1} fill="#f2d8c1" />
            <Line x1={-3.5} y1={-1} x2={-10 + sway} y2={3} stroke={accent} strokeWidth={1.6} />
            <Line x1={5} y1={-1} x2={10 - sway} y2={3} stroke={accent} strokeWidth={1.6} />
          </G>
        </G>
      );
  }
}

function nearestPointOnTrack(lines, wx, wy) {
  let best = null;
  lines.forEach((line, lineIndex) => {
    const pts = linePoints(line);
    for (let i = 0; i < pts.length - 1; i++) {
      const cp = closestPointOnSegment(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      const dist = Math.hypot(wx - cp.x, wy - cp.y);
      if (!best || dist < best.dist) {
        best = { point: cp, dist, lineIndex };
      }
    }
  });
  return best;
}

function countTrackPoints(lines) {
  return lines.reduce((total, line) => total + linePoints(line).length, 0);
}

function buildPreviewPaths(lines, width, height, padding = 8) {
  const bounds = getLinesBounds(lines);
  if (!bounds) return [];

  const drawW = Math.max(1, width - padding * 2);
  const drawH = Math.max(1, height - padding * 2);
  const trackW = Math.max(1, bounds.maxX - bounds.minX);
  const trackH = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min(drawW / trackW, drawH / trackH);
  const offsetX = padding + (drawW - trackW * scale) / 2;
  const offsetY = padding + (drawH - trackH * scale) / 2;

  return lines
    .map((line) => {
      const pts = linePoints(line).map((p) => ({
        x: offsetX + (p.x - bounds.minX) * scale,
        y: offsetY + (p.y - bounds.minY) * scale,
      }));
      return { d: pointsToPath(pts), type: lineType(line) };
    })
    .filter((entry) => entry.d);
}

function getPresetBounds(preset) {
  const allPoints = (preset.lines || [preset]).flatMap((line) => line.points || []);
  if (!allPoints.length) return null;
  return {
    minX: Math.min(...allPoints.map((p) => p.x)),
    maxX: Math.max(...allPoints.map((p) => p.x)),
    minY: Math.min(...allPoints.map((p) => p.y)),
    maxY: Math.max(...allPoints.map((p) => p.y)),
  };
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LineRider />
    </GestureHandlerRootView>
  );
}

function LineRider() {
  const [tool, setTool] = useState('draw');
  const [lineStyle, setLineStyle] = useState('normal');
  const [selectedPresetId, setSelectedPresetId] = useState(PRESET_LIBRARY[0].id);
  const [lines, setLines] = useState([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState(null);
  const [currentStroke, setCurrentStroke] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rider, setRider] = useState(null);
  const [trail, setTrail] = useState([]);
  const [crashed, setCrashed] = useState(false);
  const [crashReason, setCrashReason] = useState('wipeout');
  const [ownedRiders, setOwnedRiders] = useState(['classic', 'snowboarder', 'sled']);
  const [activeRiderId, setActiveRiderId] = useState('classic');
  const [purchaseBusyId, setPurchaseBusyId] = useState(null);
  const [paymentLedger, setPaymentLedger] = useState({});
  const [storeReady, setStoreReady] = useState(false);
  const [storePrices, setStorePrices] = useState({});
  const [showCharacterShop, setShowCharacterShop] = useState(false);
  const [showSaveSlots, setShowSaveSlots] = useState(false);
  const [showDemoTracks, setShowDemoTracks] = useState(false);
  const [savedTrackSlots, setSavedTrackSlots] = useState(Array.from({ length: TRACK_SAVE_SLOT_COUNT }, () => null));
  const [saveSlotNames, setSaveSlotNames] = useState(Array.from({ length: TRACK_SAVE_SLOT_COUNT }, (_, index) => `Track ${index + 1}`));
  const [adGateBusy, setAdGateBusy] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: SW, height: CANVAS_H });

  // Camera: panX/panY in screen-space, zoom multiplier
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 });
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  // Snapshot at gesture start for pinch/pan
  const camStartRef = useRef({ x: 0, y: 0, zoom: 1 });

  const riderRef = useRef(null);
  const linesRef = useRef(lines);
  const trailRef = useRef([]);
  const stallSinceRef = useRef(null);
  const noLandingSinceRef = useRef(null);
  const animRef = useRef(null);
  const frameCountRef = useRef(0);
  const soundRefs = useRef({ air: null, boost: null, crash: null });
  const soundReadyRef = useRef(false);
  const soundInitStartedRef = useRef(false);
  const soundInitPromiseRef = useRef(null);
  const soundUnavailableRef = useRef(false);
  const crashSoundPlayedRef = useRef(false);
  const airStartedAtRef = useRef(null);
  const airYippeePlayedRef = useRef(false);
  const lastAirYippeeAtRef = useRef(0);
  const lastBoostSoundAtRef = useRef(0);
  const wasTouchingBoostRef = useRef(false);
  const lastPortalFrameRef = useRef(-Infinity);
  const prevOnGroundRef = useRef(false);
  const adPlayCountRef = useRef(0);
  const adGateBusyRef = useRef(false);
  const adsInitializedRef = useRef(false);
  const adsUnavailableRef = useRef(false);
  const interstitialAdRef = useRef(null);
  const interstitialLoadedRef = useRef(false);
  const interstitialLoadingRef = useRef(false);
  const interstitialUnsubscribersRef = useRef([]);
  const pendingAdCloseResolverRef = useRef(null);

  useEffect(() => { linesRef.current = lines; }, [lines]);

  useEffect(() => {
    let mounted = true;

    const loadSavedTrackSlots = async () => {
      try {
        const storage = getTrackStorage();
        const raw = await storage.getItem(TRACK_SAVE_STORAGE_KEY);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        const normalized = Array.from({ length: TRACK_SAVE_SLOT_COUNT }, (_, index) => parsed[index] || null);
        setSavedTrackSlots(normalized);
        setSaveSlotNames(Array.from(
          { length: TRACK_SAVE_SLOT_COUNT },
          (_, index) => normalized[index]?.name || `Track ${index + 1}`
        ));
      } catch (_) {
        // Ignore corrupted save data and keep empty slots.
      }
    };

    const loadAdPlayCount = async () => {
      try {
        const storage = getTrackStorage();
        const raw = await storage.getItem(AD_PLAY_COUNT_STORAGE_KEY);
        const parsed = Number.parseInt(raw, 10);
        if (mounted && Number.isFinite(parsed) && parsed >= 0) {
          adPlayCountRef.current = parsed;
        }
      } catch (_) {
        adPlayCountRef.current = 0;
      }
    };

    loadSavedTrackSlots();
    loadAdPlayCount();
    return () => { mounted = false; };
  }, []);

  const ensureSfxReady = useCallback(async () => {
    if (soundUnavailableRef.current) return false;
    if (soundReadyRef.current) return true;
    if (soundInitStartedRef.current && soundInitPromiseRef.current) {
      return soundInitPromiseRef.current;
    }

    soundInitStartedRef.current = true;
    soundInitPromiseRef.current = (async () => {
      if (!Audio) throw new Error('Audio module unavailable');

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });

      const soundEntries = await Promise.allSettled([
        Audio.Sound.createAsync(require('./assets/sfx/yippee.wav'), { volume: 0.46 }),
        Audio.Sound.createAsync(require('./assets/sfx/weeeee.wav'), { volume: 0.42 }),
        Audio.Sound.createAsync(require('./assets/sfx/explosion.wav'), { volume: 0.5 }),
      ]);

      soundRefs.current = {
        air: soundEntries[0].status === 'fulfilled' ? soundEntries[0].value.sound : null,
        boost: soundEntries[1].status === 'fulfilled' ? soundEntries[1].value.sound : null,
        crash: soundEntries[2].status === 'fulfilled' ? soundEntries[2].value.sound : null,
      };
      soundReadyRef.current = Object.values(soundRefs.current).some(Boolean);
      if (__DEV__) {
        soundEntries.forEach((entry, index) => {
          if (entry.status === 'rejected') {
            const label = ['yippee', 'weeeee', 'explosion'][index] || `sound ${index + 1}`;
            console.warn(`[PhoneRider] Failed to load ${label} SFX`, entry.reason);
          }
        });
        console.log('[PhoneRider] SFX ready:', soundReadyRef.current);
      }
      return soundReadyRef.current;
    })();

    try {
      return await soundInitPromiseRef.current;
    } catch (error) {
      if (__DEV__) console.warn('[PhoneRider] SFX unavailable', error);
      soundReadyRef.current = false;
      soundInitStartedRef.current = false;
      soundInitPromiseRef.current = null;
      return false;
    }
  }, []);

  const playSfx = useCallback(async (soundId) => {
    if (!soundReadyRef.current) {
      const ready = await ensureSfxReady();
      if (!ready) return;
    }
    const sound = soundRefs.current[soundId];
    if (!sound) return;
    try {
      await sound.setPositionAsync(0);
      await sound.playAsync();
    } catch (error) {
      if (__DEV__) console.warn(`[PhoneRider] Failed to play ${soundId} SFX`, error);
      // Keep gameplay running if a sound fails.
    }
  }, [ensureSfxReady]);

  useEffect(() => {
    ensureSfxReady();
  }, [ensureSfxReady]);

  useEffect(() => () => {
    soundReadyRef.current = false;
    soundInitStartedRef.current = false;
    soundInitPromiseRef.current = null;
    soundUnavailableRef.current = false;
    Object.values(soundRefs.current).forEach((sound) => {
      sound?.unloadAsync?.().catch(() => {});
    });
    soundRefs.current = { air: null, boost: null, crash: null };
  }, []);

  const persistTrackSlots = useCallback(async (slots) => {
    try {
      const storage = getTrackStorage();
      await storage.setItem(TRACK_SAVE_STORAGE_KEY, JSON.stringify(slots));
    } catch (_) {
      Alert.alert('Save failed', 'Unable to update saved track slots right now.');
    }
  }, []);

  const persistAdPlayCount = useCallback(async (count) => {
    try {
      const storage = getTrackStorage();
      await storage.setItem(AD_PLAY_COUNT_STORAGE_KEY, String(count));
    } catch (_) {
      // The play counter is only for ad cadence; gameplay should never depend on it.
    }
  }, []);

  const resolvePendingAdClose = useCallback(() => {
    const resolve = pendingAdCloseResolverRef.current;
    pendingAdCloseResolverRef.current = null;
    if (resolve) resolve();
  }, []);

  const waitForInterstitialLoaded = useCallback(async (timeoutMs = AD_LOAD_WAIT_MS) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (interstitialLoadedRef.current) return true;
      if (!interstitialLoadingRef.current) return false;
      await new Promise((resolve) => setTimeout(resolve, AD_LOAD_POLL_MS));
    }
    return interstitialLoadedRef.current;
  }, []);

  const loadPlayInterstitial = useCallback(async () => {
    if (Platform.OS === 'web' || adsUnavailableRef.current) return false;

    try {
      const adsApi = getGoogleMobileAdsApi();
      const mobileAds = adsApi?.default;
      const { AdEventType, InterstitialAd } = adsApi || {};
      if (!mobileAds || !AdEventType || !InterstitialAd) throw new Error('Google Mobile Ads unavailable');

      if (!adsInitializedRef.current) {
        await mobileAds().initialize();
        adsInitializedRef.current = true;
      }

      if (!interstitialAdRef.current) {
        const adUnitId = getInterstitialAdUnitId(adsApi);
        if (!adUnitId) throw new Error('Production AdMob interstitial ad unit ID is not configured');

        const interstitial = InterstitialAd.createForAdRequest(adUnitId, {
          requestNonPersonalizedAdsOnly: true,
          keywords: ['game', 'racing', 'skiing'],
        });

        interstitialUnsubscribersRef.current = [
          interstitial.addAdEventListener(AdEventType.LOADED, () => {
            interstitialLoadedRef.current = true;
            interstitialLoadingRef.current = false;
          }),
          interstitial.addAdEventListener(AdEventType.ERROR, () => {
            interstitialLoadedRef.current = false;
            interstitialLoadingRef.current = false;
            resolvePendingAdClose();
          }),
          interstitial.addAdEventListener(AdEventType.OPENED, () => {
            if (Platform.OS === 'ios') StatusBar.setHidden(true);
          }),
          interstitial.addAdEventListener(AdEventType.CLOSED, () => {
            if (Platform.OS === 'ios') StatusBar.setHidden(false);
            interstitialLoadedRef.current = false;
            resolvePendingAdClose();
            interstitial.load();
          }),
        ];

        interstitialAdRef.current = interstitial;
      }

      if (!interstitialLoadedRef.current && !interstitialLoadingRef.current) {
        interstitialLoadingRef.current = true;
        interstitialAdRef.current.load();
      }

      return true;
    } catch (_) {
      adsUnavailableRef.current = true;
      interstitialLoadedRef.current = false;
      interstitialLoadingRef.current = false;
      resolvePendingAdClose();
      return false;
    }
  }, [resolvePendingAdClose]);

  const maybeShowPlayInterstitial = useCallback(async () => {
    const nextPlayCount = adPlayCountRef.current + 1;
    adPlayCountRef.current = nextPlayCount;
    persistAdPlayCount(nextPlayCount);

    if (nextPlayCount % AD_PLAY_FREQUENCY !== 0) {
      loadPlayInterstitial();
      return;
    }

    const canUseAds = await loadPlayInterstitial();
    const isLoaded = interstitialLoadedRef.current || await waitForInterstitialLoaded();
    if (!canUseAds || !isLoaded || !interstitialAdRef.current) return;

    await new Promise((resolve) => {
      pendingAdCloseResolverRef.current = resolve;
      interstitialAdRef.current.show().catch(() => {
        interstitialLoadedRef.current = false;
        resolvePendingAdClose();
        loadPlayInterstitial();
      });
    });
  }, [loadPlayInterstitial, persistAdPlayCount, resolvePendingAdClose, waitForInterstitialLoaded]);

  useEffect(() => {
    loadPlayInterstitial();

    return () => {
      resolvePendingAdClose();
      interstitialUnsubscribersRef.current.forEach((unsubscribe) => unsubscribe?.());
      interstitialUnsubscribersRef.current = [];
      interstitialAdRef.current = null;
      interstitialLoadedRef.current = false;
      interstitialLoadingRef.current = false;
      if (Platform.OS === 'ios') StatusBar.setHidden(false);
    };
  }, [loadPlayInterstitial, resolvePendingAdClose]);

  // Screen → world coordinate
  const s2w = useCallback((sx, sy) => ({
    x: (sx - camRef.current.x) / camRef.current.zoom,
    y: (sy - camRef.current.y) / camRef.current.zoom,
  }), []);

  const eraseAt = useCallback((wx, wy) => {
    const thresh = 20 / camRef.current.zoom;
    setSelectedLineIndex(null);
    setLines((prev) =>
      prev.filter((line) => {
        const pts = linePoints(line);
        for (let i = 0; i < pts.length - 1; i++)
          if (distToSeg(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) < thresh) return false;
        return true;
      })
    );
  }, []);

  const centerCameraAt = useCallback((wx, wy, zoom = camRef.current.zoom) => {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const next = {
      x: canvasSize.width / 2 - wx * clampedZoom,
      y: canvasSize.height / 2 - wy * clampedZoom,
      zoom: clampedZoom,
    };
    camRef.current = next;
    setCam(next);
  }, [canvasSize.height, canvasSize.width]);

  const fitTrackInView = useCallback(() => {
    const bounds = getLinesBounds(linesRef.current);
    if (!bounds) return;
    const margin = 32;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const zoomX = (canvasSize.width - margin * 2) / width;
    const zoomY = (canvasSize.height - margin * 2) / height;
    const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(zoomX, zoomY)));
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    centerCameraAt(centerX, centerY, targetZoom);
  }, [canvasSize.height, canvasSize.width, centerCameraAt]);

  const selectLineAt = useCallback((wx, wy) => {
    const nearest = nearestPointOnTrack(linesRef.current, wx, wy);
    if (!nearest || nearest.dist > TAP_TRACK_THRESHOLD / camRef.current.zoom) {
      setSelectedLineIndex(null);
      return false;
    }
    setSelectedLineIndex(nearest.lineIndex);
    centerCameraAt(nearest.point.x, nearest.point.y);
    return true;
  }, [centerCameraAt]);

  const transformSelectedLine = useCallback((rotationDeg = 0, scale = 1) => {
    setLines((prev) => {
      if (selectedLineIndex == null || !prev[selectedLineIndex]) return prev;
      const next = prev.map((line, idx) => (
        idx === selectedLineIndex ? transformLinePoints(line, rotationDeg, scale) : line
      ));
      linesRef.current = next;
      return next;
    });
  }, [selectedLineIndex]);

  const moveSelectedLine = useCallback((dx, dy) => {
    setLines((prev) => {
      if (selectedLineIndex == null || !prev[selectedLineIndex]) return prev;
      const next = prev.map((line, idx) => (
        idx === selectedLineIndex
          ? {
            ...(Array.isArray(line) ? { type: 'normal' } : line),
            points: linePoints(line).map((p) => ({ x: p.x + dx, y: p.y + dy })),
          }
          : line
      ));
      linesRef.current = next;
      return next;
    });
  }, [selectedLineIndex]);

  const deleteSelectedLine = useCallback(() => {
    setLines((prev) => {
      if (selectedLineIndex == null || !prev[selectedLineIndex]) return prev;
      const next = prev.filter((_, idx) => idx !== selectedLineIndex);
      linesRef.current = next;
      return next;
    });
    setSelectedLineIndex(null);
  }, [selectedLineIndex]);

  const placePresetAt = useCallback((wx, wy) => {
    const preset = PRESET_LIBRARY.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const bounds = getPresetBounds(preset);
    if (!bounds) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const sourceLines = preset.lines || [{ points: preset.points, type: preset.type || lineStyle }];
    const placedLines = sourceLines.map((sourceLine) => ({
      type: sourceLine.type || preset.type || lineStyle,
      points: sourceLine.points.map((p) => ({
        x: wx + (p.x - cx),
        y: wy + (p.y - cy),
      })),
    }));
    const insertedIndex = linesRef.current.length;
    setLines((prev) => {
      const next = [...prev, ...placedLines];
      linesRef.current = next;
      return next;
    });
    setSelectedLineIndex(insertedIndex);
    setTool('edit');
  }, [lineStyle, selectedPresetId]);

  const saveTrackToSlot = useCallback((slotIndex) => {
    if (!linesRef.current.length) {
      Alert.alert('Nothing to save', 'Draw a track before saving it to a slot.');
      return;
    }

    const enteredName = saveSlotNames[slotIndex] || '';
    const trackName = enteredName.trim() || `Track ${slotIndex + 1}`;

    const slotPayload = {
      id: slotIndex,
      name: trackName,
      savedAt: new Date().toISOString(),
      lineCount: linesRef.current.length,
      pointCount: countTrackPoints(linesRef.current),
      lines: JSON.parse(JSON.stringify(linesRef.current)),
    };

    setSavedTrackSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = slotPayload;
      persistTrackSlots(next);
      return next;
    });
    setSaveSlotNames((prev) => {
      const next = [...prev];
      next[slotIndex] = trackName;
      return next;
    });
    Alert.alert('Track saved', `Saved to slot ${slotIndex + 1}.`);
  }, [persistTrackSlots, saveSlotNames]);

  const updateSaveSlotName = useCallback((slotIndex, nextName) => {
    setSaveSlotNames((prev) => {
      const next = [...prev];
      next[slotIndex] = nextName;
      return next;
    });

    setSavedTrackSlots((prev) => {
      const existing = prev[slotIndex];
      if (!existing) return prev;
      const next = [...prev];
      next[slotIndex] = { ...existing, name: nextName.trim() || `Track ${slotIndex + 1}` };
      persistTrackSlots(next);
      return next;
    });
  }, [persistTrackSlots]);

  const loadTrackFromSlot = useCallback((slotIndex) => {
    const slot = savedTrackSlots[slotIndex];
    if (!slot?.lines?.length) {
      Alert.alert('Empty slot', 'This save slot does not have a track yet.');
      return;
    }

    stopPlay();
    const nextLines = JSON.parse(JSON.stringify(slot.lines));
    linesRef.current = nextLines;
    setLines(nextLines);
    setSelectedLineIndex(null);
    setCurrentStroke([]);
    setShowSaveSlots(false);
    requestAnimationFrame(() => {
      resetView();
      requestAnimationFrame(() => fitTrackInView());
    });
  }, [fitTrackInView, resetView, savedTrackSlots, stopPlay]);

  const loadDemoTrack = useCallback((demoTrack) => {
    if (!demoTrack?.lines?.length) return;
    stopPlay();
    const nextLines = JSON.parse(JSON.stringify(demoTrack.lines));
    linesRef.current = nextLines;
    setLines(nextLines);
    setSelectedLineIndex(null);
    setCurrentStroke([]);
    setTool('draw');
    setShowDemoTracks(false);
    requestAnimationFrame(() => {
      resetView();
      requestAnimationFrame(() => fitTrackInView());
    });
  }, [fitTrackInView, resetView, stopPlay]);

  useEffect(() => {
    if (!CHARACTER_SHOP_ENABLED) return;

    let mounted = true;
    let purchaseSub;
    let errorSub;
    let RNIap;

    const unlockFromPurchases = (purchases) => {
      if (!mounted || !Array.isArray(purchases)) return;
      const unlocked = purchases
        .map((p) => riderIdFromProductId(p?.productId || p?.id))
        .filter(Boolean);
      if (!unlocked.length) return;
      setOwnedRiders((prev) => Array.from(new Set([...prev, ...unlocked])));
    };

    const initIap = async () => {
      const paidSkus = RIDER_TYPES.map((r) => r.productId).filter(Boolean);
      try {
        RNIap = getRiderStoreApi();
        if (!RNIap) throw new Error('In-app purchase module is unavailable.');

        await RNIap.initConnection();
        if (!mounted) return;
        setStoreReady(true);

        if (paidSkus.length) {
          const products = await RNIap.fetchProducts({ skus: paidSkus, type: 'in-app' });
          if (mounted) {
            const nextPrices = {};
            products.forEach((p) => {
              const key = p.id || p.productId;
              const price = p.displayPrice || p.localizedPrice || (typeof p.price === 'number' ? `$${p.price.toFixed(2)}` : '$1.00');
              if (key) nextPrices[key] = price;
            });
            setStorePrices(nextPrices);
          }
        }

        const existing = await RNIap.getAvailablePurchases({
          alsoPublishToEventListenerIOS: false,
          onlyIncludeActiveItemsIOS: true,
        });
        unlockFromPurchases(existing);
      } catch (err) {
        if (mounted) setStoreReady(false);
        return;
      }

      purchaseSub = RNIap.purchaseUpdatedListener(async (purchase) => {
        const productId = purchase?.productId || purchase?.id;
        const riderId = riderIdFromProductId(productId);
        if (riderId) {
          setOwnedRiders((prev) => Array.from(new Set([...prev, riderId])));
          setActiveRiderId(riderId);
          setPaymentLedger((prev) => ({
            ...prev,
            [riderId]: {
              productId,
              purchasedAt: new Date().toISOString(),
              transactionId: purchase?.transactionId || purchase?.id,
            },
          }));
          setPurchaseBusyId(null);
        }
        try {
          await RNIap.finishTransaction({ purchase, isConsumable: false });
        } catch (_) {
          // no-op: listener still unlocks, transaction can be finalized later by restore flow
        }
      });

      errorSub = RNIap.purchaseErrorListener((err) => {
        setPurchaseBusyId(null);
        Alert.alert('Purchase failed', err?.message || 'Could not complete purchase.');
      });
    };

    initIap();
    return () => {
      mounted = false;
      purchaseSub?.remove?.();
      errorSub?.remove?.();
      RNIap?.endConnection?.().catch(() => {});
    };
  }, []);

  const restoreRiderPurchases = useCallback(async () => {
    try {
      const RNIap = getRiderStoreApi();
      if (!RNIap) throw new Error('In-app purchase module is unavailable.');

      const purchases = await RNIap.getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });
      const unlocked = purchases
        .map((p) => riderIdFromProductId(p?.productId || p?.id))
        .filter(Boolean);
      if (!unlocked.length) {
        Alert.alert('Restore Purchases', 'No prior rider purchases were found.');
        return;
      }
      setOwnedRiders((prev) => Array.from(new Set([...prev, ...unlocked])));
      Alert.alert('Restore Purchases', `Restored ${unlocked.length} rider purchase(s).`);
    } catch (err) {
      Alert.alert('Restore failed', err?.message || 'Unable to restore purchases right now.');
    }
  }, []);

  const activateOrPurchaseRider = useCallback(async (riderId) => {
    const cfg = riderConfig(riderId);
    const alreadyOwned = ownedRiders.includes(riderId);
    if (alreadyOwned || cfg.priceUsd <= 0) {
      if (!alreadyOwned) setOwnedRiders((prev) => [...prev, riderId]);
      setActiveRiderId(riderId);
      return;
    }
    if (purchaseBusyId) return;
    if (!storeReady || !cfg.productId) {
      Alert.alert('Store unavailable', 'In-app purchases are not ready yet. Try again in a moment.');
      return;
    }
    setPurchaseBusyId(riderId);
    try {
      const RNIap = getRiderStoreApi();
      if (!RNIap) throw new Error('In-app purchase module is unavailable.');

      await RNIap.requestPurchase({
        request: {
          ios: { sku: cfg.productId },
          apple: { sku: cfg.productId },
          android: { skus: [cfg.productId] },
          google: { skus: [cfg.productId] },
        },
        type: 'in-app',
      });
    } catch (err) {
      Alert.alert('Purchase failed', err?.message || 'Could not complete purchase.');
      setPurchaseBusyId(null);
    }
  }, [ownedRiders, purchaseBusyId, storeReady]);

  useEffect(() => {
    if (!purchaseBusyId) return undefined;
    const timeout = setTimeout(() => {
      setPurchaseBusyId((prev) => (prev === purchaseBusyId ? null : prev));
    }, 15000);
    return () => clearTimeout(timeout);
  }, [purchaseBusyId]);

  /* ══════════ GESTURES ══════════ */

  // 1-finger draw / erase
  const drawGesture = Gesture.Pan()
    .maxPointers(1)
    .enabled(!playing)
    .onStart((e) => {
      const w = s2w(e.x, e.y);
      if (tool === 'draw') {
        setCurrentStroke([w]);
      } else if (tool === 'erase') {
        eraseAt(w.x, w.y);
      } else if (tool === 'preset') {
        placePresetAt(w.x, w.y);
      } else if (tool === 'edit') {
        selectLineAt(w.x, w.y);
      }
    })
    .onUpdate((e) => {
      if (tool === 'preset' || tool === 'edit') return;

      // Autopan while drawing near screen edges.
      const c = camRef.current;
      let moved = false;
      if (e.x > canvasSize.width - EDGE_PAN_MARGIN) {
        const t = (e.x - (canvasSize.width - EDGE_PAN_MARGIN)) / EDGE_PAN_MARGIN;
        c.x -= EDGE_PAN_SPEED * t;
        moved = true;
      } else if (e.x < EDGE_PAN_MARGIN) {
        const t = (EDGE_PAN_MARGIN - e.x) / EDGE_PAN_MARGIN;
        c.x += EDGE_PAN_SPEED * t;
        moved = true;
      }
      if (e.y > canvasSize.height - EDGE_PAN_MARGIN) {
        const t = (e.y - (canvasSize.height - EDGE_PAN_MARGIN)) / EDGE_PAN_MARGIN;
        c.y -= EDGE_PAN_SPEED * t;
        moved = true;
      } else if (e.y < EDGE_PAN_MARGIN) {
        const t = (EDGE_PAN_MARGIN - e.y) / EDGE_PAN_MARGIN;
        c.y += EDGE_PAN_SPEED * t;
        moved = true;
      }
      if (moved) setCam({ ...c });

      const w = s2w(e.x, e.y);
      if (tool === 'erase') { eraseAt(w.x, w.y); return; }
      setCurrentStroke((prev) => {
        const last = prev[prev.length - 1];
        if (!last || Math.hypot(w.x - last.x, w.y - last.y) > 5 / camRef.current.zoom)
          return [...prev, w];
        return prev;
      });
    })
    .onEnd(() => {
      if (tool === 'preset' || tool === 'edit') return;
      setCurrentStroke((stroke) => {
        if (stroke.length > 1) {
          const simplified = [stroke[0]];
          for (let i = 1; i < stroke.length; i++) {
            const last = simplified[simplified.length - 1];
            if (Math.hypot(stroke[i].x - last.x, stroke[i].y - last.y) > 6 / camRef.current.zoom)
              simplified.push(stroke[i]);
          }
          if (simplified.length > 1) setLines((prev) => [...prev, { points: simplified, type: lineStyle }]);
        }
        return [];
      });
    });

  const tapGesture = Gesture.Tap()
    .enabled(!playing)
    .maxDistance(12)
    .onEnd((e, success) => {
      if (!success || tool === 'preset' || !linesRef.current.length) return;
      const w = s2w(e.x, e.y);
      if (tool === 'edit') {
        selectLineAt(w.x, w.y);
        return;
      }
      const nearest = nearestPointOnTrack(linesRef.current, w.x, w.y);
      if (!nearest) return;
      if (nearest.dist <= TAP_TRACK_THRESHOLD / camRef.current.zoom) {
        centerCameraAt(nearest.point.x, nearest.point.y);
      }
    });

  // 2-finger pan
  const panGesture = Gesture.Pan()
    .minPointers(2)
    .onStart(() => {
      camStartRef.current = { ...camRef.current };
    })
    .onUpdate((e) => {
      const c = camRef.current;
      c.x = camStartRef.current.x + e.translationX * CAMERA_PAN_MULT;
      c.y = camStartRef.current.y + e.translationY * CAMERA_PAN_MULT;
      setCam({ ...c });
    });

  // Pinch to zoom
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      camStartRef.current = { ...camRef.current };
    })
    .onUpdate((e) => {
      const c = camRef.current;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camStartRef.current.zoom * e.scale));
      // Zoom toward center of screen
      const cx = canvasSize.width / 2;
      const cy = canvasSize.height / 2;
      const ratio = newZoom / camStartRef.current.zoom;
      c.x = cx - ratio * (cx - camStartRef.current.x);
      c.y = cy - ratio * (cy - camStartRef.current.y);
      c.zoom = newZoom;
      setCam({ ...c });
    });

  // Compose: draw is exclusive (1 finger), pan+pinch are simultaneous (2 fingers)
  const twoFingerGesture = Gesture.Simultaneous(panGesture, pinchGesture);
  const composedGesture = Gesture.Race(twoFingerGesture, Gesture.Simultaneous(drawGesture, tapGesture));

  /* ══════════ PLAY / STOP ══════════ */
  const startPlay = useCallback(async () => {
    if (lines.length === 0 || adGateBusyRef.current) return;

    adGateBusyRef.current = true;
    setAdGateBusy(true);

    try {
      await maybeShowPlayInterstitial();
    } finally {
      adGateBusyRef.current = false;
      setAdGateBusy(false);
    }

    const start = getStartAnchor(lines);
    if (!start) return;
    const cfg = riderConfig(activeRiderId);
    riderRef.current = {
      x: start.x,
      y: start.y - RIDER_RADIUS - 2,
      vx: cfg.launchSpeed,
      vy: 0,
      onGround: false,
      angle: 0,
      crashed: false,
      riderTypeId: activeRiderId,
    };
    trailRef.current = [];
    stallSinceRef.current = null;
    noLandingSinceRef.current = null;
    crashSoundPlayedRef.current = false;
    airStartedAtRef.current = null;
    airYippeePlayedRef.current = false;
    lastAirYippeeAtRef.current = 0;
    lastBoostSoundAtRef.current = 0;
    wasTouchingBoostRef.current = false;
    lastPortalFrameRef.current = -Infinity;
    prevOnGroundRef.current = false;
    setCrashReason('wipeout');
    setCrashed(false);
    setPlaying(true);
  }, [activeRiderId, lines, maybeShowPlayInterstitial]);

  const stopPlay = useCallback(() => {
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    riderRef.current = null;
    trailRef.current = [];
    stallSinceRef.current = null;
    noLandingSinceRef.current = null;
    crashSoundPlayedRef.current = false;
    airStartedAtRef.current = null;
    airYippeePlayedRef.current = false;
    wasTouchingBoostRef.current = false;
    lastPortalFrameRef.current = -Infinity;
    prevOnGroundRef.current = false;
    setRider(null);
    setTrail([]);
    setCrashReason('wipeout');
    setCrashed(false);
  }, []);

  /* ══════════ PHYSICS LOOP ══════════ */
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const r = riderRef.current;
      if (!r) return;
      if (!r.crashed) {
        let grounded = false;
        let touchedBoost = false;
        const speed = Math.hypot(r.vx, r.vy);
        const steps = Math.min(12, Math.max(1, Math.ceil(speed / 2.5)));
        const stepGravity = GRAVITY / steps;

        for (let step = 0; step < steps; step++) {
          r.vy += stepGravity;
          r.x += r.vx / steps;
          r.y += r.vy / steps;

          for (const line of linesRef.current) {
            const pts = linePoints(line);
            const cfg = lineTypeConfig(lineType(line));
            if (cfg.special === 'portal') {
              if (frameCountRef.current - lastPortalFrameRef.current < PORTAL_COOLDOWN_FRAMES) continue;
              for (let i = 0; i < pts.length - 1; i++) {
                const portalDist = distToSeg(r.x, r.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
                if (portalDist <= PORTAL_TRIGGER_RADIUS) {
                  const start = getStartAnchor(linesRef.current);
                  if (start) {
                    const launchCfg = riderConfig(r.riderTypeId || activeRiderId);
                    r.x = start.x;
                    r.y = start.y - RIDER_RADIUS - 2;
                    r.vx = launchCfg.launchSpeed;
                    r.vy = 0;
                    r.angle = 0;
                    r.onGround = false;
                    r.crashed = false;
                    grounded = false;
                    lastPortalFrameRef.current = frameCountRef.current;
                    noLandingSinceRef.current = null;
                    stallSinceRef.current = null;
                    airStartedAtRef.current = null;
                    airYippeePlayedRef.current = false;
                    prevOnGroundRef.current = false;
                    trailRef.current = [{ x: r.x, y: r.y }];
                  }
                  break;
                }
              }
              continue;
            }
            if (!cfg.collidable) continue;
            for (let i = 0; i < pts.length - 1; i++) {
              const cp = closestPointOnSegment(r.x, r.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
              const dist = Math.hypot(r.x - cp.x, r.y - cp.y);
              if (dist <= RIDER_RADIUS) {
                const denom = dist || 0.0001;
                const nx = (r.x - cp.x) / denom;
                const ny = (r.y - cp.y) / denom;
                r.x = cp.x + nx * RIDER_RADIUS;
                r.y = cp.y + ny * RIDER_RADIUS;
                const dot = r.vx * nx + r.vy * ny;
                if (dot < 0) {
                  r.vx -= (1 + BOUNCE) * dot * nx;
                  r.vy -= (1 + BOUNCE) * dot * ny;
                  const tx = -ny;
                  const ty = nx;
                  const tDot = r.vx * tx + r.vy * ty;
                  r.vx = tx * tDot * FRICTION;
                  r.vy = ty * tDot * FRICTION;
                }
                if (cfg.special === 'trampoline') {
                  const launchSpeed = Math.max(TRAMPOLINE_MIN_LAUNCH, Math.hypot(r.vx, r.vy) * TRAMPOLINE_BOUNCE);
                  const outwardY = ny < 0 ? ny : -Math.abs(ny || 1);
                  const outwardX = Math.abs(nx) > 0.15 ? nx : -0.12;
                  const normalLen = Math.hypot(outwardX, outwardY) || 1;
                  r.vx = (outwardX / normalLen) * launchSpeed * 0.42 + r.vx * 0.28;
                  r.vy = (outwardY / normalLen) * launchSpeed;
                }
                if (cfg.speedDrag !== 0) {
                  // Gradual speed change: nudge current speed toward target each contact step
                  const curSpeed = Math.hypot(r.vx, r.vy);
                  if (curSpeed > 0.01) {
                    const targetSpeed = curSpeed * cfg.speedMult;
                    const nextSpeed = Math.max(0, curSpeed + cfg.speedDrag * curSpeed);
                    const blendFactor = cfg.speedDrag > 0 ? 0.9 : (cfg.speedDrag < 0 ? 0.45 : 0.18);
                    const blended = curSpeed + (nextSpeed - curSpeed) * blendFactor;
                    const clampedSpeed = cfg.speedDrag < 0
                      ? Math.max(targetSpeed, blended)
                      : Math.min(targetSpeed, blended);
                    const scale = clampedSpeed / curSpeed;
                    r.vx *= scale;
                    r.vy *= scale;
                  }
                }
                if (cfg.id === 'boost') touchedBoost = true;
                r.angle = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
                grounded = true;
              }
            }
          }
        }

        r.onGround = grounded;
        const activeCfg = riderConfig(r.riderTypeId || activeRiderId);
        const postSpeed = Math.hypot(r.vx, r.vy);
        if (postSpeed > activeCfg.topSpeed) {
          r.vx = (r.vx / postSpeed) * activeCfg.topSpeed;
          r.vy = (r.vy / postSpeed) * activeCfg.topSpeed;
        }

        const now = Date.now();
        if (
          grounded
          && touchedBoost
          && !wasTouchingBoostRef.current
          && now - lastBoostSoundAtRef.current >= BOOST_WEEEE_COOLDOWN_MS
        ) {
          lastBoostSoundAtRef.current = now;
          playSfx('boost');
        }
        wasTouchingBoostRef.current = grounded && touchedBoost;

        const movingSpeed = Math.hypot(r.vx, r.vy);
        const wasGrounded = prevOnGroundRef.current;
        if (!grounded && movingSpeed > 2.3) {
          if (wasGrounded || !airStartedAtRef.current) {
            airStartedAtRef.current = now;
            airYippeePlayedRef.current = false;
          }
          if (
            !airYippeePlayedRef.current
            && now - airStartedAtRef.current >= AIR_YIPPEE_DELAY_MS
            && now - lastAirYippeeAtRef.current >= AIR_YIPPEE_COOLDOWN_MS
          ) {
            airYippeePlayedRef.current = true;
            lastAirYippeeAtRef.current = now;
            playSfx('air');
          }
        } else if (grounded) {
          airStartedAtRef.current = null;
          airYippeePlayedRef.current = false;
        }
        prevOnGroundRef.current = grounded;

        const collidableBounds = getCollidableBounds(linesRef.current);
        const hasTrackBelow = hasReachableTrackBelow(linesRef.current, r);
        const farBelowTrack = collidableBounds ? r.y > collidableBounds.maxY + 260 : false;
        const farOutsideTrackX = collidableBounds
          ? (r.x < collidableBounds.minX - 420 || r.x > collidableBounds.maxX + 420)
          : false;
        const farOffscreen = r.y > canvasSize.height / camRef.current.zoom + 1100;
        const noViableLanding = !grounded && !hasTrackBelow && (farBelowTrack || farOutsideTrackX || farOffscreen);

        if (noViableLanding) {
          if (!noLandingSinceRef.current) noLandingSinceRef.current = Date.now();
          if (Date.now() - noLandingSinceRef.current >= NO_LANDING_WIPEOUT_DELAY_MS) {
            r.crashed = true;
            setCrashReason('wipeout');
            setCrashed(true);
            if (!crashSoundPlayedRef.current) {
              crashSoundPlayedRef.current = true;
              playSfx('crash');
            }
          }
        } else {
          noLandingSinceRef.current = null;
        }

        if (!r.crashed && grounded && movingSpeed < STALL_SPEED_THRESHOLD) {
          if (!stallSinceRef.current) stallSinceRef.current = Date.now();
          if (Date.now() - stallSinceRef.current >= STALL_MILLISECONDS) {
            r.crashed = true;
            setCrashReason('stalled');
            setCrashed(true);
            if (!crashSoundPlayedRef.current) {
              crashSoundPlayedRef.current = true;
              playSfx('crash');
            }
          }
        } else {
          stallSinceRef.current = null;
        }

        trailRef.current.push({ x: r.x, y: r.y });
        if (trailRef.current.length > 200) trailRef.current.shift();

        // Camera follow
        const c = camRef.current;
        const tx = canvasSize.width / 2 - r.x * c.zoom;
        const ty = canvasSize.height / 2 - r.y * c.zoom;
        c.x += (tx - c.x) * 0.06;
        c.y += (ty - c.y) * 0.06;
      }

      frameCountRef.current++;
      if (frameCountRef.current % 2 === 0) {
        setRider(riderRef.current ? { ...riderRef.current } : null);
        setTrail([...trailRef.current]);
        setCam({ ...camRef.current });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    frameCountRef.current = 0;
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [activeRiderId, canvasSize.height, canvasSize.width, playSfx, playing]);

  const resetView = useCallback(() => {
    camRef.current = { x: 0, y: 0, zoom: 1 };
    setCam({ x: 0, y: 0, zoom: 1 });
  }, []);

  /* ══════════ DERIVED ══════════ */
  const startAnchor = getStartAnchor(lines);
  const startX = startAnchor ? startAnchor.x : null;
  const startY = startAnchor ? startAnchor.y : null;

  const styleMeta = lineTypeConfig(lineStyle);
  const mapBounds = getLinesBounds(lines);
  const mapPadding = 40;
  const minimap = mapBounds
    ? {
      minX: mapBounds.minX - mapPadding,
      minY: mapBounds.minY - mapPadding,
      maxX: mapBounds.maxX + mapPadding,
      maxY: mapBounds.maxY + mapPadding,
    }
    : null;
  const miniW = minimap ? Math.max(1, minimap.maxX - minimap.minX) : 1;
  const miniH = minimap ? Math.max(1, minimap.maxY - minimap.minY) : 1;
  const toMini = (x, y) => ({
    x: ((x - (minimap?.minX || 0)) / miniW) * MINIMAP_W,
    y: ((y - (minimap?.minY || 0)) / miniH) * MINIMAP_H,
  });

  const minimapTapGesture = Gesture.Tap()
    .enabled(Boolean(minimap))
    .onEnd((e, success) => {
      if (!success || !minimap) return;
      const rx = Math.max(0, Math.min(1, e.x / MINIMAP_W));
      const ry = Math.max(0, Math.min(1, e.y / MINIMAP_H));
      const wx = minimap.minX + rx * miniW;
      const wy = minimap.minY + ry * miniH;
      centerCameraAt(wx, wy);
    });

  const zoomPct = Math.round(cam.zoom * 100);
  const activeRiderCfg = riderConfig(activeRiderId);
  const currentRiderCfg = rider ? riderConfig(rider.riderTypeId || activeRiderId) : activeRiderCfg;
  const demoTracks = DEMO_TRACK_LIBRARY;
  const rAngle = rider
    ? (rider.onGround ? rider.angle : Math.atan2(rider.vy || 0, rider.vx || 0)) * (180 / Math.PI)
    : 0;
  const riderSpeed = rider ? Math.hypot(rider.vx || 0, rider.vy || 0) : 0;
  const motionCfg = currentRiderCfg.motion || { pace: 1, bob: 1, sway: 1, suspension: 1, airTilt: 1 };
  const motionPhase = rider ? (rider.x * 0.12 + rider.y * 0.04) * motionCfg.pace : 0;
  const motionAmp = Math.min(1, riderSpeed / 12) * (rider?.onGround ? 1 : 0.45);
  const riderMotion = {
    bob: Math.sin(motionPhase) * 1.2 * motionAmp * motionCfg.bob,
    sway: Math.cos(motionPhase * 0.9) * 1.1 * motionAmp * motionCfg.sway,
    suspension: Math.max(0, Math.sin(motionPhase * 1.35)) * 1.4 * motionAmp * motionCfg.suspension,
    airTilt: rider?.onGround ? 0 : Math.sin(motionPhase * 0.8) * 1.2 * motionCfg.airTilt,
  };

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={s.title}>⛷ iOS RIDER</Text>
          <Text style={s.subtitle}>NEON</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={[s.toolGroup, s.toolGroupLeft]}>
          {[
            { id: 'draw', icon: '✏️', label: 'Draw' },
            { id: 'erase', icon: '🧹', label: 'Erase' },
            { id: 'preset', icon: '🧩', label: 'Preset' },
          ].map(({ id, icon, label }) => (
            <TouchableOpacity key={id} onPress={() => !playing && setTool(id)}
              style={[s.toolBtn, tool === id && s.toolBtnActive]} disabled={playing}>
              <Text style={{ fontSize: 14 }}>{icon}</Text>
              <Text style={[s.toolLabel, tool === id && s.toolLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[s.toolGroup, s.toolGroupRight]}>
          {!playing ? (
            <TouchableOpacity onPress={startPlay} disabled={!lines.length || adGateBusy}
              style={[s.playBtn, (!lines.length || adGateBusy) && s.playBtnOff]}>
              <Text style={[s.playText, (!lines.length || adGateBusy) && { color: 'rgba(255,255,255,0.3)' }]}>▶ PLAY</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={stopPlay} style={s.stopBtn}>
              <Text style={s.stopText}>■ STOP</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { setLines([]); setSelectedLineIndex(null); stopPlay(); resetView(); }} style={s.clearBtn}>
            <Text style={{ fontSize: 14 }}>🗑</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!playing && tool === 'preset' && (
        <View style={s.presetBar}>
          {PRESET_LIBRARY.map((preset) => (
            <TouchableOpacity
              key={preset.id}
              onPress={() => setSelectedPresetId(preset.id)}
              style={[s.presetBtn, preset.id === selectedPresetId && s.presetBtnActive]}
            >
              <Text style={[s.presetLabel, preset.id === selectedPresetId && s.presetLabelActive]}>{preset.label}</Text>
            </TouchableOpacity>
          ))}
          <Text style={s.presetHint}>Tap canvas to place</Text>
        </View>
      )}

      {!playing && tool === 'edit' && (
        <View style={s.editBar}>
          <Text style={s.editStatus}>
            {selectedLineIndex == null ? 'Tap a line or preset' : `Selected ${selectedLineIndex + 1}`}
          </Text>
          <TouchableOpacity
            style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
            onPress={() => transformSelectedLine(-15, 1)}
            disabled={selectedLineIndex == null}
          >
            <Text style={s.presetAdjustText}>⟲</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
            onPress={() => transformSelectedLine(15, 1)}
            disabled={selectedLineIndex == null}
          >
            <Text style={s.presetAdjustText}>⟳</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
            onPress={() => transformSelectedLine(0, 0.88)}
            disabled={selectedLineIndex == null}
          >
            <Text style={s.presetAdjustText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
            onPress={() => transformSelectedLine(0, 1.14)}
            disabled={selectedLineIndex == null}
          >
            <Text style={s.presetAdjustText}>+</Text>
          </TouchableOpacity>
          <View style={s.editMoveGroup}>
            <TouchableOpacity
              style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
              onPress={() => moveSelectedLine(0, -EDIT_NUDGE_STEP)}
              disabled={selectedLineIndex == null}
            >
              <Text style={s.presetAdjustText}>↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
              onPress={() => moveSelectedLine(-EDIT_NUDGE_STEP, 0)}
              disabled={selectedLineIndex == null}
            >
              <Text style={s.presetAdjustText}>←</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
              onPress={() => moveSelectedLine(EDIT_NUDGE_STEP, 0)}
              disabled={selectedLineIndex == null}
            >
              <Text style={s.presetAdjustText}>→</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
              onPress={() => moveSelectedLine(0, EDIT_NUDGE_STEP)}
              disabled={selectedLineIndex == null}
            >
              <Text style={s.presetAdjustText}>↓</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[s.presetAdjustBtn, selectedLineIndex == null && s.editBtnDisabled]}
            onPress={deleteSelectedLine}
            disabled={selectedLineIndex == null}
          >
            <Text style={s.presetAdjustText}>⌫</Text>
          </TouchableOpacity>
        </View>
      )}

      {!playing && tool === 'draw' && (
        <View style={s.lineTypeBar}>
          {DRAW_LINE_TYPES.map((lt) => (
            <TouchableOpacity
              key={lt.id}
              onPress={() => setLineStyle(lt.id)}
              style={[s.lineTypeBtn, lineStyle === lt.id && s.lineTypeBtnActive]}
            >
              <View style={[s.lineTypeSwatch, { backgroundColor: lt.color }]} />
              <Text style={[s.lineTypeText, lineStyle === lt.id && s.lineTypeTextActive]}>{lt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Canvas */}
      <GestureDetector gesture={composedGesture}>
        <View
          style={s.canvas}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width && height && (width !== canvasSize.width || height !== canvasSize.height)) {
              setCanvasSize({ width, height });
            }
          }}
        >
          <Svg width={canvasSize.width} height={canvasSize.height} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#0a0a1a" />
                <Stop offset="1" stopColor="#1a1a2e" />
              </LinearGradient>
              <RadialGradient id="portalHaze" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#12001d" stopOpacity="0.92" />
                <Stop offset="0.36" stopColor="#7d2cff" stopOpacity="0.48" />
                <Stop offset="0.68" stopColor="#ff58d2" stopOpacity="0.2" />
                <Stop offset="1" stopColor="#2b074d" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={canvasSize.width} height={canvasSize.height} fill="url(#bg)" />

            <G translateX={cam.x} translateY={cam.y} scale={cam.zoom}>
              {/* Track */}
              {lines.map((line, idx) => {
                const cfg = lineTypeConfig(lineType(line));
                const pts = linePoints(line);
                const isSelected = !playing && tool === 'edit' && idx === selectedLineIndex;
                if (cfg.special === 'portal') {
                  const mid = pts.length >= 2
                    ? { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 }
                    : pts[0];
                  if (!mid) return null;
                  const portalAngle = pts.length >= 2
                    ? Math.atan2(pts[pts.length - 1].y - pts[0].y, pts[pts.length - 1].x - pts[0].x) * (180 / Math.PI) - 90
                    : 0;
                  const swirlA = `M${mid.x - 8},${mid.y - 32} C${mid.x + 21},${mid.y - 24} ${mid.x + 18},${mid.y + 22} ${mid.x - 7},${mid.y + 31}`;
                  const swirlB = `M${mid.x + 7},${mid.y - 34} C${mid.x - 19},${mid.y - 20} ${mid.x - 20},${mid.y + 20} ${mid.x + 8},${mid.y + 33}`;
                  const flamePathA = `M${mid.x - 17},${mid.y + 27} C${mid.x - 31},${mid.y + 8} ${mid.x - 25},${mid.y - 26} ${mid.x - 8},${mid.y - 42}`;
                  const flamePathB = `M${mid.x + 17},${mid.y - 27} C${mid.x + 31},${mid.y - 8} ${mid.x + 25},${mid.y + 26} ${mid.x + 8},${mid.y + 42}`;
                  return (
                    <G key={idx}>
                      <G rotation={portalAngle} originX={mid.x} originY={mid.y}>
                        <Ellipse cx={mid.x} cy={mid.y} rx={30} ry={54} fill="url(#portalHaze)" />
                        {isSelected && (
                          <Ellipse cx={mid.x} cy={mid.y} rx={34} ry={59} fill="none"
                            stroke="#ffffff" strokeWidth={1.4} strokeDasharray="4 4" opacity={0.72} />
                        )}
                        <Ellipse cx={mid.x} cy={mid.y} rx={21} ry={45} fill="#080013" opacity={0.78} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={21} ry={45} fill="none" stroke="#3f14ff"
                          strokeWidth={11} opacity={0.42} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={14} ry={38} fill="none" stroke="#ff67d8"
                          strokeWidth={6.4} opacity={0.96} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={8} ry={27} fill="none" stroke="#b777ff"
                          strokeWidth={2.2} opacity={0.72} />
                        <Path d={swirlA} stroke="#7f43ff" strokeWidth={2.4}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.78} />
                        <Path d={swirlB} stroke="#ff9bde" strokeWidth={1.9}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.7} />
                        <Path d={flamePathA} stroke="#b53cff" strokeWidth={4.8}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.84} />
                        <Path d={flamePathB} stroke="#ff9b3d" strokeWidth={2.7}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={4.5} ry={17} fill="rgba(136,42,255,0.32)"
                          stroke="#ffd0f4" strokeWidth={1.4} opacity={0.88} />
                        <Circle cx={mid.x - 13} cy={mid.y - 34} r={2.3} fill="#ffd0f4" opacity={0.8} />
                        <Circle cx={mid.x + 14} cy={mid.y + 35} r={1.9} fill="#ff9b3d" opacity={0.72} />
                      </G>
                      <Circle cx={mid.x} cy={mid.y} r={4.5} fill="#fff1ff" opacity={0.72} />
                    </G>
                  );
                }
                if (cfg.special === 'trampoline') {
                  return (
                    <React.Fragment key={idx}>
                      {isSelected && (
                        <Path d={pointsToPath(pts)} stroke="#ffffff"
                          strokeWidth={TRACK_WIDTH + 14} strokeLinecap="round" strokeLinejoin="round" fill="none"
                          strokeDasharray="5 5" opacity={0.42} />
                      )}
                      <Path d={pointsToPath(pts)} stroke={cfg.glow}
                        strokeWidth={TRACK_WIDTH + 9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <Path d={pointsToPath(pts)} stroke="#ffd08f"
                        strokeWidth={TRACK_WIDTH + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <Path d={pointsToPath(pts)} stroke={cfg.color}
                        strokeWidth={TRACK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </React.Fragment>
                  );
                }
                return (
                <React.Fragment key={idx}>
                  {isSelected && (
                    <Path d={pointsToPath(pts)} stroke="#ffffff"
                      strokeWidth={TRACK_WIDTH + 10} strokeLinecap="round" strokeLinejoin="round" fill="none"
                      strokeDasharray="5 5" opacity={0.38} />
                  )}
                  <Path d={pointsToPath(pts)} stroke={cfg.glow}
                    strokeWidth={TRACK_WIDTH + 6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <Path d={pointsToPath(pts)} stroke={cfg.color}
                    strokeWidth={TRACK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </React.Fragment>
              );
              })}

              {/* Current stroke */}
              {currentStroke.length > 1 && (
                <Path d={pointsToPath(currentStroke)} stroke="rgba(0,255,200,0.5)"
                  strokeWidth={TRACK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              )}

              {/* Trail */}
              {trail.length > 1 && (
                <Path d={pointsToPath(trail)} stroke="rgba(255,100,50,0.4)"
                  strokeWidth={2} fill="none" strokeLinecap="round" />
              )}

              {/* Start flag */}
              {startX !== null && !playing && (
                <G translateX={startX} translateY={startY - RIDER_RADIUS - 2}>
                  <Circle r={10} fill="rgba(255,100,50,0.3)" />
                  <Circle r={5} fill="#ff6432" />
                  <Line x1={0} y1={0} x2={0} y2={-25} stroke="#ff3366" strokeWidth={2} />
                  <Polygon points="0,-25 13,-20 0,-15" fill="#ff3366" />
                </G>
              )}

              {/* Rider */}
              {rider && !rider.crashed && (
                <G translateX={rider.x} translateY={rider.y} rotation={rAngle}>
                  {renderCharacterSprite(rider.riderTypeId || activeRiderId, currentRiderCfg, riderMotion)}
                </G>
              )}

              {/* Crash particles */}
              {rider && rider.crashed && (
                <G translateX={rider.x} translateY={rider.y}>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                    const a = (i / 8) * Math.PI * 2;
                    return <Circle key={i} cx={Math.cos(a) * 12} cy={Math.sin(a) * 12} r={3} fill="#ff4444" />;
                  })}
                </G>
              )}
            </G>
          </Svg>

          {/* Top controls overlay */}
          <View style={s.topCanvasRow}>
            {!playing ? (
              <View style={s.topCanvasActions}>
                <TouchableOpacity style={s.zoomBtnWide} onPress={() => setShowDemoTracks(true)}>
                  <Text style={s.zoomBtnTextSmall}>DEMOS</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.zoomBtnWide} onPress={() => setShowSaveSlots(true)}>
                  <Text style={s.zoomBtnTextSmall}>SAVES</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.zoomBtnWide, tool === 'edit' && s.quickEditBtnActive]}
                  onPress={() => setTool('edit')}
                >
                  <Text style={[s.zoomBtnTextSmall, tool === 'edit' && s.quickEditTextActive]}>EDIT</Text>
                </TouchableOpacity>
              </View>
            ) : <View />}

            <View style={s.zoomBar}>
              <TouchableOpacity style={s.zoomBtn} onPress={() => {
                const c = camRef.current;
                const nz = Math.min(MAX_ZOOM, c.zoom * 1.3);
                const cx = canvasSize.width / 2, cy = canvasSize.height / 2;
                const r = nz / c.zoom;
                c.x = cx - r * (cx - c.x); c.y = cy - r * (cy - c.y); c.zoom = nz;
                setCam({ ...c });
              }}>
                <Text style={s.zoomBtnText}>+</Text>
              </TouchableOpacity>
              <Text style={s.zoomPct}>{zoomPct}%</Text>
              <TouchableOpacity style={s.zoomBtn} onPress={() => {
                const c = camRef.current;
                const nz = Math.max(MIN_ZOOM, c.zoom * 0.75);
                const cx = canvasSize.width / 2, cy = canvasSize.height / 2;
                const r = nz / c.zoom;
                c.x = cx - r * (cx - c.x); c.y = cy - r * (cy - c.y); c.zoom = nz;
                setCam({ ...c });
              }}>
                <Text style={s.zoomBtnText}>−</Text>
              </TouchableOpacity>
              <View style={s.zoomDivider} />
              <TouchableOpacity style={s.zoomBtn} onPress={resetView}>
                <Text style={s.zoomBtnText}>⟳</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.zoomBtn} onPress={fitTrackInView} disabled={!lines.length}>
                <Text style={[s.zoomBtnText, !lines.length && s.zoomBtnTextDisabled]}>□</Text>
              </TouchableOpacity>
            </View>
          </View>

          {minimap && (
            <GestureDetector gesture={minimapTapGesture}>
              <View style={s.minimapWrap}>
                <Svg width={MINIMAP_W} height={MINIMAP_H}>
                  <Rect x={0} y={0} width={MINIMAP_W} height={MINIMAP_H} fill="rgba(8,8,18,0.9)" />
                  {lines.map((line, idx) => {
                    const cfg = lineTypeConfig(lineType(line));
                    const miniPts = linePoints(line).map((p) => toMini(p.x, p.y));
                    return (
                      <Path
                        key={`mini-${idx}`}
                        d={pointsToPath(miniPts)}
                        stroke={cfg.color}
                        strokeWidth={1.6}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                  {(() => {
                    const left = toMini((-cam.x) / cam.zoom, (-cam.y) / cam.zoom);
                    const right = toMini((canvasSize.width - cam.x) / cam.zoom, (canvasSize.height - cam.y) / cam.zoom);
                    const x = Math.min(left.x, right.x);
                    const y = Math.min(left.y, right.y);
                    const w = Math.max(4, Math.abs(right.x - left.x));
                    const h = Math.max(4, Math.abs(right.y - left.y));
                    return <Rect x={x} y={y} width={w} height={h} fill="none" stroke="#ffffff" strokeWidth={1} />;
                  })()}
                </Svg>
                <Text style={s.minimapHint}>Tap to jump</Text>
              </View>
            </GestureDetector>
          )}

          {/* Hint */}
          {!playing && lines.length === 0 && (
            <View style={s.emptyState} pointerEvents="none">
              <Text style={{ fontSize: 40, marginBottom: 8 }}>⛷</Text>
              <Text style={s.emptyText}>Draw a track with your finger</Text>
              <Text style={s.emptySubtext}>Two fingers to pan &amp; pinch-zoom</Text>
              <Text style={s.emptySubtext}>Then press PLAY!</Text>
            </View>
          )}

          {/* Crash overlay */}
          {crashed && (
            <View style={s.crashOverlay}>
              <Text style={s.crashText}>{crashReason === 'stalled' ? 'STALLED OUT!' : 'WIPEOUT!'}</Text>
              <TouchableOpacity onPress={stopPlay} style={s.retryBtn}>
                <Text style={s.retryText}>TRY AGAIN</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* HUD */}
          {playing && rider && !rider.crashed && (
            <View style={s.hud}>
              <Text style={s.hudText}>SPD: {Math.round(Math.hypot(rider.vx || 0, rider.vy || 0) * 10)}</Text>
              <Text style={[s.hudText, { color: rider.onGround ? '#00ffc8' : '#ff6432' }]}>
                {rider.onGround ? '● GND' : '○ AIR'}
              </Text>
              <Text style={s.hudText}>{zoomPct}%</Text>
            </View>
          )}

          {CHARACTER_SHOP_ENABLED && !playing && (
            <TouchableOpacity
              style={s.charactersFab}
              onPress={() => setShowCharacterShop(true)}
            >
              <Text style={s.charactersFabText}>Characters</Text>
            </TouchableOpacity>
          )}
        </View>
      </GestureDetector>

      <Modal
        visible={showSaveSlots}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSaveSlots(false)}
      >
        <View style={s.shopBackdrop}>
          <View style={s.shopSheet}>
            <View style={s.shopHeader}>
              <View>
                <Text style={s.shopTitle}>Saved Tracks</Text>
                <Text style={s.shopSubtitle}>Three local slots on this device</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSaveSlots(false)} style={s.shopCloseBtn}>
                <Text style={s.shopCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.shopList}>
              {savedTrackSlots.map((slot, index) => (
                <View key={`slot-${index}`} style={s.saveSlotCard}>
                  <View style={s.saveSlotMeta}>
                    <Text style={s.saveSlotTitle}>Slot {index + 1}</Text>
                    <TextInput
                      value={saveSlotNames[index]}
                      onChangeText={(value) => updateSaveSlotName(index, value)}
                      placeholder={`Track ${index + 1}`}
                      placeholderTextColor="rgba(223,247,255,0.35)"
                      style={s.saveSlotInput}
                      maxLength={28}
                    />
                    <Text style={s.saveSlotSubtitle}>
                      {slot
                        ? `${slot.lineCount} lines • ${slot.pointCount} pts • ${new Date(slot.savedAt).toLocaleDateString()}`
                        : 'Empty slot'}
                    </Text>
                  </View>
                  <View style={s.saveSlotActions}>
                    <TouchableOpacity style={s.saveSlotBtn} onPress={() => saveTrackToSlot(index)}>
                      <Text style={s.saveSlotBtnText}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.saveSlotBtn, !slot && s.saveSlotBtnDisabled]}
                      onPress={() => loadTrackFromSlot(index)}
                      disabled={!slot}
                    >
                      <Text style={[s.saveSlotBtnText, !slot && s.saveSlotBtnTextDisabled]}>Load</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showDemoTracks}
        animationType="slide"
        transparent
        onRequestClose={() => setShowDemoTracks(false)}
      >
        <View style={s.shopBackdrop}>
          <View style={s.shopSheet}>
            <View style={s.shopHeader}>
              <View>
                <Text style={s.shopTitle}>Demo Tracks</Text>
                <Text style={s.shopSubtitle}>Curated runs you can load and ride instantly</Text>
              </View>
              <TouchableOpacity onPress={() => setShowDemoTracks(false)} style={s.shopCloseBtn}>
                <Text style={s.shopCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={s.shopList}>
              {demoTracks.map((demoTrack) => {
                const previewPaths = buildPreviewPaths(demoTrack.lines, 120, 70, 8);
                const recommended = riderConfig(demoTrack.recommendedRiderId).name;
                return (
                  <View key={demoTrack.id} style={s.demoCard}>
                    <View style={s.demoPreviewWrap}>
                      <Svg width={120} height={70}>
                        <Rect x={0} y={0} width={120} height={70} rx={10} fill="rgba(9,14,28,0.95)" />
                        {previewPaths.map((entry, index) => {
                          const cfg = lineTypeConfig(entry.type);
                          return (
                            <Path
                              key={`${demoTrack.id}-preview-${index}`}
                              d={entry.d}
                              stroke={cfg.color}
                              strokeWidth={2.1}
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          );
                        })}
                      </Svg>
                    </View>

                    <View style={s.demoMeta}>
                      <View style={s.demoHeaderRow}>
                        <Text style={s.demoTitle}>{demoTrack.name}</Text>
                        <Text style={s.demoDifficulty}>{demoTrack.difficulty}</Text>
                      </View>
                      <Text style={s.demoDescription}>{demoTrack.description}</Text>
                      <Text style={s.demoSubline}>Recommended: {recommended}</Text>
                    </View>

                    <TouchableOpacity style={s.demoLoadBtn} onPress={() => loadDemoTrack(demoTrack)}>
                      <Text style={s.demoLoadBtnText}>Load</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {CHARACTER_SHOP_ENABLED && (
        <Modal
          visible={showCharacterShop}
          animationType="slide"
          transparent
          onRequestClose={() => setShowCharacterShop(false)}
        >
          <View style={s.shopBackdrop}>
            <View style={s.shopSheet}>
              <View style={s.shopHeader}>
                <View>
                  <Text style={s.shopTitle}>Character Shop</Text>
                  <Text style={s.shopSubtitle}>Choose who rides next</Text>
                </View>
                <TouchableOpacity onPress={() => setShowCharacterShop(false)} style={s.shopCloseBtn}>
                  <Text style={s.shopCloseText}>Done</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={restoreRiderPurchases}>
                <Text style={s.restoreLink}>Restore Purchases</Text>
              </TouchableOpacity>

              <ScrollView contentContainerStyle={s.shopList}>
                {RIDER_TYPES.map((rt) => {
                  const owned = ownedRiders.includes(rt.id);
                  const active = activeRiderId === rt.id;
                  return (
                    <TouchableOpacity
                      key={rt.id}
                      style={[s.riderCard, s.shopCard, active && s.riderCardActive]}
                      onPress={() => activateOrPurchaseRider(rt.id)}
                      disabled={purchaseBusyId === rt.id}
                    >
                      <View style={s.shopMedia}>
                        <View style={[s.shopImageBadge, { borderColor: rt.color, backgroundColor: `${rt.color}22` }]}>
                          <Text style={s.shopIcon}>{rt.icon || '⛷'}</Text>
                        </View>
                      </View>

                      <View style={s.shopDetails}>
                        <Text style={[s.riderName, active && s.riderNameActive]}>{rt.name}</Text>
                        <Text style={s.shopBlurb}>{rt.blurb}</Text>
                        <Text style={s.riderMeta}>TOP {rt.topSpeed} • LAUNCH {rt.launchSpeed.toFixed(1)}</Text>
                        <Text style={s.riderPrice}>
                          {owned
                            ? (active ? 'Selected' : 'Owned')
                            : (purchaseBusyId === rt.id ? 'Purchasing...' : (storePrices[rt.productId] || '$1.00'))}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={s.debugPanel}>
                <Text style={s.debugTitle}>IAP Debug</Text>
                <Text style={s.debugText}>Store: {storeReady ? '✓ Ready' : '⊗ Offline'}</Text>
                <Text style={s.debugText}>Active: {activeRiderCfg.name}</Text>
                <Text style={s.debugText}>Owned: {ownedRiders.join(', ') || 'none'}</Text>
                {Object.keys(paymentLedger).length > 0 && (
                  <Text style={s.debugText}>
                    Ledger: {Object.entries(paymentLedger)
                      .slice(-2)
                      .map(([id, tx]) => `${id}#${(tx.transactionId || 'pending').slice(-4)}`)
                      .join(' | ')}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a',
    paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight || 30 },
  header: { paddingHorizontal: 14, paddingBottom: 4 },
  title: { fontSize: 17, fontWeight: '900', color: '#00ffc8', letterSpacing: 2 },
  subtitle: { fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: 1 },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,255,200,0.15)' },
  toolGroup: { flexDirection: 'row', gap: 5 },
  toolGroupLeft: { flexShrink: 1, flexWrap: 'wrap', rowGap: 4, marginRight: 6 },
  toolGroupRight: { flexShrink: 0, flexDirection: 'row', gap: 5 },
  toolBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)', gap: 4 },
  secondaryBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5,
    borderColor: 'rgba(124,226,255,0.3)', backgroundColor: 'rgba(124,226,255,0.08)' },
  secondaryBtnText: { color: '#dff7ff', fontWeight: '800', fontSize: 10, letterSpacing: 0.6 },
  toolBtnActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.12)' },
  toolLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  toolLabelActive: { color: '#00ffc8' },
  presetBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  presetBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)' },
  presetBtnActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.12)' },
  presetLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' },
  presetLabelActive: { color: '#00ffc8' },
  presetAdjustGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  presetAdjustBtn: { width: 22, height: 22, borderRadius: 5, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  presetAdjustText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
  presetValue: { color: 'rgba(255,255,255,0.65)', fontSize: 10, minWidth: 28, textAlign: 'center' },
  presetHint: { marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 11 },
  editBar: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  editStatus: { flex: 1, color: 'rgba(223,247,255,0.58)', fontSize: 11, fontWeight: '700' },
  editMoveGroup: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editBtnDisabled: { opacity: 0.35 },
  shopBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,14,0.75)', justifyContent: 'flex-end' },
  shopSheet: { backgroundColor: '#101626', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    borderWidth: 1, borderColor: 'rgba(124,226,255,0.2)', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12,
    maxHeight: '82%' },
  shopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  shopTitle: { color: '#dff7ff', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
  shopSubtitle: { color: 'rgba(223,247,255,0.55)', fontSize: 11, marginTop: 2 },
  shopCloseBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.07)' },
  shopCloseText: { color: '#dff7ff', fontSize: 12, fontWeight: '800' },
  shopList: { gap: 8, paddingVertical: 8 },
  saveSlotCard: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 12, paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  saveSlotMeta: { flex: 1 },
  saveSlotTitle: { color: '#dff7ff', fontSize: 13, fontWeight: '800' },
  saveSlotInput: { marginTop: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(124,226,255,0.22)',
    backgroundColor: 'rgba(12,18,34,0.75)', color: '#dff7ff', paddingHorizontal: 9, paddingVertical: 6,
    fontSize: 12, fontWeight: '700' },
  saveSlotSubtitle: { color: 'rgba(223,247,255,0.55)', fontSize: 10, marginTop: 3 },
  saveSlotActions: { flexDirection: 'row', gap: 8 },
  saveSlotBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(124,226,255,0.32)', backgroundColor: 'rgba(124,226,255,0.08)' },
  saveSlotBtnDisabled: { borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' },
  saveSlotBtnText: { color: '#dff7ff', fontSize: 11, fontWeight: '800' },
  saveSlotBtnTextDisabled: { color: 'rgba(255,255,255,0.35)' },
  restoreLink: { color: '#7ce2ff', fontSize: 11, fontWeight: '700' },
  riderCard: { minWidth: 88, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 10, paddingVertical: 8 },
  shopCard: { minWidth: undefined },
  shopMedia: { width: 66, alignItems: 'center', justifyContent: 'center' },
  shopImageBadge: { width: 54, height: 54, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center' },
  shopDetails: { flex: 1, paddingLeft: 8 },
  shopIcon: { fontSize: 28 },
  shopBlurb: { color: 'rgba(255,255,255,0.55)', fontSize: 10, marginTop: 2, lineHeight: 14 },
  riderCardActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.12)' },
  riderName: { color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: '700' },
  riderNameActive: { color: '#00ffc8' },
  riderMeta: { color: 'rgba(255,255,255,0.38)', fontSize: 9, marginTop: 2 },
  riderPrice: { color: 'rgba(255,255,255,0.65)', fontSize: 10, marginTop: 3 },
  debugPanel: { paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(10,10,26,0.8)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,165,0,0.2)' },
  debugTitle: { color: '#ffb347', fontSize: 10, fontWeight: '900', letterSpacing: 0.5, marginBottom: 2 },
  debugText: { color: 'rgba(255,200,150,0.75)', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginVertical: 1 },
  lineTypeBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  lineTypeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: 8,
    borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.03)' },
  lineTypeBtnActive: { borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.09)' },
  lineTypeSwatch: { width: 10, height: 10, borderRadius: 5 },
  lineTypeText: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700' },
  lineTypeTextActive: { color: '#ffffff' },
  playBtn: { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 8, backgroundColor: '#00ffc8' },
  playBtnOff: { backgroundColor: 'rgba(255,255,255,0.08)' },
  playText: { color: '#0a0a1a', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  stopBtn: { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#ff3366', backgroundColor: 'rgba(255,51,102,0.15)' },
  stopText: { color: '#ff3366', fontWeight: '800', fontSize: 12 },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.04)' },
  canvas: { flex: 1, backgroundColor: '#0a0a1a' },
  // Zoom
  topCanvasRow: { position: 'absolute', top: 10, left: 10, right: 10, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between' },
  topCanvasActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoomBar: { flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10,10,26,0.9)', borderWidth: 1, borderColor: 'rgba(0,255,200,0.15)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, gap: 5 },
  zoomBtn: { width: 28, height: 28, borderRadius: 6, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center' },
  zoomBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '600' },
  zoomBtnWide: { minWidth: 58, height: 28, borderRadius: 6, borderWidth: 1,
    borderColor: 'rgba(124,226,255,0.32)', backgroundColor: 'rgba(124,226,255,0.08)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  quickEditBtnActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.14)' },
  zoomBtnTextSmall: { color: '#dff7ff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  quickEditTextActive: { color: '#00ffc8' },
  zoomBtnTextDisabled: { color: 'rgba(255,255,255,0.25)' },
  zoomPct: { color: 'rgba(255,255,255,0.5)', fontSize: 11, minWidth: 34, textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  zoomDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  minimapWrap: { position: 'absolute', bottom: 10, right: 10, borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', overflow: 'hidden',
    backgroundColor: 'rgba(10,10,26,0.92)' },
  minimapHint: { position: 'absolute', right: 6, bottom: 4, color: 'rgba(255,255,255,0.45)', fontSize: 10 },
  // Overlays
  emptyState: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.25)', fontSize: 15 },
  emptySubtext: { color: 'rgba(255,255,255,0.12)', fontSize: 12, marginTop: 3 },
  crashOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  crashText: { fontSize: 28, color: '#ff3366', fontWeight: '900', letterSpacing: 3, marginBottom: 12 },
  retryBtn: { paddingHorizontal: 22, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#ff3366', backgroundColor: 'rgba(255,51,102,0.2)' },
  retryText: { color: '#ff3366', fontWeight: '700', fontSize: 13 },
  hud: { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', gap: 12 },
  hudText: { fontSize: 11, color: 'rgba(255,255,255,0.4)',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  charactersFab: { position: 'absolute', bottom: Platform.OS === 'ios' ? 34 : 18, left: 16, zIndex: 10,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: 'rgba(16,28,58,0.94)', borderWidth: 1, borderColor: 'rgba(124,226,255,0.45)' },
  charactersFabText: { color: '#dff7ff', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  demoCard: { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(124,226,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.04)', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  demoPreviewWrap: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  demoMeta: { flex: 1 },
  demoHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  demoTitle: { color: '#dff7ff', fontSize: 13, fontWeight: '800' },
  demoDifficulty: { color: '#7ce2ff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4,
    borderWidth: 1, borderColor: 'rgba(124,226,255,0.3)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  demoDescription: { color: 'rgba(223,247,255,0.72)', fontSize: 11, marginTop: 5 },
  demoSubline: { color: 'rgba(223,247,255,0.45)', fontSize: 10, marginTop: 3 },
  demoLoadBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
    borderColor: 'rgba(0,255,200,0.45)', backgroundColor: 'rgba(0,255,200,0.14)' },
  demoLoadBtnText: { color: '#dff7ff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
