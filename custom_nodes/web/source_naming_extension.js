import {app} from '../../scripts/app.js';
import {migrateSourceNames} from './source_naming.js?v=20261029-batch-naming';
app.registerExtension({name:'Cartwheel.AutomaticBatchNaming',beforeConfigureGraph(graph){migrateSourceNames(graph);}});
