import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET;
const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const staticDirectories = ['HTML', 'CSS', 'js'];
const staticFiles = [
    {
        source: path.resolve(projectRoot, '..', 'favicon.ico'),
        destination: 'favicon.ico'
    }
];
const rootLevelAssets = [
    {
        source: path.resolve(projectRoot, '..', 'uploads'),
        destination: 'uploads'
    }
];

function copyStaticFrontendAssets() {
    return {
        name: 'copy-static-frontend-assets',
        apply: 'build',
        async closeBundle() {
            const outDir = path.resolve(projectRoot, 'dist');

            for (const directory of staticDirectories) {
                const sourceDir = path.resolve(projectRoot, directory);
                const destinationDir = path.resolve(outDir, directory);
                await access(sourceDir);
                await rm(destinationDir, { recursive: true, force: true });
                await cp(sourceDir, destinationDir, { recursive: true });
            }

            for (const file of staticFiles) {
                const sourceFile = file.source;
                const destinationFile = path.resolve(outDir, file.destination);
                await access(sourceFile);
                await cp(sourceFile, destinationFile, { force: true });
            }

            for (const asset of rootLevelAssets) {
                const destinationDir = path.resolve(outDir, asset.destination);
                await access(asset.source);
                await rm(destinationDir, { recursive: true, force: true });
                await mkdir(path.dirname(destinationDir), { recursive: true });
                await cp(asset.source, destinationDir, { recursive: true });
            }
        }
    };
}

export default defineConfig({
    plugins: [react(), copyStaticFrontendAssets()],
    server: {
        port: 5173,
        proxy: devProxyTarget
            ? {
                '/api': {
                    target: devProxyTarget,
                    changeOrigin: true
                }
            }
            : undefined
    }
});
