#!/usr/bin/env python3
"""Root-owned VM timer entry point. Token remains inside the BE container."""
import subprocess

script = r"""
const r=await fetch('http://127.0.0.1:3000/api/v1/internal/generation-worker',{
 method:'POST',headers:{'X-AI-Service-Token':process.env.MALO_AI_SERVICE_TOKEN},
 signal:AbortSignal.timeout(280000)
});
if(!r.ok){console.error('generation_worker_http',r.status);process.exit(1);}
const data=await r.json();console.log(JSON.stringify(data));
"""
subprocess.run(['docker','exec','inthon-backend-1','node','--input-type=module','-e',script],check=True,timeout=290)
