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
// Collision radius stays at the original 6 so existing/demo/saved tracks ride identically
// (a 12px collision body stalls in the "Drop off" demo's tighter dips). The rider is drawn 2x.
const RIDER_RADIUS = 6;
const RIDER_VISUAL_RADIUS = RIDER_RADIUS * 2;
const RIDER_SPRITE_SCALE = 1.5; // sprite art was drawn for radius 6; feet sit ~8px below origin
const RIDER_SPRITE_LIFT = 8 * RIDER_SPRITE_SCALE - RIDER_RADIUS; // keep scaled feet on the line
const SIM_HZ = 60; // physics always steps at 60Hz regardless of display refresh (60/120Hz ProMotion)
const SIM_DT_MS = 1000 / SIM_HZ;
const MAX_SIM_STEPS_PER_FRAME = 5; // avoid spiral-of-death after a hitch/backgrounding
const PLAY_CAM_ZOOM = 1.35;
const PLAY_CAM_LEAD = 14; // world units of look-ahead per unit of velocity
const PLAY_CAM_LEAD_MAX = 140;
const PLAY_CAM_POS_RATE = 4.5; // per-second exponential follow rate
const PLAY_CAM_ZOOM_RATE = 2.2;
// Auto zoom during play: close-in when slow, pulled back when fast / airborne / big drop ahead.
const PLAY_CAM_ZOOM_MAX = 1.6; // slow / stopped
const PLAY_CAM_ZOOM_MIN = 0.8; // at or above top speed
const PLAY_CAM_AIR_ZOOM = 0.85; // extra multiplier while airborne
const PLAY_CAM_DROP_REF = 260; // world units of drop ahead that earn the full extra pull-back
const PLAY_CAM_DROP_ZOOM = 0.8; // multiplier at a PLAY_CAM_DROP_REF drop
const PLAY_CAM_LOOKAHEAD = 320; // world units of track scanned ahead of the rider
const PLAY_CAM_USER_ZOOM_MIN = 0.5; // pinch / wheel / +- multiplier on top of auto zoom
const PLAY_CAM_USER_ZOOM_MAX = 2.0;
const PLAY_CAM_LOOK_RETURN_RATE = 3; // per-second spring-back of a two-finger look-around
const clampUserZoom = (z) => Math.max(PLAY_CAM_USER_ZOOM_MIN, Math.min(PLAY_CAM_USER_ZOOM_MAX, z));
const TRAIL_MAX_POINTS = 26;
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
  ios: 'ca-app-pub-5292803742086445/5781242654',
  android: 'ca-app-pub-xxxxxxxxxxxxxxxx/xxxxxxxxxx',
};
const CHARACTER_SHOP_ENABLED = true;
const RIDER_FALLBACK_PRICE_LABEL = '$0.99';
const RIDER_STORAGE_KEY = 'phone-rider-riders-v1';
// Halloween event. null = automatic (Oct 15 – Nov 2, device local time); true/false forces it on/off.
const HALLOWEEN_FORCE = null;
function isHalloweenSeason(date = new Date()) {
  const m = date.getMonth();
  const d = date.getDate();
  return (m === 9 && d >= 15) || (m === 10 && d <= 2);
}
const HALLOWEEN_ACTIVE = HALLOWEEN_FORCE === null ? isHalloweenSeason() : !!HALLOWEEN_FORCE;
const BOOST_WEEEE_COOLDOWN_MS = 2800;
const AIR_YIPPEE_DELAY_MS = 450;
const AIR_YIPPEE_COOLDOWN_MS = 5200;

const memoryStorage = {};
let trackStorage = null;
let riderStoreApi = null;
let googleMobileAdsApi = null;

function getRiderStoreApi() {
  if (riderStoreApi) return riderStoreApi;
  if (Platform.OS === 'web') return null; // no StoreKit on web: shop renders, purchases stub out
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
    priceUsd: 0.99,
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
    priceUsd: 0.99,
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
    priceUsd: 0.99,
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
    priceUsd: 0.99,
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
    priceUsd: 0.99,
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
    priceUsd: 0.99,
    color: '#d099ff',
    accent: '#f5dcff',
    launchSpeed: 2.1,
    topSpeed: 24,
    icon: '🎪',
    blurb: 'Chaotic balancing act with sharp lean corrections.',
    motion: { pace: 1.42, bob: 1.35, sway: 1.55, suspension: 0.15, airTilt: 1.5 },
  },
  {
    id: 'hoverboard',
    name: 'Glitch Hoverboarder',
    productId: 'rider_hoverboard_1usd',
    priceUsd: 0.99,
    color: '#ff4fd8',
    accent: '#7dfcff',
    trailColor: '#ff4fd8',
    launchSpeed: 2.0,
    topSpeed: 24,
    icon: '🛹',
    blurb: 'Floats on a magenta glow deck with twin thruster sparks.',
    motion: { pace: 1.15, bob: 1.2, sway: 0.8, suspension: 0.3, airTilt: 0.9 },
  },
  {
    id: 'penguin',
    name: 'Belly-Slide Penguin',
    productId: 'rider_penguin_1usd',
    priceUsd: 0.99,
    color: '#2a3550',
    accent: '#ffb02e',
    trailColor: '#7fd6ff',
    launchSpeed: 1.9,
    topSpeed: 23.5,
    icon: '🐧',
    blurb: 'Tummy-first toboggan king. Low, slick and fearless.',
    motion: { pace: 0.9, bob: 0.5, sway: 1.1, suspension: 0.2, airTilt: 1.3 },
  },
  {
    id: 'voltbot',
    name: 'Volt Bot',
    productId: 'rider_voltbot_1usd',
    priceUsd: 0.99,
    color: '#b6ff3b',
    accent: '#3bf0ff',
    trailColor: '#b6ff3b',
    launchSpeed: 2.15,
    topSpeed: 24.5,
    icon: '🤖',
    blurb: 'One-wheel robot with a crackling antenna and steady gyro balance.',
    motion: { pace: 1.25, bob: 0.4, sway: 0.4, suspension: 1.2, airTilt: 0.4 },
  },
  {
    id: 'rocketluge',
    name: 'Rocket Luge',
    productId: 'rider_rocketluge_1usd',
    priceUsd: 0.99,
    color: '#ff3b5c',
    accent: '#ffd23b',
    trailColor: '#ffb02e',
    launchSpeed: 2.4,
    topSpeed: 25.5,
    icon: '🚀',
    blurb: 'Feet-first luge strapped to a rocket. Fastest launch in the lineup.',
    motion: { pace: 1.4, bob: 0.3, sway: 0.3, suspension: 0.6, airTilt: 0.35 },
  },
  {
    id: 'ghost',
    name: 'Neon Ghost',
    productId: 'rider_ghost_1usd',
    priceUsd: 0.99,
    color: '#c9b8ff',
    accent: '#ffffff',
    trailColor: '#c9b8ff',
    launchSpeed: 1.85,
    topSpeed: 23,
    icon: '👻',
    blurb: 'A friendly phantom that drifts through the air with a wavy tail.',
    motion: { pace: 0.8, bob: 1.6, sway: 1.4, suspension: 0.1, airTilt: 1.2 },
  },
  {
    id: 'skater',
    name: 'Retro Skater',
    productId: 'rider_skater_1usd',
    priceUsd: 0.99,
    color: '#ffd23b',
    accent: '#ff4f7b',
    trailColor: '#ffd23b',
    launchSpeed: 2.05,
    topSpeed: 24,
    icon: '🧢',
    blurb: 'Backwards cap, pink deck and a classic low crouch.',
    motion: { pace: 1.1, bob: 0.9, sway: 1.0, suspension: 0.5, airTilt: 0.8 },
  },
  {
    id: 'pumpkinhead',
    name: 'Pumpkin Rider',
    productId: 'rider_pumpkinhead_1usd',
    priceUsd: 0.99,
    seasonal: 'halloween',
    color: '#ff8a1e',
    accent: '#7a3fd0',
    trailColor: '#ff8a1e',
    launchSpeed: 1.95,
    topSpeed: 23,
    icon: '🎃',
    blurb: 'A grinning jack-o-lantern on a straw broom. Free during Halloween.',
    motion: { pace: 0.9, bob: 1.2, sway: 1.2, suspension: 0.2, airTilt: 1.0 },
  },
  {
    id: 'skeleton',
    name: 'Bone Sledder',
    productId: 'rider_skeleton_1usd',
    priceUsd: 0.99,
    seasonal: 'halloween',
    color: '#7dff5a',
    accent: '#9b4dff',
    trailColor: '#7dff5a',
    launchSpeed: 2.0,
    topSpeed: 24,
    icon: '💀',
    blurb: 'A rattling skeleton on a bone-runner sled. Free during Halloween.',
    motion: { pace: 1.1, bob: 0.7, sway: 0.9, suspension: 0.5, airTilt: 0.7 },
  },
  {
    id: 'danceskeleton',
    name: 'Dancing Skeleton',
    productId: 'rider_danceskeleton_1usd',
    priceUsd: 0.99,
    seasonal: 'halloween',
    color: '#e8ffd8',
    accent: '#b6ff3d',
    trailColor: '#d8ffc4',
    launchSpeed: 2.0,
    topSpeed: 24,
    icon: '🕺',
    blurb: 'A top-hatted skeleton that never stops dancing on its glow board. Free during Halloween.',
    motion: { pace: 1, bob: 0.5, sway: 0.5, suspension: 0.4, airTilt: 0.8 },
    dances: true,
  },
  {
    id: 'witch',
    name: 'Moon Witch',
    productId: 'rider_witch_1usd',
    priceUsd: 0.99,
    seasonal: 'halloween',
    color: '#9b4dff',
    accent: '#7dff5a',
    trailColor: '#b26bff',
    launchSpeed: 1.9,
    topSpeed: 23,
    icon: '🧙',
    blurb: 'Pointy hat, green grin and a broomstick that loves big air. Free during Halloween.',
    motion: { pace: 0.85, bob: 1.4, sway: 1.3, suspension: 0.15, airTilt: 1.1 },
  },
  {
    id: 'batglider',
    name: 'Vampire Glider',
    productId: 'rider_batglider_1usd',
    priceUsd: 0.99,
    seasonal: 'halloween',
    color: '#6a2bb8',
    accent: '#d8203f',
    trailColor: '#c23cff',
    launchSpeed: 1.95,
    topSpeed: 24,
    icon: '🦇',
    blurb: 'A caped vampire under bat-wing sails, riding a coffin board. Free during Halloween.',
    motion: { pace: 0.8, bob: 1.5, sway: 1.4, suspension: 0.2, airTilt: 1.2 },
  },
];

const HALLOWEEN_RIDER_IDS = RIDER_TYPES.filter((r) => r.seasonal === 'halloween').map((r) => r.id);
// During the event the Halloween riders are free (granted on launch), whether or not the shop is on.
const DEFAULT_OWNED_RIDERS = ['classic', 'snowboarder', 'sled', ...(HALLOWEEN_ACTIVE ? HALLOWEEN_RIDER_IDS : [])];

const LINE_TYPES = [
  { id: 'normal', label: 'Normal', color: '#7ce2ff', glow: 'rgba(124,226,255,0.2)', speedMult: 1,   speedDrag: 0,      collidable: true },
  { id: 'boost', label: 'Boost', color: '#31ff79', glow: 'rgba(49,255,121,0.24)', speedMult: 1.14, speedDrag: 0.05,   collidable: true },
  { id: 'brake', label: 'Brake', color: '#ffd64d', glow: 'rgba(255,214,77,0.24)', speedMult: 0.84, speedDrag: -0.02,  collidable: true },
  { id: 'scenery', label: 'Scenery', color: '#b58cff', glow: 'rgba(181,140,255,0.18)', speedMult: 1, speedDrag: 0,      collidable: false },
  { id: 'portal', label: 'Portal', color: '#ff67d8', glow: 'rgba(255,103,216,0.25)', speedMult: 1, speedDrag: 0, collidable: false, special: 'portal' },
  { id: 'trampoline', label: 'Trampoline', color: '#ff8e3c', glow: 'rgba(255,142,60,0.24)', speedMult: 1.04, speedDrag: 0.02, collidable: true, special: 'trampoline' },
  // Halloween styles: slime rides like a slightly sticky normal line; cobweb is non-collidable scenery.
  { id: 'slime', label: 'Slime', color: '#7dff5a', glow: 'rgba(125,255,90,0.26)', speedMult: 0.96, speedDrag: -0.01, collidable: true, seasonal: 'halloween', skin: 'slime' },
  { id: 'cobweb', label: 'Cobweb', color: '#d9d4ea', glow: 'rgba(217,212,234,0.12)', speedMult: 1, speedDrag: 0, collidable: false, seasonal: 'halloween', skin: 'cobweb' },
];
const DRAW_LINE_TYPES = LINE_TYPES.filter((lineTypeEntry) => !lineTypeEntry.special && (!lineTypeEntry.seasonal || HALLOWEEN_ACTIVE));
// Portal colours; the Halloween skin swaps the pink/violet vortex for slime green and witch purple.
const PORTAL_SKIN = HALLOWEEN_ACTIVE
  ? { ring: '#2a0b4a', main: '#7dff5a', inner: '#c58bff', swirlA: '#9b4dff', swirlB: '#c6ff9b', flameA: '#9b4dff', flameB: '#ff8a1e', core: 'rgba(125,255,90,0.3)', coreStroke: '#eaffd8', dotA: '#c6ff9b', dotB: '#ff8a1e', center: '#f4ffe8' }
  : { ring: '#3f14ff', main: '#ff67d8', inner: '#b777ff', swirlA: '#7f43ff', swirlB: '#ff9bde', flameA: '#b53cff', flameB: '#ff9b3d', core: 'rgba(136,42,255,0.32)', coreStroke: '#ffd0f4', dotA: '#ffd0f4', dotB: '#ff9b3d', center: '#fff1ff' };

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

// Premade pieces (generated + ride-tested offline). Local coords: jumps enter at (0,0) heading +x; scenery sits on (0,0).
const PIECE_DATA = [
  { id: 'kicker', label: 'Small Kicker', category: 'jump', icon: '⤴', lines: [
    ['boost', [0,0,140,6]],
    ['normal', [140,6,200,6,211.7,5.7,222.8,5,233.3,3.7,243.2,1.8,252.5,-0.5,261.2,-3.4,269.3,-6.7,276.8,-10.6,283.7,-15.1,290,-20]],
    ['normal', [610,-46,646.2,-42.8,682.3,-38.9,718.4,-34.1,754.4,-28.5,790.3,-22.1,826.1,-14.9,861.8,-6.8,897.5,2,933.1,11.7,968.6,22.1,1004,33.4,1039.4,45.5,1074.6,58.4,1109.8,72.1,1145,86.7,1180,102,1380,110]],
  ] },
  { id: 'bigramp', label: 'Big Ramp Jump', category: 'jump', icon: '🚀', lines: [
    ['boost', [0,0,140,6]],
    ['normal', [140,6,180,6,201.1,5.5,221.1,4.1,240,1.6,257.8,-1.8,274.4,-6.2,290,-11.5,304.4,-17.8,317.8,-25.1,330,-33.4,341.1,-42.6,351.1,-52.8,360,-64]],
    ['normal', [540,-34,560,-25.8,580,-17.9,600,-10.2,620,-2.9,640,4.2,660,11,680,17.5,700,23.8,720,29.8,740,35.4,760,40.9,780,46,1040,56]],
  ] },
  { id: 'gap', label: 'Gap Jump', category: 'jump', icon: '↔', lines: [
    ['boost', [0,0,140,6]],
    ['normal', [140,6,220,6,233.6,5.7,246.4,4.6,258.4,2.9,269.6,0.6,280,-2.5,289.6,-6.2,298.4,-10.7,306.4,-15.8,313.6,-21.5,320,-28]],
    ['normal', [470,-24,500,-24,535.1,-23.5,570.3,-22,605.7,-19.6,641.3,-16.1,677,-11.7,712.8,-6.3,748.8,0.1,785,7.5,821.3,15.9,857.8,25.2,894.5,35.6,931.3,46.9,968.2,59.2,1005.3,72.5,1042.6,86.7,1080,102,1280,110]],
  ] },
  { id: 'quarterpipe', label: 'Quarter Pipe', category: 'jump', icon: '◜', lines: [
    ['boost', [0,0,140,6]],
    ['normal', [140,6,200,6,215.7,5.1,231.2,2.5,246.2,-1.9,260.7,-7.9,274.5,-15.5,287.3,-24.5,299,-35,309.5,-46.7,318.5,-59.5,326.1,-73.3,332.1,-87.8,336.5,-102.8,339.1,-118.3,340,-134,340,-194]],
  ] },
  { id: 'halfpipe', label: 'Half Pipe', category: 'jump', icon: '◡', lines: [
    ['normal', [0,0,14.2,59.1,22.3,72.8,31.9,85.4,43.1,96.7,55.5,106.5,69,114.8,83.4,121.4,98.6,126.1,114.2,129,130,130,270,130,286.4,129,302.6,125.8,318.2,120.7,333.1,113.7,347,104.8,359.6,94.2,370.8,82.1,380.4,68.7,388.2,54.2,394.1,38.8,398,22.9,399.8,6.5]],
  ] },
  { id: 'loop', label: 'Loop-de-Loop', category: 'jump', icon: '➰', lines: [
    ['boost', [0,0,4.8,0,9.7,0,14.5,0,19.3,0,24.2,0,29,0,33.8,0,38.7,0,43.5,0,48.3,0,53.2,0,58,0,62.8,0,67.7,0,72.5,0,77.3,0,82.2,0,87,0,91.8,0,96.7,0,101.5,0,106.3,0,111.2,0,116,0,120.8,0,125.7,0,130.5,0,135.3,0,140.2,0,145,0,149.8,0,154.7,0,159.5,0,164.3,0,169.2,0,174,0]],
    ['boost', [207.8,0,212.7,0,217.5,0,222.3,0,227.2,0,232,0,236.8,0,241.7,0,246.5,0,251.3,0,256.2,0,261,0,265.8,0,270.7,0,275.5,0,280.3,0,285.2,0,290,0]],
    ['boost', [290,0,301.3,0.7,312.6,-0.1,323.7,-2.3,334.5,-6.1,344.6,-11.2,353.9,-17.7,362.3,-25.4,369.5,-34.2,375.5,-44,380.1,-54.6,383.2,-65.7,384.8,-77.2,384.7,-89,382.9,-100.7,379.6,-112.2,374.6,-123.2,368.1,-133.5,360.1,-143,350.8,-151.4,340.3,-158.5,328.8,-164.3,316.4,-168.5,303.4,-171.1,290,-172,276.4,-171.1,262.8,-168.4,249.6,-164,236.8,-157.7,224.8,-149.9,213.7,-140.4,203.8,-129.5,195.3,-117.3,188.3,-104.1,183,-89.9,179.4,-75,177.8,-59.8,178,-44.3,180.2,-28.9]],
    ['boost', [190.3,0.8,198.1,14.4,207.5,27.1,218.6,38.5,231,48.3,244.5,56.6,259.1,63,274.3,67.5,290,70]],
    ['normal', [290,70,590,76]],
  ] },
  { id: 'whoops', label: 'Whoops Rollers', category: 'jump', icon: '〰', lines: [
    ['normal', [0,0,13.3,0.8,26.7,-0.7,40,-3.6,53.3,-6.5,66.7,-8,80,-7.2,93.3,-3.7,106.7,2.1,120,9.2,133.3,16.3,146.7,22.1,160,25.6,173.3,26.4,186.7,24.9,200,22,213.3,19.1,226.7,17.6,240,18.4,253.3,21.9,266.7,27.7,280,34.8,293.3,41.9,306.7,47.7,320,51.2,333.3,52,346.7,50.5,360,47.6,373.3,44.7,386.7,43.2,400,44,413.3,47.5,426.7,53.3,440,60.4,453.3,67.5,466.7,73.3,480,76.8,680,80]],
  ] },
  { id: 'stairs', label: 'Staircase Drop', category: 'jump', icon: '▙', lines: [
    ['normal', [0,0,70,0,72,28,140,28,142,56,210,56,212,84,280,84,282,112,350,112,352,140,510,144]],
  ] },
  { id: 'skijump', label: 'Ski Jump', category: 'jump', icon: '⛷', lines: [
    ['normal', [0,0,20,2.3,40,5.8,60,10.6,80,16.7,100,24,120,32.5,140,42.3,160,53.3,180,65.6,200,79.2,220,94,240,110,255.3,119.3,271.3,127.3,287.8,133.8,305,139,322.8,142.8,341.3,145.3,360.3,146.3,380,146,420,138]],
    ['normal', [428,160,466.8,173.5,505.5,188.2,544,204.1,582.4,221.2,620.8,239.6,658.9,259.2,697,280,734.9,302,772.8,325.3,810.4,349.8,848,375.5,885.5,402.4,922.8,430.6,960,460,980.6,474.2,1002.5,486.9,1025.6,498,1050,507.5,1075.6,515.5,1102.5,521.9,1130.6,526.7,1160,530,1400,536]],
  ] },
  { id: 'boostrun', label: 'Boost Runway', category: 'jump', icon: '⚡', lines: [
    ['boost', [0,0,200,4,400,8,560,12]],
  ] },
  { id: 'trampad', label: 'Trampoline Pad', category: 'jump', icon: '🟣', lines: [
    ['normal', [0,0,80,4]],
    ['trampoline', [100,40,240,100]],
    ['normal', [300,0,340,2,359.8,3.8,379.2,6.1,398.2,8.8,416.8,11.9,435,15.5,452.8,19.5,470.2,24,487.2,28.9,503.8,34.2,520,40,720,46]],
  ] },
  { id: 'portalgate', label: 'Portal Gate', category: 'jump', icon: '🌀', lines: [
    ['normal', [0,0,220,6]],
    ['portal', [170,-60,170,-4]],
  ] },
  { id: 'tree', label: 'Pine Tree', category: 'scenery', icon: '🌲', lines: [
    ['scenery', [0,0,0,-20]],
    ['scenery', [-24,-20,0,-80,24,-20,-24,-20]],
    ['scenery', [-18,-46,0,-96,18,-46]],
  ] },
  { id: 'rock', label: 'Rock', category: 'scenery', icon: '🪨', lines: [
    ['scenery', [-34,0,-30,-16,-14,-28,8,-26,26,-14,34,0,-34,0]],
  ] },
  { id: 'flag', label: 'Finish Banner', category: 'scenery', icon: '🏁', lines: [
    ['scenery', [-60,0,-60,-90]],
    ['scenery', [60,0,60,-90]],
    ['scenery', [-60,-90,60,-90,60,-66,-60,-66,-60,-90]],
    ['scenery', [-40,-90,-40,-66]],
    ['scenery', [-20,-90,-20,-66]],
    ['scenery', [0,-90,0,-66]],
    ['scenery', [20,-90,20,-66]],
    ['scenery', [40,-90,40,-66]],
  ] },
  { id: 'pumpkins', label: 'Pumpkin Patch', category: 'scenery', icon: '🎃', lines: [
    ['scenery', [-24,-12,-25.2,-16.6,-28.7,-20.5,-33.9,-23.1,-40,-24,-46.1,-23.1,-51.3,-20.5,-54.8,-16.6,-56,-12,-54.8,-7.4,-51.3,-3.5,-46.1,-0.9,-40,0,-33.9,-0.9,-28.7,-3.5,-25.2,-7.4,-24,-12]],
    ['scenery', [-40,-24,-38,-32]],
    ['scenery', [16,-12,14.8,-16.6,11.3,-20.5,6.1,-23.1,0,-24,-6.1,-23.1,-11.3,-20.5,-14.8,-16.6,-16,-12,-14.8,-7.4,-11.3,-3.5,-6.1,-0.9,0,0,6.1,-0.9,11.3,-3.5,14.8,-7.4,16,-12]],
    ['scenery', [0,-24,2,-32]],
    ['scenery', [56,-12,54.8,-16.6,51.3,-20.5,46.1,-23.1,40,-24,33.9,-23.1,28.7,-20.5,25.2,-16.6,24,-12,25.2,-7.4,28.7,-3.5,33.9,-0.9,40,0,46.1,-0.9,51.3,-3.5,54.8,-7.4,56,-12]],
    ['scenery', [40,-24,42,-32]],
  ] },
  { id: 'tombstone', label: 'Tombstone', category: 'scenery', icon: '🪦', lines: [
    ['scenery', [-18,0,-18,-30,-14.6,-40.6,-10.6,-44.6,-5.6,-47.1,0,-48,5.6,-47.1,10.6,-44.6,14.6,-40.6,17.1,-35.6,18,-30,-18,0]],
    ['scenery', [0,-44,0,-22]],
    ['scenery', [-8,-36,8,-36]],
  ] },
];
const PIECE_LIBRARY = [
  ...PRESET_LIBRARY.map((preset) => ({ ...preset, category: 'jump', anchor: 'center', icon: preset.id === 'portal' ? '🌀' : '🟣',
    lines: [{ type: preset.type, points: preset.points }] })),
  ...PIECE_DATA.map((piece) => ({ ...piece, anchor: 'entry',
    lines: piece.lines.map(([type, flat]) => ({
      type,
      points: Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[i * 2], y: flat[i * 2 + 1] })),
    })) })),
];
const PIECE_CATEGORIES = [{ id: 'jump', label: 'Jumps & Features' }, { id: 'scenery', label: 'Scenery' }];
const lineColorFor = (type) => (LINE_TYPES.find((entry) => entry.id === type) || LINE_TYPES[0]).color;

function PiecePreview({ piece, flip }) {
  const b = getPresetBounds(piece);
  if (!b) return null;
  const pad = 14;
  const w = Math.max(b.maxX - b.minX, 40) + pad * 2;
  const h = Math.max(b.maxY - b.minY, 40) + pad * 2;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const sw = Math.max(w, h) / 34;
  return (
    <Svg width="100%" height="100%" viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      {piece.lines.map((line, idx) => (
        <Path key={idx}
          d={line.points.map((p, i) => `${i ? 'L' : 'M'}${((flip ? -1 : 1) * (p.x - cx)).toFixed(1)} ${(p.y - cy).toFixed(1)}`).join(' ')}
          stroke={lineColorFor(line.type)} strokeWidth={line.type === 'scenery' ? sw * 0.8 : sw} fill="none"
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={line.type === 'portal' ? `${sw * 2} ${sw}` : undefined} />
      ))}
    </Svg>
  );
}

const DEMO_TRACK_LIBRARY = [
  {
    id: 'haunted_hill',
    name: 'Haunted Hill',
    difficulty: 'Halloween',
    description: 'Moonlit graveyard run: pumpkin bounce, a slime slick, cobwebs and a haunted portal finish.',
    recommendedRiderId: 'pumpkinhead',
    lines: [
      { type: 'normal', points: [{ x: -400, y: -200 }, { x: -330, y: -150 }, { x: -260, y: -60 }, { x: -200, y: 30 }, { x: -120, y: 90 }, { x: -20, y: 115 }, { x: 60, y: 130 }] },
      { type: 'trampoline', points: [{ x: 60, y: 130 }, { x: 100, y: 142 }, { x: 140, y: 146 }, { x: 180, y: 142 }, { x: 220, y: 130 }] },
      { type: 'boost', points: [{ x: 260, y: 120 }, { x: 330, y: 170 }, { x: 420, y: 225 }, { x: 600, y: 285 }, { x: 800, y: 315 }] },
      { type: 'slime', points: [{ x: 800, y: 315 }, { x: 875, y: 325 }, { x: 950, y: 332 }, { x: 1025, y: 338 }, { x: 1100, y: 342 }, { x: 1175, y: 348 }] },
      { type: 'normal', points: [{ x: -100, y: 420 }, { x: 300, y: 480 }, { x: 700, y: 550 }, { x: 1100, y: 610 }, { x: 1500, y: 650 }, { x: 1800, y: 670 }] },
      { type: 'portal', points: [{ x: 1600, y: 592 }, { x: 1600, y: 657 }] },
      { type: 'scenery', points: [{ x: 107, y: 453 }, { x: 107, y: 426 }, { x: 108, y: 421 }, { x: 111, y: 417 }, { x: 115, y: 414 }, { x: 120, y: 413 }, { x: 125, y: 414 }, { x: 129, y: 417 }, { x: 132, y: 421 }, { x: 133, y: 426 }, { x: 133, y: 453 }] },
      { type: 'scenery', points: [{ x: 465, y: 512 }, { x: 465, y: 480 }, { x: 466, y: 475 }, { x: 469, y: 470 }, { x: 474, y: 467 }, { x: 480, y: 466 }, { x: 486, y: 467 }, { x: 491, y: 470 }, { x: 494, y: 475 }, { x: 495, y: 480 }, { x: 495, y: 512 }] },
      { type: 'scenery', points: [{ x: 820, y: 568 }, { x: 820, y: 522 }] },
      { type: 'scenery', points: [{ x: 808, y: 536 }, { x: 832, y: 536 }] },
      { type: 'scenery', points: [{ x: 987, y: 595 }, { x: 987, y: 568 }, { x: 988, y: 563 }, { x: 991, y: 559 }, { x: 995, y: 556 }, { x: 1000, y: 555 }, { x: 1005, y: 556 }, { x: 1009, y: 559 }, { x: 1012, y: 563 }, { x: 1013, y: 568 }, { x: 1013, y: 595 }] },
      { type: 'scenery', points: [{ x: 1300, y: 630 }, { x: 1300, y: 590 }] },
      { type: 'scenery', points: [{ x: 1288, y: 604 }, { x: 1312, y: 604 }] },
      { type: 'scenery', points: [{ x: 1408, y: 642 }, { x: 1408, y: 618 }, { x: 1409, y: 613 }, { x: 1412, y: 610 }, { x: 1415, y: 607 }, { x: 1420, y: 606 }, { x: 1425, y: 607 }, { x: 1428, y: 610 }, { x: 1431, y: 613 }, { x: 1432, y: 618 }, { x: 1432, y: 642 }] },
      { type: 'scenery', points: [{ x: 676, y: -164 }, { x: 665, y: -169 }, { x: 655, y: -176 }, { x: 646, y: -185 }, { x: 639, y: -195 }, { x: 634, y: -206 }, { x: 631, y: -218 }, { x: 630, y: -230 }, { x: 631, y: -242 }, { x: 634, y: -254 }, { x: 639, y: -265 }, { x: 646, y: -275 }, { x: 655, y: -284 }, { x: 665, y: -291 }, { x: 676, y: -296 }, { x: 704, y: -284 }, { x: 696, y: -278 }, { x: 690, y: -272 }, { x: 684, y: -265 }, { x: 679, y: -257 }, { x: 676, y: -248 }, { x: 674, y: -239 }, { x: 673, y: -230 }, { x: 674, y: -221 }, { x: 676, y: -212 }, { x: 679, y: -203 }, { x: 684, y: -195 }, { x: 690, y: -188 }, { x: 696, y: -182 }, { x: 704, y: -176 }] },
      { type: 'cobweb', points: [{ x: -470, y: -330 }, { x: -430, y: -300 }, { x: -390, y: -290 }, { x: -350, y: -300 }, { x: -310, y: -330 }] },
      { type: 'cobweb', points: [{ x: 880, y: 130 }, { x: 920, y: 160 }, { x: 960, y: 170 }, { x: 1000, y: 160 }, { x: 1040, y: 130 }] },
      { type: 'scenery', points: [{ x: -300, y: 300 }, { x: -300, y: 180 }, { x: -320, y: 140 }, { x: -300, y: 180 }, { x: -270, y: 130 }, { x: -300, y: 220 }, { x: -340, y: 200 }] },
    ],
  },
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

/* ══════════ TRAILS ══════════ */
const TRAIL_STORAGE_KEY = 'phone-rider-trails-v1';
const TRAIL_TYPES = [
  { id: 'classic', name: 'Classic Line', icon: '〰️', color: '#66d7ff', priceUsd: 0 },
  { id: 'rainbow', name: 'Neon Rainbow', icon: '🌈', color: '#ff4fd8', priceUsd: 0 },
  { id: 'sparkles', name: 'Sparkles', icon: '✨', color: '#fff3a6', priceUsd: 0 },
  { id: 'fire', name: 'Fire', icon: '🔥', color: '#ff7a1e', priceUsd: 0.99 },
  { id: 'ghost', name: 'Ghost Wisps', icon: '👻', color: '#d8f4ff', priceUsd: 0.99, seasonal: 'halloween' },
  { id: 'bats', name: 'Bats', icon: '🦇', color: '#b26bff', priceUsd: 0.99, seasonal: 'halloween' },
  { id: 'bubbles', name: 'Bubbles', icon: '🫧', color: '#7fe9ff', priceUsd: 0.99 },
  { id: 'lightning', name: 'Lightning', icon: '⚡', color: '#ffe94a', priceUsd: 0.99 },
  { id: 'pixel', name: 'Pixel Retro', icon: '👾', color: '#3bff8a', priceUsd: 0.99 },
  { id: 'comet', name: 'Stardust Comet', icon: '☄️', color: '#9fb4ff', priceUsd: 0.99 },
].map((t) => ({ ...t, productId: t.priceUsd > 0 ? `trail_${t.id}_1usd` : null }));
const HALLOWEEN_TRAIL_IDS = TRAIL_TYPES.filter((t) => t.seasonal === 'halloween').map((t) => t.id);
const DEFAULT_OWNED_TRAILS = ['classic', 'rainbow', 'sparkles', ...(HALLOWEEN_ACTIVE ? HALLOWEEN_TRAIL_IDS : [])];
const TRAIL_MAX_PARTICLES = 28;
function trailIdFromProductId(productId) {
  const t = TRAIL_TYPES.find((x) => x.productId && x.productId === productId);
  return t ? t.id : null;
}
function trailHash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
// Draws a trail from the recent rider points. Particles are derived from the points
// (no extra state), so cost is bounded by TRAIL_MAX_POINTS / TRAIL_MAX_PARTICLES.
function renderTrail(trailId, pts, riderColor, t, scale = 1) {
  if (!pts || pts.length < 2) return null;
  const n = pts.length;
  const W = RIDER_VISUAL_RADIUS * 1.4 * scale;
  const seed = (i) => Math.floor((pts[i].x + pts[i].y) / 7) ;
  const step = Math.max(1, Math.ceil(n / TRAIL_MAX_PARTICLES));
  const idx = [];
  for (let i = n - 1; i >= 0; i -= step) idx.push(i);
  const age = (i) => 1 - i / (n - 1); // 0 = newest
  switch (trailId) {
    case 'rainbow': {
      const cols = ['#ff3b6b', '#ffb02e', '#ffe94a', '#3bff8a', '#3bd8ff', '#b26bff'];
      return (
        <G>
          {cols.map((c, k) => (
            <Path key={k} d={pointsToPath(pts.map((p) => ({ x: p.x, y: p.y + (k - 2.5) * W * 0.16 })))}
              stroke={c} strokeOpacity={0.7} strokeWidth={W * 0.17} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </G>
      );
    }
    case 'sparkles':
      return (
        <G>
          <Path d={pointsToPath(pts)} stroke="#fff3a6" strokeOpacity={0.14} strokeWidth={W} fill="none" strokeLinecap="round" />
          {idx.map((i) => {
            const a = age(i); const h = trailHash(seed(i));
            const tw = 0.5 + 0.5 * Math.sin(t * 9 + h * 20);
            const r = (1.2 + h * 2.2) * scale * (1 - a * 0.6) * (0.6 + tw * 0.6);
            const x = pts[i].x + (h - 0.5) * W * 1.4; const y = pts[i].y + (trailHash(h * 9) - 0.5) * W * 1.4;
            return (
              <G key={i} opacity={(1 - a) * (0.5 + tw * 0.5)}>
                <Line x1={x - r * 2} y1={y} x2={x + r * 2} y2={y} stroke="#fff8d0" strokeWidth={0.8 * scale} />
                <Line x1={x} y1={y - r * 2} x2={x} y2={y + r * 2} stroke="#fff8d0" strokeWidth={0.8 * scale} />
                <Circle cx={x} cy={y} r={r * 0.6} fill="#ffffff" />
              </G>
            );
          })}
        </G>
      );
    case 'fire':
      return (
        <G>
          <Path d={pointsToPath(pts)} stroke="#ff3b1e" strokeOpacity={0.25} strokeWidth={W * 1.1} fill="none" strokeLinecap="round" />
          {idx.map((i) => {
            const a = age(i); const h = trailHash(seed(i));
            const fl = Math.sin(t * 14 + h * 30);
            const r = W * (0.55 - a * 0.42) * (0.85 + fl * 0.15);
            const y = pts[i].y - a * 10 * scale - fl * 1.5 * scale;
            const c = a < 0.25 ? '#ffe94a' : (a < 0.6 ? '#ff8a1e' : '#ff3b1e');
            return <Circle key={i} cx={pts[i].x + (h - 0.5) * 3 * scale} cy={y} r={Math.max(0.5, r)} fill={c} opacity={0.85 - a * 0.7} />;
          })}
        </G>
      );
    case 'ghost':
      return (
        <G>
          {[0, 1, 2].map((k) => (
            <Path key={k} d={pointsToPath(pts.map((p, i) => ({ x: p.x, y: p.y + Math.sin(i * 0.6 + t * 4 + k * 2.1) * W * 0.5 * age(i) })))}
              stroke="#d8f4ff" strokeOpacity={0.22 - k * 0.05} strokeWidth={W * (0.7 - k * 0.18)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {idx.filter((_, k) => k % 4 === 2).map((i) => {
            const a = age(i);
            return (
              <G key={i} opacity={0.55 * (1 - a)} translateX={pts[i].x} translateY={pts[i].y - a * 12 * scale}>
                <Ellipse cx={0} cy={0} rx={3 * scale} ry={3.6 * scale} fill="#eef8ff" />
                <Circle cx={-1 * scale} cy={-0.6 * scale} r={0.55 * scale} fill="#1a1f33" />
                <Circle cx={1 * scale} cy={-0.6 * scale} r={0.55 * scale} fill="#1a1f33" />
              </G>
            );
          })}
        </G>
      );
    case 'bats':
      return (
        <G>
          <Path d={pointsToPath(pts)} stroke="#b26bff" strokeOpacity={0.18} strokeWidth={W * 0.8} fill="none" strokeLinecap="round" />
          {idx.filter((_, k) => k % 2 === 1).map((i) => {
            const a = age(i); const h = trailHash(seed(i));
            const flap = Math.sin(t * 18 + h * 40) * 2.2;
            const sc = scale * (2.6 - a * 1.3);
            const x = pts[i].x + (h - 0.5) * 8 * scale; const y = pts[i].y - a * 16 * scale - h * 6 * scale;
            return (
              <G key={i} opacity={1 - a * 0.8} translateX={x} translateY={y} scale={sc}>
                <Path d={`M0 0 Q-3 ${-2 - flap} -6 ${-flap} Q-4.5 1 -3 0.6 Q-1.5 1.6 0 0.6 Q1.5 1.6 3 0.6 Q4.5 1 6 ${-flap} Q3 ${-2 - flap} 0 0 Z`} fill="#2a1240" stroke="#c98bff" strokeWidth={0.4} />
              </G>
            );
          })}
        </G>
      );
    case 'bubbles':
      return (
        <G>
          {idx.filter((_, k) => k % 2 === 0).map((i) => {
            const a = age(i); const h = trailHash(seed(i));
            const r = (2.6 + h * 3.4) * scale * (0.6 + a);
            const x = pts[i].x + Math.sin(t * 3 + h * 9) * 2 * scale; const y = pts[i].y - a * 14 * scale;
            return (
              <G key={i} opacity={1 - a * 0.7}>
                <Circle cx={x} cy={y} r={r} fill="rgba(127,233,255,0.12)" stroke="#9ff0ff" strokeWidth={0.6 * scale} />
                <Circle cx={x - r * 0.35} cy={y - r * 0.35} r={r * 0.22} fill="#ffffff" opacity={0.8} />
              </G>
            );
          })}
        </G>
      );
    case 'lightning': {
      const frame = Math.floor(t * 12);
      const zig = pts.map((p, i) => ({ x: p.x + (trailHash(frame * 31 + i) - 0.5) * W * 0.9 * age(i),
        y: p.y + (trailHash(frame * 17 + i * 3) - 0.5) * W * 1.3 * age(i) }));
      const d = pointsToPath(zig);
      return (
        <G>
          <Path d={d} stroke="#ffe94a" strokeOpacity={0.3} strokeWidth={W * 0.7} fill="none" strokeLinejoin="miter" />
          <Path d={'M' + zig.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')} stroke="#fffbe0" strokeWidth={1.4 * scale} fill="none" strokeLinejoin="miter" />
        </G>
      );
    }
    case 'pixel':
      return (
        <G>
          {idx.map((i) => {
            const a = age(i); const sz = Math.max(1.5, W * 0.55 * (1 - a * 0.6));
            const g = 3 * scale;
            const x = Math.round(pts[i].x / g) * g; const y = Math.round(pts[i].y / g) * g;
            const c = ['#3bff8a', '#3bd8ff', '#ff4fd8'][i % 3];
            return <Rect key={i} x={x - sz / 2} y={y - sz / 2} width={sz} height={sz} fill={c} opacity={1 - a * 0.75} />;
          })}
        </G>
      );
    case 'comet':
      return (
        <G>
          <Path d={pointsToPath(pts)} stroke="#6a7dff" strokeOpacity={0.2} strokeWidth={W * 1.3} fill="none" strokeLinecap="round" />
          <Path d={pointsToPath(pts.slice(-Math.ceil(n / 2)))} stroke="#cfe0ff" strokeOpacity={0.55} strokeWidth={W * 0.6} fill="none" strokeLinecap="round" />
          {idx.map((i) => {
            const a = age(i); const h = trailHash(seed(i));
            const tw = 0.5 + 0.5 * Math.sin(t * 7 + h * 25);
            return <Circle key={i} cx={pts[i].x + (h - 0.5) * W * 2 * a} cy={pts[i].y + (trailHash(h * 5) - 0.5) * W * 2 * a}
              r={(0.5 + h) * scale} fill={h > 0.5 ? '#ffffff' : '#bfa8ff'} opacity={(1 - a) * tw} />;
          })}
        </G>
      );
    case 'classic':
    default:
      return (
        <G>
          <Path d={pointsToPath(pts)} stroke={riderColor || '#66d7ff'} strokeOpacity={0.28}
            strokeWidth={W} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={pointsToPath(pts.slice(-12))} stroke="#ffffff" strokeOpacity={0.55}
            strokeWidth={3 * scale} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </G>
      );
  }
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
  const OL = '#0b1020';
  const SKIN = '#f1d1b4';

  switch (riderTypeId) {
    case 'classic':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_classic_jk" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
              <Stop offset="0.3" stopColor={primary} />
              <Stop offset="1" stopColor="#1c5a86" />
            </LinearGradient>
          </Defs>
          <Path d={`M-13,${8.4 + bob * 0.6} L12,${8.4 - bob * 0.3} Q15,${8.2 - bob * 0.3} 15.2,${6.8 - bob * 0.3}`} stroke="#8e9bb0" strokeWidth={1.6} fill="none" strokeLinecap="round" />
          <Path d={`M-14,${6.4 + bob * 0.4} L13,${6.4 - bob * 0.2} Q16,${6.1 - bob * 0.2} 16.2,${4.6 - bob * 0.2}`} stroke="#eef3fa" strokeWidth={1.9} fill="none" strokeLinecap="round" />
          <G translateY={-bob * 0.8}>
            <Line x1={-3} y1={-3.5} x2={-11 + sway} y2={5.5} stroke="#c3ccd8" strokeWidth={0.9} strokeLinecap="round" />
            <Circle cx={-11 + sway} cy={5.5} r={0.9} fill="none" stroke="#c3ccd8" strokeWidth={0.6} />
            <Path d="M-2.5,0 L-5.2,3.2 L-3.4,5.6" stroke="#2a3350" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M2,0 L5,2.8 L3.8,5.6" stroke="#34406a" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={-5.4} y={4.4} width={4} height={1.9} rx={0.7} fill="#151a28" />
            <Rect x={2.2} y={4.4} width={4} height={1.9} rx={0.7} fill="#151a28" />
            <Path d="M-4.8,1.2 C-6,-3 -4,-7.4 0,-8 C3.4,-8.2 5.4,-6 5,-2.6 L4.2,1.2 Z" fill="url(#rs_classic_jk)" stroke={OL} strokeWidth={0.6} />
            <Path d="M-0.4,-7.7 C2.6,-7.8 4.6,-5.9 4.7,-3" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={0.7} fill="none" />
            <Line x1={-4.9} y1={-1.6} x2={4.6} y2={-1.6} stroke={accent} strokeWidth={1} />
            <Path d={`M2.8,-5.8 L6.2,-3.2 L${8.4 - sway * 0.5},-0.8`} stroke={primary} strokeWidth={2.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={8.4 - sway * 0.5} y1={-0.8} x2={4 - sway} y2={7} stroke="#e2e8f0" strokeWidth={0.9} strokeLinecap="round" />
            <Circle cx={8.4 - sway * 0.5} cy={-0.8} r={1.1} fill="#151a28" />
            <Path d="M-2,-11 C-5.2,-11 -7,-8.6 -6.4,-5.8 C-5.4,-7.6 -4,-8.8 -1.6,-9.4 Z" fill="#7a4a2c" stroke={OL} strokeWidth={0.4} />
            <Circle cx={1.6} cy={-11} r={3.6} fill={SKIN} stroke={OL} strokeWidth={0.5} />
            <Path d="M-2.3,-11.2 A3.95,3.95 0 0 1 5.6,-11.6 L5.6,-10.8 L-2.3,-10.4 Z" fill="#f6f8ff" stroke={OL} strokeWidth={0.5} />
            <Path d="M-0.4,-14 A3.4,3.4 0 0 1 3.6,-14.4" stroke={primary} strokeWidth={1} fill="none" />
            <Rect x={2.6} y={-11.4} width={3.8} height={1.9} rx={0.9} fill="#ff8fcf" stroke={OL} strokeWidth={0.4} />
            <Rect x={3.4} y={-11.1} width={1.4} height={0.6} rx={0.3} fill="#ffffff" opacity={0.85} />
          </G>
        </G>
      );
    case 'snowboarder':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_snow_board" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#2b3a66" />
              <Stop offset="0.5" stopColor={primary} />
              <Stop offset="1" stopColor="#2b3a66" />
            </LinearGradient>
            <LinearGradient id="rs_snow_hood" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} />
              <Stop offset="0.35" stopColor={primary} />
              <Stop offset="1" stopColor="#1d7a48" />
            </LinearGradient>
          </Defs>
          <Path d={`M-15,${5.6 + bob * 0.45} Q-15.5,${7.8 + bob * 0.45} -12.5,${8 + bob * 0.45} L12.5,${7.2 - bob * 0.2} Q15.5,${7 - bob * 0.2} 15,${4.8 - bob * 0.2} Z`} fill="url(#rs_snow_board)" stroke={OL} strokeWidth={0.6} />
          <Line x1={-12} y1={6.1 + bob * 0.4} x2={12} y2={5.4 - bob * 0.2} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.5} />
          <G translateY={-bob * 0.75}>
            <Path d="M-3.5,0 L-6,3 L-5,5.4" stroke="#22283a" strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M3,0 L6,2.6 L5,5" stroke="#2c3348" strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={-7} y={4.2} width={4.2} height={1.8} rx={0.7} fill="#ff6b4a" />
            <Rect x={3.2} y={3.8} width={4.2} height={1.8} rx={0.7} fill="#ff6b4a" />
            <Path d="M-5.6,1.4 C-6.6,-3.4 -3.8,-7.6 0.2,-7.8 C4,-7.8 6,-5 5.4,-1 L4.6,1.4 Z" fill="url(#rs_snow_hood)" stroke={OL} strokeWidth={0.6} />
            <Path d="M0.2,-7.5 C3.4,-7.5 5.4,-5.2 5.2,-2" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.7} fill="none" />
            <Path d="M-2,-3 L2,-3 L2.4,0 L-2.4,0 Z" fill="#1d7a48" opacity={0.6} />
            <Path d={`M-4.4,-5.4 L${-9 + sway},${-2.4} L${-12 + sway},${-3.4}`} stroke={primary} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={`M4.4,-5.4 L${9 - sway},${-4} L${12 - sway},${-6}`} stroke={primary} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={-12 + sway} cy={-3.4} r={1.1} fill="#22283a" />
            <Circle cx={12 - sway} cy={-6} r={1.1} fill="#22283a" />
            <Circle cx={0.4} cy={-11} r={3.7} fill={SKIN} stroke={OL} strokeWidth={0.5} />
            <Path d="M-3.4,-11.4 C-3.4,-15.6 4.2,-15.6 4.2,-11.4 Z" fill="#2b3548" stroke={OL} strokeWidth={0.5} />
            <Rect x={-3.6} y={-12.2} width={7.9} height={1.3} rx={0.6} fill={accent} />
            <Circle cx={0.4} cy={-15.2} r={1.2} fill={primary} />
            <Rect x={1.2} y={-10.9} width={3.6} height={1.7} rx={0.8} fill="#7ce2ff" stroke={OL} strokeWidth={0.4} />
            <Rect x={1.8} y={-10.6} width={1.2} height={0.5} rx={0.25} fill="#ffffff" />
          </G>
        </G>
      );
    case 'sled':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_sled_wood" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffe2a6" />
              <Stop offset="0.5" stopColor={primary} />
              <Stop offset="1" stopColor="#a5662a" />
            </LinearGradient>
          </Defs>
          <Path d="M-13,8.6 L9,8.6 C13,8.6 15,7 14.4,4.6" stroke="#c8d1de" strokeWidth={1.3} fill="none" strokeLinecap="round" />
          <Line x1={-9} y1={8.4} x2={-9} y2={6.4} stroke="#8a93a3" strokeWidth={0.9} />
          <Line x1={6} y1={8.4} x2={6} y2={6.4} stroke="#8a93a3" strokeWidth={0.9} />
          <Path d="M-14,4.4 L10,4.4 C14,4.4 15.6,2.4 14.6,0 C14,2.2 12.6,3 10,3 L-13,3 Q-14.4,3 -14,4.4 Z" fill="url(#rs_sled_wood)" stroke={OL} strokeWidth={0.6} />
          <Rect x={-14} y={4.4} width={24} height={2.2} rx={0.6} fill="#a5662a" stroke={OL} strokeWidth={0.5} />
          <Line x1={-12.5} y1={3.4} x2={10} y2={3.4} stroke="#fff4ce" strokeOpacity={0.7} strokeWidth={0.5} />
          <G translateY={-bob * 0.62}>
            <Path d="M-4,2.6 L4,2.6 L7.6,2.4" stroke="#33406a" strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={6.6} y={0.8} width={2.6} height={2.4} rx={0.8} fill="#1b2030" />
            <Path d="M-8,3 C-9,-1 -8,-5.6 -4.6,-6.4 C-1.4,-7 0.6,-4.6 0.2,-1 L-0.4,3 Z" fill="#e64a5a" stroke={OL} strokeWidth={0.6} />
            <Path d="M-4.8,-6.2 C-1.6,-6.8 0.4,-4.6 0.1,-1.6" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} fill="none" />
            <Path d={`M-2,-4 L3,-1.6 L${6 - sway * 0.4},1.6`} stroke="#e64a5a" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={6 - sway * 0.4} cy={1.6} r={0.95} fill="#1b2030" />
            <Path d={`M-6.4,-6.6 C-9,-6.4 -11,${-5.4 + sway * 0.3} -13,${-6.6 + sway * 0.6} L-12.6,${-4.8 + sway * 0.6} C-10.6,-4 -8.6,-4.6 -6,-5.2 Z`} fill={accent} stroke={OL} strokeWidth={0.4} />
            <Circle cx={-3.6} cy={-9.6} r={3.5} fill={SKIN} stroke={OL} strokeWidth={0.5} />
            <Circle cx={-1.8} cy={-9.8} r={0.5} fill="#1b2030" />
            <Circle cx={-1.4} cy={-8.4} r={0.7} fill="#ff9a9a" opacity={0.7} />
            <Path d="M-7.2,-10 C-7.2,-14.4 0,-14.4 0,-10 Z" fill="#e64a5a" stroke={OL} strokeWidth={0.5} />
            <Rect x={-7.4} y={-10.8} width={7.6} height={1.3} rx={0.6} fill={accent} />
            <Circle cx={-3.6} cy={-14} r={1.3} fill={accent} stroke={OL} strokeWidth={0.4} />
          </G>
        </G>
      );
    case 'comet':
      return (
        <G>
          <Defs>
            <RadialGradient id="rs_yeti_fur" cx="0.6" cy="0.3" r="0.8">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="0.55" stopColor="#e4f6ff" />
              <Stop offset="1" stopColor={primary} />
            </RadialGradient>
          </Defs>
          <Path d={`M-14,${7 + bob * 0.4} L12,${7 - bob * 0.3} Q15.4,${6.7 - bob * 0.3} 15.6,${5 - bob * 0.3}`} stroke="#5b6b85" strokeWidth={2} fill="none" strokeLinecap="round" />
          <Line x1={-13} y1={6.3 + bob * 0.4} x2={12} y2={6.3 - bob * 0.3} stroke="#c8f1ff" strokeOpacity={0.6} strokeWidth={0.5} />
          <G translateY={-bob * 0.7}>
            <Path d="M-5,0 L-6,5.6 M4,0 L5,5.6" stroke="#d6f1ff" strokeWidth={4} strokeLinecap="round" />
            <Ellipse cx={-6} cy={5.8} rx={2.6} ry={1.1} fill="#5f7fa0" />
            <Ellipse cx={5.4} cy={5.8} rx={2.6} ry={1.1} fill="#5f7fa0" />
            <Path d="M-10,3 C-11,-4 -7,-10 0,-10.4 C7,-10.4 11,-5 10,3 L8,1.6 L6,3.6 L3.6,1.8 L1,3.8 L-1.6,1.8 L-4,3.8 L-6.4,1.8 L-8.4,3.6 Z" fill="url(#rs_yeti_fur)" stroke={OL} strokeWidth={0.6} />
            <Path d="M0,-10 C6,-10 9.6,-5.6 9.6,-1" stroke="#ffffff" strokeWidth={0.8} fill="none" />
            <Path d={`M-8,-5 C-11,-3 ${-13 + sway * 0.6},0 ${-13 + sway * 0.6},2.6`} stroke="#e4f6ff" strokeWidth={3} fill="none" strokeLinecap="round" />
            <Path d={`M8,-5 C11,-4 ${13 - sway * 0.6},-1 ${13.4 - sway * 0.6},1.6`} stroke="#e4f6ff" strokeWidth={3} fill="none" strokeLinecap="round" />
            <Circle cx={-13 + sway * 0.6} cy={2.8} r={1.4} fill="#7ea4c4" />
            <Circle cx={13.4 - sway * 0.6} cy={1.8} r={1.4} fill="#7ea4c4" />
            <Path d="M-3.6,-13 C-5,-17.6 -2,-20 2,-20 C6.4,-20 8.6,-17 7.6,-12.6 C6,-9.6 -2,-9.6 -3.6,-13 Z" fill="url(#rs_yeti_fur)" stroke={OL} strokeWidth={0.6} />
            <Path d="M-2.6,-18.6 L-4.6,-21.6 L-1,-19.6 Z M6,-19 L8,-21.8 L7.2,-18.2 Z" fill="#c9b78a" stroke={OL} strokeWidth={0.4} />
            <Path d="M0,-16.4 C1.6,-17.4 5.6,-17.2 6.6,-15.6 C7.2,-13 6,-11.6 3.4,-11.4 C1,-11.4 -0.4,-13 0,-16.4 Z" fill="#6f9cc4" />
            <Circle cx={2} cy={-15.2} r={0.9} fill="#0b1020" />
            <Circle cx={5.2} cy={-15.2} r={0.9} fill="#0b1020" />
            <Circle cx={2.3} cy={-15.5} r={0.3} fill="#ffffff" />
            <Circle cx={5.5} cy={-15.5} r={0.3} fill="#ffffff" />
            <Path d="M1.6,-13.2 Q3.6,-11.8 5.8,-13.2 L5.2,-12.4 L4.6,-13 L3.6,-12.2 L2.8,-13 L2.2,-12.4 Z" fill="#ffffff" stroke="#0b1020" strokeWidth={0.4} />
          </G>
        </G>
      );
    case 'blaze':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_bigfoot_fur" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#c08a5e" />
              <Stop offset="0.5" stopColor={primary} />
              <Stop offset="1" stopColor="#5a3820" />
            </LinearGradient>
          </Defs>
          <Path d={`M-13,${8.3 + bob * 0.45} L12,${8.3 - bob * 0.22} Q15,${8 - bob * 0.22} 15.2,${6.6 - bob * 0.22}`} stroke="#8a6a3c" strokeWidth={1.7} fill="none" strokeLinecap="round" />
          <Path d={`M-14,${6.3 + bob * 0.35} L13,${6.3 - bob * 0.18} Q16,${6 - bob * 0.18} 16.2,${4.4 - bob * 0.18}`} stroke="#d0ae72" strokeWidth={2} fill="none" strokeLinecap="round" />
          <G translateY={-bob * 0.88}>
            <Line x1={-4} y1={-4} x2={-12 + sway * 0.75} y2={5} stroke="#8a6a3c" strokeWidth={1.1} strokeLinecap="round" />
            <Path d="M-4,0 L-6.4,3 L-5,5.2 M3.4,0 L6.4,2.6 L5.4,5.2" stroke="#6e4528" strokeWidth={3.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Ellipse cx={-5} cy={5.2} rx={3} ry={1.2} fill="#3a2414" />
            <Ellipse cx={5.8} cy={5.2} rx={3} ry={1.2} fill="#3a2414" />
            <Path d="M-8.6,2 C-9.6,-4 -6,-9.6 0.6,-9.6 C7,-9.6 10,-4.4 8.6,2 L6.6,0.8 L4.4,2.6 L2,0.8 L-0.4,2.6 L-2.8,0.8 L-5,2.6 L-7,0.8 Z" fill="url(#rs_bigfoot_fur)" stroke={OL} strokeWidth={0.6} />
            <Path d="M0.6,-9.3 C5.6,-9.3 8.6,-6 8.8,-2" stroke={accent} strokeOpacity={0.8} strokeWidth={0.8} fill="none" />
            <Path d="M-4,-6.6 L-2.6,-4.6 M-1,-7.4 L0.4,-5.2 M2.4,-7.2 L3.6,-5" stroke="#5a3820" strokeWidth={0.6} strokeLinecap="round" />
            <Ellipse cx={1.6} cy={-3} rx={3.4} ry={3.2} fill={accent} opacity={0.45} />
            <Path d={`M6,-6 L10,-3 L${12.4 - sway * 0.75},0`} stroke="#7a4d2e" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={12.4 - sway * 0.75} y1={0} x2={8 - sway} y2={6.4} stroke="#8a6a3c" strokeWidth={1.1} strokeLinecap="round" />
            <Circle cx={12.4 - sway * 0.75} cy={0} r={1.5} fill="#3a2414" />
            <Path d="M-2.6,-11 C-3.6,-16 -0.6,-18.4 3,-18.2 C7,-18 8.4,-14.6 7.4,-10.8 C5.6,-8.4 -0.6,-8.4 -2.6,-11 Z" fill="url(#rs_bigfoot_fur)" stroke={OL} strokeWidth={0.6} />
            <Path d="M1.6,-15 C3,-16 6,-16 6.8,-14.4 C7.4,-12.2 6.2,-10.6 4,-10.4 C2,-10.4 1,-12 1.6,-15 Z" fill={accent} />
            <Path d="M1.8,-15.6 L6.8,-15.4" stroke="#3a2414" strokeWidth={0.9} strokeLinecap="round" />
            <Circle cx={3} cy={-14.4} r={0.7} fill="#0b1020" />
            <Circle cx={5.6} cy={-14.4} r={0.7} fill="#0b1020" />
            <Ellipse cx={4.6} cy={-12.8} rx={1} ry={0.6} fill="#6e4528" />
            <Path d="M3,-11.4 Q4.4,-10.6 5.8,-11.4" stroke="#3a2414" strokeWidth={0.5} fill="none" />
          </G>
        </G>
      );
    case 'nova':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_atv_body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} />
              <Stop offset="0.35" stopColor={primary} />
              <Stop offset="1" stopColor="#a8401c" />
            </LinearGradient>
          </Defs>
          {[-8.6, 8.6].map((wx) => (
            <G key={wx}>
              <Circle cx={wx} cy={6.4} r={4} fill="#1a1d26" stroke={OL} strokeWidth={0.6} />
              <Circle cx={wx} cy={6.4} r={4} fill="none" stroke="#3a3f4e" strokeWidth={1} strokeDasharray="1.2 1" />
              <Circle cx={wx} cy={6.4} r={1.7} fill="#b9c2d0" />
              <Circle cx={wx - 0.4} cy={6} r={0.5} fill="#ffffff" />
            </G>
          ))}
          <G translateY={-(suspension * 0.6 + bob * 0.25)}>
            <Path d="M-8.6,5.6 L-4,2.6 M8.6,5.6 L4,2.6" stroke="#59606e" strokeWidth={1.2} strokeLinecap="round" />
            <Path d="M-13.6,2.4 C-13.6,0 -11,-1 -8,-0.8 L-4,1 L4,1 L8,-1 C11,-1.4 13.6,0 14,2.4 L11,3.4 L6.6,2.6 L-6.6,2.6 L-11,3.4 Z" fill="url(#rs_atv_body)" stroke={OL} strokeWidth={0.6} />
            <Path d="M-12.6,0.6 C-11,-0.4 -9,-0.6 -8,-0.4 M8.2,-0.6 C10.6,-1 12.6,-0.4 13.4,1" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={0.6} fill="none" />
            <Rect x={-4.6} y={-0.6} width={9} height={2.2} rx={1} fill="#1e222c" />
            <Path d="M7,-1.4 L9,-5.6 L11.6,-5.8" stroke="#2a2f3c" strokeWidth={1} fill="none" strokeLinecap="round" />
            <Circle cx={13.6} cy={1.2} r={0.9} fill="#fff6c2" />
            <Path d="M-1,0 L2,1.6 L5.4,1.4" stroke="#2c3348" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M-3.4,-0.4 C-4.6,-4.4 -2.6,-8 0.6,-8.2 C3.6,-8.2 4.8,-5.4 4,-2 L3,0 Z" fill="#2b3a66" stroke={OL} strokeWidth={0.6} />
            <Path d="M0.6,-8 C3,-8 4.4,-6 4.3,-3.4" stroke={accent} strokeOpacity={0.8} strokeWidth={0.6} fill="none" />
            <Path d={`M2.6,-6 L7,-4.4 L${10.8 - sway * 0.5},${-5.6 + airTilt * 0.15}`} stroke="#2b3a66" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={10.8 - sway * 0.5} cy={-5.6 + airTilt * 0.15} r={0.9} fill="#151a28" />
            <Circle cx={1} cy={-11.4} r={3.8} fill={primary} stroke={OL} strokeWidth={0.6} />
            <Path d="M1.6,-12.6 L5.2,-12.6 C5.4,-10.6 4.6,-9.4 2.6,-9.4 Z" fill="#20283c" />
            <Path d="M2.2,-12.2 L4.6,-12.2" stroke="#7ce2ff" strokeWidth={0.6} />
            <Path d="M-2,-12.4 A3.2,3.2 0 0 1 2,-14.8" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={0.7} fill="none" />
            <Line x1={-2.8} y1={-11} x2={4.6} y2={-11} stroke={accent} strokeWidth={0.6} />
          </G>
        </G>
      );
    case 'dirtbike':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_dirt_body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} />
              <Stop offset="0.35" stopColor={primary} />
              <Stop offset="1" stopColor="#9c2a1e" />
            </LinearGradient>
          </Defs>
          {[-9, 9.4].map((wx) => (
            <G key={wx}>
              <Circle cx={wx} cy={6.4} r={4} fill="none" stroke="#1a1d26" strokeWidth={1.8} />
              <Circle cx={wx} cy={6.4} r={4.4} fill="none" stroke="#3a3f4e" strokeWidth={0.6} strokeDasharray="0.9 0.8" />
              <Path d={`M${wx - 3},6.4 L${wx + 3},6.4 M${wx},3.4 L${wx},9.4 M${wx - 2.1},4.3 L${wx + 2.1},8.5 M${wx + 2.1},4.3 L${wx - 2.1},8.5`} stroke="#9aa3b2" strokeWidth={0.35} />
              <Circle cx={wx} cy={6.4} r={1} fill="#c9d1dd" />
            </G>
          ))}
          <G translateY={-(suspension + bob * 0.28)}>
            <Path d="M-9,6.4 L-3,2.4 L2,2.4" stroke="#3a3f4e" strokeWidth={1.4} fill="none" strokeLinecap="round" />
            <Line x1={9.4} y1={6.4} x2={6.4} y2={-2.6} stroke="#c9d1dd" strokeWidth={1.3} strokeLinecap="round" />
            <Path d="M-3,0 L5,0 L7,-2 L4.6,3.4 L-1.6,3.4 Z" fill="#2a2f3c" stroke={OL} strokeWidth={0.5} />
            <Path d="M-12.6,-0.6 L-2,-1.6 L1,0.8 L-8,1.6 Z" fill="url(#rs_dirt_body)" stroke={OL} strokeWidth={0.5} />
            <Path d="M1,-1.8 L7.6,-3.2 L6.6,0.6 L2,0.8 Z" fill="url(#rs_dirt_body)" stroke={OL} strokeWidth={0.5} />
            <Path d="M7.4,2.6 C9.4,1.8 11.6,2.4 13,3.6 L11,3.8 Z" fill={primary} stroke={OL} strokeWidth={0.4} />
            <Path d="M-11.6,1.6 L-7,2.8 L-3,2.6" stroke="#b9c2d0" strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <Path d="M-2,-1.6 L1.6,0 L3,3.6" stroke="#2c3348" strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={2} y={3} width={2.6} height={1.6} rx={0.5} fill="#151a28" />
            <Path d="M-4.6,-1.6 C-5.4,-5.4 -3,-8.6 0.6,-8.6 C3.4,-8.4 4.4,-6 3.6,-3 L1.6,-1.6 Z" fill={primary} stroke={OL} strokeWidth={0.6} />
            <Path d="M-3.8,-5 L3.4,-4.4" stroke={accent} strokeWidth={0.8} />
            <Path d={`M2,-6.4 L5.4,-4.4 L${7.4 - sway * 0.35},${-3.2 + airTilt * 0.2}`} stroke={primary} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={7.4 - sway * 0.35} cy={-3.2 + airTilt * 0.2} r={0.9} fill="#151a28" />
            <Circle cx={1} cy={-11.6} r={3.9} fill="#f4f7ff" stroke={OL} strokeWidth={0.6} />
            <Path d="M-2.6,-12.6 C-1,-15.4 3,-15.6 4.4,-13.6" stroke={primary} strokeWidth={1.2} fill="none" />
            <Path d="M2.4,-13 L5.4,-12.6 L5,-10.4 L2.6,-10.6 Z" fill="#20283c" />
            <Path d="M2.8,-12.4 L5,-12.1" stroke="#ffe36a" strokeWidth={0.6} />
            <Path d="M1.4,-15.6 L6.2,-14.6 L5,-13.6 Z" fill={accent} stroke={OL} strokeWidth={0.3} />
            <Path d="M4,-10.4 L5.6,-9.2 L3.4,-8.4 Z" fill="#c9d1dd" />
          </G>
        </G>
      );
    case 'car':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_car_body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={accent} />
              <Stop offset="0.4" stopColor={primary} />
              <Stop offset="1" stopColor="#1f5f99" />
            </LinearGradient>
            <LinearGradient id="rs_car_glass" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#e8f7ff" />
              <Stop offset="1" stopColor="#3a6a96" />
            </LinearGradient>
          </Defs>
          <Ellipse cx={0} cy={10.2} rx={13} ry={1} fill="#000000" opacity={0.35} />
          <G translateY={-(suspension * 0.8 + bob * 0.18)}>
            <Path d="M-14.4,4.6 L-14,0.6 C-13.6,-0.6 -12,-1 -10,-1.2 L-6.4,-6 C-5.6,-6.8 -4.6,-7 -3.4,-7 L4,-7 C5.4,-7 6.4,-6.4 7.4,-5 L9.6,-1.4 C12,-1 14,-0.2 14.6,1.6 L14.6,4.6 Z" fill="url(#rs_car_body)" stroke={OL} strokeWidth={0.6} />
            <Path d="M-5.6,-1.6 L-3.6,-5.8 L-0.6,-5.8 L-0.6,-1.6 Z" fill="url(#rs_car_glass)" stroke={OL} strokeWidth={0.4} />
            <Path d="M0.6,-1.6 L0.6,-5.8 L4,-5.8 C4.8,-5.8 5.4,-5.4 6,-4.6 L8,-1.6 Z" fill="url(#rs_car_glass)" stroke={OL} strokeWidth={0.4} />
            <Path d="M1.4,-5 L2.8,-5 L1.6,-2.4 Z" fill="#ffffff" opacity={0.7} />
            <Path d="M-3.2,-6.6 L4.2,-6.6 C5.2,-6.6 6.2,-6 7,-4.8" stroke="#ffffff" strokeOpacity={0.8} strokeWidth={0.6} fill="none" />
            <Path d="M-13.6,0.6 L13.8,1.2" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.5} />
            <Path d="M-13,2.4 L13,2.4" stroke="#ff5f4a" strokeWidth={0.9} />
            <Path d="M-15.6,-3.2 L-12,-3.2 L-11.4,-1 M-15.8,-3.4 L-15.8,-1.6" stroke="#1d2230" strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <Rect x={12.6} y={0.2} width={2.2} height={1.4} rx={0.6} fill="#fff6c2" />
            <Rect x={-14.8} y={0.4} width={1.4} height={1.4} rx={0.4} fill="#ff4a5a" />
            <Line x1={-0.1} y1={-1.4} x2={-0.1} y2={4.4} stroke={OL} strokeWidth={0.4} />
          </G>
          {[-8.4, 8.8].map((wx) => (
            <G key={wx}>
              <Circle cx={wx} cy={6.8} r={3.2} fill="#16181f" stroke={OL} strokeWidth={0.5} />
              <Circle cx={wx} cy={6.8} r={1.8} fill="#c9d1dd" />
              <Path d={`M${wx - 1.6},6.8 L${wx + 1.6},6.8 M${wx},5.2 L${wx},8.4`} stroke="#6a7284" strokeWidth={0.5} />
              <Circle cx={wx - 0.6} cy={6.2} r={0.45} fill="#ffffff" />
            </G>
          ))}
        </G>
      );
    case 'unicycle':
      return (
        <G>
          <Circle cx={0} cy={5} r={5.4} fill="none" stroke="#1a1d26" strokeWidth={1.8} />
          <Circle cx={0} cy={5} r={4.4} fill="none" stroke={primary} strokeWidth={0.5} />
          <Path d="M-4.2,5 L4.2,5 M0,0.8 L0,9.2 M-3,2 L3,8 M3,2 L-3,8" stroke="#a2a9b6" strokeWidth={0.35} />
          <Circle cx={0} cy={5} r={1.1} fill="#d9dce4" />
          <G translateY={-bob * 0.75}>
            <Line x1={0} y1={5} x2={0.4} y2={-3.4} stroke="#c9d1dd" strokeWidth={1.3} />
            <Line x1={-0.2} y1={4} x2={-0.2} y2={-2} stroke="#ffffff" strokeOpacity={0.5} strokeWidth={0.4} />
            <Path d="M-2.6,-3.6 C-2.6,-5 3.6,-5 3.6,-3.6 C3.6,-2.8 -2.6,-2.8 -2.6,-3.6 Z" fill="#1d2230" stroke={OL} strokeWidth={0.4} />
            <Path d="M-0.6,-3.6 L-1.6,0.6 L-2.4,4.6 M1.6,-3.6 L2.4,0.8 L2.6,5.4" stroke="#2c3348" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Rect x={-3.8} y={4} width={2.8} height={1.4} rx={0.5} fill={accent} />
            <Rect x={1.6} y={4.8} width={2.8} height={1.4} rx={0.5} fill={accent} />
            <Path d="M-3.6,-3.4 C-4.4,-7.4 -2,-10 1,-10 C3.8,-10 5.2,-7.6 4.6,-3.4 Z" fill={primary} stroke={OL} strokeWidth={0.6} />
            <Path d="M1,-9.7 C3.4,-9.7 4.8,-7.8 4.5,-4.6" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.6} fill="none" />
            <Path d="M-3.4,-6.4 L4.6,-6.4 M-3.2,-4.8 L4.6,-4.8" stroke={accent} strokeWidth={0.6} />
            <Path d={`M-2.6,-8 L-6,${-6 + sway * 0.3} L${-9 + sway * 0.8},${-8 + sway * 0.4}`} stroke={primary} strokeWidth={1.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={`M3.8,-8 L7,${-6.4 - sway * 0.3} L${10 - sway * 0.8},${-8.4 - sway * 0.4}`} stroke={primary} strokeWidth={1.7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={-9 + sway * 0.8} cy={-8 + sway * 0.4} r={0.9} fill={SKIN} />
            <Circle cx={10 - sway * 0.8} cy={-8.4 - sway * 0.4} r={0.9} fill={SKIN} />
            <Circle cx={1.2} cy={-13.2} r={3.6} fill={SKIN} stroke={OL} strokeWidth={0.5} />
            <Circle cx={2.8} cy={-13.4} r={0.5} fill="#1b2030" />
            <Path d="M2.2,-11.8 Q3.2,-11.2 4,-12" stroke="#1b2030" strokeWidth={0.4} fill="none" />
            <Path d="M-2.6,-13.6 A3.9,3.9 0 0 1 5,-14 L5.4,-13 L-2.8,-12.8 Z" fill={primary} stroke={OL} strokeWidth={0.5} />
            <Path d="M-0.6,-16.6 L0.4,-15.8 M1.8,-17.2 L1.8,-16 M3.8,-16.6 L3.2,-15.6" stroke={accent} strokeWidth={0.6} strokeLinecap="round" />
            <Path d="M4.6,-13.4 L7,-13.2 L5.2,-12.6 Z" fill={primary} stroke={OL} strokeWidth={0.3} />
          </G>
        </G>
      );
    case 'hoverboard':
      return (
        <G>
          <Rect x={-15} y={5} width={30} height={4.5} rx={2.2} fill={primary} />
          <Rect x={-13} y={9.5} width={26} height={1.4} rx={0.7} fill={accent} opacity={0.9} />
          <Circle cx={-10} cy={12.5} r={1.8 + suspension * 0.6} fill={accent} opacity={0.75} />
          <Circle cx={10} cy={12.5} r={1.8 + suspension * 0.6} fill={accent} opacity={0.75} />
          <G translateY={-bob * 0.8}>
            <Line x1={-3} y1={5} x2={-1} y2={-2} stroke="#2b2f45" strokeWidth={2.2} strokeLinecap="round" />
            <Line x1={4} y1={5} x2={2} y2={-2} stroke="#2b2f45" strokeWidth={2.2} strokeLinecap="round" />
            <Rect x={-4} y={-9} width={8} height={8} rx={2.5} fill="#2b2f45" />
            <Line x1={-3} y1={-6} x2={-9 + sway} y2={-3} stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
            <Line x1={3} y1={-6} x2={9 - sway} y2={-8} stroke={accent} strokeWidth={1.6} strokeLinecap="round" />
            <Circle cx={0} cy={-13} r={4} fill="#f1d1b4" />
            <Rect x={-4.2} y={-14.5} width={8.4} height={2.4} rx={1.2} fill={accent} />
          </G>
        </G>
      );
    case 'penguin':
      return (
        <G>
          <G translateY={-bob * 0.3}>
            <Ellipse cx={0} cy={3} rx={13} ry={5.6} fill={primary} />
            <Ellipse cx={1} cy={4.2} rx={10} ry={3.6} fill="#f4f7ff" />
            <Circle cx={12} cy={0.5} r={4.4} fill={primary} />
            <Circle cx={13.4} cy={-0.6} r={1.1} fill="#ffffff" />
            <Polygon points="16,0.5 20,1.8 16,2.8" fill={accent} />
            <Path d={`M-4,-1 L-9,${-6 + sway} L-1,-1 Z`} fill={primary} />
            <Polygon points="-13,2 -18,0 -18,5" fill={accent} />
          </G>
        </G>
      );
    case 'voltbot':
      return (
        <G>
          <Circle cx={0} cy={7.5} r={5.4} fill="#1d2230" stroke={primary} strokeWidth={1.4} />
          <Circle cx={0} cy={7.5} r={1.8} fill={primary} />
          <G translateY={-bob * 0.5}>
            <Rect x={-6} y={-6} width={12} height={9} rx={2} fill="#3a4258" stroke={primary} strokeWidth={1} />
            <Rect x={-5} y={-16} width={10} height={8.5} rx={2.4} fill="#4a536c" stroke={primary} strokeWidth={1} />
            <Rect x={-3.6} y={-13.5} width={7.2} height={2.6} rx={1.3} fill={accent} />
            <Line x1={0} y1={-16} x2={1.5 + sway} y2={-22} stroke="#d9dce4" strokeWidth={1.1} />
            <Circle cx={1.5 + sway} cy={-22.5} r={1.7} fill={primary} />
            <Line x1={-6} y1={-3} x2={-10} y2={1 + sway * 0.5} stroke={primary} strokeWidth={1.6} strokeLinecap="round" />
            <Line x1={6} y1={-3} x2={10} y2={1 - sway * 0.5} stroke={primary} strokeWidth={1.6} strokeLinecap="round" />
          </G>
        </G>
      );
    case 'rocketluge':
      return (
        <G>
          <Defs>
            <LinearGradient id="rs_luge_rocket" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="0.4" stopColor={primary} />
              <Stop offset="1" stopColor="#5a1f2a" />
            </LinearGradient>
            <LinearGradient id="rs_luge_flame" x1="1" y1="0" x2="0" y2="0">
              <Stop offset="0" stopColor="#ffffff" />
              <Stop offset="0.35" stopColor={accent} />
              <Stop offset="1" stopColor={accent} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d="M-15,8.6 L10,8.6 C13.4,8.6 15,7.4 14.6,5.2" stroke="#c9ced8" strokeWidth={1.3} fill="none" strokeLinecap="round" />
          <Path d="M-14,6.6 L-14,3.4 L10,3.4 C12.6,3.4 13.4,4.6 12.6,6.6 Z" fill="#2a2f40" stroke={OL} strokeWidth={0.5} />
          <Line x1={-13} y1={4} x2={11} y2={4} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={0.5} />
          <Line x1={-8} y1={6.6} x2={-8} y2={8.4} stroke="#8a93a3" strokeWidth={0.8} />
          <Line x1={6} y1={6.6} x2={6} y2={8.4} stroke="#8a93a3" strokeWidth={0.8} />
          <Path d={`M-17,-1.4 L-${25 + suspension * 3},0.8 L-17,3 Z`} fill="url(#rs_luge_flame)" />
          <Polygon points="-17,-0.2 -21.4,0.8 -17,1.8" fill="#ffffff" />
          <Path d="M-17.4,-2.2 L-9.4,-2.2 C-7.6,-2.2 -6.6,-0.8 -6.6,0.8 C-6.6,2.4 -7.6,3.8 -9.4,3.8 L-17.4,3.8 Z" fill="url(#rs_luge_rocket)" stroke={OL} strokeWidth={0.5} />
          <Path d="M-14,-2.2 L-16,-4.4 L-12,-2.2 Z M-14,3.8 L-16,5.6 L-12,3.8 Z" fill={accent} stroke={OL} strokeWidth={0.3} />
          <Rect x={-18.2} y={-1.6} width={1.2} height={4.8} rx={0.4} fill="#59606e" />
          <G translateY={-bob * 0.4}>
            <Path d="M-5,1.4 L4,1.6 L11.4,0.8" stroke="#2c3348" strokeWidth={2.6} fill="none" strokeLinecap="round" />
            <Path d="M10.4,-0.6 L13,-0.2 L13,1.8 L10.6,2 Z" fill="#151a28" />
            <Path d="M-6.4,2.8 C-7,0 -5,-2 -2,-2.2 L3.6,-1.4 C4.6,0 4.2,2 3,2.8 Z" fill={accent} stroke={OL} strokeWidth={0.5} />
            <Path d="M-5.6,-1.4 L3.4,-1" stroke="#ffffff" strokeOpacity={0.7} strokeWidth={0.5} />
            <Path d={`M-1,-1.6 L2,${2.2 - sway * 0.2}`} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
            <Circle cx={-7.4} cy={-2.6} r={3.4} fill={SKIN} stroke={OL} strokeWidth={0.5} />
            <Path d="M-11.2,-2.6 A3.9,3.9 0 0 1 -3.4,-3.4 L-3.6,-1.8 L-11,-1.6 Z" fill="url(#rs_luge_rocket)" stroke={OL} strokeWidth={0.5} />
            <Path d="M-6.8,-4.2 L-3.6,-4.2 L-3.6,-2.6 L-6.6,-2.6 Z" fill="#20283c" />
            <Path d="M-6.2,-3.8 L-4.2,-3.8" stroke={accent} strokeWidth={0.5} />
            <Path d="M-10,-5 A3.4,3.4 0 0 1 -6.6,-6.2" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={0.6} fill="none" />
          </G>
        </G>
      );
    case 'ghost':
      return (
        <G translateY={-bob * 1.0}>
          <Path d={`M-9,4 C-10,-6 -6,-16 0,-16 C6,-16 10,-6 9,4 L6,${1 + sway} L3,5 L0,${1 - sway} L-3,5 L-6,${1 + sway} Z`} fill={primary} opacity={0.92} />
          <Ellipse cx={-3.2} cy={-8} rx={1.6} ry={2.2} fill="#2b2050" />
          <Ellipse cx={3.2} cy={-8} rx={1.6} ry={2.2} fill="#2b2050" />
          <Ellipse cx={0} cy={-3.5} rx={1.6} ry={1.1} fill="#2b2050" />
          <Ellipse cx={0} cy={9} rx={8} ry={1.6} fill={accent} opacity={0.35} />
        </G>
      );
    case 'pumpkinhead':
      return (
        <G>
          <Defs>
            <RadialGradient id="rs_pump_head" cx="40%" cy="35%" r="70%">
              <Stop offset="0" stopColor="#ffd08a" />
              <Stop offset="0.45" stopColor={primary} />
              <Stop offset="1" stopColor="#a8400c" />
            </RadialGradient>
          </Defs>
          <Line x1={-12} y1={6.4} x2={14} y2={6.4} stroke="#7a4a22" strokeWidth={1.4} strokeLinecap="round" />
          <Line x1={-11} y1={6} x2={13} y2={6} stroke="#c08a5e" strokeOpacity={0.7} strokeWidth={0.4} />
          <Path d={`M-12,5 L-20,${2.4 - sway * 0.5} L-21,${6.4} L-20,${10.2 + sway * 0.5} L-12,7.8 Z`} fill="#e0b45a" stroke={OL} strokeWidth={0.5} />
          <Path d="M-14,5.6 L-19,4.4 M-14,7.2 L-19,8.6 M-15,6.4 L-20,6.4" stroke="#9a6a24" strokeWidth={0.4} />
          <Rect x={-13} y={4.6} width={1.6} height={3.6} rx={0.4} fill={accent} stroke={OL} strokeWidth={0.3} />
          <G translateY={-bob * 0.6}>
            <Path d="M-2,5.6 L3,8.4 L5,8.4" stroke="#2a1a3a" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={`M-6,5.6 C-7,0 -5,-5 -1,-5.4 C2.6,-5.4 3.6,-1 2.6,5.6 Z`} fill={accent} stroke={OL} strokeWidth={0.6} />
            <Path d={`M-5.4,-3 C-9,-2 -11,${0 + sway * 0.4} -13.4,${2 + sway * 0.8} L-6,4 Z`} fill="#4a1f72" stroke={OL} strokeWidth={0.4} />
            <Path d="M0,-2.6 L5,3 L7,5.4" stroke={accent} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={7} cy={5.6} r={0.95} fill="#2a1a3a" />
            <Ellipse cx={-1.4} cy={-10} rx={5.4} ry={4.4} fill="url(#rs_pump_head)" stroke={OL} strokeWidth={0.6} />
            <Path d="M-1.4,-14.2 C-2.4,-12 -2.4,-8 -1.4,-5.8 M-4.4,-13.4 C-6,-11 -6,-8.4 -4.6,-6.4 M1.6,-13.4 C3.2,-11 3.2,-8.4 1.8,-6.4" stroke="#b8501a" strokeWidth={0.45} fill="none" />
            <Path d="M-1.6,-14.4 C-1.4,-16 -0.4,-16.8 0.8,-17" stroke="#3f7a2a" strokeWidth={1.2} strokeLinecap="round" fill="none" />
            <Polygon points="0.4,-11.8 2.2,-11.8 1.3,-10.2" fill="#ffe14a" />
            <Polygon points="-3.6,-11.8 -1.8,-11.8 -2.7,-10.2" fill="#ffe14a" />
            <Path d="M-4,-8.6 L-3,-7.6 L-2,-8.4 L-1,-7.4 L0,-8.4 L1,-7.6 L2.4,-8.6 L1.8,-7 L-3.2,-7 Z" fill="#ffe14a" />
          </G>
        </G>
      );
    case 'skeleton':
      return (
        <G>
          <Path d="M-14,8.6 L9,8.6 C13,8.6 15,7 14.4,4.6" stroke="#efe9d6" strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <Circle cx={-14.2} cy={8.6} r={1.1} fill="#efe9d6" stroke={OL} strokeWidth={0.3} />
          <Circle cx={14.6} cy={4} r={1.1} fill="#efe9d6" stroke={OL} strokeWidth={0.3} />
          <Line x1={-9} y1={8.4} x2={-9} y2={5.6} stroke="#d6cfb8" strokeWidth={1} />
          <Line x1={6} y1={8.4} x2={6} y2={5.6} stroke="#d6cfb8" strokeWidth={1} />
          <Rect x={-14} y={3.6} width={25} height={2.4} rx={1.2} fill="#3a2f4a" stroke={OL} strokeWidth={0.5} />
          <Path d="M-12,4.8 L9,4.8" stroke={primary} strokeWidth={0.6} strokeDasharray="1.2 1.2" />
          <G translateY={-bob * 0.6}>
            <Path d="M-3,3.2 L3,3 L7.6,2.6" stroke="#efe9d6" strokeWidth={1.1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M-3,2.2 L3,2" stroke="#efe9d6" strokeWidth={1.1} strokeLinecap="round" />
            <Ellipse cx={8.2} cy={2.6} rx={1.4} ry={0.8} fill="#efe9d6" stroke={OL} strokeWidth={0.3} />
            <Path d="M-5.6,3 L-5.4,-5" stroke="#efe9d6" strokeWidth={1.2} strokeLinecap="round" />
            <Path d="M-7.6,-3.6 L-3.4,-3.6 M-7.8,-1.8 L-3.4,-1.8 M-7.4,0 L-3.6,0" stroke="#efe9d6" strokeWidth={0.8} strokeLinecap="round" />
            <Ellipse cx={-5.4} cy={2.8} rx={2.6} ry={1} fill="#efe9d6" stroke={OL} strokeWidth={0.3} />
            <Path d={`M-4.6,-3.6 L1,-1.4 L${5.6 - sway * 0.4},1.4`} stroke="#efe9d6" strokeWidth={1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={5.8 - sway * 0.4} cy={1.6} r={0.8} fill="#efe9d6" />
            <Path d={`M-6,-5 C-9,-4.6 -11,${-3 + sway * 0.4} -13.6,${-3.6 + sway * 0.8} L-13,${-2 + sway * 0.6} C-10.6,-1.6 -8.6,-2.6 -6,-3.4 Z`} fill={accent} stroke={OL} strokeWidth={0.4} />
            <Circle cx={-4.4} cy={-9.4} r={3.7} fill="#f4efdf" stroke={OL} strokeWidth={0.5} />
            <Rect x={-4.6} y={-7.2} width={3.4} height={2.2} rx={0.6} fill="#f4efdf" stroke={OL} strokeWidth={0.4} />
            <Path d="M-3.8,-6.2 L-1.6,-6.2 M-3,-7 L-3,-5.4 M-2.2,-7 L-2.2,-5.4" stroke={OL} strokeWidth={0.3} />
            <Ellipse cx={-2.4} cy={-9.8} rx={1.2} ry={1.4} fill="#1b1430" />
            <Ellipse cx={-5.6} cy={-9.8} rx={1.1} ry={1.3} fill="#1b1430" />
            <Circle cx={-2.4} cy={-9.8} r={0.4} fill={primary} />
            <Polygon points="-4,-8.4 -3.4,-7.6 -4.4,-7.6" fill="#1b1430" />
          </G>
        </G>
      );
    case 'danceskeleton': {
      // Time-driven dance (not distance-driven) so it keeps grooving even when slow or airborne.
      const tt = motion.t == null ? 0.32 : motion.t;
      const beat = tt * Math.PI * 2 * 1.8;
      const hip = Math.sin(beat) * 1.6;
      const skullBob = Math.abs(Math.sin(beat)) * 1.6;
      const tilt = Math.sin(beat + 0.6) * 10;
      const jaw = Math.max(0, Math.sin(beat * 2)) * 1.1;
      const armL = Math.sin(beat) * 1;
      const armR = Math.sin(beat + Math.PI) * 1;
      const kneeL = Math.max(0, Math.sin(beat)) * 1.4;
      const kneeR = Math.max(0, -Math.sin(beat)) * 1.4;
      const BONE = '#f3f6e8';
      const sx = 1 + hip * 0.06;
      return (
        <G>
          <Rect x={-12} y={6.8} width={24} height={2.2} rx={1.1} fill="#1a2a12" stroke={accent} strokeWidth={0.7} />
          <Circle cx={-8} cy={9.6} r={1.2} fill={accent} stroke={OL} strokeWidth={0.3} />
          <Circle cx={8} cy={9.6} r={1.2} fill={accent} stroke={OL} strokeWidth={0.3} />
          <Path d="M-9,7.9 L9,7.9" stroke={accent} strokeWidth={0.5} strokeDasharray="1 1.4" />
          <G translateY={-bob * 0.4}>
            {/* legs */}
            <Path d={`M${-1.6 + hip * 0.5},-0.4 L${-3.6 - kneeL},${3.4 - kneeL * 0.6} L-4.4,6.6`} stroke={BONE} strokeWidth={1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d={`M${1.6 + hip * 0.5},-0.4 L${3.6 + kneeR},${3.4 - kneeR * 0.6} L4.4,6.6`} stroke={BONE} strokeWidth={1} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Ellipse cx={-4.8} cy={6.6} rx={1.4} ry={0.6} fill={BONE} />
            <Ellipse cx={4.8} cy={6.6} rx={1.4} ry={0.6} fill={BONE} />
            {/* pelvis */}
            <Path d={`M${-2.6 + hip},-1.2 Q${hip},${0.8} ${2.6 + hip},-1.2 L${1.6 + hip},-0.2 L${-1.6 + hip},-0.2 Z`} fill={BONE} stroke={OL} strokeWidth={0.3} />
            {/* spine + ribs */}
            <Path d={`M${hip},-1.2 Q${hip * 0.5},-4 0,-7.2`} stroke={BONE} strokeWidth={0.9} fill="none" />
            <G translateX={hip * 0.3}>
              <Path d={`M${-2.8 * sx},-6.2 Q0,-4.8 ${2.8 * sx},-6.2 M${-2.6 * sx},-4.9 Q0,-3.6 ${2.6 * sx},-4.9 M${-2.2 * sx},-3.6 Q0,-2.5 ${2.2 * sx},-3.6`}
                stroke={BONE} strokeWidth={0.75} fill="none" strokeLinecap="round" />
              {/* arms: alternate up/down swing */}
              <Path d={`M-2.8,-6.6 L${-5.6 - armL},${-4 - armL * 3} L${-6.4 - armL * 1.4},${-8 - armL * 3.4}`} stroke={BONE} strokeWidth={0.9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Path d={`M2.8,-6.6 L${5.6 + armR},${-4 - armR * 3} L${6.4 + armR * 1.4},${-8 - armR * 3.4}`} stroke={BONE} strokeWidth={0.9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={-6.4 - armL * 1.4} cy={-8.4 - armL * 3.4} r={0.8} fill={BONE} />
              <Circle cx={6.4 + armR * 1.4} cy={-8.4 - armR * 3.4} r={0.8} fill={BONE} />
              <Path d="M-1.3,-7.2 L0,-6.6 L1.3,-7.2 L1.3,-6 L0,-6.6 L-1.3,-6 Z" fill="#ff3d7f" stroke={OL} strokeWidth={0.2} />
            </G>
            {/* skull with bob, head tilt and clacking jaw */}
            <G translateY={-skullBob} translateX={hip * 0.4}>
              <G rotation={tilt} originX={0} originY={-9.6}>
                <Rect x={-2} y={-9.4 + jaw} width={4} height={1.8} rx={0.6} fill={BONE} stroke={OL} strokeWidth={0.3} />
                <Path d={`M-1.2,${-8.9 + jaw} L-1.2,${-7.9 + jaw} M0,${-8.9 + jaw} L0,${-7.9 + jaw} M1.2,${-8.9 + jaw} L1.2,${-7.9 + jaw}`} stroke={OL} strokeWidth={0.25} />
                <Circle cx={0} cy={-12} r={3.3} fill={BONE} stroke={OL} strokeWidth={0.45} />
                <Ellipse cx={-1.3} cy={-12.2} rx={0.95} ry={1.15} fill="#10180c" />
                <Ellipse cx={1.3} cy={-12.2} rx={0.95} ry={1.15} fill="#10180c" />
                <Circle cx={-1.3} cy={-12.2} r={0.38} fill={accent} />
                <Circle cx={1.3} cy={-12.2} r={0.38} fill={accent} />
                <Polygon points="0,-11 0.5,-10.2 -0.5,-10.2" fill="#10180c" />
                <Rect x={-3.4} y={-15.8} width={6.8} height={0.9} rx={0.3} fill="#2a1a3a" stroke={OL} strokeWidth={0.3} />
                <Rect x={-2.2} y={-19.4} width={4.4} height={3.8} rx={0.4} fill="#2a1a3a" stroke={OL} strokeWidth={0.3} />
                <Rect x={-2.2} y={-16.8} width={4.4} height={0.8} fill={accent} />
              </G>
            </G>
          </G>
        </G>
      );
    }
    case 'witch':
      return (
        <G>
          <Line x1={-12} y1={6.4} x2={14} y2={5.6} stroke="#6a3f1e" strokeWidth={1.4} strokeLinecap="round" />
          <Path d={`M-12,5 L-20,${2.2 - sway * 0.5} L-21.4,6.6 L-20,${10.6 + sway * 0.5} L-12,7.8 Z`} fill="#c99a48" stroke={OL} strokeWidth={0.5} />
          <Path d="M-14,5.6 L-19,4.2 M-14,7.2 L-19,9 M-15,6.4 L-20.4,6.6" stroke="#8a5f20" strokeWidth={0.4} />
          <Rect x={-13} y={4.6} width={1.6} height={3.6} rx={0.4} fill={primary} stroke={OL} strokeWidth={0.3} />
          <G translateY={-bob * 0.6}>
            <Path d="M-1,5.6 L3,8.6 L5.6,8.2" stroke="#1d1424" strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M5,7.6 L7.4,8.2 L5.6,9" fill="#1d1424" />
            <Path d={`M-7.4,6.6 C-8,1 -6,-4.6 -1.6,-5 C2,-5 3.2,-1 3,6 L0,${7 + sway * 0.4} L-3,${6.2} Z`} fill={primary} stroke={OL} strokeWidth={0.6} />
            <Path d="M-6,0 L2.4,0" stroke={accent} strokeWidth={0.9} />
            <Path d="M-0.6,-2.6 L4.6,1.6 L8,4.6" stroke={primary} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <Circle cx={8.2} cy={4.9} r={0.9} fill="#7fd36a" />
            <Path d={`M-4.6,-8 C-8,-7 -10.6,${-5 + sway * 0.6} -12.6,${-1.6 + sway} L-7,-3 Z`} fill="#ff8a1e" stroke={OL} strokeWidth={0.4} />
            <Circle cx={-2.2} cy={-8.6} r={3.4} fill="#8fdc6e" stroke={OL} strokeWidth={0.5} />
            <Path d="M0.6,-8.6 L2.6,-7.6 L0.8,-7.4 Z" fill="#7fc95c" stroke={OL} strokeWidth={0.3} />
            <Circle cx={-0.8} cy={-9} r={0.55} fill="#1d1424" />
            <Path d="M-1.6,-6.8 Q-0.6,-6.2 0.2,-6.8" stroke="#1d1424" strokeWidth={0.4} fill="none" />
            <Ellipse cx={-2.4} cy={-11.2} rx={6.4} ry={1.3} fill="#1d1424" stroke={OL} strokeWidth={0.4} />
            <Path d={`M-5.8,-11.4 L-2,-20 L${-6 - sway * 0.6},-21.6 L-0.8,-11.4 Z`} fill="#241a2e" stroke={OL} strokeWidth={0.5} />
            <Rect x={-5.4} y={-13} width={4.4} height={1.2} fill={accent} />
          </G>
        </G>
      );
    case 'batglider':
      return (
        <G>
          <Path d="M-11,6.6 L10,6.6 L12,8 L-13,8 Z" fill="#3a1a2a" stroke={OL} strokeWidth={0.5} />
          <Path d="M-12,8.6 L11,8.6" stroke="#8a2a3a" strokeWidth={1} strokeLinecap="round" />
          <Path d="M-9,7.3 L9,7.3" stroke={accent} strokeWidth={0.4} />
          <G translateY={-bob * 0.8}>
            <Path d={`M-15,${-15 - sway * 0.8} C-11,-19 -6,-20 -1,-19 C4,-20 9,-19 13,${-15 - sway * 0.8} C10,-15.6 8.6,-14 8,-12.6 C6,-14 4,-14 2.4,-12.6 C1,-14.2 -3,-14.2 -4.4,-12.6 C-6,-14 -8,-14 -9.6,-12.6 C-10.6,-14 -12.6,-15 -15,${-15 - sway * 0.8} Z`} fill={primary} stroke={OL} strokeWidth={0.6} />
            <Path d="M-1,-19 L-9.6,-12.6 M-1,-19 L-4.4,-12.6 M-1,-19 L2.4,-12.6 M-1,-19 L8,-12.6" stroke="#2a0f3a" strokeWidth={0.4} />
            <Path d="M-7,-14 L-2,-6 M5,-14 L1,-6" stroke="#4a4f60" strokeWidth={0.6} />
            <Path d="M-2.4,0 L-2,6.4 M1.6,0 L2.4,6.4" stroke="#1a1424" strokeWidth={1.8} strokeLinecap="round" />
            <Path d={`M-3.6,1 C-4.4,-3 -3,-6 0,-6 C3,-6 3.8,-3 3,1 Z`} fill="#1a1424" stroke={OL} strokeWidth={0.5} />
            <Path d="M-0.6,-5.6 L0,-2 L0.6,-5.6 Z" fill="#ffffff" />
            <Path d={`M-3.4,-5 C-7,-4 -10,${-1 + sway * 0.6} -12.6,${3 + sway}  L-8,${2 + sway * 0.6} L-5,4 L-3,1 Z`} fill={accent} stroke={OL} strokeWidth={0.4} />
            <Path d="M-2.8,-5 L-1,-7 L1,-7 L2.8,-5" stroke="#c81e3c" strokeWidth={0.9} fill="none" />
            <Path d="M-2,-4.6 L-5,-12.6 M2,-4.6 L4,-12.6" stroke="#e8dcd0" strokeWidth={0.9} strokeLinecap="round" />
            <Circle cx={0.2} cy={-9.4} r={3.2} fill="#e8e2f0" stroke={OL} strokeWidth={0.5} />
            <Path d="M-3.2,-9.4 C-3.4,-12.6 -1,-13.4 0.2,-11.6 C1.4,-13.4 3.8,-12.6 3.4,-9.4 C2.6,-10.8 1.2,-11 0.2,-10.6 C-0.8,-11 -2.4,-10.8 -3.2,-9.4 Z" fill="#141022" />
            <Circle cx={1.4} cy={-9} r={0.55} fill="#ff2a4a" />
            <Path d="M0.6,-7.4 L0.9,-6.6 L1.2,-7.4" fill="#ffffff" />
          </G>
        </G>
      );
    case 'skater':
      return (
        <G>
          <Path d="M-14,5 Q-15,2 -12,3 L12,3 Q15,2 14,5 Z" fill={accent} />
          <Circle cx={-9} cy={8.4} r={2.1} fill="#ffffff" />
          <Circle cx={9} cy={8.4} r={2.1} fill="#ffffff" />
          <G translateY={-bob * 0.8}>
            <Line x1={-4} y1={3} x2={-2} y2={-3} stroke="#3d5bd9" strokeWidth={2.4} strokeLinecap="round" />
            <Line x1={5} y1={3} x2={2} y2={-3} stroke="#3d5bd9" strokeWidth={2.4} strokeLinecap="round" />
            <Path d="M-5,-2 L5,-2 L4,-10 L-4,-10 Z" fill={primary} />
            <Line x1={-4} y1={-8} x2={-10 + sway} y2={-5} stroke="#f1d1b4" strokeWidth={1.6} strokeLinecap="round" />
            <Line x1={4} y1={-8} x2={10 - sway} y2={-11} stroke="#f1d1b4" strokeWidth={1.6} strokeLinecap="round" />
            <Circle cx={0} cy={-14} r={4} fill="#c98f62" />
            <Path d="M-4.4,-15 A4.4,4.4 0 0 1 4.4,-15 Z" fill={accent} />
            <Rect x={-8} y={-16} width={4.4} height={1.5} rx={0.7} fill={accent} />
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
  const [selectedPresetId, setSelectedPresetId] = useState(PIECE_LIBRARY[0].id);
  const [pieceFlip, setPieceFlip] = useState(false);
  const [showPieces, setShowPieces] = useState(false);
  const [lines, setLines] = useState([]);
  const [selectedLineIndex, setSelectedLineIndex] = useState(null);
  const [currentStroke, setCurrentStroke] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rider, setRider] = useState(null);
  const [trail, setTrail] = useState([]);
  const [crashed, setCrashed] = useState(false);
  const [crashReason, setCrashReason] = useState('wipeout');
  const [ownedRiders, setOwnedRiders] = useState(DEFAULT_OWNED_RIDERS);
  const [activeRiderId, setActiveRiderId] = useState('classic');
  const [purchaseBusyId, setPurchaseBusyId] = useState(null);
  const [paymentLedger, setPaymentLedger] = useState({});
  const [storeReady, setStoreReady] = useState(false);
  const [storePrices, setStorePrices] = useState({});
  const [showCharacterShop, setShowCharacterShop] = useState(false);
  const [charTab, setCharTab] = useState('riders');
  const [activeTrailId, setActiveTrailId] = useState('classic');
  const [ownedTrails, setOwnedTrails] = useState(DEFAULT_OWNED_TRAILS);
  const [showSaveSlots, setShowSaveSlots] = useState(false);
  const [showDemoTracks, setShowDemoTracks] = useState(false);
  const [savedTrackSlots, setSavedTrackSlots] = useState(Array.from({ length: TRACK_SAVE_SLOT_COUNT }, () => null));
  const [saveSlotNames, setSaveSlotNames] = useState(Array.from({ length: TRACK_SAVE_SLOT_COUNT }, (_, index) => `Track ${index + 1}`));
  const [adGateBusy, setAdGateBusy] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: SW, height: CANVAS_H });

  // Camera: panX/panY in screen-space, zoom multiplier
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 });
  const prePlayCamRef = useRef(null);
  const simFrameRef = useRef(0);
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  // Snapshot at gesture start for pinch/pan
  const camStartRef = useRef({ x: 0, y: 0, zoom: 1 });

  const riderRef = useRef(null);
  const ridersLoadedRef = useRef(false);
  const trailsLoadedRef = useRef(false);
  const userZoomRef = useRef(1);
  const camDropRef = useRef(0);
  const camScanRef = useRef(0);
  const playingRef = useRef(false);
  const playLookRef = useRef({ x: 0, y: 0, held: false });
  const [autoZoom, setAutoZoom] = useState(true);
  const autoZoomRef = useRef(true);
  playingRef.current = playing;
  autoZoomRef.current = autoZoom;
  const nudgePlayZoom = useCallback((f) => { userZoomRef.current = clampUserZoom(userZoomRef.current * f); }, []);
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

    const loadRiders = async () => {
      try {
        const raw = await getTrackStorage().getItem(RIDER_STORAGE_KEY);
        if (!mounted || !raw) return;
        const parsed = JSON.parse(raw);
        const purchased = (Array.isArray(parsed?.purchased) ? parsed.purchased : [])
          .filter((id) => RIDER_TYPES.some((r) => r.id === id));
        if (purchased.length) setOwnedRiders((prev) => Array.from(new Set([...prev, ...purchased])));
        const known = [...DEFAULT_OWNED_RIDERS, ...purchased];
        if (parsed?.active && known.includes(parsed.active)) setActiveRiderId(parsed.active);
      } catch (_) {
        // Ignore corrupted rider data; store restore can rebuild purchases.
      }
      if (mounted) ridersLoadedRef.current = true;
    };

    const loadTrails = async () => {
      try {
        const raw = await getTrackStorage().getItem(TRAIL_STORAGE_KEY);
        if (mounted && raw) {
          const parsed = JSON.parse(raw);
          const purchased = (Array.isArray(parsed?.purchased) ? parsed.purchased : [])
            .filter((id) => TRAIL_TYPES.some((t) => t.id === id));
          if (purchased.length) setOwnedTrails((prev) => Array.from(new Set([...prev, ...purchased])));
          if (parsed?.active && [...DEFAULT_OWNED_TRAILS, ...purchased].includes(parsed.active)) setActiveTrailId(parsed.active);
        }
      } catch (_) {
        // Ignore corrupted trail data.
      }
      if (mounted) trailsLoadedRef.current = true;
    };

    loadSavedTrackSlots();
    loadAdPlayCount();
    loadRiders();
    loadTrails();
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

  // Defined before any callback that lists them as deps (was a TDZ crash on web/JSC).
  const stopPlay = useCallback(() => {
    setPlaying(false);
    if (prePlayCamRef.current) {
      camRef.current = { ...prePlayCamRef.current };
      setCam({ ...prePlayCamRef.current });
      prePlayCamRef.current = null;
    }
    if (animRef.current) cancelAnimationFrame(animRef.current);
    riderRef.current = null;
    if (!prePlayCamRef.current) prePlayCamRef.current = { ...camRef.current };
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
  }, []);  const resetView = useCallback(() => {
    camRef.current = { x: 0, y: 0, zoom: 1 };
    setCam({ x: 0, y: 0, zoom: 1 });
  }, []);
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
    const preset = PIECE_LIBRARY.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const bounds = getPresetBounds(preset);
    if (!bounds) return;
    // Jumps anchor their entry point (0,0) at the tap so they can be chained onto a track end;
    // the original single-line presets stay centred.
    const centred = preset.anchor === 'center';
    const cx = centred ? (bounds.minX + bounds.maxX) / 2 : 0;
    const cy = centred ? (bounds.minY + bounds.maxY) / 2 : 0;
    const fx = pieceFlip ? -1 : 1;
    const placedLines = preset.lines.map((sourceLine) => ({
      type: sourceLine.type || lineStyle,
      points: sourceLine.points.map((p) => ({
        x: wx + fx * (p.x - cx),
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
  }, [lineStyle, selectedPresetId, pieceFlip]);

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
    if (demoTrack.recommendedRiderId && ownedRiders.includes(demoTrack.recommendedRiderId)) {
      setActiveRiderId(demoTrack.recommendedRiderId);
    }
    requestAnimationFrame(() => {
      resetView();
      requestAnimationFrame(() => fitTrackInView());
    });
  }, [fitTrackInView, ownedRiders, resetView, stopPlay]);

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
      const trails = purchases.map((p) => trailIdFromProductId(p?.productId || p?.id)).filter(Boolean);
      if (trails.length) setOwnedTrails((prev) => Array.from(new Set([...prev, ...trails])));
      if (!unlocked.length) return;
      setOwnedRiders((prev) => Array.from(new Set([...prev, ...unlocked])));
    };

    const initIap = async () => {
      const paidSkus = [...RIDER_TYPES, ...TRAIL_TYPES].map((r) => r.productId).filter(Boolean);
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
              const price = p.displayPrice || p.localizedPrice || (typeof p.price === 'number' ? `$${p.price.toFixed(2)}` : RIDER_FALLBACK_PRICE_LABEL);
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
        const boughtTrail = trailIdFromProductId(productId);
        if (boughtTrail) {
          setOwnedTrails((prev) => Array.from(new Set([...prev, boughtTrail])));
          setActiveTrailId(boughtTrail);
          setPurchaseBusyId(null);
        }
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
      const trails = purchases.map((p) => trailIdFromProductId(p?.productId || p?.id)).filter(Boolean);
      if (!unlocked.length && !trails.length) {
        Alert.alert('Restore Purchases', 'No prior purchases were found.');
        return;
      }
      setOwnedRiders((prev) => Array.from(new Set([...prev, ...unlocked])));
      setOwnedTrails((prev) => Array.from(new Set([...prev, ...trails])));
      Alert.alert('Restore Purchases', `Restored ${unlocked.length + trails.length} purchase(s).`);
    } catch (err) {
      Alert.alert('Restore failed', err?.message || 'Unable to restore purchases right now.');
    }
  }, []);

  useEffect(() => {
    if (!ridersLoadedRef.current) return;
    // Event-granted riders are not stored, so they relock after the Halloween window
    // unless they were actually bought (the store restore re-adds real purchases).
    const purchased = ownedRiders.filter((id) => !DEFAULT_OWNED_RIDERS.includes(id));
    getTrackStorage().setItem(RIDER_STORAGE_KEY, JSON.stringify({ purchased, active: activeRiderId })).catch(() => {});
  }, [ownedRiders, activeRiderId]);

  useEffect(() => {
    if (!trailsLoadedRef.current) return;
    // Event-granted (Halloween) trails are not stored, so they relock after the event unless bought.
    const purchased = ownedTrails.filter((id) => !DEFAULT_OWNED_TRAILS.includes(id));
    getTrackStorage().setItem(TRAIL_STORAGE_KEY, JSON.stringify({ purchased, active: activeTrailId })).catch(() => {});
  }, [ownedTrails, activeTrailId]);

  useEffect(() => {
    // If the active trail relocks (event ended), fall back to Classic.
    if (!ownedTrails.includes(activeTrailId) && trailsLoadedRef.current) setActiveTrailId('classic');
  }, [ownedTrails, activeTrailId]);

  const activateOrPurchaseTrail = useCallback(async (trailId) => {
    const cfg = TRAIL_TYPES.find((t) => t.id === trailId) || TRAIL_TYPES[0];
    if (ownedTrails.includes(trailId) || cfg.priceUsd <= 0) {
      if (!ownedTrails.includes(trailId)) setOwnedTrails((prev) => [...prev, trailId]);
      setActiveTrailId(trailId);
      return;
    }
    if (purchaseBusyId) return;
    if (Platform.OS === 'web') {
      Alert.alert('Unlock in the app', `${cfg.name} can be unlocked in the iOS app.`);
      return;
    }
    if (!storeReady || !cfg.productId) {
      Alert.alert('Store unavailable', 'In-app purchases are not ready yet. Try again in a moment.');
      return;
    }
    setPurchaseBusyId(trailId);
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
  }, [ownedTrails, purchaseBusyId, storeReady]);

  const activateOrPurchaseRider = useCallback(async (riderId) => {
    const cfg = riderConfig(riderId);
    const alreadyOwned = ownedRiders.includes(riderId);
    if (alreadyOwned || cfg.priceUsd <= 0) {
      if (!alreadyOwned) setOwnedRiders((prev) => [...prev, riderId]);
      setActiveRiderId(riderId);
      return;
    }
    if (purchaseBusyId) return;
    if (Platform.OS === 'web') {
      Alert.alert('Unlock in the app', `${cfg.name} can be unlocked in the iOS app.`);
      return;
    }
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

  // 1-finger draw / erase / move
  const drawGesture = Gesture.Pan()
    .maxPointers(1)
    .enabled(!playing)
    .onStart((e) => {
      const w = s2w(e.x, e.y);
      if (tool === 'draw') {
        setCurrentStroke([w]);
      } else if (tool === 'move') {
        setCurrentStroke([]);
        camStartRef.current = { ...camRef.current };
      } else if (tool === 'erase') {
        eraseAt(w.x, w.y);
      } else if (tool === 'preset') {
        placePresetAt(w.x, w.y);
      } else if (tool === 'edit') {
        selectLineAt(w.x, w.y);
      }
    })
    .onUpdate((e) => {
      if (tool === 'move') {
        const c = camRef.current;
        c.x = camStartRef.current.x + e.translationX * CAMERA_PAN_MULT;
        c.y = camStartRef.current.y + e.translationY * CAMERA_PAN_MULT;
        setCam({ ...c });
        return;
      }
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
      if (tool === 'preset' || tool === 'edit' || tool === 'move') return;
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
      if (!success || tool === 'preset' || tool === 'move' || !linesRef.current.length) return;
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
      if (playingRef.current) playLookRef.current.held = true;
    })
    .onEnd(() => { playLookRef.current.held = false; })
    .onFinalize(() => { playLookRef.current.held = false; })
    .onUpdate((e) => {
      if (playingRef.current) {
        // brief look-around while riding; the follow camera springs back on release
        const z = camRef.current.zoom || 1;
        playLookRef.current.x = -e.translationX * CAMERA_PAN_MULT / z;
        playLookRef.current.y = -e.translationY * CAMERA_PAN_MULT / z;
        return;
      }
      const c = camRef.current;
      c.x = camStartRef.current.x + e.translationX * CAMERA_PAN_MULT;
      c.y = camStartRef.current.y + e.translationY * CAMERA_PAN_MULT;
      setCam({ ...c });
    });

  // Pinch to zoom
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      camStartRef.current = { ...camRef.current, userZoom: userZoomRef.current };
    })
    .onUpdate((e) => {
      if (playingRef.current) {
        userZoomRef.current = clampUserZoom((camStartRef.current.userZoom || 1) * e.scale);
        return;
      }
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

  // Mouse wheel / trackpad zoom on web while riding (adjusts the user multiplier).
  useEffect(() => {
    if (Platform.OS !== 'web' || !playing || typeof window === 'undefined') return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      userZoomRef.current = clampUserZoom(userZoomRef.current * Math.exp(-e.deltaY * 0.0015));
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [playing]);

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
    userZoomRef.current = 1;
    playLookRef.current = { x: 0, y: 0, held: false };
    camDropRef.current = 0;
    setPlaying(true);
  }, [activeRiderId, lines, maybeShowPlayInterstitial]);



  /* ══════════ PHYSICS LOOP ══════════ */
  useEffect(() => {
    if (!playing) return;
    const simulateStep = (r) => {
      {
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
              if (simFrameRef.current - lastPortalFrameRef.current < PORTAL_COOLDOWN_FRAMES) continue;
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
                    lastPortalFrameRef.current = simFrameRef.current;
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
        if (trailRef.current.length > TRAIL_MAX_POINTS) trailRef.current.shift();
      }
      simFrameRef.current++;
    };

    let lastTime = null;
    let accumulator = 0;
    let lastRenderAt = 0;
    const tick = (ts) => {
      const r = riderRef.current;
      if (!r) return;
      const nowTs = typeof ts === 'number' ? ts : Date.now();
      const frameMs = lastTime == null ? SIM_DT_MS : Math.min(250, nowTs - lastTime);
      lastTime = nowTs;
      accumulator += frameMs;
      let steps = 0;
      while (accumulator >= SIM_DT_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
        if (!r.crashed) simulateStep(r);
        accumulator -= SIM_DT_MS;
        steps++;
      }
      if (steps >= MAX_SIM_STEPS_PER_FRAME) accumulator = 0;

      if (!r.crashed) {
        // Camera follow: dt-based exponential smoothing toward rider + velocity lead, zoomed in.
        const dtSec = frameMs / 1000;
        const c = camRef.current;
        const zoomK = 1 - Math.exp(-PLAY_CAM_ZOOM_RATE * dtSec);
        const posK = 1 - Math.exp(-PLAY_CAM_POS_RATE * dtSec);
        const prevZoom = c.zoom;
        let autoTarget = PLAY_CAM_ZOOM;
        if (autoZoomRef.current) {
          const topSpeed = riderConfig(activeRiderId).topSpeed || 20;
          const speedT = Math.min(1, Math.hypot(r.vx, r.vy) / topSpeed);
          autoTarget = PLAY_CAM_ZOOM_MAX + (PLAY_CAM_ZOOM_MIN - PLAY_CAM_ZOOM_MAX) * speedT;
          if (!r.onGround) autoTarget *= PLAY_CAM_AIR_ZOOM;
          // scan upcoming terrain (every few frames) for a big drop ahead
          if ((camScanRef.current++ % 6) === 0) {
            const dir = r.vx >= 0 ? 1 : -1;
            let lowest = r.y;
            for (const ln of linesRef.current) {
              const pts = ln.points || [];
              for (let i = 0; i < pts.length; i++) {
                const ahead = (pts[i].x - r.x) * dir;
                if (ahead > 0 && ahead < PLAY_CAM_LOOKAHEAD && pts[i].y > lowest) lowest = pts[i].y;
              }
            }
            camDropRef.current = Math.min(1, Math.max(0, lowest - r.y) / PLAY_CAM_DROP_REF);
          }
          autoTarget *= 1 + (PLAY_CAM_DROP_ZOOM - 1) * camDropRef.current;
        }
        const zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, autoTarget * userZoomRef.current));
        const nextZoom = prevZoom + (zoomTarget - prevZoom) * zoomK;
        // keep the screen-center world point fixed while zooming, then follow
        const cx = canvasSize.width / 2;
        const cy = canvasSize.height / 2;
        const wcx = (cx - c.x) / prevZoom;
        const wcy = (cy - c.y) / prevZoom;
        c.zoom = nextZoom;
        c.x = cx - wcx * nextZoom;
        c.y = cy - wcy * nextZoom;
        let leadX = r.vx * PLAY_CAM_LEAD;
        let leadY = r.vy * PLAY_CAM_LEAD * 0.6;
        const leadLen = Math.hypot(leadX, leadY);
        if (leadLen > PLAY_CAM_LEAD_MAX) { leadX *= PLAY_CAM_LEAD_MAX / leadLen; leadY *= PLAY_CAM_LEAD_MAX / leadLen; }
        const look = playLookRef.current;
        if (!look.held) {
          const lk = Math.exp(-PLAY_CAM_LOOK_RETURN_RATE * dtSec);
          look.x *= lk; look.y *= lk;
        }
        const targetX = cx - (r.x + leadX + look.x) * c.zoom;
        const targetY = cy - (r.y + leadY + look.y) * c.zoom;
        c.x += (targetX - c.x) * posK;
        c.y += (targetY - c.y) * posK;
      }

      // Publish to React at ~30Hz regardless of display refresh.
      if (nowTs - lastRenderAt >= 32) {
        lastRenderAt = nowTs;
        setRider(riderRef.current ? { ...riderRef.current } : null);
        setTrail([...trailRef.current]);
        setCam({ ...camRef.current });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    frameCountRef.current = 0;
    simFrameRef.current = 0;
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [activeRiderId, canvasSize.height, canvasSize.width, playSfx, playing]);


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
  // Haunted Hill sits first during the Halloween event, last otherwise.
  const demoTracks = HALLOWEEN_ACTIVE
    ? DEMO_TRACK_LIBRARY
    : [...DEMO_TRACK_LIBRARY.slice(1), DEMO_TRACK_LIBRARY[0]];
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
    t: currentRiderCfg.dances ? Date.now() / 1000 : undefined,
  };

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={s.title}>⛷ SKETCH RIDER</Text>
          <Text style={s.subtitle}>NEON</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={[s.toolGroup, s.toolGroupLeft]}>
          {[
            { id: 'draw', icon: '✏️', label: 'Draw' },
            { id: 'erase', icon: '🧹', label: 'Erase' },
            { id: 'preset', icon: '🧩', label: 'Pieces' },
          ].map(({ id, icon, label }) => (
            <TouchableOpacity key={id} onPress={() => { if (playing) return; if (id === 'preset') setShowPieces(true); setTool(id); }}
              accessibilityLabel={label}
              style={[s.toolBtn, tool === id && s.toolBtnActive]} disabled={playing}>
              <Text style={{ fontSize: 14 }}>{icon}</Text>
              <Text style={[s.toolLabel, tool === id && s.toolLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
          {CHARACTER_SHOP_ENABLED && (
            <TouchableOpacity onPress={() => !playing && setShowCharacterShop(true)} disabled={playing}
              style={[s.toolBtn, s.charactersBtn]} accessibilityLabel="Characters">
              <Text style={{ fontSize: 14 }}>{activeRiderCfg.icon || '⛷'}</Text>
              <Text style={[s.toolLabel, s.charactersBtnLabel]}>Characters</Text>
            </TouchableOpacity>
          )}
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

      {!playing && tool === 'preset' && (() => {
        const piece = PIECE_LIBRARY.find((p) => p.id === selectedPresetId) || PIECE_LIBRARY[0];
        return (
          <View style={s.presetBar}>
            <TouchableOpacity onPress={() => setShowPieces(true)} style={[s.presetBtn, s.presetBtnActive]}>
              <Text style={[s.presetLabel, s.presetLabelActive]}>{piece.icon} {piece.label} ▾</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPieceFlip((f) => !f)} style={[s.presetBtn, pieceFlip && s.presetBtnActive]}
              accessibilityLabel="Flip piece">
              <Text style={[s.presetLabel, pieceFlip && s.presetLabelActive]}>⇋ Flip</Text>
            </TouchableOpacity>
            <Text style={s.presetHint}>Tap canvas to place</Text>
          </View>
        );
      })()}

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
                <Stop offset="0" stopColor={HALLOWEEN_ACTIVE ? '#12051f' : '#0a0a1a'} />
                <Stop offset="1" stopColor={HALLOWEEN_ACTIVE ? '#2c0f45' : '#1a1a2e'} />
              </LinearGradient>
              <RadialGradient id="portalHaze" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#12001d" stopOpacity="0.92" />
                <Stop offset="0.36" stopColor="#7d2cff" stopOpacity="0.48" />
                <Stop offset="0.68" stopColor="#ff58d2" stopOpacity="0.2" />
                <Stop offset="1" stopColor="#2b074d" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width={canvasSize.width} height={canvasSize.height} fill="url(#bg)" />
            {HALLOWEEN_ACTIVE && (
              <G>
                {/* Seasonal sky: fixed to the screen, behind the track. */}
                <Circle cx={canvasSize.width - 70} cy={88} r={64} fill="#ffd9a0" opacity={0.08} />
                <Circle cx={canvasSize.width - 70} cy={88} r={40} fill="#ffe7b8" opacity={0.92} />
                <Circle cx={canvasSize.width - 82} cy={78} r={7} fill="#e8c98e" opacity={0.7} />
                <Circle cx={canvasSize.width - 58} cy={102} r={5} fill="#e8c98e" opacity={0.6} />
                <Circle cx={canvasSize.width - 60} cy={70} r={3.4} fill="#e8c98e" opacity={0.6} />
                {[[0.08, 0.06], [0.22, 0.14], [0.36, 0.05], [0.5, 0.18], [0.62, 0.08], [0.14, 0.3], [0.44, 0.34], [0.72, 0.28], [0.9, 0.4], [0.3, 0.46]].map(([fx, fy], k) => (
                  <Circle key={k} cx={fx * canvasSize.width} cy={fy * canvasSize.height} r={k % 3 === 0 ? 1.6 : 1} fill="#e9d8ff" opacity={0.55} />
                ))}
                <Path d={`M${canvasSize.width * 0.18},${canvasSize.height * 0.1} q6,-6 12,0 q6,-6 12,0 q-6,2 -12,6 q-6,-4 -12,-6 z`} fill="#0b0414" opacity={0.85} />
                <Path d={`M${canvasSize.width * 0.55},${canvasSize.height * 0.06} q5,-5 10,0 q5,-5 10,0 q-5,2 -10,5 q-5,-3 -10,-5 z`} fill="#0b0414" opacity={0.85} />
              </G>
            )}

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
                        <Ellipse cx={mid.x} cy={mid.y} rx={21} ry={45} fill="none" stroke={PORTAL_SKIN.ring}
                          strokeWidth={11} opacity={0.42} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={14} ry={38} fill="none" stroke={PORTAL_SKIN.main}
                          strokeWidth={6.4} opacity={0.96} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={8} ry={27} fill="none" stroke={PORTAL_SKIN.inner}
                          strokeWidth={2.2} opacity={0.72} />
                        <Path d={swirlA} stroke={PORTAL_SKIN.swirlA} strokeWidth={2.4}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.78} />
                        <Path d={swirlB} stroke={PORTAL_SKIN.swirlB} strokeWidth={1.9}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.7} />
                        <Path d={flamePathA} stroke={PORTAL_SKIN.flameA} strokeWidth={4.8}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.84} />
                        <Path d={flamePathB} stroke={PORTAL_SKIN.flameB} strokeWidth={2.7}
                          strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.9} />
                        <Ellipse cx={mid.x} cy={mid.y} rx={4.5} ry={17} fill={PORTAL_SKIN.core}
                          stroke={PORTAL_SKIN.coreStroke} strokeWidth={1.4} opacity={0.88} />
                        <Circle cx={mid.x - 13} cy={mid.y - 34} r={2.3} fill={PORTAL_SKIN.dotA} opacity={0.8} />
                        <Circle cx={mid.x + 14} cy={mid.y + 35} r={1.9} fill={PORTAL_SKIN.dotB} opacity={0.72} />
                      </G>
                      <Circle cx={mid.x} cy={mid.y} r={4.5} fill={PORTAL_SKIN.center} opacity={0.72} />
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
                      {HALLOWEEN_ACTIVE && pts.length >= 2 && (() => {
                        // Pumpkin skin: ribbed rind plus a jack-o-lantern face and stem at the middle.
                        const m = pts[Math.floor(pts.length / 2)];
                        return (
                          <G>
                            <Path d={pointsToPath(pts)} stroke="#a8400c" strokeWidth={TRACK_WIDTH}
                              strokeDasharray="2 9" fill="none" />
                            <Circle cx={m.x} cy={m.y + 1} r={9} fill="#ff8a1e" stroke="#a8400c" strokeWidth={1.4} />
                            <Path d={`M${m.x},${m.y - 8} q1,-5 5,-6`} stroke="#3f7a2a" strokeWidth={2.4} strokeLinecap="round" fill="none" />
                            <Polygon points={`${m.x - 5},${m.y - 2} ${m.x - 2},${m.y - 2} ${m.x - 3.5},${m.y + 1}`} fill="#ffe14a" />
                            <Polygon points={`${m.x + 2},${m.y - 2} ${m.x + 5},${m.y - 2} ${m.x + 3.5},${m.y + 1}`} fill="#ffe14a" />
                            <Path d={`M${m.x - 5},${m.y + 4} l2,2 l1.5,-1.5 l1.5,1.5 l1.5,-1.5 l1.5,1.5 l2,-2 l-1,3 h-8 z`} fill="#ffe14a" />
                          </G>
                        );
                      })()}
                    </React.Fragment>
                  );
                }
                if (cfg.skin === 'slime') {
                  const drips = pts.filter((_, k) => k % 3 === 1);
                  return (
                    <React.Fragment key={idx}>
                      {isSelected && (
                        <Path d={pointsToPath(pts)} stroke="#ffffff" strokeWidth={TRACK_WIDTH + 12} strokeLinecap="round"
                          strokeLinejoin="round" fill="none" strokeDasharray="5 5" opacity={0.38} />
                      )}
                      <Path d={pointsToPath(pts)} stroke={cfg.glow} strokeWidth={TRACK_WIDTH + 9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <Path d={pointsToPath(pts)} stroke="#2f9a1e" strokeWidth={TRACK_WIDTH + 3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      {drips.map((d, k) => (
                        <G key={k}>
                          <Path d={`M${d.x - 3},${d.y + 2} Q${d.x},${d.y + 10 + (k % 3) * 4} ${d.x + 3},${d.y + 2} Z`} fill="#5fe63c" />
                          <Circle cx={d.x} cy={d.y + 9 + (k % 3) * 4} r={2.4} fill="#7dff5a" />
                        </G>
                      ))}
                      <Path d={pointsToPath(pts)} stroke={cfg.color} strokeWidth={TRACK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <Path d={pointsToPath(pts)} stroke="#e6ffd8" strokeOpacity={0.6} strokeWidth={1.2} strokeDasharray="10 14" fill="none" />
                    </React.Fragment>
                  );
                }
                if (cfg.skin === 'cobweb') {
                  const a = pts[0];
                  const b = pts[pts.length - 1];
                  const knots = pts.filter((_, k) => k % 2 === 0);
                  return (
                    <G key={idx} opacity={0.85}>
                      {isSelected && (
                        <Path d={pointsToPath(pts)} stroke="#ffffff" strokeWidth={10} strokeLinecap="round"
                          strokeLinejoin="round" fill="none" strokeDasharray="5 5" opacity={0.38} />
                      )}
                      <Path d={pointsToPath(pts)} stroke={cfg.color} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      {a && b && knots.map((k2, k) => (
                        <Path key={k} d={`M${a.x},${a.y} Q${(a.x + k2.x) / 2},${(a.y + k2.y) / 2 + 6} ${k2.x},${k2.y} M${k2.x},${k2.y} Q${(b.x + k2.x) / 2},${(b.y + k2.y) / 2 + 6} ${b.x},${b.y}`}
                          stroke={cfg.color} strokeWidth={0.7} fill="none" opacity={0.55} />
                      ))}
                      {knots.map((k2, k) => <Circle key={`k${k}`} cx={k2.x} cy={k2.y} r={1.3} fill="#f4f0ff" />)}
                    </G>
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
                renderTrail(activeTrailId, trail, currentRiderCfg?.trailColor || currentRiderCfg?.color, Date.now() / 1000)
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
                <G translateX={rider.x} translateY={rider.y}>
                  <Circle r={RIDER_VISUAL_RADIUS * 2.1} fill={currentRiderCfg?.color || '#66d7ff'} opacity={0.12} />
                  <Circle r={RIDER_VISUAL_RADIUS * 1.35} fill={currentRiderCfg?.color || '#66d7ff'} opacity={0.22} />
                  <G rotation={rAngle}>
                    <G translateY={-RIDER_SPRITE_LIFT} scale={RIDER_SPRITE_SCALE}>
                    {renderCharacterSprite(rider.riderTypeId || activeRiderId, currentRiderCfg, riderMotion)}
                    </G>
                  </G>
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
                if (playing) { nudgePlayZoom(1.25); return; }
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
                if (playing) { nudgePlayZoom(0.8); return; }
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
              {playing ? (
                <TouchableOpacity
                  style={[s.zoomBtnWide, s.autoZoomBtn, autoZoom && s.autoZoomBtnOn]}
                  onPress={() => { setAutoZoom((v) => !v); userZoomRef.current = 1; }}
                  accessibilityLabel="Toggle auto zoom"
                >
                  <Text style={[s.zoomBtnTextSmall, autoZoom && s.autoZoomTextOn]}>AUTO</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={s.zoomBtn} onPress={resetView}>
                    <Text style={s.zoomBtnText}>⟳</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.zoomBtn} onPress={fitTrackInView} disabled={!lines.length}>
                    <Text style={[s.zoomBtnText, !lines.length && s.zoomBtnTextDisabled]}>□</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {!playing && (
            <TouchableOpacity
              style={[s.moveFab, tool === 'move' && s.moveFabActive]}
              onPress={() => {
                setCurrentStroke([]);
                setTool((prev) => (prev === 'move' ? 'draw' : 'move'));
              }}
            >
              <Text style={[s.moveFabIcon, tool === 'move' && s.moveFabIconActive]}>↔</Text>
            </TouchableOpacity>
          )}

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
              <Text style={s.emptySubtext}>Tap ↔ to move with one finger</Text>
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

      <Modal visible={showPieces} animationType="fade" transparent onRequestClose={() => setShowPieces(false)}>
        <View style={s.charBackdrop}>
          <View style={s.charSheet}>
            <View style={s.charHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.charTitle}>PIECES</Text>
                <Text style={s.charSubtitle}>Pick one, then tap the canvas · becomes normal editable lines</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPieces(false)} style={s.charCloseBtn} accessibilityLabel="Close pieces">
                <Text style={s.charCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {PIECE_CATEGORIES.map((cat) => (
                <View key={cat.id}>
                  <Text style={s.pieceSection}>{cat.label}</Text>
                  <View style={s.charGrid}>
                    {PIECE_LIBRARY.filter((p) => p.category === cat.id).map((piece) => {
                      const active = piece.id === selectedPresetId;
                      return (
                        <TouchableOpacity key={piece.id} accessibilityLabel={`Piece ${piece.label}`}
                          style={[s.charCard, { borderColor: active ? '#00ffc8' : 'rgba(124,226,255,0.18)' }]}
                          onPress={() => { setSelectedPresetId(piece.id); setTool('preset'); setShowPieces(false); }}>
                          <View style={s.charArt}><PiecePreview piece={piece} flip={pieceFlip} /></View>
                          <Text style={[s.charName, active && { color: '#00ffc8' }]} numberOfLines={1}>{piece.icon} {piece.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={s.charFooter}>
              <TouchableOpacity onPress={() => setPieceFlip((f) => !f)} style={s.charRestoreBtn} accessibilityLabel="Flip pieces">
                <Text style={s.charRestoreText}>{pieceFlip ? '⇋ Flipped (ride ←)' : '⇋ Flip (ride →)'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPieces(false)} style={s.charDoneBtn}>
                <Text style={s.charDoneText}>DONE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {CHARACTER_SHOP_ENABLED && (
        <Modal
          visible={showCharacterShop}
          animationType="fade"
          transparent
          onRequestClose={() => setShowCharacterShop(false)}
        >
          <View style={s.charBackdrop}>
            <View style={s.charSheet}>
              <View style={s.charHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.charTitle}>{charTab === 'trails' ? 'TRAILS' : 'CHARACTERS'}</Text>
                  <Text style={s.charSubtitle}>
                    {charTab === 'trails'
                      ? `${ownedTrails.length}/${TRAIL_TYPES.length} unlocked · works with any rider`
                      : `${ownedRiders.length}/${RIDER_TYPES.length} unlocked · tap to ride`}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setShowCharacterShop(false)} style={s.charCloseBtn}
                  accessibilityLabel="Close characters">
                  <Text style={s.charCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={s.charTabs}>
                {[['riders', '🏂 Riders'], ['trails', '✨ Trails']].map(([id, label]) => (
                  <TouchableOpacity key={id} onPress={() => setCharTab(id)}
                    style={[s.charTab, charTab === id && s.charTabActive]} accessibilityLabel={`${label} tab`}>
                    <Text style={[s.charTabText, charTab === id && s.charTabTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {charTab === 'trails' ? (
              <ScrollView contentContainerStyle={s.charGrid}>
                {TRAIL_TYPES.map((tt) => {
                  const owned = ownedTrails.includes(tt.id);
                  const active = activeTrailId === tt.id;
                  const busy = purchaseBusyId === tt.id;
                  const price = storePrices[tt.productId] || RIDER_FALLBACK_PRICE_LABEL;
                  const demo = Array.from({ length: 22 }, (_, i) => ({ x: -21 + i * 1.9, y: 2 + Math.sin(i * 0.38) * 5 }));
                  return (
                    <TouchableOpacity
                      key={tt.id}
                      style={[s.charCard, { borderColor: active ? tt.color : 'rgba(124,226,255,0.18)' },
                        active && { shadowColor: tt.color, backgroundColor: 'rgba(20,34,70,0.98)' }]}
                      onPress={() => activateOrPurchaseTrail(tt.id)}
                      disabled={busy}
                      accessibilityLabel={owned ? `Select ${tt.name} trail` : `Unlock ${tt.name} trail for ${price}`}
                    >
                      <View style={s.charArt}>
                        <Svg width="100%" height="100%" viewBox="-24 -16 48 32">
                          <G opacity={owned ? 1 : 0.45}>
                            {renderTrail(tt.id, demo, currentRiderCfg?.trailColor || '#66d7ff', 1.3, 0.35)}
                          </G>
                        </Svg>
                        {!owned && (
                          <View style={s.charLockBadge}><Text style={s.charLockIcon}>🔒</Text></View>
                        )}
                        {tt.seasonal === 'halloween' && (
                          <View style={s.charEventBadge}><Text style={s.charEventText}>🎃</Text></View>
                        )}
                      </View>
                      <Text style={[s.charName, active && { color: tt.color }]} numberOfLines={1}>{tt.icon} {tt.name}</Text>
                      <View style={[s.charPill, active ? { backgroundColor: tt.color } : (owned ? s.charPillOwned : s.charPillLocked)]}>
                        <Text style={[s.charPillText, active && { color: '#0a0a1a' }, !owned && { color: '#ffd23b' }]}>
                          {active ? 'SELECTED' : (owned ? (tt.priceUsd > 0 && tt.seasonal && HALLOWEEN_ACTIVE ? 'FREE · EVENT' : 'USE') : (busy ? '…' : price))}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              ) : (
              <ScrollView contentContainerStyle={s.charGrid}>
                {RIDER_TYPES.map((rt) => {
                  const owned = ownedRiders.includes(rt.id);
                  const active = activeRiderId === rt.id;
                  const busy = purchaseBusyId === rt.id;
                  const price = storePrices[rt.productId] || RIDER_FALLBACK_PRICE_LABEL;
                  return (
                    <TouchableOpacity
                      key={rt.id}
                      style={[s.charCard, { borderColor: active ? rt.color : 'rgba(124,226,255,0.18)' },
                        active && { shadowColor: rt.color, backgroundColor: 'rgba(20,34,70,0.98)' }]}
                      onPress={() => activateOrPurchaseRider(rt.id)}
                      disabled={busy}
                      accessibilityLabel={owned ? `Select ${rt.name}` : `Unlock ${rt.name} for ${price}`}
                    >
                      <View style={s.charArt}>
                        <Svg width="100%" height="100%" viewBox="-24 -24 48 38">
                          <Defs>
                            <RadialGradient id={`cg_${rt.id}`} cx="50%" cy="60%" r="55%">
                              <Stop offset="0" stopColor={rt.color} stopOpacity={owned ? 0.35 : 0.14} />
                              <Stop offset="1" stopColor={rt.color} stopOpacity={0} />
                            </RadialGradient>
                          </Defs>
                          <Rect x={-24} y={-24} width={48} height={38} fill={`url(#cg_${rt.id})`} />
                          <Line x1={-22} y1={9.4} x2={22} y2={9.4} stroke={rt.trailColor || rt.color} strokeWidth={1.2}
                            strokeOpacity={owned ? 0.8 : 0.3} strokeLinecap="round" />
                          <G opacity={owned ? 1 : 0.42}>
                            {renderCharacterSprite(rt.id, rt, {})}
                          </G>
                        </Svg>
                        {!owned && (
                          <View style={s.charLockBadge}>
                            <Text style={s.charLockIcon}>🔒</Text>
                          </View>
                        )}
                        {rt.seasonal === 'halloween' && (
                          <View style={s.charEventBadge}><Text style={s.charEventText}>🎃</Text></View>
                        )}
                      </View>
                      <Text style={[s.charName, active && { color: rt.color }]} numberOfLines={1}>{rt.name}</Text>
                      <View style={[s.charPill, active ? { backgroundColor: rt.color } : (owned ? s.charPillOwned : s.charPillLocked)]}>
                        <Text style={[s.charPillText, active && { color: '#0a0a1a' }, !owned && { color: '#ffd23b' }]}>
                          {active ? 'SELECTED' : (owned ? 'RIDE' : (busy ? '…' : price))}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              )}

              <View style={s.charFooter}>
                <TouchableOpacity onPress={restoreRiderPurchases} style={s.charRestoreBtn}>
                  <Text style={s.charRestoreText}>Restore Purchases</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowCharacterShop(false)} style={s.charDoneBtn}>
                  <Text style={s.charDoneText}>DONE</Text>
                </TouchableOpacity>
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
  moveFab: { position: 'absolute', bottom: Platform.OS === 'ios' ? 34 : 18, left: 16, zIndex: 11,
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(10,10,26,0.92)', borderWidth: 1.5, borderColor: 'rgba(124,226,255,0.35)' },
  moveFabActive: { backgroundColor: 'rgba(0,255,200,0.18)', borderColor: '#00ffc8' },
  moveFabIcon: { color: '#dff7ff', fontSize: 24, fontWeight: '900' },
  moveFabIconActive: { color: '#00ffc8' },
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
  autoZoomBtn: { paddingHorizontal: 8, marginLeft: 2 },
  autoZoomBtnOn: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.16)' },
  autoZoomTextOn: { color: '#00ffc8' },
  charactersBtn: { borderColor: '#ff4fd8', backgroundColor: 'rgba(255,79,216,0.12)' },
  charactersBtnLabel: { color: '#ff9be8', fontWeight: '800' },
  pieceSection: { color: '#ffd23b', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, marginBottom: 6, marginTop: 4, marginLeft: 2 },
  charBackdrop: { flex: 1, backgroundColor: 'rgba(3,4,14,0.78)', justifyContent: 'center', alignItems: 'center', padding: 14 },
  charSheet: { width: '100%', maxWidth: 520, maxHeight: '88%', borderRadius: 22, borderWidth: 1.5, borderColor: 'rgba(0,255,200,0.55)',
    backgroundColor: 'rgba(10,12,30,0.98)', paddingTop: 16, paddingHorizontal: 12, paddingBottom: 12,
    shadowColor: '#00ffc8', shadowOpacity: 0.45, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  charTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 6, marginBottom: 10 },
  charTab: { flex: 1, paddingVertical: 8, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(124,226,255,0.2)', backgroundColor: 'rgba(255,255,255,0.03)' },
  charTabActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.12)' },
  charTabText: { color: 'rgba(255,255,255,0.55)', fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  charTabTextActive: { color: '#00ffc8' },
  charHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, marginBottom: 10 },
  charTitle: { color: '#00ffc8', fontSize: 22, fontWeight: '900', letterSpacing: 3,
    textShadowColor: 'rgba(0,255,200,0.6)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  charSubtitle: { color: 'rgba(223,247,255,0.6)', fontSize: 12, marginTop: 2, letterSpacing: 0.5 },
  charCloseBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  charCloseText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  charGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 6 },
  charCard: { width: '31.5%', marginBottom: 10, borderRadius: 14, borderWidth: 1.5, padding: 6, alignItems: 'center',
    backgroundColor: 'rgba(16,22,48,0.95)', shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  charArt: { width: '100%', aspectRatio: 48 / 38, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(5,7,20,0.9)' },
  charLockBadge: { position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)', borderWidth: 1, borderColor: '#ffd23b', alignItems: 'center', justifyContent: 'center' },
  charLockIcon: { fontSize: 12 },
  charEventBadge: { position: 'absolute', left: 4, top: 4 },
  charEventText: { fontSize: 13 },
  charName: { color: '#dff7ff', fontSize: 11.5, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  charPill: { marginTop: 5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, minWidth: 64, alignItems: 'center' },
  charPillOwned: { backgroundColor: 'rgba(0,255,200,0.14)', borderWidth: 1, borderColor: 'rgba(0,255,200,0.5)' },
  charPillLocked: { backgroundColor: 'rgba(255,210,59,0.1)', borderWidth: 1, borderColor: 'rgba(255,210,59,0.6)' },
  charPillText: { color: '#00ffc8', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  charFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(124,226,255,0.15)' },
  charRestoreBtn: { paddingVertical: 10, paddingHorizontal: 8 },
  charRestoreText: { color: '#7ce2ff', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  charDoneBtn: { backgroundColor: '#00ffc8', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 26 },
  charDoneText: { color: '#0a0a1a', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
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
