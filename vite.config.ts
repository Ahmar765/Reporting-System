import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],
 server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:3000'}},
 build:{outDir:'dist',target:'esnext',rollupOptions:{output:{manualChunks(id){const p=id.replaceAll('\\','/');if(/node_modules\/(react|react-dom|scheduler)\//.test(p))return 'react-vendor';if(/node_modules\/(recharts|d3-|victory|react-smooth|react-transition-group)/.test(p))return 'charts';if(/node_modules\/lodash/.test(p))return 'chart-utils';}}}}
});
