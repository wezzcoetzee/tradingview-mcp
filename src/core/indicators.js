/**
 * Core indicator settings logic.
 */
import { evaluate as _evaluate, safeString } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

function _resolve(deps) {
  return { evaluate: deps?.evaluate || _evaluate };
}

/**
 * JS snippet injected into CDP to resolve a study's inputs across all known object shapes:
 *   Path A — Pine-script studies: study.getInputValues() returns [{id, value}]
 *   Path B — Built-in studies: study.properties().inputs.childs() returns a property
 *             tree where each user-facing key (non-underscore) is a node with:
 *               node.value  — an object with .value() and .setValue(), OR
 *               node._value — a plain primitive (fallback)
 *
 * Returns { inputs: [{id, value, _node}], source: 'A'|'B'|'none' }
 * where _node is the live object (for setValue) — only safe inside the CDP expression.
 */
const RESOLVE_INPUTS_JS = `
function resolveStudyInputs(study) {
  var pineInputs = [];
  try {
    pineInputs = study.getInputValues();
  } catch(e) {}

  if (Array.isArray(pineInputs) && pineInputs.length > 0) {
    return { inputs: pineInputs, source: 'A' };
  }

  try {
    var props = typeof study.properties === 'function' ? study.properties() : study._properties;
    var inputsProp = props && props.inputs;
    if (inputsProp) {
      var childs = typeof inputsProp.childs === 'function' ? inputsProp.childs() : inputsProp;
      var INTERNAL = /^_/;
      var keys = Object.keys(childs).filter(function(k) { return !INTERNAL.test(k); });
      if (keys.length > 0) {
        var items = keys.map(function(k) {
          var node = childs[k];
          var v = node.value;
          var current;
          if (typeof v === 'object' && v !== null && typeof v.value === 'function') {
            current = v.value();
          } else if ('_value' in node) {
            current = node._value;
          } else if (typeof v === 'function') {
            try { current = v(); } catch(e2) {}
          }
          return { id: k, value: current, _node: node };
        });
        return { inputs: items, source: 'B' };
      }
    }
  } catch(e) {}

  return { inputs: [], source: 'none' };
}
`;

export async function setInputs({ entity_id, inputs: inputsRaw, _deps }) {
  const { evaluate } = _resolve(_deps);
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a non-empty object, e.g. { length: 50 }');
  }

  const inputsJson = JSON.stringify(inputs);

  const result = await evaluate(`
    (function() {
      ${RESOLVE_INPUTS_JS}
      var chart = ${CHART_API};
      var study = chart.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };

      var resolved = resolveStudyInputs(study);
      var overrides = ${inputsJson};
      var updatedKeys = {};
      var availableKeys = resolved.inputs.map(function(inp) { return inp.id; });

      if (resolved.source === 'A') {
        var currentInputs = resolved.inputs;
        for (var i = 0; i < currentInputs.length; i++) {
          if (overrides.hasOwnProperty(currentInputs[i].id)) {
            currentInputs[i].value = overrides[currentInputs[i].id];
            updatedKeys[currentInputs[i].id] = overrides[currentInputs[i].id];
          }
        }
        if (Object.keys(updatedKeys).length > 0) study.setInputValues(currentInputs);
      } else if (resolved.source === 'B') {
        var lowerMap = {};
        for (var lk = 0; lk < availableKeys.length; lk++) lowerMap[availableKeys[lk].toLowerCase()] = availableKeys[lk];
        var overrideKeys = Object.keys(overrides);
        var nodeMap = {};
        for (var ni = 0; ni < resolved.inputs.length; ni++) nodeMap[resolved.inputs[ni].id] = resolved.inputs[ni]._node;

        for (var ok = 0; ok < overrideKeys.length; ok++) {
          var wanted = overrideKeys[ok];
          var actual = nodeMap[wanted] ? wanted : lowerMap[wanted.toLowerCase()];
          var node = actual && nodeMap[actual];
          if (node) {
            var valProp = node.value;
            if (typeof valProp === 'object' && valProp !== null && typeof valProp.setValue === 'function') {
              valProp.setValue(overrides[wanted]);
              updatedKeys[actual] = overrides[wanted];
            } else if (typeof node.setValue === 'function') {
              node.setValue(overrides[wanted]);
              updatedKeys[actual] = overrides[wanted];
            }
          }
        }
      }

      return { updated_inputs: updatedKeys, available_inputs: availableKeys };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, updated_inputs: result.updated_inputs, available_inputs: result.available_inputs };
}

export async function toggleVisibility({ entity_id, visible }) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (typeof visible !== 'boolean') throw new Error('visible must be a boolean (true or false)');

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
