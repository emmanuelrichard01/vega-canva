import { SYSTEM_TEMPLATES } from '../apps/frontend/src/engine/templates/systemTemplates';

for (const tmpl of SYSTEM_TEMPLATES) {
  const nodes = tmpl.build();
  console.log(`\n=== Template: ${tmpl.id} (${tmpl.name}) - ${nodes.length} nodes ===`);
  const shapes = nodes.filter(n => n.type === 'shape');
  for (const s of shapes) {
    const kind = s.geometry?.kind || 'rect';
    const fill = s.appearance?.fill?.[0]?.color || 'none';
    const stroke = s.appearance?.stroke ? `${s.appearance.stroke.color} (${s.appearance.stroke.width}px)` : 'none';
    const sketch = s.appearance?.sketch || 'none';
    const text = s.text || '';
    const dims = `${s.width}x${s.height}`;
    console.log(`  [${dims}] kind=${kind} stroke=${stroke} fill=${fill} sketch=${sketch} text="${text}"`);
  }
}
