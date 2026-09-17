import { isServerlessRuntime } from './storage';

/** Explicit local-only generation. This endpoint is never accepted from browser input. */
export function localModel() {
  if (isServerlessRuntime() || process.env.OLLAMA_GENERATION !== '1') return null;
  return { model: process.env.OLLAMA_MODEL?.trim() || 'llama3:latest', url: 'http://127.0.0.1:11434/api/chat' };
}
export async function streamLocal(opts: {system:string;user:string;signal?:AbortSignal;onToken:(text:string)=>void}) {
  const config=localModel();if(!config)throw new Error('Local generation is not enabled');
  const response=await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:config.model,stream:true,keep_alive:'10m',options:{temperature:0,num_predict:600,num_ctx:4096,seed:42},messages:[{role:'system',content:opts.system},{role:'user',content:opts.user}]}),signal:opts.signal?AbortSignal.any([opts.signal,AbortSignal.timeout(240000)]):AbortSignal.timeout(240000)});
  if(!response.ok||!response.body)throw new Error(`Local model unavailable (${response.status})`);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',full='';
  function consume(line:string){if(!line.trim())return;const event=JSON.parse(line) as {error?:string;message?:{content?:string}};if(event.error)throw new Error(event.error);const token=event.message?.content||'';full+=token;if(token)opts.onToken(token);}
  try {while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)consume(line);}consume(buffer+decoder.decode());}finally{reader.releaseLock();}
  return full.trim();
}
