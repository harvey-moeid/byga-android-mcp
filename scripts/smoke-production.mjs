const origin=process.env.BYGA_PUBLIC_ORIGIN;if(!origin)throw new Error('BYGA_PUBLIC_ORIGIN required');
const health=await fetch(origin+'/api/health');if(!health.ok||(await health.json()).status!=='ok')throw new Error('Health failed');
const dashboard=await fetch(origin+'/dashboard');if(!dashboard.ok||!(await dashboard.text()).includes('BYGA'))throw new Error('Dashboard failed');
const privateApi=await fetch(origin+'/api/devices');if(privateApi.status!==401)throw new Error('API auth failed');
const mcp=await fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'byga-smoke',version:'1'}}})});if(mcp.status!==401)throw new Error('MCP auth failed');
console.log(JSON.stringify({health:'PASS',dashboard:'PASS',private_api:'PASS',mcp_auth:'PASS',origin}));
