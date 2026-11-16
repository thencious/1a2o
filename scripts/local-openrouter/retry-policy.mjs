export function jobRetryAt({ attempts = 0, failuresToday = 0, priority = false, status, retryAfter, now = Date.now() }) {
  const header = Number(retryAfter);
  const serverDelay = Number.isFinite(header) && header > 0 ? header * 1000 : typeof retryAfter === "string" && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter)-now) : 0;
  const nextReset=Date.parse(new Date(now).toISOString().slice(0,10)+"T00:00:00Z")+86400000;
  if(failuresToday>=3) return Math.max(nextReset,now+serverDelay);
  if ([400,401,404,409,422].includes(status)) return now + Math.max(serverDelay,3600000);
  if (status === 403) return Math.max(now+60000,serverDelay ? now+serverDelay : Date.parse(new Date(now).toISOString().slice(0,10)+"T00:00:00Z")+86400000);
  const delay = Math.min(priority ? 1800000 : 3600000,(priority ? 30000 : 60000)*2**Math.min(attempts,10));
  return now + Math.max(serverDelay,status===429 ? 60000 : 0,delay);
}
