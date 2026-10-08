// Phase 0 spike: do free BSC RPCs serve eth_getLogs (Transfer) at a past block? Fallback for balances.
const RPCS = ['https://bsc-dataseed.bnbchain.org','https://bsc-dataseed1.defibit.io'];
const MSTRON = '0x7313ea16493b2f55054df0131a3a14b043ec8992';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const days = Number(process.argv[2] ?? 30);
async function rpc(url, method, params) {
  const r = await fetch(url, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal: AbortSignal.timeout(20000) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
for (const url of RPCS) {
  try {
    const head = parseInt(await rpc(url,'eth_blockNumber',[]),16);
    const hb = await rpc(url,'eth_getBlockByNumber',['0x'+head.toString(16),false]);
    const target = parseInt(hb.timestamp,16) - days*86400;
    let lo=1, hi=head;
    while (lo<hi){const mid=Math.floor((lo+hi)/2);const b=await rpc(url,'eth_getBlockByNumber',['0x'+mid.toString(16),false]);if(!b)throw new Error('null block');if(parseInt(b.timestamp,16)<target)lo=mid+1;else hi=mid;}
    const logs = await rpc(url,'eth_getLogs',[{address:MSTRON,topics:[TRANSFER],fromBlock:'0x'+lo.toString(16),toBlock:'0x'+(lo+Number(process.argv[3]??499)).toString(16)}]);
    console.log(`OK   ${url} block@-${days}d=${lo} transfers in range=${logs.length}`);
  } catch(e){ console.log(`FAIL ${url} ${String(e.message).slice(0,100)}`); }
}
