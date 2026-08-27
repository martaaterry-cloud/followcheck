import { defineConfig } from 'vite';
import { execSync } from 'child_process';

let commitHash = 'dev';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  commitHash = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'local';
}

export default defineConfig({
  base: '/followcheck/',
  define: {
    __BUILD_ID__: JSON.stringify(commitHash),
  },
});
