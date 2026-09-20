import { SYSTEM_TEMPLATES } from '../apps/frontend/src/engine/templates/systemTemplates';

for (const tmpl of SYSTEM_TEMPLATES) {
  const nodes = tmpl.build();
  console.log(`\n========================================`);
  console.log(`Template: ${tmpl.id} (${tmpl.name})`);
  console.log(`========================================`);
  for (const n of nodes) {
    if (n.type === 'shape') {
      const kind = n.geometry?.kind || 'rect';
      const w = n.width;
      const h = n.height;
      const ratio = (w / h).toFixed(2);
      const stroke = n.appearance?.stroke;
      const strokeStr = stroke ? `${stroke.color} (${stroke.width}px)` : 'NONE';
      const fillStr = n.appearance?.fill?.map((f: any) => f.color).join(', ') || 'NONE';
      const text = (n.text || '').replace(/\n/g, ' \\ ');
      console.log(`SHAPE [${w}x${h} r=${ratio}] kind=${kind.padEnd(10)} stroke=${strokeStr.padEnd(20)} fill=${fillStr.padEnd(12)} text="${text}"`);
    }
  }
}
