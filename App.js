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
  View, Text, TouchableOpacity, Dimensions,
  StyleSheet, StatusBar, Platform,
} from 'react-native';
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

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LineRider />
    </GestureHandlerRootView>
  );
}

function LineRider() {
  const [tool, setTool] = useState('draw');
  const [lines, setLines] = useState([]);
  const [currentStroke, setCurrentStroke] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [rider, setRider] = useState(null);
  const [trail, setTrail] = useState([]);
  const [crashed, setCrashed] = useState(false);

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
        for (let i = 0; i < line.length - 1; i++)
          if (distToSeg(wx, wy, line[i].x, line[i].y, line[i + 1].x, line[i + 1].y) < thresh) return false;
        return true;
      })
    );
  }, []);

  /* ══════════ GESTURES ══════════ */

  // 1-finger draw / erase
  const drawGesture = Gesture.Pan()
    .maxPointers(1)
    .enabled(!playing)
    .onStart((e) => {
      const w = s2w(e.x, e.y);
      if (tool === 'draw') setCurrentStroke([w]);
      else eraseAt(w.x, w.y);
    })
    .onUpdate((e) => {
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
      setCurrentStroke((stroke) => {
        if (stroke.length > 1) {
          const simplified = [stroke[0]];
          for (let i = 1; i < stroke.length; i++) {
            const last = simplified[simplified.length - 1];
            if (Math.hypot(stroke[i].x - last.x, stroke[i].y - last.y) > 6 / camRef.current.zoom)
              simplified.push(stroke[i]);
          }
          if (simplified.length > 1) setLines((prev) => [...prev, simplified]);
        }
        return [];
      });
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
  const composedGesture = Gesture.Race(twoFingerGesture, drawGesture);

  /* ══════════ PLAY / STOP ══════════ */
  const startPlay = useCallback(() => {
    if (lines.length === 0) return;
    let sx = Infinity, sy = 0;
    lines.forEach((l) => l.forEach((p) => { if (p.x < sx) { sx = p.x; sy = p.y; } }));
    riderRef.current = { x: sx, y: sy - RIDER_RADIUS - 2, vx: 1.5, vy: 0, onGround: false, angle: 0, crashed: false };
    trailRef.current = [];
    setCrashed(false);
    setPlaying(true);
  }, [lines]);

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
        r.vy += GRAVITY; r.x += r.vx; r.y += r.vy;
        let grounded = false;
        for (const line of linesRef.current) {
          for (let i = 0; i < line.length - 1; i++) {
            const cp = closestPointOnSegment(r.x, r.y, line[i].x, line[i].y, line[i + 1].x, line[i + 1].y);
            const dist = Math.hypot(r.x - cp.x, r.y - cp.y);
            if (dist < RIDER_RADIUS && dist > 0) {
              const nx = (r.x - cp.x) / dist, ny = (r.y - cp.y) / dist;
              r.x = cp.x + nx * RIDER_RADIUS; r.y = cp.y + ny * RIDER_RADIUS;
              const dot = r.vx * nx + r.vy * ny;
              if (dot < 0) {
                r.vx -= (1 + BOUNCE) * dot * nx; r.vy -= (1 + BOUNCE) * dot * ny;
                const tx = -ny, ty = nx, tDot = r.vx * tx + r.vy * ty;
                r.vx = tx * tDot * FRICTION; r.vy = ty * tDot * FRICTION;
              }
              r.angle = Math.atan2(line[i + 1].y - line[i].y, line[i + 1].x - line[i].x);
              grounded = true;
            }
          }
        }
        r.onGround = grounded;
        const speed = Math.hypot(r.vx, r.vy);
        if (speed > 20) { r.vx = (r.vx / speed) * 20; r.vy = (r.vy / speed) * 20; }
        if (r.y > CANVAS_H / camRef.current.zoom + 800) { r.crashed = true; setCrashed(true); }

        trailRef.current.push({ x: r.x, y: r.y });
        if (trailRef.current.length > 200) trailRef.current.shift();

        // Camera follow
        const c = camRef.current;
        const tx = SW / 2 - r.x * c.zoom;
        const ty = CANVAS_H / 2 - r.y * c.zoom;
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
  }, [playing]);

  const resetView = useCallback(() => {
    camRef.current = { x: 0, y: 0, zoom: 1 };
    setCam({ x: 0, y: 0, zoom: 1 });
  }, []);

  /* ══════════ DERIVED ══════════ */
  let startX = null, startY = null;
  if (lines.length > 0) {
    startX = Infinity;
    lines.forEach((l) => l.forEach((p) => { if (p.x < startX) { startX = p.x; startY = p.y; } }));
  }

  const zoomPct = Math.round(cam.zoom * 100);
  const rAngle = rider
    ? (rider.onGround ? rider.angle : Math.atan2(rider.vy || 0, rider.vx || 0)) * (180 / Math.PI)
    : 0;

  return (
    <View style={s.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={s.header}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={s.title}>⛷ LINE RIDER</Text>
          <Text style={s.subtitle}>NEON</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View style={s.toolbar}>
        <View style={s.toolGroup}>
          {[{ id: 'draw', icon: '✏️', label: 'Draw' }, { id: 'erase', icon: '🧹', label: 'Erase' }].map(({ id, icon, label }) => (
            <TouchableOpacity key={id} onPress={() => !playing && setTool(id)}
              style={[s.toolBtn, tool === id && s.toolBtnActive]} disabled={playing}>
              <Text style={{ fontSize: 14 }}>{icon}</Text>
              <Text style={[s.toolLabel, tool === id && s.toolLabelActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={s.toolGroup}>
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

      {/* Canvas */}
      <GestureDetector gesture={composedGesture}>
        <View style={s.canvas}>
          <Svg width={SW} height={CANVAS_H} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#0a0a1a" />
                <Stop offset="1" stopColor="#1a1a2e" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={SW} height={CANVAS_H} fill="url(#bg)" />

            <G translateX={cam.x} translateY={cam.y} scale={cam.zoom}>
              {/* Track */}
              {lines.map((line, idx) => (
                <React.Fragment key={idx}>
                  <Path d={pointsToPath(line)} stroke="rgba(0,255,200,0.15)"
                    strokeWidth={TRACK_WIDTH + 6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <Path d={pointsToPath(line)} stroke="#00ffc8"
                    strokeWidth={TRACK_WIDTH} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </React.Fragment>
              ))}

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
                  <Polygon points="-10,2 12,2 14,-1 12,-4 -8,-4" fill="#ff6432" />
                  <Line x1={-12} y1={RIDER_RADIUS - 2} x2={14} y2={RIDER_RADIUS - 2} stroke="#ffaa44" strokeWidth={2} />
                  <Circle cx={2} cy={-12} r={5} fill="white" />
                  <Line x1={2} y1={-7} x2={0} y2={-2} stroke="white" strokeWidth={2.5} />
                  <Line x1={-4} y1={-5} x2={6} y2={-5} stroke="white" strokeWidth={2.5} />
                  <Line x1={5} y1={-10} x2={10} y2={-8} stroke="#ff3366" strokeWidth={2} />
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
              const cx = SW / 2, cy = CANVAS_H / 2;
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
              const cx = SW / 2, cy = CANVAS_H / 2;
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
          </View>

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
        </View>
      </GestureDetector>
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
  toolBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)', gap: 4 },
  toolBtnActive: { borderColor: '#00ffc8', backgroundColor: 'rgba(0,255,200,0.12)' },
  toolLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  toolLabelActive: { color: '#00ffc8' },
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
  zoomPct: { color: 'rgba(255,255,255,0.5)', fontSize: 11, minWidth: 34, textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  zoomDivider: { width: 1, height: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
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
});
