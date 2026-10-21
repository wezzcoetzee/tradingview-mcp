import { register, command, parseNumber } from '../router.js';
import * as core from '../../core/drawing.js';

register('draw', {
  description: 'Drawing tools (shape, list, get, remove, clear)',
  subcommands: new Map([
    ['shape', command({
      description: 'Draw a shape on the chart',
      options: {
        type: { type: 'string', short: 't', description: 'Shape type: horizontal_line, trend_line, rectangle, text' },
        price: { type: 'string', short: 'p', description: 'Price level' },
        time: { type: 'string', description: 'Unix timestamp' },
        price2: { type: 'string', description: 'Second point price (for trend_line, rectangle)' },
        time2: { type: 'string', description: 'Second point time (for trend_line, rectangle)' },
        text: { type: 'string', description: 'Text content (for text shapes)' },
        overrides: { type: 'string', description: 'JSON style overrides' },
      },
      handler: (opts) => {
        const point = { time: parseNumber(opts.time, 'time'), price: parseNumber(opts.price, 'price') };
        const hasSecondPoint = opts.time2 !== undefined || opts.price2 !== undefined;
        const point2 = hasSecondPoint ? { time: parseNumber(opts.time2, 'time2'), price: parseNumber(opts.price2, 'price2') } : undefined;
        return core.drawShape({ shape: opts.type || 'horizontal_line', point, point2, overrides: opts.overrides, text: opts.text });
      },
    })],
    ['list', command({
      description: 'List all drawings on the chart',
      handler: () => core.listDrawings(),
    })],
    ['get', command({
      description: 'Get properties of a drawing',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Entity ID required. Usage: tv draw get <id>');
        return core.getProperties({ entity_id: positionals[0] });
      },
    })],
    ['remove', command({
      description: 'Remove a drawing by entity ID',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Entity ID required. Usage: tv draw remove <id>');
        return core.removeOne({ entity_id: positionals[0] });
      },
    })],
    ['clear', command({
      description: 'Remove all drawings',
      handler: () => core.clearAll(),
    })],
  ]),
});
