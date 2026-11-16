import { it, expect } from '@effect/vitest';
import { writeFileSync } from 'node:fs';
import { handleStudioAgentRequest } from './agent.server';
import { runPlaygroundEffect } from '../runtime/runtime.server';
it('captures the actual Studio gateway request without inference', async () => {
  const calls: unknown[] = [];
  const request = new Request('https://studio.test/api/studio/chat', {method:'POST', body: JSON.stringify({threadId:'studio',runId:'run-1',messages:[{id:'user-1',role:'user',content:'Draw the release review.'}]})});
  const response = await runPlaygroundEffect(handleStudioAgentRequest(request), {
    request, platform:{waitUntilPromise:()=>undefined},
    env:{AI:{gateway:()=>({getUrl:async()=>'',run:async(data, options)=>{
      calls.push({data,gateway:options?.gateway});
      return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'resp_1',created_at:1,model:'gpt-6-luna',status:'completed',output:[],usage:{input_tokens:1,output_tokens:0,total_tokens:1}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
    }})}}
  });
  await response.text();
  expect(calls).toHaveLength(1);
  writeFileSync('.memory/gateway-after.json',JSON.stringify(calls,null,2));
});
