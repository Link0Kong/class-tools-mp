const automator = require('miniprogram-automator');
(async()=>{
 const mp = await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});
 const errs=[]; const logs=[];
 mp.on('console', m=>logs.push(String(m)));
 mp.on('exception', e=>errs.push(String(e)));
 await mp.navigateTo('/pages/map/map');
 await new Promise(r=>setTimeout(r,2500));
 const page = await mp.currentPage();
 console.log('route', page.path);
 console.log('data', JSON.stringify(await page.data()).slice(0,500));
 await mp.screenshot({path:'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools-tests/_map_page.png'});
 console.log('errors', errs.slice(0,5));
 console.log('logs', logs.slice(-5));
 await mp.disconnect();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
