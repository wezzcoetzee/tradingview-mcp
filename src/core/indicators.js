/**
 * Core indicator settings logic.
 */
import { evaluate, safeString } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

export async function setInputs({ entity_id, inputs: inputsRaw }) {
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a non-empty object, e.g. { length: 50 }');
  }

  const inputsJson = JSON.stringify(inputs);

  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById(${safeString(entity_id)});
      if (!study) return { error: 'Study not found: ' + ${safeString(entity_id)} };
      var overrides = ${inputsJson};
      var updatedKeys = {};
      var availableKeys = [];

      // Path A: getInputValues / setInputValues — works for Pine-script studies.
      try {
        var currentInputs = study.getInputValues();
        if (Array.isArray(currentInputs) && currentInputs.length > 0) {
          for (var i = 0; i < currentInputs.length; i++) {
            availableKeys.push(currentInputs[i].id);
            if (overrides.hasOwnProperty(currentInputs[i].id)) {
              currentInputs[i].value = overrides[currentInputs[i].id];
              updatedKeys[currentInputs[i].id] = overrides[currentInputs[i].id];
            }
          }
          if (Object.keys(updatedKeys).length > 0) study.setInputValues(currentInputs);
        }
      } catch(e) {}

      // Path B: property tree — built-in studies (Moving Average, MACD, etc.)
      // expose inputs under study.properties().inputs as child properties with setValue().
      if (Object.keys(updatedKeys).length === 0) {
        try {
          var props = typeof study.properties === 'function' ? study.properties() : study._properties;
          var inputs = props && props.inputs;
          if (inputs) {
            var childs = typeof inputs.childs === 'function' ? inputs.childs() : inputs;
            var childKeys = Object.keys(childs);
            for (var ck = 0; ck < childKeys.length; ck++) availableKeys.push(childKeys[ck]);
            // Try direct key match, case-insensitive match, and alias matches.
            var lowerMap = {};
            for (var lk = 0; lk < childKeys.length; lk++) lowerMap[childKeys[lk].toLowerCase()] = childKeys[lk];
            var overrideKeys = Object.keys(overrides);
            for (var ok = 0; ok < overrideKeys.length; ok++) {
              var wanted = overrideKeys[ok];
              var actual = childs[wanted] ? wanted : lowerMap[wanted.toLowerCase()];
              if (actual && childs[actual] && typeof childs[actual].setValue === 'function') {
                childs[actual].setValue(overrides[wanted]);
                updatedKeys[actual] = overrides[wanted];
              }
            }
          }
        } catch(e) { return { error: 'property-tree path failed: ' + e.message, available_inputs: availableKeys }; }
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
