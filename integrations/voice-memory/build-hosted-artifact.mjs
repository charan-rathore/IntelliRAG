import { cp,rm,mkdir,readdir,readFile } from 'node:fs/promises';
if(process.env.VERCEL_GIT_COMMIT_REF!=='demo/bolna-fictional')throw Error('Demo branch only');
const root='../integrations/voice-memory/hosted-artifact';
if(!process.cwd().endsWith('/web'))throw Error('Existingprojectwebrootonly');
const config=JSON.parse(await readFile(root+'/config.json','utf8'));
if(config.version!==3 || JSON.stringify(config.routes)!==JSON.stringify([{src:'/(.*)',dest:'/demo'}]))throw Error('Unexpected routes');
if(JSON.stringify((await readdir(root)).sort())!==JSON.stringify(['config.json','functions']))throw Error('Unexpected artifact');
await rm('.vercel/output',{recursive:true,force:true});await mkdir('.vercel',{recursive:true});await cp(root,'.vercel/output',{recursive:true});
