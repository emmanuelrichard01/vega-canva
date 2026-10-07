#!/usr/bin/env node
/**
 * Build the icon packs the board can place.
 *
 *   node scripts/icons/build-icon-packs.mjs
 *
 * Reads the vendors' official SVG folders from `.icon-sources/` (gitignored),
 * sanitises and compacts every icon (see `svgToIcon.mjs`), and writes hashed
 * JSON to `public/icon-packs/`:
 *
 *   index.json                      the pack list; the only file fetched up front
 *   <pack>/catalogue.<hash>.json    names and keywords for search
 *   <pack>/<category>.<hash>.json   the geometry, one file per category
 *   LICENSES.md                     source, version and licence per pack
 *
 * A pack whose source folder is missing is listed in `index.json` under
 * `unavailable` with the reason, and the browser shows it greyed out.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgToIcon } from './svgToIcon.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC = join(root, '.icon-sources');
const OUT = join(root, 'public', 'icon-packs');

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);
const slug = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s.+-]/g, '').replace(/[+\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'icon';
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

function* files(dir, ext = '.svg') {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p, ext);
    else if (name.toLowerCase().endsWith(ext)) yield p;
  }
}
const dirs = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory() && n !== '__MACOSX').sort() : []);

// ---------------------------------------------------------------- packs
const K8S_NAMES = {
  api: ['API server', 'kube-apiserver'], 'c-c-m': ['Cloud controller manager', 'ccm'], 'c-m': ['Controller manager', 'kube-controller-manager'],
  'k-proxy': ['kube-proxy', 'proxy'], kubelet: ['kubelet'], sched: ['Scheduler', 'kube-scheduler'],
  'control-plane': ['Control plane', 'master'], node: ['Node'], etcd: ['etcd'],
  'c-role': ['ClusterRole', 'c-role'], cm: ['ConfigMap', 'cm'], crb: ['ClusterRoleBinding', 'crb'], crd: ['CustomResourceDefinition', 'crd'],
  cronjob: ['CronJob'], deploy: ['Deployment', 'deploy'], ds: ['DaemonSet', 'ds'], ep: ['Endpoints', 'ep'], group: ['Group'],
  hpa: ['HorizontalPodAutoscaler', 'hpa'], ing: ['Ingress', 'ing'], job: ['Job'], limits: ['LimitRange', 'limits'],
  netpol: ['NetworkPolicy', 'netpol'], ns: ['Namespace', 'ns'], pod: ['Pod'], psp: ['PodSecurityPolicy', 'psp'],
  pv: ['PersistentVolume', 'pv'], pvc: ['PersistentVolumeClaim', 'pvc'], quota: ['ResourceQuota', 'quota'], rb: ['RoleBinding', 'rb'],
  role: ['Role'], rs: ['ReplicaSet', 'rs'], sa: ['ServiceAccount', 'sa'], sc: ['StorageClass', 'sc'], secret: ['Secret'],
  sts: ['StatefulSet', 'sts'], svc: ['Service', 'svc'], user: ['User'], vol: ['Volume'],
};

/** Each pack yields `{ category, categoryName, name, keywords, file }`. */
const PACKS = [
  {
    id: 'aws', name: 'AWS', source: 'https://aws.amazon.com/architecture/icons/', version: 'Asset package 07312026',
    licence: 'AWS Architecture Icons terms',
    licenceUrl: 'https://aws.amazon.com/architecture/icons/',
    attribution: 'AWS Architecture Icons are provided by Amazon Web Services for use in architecture diagrams. Do not imply endorsement by AWS; do not alter the icons beyond resizing and recolouring.',
    dir: 'aws',
    *entries(base) {
      const svc = join(base, 'Architecture-Service-Icons_07312026');
      for (const d of dirs(svc)) {
        const cat = titleCase(d.replace(/^Arch_/, ''));
        for (const f of files(join(svc, d, '64'))) {
          yield { category: `svc-${slug(cat)}`, categoryName: cat, name: titleCase(f.split(/[\\/]/).pop().replace(/^Arch_|_64\.svg$/g, '')), file: f };
        }
      }
      const res = join(base, 'Resource-Icons_07312026');
      for (const d of dirs(res)) {
        const cat = titleCase(d.replace(/^Res_/, ''));
        for (const f of files(join(res, d))) {
          if (/dark/i.test(f.slice(res.length))) continue;
          yield { category: `res-${slug(cat)}`, categoryName: `${cat} resources`, name: titleCase(f.split(/[\\/]/).pop().replace(/^Res_|_48(_Light)?\.svg$/g, '')), file: f };
        }
      }
      const cats = join(base, 'Category-Icons_07312026', 'Arch-Category_64');
      for (const f of files(cats)) {
        yield { category: 'categories', categoryName: 'Service categories', name: titleCase(f.split(/[\\/]/).pop().replace(/^Arch-Category_|_64\.svg$/g, '')), file: f };
      }
      for (const f of files(join(base, 'Architecture-Group-Icons_07312026'))) {
        if (/_Dark\.svg$/i.test(f)) continue;
        yield { category: 'groups', categoryName: 'Groups', name: titleCase(f.split(/[\\/]/).pop().replace(/_32\.svg$/, '')), file: f };
      }
    },
  },
  {
    id: 'azure', name: 'Azure', source: 'https://learn.microsoft.com/azure/architecture/icons/', version: 'Azure Public Service Icons (downloaded Oct 2026)',
    licence: 'Microsoft Terms of Use for Azure icons',
    licenceUrl: 'https://learn.microsoft.com/azure/architecture/icons/#icon-terms',
    attribution: 'Azure icons are provided by Microsoft for architecture diagrams and documentation. Do not imply Microsoft endorsement or alter the icons beyond resizing.',
    dir: 'azure/Azure_Public_Service_Icons/Icons',
    *entries(base) {
      for (const d of dirs(base)) {
        for (const f of files(join(base, d))) {
          const nm = f.split(/[\\/]/).pop().replace(/\.svg$/, '').replace(/^\d+-icon-service-/, '');
          yield { category: slug(d), categoryName: titleCase(d.replace(/\+/g, '&')).replace(/\b\w/g, (c) => c.toUpperCase()), name: titleCase(nm), file: f };
        }
      }
    },
  },
  {
    id: 'gcp', name: 'Google Cloud', source: 'https://cloud.google.com/icons', version: 'Category and core product icon sets (2025)',
    licence: 'Google Cloud icon terms',
    licenceUrl: 'https://cloud.google.com/icons',
    attribution: 'Google Cloud icons are provided by Google for architecture diagrams. Do not imply endorsement by Google.',
    dir: 'gcp',
    *entries(base) {
      for (const [folder, category, categoryName] of [['Unique Icons', 'products', 'Products'], ['Category Icons', 'categories', 'Categories']]) {
        for (const d of dirs(join(base, folder))) {
          for (const f of files(join(base, folder, d, 'SVG'))) {
            const nm = f.split(/[\\/]/).pop().replace(/\.svg$/, '').replace(/-512-color(-rgb)?$/, '');
            const spaced = nm.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
            yield { category, categoryName, name: titleCase(spaced), file: f };
          }
        }
      }
    },
  },
  {
    id: 'k8s', name: 'Kubernetes', source: 'https://github.com/kubernetes/community/tree/main/icons', version: 'kubernetes/community main, icons last changed 2026-01-26 (70a4bb2)',
    licence: 'CC-BY-4.0 (or Apache-2.0, at the user\'s choice)',
    licenceUrl: 'https://github.com/kubernetes/community/tree/main/icons#license',
    attribution: 'Kubernetes Icons Set, (c) The Kubernetes Authors, licensed CC-BY-4.0. The Kubernetes logo is a registered trademark of The Linux Foundation.',
    dir: 'k8s/svg',
    *entries(base) {
      const sets = [['control_plane_components/labeled', 'control-plane', 'Control plane'], ['infrastructure_components/unlabeled', 'infrastructure', 'Infrastructure'], ['resources/unlabeled', 'resources', 'Resources']];
      for (const [sub, category, categoryName] of sets) {
        for (const f of files(join(base, sub))) {
          const key = f.split(/[\\/]/).pop().replace(/\.svg$/, '');
          const [name, ...kw] = K8S_NAMES[key] ?? [titleCase(key)];
          yield { category, categoryName, name, keywords: [key, ...kw], file: f };
        }
      }
    },
  },
];

const UNAVAILABLE = [
  {
    id: 'cisco', name: 'Cisco',
    reason: 'Cisco publishes its topology icons only as a 2016 PowerPoint library, with no SVG source to build from.',
  },
];

// ---------------------------------------------------------------- build
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const index = { v: 1, packs: [], unavailable: [...UNAVAILABLE] };
const licenceRows = [];
let totalBytes = 0;

for (const pack of PACKS) {
  const base = join(SRC, pack.dir);
  if (!existsSync(base)) {
    index.unavailable.push({ id: pack.id, name: pack.name, reason: `Source files are missing. See public/icon-packs/LICENSES.md for where to download them.` });
    console.warn(`[skip] ${pack.id}: ${relative(root, base)} not found`);
    continue;
  }
  const chunks = new Map(); // category -> { name, icons: [] }
  const seenGeom = new Set();
  const usedIds = new Set();
  const catalogue = [];
  let warned = 0, dropped = 0, dupes = 0;
  const warnCounts = {};

  for (const e of pack.entries(base)) {
    let parsed;
    try {
      parsed = svgToIcon(readFileSync(e.file, 'utf8'));
    } catch (err) {
      parsed = null;
    }
    if (!parsed) { dropped++; continue; }
    for (const w of parsed.warnings) warnCounts[w] = (warnCounts[w] ?? 0) + 1;
    if (parsed.warnings.length) warned++;
    const geom = e.name + JSON.stringify(parsed.paths);
    if (seenGeom.has(geom)) { dupes++; continue; }
    seenGeom.add(geom);
    let id = `${e.category}/${slug(e.name)}`;
    for (let n = 2; usedIds.has(id); n++) id = `${e.category}/${slug(e.name)}-${n}`;
    usedIds.add(id);
    if (!chunks.has(e.category)) chunks.set(e.category, { name: e.categoryName, icons: [] });
    chunks.get(e.category).icons.push({ i: id.split('/')[1], n: e.name, v: parsed.viewBox, p: parsed.paths });
    catalogue.push([id, e.name, e.keywords?.join(' ') ?? '']);
  }

  const packDir = join(OUT, pack.id);
  mkdirSync(packDir, { recursive: true });
  const cats = [];
  for (const [category, chunk] of chunks) {
    const body = JSON.stringify({ c: category, icons: chunk.icons });
    const file = `${category}.${hash(body)}.json`;
    writeFileSync(join(packDir, file), body);
    totalBytes += body.length;
    cats.push({ id: category, name: chunk.name, count: chunk.icons.length, file: `${pack.id}/${file}` });
  }
  const catBody = JSON.stringify({ cats: cats.map((c) => [c.id, c.name]), icons: catalogue });
  const catFile = `catalogue.${hash(catBody)}.json`;
  writeFileSync(join(packDir, catFile), catBody);

  index.packs.push({
    id: pack.id, name: pack.name, version: pack.version, licence: pack.licence, licenceUrl: pack.licenceUrl,
    source: pack.source, attribution: pack.attribution, count: catalogue.length, cats, catalogue: `${pack.id}/${catFile}`,
  });
  licenceRows.push(pack);
  console.log(`[ok] ${pack.id}: ${catalogue.length} icons, ${cats.length} categories, ${dupes} duplicates, ${dropped} unreadable, ${warned} with warnings`);
  for (const [w, n] of Object.entries(warnCounts)) console.log(`       ${n} x ${w}`);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));

const md = [
  '# Icon pack licences',
  '',
  'Generated by `node scripts/icons/build-icon-packs.mjs`. Vendor files are read from `apps/frontend/.icon-sources/`, which is not committed.',
  'Every icon is converted to sanitised path geometry; no vendor SVG markup ships.',
  '',
  ...licenceRows.flatMap((p) => [
    `## ${p.name}`,
    `- Source: ${p.source}`,
    `- Version: ${p.version}`,
    `- Licence: ${p.licence} (${p.licenceUrl})`,
    `- Attribution: ${p.attribution}`,
    `- Source folder: \`.icon-sources/${p.dir}\``,
    '',
  ]),
  '## Not shipped',
  '',
  '### Cisco',
  'Cisco publishes its network topology icons as a PowerPoint library (`iconlibrary-production-oct2016.pptx`) under Cisco\'s terms, with no vector source. Its slides hold EMF and bitmap pictures, which this pipeline will not convert or imitate.',
  'To add it: obtain vector (SVG) exports of the official Cisco icons from https://www.cisco.com/c/en/us/about/brand-center/network-topology-icons.html, place them in `apps/frontend/.icon-sources/cisco/`, add a pack entry to `scripts/icons/build-icon-packs.mjs`, and run `node scripts/icons/build-icon-packs.mjs`.',
  '',
  '## Rebuilding',
  '',
  '| Pack | Download | Extract to `apps/frontend/.icon-sources/` |',
  '| --- | --- | --- |',
  '| AWS | https://aws.amazon.com/architecture/icons/ (Asset Package) | `aws/` |',
  '| Azure | https://learn.microsoft.com/azure/architecture/icons/ | `azure/` |',
  '| Google Cloud | https://cloud.google.com/icons (Category and Core Product icons) | `gcp/` |',
  '| Kubernetes | https://github.com/kubernetes/community/tree/main/icons/svg | `k8s/svg/` |',
  '',
  'Then run `node scripts/icons/build-icon-packs.mjs` from `apps/frontend`.',
  '',
];
writeFileSync(join(OUT, 'LICENSES.md'), md.join('\n'));
console.log(`geometry written: ${(totalBytes / 1024).toFixed(0)} kB raw -> public/icon-packs/`);
