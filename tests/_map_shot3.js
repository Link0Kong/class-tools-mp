const automator = require('miniprogram-automator');
(async()=>{
 const mp = await automator.connect({wsEndpoint:'ws://127.0.0.1:9420'});
 await mp.navigateTo('/pages/map/map');
 await new Promise(r=>setTimeout(r,1500));
 const page=await mp.currentPage(); console.log(JSON.stringify(await page.data()).slice(0,180));
 await mp.screenshot({path:'C:/Users/Ko_Li/.openclaw/workspace/web/_audit/campus_map_20261113/小程序_地图2.5D.png'});
 await mp.disconnect();
})().catch(e=>{console.error(e);process.exit(1)});
