'use strict';

const fs = require('fs');
const path = require('path');

const root = hexo.base_dir;
const routes = [
  ['lib/animejs/anime.min.js', 'node_modules/animejs/lib/anime.min.js'],
  ['lib/animate.css/animate.min.css', 'node_modules/animate.css/animate.min.css'],
  ['lib/fontawesome/css/all.min.css', 'node_modules/@fortawesome/fontawesome-free/css/all.min.css'],
  ['lib/mermaid/mermaid.min.js', 'node_modules/mermaid/dist/mermaid.min.js']
];

const fontDir = path.join(root, 'node_modules/@fortawesome/fontawesome-free/webfonts');
for (const file of fs.readdirSync(fontDir)) {
  routes.push([
    `lib/fontawesome/webfonts/${file}`,
    `node_modules/@fortawesome/fontawesome-free/webfonts/${file}`
  ]);
}

hexo.extend.generator.register('local-vendors', () => routes.map(([route, file]) => ({
  path: route,
  data: fs.readFileSync(path.join(root, file))
})));
