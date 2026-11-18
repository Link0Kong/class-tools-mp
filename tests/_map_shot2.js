const automator = require('miniprogram-automator');
(async()=>{
 const mp = await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});
 await mp.navigateTo('/pages/map/map');
 await new Promise(r=>setTimeout(r,1200));
 await mp.pageScrollTo({scrollTop:0}).catch(()=>{});
 const page = await mp.currentPage();
 console.log('data',JSON.stringify(await page.data()).slice(0,200));
 await mp.screenshot({path:'C:/Users/Ko_Li/.openclaw/workspace/mp-class-tools-tests/_map_page2.png'});
 await mp.disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
