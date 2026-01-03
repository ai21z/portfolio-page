// Spark animation system

import { cumulativeLengths, pointAt } from './utils.js';
import { aStarPath } from './graph.js';
import { NAV_COORDS, MAX_SPARKS } from './config.js';
import {
  prefersReducedMotion,
  GRAPH,
  PATH_CACHE,
  NODE_IDS,
  ACTIVE_ANIMS,
  setActiveAnims,
  sparkCtx,
  sparkCanvas,
  ritualActive,
  followerSparks,
  LOCKED_ROUTES,
} from './state.js';
import { projectXY } from './viewport.js';

const loggedPathFailures = new Set();

export function startSpark(fromKey, toKey, speedPxPerSec = 650) {
  if (prefersReducedMotion || !GRAPH) return;
  if (ACTIVE_ANIMS.length >= MAX_SPARKS) ACTIVE_ANIMS.shift();

  const fromAnchor = NAV_COORDS[fromKey];
  const toAnchor = NAV_COORDS[toKey];
  if (!fromAnchor || !toAnchor) return;

  let idA = NODE_IDS[fromKey];
  let idB = NODE_IDS[toKey];
  
  if (idA == null || idB == null || idA < 0 || idB < 0) {
    for (const [id, pt] of Object.entries(NAV_COORDS)) {
      NODE_IDS[id] = GRAPH.nearestId(pt.x, pt.y, 80, 24);
    }
    idA = NODE_IDS[fromKey];
    idB = NODE_IDS[toKey];
  }

  if (idA == null || idB == null || idA < 0 || idB < 0) {
    const key = `${fromKey}->${toKey}`;
    if (!loggedPathFailures.has(key)) {
      console.warn('nearestId failed for spark path', key, { idA, idB });
      loggedPathFailures.add(key);
    }
    return;
  }

  const solved = aStarPath(idA, idB, GRAPH, PATH_CACHE);
  if (!solved || solved.length < 2) {
    const key = `${fromKey}->${toKey}`;
    if (!loggedPathFailures.has(key)) {
      console.warn('A* path missing for spark', key);
      loggedPathFailures.add(key);
    }
    return;
  }

  const pathImg = solved.map((pt) => ({ x: pt.x, y: pt.y }));
  pathImg[0] = { x: fromAnchor.x, y: fromAnchor.y };
  pathImg[pathImg.length - 1] = { x: toAnchor.x, y: toAnchor.y };

  const proj = projectXY(pathImg);
  const cum = cumulativeLengths(proj);
  const len = cum[cum.length - 1];
  if (!len) return;

  ACTIVE_ANIMS.push({
    imgPts: pathImg,
    projPts: proj,
    cum,
    len,
    s: 0,
    v: speedPxPerSec
  });
}

export function drawSparks(dt, pointAtRoute) {
  if (!sparkCtx || !sparkCanvas) return;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  sparkCtx.clearRect(0, 0, cssW, cssH);

  const trailLen = 60;
  const survivors = [];

  for (const anim of ACTIVE_ANIMS) {
    anim.s += anim.v * dt;
    if (anim.s > anim.len) continue;

    const head = pointAt(anim.projPts, anim.cum, anim.s);
    const tail = pointAt(anim.projPts, anim.cum, Math.max(0, anim.s - trailLen));

    sparkCtx.save();
    sparkCtx.lineCap = 'round';
    sparkCtx.lineJoin = 'round';

    sparkCtx.strokeStyle = 'rgba(143,180,255,0.2)';
    sparkCtx.lineWidth = 8;
    sparkCtx.shadowBlur = 20;
    sparkCtx.shadowColor = 'rgba(143,180,255,0.4)';
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    sparkCtx.strokeStyle = 'rgba(122,174,138,0.6)';
    sparkCtx.lineWidth = 4;
    sparkCtx.shadowBlur = 12;
    sparkCtx.shadowColor = 'rgba(122,174,138,0.7)';
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    sparkCtx.strokeStyle = 'rgba(240,255,245,0.9)';
    sparkCtx.lineWidth = 2;
    sparkCtx.shadowBlur = 8;
    sparkCtx.beginPath();
    sparkCtx.moveTo(tail[0], tail[1]);
    sparkCtx.lineTo(head[0], head[1]);
    sparkCtx.stroke();

    sparkCtx.fillStyle = 'rgba(200,255,220,1)';
    sparkCtx.shadowBlur = 12;
    sparkCtx.shadowColor = 'rgba(200,255,220,0.8)';
    sparkCtx.beginPath();
    sparkCtx.arc(head[0], head[1], 2.8, 0, Math.PI * 2);
    sparkCtx.fill();

    sparkCtx.restore();
    survivors.push(anim);
  }

  setActiveAnims(survivors);

  if (ritualActive && followerSparks.length && !prefersReducedMotion){
    for (const f of followerSparks){
      const route = LOCKED_ROUTES[f.id];
      if (!route || !route.projPts || route.projPts.length < 2) continue;
      
      const head = pointAtRoute(route, route.s);

      sparkCtx.save();

      sparkCtx.fillStyle = `rgba(143,180,255,${0.25 * f.alpha})`;
      sparkCtx.shadowBlur = 20;
      sparkCtx.shadowColor = `rgba(143,180,255,${0.4 * f.alpha})`;
      sparkCtx.beginPath();
      sparkCtx.arc(head[0], head[1], 8, 0, Math.PI * 2);
      sparkCtx.fill();

      sparkCtx.fillStyle = `rgba(122,174,138,${0.6 * f.alpha})`;
      sparkCtx.shadowBlur = 12;
      sparkCtx.shadowColor = `rgba(122,174,138,${0.7 * f.alpha})`;
      sparkCtx.beginPath();
      sparkCtx.arc(head[0], head[1], 4, 0, Math.PI * 2);
      sparkCtx.fill();

      sparkCtx.fillStyle = `rgba(200,255,220,${0.9 * f.alpha})`;
      sparkCtx.shadowBlur = 8;
      sparkCtx.shadowColor = 'rgba(200,255,220,0.8)';
      sparkCtx.beginPath();
      sparkCtx.arc(head[0], head[1], 2, 0, Math.PI * 2);
      sparkCtx.fill();

      sparkCtx.restore();
    }
  }
}

export function startSparkToPoint(fromKey, imgX, imgY, speed = 750) {
  if (prefersReducedMotion || !GRAPH) return;
  
  const fromId = NODE_IDS[fromKey];
  if (fromId == null || fromId < 0) return;
  
  const toId = GRAPH.nearestId(imgX, imgY, 96, 24);
  if (toId == null || toId < 0) {
    console.warn(`[LOCKED-ROUTE] No graph node near (${imgX.toFixed(0)}, ${imgY.toFixed(0)}) for spark`);
    return;
  }
  
  const solved = aStarPath(fromId, toId, GRAPH, PATH_CACHE);
  if (!solved || solved.length < 2) return;
  
  const imgPts = solved.map(p => ({ x: p.x, y: p.y }));
  const projPts = projectXY(imgPts);
  const cum = cumulativeLengths(projPts);
  const len = cum[cum.length - 1];
  if (!len) return;
  
  ACTIVE_ANIMS.push({
    imgPts, projPts, cum, len,
    s: 0, v: speed
  });
}

/**
 * Compute a route between two points in IMAGE coords.
 * Returns viewport-projected points for dust flow.
 * @param {number} fromImgX - start x in image coords
 * @param {number} fromImgY - start y in image coords
 * @param {number} toImgX - end x in image coords
 * @param {number} toImgY - end y in image coords
 * @returns {Array|null} - array of [vpX, vpY] points or null
 */
export function computeRouteVp(fromImgX, fromImgY, toImgX, toImgY) {
  if (!GRAPH) return null;
  
  const fromId = GRAPH.nearestId(fromImgX, fromImgY, 150, 24);
  const toId = GRAPH.nearestId(toImgX, toImgY, 150, 24);
  
  if (fromId == null || fromId < 0 || toId == null || toId < 0) {
    return null;
  }
  
  // Use regular A* with cache
  const solved = aStarPath(fromId, toId, GRAPH, PATH_CACHE);
  if (!solved || solved.length < 2) return null;
  
  // Project to viewport coords
  const pointsVp = projectXY(solved.map(p => ({ x: p.x, y: p.y })));
  return pointsVp;
}
