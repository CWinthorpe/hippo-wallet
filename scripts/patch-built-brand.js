const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) {
  throw new Error('dist/ is missing; build Hippo Wallet before post-processing');
}

const replacements = [
  ['support@rabby.io', 'cwinthorpe@users.noreply.github.com'],
  ['Rabby Wallet', 'Hippo Wallet'],
  ['https://rabby.io/', 'https://github.com/CWinthorpe/hippo-wallet'],
  ["fill='%23F2F4F7'", "fill='%23111629'"],
  ["fill='%232539B7'", "fill='%23111629'"],
  ["rx='8' fill='white'", "rx='8' fill='%23262C40'"],
  ['var(--rb-neutral-line, #e0e5ec)', 'var(--rb-neutral-line, #343b52)'],
];
const textExtensions = new Set(['.js', '.html', '.json', '.css', '.svg']);
let changedFiles = 0;
let replacementsApplied = 0;

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(absolutePath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name))) {
      continue;
    }
    const source = fs.readFileSync(absolutePath, 'utf8');
    let branded = source;
    for (const [legacy, replacement] of replacements) {
      const parts = branded.split(legacy);
      replacementsApplied += parts.length - 1;
      branded = parts.join(replacement);
    }
    if (branded !== source) {
      fs.writeFileSync(absolutePath, branded);
      changedFiles += 1;
    }
  }
}

visit(dist);

const guideBackground = fs.readFileSync(
  path.join(root, 'src/ui/assets/new-user-import/guide-bg.svg'),
  'utf8'
);
const generatedSvgDir = path.join(dist, 'generated/svgs');
for (const entry of fs.readdirSync(generatedSvgDir)) {
  if (!entry.endsWith('.svg')) continue;
  const absolutePath = path.join(generatedSvgDir, entry);
  const source = fs.readFileSync(absolutePath, 'utf8');
  if (!source.includes('viewBox="0 0 1440 944"')) continue;
  if (source !== guideBackground) {
    fs.writeFileSync(absolutePath, guideBackground);
    changedFiles += 1;
    replacementsApplied += 1;
  }
}

const indexHtmlPath = path.join(dist, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
const ghostButtonRule = `
      .dark .ant-btn.ant-btn-primary.ant-btn-background-ghost {
        color: var(--r-neutral-title-1, #fff);
      }
`;
if (!indexHtml.includes('.ant-btn-background-ghost')) {
  indexHtml = indexHtml.replace('</style>', `${ghostButtonRule}</style>`);
  fs.writeFileSync(indexHtmlPath, indexHtml);
  changedFiles += 1;
  replacementsApplied += 1;
}

// v0.93.100 forced the desktop onboarding guide into light mode. The source
// no longer does that; remove the already-minified legacy effect when
// post-processing a build produced before that source correction.
for (const entry of fs.readdirSync(dist)) {
  if (!entry.endsWith('.js')) continue;
  const absolutePath = path.join(dist, entry);
  let source = fs.readFileSync(absolutePath, 'utf8');
  const routeAnchor = source.indexOf('"/new-user/create-seed-phrase"');
  if (routeAnchor < 0) continue;
  const forceLight = source.indexOf('classList.remove("dark")', routeAnchor);
  if (forceLight < 0 || forceLight - routeAnchor > 1200) continue;
  const effectStart = source.lastIndexOf(',{isDarkTheme:', forceLight);
  const restoreDark = source.indexOf('classList.add("dark")', forceLight);
  const effectEnd = restoreDark < 0 ? -1 : source.indexOf('}),', restoreDark);
  if (effectStart < routeAnchor || effectEnd < 0) {
    throw new Error('Could not remove the legacy onboarding light-mode effect');
  }
  source = `${source.slice(0, effectStart)};return ${source.slice(
    effectEnd + 3
  )}`;
  fs.writeFileSync(absolutePath, source);
  changedFiles += 1;
  replacementsApplied += 1;
}

const uiBundlePath = path.join(dist, 'ui.js');
let uiBundle = fs.readFileSync(uiBundlePath, 'utf8');
const darkRouteStart = 'return n&&["#/mnemonics/create"';
if (uiBundle.includes(darkRouteStart)) {
  uiBundle = uiBundle.replace(
    darkRouteStart,
    'return n&&(e?.startsWith("#/new-user/")||["#/mnemonics/create"'
  );
  const darkRouteEnd = '].includes(e)}return n}';
  if (!uiBundle.includes(darkRouteEnd)) {
    throw new Error('Could not extend the built dark-theme route guard');
  }
  uiBundle = uiBundle.replace(darkRouteEnd, '].includes(e))}return n}');
  fs.writeFileSync(uiBundlePath, uiBundle);
  changedFiles += 1;
  replacementsApplied += 1;
}

const pageProvider = fs.readFileSync(path.join(dist, 'pageProvider.js'), 'utf8');
if (!pageProvider.includes('Hippo Wallet')) {
  throw new Error('Built page provider does not advertise Hippo Wallet');
}
if (!pageProvider.includes('finance.resupply.hippo-wallet')) {
  throw new Error('Built page provider does not advertise the Hippo RDNS');
}

const remaining = [];
function findLegacy(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findLegacy(absolutePath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name))) {
      continue;
    }
    if (fs.readFileSync(absolutePath, 'utf8').includes('Rabby Wallet')) {
      remaining.push(path.relative(dist, absolutePath));
    }
  }
}
findLegacy(dist);
if (remaining.length) {
  throw new Error(`Legacy user-facing wallet name remains in: ${remaining.join(', ')}`);
}

console.log(
  `Applied Hippo build branding: files=${changedFiles} replacements=${replacementsApplied}`
);
