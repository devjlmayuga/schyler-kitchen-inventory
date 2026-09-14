import path from 'node:path';

export default {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  webpack(config) {
    config.resolve.alias['@vladmandic/human'] = path.resolve('node_modules/@vladmandic/human/dist/human.esm.js');
    return config;
  },
};
