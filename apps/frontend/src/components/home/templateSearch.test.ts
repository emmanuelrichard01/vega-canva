import { describe, expect, it } from 'vitest';
import type { Template } from '../../engine/templates/templates';
import { fold, searchTemplates } from './templateSearch';
import { showcaseOf } from './templateFacts';

const t = (id: string, over: Partial<Template> = {}): Template => ({
  id,
  category: 'systems',
  name: id,
  blurb: '',
  teaches: [],
  build: () => [],
  ...over,
});

const CATALOGUE: Template[] = [
  t('systems-k8s', { name: 'Kubernetes workloads', blurb: 'Pods, services and an org of namespaces.', teaches: ['Cloud icons', 'Connectors'], tags: ['k8s', 'cluster'] }),
  t('product-org', { category: 'product', name: 'Org chart', blurb: 'Who reports to whom.', teaches: ['Connectors', 'Frames'] }),
  t('data-retention', { category: 'data', name: 'Retention cohorts', blurb: 'A cohort table with a linked heatmap.', teaches: ['Tables', 'Data links'], tags: ['saas'] }),
  t('diagrams-retro', { category: 'diagrams', name: 'Sprint retro', blurb: 'Café-style retrospective with stickies.', teaches: ['Stickies', 'Stamps'], tags: ['agile'] }),
  t('data-funnel', { category: 'data', name: 'Signup funnel', blurb: 'Where the retention problem starts.', teaches: ['Charts'] }),
];

describe('template search', () => {
  it('returns the catalogue in order with no query, filtered by category', () => {
    expect(searchTemplates(CATALOGUE, '').map((x) => x.id)).toEqual(CATALOGUE.map((x) => x.id));
    expect(searchTemplates(CATALOGUE, '  ', 'data').map((x) => x.id)).toEqual(['data-retention', 'data-funnel']);
  });

  it('ranks a name hit above the same word in a blurb', () => {
    expect(searchTemplates(CATALOGUE, 'retention').map((x) => x.id)).toEqual(['data-retention', 'data-funnel']);
  });

  it('ranks a word start above a word found inside another', () => {
    // "org" starts "Org chart" and sits inside nothing else's name; the k8s
    // board only has it in its blurb.
    expect(searchTemplates(CATALOGUE, 'org')[0].id).toBe('product-org');
  });

  it('needs every word typed to land somewhere', () => {
    expect(searchTemplates(CATALOGUE, 'connectors frames').map((x) => x.id)).toEqual(['product-org']);
    expect(searchTemplates(CATALOGUE, 'connectors zebra')).toEqual([]);
  });

  it('finds tags, capability chips and category names', () => {
    expect(searchTemplates(CATALOGUE, 'k8s').map((x) => x.id)).toEqual(['systems-k8s']);
    expect(searchTemplates(CATALOGUE, 'data links').map((x) => x.id)).toContain('data-retention');
    expect(searchTemplates(CATALOGUE, 'dashboards').map((x) => x.id)).toEqual(['data-retention', 'data-funnel']);
  });

  it('folds case and accents', () => {
    expect(fold('Café  RETRO!')).toBe('cafe retro');
    expect(searchTemplates(CATALOGUE, 'CAFE').map((x) => x.id)).toEqual(['diagrams-retro']);
  });

  it('keeps a category filter while searching', () => {
    expect(searchTemplates(CATALOGUE, 'retention', 'systems')).toEqual([]);
  });
});

describe('the showcase', () => {
  const featured = [
    t('systems-a', { featured: true }),
    t('systems-b', { featured: true }),
    t('data-a', { category: 'data', featured: true }),
    t('art-hero', { category: 'art', featured: true }),
    t('product-plain', { category: 'product' }),
  ];

  it('leads with the named boards, then one per category in category order', () => {
    expect(showcaseOf(featured, 5, ['art-hero']).map((x) => x.id)).toEqual(['art-hero', 'systems-a', 'data-a', 'systems-b']);
  });

  it('never shows a board that is not featured, and stops at the limit', () => {
    expect(showcaseOf(featured, 2, ['product-plain']).map((x) => x.id)).toEqual(['systems-a', 'data-a']);
  });
});
