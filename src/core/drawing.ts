/**
 * Core drawing logic.
 */
import { evaluate as _evaluate, getChartApi as _getChartApi, safeString, requireFinite } from '../connection.js';
import type { CoreDeps, WithDeps } from './_page.js';
import { waitFor } from '../wait.js';
import { parseJsonObject } from './json.js';

export interface DrawingDeps extends CoreDeps {
  getChartApi?: typeof _getChartApi;
}

function _resolve(deps?: DrawingDeps) {
  const evaluate = deps?.evaluate || _evaluate;
  return { evaluate, getChartApi: deps?.getChartApi || _getChartApi, waitOpts: { evaluate, ...deps?.waitOpts } };
}

export interface ChartPoint { time: number; price: number }

export interface DrawShapeParams extends WithDeps<DrawingDeps> {
  shape: string;
  /** Times are unix seconds. */
  point: ChartPoint;
  point2?: ChartPoint;
  more_points?: ChartPoint[];
  lock?: boolean;
  /** Style overrides, as an object or a JSON string. */
  overrides?: Record<string, unknown> | string;
  text?: string;
}

export async function drawShape({ shape, point, point2, more_points, lock, overrides: overridesRaw, text, _deps }: DrawShapeParams) {
  const { evaluate, getChartApi, waitOpts } = _resolve(_deps);
  const overrides = overridesRaw ? parseJsonObject(overridesRaw, 'overrides') : {};
  if (!point || typeof point !== 'object') {
    throw new Error('point is required, e.g. {"time": 1700000000, "price": 100}');
  }
  if (more_points?.length && !point2) throw new Error('more_points needs point2: points are used in the order point, point2, more_points');
  const named: [string, ChartPoint][] = [
    ['point', point],
    ...(point2 ? [['point2', point2] as [string, ChartPoint]] : []),
    ...((more_points ?? []) as ChartPoint[]).map((p, i): [string, ChartPoint] => [`more_points[${i}]`, p]),
  ];
  const points = named.map(([name, p]) => ({
    time: requireFinite(p?.time, `${name}.time`),
    price: requireFinite(p?.price, `${name}.price`),
  }));
  const apiPath = await getChartApi();
  const options = `{ shape: ${safeString(shape)}, overrides: ${JSON.stringify(overrides)}, text: ${text ? JSON.stringify(text) : '""'}${lock ? ', lock: true' : ''} }`;

  const before = await evaluate(`${apiPath}.getAllShapes().map(function(s) { return s.id; })`);

  if (points.length > 1) {
    await evaluate(`${apiPath}.createMultipointShape(${JSON.stringify(points)}, ${options})`);
  } else {
    await evaluate(`${apiPath}.createShape(${JSON.stringify(points[0])}, ${options})`);
  }

  const { value: after } = await waitFor<string[]>(
    `${apiPath}.getAllShapes().map(function(s) { return s.id; })`,
    (ids) => ids.some(id => !(before || []).includes(id)),
    { timeout: 2000, ...waitOpts },
  );
  const newId = (after || []).find(id => !(before || []).includes(id)) || null;
  if (!newId) return { success: false, shape, entity_id: null, error: 'Shape was not created. Check the shape name and points.' };
  if (!lock) return { success: true, shape, entity_id: newId };

  const locked = await evaluate(`${apiPath}.getShapeById(${safeString(newId)}).isLocked()`);
  if (!locked) return { success: false, shape, entity_id: newId, error: 'Shape was created but is not locked' };
  return { success: true, shape, entity_id: newId, locked: true };
}

export async function listDrawings({ _deps }: WithDeps<DrawingDeps> = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const shapes = await evaluate(`
    (function() {
      var api = ${apiPath};
      var all = api.getAllShapes();
      return all.map(function(s) {
        var entry = { id: s.id, name: s.name };
        try { entry.points = api.getShapeById(s.id).getPoints(); } catch(e) {}
        return entry;
      });
    })()
  `);
  return { success: true, count: shapes?.length || 0, shapes: shapes || [] };
}

export interface EntityParams extends WithDeps<DrawingDeps> {
  entity_id: string;
}

export interface GetPropertiesParams extends EntityParams {
  verbose?: boolean;
}

export async function getProperties({ entity_id, verbose, _deps }: GetPropertiesParams) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var props = { entity_id: eid };
      var shape = api.getShapeById(eid);
      if (!shape) return { error: 'Shape not found: ' + eid };
      ${verbose ? `try { var methods = []; for (var key in shape) { if (typeof shape[key] === 'function') methods.push(key); } props.available_methods = methods; } catch(e) {}` : ''}
      try { var pts = shape.getPoints(); if (pts) props.points = pts; } catch(e) { props.points_error = e.message; }
      try { var ovr = shape.getProperties(); if (ovr) props.properties = ovr; } catch(e) {
        try { var ovr2 = shape.properties(); if (ovr2) props.properties = ovr2; } catch(e2) { props.properties_error = e2.message; }
      }
      try { props.visible = shape.isVisible(); } catch(e) {}
      try { props.locked = shape.isLocked(); } catch(e) {}
      try { props.selectable = shape.isSelectionEnabled(); } catch(e) {}
      try {
        var all = api.getAllShapes();
        for (var i = 0; i < all.length; i++) { if (all[i].id === eid) { props.name = all[i].name; break; } }
      } catch(e) {}
      return props;
    })()
  `);
  if (result?.error) throw new Error(result.error);
  return { success: true, ...result };
}

export async function removeOne({ entity_id, _deps }: EntityParams) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var eid = ${safeString(entity_id)};
      var before = api.getAllShapes();
      var found = false;
      for (var i = 0; i < before.length; i++) { if (before[i].id === eid) { found = true; break; } }
      if (!found) return { removed: false, error: 'Shape not found: ' + eid, available: before.map(function(s) { return s.id; }) };
      api.removeEntity(eid);
      var after = api.getAllShapes();
      var stillExists = false;
      for (var j = 0; j < after.length; j++) { if (after[j].id === eid) { stillExists = true; break; } }
      return { removed: !stillExists, entity_id: eid, remaining_shapes: after.length };
    })()
  `);
  if (result?.error) throw new Error(result.error);
  if (!result?.removed) {
    return { success: false, entity_id, removed: false, error: 'Shape is still present after removal' };
  }
  return { success: true, entity_id: result.entity_id, removed: true, remaining_shapes: result.remaining_shapes };
}

export async function clearAll({ _deps }: WithDeps<DrawingDeps> = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  await evaluate(`${apiPath}.removeAllShapes()`);
  return { success: true, action: 'all_shapes_removed' };
}
