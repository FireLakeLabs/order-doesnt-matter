import { defineConfig } from 'vite';
export default defineConfig({build:{target:'esnext'},worker:{format:'es'},define:{'process.env.NODE_ENV':JSON.stringify(process.env.NODE_ENV??'production')},server:{host:'127.0.0.1',port:0},preview:{host:'127.0.0.1',port:0}});
