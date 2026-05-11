/**
 * Core indicator settings logic.
 */
import { evaluate as _evaluate, safeString } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate };
}

export async function setInputs({ entity_id, inputs: inputsRaw, _deps }: any = {}) {
  const { evaluate } = _resolve(_deps);
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a non-empty object, e.g. { length: 50 }');
  }

  const inputsJson = JSON.stringify(inputs);

  // The widget API is the only path that reliably routes input writes through the
  // study's property listeners so the engine recomputes. The widget's own
  // setInputValues() validates against getInputValues(), which returns [] for some
  // built-in studies — so we use the same underlying property.setValue() it calls,
  // but key the override list off getInputsInfo() (metaInfo) instead.
  const result = await evaluate(`
    (function() {
      var widget = ${CHART_API};
      var apiStudy = widget.getStudyById(${safeString(entity_id)});
      if (!apiStudy) return { error: 'Study not found: ' + ${safeString(entity_id)} };

      var overrides = ${inputsJson};
      var info = [];
      try { info = apiStudy.getInputsInfo() || []; } catch(e) {}
      var availableKeys = info.map(function(i) { return i.id; });

      var lowerMap = {};
      for (var lk = 0; lk < availableKeys.length; lk++) {
        lowerMap[availableKeys[lk].toLowerCase()] = availableKeys[lk];
      }

      var inputsTree = null;
      try { inputsTree = apiStudy._study.properties().childs().inputs.childs(); } catch(e) {}

      var updatedKeys = {};
      var unknownKeys = [];
      var overrideKeys = Object.keys(overrides);
      for (var ok = 0; ok < overrideKeys.length; ok++) {
        var wanted = overrideKeys[ok];
        var actual = availableKeys.indexOf(wanted) >= 0 ? wanted : lowerMap[wanted.toLowerCase()];
        if (!actual) { unknownKeys.push(wanted); continue; }
        var node = inputsTree && inputsTree[actual];
        if (node && typeof node.setValue === 'function') {
          node.setValue(overrides[wanted]);
          updatedKeys[actual] = overrides[wanted];
        }
      }

      return { updated_inputs: updatedKeys, available_inputs: availableKeys, unknown_keys: unknownKeys };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return {
    success: true,
    entity_id,
    updated_inputs: result.updated_inputs,
    available_inputs: result.available_inputs,
    ...(result.unknown_keys && result.unknown_keys.length > 0 ? { unknown_keys: result.unknown_keys } : {}),
  };
}

export async function toggleVisibility({ entity_id, visible, _deps }: any = {}) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (typeof visible !== 'boolean') throw new Error('visible must be a boolean (true or false)');

  const { evaluate } = _resolve(_deps);
  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      study.setVisible(${visible});
      var actualVisible = study.isVisible();
      return { visible: actualVisible };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, visible: result.visible };
}
