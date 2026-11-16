import { it, expect } from "vitest";
import { z } from "zod";
import { generateObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { prepareRequest } from "../../../../scripts/local-openrouter/request-policy.mjs";

it("normalizes the real SDK's cached structured request without dropping its schema or prompt", async () => {
  let captured;
  const router=createOpenRouter({apiKey:"test-only",fetch:async(_url,options)=>{
    captured=JSON.parse(String(options.body));
    return Response.json({error:{code:400,message:"Synthetic diagnostic"}},{status:400});
  }});
  await expect(generateObject({model:router.chat("dots-studio/dots-3-note-preview:free"),allowSystemInMessages:true,
    messages:[{role:"system",content:"Return JSON.",providerOptions:{anthropic:{cacheControl:{type:"ephemeral"}}}},{role:"user",content:"Synthetic rule test."}],
    providerOptions:{openrouter:{reasoning:{effort:"low"},prompt_cache_key:"test"}},
    schema:z.object({matchedRules:z.array(z.object({ruleName:z.string(),isPrimary:z.boolean()})),reasoning:z.string(),noMatchFound:z.boolean()}),
  })).rejects.toThrow();
  expect(captured).toBeDefined();const fixed=prepareRequest(captured,true);
  expect(fixed.model).toBe("nvidia/nemotron-3.5-super-vl:free");
  expect(fixed.messages[0].content).toBe("Return JSON.");
  expect(fixed.response_format).toEqual(captured.response_format);
  expect(fixed.provider.require_parameters).toBe(true);
});
