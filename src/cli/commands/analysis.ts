import { register, command, parseNumber, parseChoice } from '../router.js';
import { ANALYSIS_SECTIONS, getAnalysisSnapshot, getStudySeries } from '../../core/analysis.js';

register('analysis', {
  description: 'Read historical study evidence or a compact chart analysis snapshot',
  subcommands: new Map([
    ['series', command({
      description: 'Historical numeric study plots aligned to loaded bars',
      options: {
        study: { type: 'string', description: 'Required study entity ID' },
        plots: { type: 'string', description: 'Comma-separated plot IDs or exact names' },
        count: { type: 'string', description: 'Latest matching bars (max 500)' },
        from: { type: 'string', description: 'Inclusive Unix seconds' },
        to: { type: 'string', description: 'Inclusive Unix seconds' },
      },
      handler: opts => {
        if (!opts.study) throw new Error('--study is required');
        return getStudySeries({ entity_id: opts.study, plots: opts.plots?.split(',').map(p => p.trim()), count: opts.count === undefined ? undefined : parseNumber(opts.count, 'count'), from: opts.from === undefined ? undefined : parseNumber(opts.from, 'from'), to: opts.to === undefined ? undefined : parseNumber(opts.to, 'to') });
      },
    })],
    ['snapshot', command({
      description: 'Consistent price, studies, levels, labels, tables and zones',
      options: {
        count: { type: 'string', description: 'Price summary bars (max 500)' },
        sections: { type: 'string', description: 'Comma-separated price,studies,levels,labels,tables,zones' },
        filter: { type: 'string', description: 'Study name substring' },
      },
      handler: opts => getAnalysisSnapshot({ count: opts.count === undefined ? undefined : parseNumber(opts.count, 'count'), sections: opts.sections?.split(',').map(s => parseChoice(s.trim(), ANALYSIS_SECTIONS, 'section')), study_filter: opts.filter }),
    })],
  ]),
});
