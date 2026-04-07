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
  View, Text, TouchableOpacity, Dimensions, Alert, ScrollView, Modal,
  StyleSheet, StatusBar, Platform,
} from 'react-native';
import * as RNIap from 'react-native-iap';
import Svg, {
  Path, Circle, G, Line, Rect, Polygon,
  Defs, LinearGradient, Stop,
} from 'react-native-svg';
import {
  GestureDetector, Gesture,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';

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
const EDGE_PAN_SPEED = 13;

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
  { id: 'normal', label: 'Normal', color: '#7ce2ff', glow: 'rgba(124,226,255,0.2)', speedMult: 1, collidable: true },
  { id: 'boost', label: 'Boost', color: '#31ff79', glow: 'rgba(49,255,121,0.24)', speedMult: 1.08, collidable: true },
  { id: 'brake', label: 'Brake', color: '#ffd64d', glow: 'rgba(255,214,77,0.24)', speedMult: 0.88, collidable: true },
  { id: 'scenery', label: 'Scenery', color: '#b58cff', glow: 'rgba(181,140,255,0.18)', speedMult: 1, collidable: false },
];

const PRESET_LIBRARY = [
  {
    id: 'slope',
    label: 'Slope',
    points: [
      { x: -160, y: 20 },
      { x: -80, y: 10 },
      { x: 0, y: -10 },
      { x: 80, y: -45 },
      { x: 160, y: -90 },
    ],
  },
  {
    id: 'hills',
    label: 'Hills',
    points: [
      { x: -180, y: 25 },
      { x: -120, y: -25 },
      { x: -60, y: 20 },
      { x: 0, y: -30 },
      { x: 70, y: 25 },
      { x: 130, y: -20 },
      { x: 190, y: 15 },
    ],
  },
  {
    id: 'jump',
    label: 'Jump',
    points: [
      { x: -170, y: 30 },
      { x: -100, y: 18 },
      { x: -45, y: -12 },
      { x: -5, y: -55 },
      { x: 35, y: -8 },
      { x: 90, y: 18 },
      { x: 175, y: 35 },
    ],
  },
  {
    id: 'valley',
    label: 'Valley',
    points: [
      { x: -175, y: -40 },
      { x: -120, y: -20 },
      { x: -70, y: 20 },
      { x: 0, y: 90 },
      { x: 70, y: 20 },
      { x: 125, y: -20 },
      { x: 175, y: -42 },
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
  const firstLine = linePoints(lines[0]);
  if (!firstLine.length) return null;
  return firstLine[0];
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
          <Line x1={-15} y1={7.5} x2={14} y2={7.5} stroke="#8a8f98" strokeWidth={2.6} strokeLinecap="round" />
          <Rect x={-12.5} y={4.4} width={5.5} height={3.2} rx={1.2} fill="#4d525b" />
          <Rect x={8.3} y={4.4} width={4.2} height={3.2} rx={1.1} fill="#4d525b" />
          <G translateY={-(suspension + bob * 0.3)}>
            <Path d="M-15,5 L-6,-2 L8,-2 L14,3 L10,6 L-13,6 Z" fill="#1f2430" />
            <Path d="M-3,-6 L5,-6 L9,-2 L-2,-2 Z" fill={primary} />
            <Circle cx={0} cy={-10.5} r={4.3} fill="#f2d5bd" />
            <Path d="M-2,-13 C0,-15 3,-15 5,-13" stroke="#2f3238" strokeWidth={2} fill="none" />
            <Line x1={4} y1={-7} x2={10 - sway * 0.4} y2={-4 + airTilt * 0.2} stroke={accent} strokeWidth={1.7} />
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
    default:
      return (
        <G>
          <Polygon points="-10,2 12,2 14,-1 12,-4 -8,-4" fill={primary} />
          <Line x1={-12} y1={RIDER_RADIUS - 2} x2={14} y2={RIDER_RADIUS - 2} stroke="#ffaa44" strokeWidth={2} />
          <Circle cx={2} cy={-12} r={5} fill="white" />
          <Line x1={2} y1={-7} x2={0} y2={-2} stroke="white" strokeWidth={2.5} />
        </G>
      );
  }
}

function nearestPointOnTrack(lines, wx, wy) {
  let best = null;
  lines.forEach((line) => {
    const pts = linePoints(line);
    for (let i = 0; i < pts.length - 1; i++) {
      const cp = closestPointOnSegment(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      const dist = Math.hypot(wx - cp.x, wy - cp.y);
      if (!best || dist < best.dist) {
        best = { point: cp, dist };
      }
    }
  });
  return best;
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
  const [presetRotationDeg, setPresetRotationDeg] = useState(0);
  const [presetScale, setPresetScale] = useState(1);
  const [lines, setLines] = useState([]);
  const [currentStroke, setCurrentStroke] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rider, setRider] = useState(null);
  const [trail, setTrail] = useState([]);
  const [crashed, setCrashed] = useState(false);
  const [ownedRiders, setOwnedRiders] = useState(['classic', 'snowboarder', 'sled']);
  const [activeRiderId, setActiveRiderId] = useState('classic');
  const [purchaseBusyId, setPurchaseBusyId] = useState(null);
  const [paymentLedger, setPaymentLedger] = useState({});
  const [storeReady, setStoreReady] = useState(false);
  const [storePrices, setStorePrices] = useState({});
  const [showCharacterShop, setShowCharacterShop] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: SW, height: CANVAS_H });

  // Camera: panX/panY in screen-space, zoom multiplier
  const [cam, setCam] = useState({ x: 0, y: 0, zoom: 1 });
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  // Snapshot at gesture start for pinch/pan
  const camStartRef = useRef({ x: 0, y: 0, zoom: 1 });

  const riderRef = useRef(null);
  const linesRef = useRef(lines);
  const trailRef = useRef([]);
  const animRef = useRef(null);
  const frameCountRef = useRef(0);

  useEffect(() => { linesRef.current = lines; }, [lines]);

  // Screen → world coordinate
  const s2w = useCallback((sx, sy) => ({
    x: (sx - camRef.current.x) / camRef.current.zoom,
    y: (sy - camRef.current.y) / camRef.current.zoom,
  }), []);

  const eraseAt = useCallback((wx, wy) => {
    const thresh = 20 / camRef.current.zoom;
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

  const placePresetAt = useCallback((wx, wy) => {
    const preset = PRESET_LIBRARY.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    const minX = Math.min(...preset.points.map((p) => p.x));
    const maxX = Math.max(...preset.points.map((p) => p.x));
    const minY = Math.min(...preset.points.map((p) => p.y));
    const maxY = Math.max(...preset.points.map((p) => p.y));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const theta = (presetRotationDeg * Math.PI) / 180;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const placed = preset.points.map((p) => ({
      x: wx + ((p.x - cx) * presetScale * ct - (p.y - cy) * presetScale * st),
      y: wy + ((p.x - cx) * presetScale * st + (p.y - cy) * presetScale * ct),
    }));
    setLines((prev) => [...prev, { points: placed, type: lineStyle }]);
  }, [lineStyle, presetRotationDeg, presetScale, selectedPresetId]);

  useEffect(() => {
    let mounted = true;
    let purchaseSub;
    let errorSub;

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
      RNIap.endConnection().catch(() => {});
    };
  }, []);

  const restoreRiderPurchases = useCallback(async () => {
    try {
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
      }
    })
    .onUpdate((e) => {
      if (tool === 'preset') return;

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
      if (tool === 'preset') return;
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
      c.x = camStartRef.current.x + e.translationX;
      c.y = camStartRef.current.y + e.translationY;
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
      const cx = SW / 2, cy = CANVAS_H / 2;
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
  const startPlay = useCallback(() => {
    if (lines.length === 0) return;
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
    setCrashed(false);
    setPlaying(true);
  }, [activeRiderId, lines]);

  const stopPlay = useCallback(() => {
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
    riderRef.current = null;
    trailRef.current = [];
    setRider(null);
    setTrail([]);
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
                r.vx *= cfg.speedMult;
                r.vy *= cfg.speedMult;
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

        const collidableBounds = getCollidableBounds(linesRef.current);
        const hasTrackBelow = hasReachableTrackBelow(linesRef.current, r);
        const farBelowTrack = collidableBounds ? r.y > collidableBounds.maxY + 260 : false;
        const farOutsideTrackX = collidableBounds
          ? (r.x < collidableBounds.minX - 420 || r.x > collidableBounds.maxX + 420)
          : false;
        const farOffscreen = r.y > canvasSize.height / camRef.current.zoom + 1100;
        const noViableLanding = !grounded && !hasTrackBelow && (farBelowTrack || farOutsideTrackX || farOffscreen);

        if (noViableLanding) {
          r.crashed = true;
          setCrashed(true);
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
  }, [activeRiderId, canvasSize.height, canvasSize.width, playing]);

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
            <TouchableOpacity onPress={startPlay} disabled={!lines.length}
              style={[s.playBtn, !lines.length && s.playBtnOff]}>
              <Text style={[s.playText, !lines.length && { color: 'rgba(255,255,255,0.3)' }]}>▶ PLAY</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={stopPlay} style={s.stopBtn}>
              <Text style={s.stopText}>■ STOP</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => { setLines([]); stopPlay(); resetView(); }} style={s.clearBtn}>
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
          <View style={s.presetAdjustGroup}>
            <TouchableOpacity style={s.presetAdjustBtn} onPress={() => setPresetRotationDeg((v) => v - 15)}>
              <Text style={s.presetAdjustText}>⟲</Text>
            </TouchableOpacity>
            <Text style={s.presetValue}>{presetRotationDeg}°</Text>
            <TouchableOpacity style={s.presetAdjustBtn} onPress={() => setPresetRotationDeg((v) => v + 15)}>
              <Text style={s.presetAdjustText}>⟳</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.presetAdjustBtn} onPress={() => setPresetScale((v) => Math.max(0.4, +(v - 0.1).toFixed(2)))}>
              <Text style={s.presetAdjustText}>−</Text>
            </TouchableOpacity>
            <Text style={s.presetValue}>{presetScale.toFixed(1)}x</Text>
            <TouchableOpacity style={s.presetAdjustBtn} onPress={() => setPresetScale((v) => Math.min(2.8, +(v + 0.1).toFixed(2)))}>
              <Text style={s.presetAdjustText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.presetHint}>Tap canvas to place</Text>
        </View>
      )}

      {!playing && (tool === 'draw' || tool === 'preset') && (
        <View style={s.lineTypeBar}>
          {LINE_TYPES.map((lt) => (
            <TouchableOpacity
              key={lt.id}
              onPress={() => setLineStyle(lt.id)}
              style={[s.lineTypeBtn, lineStyle === lt.id && s.lineTypeBtnActive]}
            >
              <View style={[s.lineTypeSwatch, { backgroundColor: lt.color }]} />
              <Text style={[s.lineTypeText, lineStyle === lt.id && s.lineTypeTextActive]}>{lt.label}</Text>
            </TouchableOpacity>
          ))}
          <Text style={s.lineTypeHint}>{styleMeta.label} line selected</Text>
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
            </Defs>
            <Rect x="0" y="0" width={SW} height={CANVAS_H} fill="url(#bg)" />

            <G translateX={cam.x} translateY={cam.y} scale={cam.zoom}>
              {/* Track */}
              {lines.map((line, idx) => {
                const cfg = lineTypeConfig(lineType(line));
                const pts = linePoints(line);
                return (
                <React.Fragment key={idx}>
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

          {/* Zoom controls overlay */}
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
              <Text style={s.crashText}>WIPEOUT!</Text>
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

          {!playing && (
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
  toolGroupRight: { flexShrink: 0 },
  toolBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)', gap: 4 },
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
  lineTypeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 8,
    borderColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.03)' },
  lineTypeBtnActive: { borderColor: 'rgba(255,255,255,0.45)', backgroundColor: 'rgba(255,255,255,0.09)' },
  lineTypeSwatch: { width: 10, height: 10, borderRadius: 5 },
  lineTypeText: { color: 'rgba(255,255,255,0.65)', fontSize: 11, fontWeight: '700' },
  lineTypeTextActive: { color: '#ffffff' },
  lineTypeHint: { marginLeft: 'auto', color: 'rgba(255,255,255,0.33)', fontSize: 11 },
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
  zoomBar: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(10,10,26,0.9)', borderWidth: 1, borderColor: 'rgba(0,255,200,0.15)',
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, gap: 5 },
  zoomBtn: { width: 28, height: 28, borderRadius: 6, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center' },
  zoomBtnText: { color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: '600' },
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
});
