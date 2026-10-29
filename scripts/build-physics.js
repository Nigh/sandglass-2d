import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const args=['--target=wasm32','-std=c++17','-O3','-fno-exceptions','-fno-rtti','-nostdlib',
  `-fuse-ld=${process.env.WASM_LD||'lld'}`,'-Wl,--no-entry','-Wl,--export-memory','-Wl,--strip-all',
  '-Wl,--initial-memory=131072','-Wl,--max-memory=134217728','-Wl,-z,stack-size=65536',
  'native/sand.cpp','-o','src/sand.wasm'];
const result=spawnSync(process.env.CLANG||'clang++',args,{cwd:root,stdio:'inherit'});
if(result.error){console.error('编译物理内核需要 clang++ 和 lld。',result.error.message);process.exit(1);}
if(result.status!==0)process.exit(result.status||1);
chmodSync(new URL('../src/sand.wasm',import.meta.url),0o644);
