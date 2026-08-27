import { defineConfig } from 'vite';
import { execSync } from 'child_process';

let commitHash = 'dev';
if (process.env.GITHUB_SHA) {
  commitHash = process.env.GITHUB_SHA.slice(0, 7);
} else {
  try {
    commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    commitHash = 'local';
  }
}

export default defineConfig({
  base: '/followcheck/',
  define: {
    __BUILD_ID__: JSON.stringify(commitHash),
  },
});
